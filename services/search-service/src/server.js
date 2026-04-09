const express = require("express");
require("dotenv").config();

const searchRoutes = require("./routes/searchRoutes");

const app = express();
app.use(express.json());

app.use("/search", searchRoutes);

const PORT = process.env.PORT || 5003;

app.listen(PORT, () => {
  console.log(`Search service running on port ${PORT}`);
});
