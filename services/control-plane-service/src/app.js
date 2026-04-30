const express = require("express");
const cors = require("cors");
const controlPlaneRoutes = require("./routes/controlPlaneRoutes");
const metricsMiddleware = require("./middleware/metricsMiddleware");
const { client } = require("./metrics/metrics");

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:3001",
    credentials: true,
  }),
);

app.use(express.json());
app.use(metricsMiddleware);

app.get("/health", (req, res) => {
  res.status(200).json({ status: "control-plane-service is running" });
});

app.get("/metrics", async (req, res) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});

app.use("/api/control-plane", controlPlaneRoutes);

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

module.exports = app;
