const { Pinecone } = require("@pinecone-database/pinecone");
const Challenge = require("../models/Challenge");
const logger = require("../utils/logger");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const config = require("../config/config");
class VectorDBService {
  constructor() {
    this.pinecone = null;
    this.index = null;
    this.initialized = false;
    this.initializePinecone();
  }

  async initializePinecone() {
    try {
      this.pinecone = new Pinecone({
        apiKey: process.env.PINECONE_API_KEY,
      });

      this.index = this.pinecone.index(
        process.env.PINECONE_INDEX_NAME || "dsa-challenges"
      );
      this.initialized = true;
      logger.log("Pinecone initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize Pinecone:", error);
      this.initialized = false;
    }
  }

  async generateEmbedding(text) {
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

      const result = await model.embedContent({
        content: { parts: [{ text }] },
        taskType: "SEMANTIC_SIMILARITY",
        outputDimensionality: 768,
      });

      const embedding = result.embedding.values;
      logger.log("Generated embedding");
      return embedding;
    } catch (error) {
      logger.error(
        "❌ Failed to generate Gemini embedding:",
        error?.message || error
      );
      throw new Error("Embedding generation failed.");
    }
  }

  async getUnsolvedChallenge(userEmail, topic, difficulty) {
    if (!this.initialized) {
      logger.warn("Pinecone not initialized, falling back to MongoDB");
      return await this.getUnsolvedChallengeFromMongo(
        userEmail,
        topic,
        difficulty
      );
    }

    try {
      // Generate embedding for the query
      const queryText = `${topic} ${difficulty} data structures algorithms coding challenge`;
      const queryEmbedding = await this.generateEmbedding(queryText);
      // Fetch difficulty-specific threshold from config
      const threshold =
        config.vectorDB.pinecone.minSimilarityByDifficulty?.[difficulty] ||
        config.vectorDB.embedding.similarityThreshold;
      // Query Pinecone with metadata filters
      const queryResponse = await this.index.query({
        vector: queryEmbedding,
        topK: 3,
        includeMetadata: true,
        filter: {
          topic: { $eq: topic },
          difficulty: { $eq: difficulty },
          solvedBy: { $nin: [userEmail] },
        },
      });

      if (queryResponse.matches && queryResponse.matches.length > 0) {
        // Sort by similarity score and recency
        const sortedMatches = queryResponse.matches
          .filter((match) => match.score > threshold) // Similarity threshold
          .sort((a, b) => {
            // Prioritize by similarity score first, then by recency
            if (Math.abs(a.score - b.score) < 0.05) {
              // If scores are very close, prefer more recent challenges
              return (
                new Date(b.metadata.lastUsed) - new Date(a.metadata.lastUsed)
              );
            }
            return b.score - a.score;
          });

        if (sortedMatches.length > 0) {
          const bestMatch = sortedMatches[0];
          const challengeId = bestMatch.metadata.challengeId;

          // Fetch full challenge from MongoDB
          const challenge = await Challenge.findOne({ challengeId });
          if (challenge && !challenge.hasSolvedBy(userEmail)) {
            logger.log(
              `Found similar challenge: ${challengeId} (similarity: ${bestMatch.score})`
            );

            // Update usage stats
            await challenge.incrementUsage();

            return {
              found: true,
              challenge: challenge.toObject(),
              similarity: bestMatch.score,
              source: "cache",
            };
          }
        }
      }

      // Fallback to MongoDB if no good matches in Pinecone
      return await this.getUnsolvedChallengeFromMongo(
        userEmail,
        topic,
        difficulty
      );
    } catch (error) {
      logger.error("Error querying Pinecone:", error);
      // Fallback to MongoDB
      return await this.getUnsolvedChallengeFromMongo(
        userEmail,
        topic,
        difficulty
      );
    }
  }

  async getUnsolvedChallengeFromMongo(userEmail, topic, difficulty) {
    try {
      const challenge = await Challenge.findOne({
        topic,
        difficulty,
        solvedBy: { $nin: [userEmail] },
      }).sort({ lastUsed: 1 }); // Get least recently used

      if (challenge) {
        await challenge.incrementUsage();
        return {
          found: true,
          challenge: challenge.toObject(),
          similarity: 1.0,
          source: "mongodb",
        };
      }

      return { found: false, source: "none" };
    } catch (error) {
      logger.error("Error querying MongoDB:", error);
      return { found: false, source: "error" };
    }
  }

  async storeChallenge(challengeData) {
    try {
      const {
        challengeId,
        title,
        description,
        topic,
        difficulty,
        ...otherData
      } = challengeData;

      // Create combined text for embedding
      const questionText = `${title}\n\n${description}`;

      // Generate embedding
      const embedding = await this.generateEmbedding(questionText);

      // Store in MongoDB
      const challenge = new Challenge({
        challengeId,
        title,
        description,
        questionText,
        topic,
        difficulty,
        embedding,
        solvedBy: [],
        ...otherData,
      });

      await challenge.save();

      // Store in Pinecone if initialized
      if (this.initialized) {
        await this.index.upsert([
          {
            id: challengeId,
            values: embedding,
            metadata: {
              challengeId,
              topic,
              difficulty,
              solvedBy: [],
              questionText: questionText.substring(0, 500), // Truncate for metadata
              lastUsed: new Date().toISOString(),
              usageCount: 0,
            },
          },
        ]);

        logger.log(
          `Challenge ${challengeId} stored in both MongoDB and Pinecone`
        );
      } else {
        logger.log(
          `Challenge ${challengeId} stored in MongoDB only (Pinecone unavailable)`
        );
      }

      return { success: true, challengeId };
    } catch (error) {
      // Check if it's a duplicate key error
      if (error.code === 11000) {
        logger.warn(`Challenge ${challengeData.challengeId} already exists`);
        return {
          success: false,
          error: "Challenge already exists",
          challengeId: challengeData.challengeId,
        };
      }

      logger.error("Error storing challenge:", error);
      throw new Error("Failed to store challenge");
    }
  }

  async markChallengeSolved(challengeId, userEmail) {
    try {
      // Update MongoDB
      const challenge = await Challenge.findOne({ challengeId });
      if (challenge) {
        await challenge.markSolvedBy(userEmail);

        // Update Pinecone metadata if initialized
        if (this.initialized) {
          const currentSolvedBy = challenge.solvedBy;
          await this.index.update({
            id: challengeId,
            metadata: {
              solvedBy: currentSolvedBy,
              lastUsed: new Date().toISOString(),
            },
          });
        }

        logger.log(`Challenge ${challengeId} marked as solved by ${userEmail}`);
        return { success: true };
      }

      return { success: false, error: "Challenge not found" };
    } catch (error) {
      logger.error("Error marking challenge as solved:", error);
      throw new Error("Failed to mark challenge as solved");
    }
  }

  async getChallengeStats() {
    try {
      const stats = await Challenge.aggregate([
        {
          $group: {
            _id: { topic: "$topic", difficulty: "$difficulty" },
            count: { $sum: 1 },
            totalUsage: { $sum: "$usageCount" },
            avgUsage: { $avg: "$usageCount" },
          },
        },
        {
          $sort: { "_id.topic": 1, "_id.difficulty": 1 },
        },
      ]);

      return stats;
    } catch (error) {
      logger.error("Error getting challenge stats:", error);
      return [];
    }
  }

  // Health check method
  async healthCheck() {
    const status = {
      mongodb: false,
      pinecone: false,
      embedding: false,
    };

    try {
      // Check MongoDB
      const count = await Challenge.countDocuments();
      status.mongodb = true;

      // Check Pinecone
      if (this.initialized) {
        await this.index.describeIndexStats();
        status.pinecone = true;
      }

      // Check embedding service
      await this.generateEmbedding("test");
      status.embedding = true;
    } catch (error) {
      logger.error("Health check failed:", error);
    }

    return status;
  }
}

module.exports = new VectorDBService();
