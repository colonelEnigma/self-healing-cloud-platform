const CircuitBreaker = require("opossum");
const httpClient = require("./httpClient");

// 🔥 Function that calls product-service
const getProduct = async (productId) => {
  const response = await httpClient.get(
    `http://product-service:3005/api/products/${productId}`
  );
  return response.data;
};

// 🔥 Create breaker
const breaker = new CircuitBreaker(getProduct, {
  timeout: 3000,
  errorThresholdPercentage: 50,
  resetTimeout: 10000,

  errorFilter: (err) => {
    // 🔥 IGNORE 404 (business error)
    if (err.response && err.response.status === 404) {
      return true; // do NOT count as failure
    }
    return false;
  },
});

// 🧠 Logging (VERY IMPORTANT)
breaker.on("open", () => console.log("🔥 Circuit OPEN"));
breaker.on("halfOpen", () => console.log("🟡 Circuit HALF-OPEN"));
breaker.on("close", () => console.log("🟢 Circuit CLOSED"));

// 🛑 Fallback when circuit is OPEN
breaker.fallback(() => {
return {
    error: "PRODUCT_SERVICE_UNAVAILABLE",
  };
});

module.exports = breaker;