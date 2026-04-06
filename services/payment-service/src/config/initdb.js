const pool = require("./db");

const initDb = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL UNIQUE,
        amount NUMERIC(10,2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_order_id
      ON payments(order_id);
    `);

    console.log("Payments table ready");
  } catch (err) {
    console.error("DB Init Error:", err.message);
  }
};

module.exports = initDb;
