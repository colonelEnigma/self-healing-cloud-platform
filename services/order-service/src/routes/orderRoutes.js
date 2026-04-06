const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");

const {
  createOrder,
  getMyOrders,
  getOrderById,
} = require("../controllers/orderController");

router.post("/orders", authMiddleware, createOrder);
router.get("/orders/my-orders", authMiddleware, getMyOrders);
router.get("/orders/:id", authMiddleware, getOrderById);

module.exports = router;
