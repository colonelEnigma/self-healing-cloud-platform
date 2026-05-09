const MCP_OPS_ADVICE_ENABLED = String(process.env.MCP_OPS_ADVICE_ENABLED || "false").toLowerCase() === "true";

const toPositiveInt = (value, fallback, min = 1, max = 60000) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
};

const mcpConfig = {
  opsAdviceEnabled: MCP_OPS_ADVICE_ENABLED,
  providerTimeoutMs: toPositiveInt(process.env.MCP_PROVIDER_TIMEOUT_MS, 3000, 100, 120000),
  providerMaxRetries: toPositiveInt(process.env.MCP_PROVIDER_MAX_RETRIES, 1, 0, 5),
  providerBackoffMs: toPositiveInt(process.env.MCP_PROVIDER_BACKOFF_MS, 150, 0, 5000),
  circuitFailureThreshold: toPositiveInt(process.env.MCP_CIRCUIT_FAILURE_THRESHOLD, 3, 1, 20),
  circuitOpenMs: toPositiveInt(process.env.MCP_CIRCUIT_OPEN_MS, 10000, 1000, 300000),
};

module.exports = { mcpConfig };
