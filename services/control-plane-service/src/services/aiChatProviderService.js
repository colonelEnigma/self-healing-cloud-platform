const axios = require("axios");
const {
  AI_CHAT_PROVIDER_ORDER,
  AI_CHAT_MAX_RETRIES,
  AI_CHAT_RETRY_BACKOFF_MS,
  LM_STUDIO_BASE_URL,
  LM_STUDIO_MODEL,
  LM_STUDIO_TIMEOUT_MS,
  OPENROUTER_CHAT_BASE_URL,
  OPENROUTER_CHAT_MODEL,
  OPENROUTER_CHAT_TIMEOUT_MS,
} = require("../config/ai");

class AiChatProviderError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "AiChatProviderError";
    this.details = details;
    this.provider = details.provider || null;
    this.model = details.model || null;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sanitizeErrorMessage = (err) => {
  const status = err?.response?.status;
  if (status) {
    return `upstream_http_${status}`;
  }
  if (err?.code) {
    return String(err.code);
  }
  return err?.message || "unknown_error";
};

const normalizeAnswer = (value) => {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const joined = value
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item.text === "string") {
          return item.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
    return joined || null;
  }
  return null;
};

const callLmStudio = async ({ messages }) => {
  const client = axios.create({
    baseURL: LM_STUDIO_BASE_URL.replace(/\/$/, ""),
    timeout: LM_STUDIO_TIMEOUT_MS,
  });
  const response = await client.post("/chat/completions", {
    model: LM_STUDIO_MODEL,
    messages,
    temperature: 0.2,
    max_tokens: 700,
  });
  const answer = normalizeAnswer(response?.data?.choices?.[0]?.message?.content);
  if (!answer) {
    throw new AiChatProviderError("Provider returned no assistant message", {
      provider: "lmstudio",
      model: LM_STUDIO_MODEL,
    });
  }
  return {
    provider: "lmstudio",
    model: LM_STUDIO_MODEL,
    answer,
  };
};

const callOpenRouter = async ({ messages }) => {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new AiChatProviderError("OPENROUTER_API_KEY is not configured", {
      provider: "openrouter",
      model: OPENROUTER_CHAT_MODEL,
    });
  }

  const client = axios.create({
    baseURL: OPENROUTER_CHAT_BASE_URL.replace(/\/$/, ""),
    timeout: OPENROUTER_CHAT_TIMEOUT_MS,
  });
  const response = await client.post(
    "/chat/completions",
    {
      model: OPENROUTER_CHAT_MODEL,
      messages,
      temperature: 0.2,
      max_tokens: 700,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
    },
  );
  const answer = normalizeAnswer(response?.data?.choices?.[0]?.message?.content);
  if (!answer) {
    throw new AiChatProviderError("Provider returned no assistant message", {
      provider: "openrouter",
      model: OPENROUTER_CHAT_MODEL,
    });
  }
  return {
    provider: "openrouter",
    model: OPENROUTER_CHAT_MODEL,
    answer,
  };
};

const providerHandlers = {
  openrouter: callOpenRouter,
  lmstudio: callLmStudio,
};

const callWithRetries = async ({ provider, messages }) => {
  const handler = providerHandlers[provider];
  if (!handler) {
    throw new AiChatProviderError("Unsupported AI provider", { provider });
  }

  let lastError = null;
  const totalAttempts = AI_CHAT_MAX_RETRIES + 1;
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      return await handler({ messages });
    } catch (err) {
      lastError = err;
      if (attempt < totalAttempts) {
        await sleep(AI_CHAT_RETRY_BACKOFF_MS * attempt);
      }
    }
  }

  throw new AiChatProviderError("Provider failed after retries", {
    provider,
    ...(lastError?.details || {}),
    cause: sanitizeErrorMessage(lastError),
  });
};

const runAiChatWithFallback = async ({ messages }) => {
  const failures = [];
  for (const provider of AI_CHAT_PROVIDER_ORDER) {
    try {
      const result = await callWithRetries({ provider, messages });
      return {
        ...result,
        attemptedProviders: failures.length
          ? [...failures.map((item) => item.provider), provider]
          : [provider],
      };
    } catch (err) {
      failures.push({
        provider,
        error: sanitizeErrorMessage(err),
      });
    }
  }

  throw new AiChatProviderError("No chat provider succeeded", {
    provider: AI_CHAT_PROVIDER_ORDER[0] || null,
    failures,
  });
};

const getAiProviderStatus = () => {
  const providerStatuses = {
    openrouter: {
      configured: Boolean(process.env.OPENROUTER_API_KEY),
      baseUrlConfigured: Boolean(process.env.OPENROUTER_CHAT_BASE_URL),
      defaultBaseUrl: process.env.OPENROUTER_CHAT_BASE_URL
        ? null
        : OPENROUTER_CHAT_BASE_URL,
      model: OPENROUTER_CHAT_MODEL,
      timeoutMs: OPENROUTER_CHAT_TIMEOUT_MS,
    },
    lmstudio: {
      configured: true,
      baseUrlConfigured: Boolean(process.env.LM_STUDIO_BASE_URL),
      defaultBaseUrl: process.env.LM_STUDIO_BASE_URL ? null : LM_STUDIO_BASE_URL,
      model: LM_STUDIO_MODEL,
      timeoutMs: LM_STUDIO_TIMEOUT_MS,
    },
  };

  const activeProvider =
    AI_CHAT_PROVIDER_ORDER.find(
      (provider) => provider !== "openrouter" || Boolean(process.env.OPENROUTER_API_KEY),
    ) || null;

  return {
    providerOrder: AI_CHAT_PROVIDER_ORDER,
    activeProvider,
    retries: {
      maxRetries: AI_CHAT_MAX_RETRIES,
      backoffMs: AI_CHAT_RETRY_BACKOFF_MS,
    },
    providers: providerStatuses,
  };
};

module.exports = {
  AiChatProviderError,
  runAiChatWithFallback,
  getAiProviderStatus,
};
