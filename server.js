require("dotenv").config();

const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const logger = require("./utils/logger");
const dsaRoomRoutes = require("./routes/dsaRooms");
const handleDSAConnection = require("./handlers/handleDSAConnection");
const config = require("./config/config");
const roomRoutes = require("./routes/RoomRoutes");
const handleConnection = require("./handlers/socketHandlers");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: config.server.cors,
});

app.use(cors());
app.use(express.json());

app.use("/api", roomRoutes);
app.use("/api/dsa-rooms", dsaRoomRoutes);

app.get("/api/health", (req, res) => {
  const healthData = {
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  };

  logger.log(`Health check requested at ${healthData.timestamp}`);
  res.status(200).json(healthData);
});

// === Setup namespaces ===
const mainNamespace = io.of("/main");
const dsaNamespace = io.of("/dsa");

mainNamespace.on("connection", (socket) => {
  logger.log("New client connected to MAIN namespace:", socket.id);
  handleConnection(mainNamespace, socket);

  socket.on("disconnect", (reason) => {
    logger.log("Client disconnected from MAIN:", socket.id, "Reason:", reason);
  });
});

dsaNamespace.on("connection", (socket) => {
  logger.log("New client connected to DSA namespace:", socket.id);
  handleDSAConnection(dsaNamespace, socket);

  socket.on("disconnect", (reason) => {
    logger.log("Client disconnected from DSA:", socket.id, "Reason:", reason);
  });
});

app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  logger.log(`Server running on port ${PORT}`);
});
