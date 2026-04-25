const pool = require("../config/db");

const recordAction = async ({ alertName, namespace, deployment, action, result, reason }) => {
  try {
    await pool.query(
      `INSERT INTO healing_actions
       (alert_name, namespace, deployment, action, result, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [alertName, namespace, deployment, action, result, reason]
    );
  } catch (err) {
    console.error("Failed to record healing action:", err.message);
  }
};

module.exports = recordAction;
