const { v4: uuidv4 } = require("uuid");
const DSAUser = require("../models/DSAUser");
const dsaRoomService = require("../services/DSAChallengeRoomService");
const axios = require("axios"); // Make sure axios is required

const handleDSAConnection = (io, socket) => {
  console.log("DSA User connected:", socket.id);

  // Join DSA challenge room
  socket.on("join-dsa-room", async (data) => {
    try {
      const { roomId, userName, sessionId, userEmail } = data;
      const room = dsaRoomService.getRoom(roomId);
      if (!userEmail) {
        socket.emit("error", { message: "User email is required to join." });
        return;
      }
      if (!room) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      let user;
      let isReconnecting = false;

      // Check for reconnection
      if (sessionId) {
        const reconnectedUser = dsaRoomService.reconnectUser(
          roomId,
          sessionId,
          socket.id
        );
        if (reconnectedUser) {
          user = reconnectedUser;
          isReconnecting = true;
          console.log(`${user.name} reconnected to DSA room ${roomId}`);
        }
      }

      // Create new user if not reconnecting
      if (!isReconnecting) {
        if (room.isFull()) {
          socket.emit("error", { message: "Room is full" });
          return;
        }
        const newSessionId = uuidv4();
        const newUserId = uuidv4();
        user = new DSAUser(
          newUserId,
          userName,
          socket.id,
          newSessionId,
          userEmail
        );
        dsaRoomService.addUserToRoom(roomId, user);
        console.log(`${userName} joined DSA room ${roomId} for the first time`);
      }

      socket.join(roomId);

      const currentUsers = dsaRoomService.getAllUsersInRoom(roomId);

      // 🟢 Use new helper from your room class
      const roomDataForUser = room.getRoomDataForUser(user.id);

      // Send room data to the joined user
      socket.emit("dsa-room-joined", {
        ...roomDataForUser,
        user: user.toJSON(),
        sessionId: user.sessionId,
        users: currentUsers.map((u) => u.toJSON()),
      });

      // Broadcast user joined/reconnected to others
      const eventType = isReconnecting
        ? "dsa-user-reconnected"
        : "dsa-user-joined";
      socket.to(roomId).emit(eventType, {
        user: user.toJSON(),
        users: currentUsers.map((u) => u.toJSON()),
      });

      // Sync users list
      io.to(roomId).emit("dsa-users-list-sync", {
        users: currentUsers.map((u) => u.toJSON()),
      });
    } catch (error) {
      console.error("Error in join-dsa-room:", error);
      socket.emit("error", { message: error.message });
    }
  });

  socket.on("set-room-topic", (data) => {
    try {
      const user = dsaRoomService.getUserBySocketId(socket.id);
      if (!user) return;

      const { roomId, topic } = data;
      const room = dsaRoomService.getRoom(roomId);

      if (!room) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      // ✅ Only creator can set topic
      if (room.createdBy !== user.name) {
        socket.emit("error", {
          message: "Only the room creator can set the topic.",
        });
        return;
      }

      // Save topic
      room.topic = topic;
      room.lastActivity = new Date();

      // Broadcast to all users
      io.to(roomId).emit("room-topic-updated", {
        topic,
        updatedBy: user.name,
      });

      console.log(`Topic set to '${topic}' in room ${roomId} by ${user.name}`);
    } catch (error) {
      console.error("Error in set-room-topic:", error);
      socket.emit("error", { message: error.message });
    }
  });

  // Generate new challenge
  socket.on("generate-challenge", async (data) => {
    try {
      const user = dsaRoomService.getUserBySocketId(socket.id);
      if (!user) return;

      const { roomId, difficulty, topic } = data;
      const room = dsaRoomService.getRoom(roomId);

      if (!room) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      // Check if user is room creator or if it's a solo room
      if (room.createdBy !== user.name && room.users.length > 1) {
        socket.emit("error", {
          message: "Only room creator can generate challenges",
        });
        return;
      }

      const challenge = await dsaRoomService.generateChallenge(
        roomId,
        difficulty,
        topic
      );

      // Broadcast new challenge to all users in the room
      io.to(roomId).emit("new-challenge", {
        challenge: room.currentChallenge,
        generatedBy: user.name,
        room: room.toJSON(),
      });

      console.log(`Challenge generated in room ${roomId} by ${user.name}`);
    } catch (error) {
      console.error("Error in generate-challenge:", error);
      socket.emit("error", { message: error.message });
    }
  });
  socket.on("save-code", (data) => {
    const { roomId, code } = data;
    const user = dsaRoomService.getUserBySocketId(socket.id);
    const room = dsaRoomService.getRoom(roomId);
    if (!room || !user) return;

    room.saveUserCode(user.id, code);

    // ✅ Send back confirmation
    socket.emit("code-saved", {
      userId: user.id,
      roomId,
      timestamp: new Date(),
    });
  });

  // Submit solution
  // Update the submit-solution handler
  socket.on("submit-solution", async (data) => {
    try {
      const user = dsaRoomService.getUserBySocketId(socket.id);
      if (!user) {
        throw new Error("User session not found");
      }

      const { roomId, solution } = data;
      if (!roomId || !solution || !solution.language || !solution.code) {
        throw new Error("Invalid submission data");
      }

      const result = await dsaRoomService.submitSolution(
        roomId,
        user.id,
        solution
      );

      if (!result.success) {
        throw new Error(result.message || "Submission failed");
      }

      // Notify user of submission
      socket.emit("solution-submitted", {
        submission: result.submission,
        message: "Solution submitted successfully",
      });

      // Broadcast to room
      socket.to(roomId).emit("user-submitted", {
        userId: user.id,
        userName: user.name,
        submissionId: result.submission.id,
        submittedAt: result.submission.submittedAt,
      });

      // Start evaluation
      setTimeout(async () => {
        try {
          const evaluationResult = await dsaRoomService.evaluateSubmission(
            roomId,
            result.submission.id
          );

          if (!evaluationResult.success) {
            throw new Error(evaluationResult.message || "Evaluation failed");
          }

          // Send result to user
          socket.emit("evaluation-result", {
            submission: evaluationResult.submission,
            testResults: evaluationResult.submission.testResults,
          });

          // Broadcast updated leaderboard
          const leaderboard = dsaRoomService.getLeaderboard(roomId);
          io.to(roomId).emit("leaderboard-updated", {
            leaderboard,
            lastSubmission: {
              userId: user.id,
              userName: user.name,
              status: evaluationResult.submission.status,
              score: evaluationResult.submission.score,
            },
          });
        } catch (evalError) {
          console.error("Evaluation error:", evalError);
          socket.emit("error", {
            message: evalError.message || "Evaluation failed",
            code: "EVALUATION_ERROR",
            submissionId: result.submission.id,
          });
        }
      }, 2000);
    } catch (error) {
      console.error("Submit solution error:", {
        error: error.message,
        stack: error.stack,
        socketId: socket.id,
        data,
      });

      socket.emit("error", {
        message: error.message || "Failed to submit solution",
        code: "SUBMISSION_ERROR",
        details: {
          roomId: data?.roomId,
          hasCode: !!data?.solution?.code,
          hasLanguage: !!data?.solution?.language,
        },
      });
    }
  });
  // End challenge
  socket.on("end-challenge", async (data) => {
    // Make the handler async
    try {
      const user = dsaRoomService.getUserBySocketId(socket.id);
      if (!user) return;

      const { roomId } = data;
      const room = dsaRoomService.getRoom(roomId);

      if (!room) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      // Check if user is room creator
      if (room.createdBy !== user.name) {
        socket.emit("error", {
          message: "Only room creator can end challenges",
        });
        return;
      }

      const updatedRoom = dsaRoomService.endChallenge(roomId);
      const finalLeaderboard = dsaRoomService.getLeaderboard(roomId);

      // Broadcast challenge ended to all users
      io.to(roomId).emit("challenge-ended", {
        room: updatedRoom.toJSON(),
        finalLeaderboard,
        endedBy: user.name,
      });

      console.log(`Challenge ended in room ${roomId}. Updating user stats...`);

      // --- NEW: LOGIC TO UPDATE PERSISTENT STATS ---
      try {
        // The winner is the first person on the final leaderboard
        const winner = finalLeaderboard.length > 0 ? finalLeaderboard[0] : null;

        for (const player of room.users) {
          if (!player.email) continue; // Skip if user has no email

          const solvedProblems = room
            .getUserSubmissions(player.id)
            .filter((sub) => sub.status === "accepted")
            .map((sub) => sub.challengeId);

          const payload = {
            email: player.email,
            stats: {
              won: winner ? player.id === winner.userId : false,
              ratingChange: winner
                ? player.id === winner.userId
                  ? 10
                  : -5
                : 0, // Example rating change
              solvedProblems: solvedProblems,
            },
          };

          await axios.post(
            `${process.env.NEXT_APP_URL}/api/user/update-stats`,
            payload,
            {
              headers: {
                "Content-Type": "application/json",
                "x-internal-api-key": process.env.INTERNAL_API_SECRET,
              },
            }
          );
          console.log(`Successfully updated stats for ${player.email}`);
        }
      } catch (apiError) {
        console.error(
          "Failed to update user stats via API:",
          apiError.response ? apiError.response.data : apiError.message
        );
        // This error is logged on the server but not sent to the client, as the game has already ended for them.
      }
      // --- END OF NEW LOGIC ---
    } catch (error) {
      console.error("Error in end-challenge:", error);
      socket.emit("error", { message: error.message });
    }
  });
  // Get user submissions
  socket.on("get-user-submissions", (data) => {
    try {
      const user = dsaRoomService.getUserBySocketId(socket.id);
      if (!user) return;

      const { roomId, userId } = data;
      const targetUserId = userId || user.id; // Allow checking own submissions or others

      const submissions = dsaRoomService.getUserSubmissions(
        roomId,
        targetUserId
      );

      socket.emit("user-submissions", {
        userId: targetUserId,
        submissions,
      });
    } catch (error) {
      console.error("Error in get-user-submissions:", error);
      socket.emit("error", { message: error.message });
    }
  });

  // Get current leaderboard
  socket.on("get-leaderboard", (data) => {
    try {
      const user = dsaRoomService.getUserBySocketId(socket.id);
      if (!user) return;

      const { roomId } = data;
      const leaderboard = dsaRoomService.getLeaderboard(roomId);

      socket.emit("leaderboard-data", {
        leaderboard,
      });
    } catch (error) {
      console.error("Error in get-leaderboard:", error);
      socket.emit("error", { message: error.message });
    }
  });

  // Change user language preference
  socket.on("change-language", (data) => {
    try {
      const user = dsaRoomService.getUserBySocketId(socket.id);
      if (!user) return;

      const { roomId, language } = data;
      user.setLanguage(language);

      // Broadcast language change to room
      socket.to(roomId).emit("user-language-changed", {
        userId: user.id,
        userName: user.name,
        language: language,
      });
    } catch (error) {
      console.error("Error in change-language:", error);
      socket.emit("error", { message: error.message });
    }
  });

  // Get room info
  socket.on("get-room-info", (data) => {
    try {
      const user = dsaRoomService.getUserBySocketId(socket.id);
      if (!user) return;

      const { roomId } = data;
      const room = dsaRoomService.getRoom(roomId);

      if (!room) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      socket.emit("room-info", {
        room: room.toJSON(),
        users: dsaRoomService.getAllUsersInRoom(roomId).map((u) => u.toJSON()),
      });
    } catch (error) {
      console.error("Error in get-room-info:", error);
      socket.emit("error", { message: error.message });
    }
  });

  // Handle user disconnect
  socket.on("disconnect", () => {
    try {
      const disconnectionData = dsaRoomService.handleUserDisconnect(socket.id);

      if (disconnectionData) {
        const { user, roomId, room } = disconnectionData;

        // Broadcast user disconnection to room
        socket.to(roomId).emit("dsa-user-disconnected", {
          userId: user.id,
          userName: user.name,
          users: dsaRoomService
            .getAllUsersInRoom(roomId)
            .map((u) => u.toJSON()),
        });

        console.log(`DSA User ${user.name} disconnected from room ${roomId}`);
      }
    } catch (error) {
      console.error("Error handling disconnect:", error);
    }
  });

  // Leave room permanently
  socket.on("leave-room", (data) => {
    try {
      const user = dsaRoomService.getUserBySocketId(socket.id);
      if (!user) return;

      const { roomId } = data;

      // Remove user permanently
      dsaRoomService.removeUserPermanently(roomId, user.id);

      // Leave socket room
      socket.leave(roomId);

      // Broadcast user left to remaining users
      socket.to(roomId).emit("dsa-user-left", {
        userId: user.id,
        userName: user.name,
        users: dsaRoomService.getAllUsersInRoom(roomId).map((u) => u.toJSON()),
      });

      // Confirm to user
      socket.emit("room-left", {
        message: "Successfully left the room",
        roomId,
      });

      console.log(`User ${user.name} left room ${roomId} permanently`);
    } catch (error) {
      console.error("Error in leave-room:", error);
      socket.emit("error", { message: error.message });
    }
  });
};

module.exports = handleDSAConnection;
