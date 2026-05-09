const client = require("prom-client");

client.collectDefaultMetrics({
  prefix: "control_plane_",
});

const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests handled by control-plane-service",
  labelNames: ["method", "route", "status_code"],
});

const toCountBucket = (value) => {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : 0;
  if (numeric <= 0) {
    return "0";
  }
  if (numeric === 1) {
    return "1";
  }
  if (numeric <= 3) {
    return "2_3";
  }
  if (numeric <= 5) {
    return "4_5";
  }
  return "6_plus";
};

const opsAdviceTotal = new client.Counter({
  name: "ops_advice_total",
  help: "Total ops advice responses grouped by intent and grounding depth",
  labelNames: [
    "status",
    "intent",
    "confidence",
    "citation_bucket",
    "unknown_bucket",
    "warning_bucket",
  ],
});

const observeOpsAdvice = ({
  status,
  intent,
  confidence,
  citationCount,
  unknownCount,
  warningCount,
}) => {
  opsAdviceTotal.inc({
    status: status || "unknown",
    intent: intent || "unknown",
    confidence: confidence || "unknown",
    citation_bucket: toCountBucket(citationCount),
    unknown_bucket: toCountBucket(unknownCount),
    warning_bucket: toCountBucket(warningCount),
  });
};

module.exports = {
  client,
  httpRequestsTotal,
  observeOpsAdvice,
};
