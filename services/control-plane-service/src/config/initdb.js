const { Pool } = require("pg");
const pool = require("./db");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const quoteIdentifier = (value) => `"${String(value).replace(/"/g, "\"\"")}"`;

const ensureControlPlaneDatabaseExists = async () => {
  const targetDatabase = process.env.DB_NAME;
  const bootstrapDatabase = process.env.DB_BOOTSTRAP_DB || "postgres";

  if (!targetDatabase) {
    throw new Error("DB_NAME is required for control-plane-service");
  }

  const bootstrapPool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: bootstrapDatabase,
  });

  try {
    const exists = await bootstrapPool.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [targetDatabase],
    );

    if (exists.rowCount === 0) {
      await bootstrapPool.query(
        `CREATE DATABASE ${quoteIdentifier(targetDatabase)}`,
      );
      console.log(`Created database ${targetDatabase}`);
    }
  } catch (err) {
    if (err.code !== "42P04") {
      throw err;
    }
  } finally {
    await bootstrapPool.end().catch(() => {});
  }
};

const initDb = async () => {
  let retries = 10;

  while (retries > 0) {
    try {
      await ensureControlPlaneDatabaseExists();

      await pool.query(`
        CREATE TABLE IF NOT EXISTS control_plane_actions (
          id SERIAL PRIMARY KEY,
          user_id INTEGER,
          user_email VARCHAR(255),
          namespace VARCHAR(100) NOT NULL,
          service VARCHAR(150) NOT NULL,
          action VARCHAR(100) NOT NULL,
          requested_replicas INTEGER,
          previous_replicas INTEGER,
          result VARCHAR(50) NOT NULL,
          reason TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_control_plane_actions_created_at
        ON control_plane_actions (created_at DESC);
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_control_plane_actions_service
        ON control_plane_actions (service);
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS chaos_scenario_executions (
          id SERIAL PRIMARY KEY,
          scenario_id VARCHAR(120) NOT NULL,
          service VARCHAR(150) NOT NULL,
          requested_by VARCHAR(255),
          reason TEXT,
          started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMP NOT NULL,
          reverted_at TIMESTAMP,
          revert_mode VARCHAR(20),
          status VARCHAR(30) NOT NULL DEFAULT 'active',
          result VARCHAR(50) NOT NULL DEFAULT 'running',
          metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
        );
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_chaos_scenario_executions_status_expires
        ON chaos_scenario_executions (status, expires_at);
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_chaos_scenario_executions_service
        ON chaos_scenario_executions (service);
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_chaos_scenario_executions_scenario
        ON chaos_scenario_executions (scenario_id);
      `);

      console.log("Control plane audit and chaos tables ready");
      return;
    } catch (err) {
      retries -= 1;
      console.error("Control plane DB init error:", err.message);

      if (retries <= 0) {
        break;
      }

      console.log(`Control plane DB init retries left: ${retries}`);
      await sleep(5000);
    }
  }

  throw new Error("Could not initialize control plane database");
};

module.exports = initDb;
