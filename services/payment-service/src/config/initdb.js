const pool = require("./db");

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const initDb = async () => {
  let retries = 10;

  while (retries) {
    try {
      console.log("Connecting to DB:", process.env.DB_NAME);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS payments (
          id SERIAL PRIMARY KEY,
          order_id INTEGER NOT NULL UNIQUE,
          user_id VARCHAR(255) NOT NULL,
          amount NUMERIC(10,2) NOT NULL,
          status VARCHAR(50) DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      console.log("Database initialized (payments table ready)");
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
