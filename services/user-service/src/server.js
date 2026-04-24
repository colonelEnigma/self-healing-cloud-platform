require("dotenv").config();

const app = require("./app");
const initDb = require("./config/initdb");

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await initDb(); // ✅ wait for table creation

    app.listen(PORT, () => {
      console.log(`User Service running on port ${PORT}`);
      console.log("Connecting to DB:", process.env.DB_NAME);
      console.log("Remove... this...JWT SECRET:", process.env.JWT_SECRET);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1); // exit if DB init fails
  }
};

startServer();
