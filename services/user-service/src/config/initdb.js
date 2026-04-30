const pool = require("./db");

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const initDb = async () => {
  let retries = 10;

  while (retries) {
    try {
      console.log("Connecting to DB:", process.env.DB_NAME);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          name VARCHAR(255) NOT NULL,
          role VARCHAR(20) DEFAULT 'user',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user';
      `);

      await pool.query(`
        UPDATE users
        SET role = 'user'
        WHERE role IS NULL;
      `);

      console.log("Database initialized (users table ready)");
      return;
    } catch (err) {
      console.error("DB Init Error:", err.message);

      retries--;
      console.log(`Retries left: ${retries}`);

      await sleep(5000); // wait 5 sec before retry
    }
  }

  throw new Error("Could not connect to DB after retries");
};

module.exports = initDb;
