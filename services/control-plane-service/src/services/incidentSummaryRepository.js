const pool = require("../config/db");

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const createIncidentSummary = async ({
  executionId,
  service,
  scenarioId,
  startedAt,
  endedAt,
  symptom,
  probableCause,
  confidence,
  healerAction,
  outcome,
  timelineJson,
}) => {
  const query = `
    INSERT INTO incident_summaries (
      execution_id,
      service,
      scenario_id,
      started_at,
      ended_at,
      symptom,
      probable_cause,
      confidence,
      healer_action,
      outcome,
      timeline_json
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
    RETURNING
      id,
      execution_id,
      service,
      scenario_id,
      started_at,
      ended_at,
      symptom,
      probable_cause,
      confidence,
      healer_action,
      outcome,
      timeline_json,
      created_at,
      updated_at
  `;

  const values = [
    executionId,
    service,
    scenarioId,
    startedAt,
    endedAt,
    symptom || null,
    probableCause || null,
    confidence ?? null,
    healerAction || null,
    outcome || null,
    JSON.stringify(timelineJson || []),
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
};

const updateIncidentSummaryByExecutionId = async ({
  executionId,
  endedAt,
  symptom,
  probableCause,
  confidence,
  healerAction,
  outcome,
  timelineJson,
}) => {
  const query = `
    UPDATE incident_summaries
    SET
      ended_at = COALESCE($2, ended_at),
      symptom = $3,
      probable_cause = $4,
      confidence = $5,
      healer_action = $6,
      outcome = $7,
      timeline_json = $8::jsonb,
      updated_at = NOW()
    WHERE execution_id = $1
    RETURNING
      id,
      execution_id,
      service,
      scenario_id,
      started_at,
      ended_at,
      symptom,
      probable_cause,
      confidence,
      healer_action,
      outcome,
      timeline_json,
      created_at,
      updated_at
  `;

  const values = [
    executionId,
    endedAt || null,
    symptom || null,
    probableCause || null,
    confidence ?? null,
    healerAction || null,
    outcome || null,
    JSON.stringify(timelineJson || []),
  ];

  const result = await pool.query(query, values);
  return result.rows[0] || null;
};

const upsertIncidentSummaryByExecutionId = async (payload) => {
  const existing = await getIncidentSummaryByExecutionId(payload.executionId);
  if (!existing) {
    return createIncidentSummary(payload);
  }

  return updateIncidentSummaryByExecutionId(payload);
};

const listIncidentSummariesByService = async ({ service, limit = 20 }) => {
  const safeLimit = Math.min(parsePositiveInteger(limit, 20), 100);
  const result = await pool.query(
    `
      SELECT
        id,
        execution_id,
        service,
        scenario_id,
        started_at,
        ended_at,
        symptom,
        probable_cause,
        confidence,
        healer_action,
        outcome,
        timeline_json,
        created_at,
        updated_at
      FROM incident_summaries
      WHERE service = $1
      ORDER BY started_at DESC, id DESC
      LIMIT $2
    `,
    [service, safeLimit],
  );

  return result.rows;
};

const getIncidentSummaryByExecutionId = async (executionId) => {
  const result = await pool.query(
    `
      SELECT
        id,
        execution_id,
        service,
        scenario_id,
        started_at,
        ended_at,
        symptom,
        probable_cause,
        confidence,
        healer_action,
        outcome,
        timeline_json,
        created_at,
        updated_at
      FROM incident_summaries
      WHERE execution_id = $1
      LIMIT 1
    `,
    [executionId],
  );

  return result.rows[0] || null;
};

module.exports = {
  createIncidentSummary,
  updateIncidentSummaryByExecutionId,
  upsertIncidentSummaryByExecutionId,
  listIncidentSummariesByService,
  getIncidentSummaryByExecutionId,
};
