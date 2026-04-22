const pool = require("../config/db");
const { sendMessage } = require("../kafka/producer");
const productBreaker = require("../middleware/productBreaker");
const { ORDER_CREATED_TOPIC } = require("../kafka/producer");

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
      [userId, "CREATED"]
    );

    const order = orderResult.rows[0];
    let totalAmount = 0;

    // 2. Process items
    for (const item of items) {
      const { product_id, quantity } = item;

      if (!product_id || !quantity) {
        throw new Error("Invalid item data");
      }

      let product;

      // 🔥 RESILIENT PRODUCT CALL
      try {
        if (productBreaker.opened) {
          throw new Error("PRODUCT_SERVICE_UNAVAILABLE");
        }
        const result = await productBreaker.fire(product_id);

        if (result && result.error === "PRODUCT_SERVICE_UNAVAILABLE") {
          throw new Error("PRODUCT_SERVICE_UNAVAILABLE");
        }
        
        product = result;

      } catch (error) {
        console.error(
          "Product service failed after retries:",
          error.message
        );

        // 🔴 IMPORTANT: differentiate failures

        // 1. Product not found (do NOT retry case)
        if (error.response && error.response.status === 404) {
          throw new Error("INVALID_PRODUCT");
        }

        if (!error.response) {
          // Network / timeout / DNS → definitely service down
          throw new Error("PRODUCT_SERVICE_UNAVAILABLE");
        }

        // 2. Service unavailable / timeout / network
        throw new Error("PRODUCT_SERVICE_UNAVAILABLE");
      }

      const price = product.price;
      totalAmount += quantity * price;

      // Insert item
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, price)
         VALUES ($1, $2, $3, $4)`,
        [order.id, product_id, quantity, price]
      );
    }

    // 3. Update total
    await client.query(`UPDATE orders SET total_amount = $1 WHERE id = $2`, [
      totalAmount,
      order.id,
    ]);

    await client.query("COMMIT");

    // publish event
    await sendMessage(ORDER_CREATED_TOPIC, {
      eventType: "ORDER_CREATED",
      orderId: order.id,
      totalAmount: totalAmount,
      userId: order.user_id,
      status: order.status,
      createdAt: order.created_at,
      items,
    });

    res.status(201).json({
      message: "Order created",
      order_id: order.id,
      total_amount: totalAmount,
    });
  } catch (err) {
    await client.query("ROLLBACK");

    console.error("Create order error:", err);

    if (err.message === "INVALID_PRODUCT") {
      return res.status(400).json({
        message: "Invalid product_id",
      });
    }

    if (err.message === "PRODUCT_SERVICE_UNAVAILABLE") {
      return res.status(503).json({
        message: "Product service unavailable. Please try again.",
      });
    }

    // 🔥 NEW: detect axios/network leaks (extra safety)
    if (
      err.code === "ECONNREFUSED" ||
      err.code === "ENOTFOUND" ||
      err.code === "ECONNABORTED"
    ) {
      return res.status(503).json({
        message: "Product service unavailable. Please try again.",
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
