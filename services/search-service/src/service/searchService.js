const pool = require("../config/db");

const searchProducts = async ({
  query,
  category,
  minPrice,
  maxPrice,
  page = 1,
  limit = 10,
}) => {
  const values = [];
  let whereClauses = [];

  // Search query
  if (query) {
    values.push(`%${query}%`);
    whereClauses.push(`
      (name ILIKE $${values.length}
       OR description ILIKE $${values.length}
       OR category ILIKE $${values.length})
    `);
  }

  // Category filter
  if (category) {
    values.push(category);
    whereClauses.push(`category = $${values.length}`);
  }

  // Min price
  if (minPrice) {
    values.push(minPrice);
    whereClauses.push(`price >= $${values.length}`);
  }

  // Max price
  if (maxPrice) {
    values.push(maxPrice);
    whereClauses.push(`price <= $${values.length}`);
  }

  // Build WHERE clause
  const whereSQL =
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  // Pagination
  const offset = (page - 1) * limit;
  values.push(limit);
  values.push(offset);

  const querySQL = `
    SELECT * FROM products
    ${whereSQL}
    ORDER BY created_at DESC
    LIMIT $${values.length - 1}
    OFFSET $${values.length}
  `;

  const result = await pool.query(querySQL, values);

  return result.rows;
};

module.exports = { searchProducts };
