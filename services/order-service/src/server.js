const express = require("express");
require("dotenv").config();

const initDb = require("./config/initdb");
const orderRoutes = require("./routes/orderRoutes");

const app = express();

app.use(express.json());

app.use("/api", orderRoutes);

const PORT = process.env.PORT || 3003;

const startServer = async () => {
  try {
    await initDb(); // ✅ wait for table creation

    app.listen(PORT, () => {
      console.log(`Order Service running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1); // exit if DB init fails
  }
};

startServer();
