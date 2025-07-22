const express = require("express");
const { v4: uuidv4 } = require("uuid");
const dsaRoomService = require("../services/DSAChallengeRoomService");
const logger = require("../utils/logger");

const router = express.Router();

// Create new DSA challenge room
router.post("/create", async (req, res) => {
  try {
    const { roomName, difficulty, isPrivate, userName } = req.body;

    // Validation
    if (!roomName || !difficulty || !userName) {
      return res.status(400).json({
        success: false,
        message: "Room name, difficulty, and user name are required",
      });
    }

    const validDifficulties = ["easy", "medium", "hard"];
    if (!validDifficulties.includes(difficulty)) {
      return res.status(400).json({
        success: false,
        message: "Invalid difficulty level",
      });
    }

    const roomId = uuidv4();
    const room = dsaRoomService.createRoom(
      roomId,
      roomName,
      difficulty,
      isPrivate || false,
      userName
    );

    res.status(201).json({
      success: true,
      message: "Room created successfully",
      room: room.toJSON(),
    });
  } catch (error) {
    logger.error("Error creating room:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;
