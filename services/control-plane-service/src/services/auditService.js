const pool = require("../config/db");

const recordControlPlaneAction = async ({
  userId,
  userEmail,
  namespace,
  service,
  action,
  requestedReplicas,
  previousReplicas,
  result,
  reason,
}) => {
  const query = `
    INSERT INTO control_plane_actions (
      user_id,
      user_email,
      namespace,
      service,
      action,
      requested_replicas,
      previous_replicas,
      result,
      reason
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id, created_at
  `;

  const values = [
    userId || null,
    userEmail || null,
    namespace,
    service,
    action,
    requestedReplicas ?? null,
    previousReplicas ?? null,
    result,
    reason || null,
  ];

  const record = await pool.query(query, values);
  return record.rows[0];
};

const listControlPlaneActions = async ({
  page = 1,
  limit = 20,
  service,
  result,
  from,
  to,
  sort = "desc",
}) => {
  const safePage = Math.max(Number.parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 100);
  const offset = (safePage - 1) * safeLimit;
  const safeSort = sort === "asc" ? "ASC" : "DESC";

  const conditions = [];
  const values = [];

  if (service) {
    values.push(service);
    conditions.push(`service = $${values.length}`);
  }

  if (result) {
    values.push(result);
    conditions.push(`result = $${values.length}`);
  }

  if (from) {
    values.push(from);
    conditions.push(`created_at >= $${values.length}`);
  }

  if (to) {
    values.push(to);
    conditions.push(`created_at <= $${values.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const countQuery = `SELECT COUNT(*)::int AS total FROM control_plane_actions ${whereClause}`;
  const countResult = await pool.query(countQuery, values);

  const dataValues = [...values, safeLimit, offset];
  const dataQuery = `
    SELECT
      id,
      user_id,
      user_email,
      namespace,
      service,
      action,
      requested_replicas,
      previous_replicas,
      result,
      reason,
      created_at
    FROM control_plane_actions
    ${whereClause}
    ORDER BY created_at ${safeSort}
    LIMIT $${dataValues.length - 1} OFFSET $${dataValues.length}
  `;

  const dataResult = await pool.query(dataQuery, dataValues);
  const total = countResult.rows[0]?.total || 0;

  return {
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: Math.ceil(total / safeLimit),
    sort: safeSort.toLowerCase(),
    count: dataResult.rows.length,
    actions: dataResult.rows,
  };
};

module.exports = {
  recordControlPlaneAction,
  listControlPlaneActions,
};
