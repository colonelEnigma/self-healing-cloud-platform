require("dotenv").config();

const app = require("./app");
const initDb = require("./config/initdb");
const { runConsumer } = require("./kafka/consumer"); // 👈 ADD

const PORT = process.env.PORT || 3005;

const startServer = async () => {
  try {
    await initDb();

    // 👉 START KAFKA CONSUMER
    await runConsumer();

    app.listen(PORT, () => {
      console.log(`Product Service running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
};

startServer();