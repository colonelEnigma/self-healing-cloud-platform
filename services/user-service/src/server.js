require("dotenv").config();

const app = require("./app");
const initDb = require("./config/initdb");

const PORT = process.env.PORT || 3000;

initDb();       // initilaize DB

app.listen(PORT, () => {
    console.log(`User Service running on port ${PORT}`);
});