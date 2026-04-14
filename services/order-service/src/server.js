const express = require("express");
const cors = require("cors");
const { connectProducer } = require("./kafka/producer");
require("dotenv").config();

const initDb = require("./config/initdb");
const orderRoutes = require("./routes/orderRoutes");
const { client } = require("./metrics/metrics");
const metricsMiddleware = require("./middleware/metricsMiddleware");
const globalLimiter = require("./middleware/rateLimiter");

const app = express();

// ✅ Add CORS middleware
app.use(
  cors({
    origin: "http://localhost:3001", // allow your React app
    credentials: true, // allow cookies/authorization headers if needed
  }),
);

app.use(express.json());

app.use("/api", orderRoutes);

// add middleware
app.use(metricsMiddleware);
app.use(globalLimiter);


// expose metrics endpoint
app.get("/metrics", async (req, res) => {
  console.log("Order metrics hit!");
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});


const PORT = process.env.PORT || 3003;

const startServer = async () => {
  try {
    await initDb(); // ✅ wait for table creation
    await connectProducer();

    app.listen(PORT, () => {
      console.log(`Order Service running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
};

startServer();
