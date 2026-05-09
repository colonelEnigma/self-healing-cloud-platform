const {
  listIncidentSummariesByService,
  getIncidentSummaryByExecutionId,
  listIncidentSummariesByIds,
} = require("./incidentSummaryRepository");
const { generateEmbedding } = require("./embeddingProviderService");
const {
  searchSimilarIncidentVectors,
  VectorStoreError,
} = require("./vectorStoreService");
const {
  buildIncidentEmbeddingText,
  syncIncidentSummariesForService,
} = require("./incidentVectorSyncService");
const { VECTOR_CONFIG, isVectorConfigured } = require("../config/vector");
const { CONTROL_PLANE_NAMESPACE } = require("../config/allowlist");

class SimilarIncidentError extends Error {
  constructor(message, statusCode = 500, details = {}) {
    super(message);
    this.name = "SimilarIncidentError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const resolveAnchorSummary = async ({ service, anchorExecutionId }) => {
  if (Number.isInteger(anchorExecutionId)) {
    const byExecution = await getIncidentSummaryByExecutionId(anchorExecutionId);
    if (!byExecution) {
      throw new SimilarIncidentError(
        "Anchor execution id was not found in incident summaries",
        404,
        { anchorExecutionId },
      );
    }
    if (byExecution.service !== service) {
      throw new SimilarIncidentError(
        "Anchor execution id does not belong to requested service",
        400,
        { anchorExecutionId, requestedService: service },
      );
    }
    return byExecution;
  }

  const latest = await listIncidentSummariesByService({ service, limit: 1 });
  return latest[0] || null;
};

const getSimilarIncidentsByService = async ({
  service,
  limit = 5,
  anchorExecutionId = null,
}) => {
  const normalizedLimit = clamp(Number.parseInt(limit, 10) || 5, 1, 20);

  if (!isVectorConfigured()) {
    throw new SimilarIncidentError(
      "Vector retrieval is disabled or not configured",
      503,
      { vectorEnabled: VECTOR_CONFIG.enabled },
    );
  }

  const anchor = await resolveAnchorSummary({ service, anchorExecutionId });
  if (!anchor) {
    return {
      service,
      namespace: CONTROL_PLANE_NAMESPACE,
      generatedAt: new Date().toISOString(),
      readOnly: true,
      anchor: null,
      results: [],
      vector: {
        enabled: true,
        collection: VECTOR_CONFIG.qdrantCollection,
      },
      warnings: ["No incident summaries found for this service"],
    };
  }

  const syncStatus = await syncIncidentSummariesForService({
    service,
    limit: 100,
  });

  const anchorText = buildIncidentEmbeddingText(anchor);
  const embedding = await generateEmbedding(anchorText);

  let vectorResults = [];
  try {
    vectorResults = await searchSimilarIncidentVectors({
      vector: embedding.vector,
      service,
      limit: normalizedLimit,
      excludeIncidentId: anchor.id,
    });
  } catch (err) {
    if (err instanceof VectorStoreError) {
      throw new SimilarIncidentError(err.message, 502, err.details);
    }
    throw err;
  }

  const incidentIds = vectorResults
    .map((item) => item?.payload?.incident_id)
    .filter((id) => Number.isInteger(id));
  const summaries = await listIncidentSummariesByIds(incidentIds);
  const summaryById = new Map(summaries.map((summary) => [summary.id, summary]));

  const results = vectorResults
    .map((item) => {
      const incidentId = item?.payload?.incident_id;
      const summary = summaryById.get(incidentId);
      if (!summary) {
        return null;
      }
      return {
        score: Number((item.score || 0).toFixed(6)),
        incident: {
          id: summary.id,
          executionId: summary.execution_id,
          service: summary.service,
          scenarioId: summary.scenario_id,
          startedAt: summary.started_at,
          endedAt: summary.ended_at,
          symptom: summary.symptom,
          probableCause: summary.probable_cause,
          confidence: summary.confidence,
          outcome: summary.outcome,
        },
      };
    })
    .filter(Boolean);

  const warnings = [];
  if (syncStatus.failed > 0) {
    warnings.push(
      `Embedding sync partial failure: ${syncStatus.failed} summary item(s) could not be indexed`,
    );
  }

  return {
    service,
    namespace: CONTROL_PLANE_NAMESPACE,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    anchor: {
      id: anchor.id,
      executionId: anchor.execution_id,
      scenarioId: anchor.scenario_id,
      startedAt: anchor.started_at,
      endedAt: anchor.ended_at,
      outcome: anchor.outcome,
    },
    results,
    vector: {
      enabled: true,
      collection: VECTOR_CONFIG.qdrantCollection,
      embeddingProvider: embedding.provider,
      syncStatus: {
        synced: syncStatus.synced,
        failed: syncStatus.failed,
      },
    },
    warnings,
  };
};

module.exports = {
  SimilarIncidentError,
  getSimilarIncidentsByService,
};

