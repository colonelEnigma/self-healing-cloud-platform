const pool = require("../config/db");

// Create product
exports.createProduct = async (req, res) => {
  try {
    const { name, description, category, price } = req.body;

    if (!name || !price) {
      return res.status(400).json({ message: "Name and price required" });
    }

    const result = await pool.query(
      `INSERT INTO products (name, description, category, price)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, description, category, price],
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Create product error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Get all products
exports.getProducts = async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM products`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get product by ID
exports.getProductById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`SELECT * FROM products WHERE id = $1`, [
      id,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
