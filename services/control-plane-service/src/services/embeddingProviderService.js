const axios = require("axios");
const { VECTOR_CONFIG } = require("../config/vector");

class EmbeddingProviderError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "EmbeddingProviderError";
    this.details = details;
  }
}

const ensureVectorShape = (vector, provider) => {
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new EmbeddingProviderError("Embedding provider returned empty vector", {
      provider,
    });
  }

  const asNumbers = vector.map((value) => Number(value));
  if (asNumbers.some((value) => !Number.isFinite(value))) {
    throw new EmbeddingProviderError(
      "Embedding provider returned invalid numeric values",
      { provider },
    );
  }

  return asNumbers;
};

const requestEmbedding = async ({
  baseUrl,
  model,
  apiKey,
  provider,
  input,
}) => {
  const response = await axios.post(
    `${baseUrl.replace(/\/$/, "")}/embeddings`,
    { model, input },
    {
      timeout: VECTOR_CONFIG.embeddingTimeoutMs,
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        "Content-Type": "application/json",
      },
    },
  );

  const vector = response?.data?.data?.[0]?.embedding;
  return ensureVectorShape(vector, provider);
};

const providerHandlers = {
  local: async (input) =>
    requestEmbedding({
      baseUrl: VECTOR_CONFIG.localProvider.baseUrl,
      model: VECTOR_CONFIG.localProvider.model,
      provider: "local",
      input,
    }),
  openai: async (input) => {
    if (!VECTOR_CONFIG.openAiProvider.apiKey) {
      throw new EmbeddingProviderError("OPENAI_API_KEY is not configured", {
        provider: "openai",
      });
    }
    return requestEmbedding({
      baseUrl: VECTOR_CONFIG.openAiProvider.baseUrl,
      model: VECTOR_CONFIG.openAiProvider.model,
      apiKey: VECTOR_CONFIG.openAiProvider.apiKey,
      provider: "openai",
      input,
    });
  },
  openrouter: async (input) => {
    if (!VECTOR_CONFIG.openRouterProvider.apiKey) {
      throw new EmbeddingProviderError("OPENROUTER_API_KEY is not configured", {
        provider: "openrouter",
      });
    }
    return requestEmbedding({
      baseUrl: VECTOR_CONFIG.openRouterProvider.baseUrl,
      model: VECTOR_CONFIG.openRouterProvider.model,
      apiKey: VECTOR_CONFIG.openRouterProvider.apiKey,
      provider: "openrouter",
      input,
    });
  },
};

const generateEmbedding = async (input) => {
  const payload = String(input || "").trim();
  if (!payload) {
    throw new EmbeddingProviderError("Embedding input text is required");
  }

  const errors = [];
  for (const provider of VECTOR_CONFIG.providerOrder) {
    const handler = providerHandlers[provider];
    if (!handler) {
      continue;
    }

    try {
      const vector = await handler(payload);
      return { provider, vector };
    } catch (err) {
      errors.push({
        provider,
        message: err.message,
      });
    }
  }

  throw new EmbeddingProviderError("No embedding provider succeeded", {
    attempts: errors,
  });
};

module.exports = {
  EmbeddingProviderError,
  generateEmbedding,
};

