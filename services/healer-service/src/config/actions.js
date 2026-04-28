const ALLOWED_ACTIONS = {
  ServiceDown: {
    enabled: true,
    action: "scale-or-restart",
    allowedNamespaces: ["dev", "prod"],
    allowedDeployments: [
      "payment-service",
      "order-service",
      "search-service",
      "product-service",
      "user-service",
      // "fake-service"
    ],
    cooldownSeconds: 300,
    maxActionsPerWindow: 3,
    windowMinutes: 20,

    retryAttempts: 3,
    retryBaseDelayMs: 500,

    circuitBreakerFailureThreshold: 3,
    circuitBreakerWindowMinutes: 30,

    //for testing
    // cooldownSeconds: 0,
    // maxActionsPerWindow: 10,
    // windowMinutes: 5,
    // retryAttempts: 2,
    // retryBaseDelayMs: 500,
    // circuitBreakerFailureThreshold: 2,
    // circuitBreakerWindowMinutes: 5,
  },
  KafkaDLQMessagesDetected: { enabled: false, action: "notify-only" },
  KafkaProcessingErrorsHigh: { enabled: false, action: "notify-only" },
  HighKafkaProcessingLatency: { enabled: false, action: "notify-only" },
};

module.exports = ALLOWED_ACTIONS;
