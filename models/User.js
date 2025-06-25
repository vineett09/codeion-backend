class User {
  constructor(id, name, socketId) {
    this.id = id;
    this.name = name;
    this.socketId = socketId;
    this.cursor = { line: 0, ch: 0 };
    this.color = this.generateColor();
    this.activeTab = "main"; // Track user's active tab
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

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      color: this.color,
      activeTab: this.activeTab,
    };
  }
}

module.exports = User;
