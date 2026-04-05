const pool = require("../config/db");
const bcrypt = require("bcrypt");

exports.registerUser = async (req, res) => {
    const { email, password, name } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        if (!email || email.trim() === "") {
            return res.status(400).json({ error: "Email is required" });
        }

        const result = await pool.query(
            "INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING id, email, name",
            [email, hashedPassword, name]
        );

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.loginUser = async (req, res) => {
    const { email, password } = req.body;

    try {
        const result = await pool.query(
            "SELECT * FROM users WHERE email = $1",
            [email]
        );

        const user = result.rows[0];

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        res.json({ message: "Login successful" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};