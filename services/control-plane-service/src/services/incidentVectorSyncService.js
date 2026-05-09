const { generateEmbedding } = require("./embeddingProviderService");
const { upsertIncidentVector } = require("./vectorStoreService");
const {
  listIncidentSummariesByService,
} = require("./incidentSummaryRepository");
const { isVectorConfigured } = require("../config/vector");

const buildIncidentEmbeddingText = (incidentSummary) =>
  [
    `service=${incidentSummary.service}`,
    `scenario=${incidentSummary.scenario_id || "unknown"}`,
    `symptom=${incidentSummary.symptom || "none"}`,
    `probable_cause=${incidentSummary.probable_cause || "unknown"}`,
    `outcome=${incidentSummary.outcome || "unknown"}`,
    `confidence=${incidentSummary.confidence ?? "unknown"}`,
    `timeline=${JSON.stringify(incidentSummary.timeline_json || [])}`,
  ].join("\n");

const upsertSingleIncidentEmbedding = async (incidentSummary) => {
  if (!isVectorConfigured()) {
    return { skipped: true, reason: "vector_disabled_or_unconfigured" };
  }

  const text = buildIncidentEmbeddingText(incidentSummary);
  const embedding = await generateEmbedding(text);
  await upsertIncidentVector({
    incidentSummary,
    vector: embedding.vector,
  });

  return {
    skipped: false,
    provider: embedding.provider,
    incidentId: incidentSummary.id,
  };
};

const syncIncidentSummariesForService = async ({ service, limit = 50 }) => {
  if (!isVectorConfigured()) {
    return {
      enabled: false,
      synced: 0,
      failed: 0,
      failures: [],
    };
  }

  const summaries = await listIncidentSummariesByService({ service, limit });
  let synced = 0;
  let failed = 0;
  const failures = [];

  for (const summary of summaries) {
    try {
      await upsertSingleIncidentEmbedding(summary);
      synced += 1;
    } catch (err) {
      failed += 1;
      failures.push({
        incidentId: summary.id,
        executionId: summary.execution_id,
        message: err.message,
      });
    }
  }

  return {
    enabled: true,
    synced,
    failed,
    failures,
  };
};

module.exports = {
  buildIncidentEmbeddingText,
  upsertSingleIncidentEmbedding,
  syncIncidentSummariesForService,
};

