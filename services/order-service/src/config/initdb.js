const pool = require("./db");

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const initDb = async () => {
  let retries = 10;

  while (retries) {
    try {
      console.log("Connecting to DB:", process.env.DB_NAME);

      // Orders table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS orders (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          status VARCHAR(50) DEFAULT 'CREATED',
          total_amount NUMERIC(10,2) DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Order Items table (ADD THIS)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS order_items (
          id SERIAL PRIMARY KEY,
          order_id INTEGER NOT NULL,
          product_id INTEGER NOT NULL,
          quantity INTEGER NOT NULL CHECK (quantity > 0),
          price NUMERIC(10,2) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Indexes
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_orders_user_id 
        ON orders(user_id);
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_order_items_order_id 
        ON order_items(order_id);
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_order_items_product_id 
        ON order_items(product_id);
      `);
      console.log("Database initialized (Order table ready)");
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
