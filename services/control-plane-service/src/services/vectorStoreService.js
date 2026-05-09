const axios = require("axios");
const { VECTOR_CONFIG, isVectorConfigured } = require("../config/vector");

class VectorStoreError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "VectorStoreError";
    this.details = details;
  }
}

let collectionInitialized = false;

const getClient = () =>
  axios.create({
    baseURL: VECTOR_CONFIG.qdrantUrl.replace(/\/$/, ""),
    timeout: 10000,
    headers: {
      ...(VECTOR_CONFIG.qdrantApiKey
        ? { "api-key": VECTOR_CONFIG.qdrantApiKey }
        : {}),
      "Content-Type": "application/json",
    },
  });

const toPointId = (incidentId) => `incident-${incidentId}`;

const ensureCollection = async () => {
  if (!isVectorConfigured()) {
    throw new VectorStoreError("Vector retrieval is not configured");
  }

  if (collectionInitialized) {
    return;
  }

  try {
    const client = getClient();
    await client.put(`/collections/${VECTOR_CONFIG.qdrantCollection}`, {
      vectors: {
        size: VECTOR_CONFIG.embeddingDimension,
        distance: VECTOR_CONFIG.qdrantDistance,
      },
    });
    collectionInitialized = true;
  } catch (err) {
    throw new VectorStoreError("Failed to initialize Qdrant collection", {
      message: err.message,
      status: err.response?.status,
    });
  }
};

const upsertIncidentVector = async ({ incidentSummary, vector }) => {
  await ensureCollection();

  try {
    const client = getClient();
    await client.put(
      `/collections/${VECTOR_CONFIG.qdrantCollection}/points?wait=true`,
      {
        points: [
          {
            id: toPointId(incidentSummary.id),
            vector,
            payload: {
              incident_id: incidentSummary.id,
              execution_id: incidentSummary.execution_id,
              service: incidentSummary.service,
              scenario_id: incidentSummary.scenario_id,
              started_at: incidentSummary.started_at,
              ended_at: incidentSummary.ended_at,
              outcome: incidentSummary.outcome,
              confidence: incidentSummary.confidence,
            },
          },
        ],
      },
    );
  } catch (err) {
    throw new VectorStoreError("Failed to upsert incident vector", {
      message: err.message,
      status: err.response?.status,
    });
  }
};

const searchSimilarIncidentVectors = async ({
  vector,
  service,
  limit,
  excludeIncidentId,
}) => {
  await ensureCollection();

  const must = [];
  if (service) {
    must.push({
      key: "service",
      match: { value: service },
    });
  }

  const mustNot = [];
  if (Number.isInteger(excludeIncidentId)) {
    mustNot.push({
      key: "incident_id",
      match: { value: excludeIncidentId },
    });
  }

  try {
    const client = getClient();
    const response = await client.post(
      `/collections/${VECTOR_CONFIG.qdrantCollection}/points/search`,
      {
        vector,
        limit,
        with_payload: true,
        with_vector: false,
        ...(must.length || mustNot.length
          ? {
              filter: {
                ...(must.length ? { must } : {}),
                ...(mustNot.length ? { must_not: mustNot } : {}),
              },
            }
          : {}),
      },
    );

    return response?.data?.result || [];
  } catch (err) {
    throw new VectorStoreError("Failed to query similar incidents from Qdrant", {
      message: err.message,
      status: err.response?.status,
    });
  }
};

module.exports = {
  VectorStoreError,
  upsertIncidentVector,
  searchSimilarIncidentVectors,
};

