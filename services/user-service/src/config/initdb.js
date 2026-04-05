const pool = require("./db");

const initDb = async () => {
    try {
        await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL
      );
    `);

        console.log("Database initialized (users table ready)");
    } catch (err) {
        console.error("DB Init Error:", err.message);
    }
};

module.exports = initDb;