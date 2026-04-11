const express = require("express");
const router = express.Router();
const { searchOrders } = require("../controllers/searchController");

router.get("/orders", searchOrders);

module.exports = router;
