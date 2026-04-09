const axios = require("axios");
const pool = require("../config/db");

// Create payment
exports.createPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { orderId, amount } = req.body;

    if (!orderId || !amount) {
      return res.status(400).json({ message: "orderId and amount required" });
    }

    // 🔥 STEP 1: Verify order via order-service
    let order;

    try {
      const orderRes = await axios.get(
        `http://order-service:3003/api/orders/${orderId}`,
        {
          headers: {
            Authorization: req.headers.authorization,
          },
        },
      );

      console.log("Order Res:", orderRes.data);

      order = orderRes.data;
    } catch (err) {
      // console.log("order service ERROR: ", err);
      return res.status(400).json({
        message: "Invalid orderId or unauthorized",
      });
    }

    // 🔥 STEP 2: Validate amount
    if (Number(order.total_amount) !== Number(amount)) {
      return res.status(400).json({
        message: "Amount mismatch",
      });
    }

    // 🔥 STEP 3: Create payment
    const result = await pool.query(
      `INSERT INTO payments (order_id, amount, status)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [orderId, amount, "success"],
    );

    res.status(201).json({
      message: "Payment successful",
      payment: result.rows[0],
    });
  } catch (err) {
    // Duplicate payment protection
    if (err.code === "23505") {
      return res.status(400).json({
        message: "Payment already exists for this order",
      });
    }

    console.error("Payment error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

// Get payment by order ID
exports.getPaymentByOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    const result = await pool.query(
      "SELECT * FROM payments WHERE order_id = $1",
      [orderId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Payment not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Fetch payment error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
