const CircuitBreaker = require("opossum");
const httpClient = require("./httpClient");

const breakerOptions = {
  timeout: 3000,
  errorThresholdPercentage: 50,
  resetTimeout: 10000,
};

const getProduct = async (productId) => {
  const response = await httpClient.get(
    "http://product-service:3005/api/products/" + productId,
  );
  return response.data;
};

const breaker = new CircuitBreaker(getProduct, {
  ...breakerOptions,
  errorFilter: (err) => {
    if (err.response && err.response.status === 404) {
      return true;
    }
    return false;
  },
});

breaker.on("open", () => console.log("Circuit OPEN"));
breaker.on("halfOpen", () => console.log("Circuit HALF-OPEN"));
breaker.on("close", () => console.log("Circuit CLOSED"));

breaker.fallback(() => ({
  error: "PRODUCT_SERVICE_UNAVAILABLE",
}));

breaker.getStatus = () => ({
  name: "order-service product lookup circuit breaker",
  owner: "order-service",
  dependency: "product-service",
  state: breaker.opened ? "open" : breaker.halfOpen ? "half_open" : "closed",
  options: {
    ...breakerOptions,
    errorFilter: "ignores product 404 business errors",
  },
  fallback: {
    enabled: true,
    response: {
      error: "PRODUCT_SERVICE_UNAVAILABLE",
    },
  },
  stats: breaker.status?.stats || {},
});

module.exports = breaker;
