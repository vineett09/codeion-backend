const { v4: uuidv4 } = require("uuid");
const User = require("../models/User");
const roomService = require("../services/RoomService");
const logger = require("../utils/logger");

const handleConnection = (io, socket) => {
  logger.log("User connected:", socket.id);

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

      if (sessionId) {
        const reconnectedUser = roomService.reconnectUser(
          roomId,
          sessionId,
          socket.id
        );
        if (reconnectedUser) {
          user = reconnectedUser;
          isReconnecting = true;
          logger.log(`${user.name} reconnected to room ${roomId}`);
        }
      }

      if (!isReconnecting) {
        const newSessionId = uuidv4();
        const newUserId = uuidv4();
        user = new User(newUserId, userName, socket.id, newSessionId);
        roomService.addUserToRoom(roomId, user);
        logger.log(`${userName} joined room ${roomId} for the first time`);
      }

      socket.join(roomId);

      const currentUsers = roomService.getAllUsersInRoom(roomId);

      // Filter tabs to show only public ones and the user's own private ones
      const visibleTabs = room.tabs.filter(
        (t) => t.isPublic || t.createdBy === user.id || t.createdBy === "system"
      );
      socket.emit("room-joined", {
        room: {
          id: room.id,
          name: room.name,
          language: room.language,
          tabs: visibleTabs,
          activeTab: room.activeTab,
        },
        user: user.toJSON(),
        sessionId: user.sessionId,
        users: currentUsers.map((u) => u.toJSON()),
      });

      const eventType = isReconnecting ? "user-reconnected" : "user-joined";
      io.to(roomId).emit(eventType, {
        user: user.toJSON(),
        users: currentUsers.map((u) => u.toJSON()),
      });

      io.to(roomId).emit("users-list-sync", {
        users: currentUsers.map((u) => u.toJSON()),
      });
    } catch (error) {
      logger.error("Error in join-room:", error);
      socket.emit("error", { message: error.message });
    }
  });

  socket.on("code-change", (data) => {
    const user = roomService.getUserBySocketId(socket.id);
    if (!user) return;
    const { roomId, code, tabId } = data;
    const success = roomService.updateTabCode(roomId, tabId, code);
    if (!success) return;
    socket.to(roomId).emit("code-update", {
      code,
      tabId,
      userId: user.id,
      userName: user.name,
    });
  });

  socket.on("create-tab", (data) => {
    const user = roomService.getUserBySocketId(socket.id);
    if (!user) return;
    const { roomId, tab } = data;
    // Assign the creator to the tab and set as private by default
    const newTab = { ...tab, createdBy: user.id, isPublic: false };
    const success = roomService.addTabToRoom(roomId, newTab);
    if (!success) return;
    // Only the creator gets the tab immediately (since it's private)
    socket.emit("tab-created", {
      tab: newTab,
      userId: user.id,
      userName: user.name,
    });
  });

  socket.on("delete-tab", (data) => {
    const user = roomService.getUserBySocketId(socket.id);
    if (!user) return;
    const { roomId, tabId } = data;
    // Pass userId to check for ownership
    const result = roomService.deleteTabFromRoom(roomId, tabId, user.id);
    if (result && result.success) {
      io.to(roomId).emit("tab-deleted", {
        tabId,
        newActiveTab: result.newActiveTab,
      });
    }
  });

  socket.on("share-tab", (data) => {
    const user = roomService.getUserBySocketId(socket.id);
    if (!user) return;

    const { roomId, tabId, isPublic } = data;
    const result = roomService.setTabPublicInRoom(
      roomId,
      tabId,
      isPublic,
      user.id
    );

    if (result && result.success) {
      // Broadcast to all users in the room
      io.to(roomId).emit("tab-privacy-changed", {
        tab: result.tab,
        userId: user.id,
        userName: user.name,
      });

      // If the tab is made private, notify non-owners to remove it
      if (!isPublic) {
        const room = roomService.getRoom(roomId);
        if (room) {
          // Send tab-removed to each non-owner user individually
          room.users.forEach((roomUser) => {
            if (
              roomUser.id !== result.tab.createdBy &&
              !roomUser.disconnected
            ) {
              io.to(roomUser.socketId).emit("tab-removed", { tabId });
            }
          });
        }
      }
    }
  });

  socket.on("switch-tab", (data) => {
    const user = roomService.getUserBySocketId(socket.id);
    if (!user) return;
    const { roomId, tabId } = data;
    user.switchTab(tabId);
    const tab = roomService.getTabFromRoom(roomId, tabId);
    if (tab) {
      socket.emit("tab-content", {
        tabId,
        code: tab.code,
        language: tab.language,
      });
    }
    const currentUsers = roomService.getAllUsersInRoom(roomId);
    socket.to(roomId).emit("user-tab-switched", {
      userId: user.id,
      userName: user.name,
      tabId,
      users: currentUsers.map((u) => u.toJSON()),
    });
  });

  socket.on("language-change", (data) => {
    const user = roomService.getUserBySocketId(socket.id);
    if (!user) return;
    const { roomId, language, tabId } = data;
    const success = roomService.updateTabLanguage(roomId, tabId, language);
    if (!success) return;
    socket.to(roomId).emit("language-changed", {
      language,
      tabId,
      userId: user.id,
      userName: user.name,
    });
  });

  socket.on("chat-message", (data) => {
    const user = roomService.getUserBySocketId(socket.id);
    if (!user) return;
    const { roomId, message } = data;
    const timestamp = new Date();
    io.to(roomId).emit("chat-message", {
      id: uuidv4(),
      userId: user.id,
      userName: user.name,
      userColor: user.color,
      message,
      timestamp,
    });
  });

  socket.on("leave-room", (data) => {
    const user = roomService.getUserBySocketId(socket.id);
    if (!user) return;
    const { roomId, userId } = data;
    if (user.id !== userId) return;
    roomService.removeUserPermanently(roomId, userId);
    const currentUsers = roomService.getAllUsersInRoom(roomId);
    socket.to(roomId).emit("user-left", {
      userId: user.id,
      userName: user.name,
      users: currentUsers.map((u) => u.toJSON()),
    });
    logger.log(`User ${user.name} explicitly left room ${roomId}`);
  });

  socket.on("disconnect", () => {
    const result = roomService.handleUserDisconnect(socket.id);
    if (result) {
      const { user, roomId } = result;
      const currentUsers = roomService.getAllUsersInRoom(roomId);
      io.to(roomId).emit("user-disconnected", {
        userId: user.id,
        userName: user.name,
        users: currentUsers.map((u) => u.toJSON()),
      });
      logger.log(`User ${user.name} disconnected from room ${roomId}`);
    }
    logger.log("User disconnected:", socket.id);
  });
};

module.exports = handleConnection;
