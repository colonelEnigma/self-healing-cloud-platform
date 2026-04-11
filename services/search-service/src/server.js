const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const startConsumer = require("./kafka/consumer");
require("dotenv").config();
const searchRoutes = require("./routes/searchRoutes");
const initDb = require("./config/initdb");

const app = express();

// ✅ CORS
app.use(
  cors({
    origin: "http://localhost:3001", // your frontend
    credentials: true,
  }),
);

app.use(express.json());

// routes
app.use("/search", searchRoutes);

// 🔥 Create HTTP server (IMPORTANT)
const server = http.createServer(app);

// 🔥 Setup socket.io
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3001",
    methods: ["GET", "POST"],
  },
});

// 🔥 Optional: connection log (helps debugging)
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 5003;

const startServer = async () => {
  try {
    await initDb(); // DB ready

    // 🔥 Pass io to Kafka consumer
    await startConsumer(io);

    // 🔥 Start server (NOT app.listen)
    server.listen(PORT, () => {
      console.log(`Search Service running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start Search server:", err);
    process.exit(1);
  }
};

startServer();
