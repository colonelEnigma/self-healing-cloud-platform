const {
  observeMcpRequest,
  observeMcpRequestDuration,
  observeMcpFailure,
  setMcpCircuitState,
} = require("../../metrics/metrics");
const {
  McpProviderError,
  McpCircuitOpenError,
} = require("../errors/mcpErrors");

const providerState = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = async (promise, timeoutMs) => {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("provider_timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const getState = (provider, config) => {
  if (!providerState.has(provider)) {
    providerState.set(provider, {
      failures: 0,
      state: "closed",
      openedAt: 0,
      failureThreshold: config.circuitFailureThreshold,
      openMs: config.circuitOpenMs,
    });
  }
  return providerState.get(provider);
};

const canProceed = (state) => {
  if (state.state !== "open") {
    return true;
  }
  if (Date.now() - state.openedAt >= state.openMs) {
    state.state = "half_open";
    return true;
  }
  return false;
};

const toCircuitValue = (state) => {
  if (state === "open") {
    return 1;
  }
  if (state === "half_open") {
    return 0.5;
  }
  return 0;
};

const toSafeErrorMessage = (err) => {
  if (!err) {
    return "provider_error";
  }
  const message = String(err.message || "provider_error");
  return message.slice(0, 200);
};

const runProviderOperation = async ({
  provider,
  operation,
  executor,
  config,
  traceId,
}) => {
  const state = getState(provider, config);
  setMcpCircuitState({ provider, value: toCircuitValue(state.state) });

  if (!canProceed(state)) {
    observeMcpRequest({ provider, operation, status: "error" });
    observeMcpFailure({ provider, operation, reason: "circuit_open" });
    throw new McpCircuitOpenError("MCP provider circuit is open", {
      provider,
      operation,
    });
  }

  const attempts = config.providerMaxRetries + 1;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const startedAt = Date.now();
    try {
      const result = await withTimeout(Promise.resolve().then(executor), config.providerTimeoutMs);
      state.failures = 0;
      state.state = "closed";
      setMcpCircuitState({ provider, value: toCircuitValue(state.state) });
      observeMcpRequest({ provider, operation, status: "success" });
      observeMcpRequestDuration({ provider, operation, status: "success", durationMs: Date.now() - startedAt });
      console.info(
        JSON.stringify({
          msg: "mcp_provider_call",
          traceId: traceId || null,
          provider,
          operation,
          status: "success",
          latencyMs: Date.now() - startedAt,
          attempt,
        }),
      );
      return result;
    } catch (err) {
      lastError = err;
      const latencyMs = Date.now() - startedAt;
      observeMcpRequest({ provider, operation, status: "error" });
      observeMcpRequestDuration({ provider, operation, status: "error", durationMs: latencyMs });
      observeMcpFailure({ provider, operation, reason: toSafeErrorMessage(err) });
      console.warn(
        JSON.stringify({
          msg: "mcp_provider_call",
          traceId: traceId || null,
          provider,
          operation,
          status: "error",
          latencyMs,
          attempt,
          error: toSafeErrorMessage(err),
        }),
      );
      if (attempt < attempts) {
        await sleep(config.providerBackoffMs * attempt);
      }
    }
  }

  state.failures += 1;
  if (state.failures >= state.failureThreshold) {
    state.state = "open";
    state.openedAt = Date.now();
  }
  setMcpCircuitState({ provider, value: toCircuitValue(state.state) });

  throw new McpProviderError("MCP provider operation failed", {
    provider,
    operation,
    reason: toSafeErrorMessage(lastError),
  });
};

module.exports = {
  runProviderOperation,
};
