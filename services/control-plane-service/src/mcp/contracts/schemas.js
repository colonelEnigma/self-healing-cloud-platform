const { McpProviderPayloadError } = require("../errors/mcpErrors");

const ensureObject = (value, context) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new McpProviderPayloadError(`Malformed ${context} payload: expected object`, {
      context,
    });
  }
  return value;
};

const ensureString = (value, field, context, { allowEmpty = false } = {}) => {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new McpProviderPayloadError(`Malformed ${context} payload: ${field} must be string`, {
      context,
      field,
    });
  }
  return value;
};

const ensureNumberOrNull = (value, field, context) => {
  if (value == null) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new McpProviderPayloadError(`Malformed ${context} payload: ${field} must be numeric`, {
      context,
      field,
    });
  }
  return numeric;
};

const validateDeploymentState = (payload) => {
  const obj = ensureObject(payload, "DeploymentState");
  return {
    service: ensureString(obj.service, "service", "DeploymentState"),
    status: ensureString(obj.status, "status", "DeploymentState"),
    desiredReplicas: ensureNumberOrNull(obj.desiredReplicas, "desiredReplicas", "DeploymentState"),
    readyReplicas: ensureNumberOrNull(obj.readyReplicas, "readyReplicas", "DeploymentState"),
    unavailableReplicas: ensureNumberOrNull(
      obj.unavailableReplicas,
      "unavailableReplicas",
      "DeploymentState",
    ),
  };
};

const validateAlertRecordList = (payload) => {
  if (!Array.isArray(payload)) {
    throw new McpProviderPayloadError("Malformed AlertRecord payload: expected array", {
      context: "AlertRecord",
    });
  }
  return payload.map((item) => {
    const obj = ensureObject(item, "AlertRecord");
    return {
      name: ensureString(obj.name || "unknown", "name", "AlertRecord"),
      severity: ensureString(obj.severity || "unknown", "severity", "AlertRecord"),
      state: ensureString(obj.state || "unknown", "state", "AlertRecord"),
      activeAt: obj.activeAt ? ensureString(obj.activeAt, "activeAt", "AlertRecord") : null,
      summary: obj.summary ? ensureString(obj.summary, "summary", "AlertRecord") : null,
      service: ensureString(obj.service, "service", "AlertRecord"),
    };
  });
};

const validateDocEvidenceList = (payload) => {
  if (!Array.isArray(payload)) {
    throw new McpProviderPayloadError("Malformed DocEvidence payload: expected array", {
      context: "DocEvidence",
    });
  }
  return payload.map((item) => {
    const obj = ensureObject(item, "DocEvidence");
    return {
      path: ensureString(obj.path, "path", "DocEvidence"),
      section: ensureString(obj.section || "Document", "section", "DocEvidence"),
      excerpt: ensureString(obj.excerpt || "", "excerpt", "DocEvidence", { allowEmpty: true }),
      score: ensureNumberOrNull(obj.score, "score", "DocEvidence") || 0,
    };
  });
};

module.exports = {
  validateDeploymentState,
  validateAlertRecordList,
  validateDocEvidenceList,
};
