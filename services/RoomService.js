const Room = require("../models/Room");

class RoomService {
  constructor() {
    this.rooms = new Map();
    this.users = new Map();
    this.startCleanupTask();
  }

  createRoom(roomId, roomName, language, isPrivate, userName) {
    if (this.rooms.has(roomId)) {
      throw new Error("Room already exists");
    }

    const room = new Room(roomId, roomName, language, isPrivate, userName);
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

    room.addUser(user);
    this.users.set(user.socketId, { user, roomId });
    return room;
  }

  findUserBySessionId(roomId, sessionId) {
    const room = this.getRoom(roomId);
    if (!room) return null;
    return room.users.find((u) => u.sessionId === sessionId && u.disconnected);
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
      console.log(`User ${user.name} reconnected to room ${roomId}`);
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
      console.log(`User ${user.name} marked as disconnected in room ${roomId}`);
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
    console.log(
      `User ${userToRemove.name} permanently removed from room ${roomId}`
    );

    if (room.users.length === 0) {
      this.rooms.delete(roomId);
      console.log(`Room ${roomId} deleted (empty after user left).`);
    }
  }

  getActiveUsersInRoom(roomId) {
    const room = this.getRoom(roomId);
    if (!room) return [];
    return room.users.filter((user) => !user.disconnected);
  }

  getAllUsersInRoom(roomId) {
    const room = this.getRoom(roomId);
    if (!room) return [];
    return room.users;
  }

  getUserBySocketId(socketId) {
    const userInfo = this.users.get(socketId);
    return userInfo ? userInfo.user : null;
  }

  updateTabCode(roomId, tabId, code) {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    return room.updateTabCode(tabId, code);
  }

  updateTabLanguage(roomId, tabId, language) {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    return room.updateTabLanguage(tabId, language);
  }

  addTabToRoom(roomId, tab) {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    room.addTab(tab);
    return true;
  }

  deleteTabFromRoom(roomId, tabId, userId) {
    const room = this.getRoom(roomId);
    if (!room) return { success: false };
    return room.deleteTab(tabId, userId);
  }

  setTabPublicInRoom(roomId, tabId, isPublic, userId) {
    const room = this.getRoom(roomId);
    if (!room) return { success: false };
    return room.setTabPublic(tabId, isPublic, userId);
  }

  getTabFromRoom(roomId, tabId) {
    const room = this.getRoom(roomId);
    if (!room) return null;
    return room.getTab(tabId);
  }

  startCleanupTask() {
    setInterval(() => {
      const now = new Date();
      const maxDisconnectTime = 5 * 60 * 1000; // 5 minutes
      const maxInactiveRoomTime = 24 * 60 * 60 * 1000; // 24 hours

      for (const [roomId, room] of this.rooms.entries()) {
        for (let i = room.users.length - 1; i >= 0; i--) {
          const user = room.users[i];
          if (
            user.disconnected &&
            now - user.disconnectedAt > maxDisconnectTime
          ) {
            console.log(
              `Cleaning up disconnected user ${user.name} from room ${roomId}`
            );
            room.users.splice(i, 1);
          }
        }

        if (
          room.users.length === 0 &&
          now - room.lastActivity > maxInactiveRoomTime
        ) {
          this.rooms.delete(roomId);
          console.log(`Cleaned up inactive empty room: ${roomId}`);
        }
      }
    }, 30 * 1000); // Run cleanup every 30 seconds
  }
}

module.exports = new RoomService();
