require("dotenv").config();

const app = require("./app");
const initDb = require("./config/initdb");
const {
  startChaosAutoRevertScheduler,
} = require("./services/chaosSchedulerService");

const PORT = process.env.PORT || 7100;

if (!process.env.JWT_SECRET) {
  console.error("JWT_SECRET is required for control-plane-service");
  process.exit(1);
}

const startServer = async () => {
  try {
    await initDb();
    startChaosAutoRevertScheduler();

    app.listen(PORT, () => {
      console.log(`Control Plane Service running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start control-plane-service:", err.message);
    process.exit(1);
  }
};

startServer();
