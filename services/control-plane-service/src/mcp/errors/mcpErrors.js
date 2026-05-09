class McpError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "McpError";
    this.details = details;
  }
}

class McpProviderError extends McpError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = "McpProviderError";
    this.provider = details.provider || "unknown";
    this.operation = details.operation || "unknown";
    this.reason = details.reason || "provider_error";
  }
}

class McpProviderPayloadError extends McpProviderError {
  constructor(message, details = {}) {
    super(message, {
      ...details,
      reason: details.reason || "malformed_payload",
    });
    this.name = "McpProviderPayloadError";
  }
}

class McpCircuitOpenError extends McpProviderError {
  constructor(message, details = {}) {
    super(message, {
      ...details,
      reason: "circuit_open",
    });
    this.name = "McpCircuitOpenError";
  }
}

module.exports = {
  McpError,
  McpProviderError,
  McpProviderPayloadError,
  McpCircuitOpenError,
};
