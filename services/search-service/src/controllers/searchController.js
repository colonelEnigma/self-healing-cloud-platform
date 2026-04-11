const pool = require("../config/db");

exports.searchOrders = async (req, res) => {
  try {
    const { userId } = req.query;

    let query = "SELECT * FROM orders_search";
    let values = [];

    if (userId) {
      query += " WHERE user_id = $1";
      values.push(userId);
    }

    const result = await pool.query(query, values);

    res.json(result.rows);
  } catch (err) {
    console.error("Search error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};
