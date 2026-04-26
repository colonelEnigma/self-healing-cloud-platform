const pool = require("../config/db");

const isRateLimited = async ({
  alertName,
  namespace,
  deployment,
  maxActionsPerWindow,
  windowMinutes,
}) => {
  const result = await pool.query(
    `
    SELECT COUNT(*)::int AS action_count
    FROM healing_actions
    WHERE alert_name = $1
      AND namespace = $2
      AND deployment = $3
      AND result IN ('success', 'failed')
      AND created_at >= NOW() - ($4::text || ' minutes')::interval
    `,
    [alertName, namespace, deployment, windowMinutes]
  );

  const actionCount = result.rows[0]?.action_count || 0;

  return {
    limited: actionCount >= maxActionsPerWindow,
    actionCount,
    maxActionsPerWindow,
    windowMinutes,
  };
};

module.exports = {
  isRateLimited,
};