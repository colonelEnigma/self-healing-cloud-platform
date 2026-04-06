const express = require("express");
const router = express.Router();

const {
  createPayment,
  getPaymentByOrder,
} = require("../controllers/paymentController");

const authMiddleware = require("../middleware/paymentMiddleware");

router.post("/payment", authMiddleware, createPayment);
router.get("/payment/:orderId", authMiddleware, getPaymentByOrder);

module.exports = router;
