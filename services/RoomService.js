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

  removeUserFromRoom(socketId) {
    const userInfo = this.users.get(socketId);
    if (!userInfo) return null;

    const { user, roomId } = userInfo;
    const room = this.rooms.get(roomId);

    if (room) {
      room.removeUser(user.id);

      // Clean up empty rooms
      if (room.users.length === 0) {
        this.rooms.delete(roomId);
        console.log(`Room ${roomId} deleted (empty)`);
      }
    }

    this.users.delete(socketId);
    return { user, roomId, room };
  }

  getUserBySocketId(socketId) {
    const userInfo = this.users.get(socketId);
    return userInfo ? userInfo.user : null;
  }

  getUserRoomId(socketId) {
    const userInfo = this.users.get(socketId);
    return userInfo ? userInfo.roomId : null;
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

  deleteTabFromRoom(roomId, tabId) {
    const room = this.rooms.get(roomId);
    if (!room) return { success: false };
    return room.deleteTab(tabId);
  }

  getTabFromRoom(roomId, tabId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    return room.getTab(tabId);
  }

  // Cleanup inactive rooms (run every hour)
  startCleanupTask() {
    setInterval(() => {
      const now = new Date();
      const maxInactiveTime = 24 * 60 * 60 * 1000; // 24 hours

      for (const [roomId, room] of this.rooms.entries()) {
        if (
          now - room.lastActivity > maxInactiveTime &&
          room.users.length === 0
        ) {
          this.rooms.delete(roomId);
          console.log(`Cleaned up inactive room: ${roomId}`);
        }
      }
    }, 60 * 60 * 1000);
  }
}

module.exports = new RoomService();
