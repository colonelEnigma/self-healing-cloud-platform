const express = require("express");
const cors = require("cors");
const productRoutes = require("./routes/productRoutes");
const metricsMiddleware = require("./middleware/metricsMiddleware");
const { client } = require("./metrics/metrics");

const app = express();

app.use(
  cors({
    origin: "http://localhost:3001",
    credentials: true,
  }),
);

app.use(express.json());

// ✅ Metrics middleware (global)
app.use(metricsMiddleware);

// ✅ Metrics endpoint
app.get("/metrics", async (req, res) => {
  console.log("payment metrics hit!!");
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});

// routes
app.use("/api", productRoutes);

// health check
app.get("/health", (req, res) => {
  res.status(200).json({ status: "product-service is running" });
});

module.exports = app;
