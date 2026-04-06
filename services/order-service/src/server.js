const express = require("express");
require("dotenv").config();

const initDb = require("./config/initdb");
const orderRoutes = require("./routes/orderRoutes");

const app = express();

app.use(express.json());

initDb();

app.use("/api", orderRoutes);

const PORT = process.env.PORT || 3003;

app.listen(PORT, () => {
  console.log(`Order service running on port ${PORT}`);
});
