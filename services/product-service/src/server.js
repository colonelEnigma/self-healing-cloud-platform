require("dotenv").config();

const app = require("./app"); // ✅ FIRST
const initDb = require("./config/initdb");

const PORT = process.env.PORT || 3000;

initDb();

app.listen(PORT, () => {
  console.log(`Product Service running on port ${PORT}`);
});
