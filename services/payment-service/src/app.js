const express = require("express");
const cors = require("cors");
const paymentRoutes = require("./routes/paymentRoutes");

const app = express();

app.use(
  cors({
    origin: "http://localhost:3001",
    credentials: true,
  }),
);

app.use(express.json());

// routes
app.use("/api", paymentRoutes);

// health check
app.get("/health", (req, res) => {
  res.status(200).json({ status: "payment-service is running" });
});

module.exports = app;
