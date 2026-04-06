const express = require("express");
const router = express.Router();
const {
  createProduct,
  getProducts,
  getProductById,
} = require("../controllers/productController");

// No auth for now (you can add later)
router.post("/products", createProduct);
router.get("/products", getProducts);
router.get("/products/:id", getProductById);

module.exports = router;
