const pool = require("./db");

const initDb = async () => {
  try {
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
  } catch (err) {
    console.error("Search DB Init Error:", err.message);
  }
};

module.exports = initDb;
