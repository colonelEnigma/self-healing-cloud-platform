const pool = require("./db");

const initDb = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS healing_actions (
      id SERIAL PRIMARY KEY,
      alert_name VARCHAR(100) NOT NULL,
      namespace VARCHAR(100) NOT NULL,
      deployment VARCHAR(150) NOT NULL,
      action VARCHAR(100) NOT NULL,
      result VARCHAR(50) NOT NULL,
      reason TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log("Healing actions table ready");
};

module.exports = initDb;