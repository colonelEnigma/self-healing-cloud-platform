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

const opsAdviceDurationMs = new client.Histogram({
  name: "ops_advice_duration_ms",
  help: "Latency of ops advice generation in milliseconds",
  labelNames: ["status", "intent"],
  buckets: [50, 100, 250, 500, 1000, 2000, 5000, 10000],
});

const mcpRequestsTotal = new client.Counter({
  name: "mcp_requests_total",
  help: "Total MCP provider requests",
  labelNames: ["provider", "operation", "status"],
});

const mcpRequestDurationMs = new client.Histogram({
  name: "mcp_request_duration_ms",
  help: "Latency of MCP provider requests in milliseconds",
  labelNames: ["provider", "operation", "status"],
  buckets: [25, 50, 100, 250, 500, 1000, 2000, 5000, 10000],
});

const mcpFailuresTotal = new client.Counter({
  name: "mcp_failures_total",
  help: "Total MCP provider failures by reason",
  labelNames: ["provider", "operation", "reason"],
});

const mcpCircuitState = new client.Gauge({
  name: "mcp_circuit_state",
  help: "MCP circuit state gauge by provider (0=closed,0.5=half_open,1=open)",
  labelNames: ["provider"],
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

const observeOpsAdviceDuration = ({ status, intent, durationMs }) => {
  const value = Number(durationMs);
  if (!Number.isFinite(value) || value < 0) {
    return;
  }
  opsAdviceDurationMs.observe(
    {
      status: status || "unknown",
      intent: intent || "unknown",
    },
    value,
  );
};

const observeMcpRequest = ({ provider, operation, status }) => {
  mcpRequestsTotal.inc({
    provider: provider || "unknown",
    operation: operation || "unknown",
    status: status || "unknown",
  });
};

const observeMcpRequestDuration = ({ provider, operation, status, durationMs }) => {
  const value = Number(durationMs);
  if (!Number.isFinite(value) || value < 0) {
    return;
  }
  mcpRequestDurationMs.observe(
    {
      provider: provider || "unknown",
      operation: operation || "unknown",
      status: status || "unknown",
    },
    value,
  );
};

const observeMcpFailure = ({ provider, operation, reason }) => {
  mcpFailuresTotal.inc({
    provider: provider || "unknown",
    operation: operation || "unknown",
    reason: reason || "unknown",
  });
};

const setMcpCircuitState = ({ provider, value }) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return;
  }
  mcpCircuitState.set({ provider: provider || "unknown" }, numeric);
};

module.exports = {
  client,
  httpRequestsTotal,
  observeOpsAdvice,
  observeOpsAdviceDuration,
  observeMcpRequest,
  observeMcpRequestDuration,
  observeMcpFailure,
  setMcpCircuitState,
};
