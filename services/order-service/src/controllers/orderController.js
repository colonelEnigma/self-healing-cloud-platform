const pool = require("../config/db");
const axios = require("axios");
const { sendMessage } = require("../kafka/producer");

exports.createOrder = async (req, res) => {
  console.log("JWT_SECRET in order-service:", process.env.JWT_SECRET);
  const client = await pool.connect();

  try {
    const userId = req.user.id;
    const { items } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ message: "Items required" });
    }

    await client.query("BEGIN");

    // 1. Create order
    const orderResult = await client.query(
      `INSERT INTO orders (user_id, status)
       VALUES ($1, $2)
       RETURNING *`,
      [userId, "CREATED"],
    );

    const order = orderResult.rows[0];
    let totalAmount = 0;

    // 2. Process items
    for (const item of items) {
      const { product_id, quantity } = item;

      if (!product_id || !quantity) {
        throw new Error("Invalid item data");
      }

      // 🔥 CALL PRODUCT SERVICE
      const productRes = await axios.get(
        `http://product-service:3005/api/products/${product_id}`,
      );

      const product = productRes.data;

      const price = product.price;

      totalAmount += quantity * price;

      // Insert item
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, price)
         VALUES ($1, $2, $3, $4)`,
        [order.id, product_id, quantity, price],
      );
    }

    // 3. Update total
    await client.query(`UPDATE orders SET total_amount = $1 WHERE id = $2`, [
      totalAmount,
      order.id,
    ]);

    await client.query("COMMIT");

    //publish event
    await sendMessage("order_created", {
      event: "order_created",
      orderId: order.id,
      userId,
      total_amount: totalAmount,
      items,
    });

    res.status(201).json({
      message: "Order created",
      order_id: order.id,
      total_amount: totalAmount,
    });
  } catch (err) {
    await client.query("ROLLBACK");

    console.error("Create order error:", err.message);

    // Handle product not found
    if (err.response && err.response.status === 404) {
      return res.status(400).json({
        message: "Invalid product_id",
      });
    }

    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
};

exports.getOrderById = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // 1. Fetch order
    const orderResult = await pool.query(
      `SELECT * FROM orders WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ message: "Order not found" });
    }

    const order = orderResult.rows[0];

    // 2. Fetch items
    const itemsResult = await pool.query(
      `SELECT product_id, quantity, price
       FROM order_items
       WHERE order_id = $1`,
      [id],
    );

    res.json({
      ...order,
      items: itemsResult.rows,
    });
  } catch (err) {
    console.error("Get order error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getMyOrders = async (req, res) => {
  try {
    const userId = req.user.id;

    // 1. Get all orders
    const ordersResult = await pool.query(
      `SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    );

    const orders = ordersResult.rows;

    // 2. Attach items to each order
    for (let order of orders) {
      const itemsResult = await pool.query(
        `SELECT product_id, quantity, price
         FROM order_items
         WHERE order_id = $1`,
        [order.id],
      );

      order.items = itemsResult.rows;
    }

    res.json(orders);
  } catch (err) {
    console.error("Get my orders error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
