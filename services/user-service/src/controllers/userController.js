const pool = require("../config/db");
const bcrypt = require("bcryptjs"); // ✅ fixed
const jwt = require("jsonwebtoken");

// REGISTER
exports.registerUser = async (req, res) => {
  const { email, password, name } = req.body;

  try {
    // ✅ Validate input first
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // ✅ Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (email, password, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name`,
      [email, hashedPassword, name],
    );

    res.status(201).json({
      message: "User registered successfully",
      user: result.rows[0],
    });
  } catch (err) {
    // ✅ Handle duplicate email (PostgreSQL unique violation)
    if (err.code === "23505") {
      return res.status(400).json({ error: "Email already exists" });
    }

    res.status(500).json({ error: err.message });
  }
};

// LOGIN
exports.loginUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    // ✅ Validate input
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // ✅ Compare password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // ✅ Create JWT
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "1d" },
    );

    res.json({
      message: "Login successful",
      accessToken: token,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET PROFILE
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      "SELECT id, email, name FROM users WHERE id = $1",
      [userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      message: "Profile fetched successfully",
      user: result.rows[0],
    });
  } catch (err) {
    console.error("Profile error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// UPDATE PROFILE
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, email } = req.body;

    const fields = [];
    const values = [];
    let index = 1;

    if (name) {
      fields.push(`name = $${index++}`);
      values.push(name);
    }

    if (email) {
      fields.push(`email = $${index++}`);
      values.push(email);
    }

    if (fields.length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    values.push(userId);

    const query = `
      UPDATE users
      SET ${fields.join(", ")}
      WHERE id = $${index}
      RETURNING id, name, email
    `;

    const result = await pool.query(query, values);

    res.json({
      message: "Profile updated successfully",
      user: result.rows[0],
    });
  } catch (err) {
    // ✅ Handle duplicate email on update
    if (err.code === "23505") {
      return res.status(400).json({ error: "Email already exists" });
    }

    console.error("Profile update error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
