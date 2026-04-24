const express = require("express");
const cors = require("cors");
const userRoutes = require("./routes/userRoutes");

const { client } = require("./metrics/userMetrics");
const metricsMiddleware = require("./middleware/metricsMiddleware");

const app = express();

app.use(
  cors({
    origin: "http://localhost:3001",
    credentials: true,
  }),
);

app.use(express.json());

app.use(metricsMiddleware);

// ✅ Metrics endpoint
app.get("/metrics", async (req, res) => {
  console.log("User metrics hit!");
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});

// routes
app.use("/api/users", userRoutes);

// health check
app.get("/health", (req, res) => {
  res.status(200).json({ status: "user-service is running" });
});

module.exports = app;
