const pool = require("../config/db");

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const createExecution = async ({
  scenarioId,
  service,
  requestedBy,
  reason,
  startedAt,
  expiresAt,
  metadataJson,
}) => {
  const query = `
    INSERT INTO chaos_scenario_executions (
      scenario_id,
      service,
      requested_by,
      reason,
      started_at,
      expires_at,
      status,
      result,
      metadata_json
    )
    VALUES ($1, $2, $3, $4, $5, $6, 'active', 'running', $7::jsonb)
    RETURNING
      id,
      scenario_id,
      service,
      requested_by,
      reason,
      started_at,
      expires_at,
      reverted_at,
      revert_mode,
      status,
      result,
      metadata_json
  `;

  const values = [
    scenarioId,
    service,
    requestedBy || null,
    reason || null,
    startedAt,
    expiresAt,
    JSON.stringify(metadataJson || {}),
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
};

const countActiveExecutions = async () => {
  const result = await pool.query(`
    SELECT COUNT(*)::int AS total
    FROM chaos_scenario_executions
    WHERE status = 'active'
  `);

  return result.rows[0]?.total || 0;
};

const listActiveExecutions = async ({ limit = 100 } = {}) => {
  const safeLimit = Math.min(parsePositiveInteger(limit, 100), 500);
  const result = await pool.query(
    `
      SELECT
        id,
        scenario_id,
        service,
        requested_by,
        reason,
        started_at,
        expires_at,
        reverted_at,
        revert_mode,
        status,
        result,
        metadata_json
      FROM chaos_scenario_executions
      WHERE status = 'active'
      ORDER BY started_at ASC
      LIMIT $1
    `,
    [safeLimit],
  );

  return result.rows;
};

const findActiveExecutionByService = async (service) => {
  const result = await pool.query(
    `
      SELECT
        id,
        scenario_id,
        service,
        requested_by,
        reason,
        started_at,
        expires_at,
        reverted_at,
        revert_mode,
        status,
        result,
        metadata_json
      FROM chaos_scenario_executions
      WHERE status = 'active' AND service = $1
      ORDER BY started_at DESC
      LIMIT 1
    `,
    [service],
  );

  return result.rows[0] || null;
};

const findExecutionById = async (id) => {
  const result = await pool.query(
    `
      SELECT
        id,
        scenario_id,
        service,
        requested_by,
        reason,
        started_at,
        expires_at,
        reverted_at,
        revert_mode,
        status,
        result,
        metadata_json
      FROM chaos_scenario_executions
      WHERE id = $1
      LIMIT 1
    `,
    [id],
  );

  return result.rows[0] || null;
};

const findExecutionForManualRevert = async ({ executionId, scenarioId, service }) => {
  if (executionId) {
    return findExecutionById(executionId);
  }

  if (!scenarioId || !service) {
    return null;
  }

  const result = await pool.query(
    `
      SELECT
        id,
        scenario_id,
        service,
        requested_by,
        reason,
        started_at,
        expires_at,
        reverted_at,
        revert_mode,
        status,
        result,
        metadata_json
      FROM chaos_scenario_executions
      WHERE scenario_id = $1 AND service = $2
      ORDER BY started_at DESC
      LIMIT 1
    `,
    [scenarioId, service],
  );

  return result.rows[0] || null;
};

const listDueAutoRevertExecutions = async ({ limit = 20 } = {}) => {
  const safeLimit = Math.min(parsePositiveInteger(limit, 20), 200);
  const result = await pool.query(
    `
      SELECT
        id,
        scenario_id,
        service,
        requested_by,
        reason,
        started_at,
        expires_at,
        reverted_at,
        revert_mode,
        status,
        result,
        metadata_json
      FROM chaos_scenario_executions
      WHERE status = 'active'
        AND expires_at <= NOW()
      ORDER BY expires_at ASC
      LIMIT $1
    `,
    [safeLimit],
  );

  return result.rows;
};

const markExecutionReverted = async ({
  id,
  revertMode,
  result,
  metadataJson,
}) => {
  const updateResult = await pool.query(
    `
      UPDATE chaos_scenario_executions
      SET
        reverted_at = NOW(),
        revert_mode = $2,
        status = 'reverted',
        result = $3,
        metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $4::jsonb
      WHERE id = $1
        AND status = 'active'
      RETURNING
        id,
        scenario_id,
        service,
        requested_by,
        reason,
        started_at,
        expires_at,
        reverted_at,
        revert_mode,
        status,
        result,
        metadata_json
    `,
    [id, revertMode, result, JSON.stringify(metadataJson || {})],
  );

  if (updateResult.rows[0]) {
    return updateResult.rows[0];
  }

  return findExecutionById(id);
};

module.exports = {
  createExecution,
  countActiveExecutions,
  listActiveExecutions,
  findActiveExecutionByService,
  findExecutionById,
  findExecutionForManualRevert,
  listDueAutoRevertExecutions,
  markExecutionReverted,
};
