const DSAChallengeRoom = require("../models/DSAChallengeRoom");
const config = require("../config/config");
const axios = require("axios");

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
    this.users = new Map();
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

    console.log(`Generating challenge: ${difficulty} / ${topic}`);

    try {
      const challenge = await this.callGeminiAPI(difficulty, topic);
      room.setCurrentChallenge(challenge);
      return { success: true, challenge };
    } catch (err) {
      console.error("Gemini generation failed:", err.message);
      // Return error instead of throwing
      return {
        success: false,
        error: "Failed to generate challenge. Please try again later.",
        details: err.message,
      };
    }
  }

  async callGeminiAPI(difficulty, topic) {
    const prompt = `
      Generate a data structure and algorithm challenge with the following specifications:
      - Difficulty: ${difficulty}
      - Topic: ${topic}
      - The response must be a single, minified JSON object.
      - The JSON object must have these exact keys: "title", "description", "examples" (an array of objects with "input" and "output" strings), "constraints" (an array of strings), "template" (an object with keys "javascript", "python", "cpp", "java", "go"), "testCases" (an array of exactly 5 objects, each with "input" as a JSON object and "output" as a JSON serializable value), and "functionName" (string - the main function name to be called).
      - The 'input' in testCases should be an object where keys are the parameter names.
      - The 'template' should contain starter code for each language with proper function signatures, parameter names, and return types.
      - The 'functionName' should be the name of the main function that will be called during execution.
      - For templates, use realistic function signatures like LeetCode:
        * JavaScript: function functionName(param1, param2) { }
        * Python: def function_name(param1, param2):
        * C++: class Solution { public: returnType functionName(param1Type param1, param2Type param2) { } };
        * Java: class Solution { public returnType functionName(param1Type param1, param2Type param2) { } }
        * Go: func functionName(param1 param1Type, param2 param2Type) returnType { }
      - Example for a twoSum problem:
        * functionName: "twoSum"
        * testCases input: {"nums": [2, 7, 11, 15], "target": 9}
        * JavaScript template: "function twoSum(nums, target) {\n    // Your code here\n}"
        * Python template: "def two_sum(nums, target):\n    # Your code here\n    pass"

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

  async submitSolution(roomId, userId, solution) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error("Room not found");

    const result = room.submitSolution(userId, solution);
    if (result.success) {
      const user = room.users.find((u) => u.id === userId);
      if (user) {
        user.setCurrentSubmission(result.submission);
      }

      // Automatically evaluate the submission
      try {
        await this.evaluateSubmission(roomId, result.submission.id);
      } catch (error) {
        console.error("Error evaluating submission:", error);
      }
    }
    return result;
  }

  async evaluateSubmission(roomId, submissionId) {
    try {
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

      // Get the function name from the current challenge
      const functionName = room.currentChallenge.functionName;
      if (!functionName) {
        throw new Error("Function name not found in challenge");
      }

      const result = await this.evaluateWithJudge0(
        submission,
        room.currentChallenge.testCases,
        functionName
      );
      return room.updateSubmissionResult(submissionId, result);
    } catch (error) {
      console.error("Evaluation error:", error);
      return {
        success: false,
        message: error.message,
        status: "error",
        testResults: [],
        score: 0,
      };
    }
  }

  async evaluateWithJudge0(submission, testCases, functionName) {
    try {
      if (!submission || !testCases || !functionName) {
        throw new Error("Invalid evaluation data");
      }

      const languageId = languageToJudgeId[submission.language];
      if (!languageId) {
        return {
          success: false,
          status: "rejected",
          testResults: [],
          score: 0,
          message: `Unsupported language: ${submission.language}`,
        };
      }

      console.log("Starting Judge0 evaluation for submission:", {
        submissionId: submission.id,
        language: submission.language,
        functionName: functionName,
        testCases: testCases.length,
      });

      const results = [];
      const judge0BaseURL = config.judge0.baseURL;
      const judge0ApiKey = config.judge0.apiKey;

      if (!judge0BaseURL || !judge0ApiKey) {
        throw new Error("Judge0 configuration is missing");
      }

      for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i];
        const wrappedCode = this.createWrappedCode(
          submission.code,
          submission.language,
          testCase,
          functionName
        );

        const submissionData = {
          language_id: languageId,
          source_code: Buffer.from(wrappedCode).toString("base64"),
          stdin: "",
          expected_output: Buffer.from(
            JSON.stringify(testCase.output)
          ).toString("base64"),
        };

        const options = {
          method: "POST",
          url: `${judge0BaseURL}/submissions`,
          params: { base64_encoded: "true", wait: "true" },
          headers: {
            "Content-Type": "application/json",
            "X-RapidAPI-Key": judge0ApiKey,
            "X-RapidAPI-Host": config.judge0.apiHost,
          },
          data: submissionData,
        };

        const response = await axios.request(options);
        const result = response.data;

        if (!result.status) {
          throw new Error("Invalid response from Judge0");
        }

        // Process the actual output
        let actualOutput = "No output";
        if (result.stdout) {
          actualOutput = Buffer.from(result.stdout, "base64")
            .toString("utf-8")
            .trim();
          // Try to parse as JSON to normalize output format
          try {
            const parsed = JSON.parse(actualOutput);
            actualOutput = JSON.stringify(parsed);
          } catch (e) {
            // If not JSON, keep as string but clean it
            actualOutput = actualOutput.replace(/"/g, "");
          }
        }

        // Normalize expected output
        const expectedOutput = JSON.stringify(testCase.output);

        const passed =
          result.status.id === 3 && actualOutput === expectedOutput;

        results.push({
          testCase: i + 1,
          passed: passed,
          input: testCase.input,
          expected: testCase.output,
          actual: actualOutput,
          status: result.status.description,
          error: result.stderr
            ? Buffer.from(result.stderr, "base64").toString("utf-8")
            : null,
          compilationError: result.compile_output
            ? Buffer.from(result.compile_output, "base64").toString("utf-8")
            : null,
        });
      }

      const passedTests = results.filter((r) => r.passed).length;
      const allPassed = passedTests === testCases.length;
      const score = allPassed
        ? 100
        : Math.round((passedTests / testCases.length) * 50);

      return {
        success: true,
        status: allPassed ? "accepted" : "rejected",
        testResults: results,
        score,
        passedTests,
        totalTests: testCases.length,
      };
    } catch (error) {
      console.error("Judge0 evaluation failed:", {
        error: error.message,
        stack: error.stack,
        submissionId: submission?.id,
        testCases: testCases?.length,
        functionName: functionName,
      });

      return {
        success: false,
        status: "error",
        testResults: [],
        score: 0,
        message: error.message || "Code evaluation failed",
        errorDetails: {
          isAxiosError: error.isAxiosError,
          responseStatus: error.response?.status,
          responseData: error.response?.data,
        },
      };
    }
  }

  // Helper method to create wrapped code for different languages
  createWrappedCode(userCode, language, testCase, functionName) {
    const inputJson = JSON.stringify(testCase.input);
    const inputParams = Object.keys(testCase.input);
    const inputValues = Object.values(testCase.input);

    const paramString = inputValues
      .map((val) => JSON.stringify(val))
      .join(", ");

    switch (language) {
      case "javascript":
        return `
${userCode}

// Test execution
const input = ${inputJson};
const result = ${functionName}(${paramString});
console.log(JSON.stringify(result));
`;

      case "python":
        // Convert camelCase to snake_case for Python
        const pythonFunctionName = functionName
          .replace(/([A-Z])/g, "_$1")
          .toLowerCase();
        return `
import json

${userCode}

# Test execution
input_data = ${inputJson}
result = ${pythonFunctionName}(${paramString})
print(json.dumps(result))
`;

      case "cpp":
        return `
#include <iostream>
#include <string>
#include <vector>
#include <algorithm>
#include <unordered_map>
#include <unordered_set>
using namespace std;

${userCode}

int main() {
    Solution solution;
    auto result = solution.${functionName}(${paramString});
    
    // Handle different return types for output
    if constexpr (std::is_same_v<decltype(result), std::vector<int>>) {
        cout << "[";
        for (size_t i = 0; i < result.size(); ++i) {
            cout << result[i];
            if (i < result.size() - 1) cout << ",";
        }
        cout << "]" << endl;
    } else if constexpr (std::is_same_v<decltype(result), int>) {
        cout << result << endl;
    } else if constexpr (std::is_same_v<decltype(result), bool>) {
        cout << (result ? "true" : "false") << endl;
    } else if constexpr (std::is_same_v<decltype(result), std::string>) {
        cout << "\\"" << result << "\\"" << endl;
    } else {
        cout << result << endl;
    }
    
    return 0;
}
`;

      case "java":
        return `
import java.util.*;

${userCode}

public class Main {
    public static void main(String[] args) {
        Solution solution = new Solution();
        Object result = solution.${functionName}(${paramString});
        
        // Handle different return types
        if (result instanceof List) {
            System.out.println(result.toString().replace(" ", ""));
        } else if (result instanceof int[]) {
            System.out.println(Arrays.toString((int[]) result).replace(" ", ""));
        } else if (result instanceof String) {
            System.out.println("\\"" + result + "\\"");
        } else {
            System.out.println(result);
        }
    }
}
`;

      case "go":
        return `
package main

import (
    "encoding/json"
    "fmt"
)

${userCode}

func main() {
    result := ${functionName}(${paramString})
    output, _ := json.Marshal(result)
    fmt.Println(string(output))
}
`;

      default:
        return userCode;
    }
  }

  endChallenge(roomId) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error("Room not found");

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

  hasAlreadySolved(roomId, userId, challengeId) {
    const room = this.getRoom(roomId);
    if (!room) return false;

    const submissions = room.getUserSubmissions(userId);
    return submissions.some(
      (s) => s.status === "accepted" && s.challengeId === challengeId
    );
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
