const pool = require("../config/db");

const isCircuitOpen = async ({
  alertName,
  namespace,
  deployment,
  failureThreshold,
  windowMinutes,
}) => {
  const result = await pool.query(
    `
    SELECT COUNT(*)::int AS failure_count
    FROM healing_actions
    WHERE alert_name = $1
      AND namespace = $2
      AND deployment = $3
      AND result IN ('error', 'failed')
      AND created_at >= NOW() - ($4::text || ' minutes')::interval
    `,
    [alertName, namespace, deployment, windowMinutes]
  );

  const failureCount = result.rows[0]?.failure_count || 0;

  return {
    open: failureCount >= failureThreshold,
    failureCount,
    failureThreshold,
    windowMinutes,
  };
};

module.exports = {
  isCircuitOpen,
};