const app = require("./app");
const initDb = require("./config/initdb");

const PORT = process.env.PORT || 7000;

app.listen(PORT, async () => {
  await initDb();
  console.log(`Healer service running on port ${PORT} 🚀`);
});