module.exports = {
  server: {
    port: process.env.PORT || 5000,
    cors: {
      origin: process.env.CLIENT_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
    },
  },

  room: {
    maxInactiveTime: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
    cleanupInterval: 60 * 60 * 1000, // 1 hour in milliseconds
  },

  user: {
    defaultColors: [
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
    ],
  },
};
