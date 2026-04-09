require("dotenv").config();
const express = require("express");

const initDb = require("./config/initdb");
const paymentRoutes = require("./routes/paymentRoutes");

const app = express();
const PORT = process.env.PORT || 3004;

app.use(express.json());

app.use("/api", paymentRoutes);

const startServer = async () => {
  try {
    await initDb(); // ✅ wait for table creation

    app.listen(PORT, () => {
      console.log(`Payment Service running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1); // exit if DB init fails
  }
};

startServer();
