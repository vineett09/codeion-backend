module.exports = {
  server: {
    port: process.env.PORT || 5000,
    cors: {
      origin: process.env.CLIENT_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
    },
  },
  gemini: {
    baseURL: `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent`,
  },
  judge0: {
    apiKey: process.env.JUDGE0_API_KEY || "YOUR_JUDGE0_API_KEY",
    apiHost: "judge0-ce.p.rapidapi.com",
    baseURL: "https://judge0-ce.p.rapidapi.com",
  },
  appSettings: {
    maxUsersPerRoom: 5, // Set max users to 5
    maxDisconnectTime: 10 * 60 * 1000, // 10 minutes
    maxInactiveRoomTime: 2 * 60 * 60 * 1000, // 2 hours
    cleanupInterval: 30 * 1000, // 30 seconds
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
