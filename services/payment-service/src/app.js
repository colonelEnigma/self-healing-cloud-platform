const express = require("express");
const cors = require("cors");
const paymentRoutes = require("./routes/paymentRoutes");

const { client } = require("./metrics/metrics");
const metricsMiddleware = require("./middleware/metricsMiddleware");

const app = express();

app.use(
  cors({
    origin: "http://localhost:3001",
    credentials: true,
  })
);

app.use(express.json());

// Health first
app.get("/health", (req, res) => {
  res.status(200).json({ status: "payment-service is running" });
});

// Metrics endpoint
app.get("/metrics", async (req, res) => {
  try {
    res.set("Content-Type", client.register.contentType);
    res.end(await client.register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
});

// Apply metrics middleware after /health and /metrics
app.use(metricsMiddleware);

// API routes
app.use("/api", paymentRoutes);

module.exports = app;