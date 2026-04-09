require("dotenv").config();

const app = require("./app"); // ✅ FIRST
const initDb = require("./config/initdb");

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await initDb(); // ✅ wait for table creation

    app.listen(PORT, () => {
      console.log(`Product Service running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1); // exit if DB init fails
  }
};

startServer();
