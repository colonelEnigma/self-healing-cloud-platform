require("dotenv").config();
const startConsumer = require("./kafka/consumer");
const app = require("./app");
const initDb = require("./config/initdb");

const PORT = process.env.PORT || 3004;

const startServer = async () => {
  try {
    await initDb(); // ✅ wait for table creation

    await startConsumer();

    app.listen(PORT, () => {
      console.log(`Payment Service running on port ${PORT}`);
      console.log("Connecting to DB:", process.env.DB_NAME);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1); // exit if DB init fails
  }
};

startServer();
