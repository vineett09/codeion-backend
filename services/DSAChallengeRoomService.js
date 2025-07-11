const DSAChallengeRoom = require("../models/DSAChallengeRoom");
const config = require("../config/config");
const axios = require("axios"); // Using axios for API requests

// Mapping our language names to Judge0 language IDs
const languageToJudgeId = {
  javascript: 93, // (ES6)
  python: 71,
  cpp: 54, // C++17
  java: 62, // JDK 11
  go: 60,
};

class DSAChallengeRoomService {
  constructor() {
    this.rooms = new Map();
    this.users = new Map(); // Maps socketId to { user, roomId }
    this.startCleanupTask();
  }

  createRoom(roomId, roomName, difficulty, isPrivate, userName) {
    if (this.rooms.has(roomId)) {
      throw new Error("Room already exists");
    }
    const room = new DSAChallengeRoom(
      roomId,
      roomName,
      difficulty,
      isPrivate,
      userName
    );
    this.rooms.set(roomId, room);
    return room;
  }

  // ... other room and user management methods like getRoom, addUserToRoom, etc. ...
  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  getRoomsList() {
    return Array.from(this.rooms.values())
      .filter((room) => !room.isPrivate)
      .map((room) => room.toJSON());
  }

  addUserToRoom(roomId, user) {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error("Room not found");
    }
    if (room.isFull()) {
      throw new Error("Room is full");
    }
    room.addUser(user);
    this.users.set(user.socketId, { user, roomId });
    return room;
  }

  reconnectUser(roomId, sessionId, newSocketId) {
    const room = this.getRoom(roomId);
    if (!room) return null;

    const user = room.users.find(
      (u) => u.sessionId === sessionId && u.disconnected
    );
    if (user) {
      for (const [socketId, userInfo] of this.users.entries()) {
        if (userInfo.user.id === user.id) {
          this.users.delete(socketId);
          break;
        }
      }
      user.reconnect(newSocketId);
      this.users.set(newSocketId, { user, roomId });
      return user;
    }
    return null;
  }

  handleUserDisconnect(socketId) {
    const userInfo = this.users.get(socketId);
    if (!userInfo) return null;

    const { user, roomId } = userInfo;
    const room = this.rooms.get(roomId);

    if (room && user) {
      user.markAsDisconnected();
      this.users.delete(socketId);
      return { user, roomId, room };
    }
    return null;
  }

  removeUserPermanently(roomId, userId) {
    const room = this.getRoom(roomId);
    if (!room) return;

    const userToRemove = room.users.find((u) => u.id === userId);
    if (!userToRemove) return;

    for (const [socketId, userInfo] of this.users.entries()) {
      if (userInfo.user.id === userId) {
        this.users.delete(socketId);
        break;
      }
    }

    room.removeUser(userId);

    if (room.users.length === 0) {
      this.rooms.delete(roomId);
    }
  }

  getUserBySocketId(socketId) {
    const userInfo = this.users.get(socketId);
    return userInfo ? userInfo.user : null;
  }

  getAllUsersInRoom(roomId) {
    const room = this.getRoom(roomId);
    return room ? room.users : [];
  }

  getActiveUsersInRoom(roomId) {
    const room = this.getRoom(roomId);
    return room ? room.users.filter((user) => !user.disconnected) : [];
  }

  async generateChallenge(roomId, difficulty, topic = "any") {
    const room = this.getRoom(roomId);
    if (!room) throw new Error("Room not found");

    console.log(
      `Generating challenge with difficulty: ${difficulty}, topic: ${topic}`
    );
    const challenge = await this.callGeminiAPI(difficulty, topic);

    room.setCurrentChallenge(challenge);
    return challenge;
  }

  async callGeminiAPI(difficulty, topic) {
    const prompt = `
      Generate a data structure and algorithm challenge with the following specifications:
      - Difficulty: ${difficulty}
      - Topic: ${topic}
      - The response must be a single, minified JSON object.
      - The JSON object must have these exact keys: "title", "description", "examples" (an array of objects with "input" and "output" strings), "constraints" (an array of strings), "template" (an object with keys "javascript", "python", "cpp"), and "testCases" (an array of exactly 5 objects, each with "input" as a JSON object and "output" as a JSON serializable value).
      - The 'input' in testCases should be an object where keys are the parameter names.
      - Example for a twoSum problem test case input: {"nums": [2, 7, 11, 15], "target": 9}

      Do not include any text, explanation, or markdown formatting outside of the JSON object.
    `;

    try {
      const response = await axios.post(
        `${config.gemini.baseURL}?key=${process.env.GEMINI_API_KEY}`,
        { contents: [{ parts: [{ text: prompt }] }] },
        { headers: { "Content-Type": "application/json" } }
      );

      const rawText = response.data.candidates[0].content.parts[0].text;
      // Clean the response to get only the JSON part
      const jsonText = rawText.match(/\{[\s\S]*\}/)[0];
      const challengeData = JSON.parse(jsonText);

      // Add server-side metadata
      challengeData.difficulty = difficulty;
      challengeData.topic = topic;
      challengeData.maxScore =
        difficulty === "easy" ? 100 : difficulty === "medium" ? 200 : 300;

      return challengeData;
    } catch (error) {
      console.error(
        "Error calling Gemini API:",
        error.response ? error.response.data : error.message
      );
      throw new Error("Failed to generate a challenge from AI service.");
    }
  }

  submitSolution(roomId, userId, solution) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error("Room not found");
    const result = room.submitSolution(userId, solution);
    if (result.success) {
      const user = room.users.find((u) => u.id === userId);
      if (user) {
        user.setCurrentSubmission(result.submission);
      }
    }
    return result;
  }

  async evaluateSubmission(roomId, submissionId) {
    const room = this.getRoom(roomId);
    if (!room || !room.currentChallenge)
      throw new Error("Room or challenge not found");

    let submission;
    let userId;

    // Find the submission and its owner
    for (const [uid, submissions] of room.userSubmissions.entries()) {
      const s = submissions.find((sub) => sub.id === submissionId);
      if (s) {
        submission = s;
        userId = uid;
        break;
      }
    }

    if (!submission) throw new Error("Submission not found");

    const result = await this.evaluateWithJudge0(
      submission,
      room.currentChallenge.testCases
    );
    return room.updateSubmissionResult(submissionId, result);
  }

  async evaluateWithJudge0(submission, testCases) {
    const languageId = languageToJudgeId[submission.language];
    if (!languageId) {
      return {
        status: "rejected",
        testResults: [],
        score: 0,
        message: "Unsupported language",
      };
    }

    const submissions = testCases.map((testCase) => {
      // For Judge0, stdin needs to be a simple string. We'll have to adapt how we pass complex inputs.
      // For now, we'll stringify the input object. The user's code will need to parse it.
      // This is a limitation to consider. A better way is to format the code template to accept stdin.
      const stdin = JSON.stringify(testCase.input);

      return {
        language_id: languageId,
        source_code: Buffer.from(submission.code).toString("base64"),
        stdin: Buffer.from(stdin).toString("base64"),
        expected_output: Buffer.from(JSON.stringify(testCase.output)).toString(
          "base64"
        ),
      };
    });

    try {
      const options = {
        method: "POST",
        url: `${config.judge0.baseURL}/submissions`,
        params: { base64_encoded: "true", wait: "true" },
        headers: {
          "Content-Type": "application/json",
          "X-RapidAPI-Key": config.judge0.apiKey,
          "X-RapidAPI-Host": config.judge0.apiHost,
        },
        data: { submissions },
      };

      const response = await axios.request(options);
      const results = response.data;

      let passedTests = 0;
      const testResults = results.map((res, index) => {
        const passed = res.status.id === 3; // 3 = Accepted
        if (passed) passedTests++;
        return {
          testCase: index + 1,
          passed,
          input: testCases[index].input,
          expected: testCases[index].output,
          actual: res.stdout
            ? Buffer.from(res.stdout, "base64").toString("utf-8")
            : "No output",
          status: res.status.description,
        };
      });

      const allPassed = passedTests === testCases.length;
      const score = allPassed
        ? 100
        : Math.round((passedTests / testCases.length) * 100 * 0.5); // Partial score

      return {
        status: allPassed ? "accepted" : "rejected",
        testResults,
        score,
      };
    } catch (error) {
      console.error(
        "Error calling Judge0 API:",
        error.response ? error.response.data : error.message
      );
      throw new Error("Code evaluation failed.");
    }
  }

  // ... other methods like endChallenge, getLeaderboard, etc. ...
  endChallenge(roomId) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error("Room not found");

    // Use resetChallenge to properly clear the challenge
    room.resetChallenge();

    return room;
  }

  getLeaderboard(roomId) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error("Room not found");
    return room.getLeaderboard();
  }

  getUserSubmissions(roomId, userId) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error("Room not found");
    return room.getUserSubmissions(userId);
  }

  startCleanupTask() {
    setInterval(() => {
      const now = new Date();
      const { maxDisconnectTime, maxInactiveRoomTime } = config.appSettings;

      for (const [roomId, room] of this.rooms.entries()) {
        let updated = false;
        for (let i = room.users.length - 1; i >= 0; i--) {
          const user = room.users[i];
          if (
            user.disconnected &&
            now - user.disconnectedAt > maxDisconnectTime
          ) {
            room.users.splice(i, 1);
            updated = true;
          }
        }

        if (
          room.users.length === 0 &&
          now - room.lastActivity > maxInactiveRoomTime
        ) {
          this.rooms.delete(roomId);
          console.log(`Cleaned up inactive room ${roomId}`);
        } else if (updated) {
          room.lastActivity = new Date();
        }
      }
    }, config.appSettings.cleanupInterval);
  }
}

module.exports = new DSAChallengeRoomService();
