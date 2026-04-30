require("dotenv").config();

const app = require("./app");
const initDb = require("./config/initdb");
const { runConsumer } = require("./kafka/consumer");

const PORT = process.env.PORT || 3005;

const startServer = async () => {
  try {
    await initDb();

    app.listen(PORT, () => {
      console.log(`Product Service running on port ${PORT}`);
    });

    // Start Kafka consumer after HTTP is available so product reads stay usable
    // while Kafka is starting or temporarily unavailable in local development.
    setTimeout(() => {
      runConsumer().catch((err) => {
        console.error("Product Kafka consumer failed:", err.message);
      });
    }, 5000);
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
};

startServer();
