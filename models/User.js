class User {
  constructor(id, name, socketId, sessionId) {
    this.id = id;
    this.name = name;
    this.socketId = socketId;
    this.sessionId = sessionId; // Unique ID for session persistence
    this.cursor = { line: 0, ch: 0 };
    this.color = this.generateColor();
    this.activeTab = "main"; // Track user's active tab
    this.disconnected = false;
    this.disconnectedAt = null;
  }

  generateColor() {
    const colors = [
      "#FF6B6B",
      "#4ECDC4",
      "#45B7D1",
      "#96CEB4",
      "#FFEAA7",
      "#DDA0DD",
      "#98D8C8",
      "#F7DC6F",
      "#BB8FCE",
      "#85C1E9",
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  updateCursor(cursor) {
    this.cursor = cursor;
  }

  switchTab(tabId) {
    this.activeTab = tabId;
  }

  /**
   * Marks the user as disconnected and sets a timestamp.
   */
  markAsDisconnected() {
    this.disconnected = true;
    this.disconnectedAt = new Date();
  }

  /**
   * Reconnects a user with a new socket ID.
   * @param {string} newSocketId - The new socket ID for the reconnected user.
   */
  reconnect(newSocketId) {
    this.socketId = newSocketId;
    this.disconnected = false;
    this.disconnectedAt = null;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      color: this.color,
      activeTab: this.activeTab,
      disconnected: this.disconnected, // Include disconnected status
    };
  }
}

module.exports = User;
