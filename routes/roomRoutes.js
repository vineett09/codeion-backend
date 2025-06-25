const express = require("express");
const roomService = require("../services/RoomService");

const router = express.Router();

// Create a new room
router.post("/rooms", (req, res) => {
  try {
    const { roomId, roomName, language, isPrivate, userName } = req.body;

    const room = roomService.createRoom(
      roomId,
      roomName,
      language,
      isPrivate,
      userName
    );

    res.json({
      success: true,
      room: {
        id: room.id,
        name: room.name,
        language: room.language,
        isPrivate: room.isPrivate,
        userCount: room.users.length,
      },
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get room details
router.get("/rooms/:roomId", (req, res) => {
  try {
    const { roomId } = req.params;
    const room = roomService.getRoom(roomId);

    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    res.json(room.toJSON());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get list of public rooms
router.get("/rooms", (req, res) => {
  try {
    const publicRooms = roomService.getRoomsList();
    res.json(publicRooms);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
