const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

// In-memory storage (use Redis or MongoDB in production)
const rooms = new Map();
const users = new Map();

// Room structure
class Room {
  constructor(id, name, language, isPrivate, createdBy) {
    this.id = id;
    this.name = name;
    this.language = language;
    this.isPrivate = isPrivate;
    this.createdBy = createdBy;
    this.users = [];
    this.tabs = [
      {
        id: "main",
        name: "Main",
        code: this.getDefaultCode(language),
        language: language,
      },
    ];
    this.activeTab = "main";
    this.createdAt = new Date();
    this.lastActivity = new Date();
  }

  getDefaultCode(language) {
    const templates = {
      javascript:
        '// Welcome to the collaborative editor!\nconsole.log("Hello, World!");',
      typescript:
        '// Welcome to the collaborative editor!\nconst message: string = "Hello, World!";\nconsole.log(message);',
      python: '# Welcome to the collaborative editor!\nprint("Hello, World!")',
      java: '// Welcome to the collaborative editor!\npublic class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}',
      cpp: '// Welcome to the collaborative editor!\n#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello, World!" << endl;\n    return 0;\n}',
      react:
        '// Welcome to the collaborative editor!\nimport React from "react";\n\nfunction App() {\n  return (\n    <div>\n      <h1>Hello, World!</h1>\n    </div>\n  );\n}\n\nexport default App;',
      nodejs:
        '// Welcome to the collaborative editor!\nconst express = require("express");\nconst app = express();\n\napp.get("/", (req, res) => {\n  res.send("Hello, World!");\n});\n\napp.listen(3000, () => {\n  console.log("Server running on port 3000");\n});',
      html: "<!-- Welcome to the collaborative editor! -->\n<!DOCTYPE html>\n<html>\n<head>\n    <title>Hello World</title>\n</head>\n<body>\n    <h1>Hello, World!</h1>\n</body>\n</html>",
    };
    return templates[language] || "// Welcome to the collaborative editor!";
  }

  addUser(user) {
    this.users.push(user);
    this.lastActivity = new Date();
  }

  removeUser(userId) {
    this.users = this.users.filter((user) => user.id !== userId);
    this.lastActivity = new Date();
  }

  addTab(tab) {
    this.tabs.push(tab);
    this.lastActivity = new Date();
  }

  // Fixed: Update specific tab's code
  updateTabCode(tabId, code) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (tab) {
      tab.code = code;
      this.lastActivity = new Date();
      return true;
    }
    return false;
  }

  // Fixed: Update specific tab's language
  updateTabLanguage(tabId, language) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (tab) {
      tab.language = language;
      this.lastActivity = new Date();
      return true;
    }
    return false;
  }

  // New: Get specific tab
  getTab(tabId) {
    return this.tabs.find((t) => t.id === tabId);
  }

  // New: Delete tab
  deleteTab(tabId) {
    if (this.tabs.length <= 1) return false; // Don't delete last tab
    const index = this.tabs.findIndex((t) => t.id === tabId);
    if (index !== -1) {
      this.tabs.splice(index, 1);
      // If active tab was deleted, switch to first tab
      if (this.activeTab === tabId) {
        this.activeTab = this.tabs[0].id;
      }
      this.lastActivity = new Date();
      return true;
    }
    return false;
  }
}

// User structure
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
}

// REST API endpoints
app.post("/api/rooms", (req, res) => {
  const { roomId, roomName, language, isPrivate, userName } = req.body;

  if (rooms.has(roomId)) {
    return res.status(400).json({ error: "Room already exists" });
  }

  const room = new Room(roomId, roomName, language, isPrivate, userName);
  rooms.set(roomId, room);

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
});

app.get("/api/rooms/:roomId", (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);

  if (!room) {
    return res.status(404).json({ error: "Room not found" });
  }

  res.json({
    id: room.id,
    name: room.name,
    language: room.language,
    isPrivate: room.isPrivate,
    userCount: room.users.length,
    users: room.users.map((user) => ({
      id: user.id,
      name: user.name,
      color: user.color,
    })),
  });
});

