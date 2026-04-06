require("dotenv").config();
const express = require("express");

const initDb = require("./config/initdb");
const paymentRoutes = require("./routes/paymentRoutes");

const app = express();

app.use(express.json());

app.use("/api", paymentRoutes);

const PORT = process.env.PORT || 3004;

app.listen(PORT, async () => {
  console.log(`Payment service running on port ${PORT}`);
  await initDb();
});
