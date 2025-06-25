const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");

// Import configurations and routes
const config = require("./config/config");
const roomRoutes = require("./routes/RoomRoutes");
const handleConnection = require("./handlers/socketHandlers");

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Setup Socket.IO with CORS
const io = socketIo(server, {
  cors: config.server.cors,
});

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/api", roomRoutes);
// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// Socket.IO connection handling
io.on("connection", (socket) => {
  handleConnection(io, socket);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
