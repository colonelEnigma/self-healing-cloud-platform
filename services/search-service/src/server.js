const express = require("express");
const cors = require("cors");
const startConsumer = require("./kafka/consumer");
require("dotenv").config();
const searchRoutes = require("./routes/searchRoutes");

const initDb = require("./config/initdb");

const app = express();

// ✅ Add CORS middleware
app.use(
  cors({
    origin: "http://localhost:3001", // allow your React app
    credentials: true, // allow cookies/authorization headers if needed
  }),
);

app.use(express.json());

// routes
app.use("/search", searchRoutes);

const PORT = process.env.PORT || 5003;

const startServer = async () => {
  try {
    await initDb(); // ✅ wait for table creation

    await startConsumer();

    app.listen(PORT, () => {
      console.log(`Search Service running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start Search server:", err);
    process.exit(1);
  }
};

startServer();
