const { v4: uuidv4 } = require("uuid");
const User = require("../models/User");
const roomService = require("../services/RoomService");

const handleConnection = (io, socket) => {
  console.log("User connected:", socket.id);

  // Handle joining a room
  socket.on("join-room", async (data) => {
    try {
      const { roomId, userName } = data;
      const room = roomService.getRoom(roomId);

      if (!room) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      // Create user
      const user = new User(uuidv4(), userName, socket.id);

      // Add user to room
      roomService.addUserToRoom(roomId, user);
      socket.join(roomId);

      // Send initial data to user
      socket.emit("room-joined", {
        room: {
          id: room.id,
          name: room.name,
          language: room.language,
          tabs: room.tabs,
          activeTab: room.activeTab,
        },
        user: user.toJSON(),
        users: room.users.map((u) => u.toJSON()),
      });

      // Notify other users
      socket.to(roomId).emit("user-joined", {
        user: user.toJSON(),
      });

      console.log(`${userName} joined room ${roomId}`);
    } catch (error) {
      socket.emit("error", { message: error.message });
    }
  });

  // Handle code changes for specific tabs
  socket.on("code-change", (data) => {
    const user = roomService.getUserBySocketId(socket.id);
    if (!user) return;

    const { roomId, code, tabId } = data;
    const success = roomService.updateTabCode(roomId, tabId, code);

    if (!success) return;

    // Broadcast to other users in the room
    socket.to(roomId).emit("code-update", {
      code,
      tabId,
      userId: user.id,
      userName: user.name,
    });
  });

  // Handle cursor changes
  socket.on("cursor-change", (data) => {
    const user = roomService.getUserBySocketId(socket.id);
    if (!user) return;

    const { roomId, cursor, tabId } = data;
    user.updateCursor(cursor);

    // Broadcast cursor position to other users
    socket.to(roomId).emit("cursor-update", {
      userId: user.id,
      userName: user.name,
      cursor,
      color: user.color,
      tabId: tabId || user.activeTab,
    });
  });

  // Handle tab creation
  socket.on("create-tab", (data) => {
    const user = roomService.getUserBySocketId(socket.id);
    if (!user) return;

    const { roomId, tab } = data;
    const success = roomService.addTabToRoom(roomId, tab);

    if (!success) return;

    // Broadcast to all users in room
    io.to(roomId).emit("tab-created", {
      tab,
      userId: user.id,
      userName: user.name,
    });
  });

  // Handle tab switching per user
  socket.on("switch-tab", (data) => {
    const user = roomService.getUserBySocketId(socket.id);
    if (!user) return;

    const { roomId, tabId } = data;
    user.switchTab(tabId);

    // Send the specific tab's content to the user
    const tab = roomService.getTabFromRoom(roomId, tabId);
    if (tab) {
      socket.emit("tab-content", {
        tabId,
        code: tab.code,
        language: tab.language,
      });
    }

    // Notify other users about this user's tab switch
    socket.to(roomId).emit("user-tab-switched", {
      userId: user.id,
      userName: user.name,
      tabId,
    });
  });

  // Handle language changes for specific tabs
  socket.on("language-change", (data) => {
    const user = roomService.getUserBySocketId(socket.id);
    if (!user) return;

    const { roomId, language, tabId } = data;
    const success = roomService.updateTabLanguage(roomId, tabId, language);

    if (!success) return;

    // Broadcast to other users in room
    socket.to(roomId).emit("language-changed", {
      language,
      tabId,
      userId: user.id,
      userName: user.name,
    });
  });

  // Handle chat messages
  socket.on("chat-message", (data) => {
    const user = roomService.getUserBySocketId(socket.id);
    if (!user) return;

    const { roomId, message } = data;
    const timestamp = new Date();

    // Broadcast message to all users in room
    io.to(roomId).emit("chat-message", {
      id: uuidv4(),
      userId: user.id,
      userName: user.name,
      userColor: user.color,
      message,
      timestamp,
    });
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    const result = roomService.removeUserFromRoom(socket.id);

    if (result) {
      const { user, roomId } = result;

      // Notify other users
      socket.to(roomId).emit("user-left", {
        userId: user.id,
        userName: user.name,
      });

      console.log(`User ${user.name} disconnected from room ${roomId}`);
    }

    console.log("User disconnected:", socket.id);
  });
};

module.exports = handleConnection;
