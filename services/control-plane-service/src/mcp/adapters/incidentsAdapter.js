const { McpProviderPayloadError } = require("../errors/mcpErrors");

const toIncidentTimeline = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new McpProviderPayloadError("Malformed IncidentTimeline payload", {
      context: "IncidentTimeline",
    });
  }
  if (!Array.isArray(payload.timeline) || !Array.isArray(payload.incidents)) {
    throw new McpProviderPayloadError("Malformed IncidentTimeline payload: missing timeline/incidents", {
      context: "IncidentTimeline",
    });
  }
  return payload;
};

const toIncidentSummaries = (payload) => {
  if (!Array.isArray(payload)) {
    throw new McpProviderPayloadError("Malformed incident summary payload", {
      context: "IncidentSummary",
    });
  }
  return payload;
};

module.exports = {
  toIncidentTimeline,
  toIncidentSummaries,
};
