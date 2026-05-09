const parseBoolean = (value, fallback = false) => {
  if (value == null) {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
};

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const parseProviderOrder = (value) =>
  String(value || "local,openai,openrouter")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

const VECTOR_CONFIG = Object.freeze({
  enabled: parseBoolean(process.env.VECTOR_RETRIEVAL_ENABLED, true),
  qdrantUrl: process.env.QDRANT_URL || "",
  qdrantApiKey: process.env.QDRANT_API_KEY || "",
  qdrantCollection: process.env.QDRANT_COLLECTION || "incident_summaries_v1",
  qdrantDistance: process.env.QDRANT_DISTANCE || "Cosine",
  embeddingDimension: parsePositiveInteger(
    process.env.EMBEDDING_DIMENSION,
    768,
  ),
  embeddingTimeoutMs: parsePositiveInteger(
    process.env.EMBEDDING_TIMEOUT_MS,
    10000,
  ),
  providerOrder: parseProviderOrder(process.env.EMBEDDING_PROVIDER_ORDER),
  localProvider: {
    baseUrl: process.env.LOCAL_EMBEDDING_BASE_URL || "http://localhost:1234/v1",
    model: process.env.LOCAL_EMBEDDING_MODEL || "nomic-embed-text-v1.5",
  },
  openAiProvider: {
    baseUrl: process.env.OPENAI_EMBEDDING_BASE_URL || "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
  },
  openRouterProvider: {
    baseUrl:
      process.env.OPENROUTER_EMBEDDING_BASE_URL ||
      "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY || "",
    model:
      process.env.OPENROUTER_EMBEDDING_MODEL ||
      "openai/text-embedding-3-small",
  },
});

const isVectorConfigured = () =>
  VECTOR_CONFIG.enabled &&
  Boolean(VECTOR_CONFIG.qdrantUrl) &&
  VECTOR_CONFIG.embeddingDimension > 0;

module.exports = {
  VECTOR_CONFIG,
  isVectorConfigured,
};

