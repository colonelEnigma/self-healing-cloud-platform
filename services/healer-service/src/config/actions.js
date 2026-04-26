const ALLOWED_ACTIONS = {
  ServiceDown: {
    enabled: true,
    action: "scale-or-restart",
    allowedNamespaces: ["dev"],
    allowedDeployments: [
      "payment-service",
      "order-service",
      "search-service",
      "product-service",
      "user-service",
    ],
    cooldownSeconds: 300,
    maxActionsPerWindow: 3,
    windowMinutes: 20,
  },
  KafkaDLQMessagesDetected: { enabled: false, action: "notify-only" },
  KafkaProcessingErrorsHigh: { enabled: false, action: "notify-only" },
  HighKafkaProcessingLatency: { enabled: false, action: "notify-only" },
};

module.exports = ALLOWED_ACTIONS;
