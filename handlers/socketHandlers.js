const { v4: uuidv4 } = require("uuid");
const User = require("../models/User");
const roomService = require("../services/RoomService");

const handleConnection = (io, socket) => {
  console.log("User connected:", socket.id);

  // Handle joining or reconnecting to a room
  socket.on("join-room", async (data) => {
    try {
      const { roomId, userName, sessionId } = data;
      const room = roomService.getRoom(roomId);

      if (!room) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      let user;
      let isReconnecting = false;

      // Try to reconnect if a sessionId was provided
      if (sessionId) {
        const reconnectedUser = roomService.reconnectUser(
          roomId,
          sessionId,
          socket.id
        );
        if (reconnectedUser) {
          user = reconnectedUser;
          isReconnecting = true;
          console.log(`${user.name} reconnected to room ${roomId}`);
        }
      }

      // If not reconnecting, create a new user
      if (!isReconnecting) {
        const newSessionId = uuidv4();
        const newUserId = uuidv4();
        user = new User(newUserId, userName, socket.id, newSessionId);
        roomService.addUserToRoom(roomId, user);
        console.log(`${userName} joined room ${roomId} for the first time`);
      }

      socket.join(roomId);

      // Get the current user list (this ensures consistency)
      const currentUsers = roomService.getAllUsersInRoom(roomId);

      // Send initial data to the user
      socket.emit("room-joined", {
        room: {
          id: room.id,
          name: room.name,
          language: room.language,
          tabs: room.tabs,
          activeTab: room.activeTab,
        },
        user: user.toJSON(),
        sessionId: user.sessionId,
        users: currentUsers.map((u) => u.toJSON()),
      });

      // Broadcast updated user list to ALL users in the room (including the one who just joined)
      const eventType = isReconnecting ? "user-reconnected" : "user-joined";
      io.to(roomId).emit(eventType, {
        user: user.toJSON(),
        users: currentUsers.map((u) => u.toJSON()), // Send the same authoritative list to everyone
      });

      // Also emit a separate event to sync all users' lists
      io.to(roomId).emit("users-list-sync", {
        users: currentUsers.map((u) => u.toJSON()),
      });
    } catch (error) {
      console.error("Error in join-room:", error);
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

  // Handle tab deletion
  socket.on("delete-tab", (data) => {
    const user = roomService.getUserBySocketId(socket.id);
    if (!user) return;

    const { roomId, tabId } = data;
    const result = roomService.deleteTabFromRoom(roomId, tabId);

    if (result && result.success) {
      // Broadcast to all users in the room
      io.to(roomId).emit("tab-deleted", {
        tabId,
        newActiveTab: result.newActiveTab,
      });
    }
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

    // Notify other users about this user's tab switch and sync user list
    const currentUsers = roomService.getAllUsersInRoom(roomId);
    socket.to(roomId).emit("user-tab-switched", {
      userId: user.id,
      userName: user.name,
      tabId,
      users: currentUsers.map((u) => u.toJSON()), // Include updated user list
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

  // Handle explicit leaving from the room
  socket.on("leave-room", (data) => {
    const user = roomService.getUserBySocketId(socket.id);
    if (!user) return;

    const { roomId, userId } = data;
    if (user.id !== userId) return; // Basic validation

    roomService.removeUserPermanently(roomId, userId);

    // Get updated user list and broadcast to everyone
    const currentUsers = roomService.getAllUsersInRoom(roomId);
    socket.to(roomId).emit("user-left", {
      userId: user.id,
      userName: user.name,
      users: currentUsers.map((u) => u.toJSON()),
    });

    console.log(`User ${user.name} explicitly left room ${roomId}`);
  });
  socket.on("request-user-sync", (data) => {
    const { roomId } = data;
    const user = roomService.getUserBySocketId(socket.id);

    if (!user) return;

    const currentUsers = roomService.getAllUsersInRoom(roomId);
    socket.emit("user-sync-response", {
      users: currentUsers.map((u) => u.toJSON()),
    });
  });

  // Also add a helper function to broadcast user list updates
  const broadcastUserListUpdate = (
    io,
    roomId,
    eventType,
    additionalData = {}
  ) => {
    const currentUsers = roomService.getAllUsersInRoom(roomId);
    const payload = {
      users: currentUsers.map((u) => u.toJSON()),
      ...additionalData,
    };

    io.to(roomId).emit(eventType, payload);
  };
  // Handle temporary disconnect (e.g., closing tab)
  socket.on("disconnect", () => {
    const result = roomService.handleUserDisconnect(socket.id);

    if (result) {
      const { user, roomId } = result;

      // Use the helper function
      broadcastUserListUpdate(io, roomId, "user-disconnected", {
        userId: user.id,
        userName: user.name,
      });

      console.log(`User ${user.name} disconnected from room ${roomId}`);
    }

    console.log("User disconnected:", socket.id);
  });
};

module.exports = handleConnection;
