const pool = require("./db");

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const initDb = async () => {
  let retries = 10;

  while (retries) {
    try {
      console.log("Connecting to DB:", process.env.DB_NAME);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS products (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          category VARCHAR(100),
          price NUMERIC(10,2) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      console.log("Database initialized (products table ready)");
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
