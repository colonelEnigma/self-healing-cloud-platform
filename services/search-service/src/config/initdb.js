const pool = require("./db");

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const initDb = async () => {
  let retries = 10;

  while (retries) {
    try {
      console.log("Connecting to DB:", process.env.DB_NAME);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS orders_search (
          id SERIAL PRIMARY KEY,
          order_id INT UNIQUE,
          user_id INT,
          total_amount NUMERIC(10,2),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      console.log("Search DB initialized (orders_search ready)");
      return;
    } catch (err) {
      console.error("Search DB Init Error:", err.message);
      retries--;
      console.log(`Retries left: ${retries}`);
      await sleep(3000);
    }
  }

  throw new Error("Could not connect to DB after retries");
};

module.exports = initDb;