app.get("/api/rooms", (req, res) => {
  const publicRooms = Array.from(rooms.values())
    .filter((room) => !room.isPrivate)
    .map((room) => ({
      id: room.id,
      name: room.name,
      language: room.language,
      userCount: room.users.length,
      lastActivity: room.lastActivity,
    }));

  res.json(publicRooms);
});

// WebSocket handling
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join-room", async (data) => {
    const { roomId, userName } = data;
    const room = rooms.get(roomId);

    if (!room) {
      socket.emit("error", { message: "Room not found" });
      return;
    }

    // Create user
    const user = new User(uuidv4(), userName, socket.id);
    users.set(socket.id, user);

    // Add user to room
    room.addUser(user);
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
      user: {
        id: user.id,
        name: user.name,
        color: user.color,
      },
      users: room.users.map((u) => ({
        id: u.id,
        name: u.name,
        color: u.color,
        activeTab: u.activeTab,
      })),
    });

    // Notify other users
    socket.to(roomId).emit("user-joined", {
      user: {
        id: user.id,
        name: user.name,
        color: user.color,
        activeTab: user.activeTab,
      },
    });

    console.log(`${userName} joined room ${roomId}`);
  });

  // Fixed: Handle code changes for specific tabs
  socket.on("code-change", (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const { roomId, code, tabId } = data;
    const room = rooms.get(roomId);

    if (!room || !tabId) return;

    // Update the specific tab's code
    const success = room.updateTabCode(tabId, code);
    if (!success) return;

    // Broadcast to other users in the room (only for the specific tab)
    socket.to(roomId).emit("code-update", {
      code,
      tabId,
      userId: user.id,
      userName: user.name,
    });
  });

  socket.on("cursor-change", (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const { roomId, cursor, tabId } = data;
    user.cursor = cursor;

    // Broadcast cursor position to other users (include tab info)
    socket.to(roomId).emit("cursor-update", {
      userId: user.id,
      userName: user.name,
      cursor,
      color: user.color,
      tabId: tabId || user.activeTab,
    });
  });

  socket.on("create-tab", (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const { roomId, tab } = data;
    const room = rooms.get(roomId);

    if (!room) return;

    room.addTab(tab);

    // Broadcast to all users in room
    io.to(roomId).emit("tab-created", {
      tab,
      userId: user.id,
      userName: user.name,
    });
  });

  // Fixed: Handle tab switching per user
  socket.on("switch-tab", (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const { roomId, tabId } = data;
    const room = rooms.get(roomId);

    if (!room) return;

    // Update user's active tab
    user.activeTab = tabId;

    // Send the specific tab's content to the user
    const tab = room.getTab(tabId);
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

  // Fixed: Handle language changes for specific tabs
  socket.on("language-change", (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const { roomId, language, tabId } = data;
    const room = rooms.get(roomId);

    if (!room || !tabId) return;

    const success = room.updateTabLanguage(tabId, language);
    if (!success) return;

    // Broadcast to other users in room
    socket.to(roomId).emit("language-changed", {
      language,
      tabId,
      userId: user.id,
      userName: user.name,
    });
  });

  socket.on("chat-message", (data) => {
    const user = users.get(socket.id);
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

  socket.on("disconnect", () => {
    const user = users.get(socket.id);
    if (!user) return;

    // Find room and remove user
    for (const [roomId, room] of rooms.entries()) {
      const userIndex = room.users.findIndex((u) => u.socketId === socket.id);
      if (userIndex !== -1) {
        room.removeUser(user.id);

        // Notify other users
        socket.to(roomId).emit("user-left", {
          userId: user.id,
          userName: user.name,
        });

        // Clean up empty rooms (optional)
        if (room.users.length === 0) {
          rooms.delete(roomId);
          console.log(`Room ${roomId} deleted (empty)`);
        }

        break;
      }
    }

    users.delete(socket.id);
    console.log("User disconnected:", socket.id);
  });
});

// Cleanup inactive rooms (run every hour)
setInterval(() => {
  const now = new Date();
  const maxInactiveTime = 24 * 60 * 60 * 1000; // 24 hours

  for (const [roomId, room] of rooms.entries()) {
    if (now - room.lastActivity > maxInactiveTime && room.users.length === 0) {
      rooms.delete(roomId);
      console.log(`Cleaned up inactive room: ${roomId}`);
    }
  }
}, 60 * 60 * 1000);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
