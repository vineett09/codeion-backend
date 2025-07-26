// models/Challenge.js
const mongoose = require("mongoose");

const challengeSchema = new mongoose.Schema({
  challengeId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  questionText: {
    type: String,
    required: true, // Combined title + description for embedding
  },
  examples: [
    {
      input: String,
      output: String,
    },
  ],
  constraints: [String],
  template: {
    javascript: String,
    python: String,
    cpp: String,
    java: String,
    go: String,
  },
  testCases: [
    {
      input: mongoose.Schema.Types.Mixed,
      output: mongoose.Schema.Types.Mixed,
    },
  ],
  functionName: {
    type: String,
    required: true,
  },
  topic: {
    type: String,
    required: true,
    index: true,
  },
  difficulty: {
    type: String,
    enum: ["easy", "medium", "hard"],
    required: true,
    index: true,
  },
  maxScore: {
    type: Number,
    required: true,
  },
  solvedBy: [
    {
      type: String, // user email
      index: true,
    },
  ],
  embedding: [Number], // Gemini embedding vector
  usageCount: {
    type: Number,
    default: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  lastUsed: {
    type: Date,
    default: Date.now,
  },
});

// Compound indexes for efficient querying
challengeSchema.index({ topic: 1, difficulty: 1, solvedBy: 1 });
challengeSchema.index({ topic: 1, difficulty: 1, lastUsed: -1 });
challengeSchema.index({ questionText: "text" }); // For text search
challengeSchema.index({ embedding: 1 }, { sparse: true }); // For embedding queries
challengeSchema.index({ topic: 1, difficulty: 1, usageCount: 1 }); // For efficient sorting

// Method to check if user has solved this challenge
challengeSchema.methods.hasSolvedBy = function (userEmail) {
  return this.solvedBy.includes(userEmail);
};

// Method to mark as solved by user
challengeSchema.methods.markSolvedBy = function (userEmail) {
  if (!this.hasSolvedBy(userEmail)) {
    this.solvedBy.push(userEmail);
    return this.save();
  }
  return Promise.resolve(this);
};

// Method to increment usage
challengeSchema.methods.incrementUsage = function () {
  this.usageCount += 1;
  this.lastUsed = new Date();
  return this.save();
};

module.exports = mongoose.model("Challenge", challengeSchema);
