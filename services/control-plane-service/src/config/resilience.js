const HEALER_SERVICE_DOWN_POLICY = Object.freeze({
  alertName: "ServiceDown",
  owner: "healer-service",
  enabled: true,
  action: "scale-or-restart",
  cooldownSeconds: 300,
  rateLimit: {
    maxActionsPerWindow: 3,
    windowMinutes: 20,
  },
  retry: {
    attempts: 3,
    baseDelayMs: 500,
  },
  circuitBreaker: {
    failureThreshold: 3,
    windowMinutes: 30,
  },
});

const MANUAL_SCALE_GUARD = Object.freeze({
  owner: "control-plane-service",
  action: "scale",
  allowedReplicas: [0, 1],
  requiresTypedConfirmation: true,
  auditedResults: ["success", "blocked", "error"],
});

module.exports = {
  HEALER_SERVICE_DOWN_POLICY,
  MANUAL_SCALE_GUARD,
};
