const express = require("express");
const productBreaker = require("../middleware/productBreaker");

const router = express.Router();

router.get("/resilience", (req, res) => {
  res.status(200).json({
    service: "order-service",
    generatedAt: new Date().toISOString(),
    circuitBreakers: [productBreaker.getStatus()],
    retries: [
      {
        name: "product-service HTTP client retry",
        dependency: "product-service",
        attempts: 3,
        baseDelayMs: 500,
        retriedFailures: [
          "ECONNREFUSED",
          "ENOTFOUND",
          "ECONNABORTED",
          "network errors",
          "retryable HTTP errors",
        ],
      },
    ],
  });
});

module.exports = router;
