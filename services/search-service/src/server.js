const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const startConsumer = require("./kafka/consumer");
require("dotenv").config();
const searchRoutes = require("./routes/searchRoutes");
const initDb = require("./config/initdb");

// 🔥 Metrics
const { client } = require("./metrics/metrics");
const metricsMiddleware = require("./middleware/metricsMiddleware");

const app = express();

// ✅ CORS
app.use(
  cors({
    origin: "http://localhost:3001",
    credentials: true,
  }),
);

app.use(express.json());

// ✅ Metrics middleware
app.use(metricsMiddleware);

// ✅ Metrics endpoint
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});

// routes
app.use("/api/search", searchRoutes);

// 🔥 HTTP server
const server = http.createServer(app);

// 🔥 Socket.IO
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3001",
    methods: ["GET", "POST"],
  },
});

// 🔥 Socket debug
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 5003;

const startServer = async () => {
  try {
    await initDb();
    console.log("Search DB initialized");

    // 🔥 Start server FIRST (important in K8s)
    server.listen(PORT, () => {
      console.log(`Search Service running on port ${PORT}`);
    });

    // 🔥 Start Kafka consumer (non-blocking + delayed)
    setTimeout(() => {
      startConsumer(io).catch((err) => {
        console.error("Kafka consumer failed:", err.message);
      });
    }, 5000); // delay helps Kafka stabilize
  } catch (err) {
    console.error("Failed to start Search server:", err);
    process.exit(1);
  }
};

startServer();
