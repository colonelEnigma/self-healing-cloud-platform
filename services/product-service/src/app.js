const express = require("express");
const cors = require("cors");
const productRoutes = require("./routes/productRoutes");

const app = express();

app.use(
  cors({
    origin: "http://localhost:3001",
    credentials: true,
  }),
);

app.use(express.json());

// routes
app.use("/api", productRoutes);

// health check
app.get("/health", (req, res) => {
  res.status(200).json({ status: "product-service is running" });
});

module.exports = app;
