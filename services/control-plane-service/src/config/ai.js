const AI_ASSISTANT_MODES = Object.freeze([
  "platform-summary",
  "incident-summary",
  "service-diagnostics",
  "resilience",
  "audit-summary",
  "logs",
  "runbook",
]);

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const parseNonNegativeInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
};

const parseProviderOrder = (value) => {
  const allowed = new Set(["openrouter", "lmstudio"]);
  const parsed = String(value || "openrouter,lmstudio")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => allowed.has(item));

  return parsed.length > 0 ? parsed : ["openrouter", "lmstudio"];
};

const LM_STUDIO_BASE_URL =
  process.env.LM_STUDIO_BASE_URL || "http://localhost:1234/v1";

const LM_STUDIO_MODEL = process.env.LM_STUDIO_MODEL || "gemma3:4b";

const LM_STUDIO_TIMEOUT_MS = parsePositiveInteger(
  process.env.LM_STUDIO_TIMEOUT_MS,
  30000,
);

const OPENROUTER_CHAT_BASE_URL =
  process.env.OPENROUTER_CHAT_BASE_URL || "https://openrouter.ai/api/v1";

const OPENROUTER_CHAT_MODEL =
  process.env.OPENROUTER_CHAT_MODEL || "google/gemma-3-4b-it";

const OPENROUTER_CHAT_TIMEOUT_MS = parsePositiveInteger(
  process.env.OPENROUTER_CHAT_TIMEOUT_MS,
  30000,
);

const AI_CHAT_PROVIDER_ORDER = Object.freeze(
  parseProviderOrder(process.env.AI_CHAT_PROVIDER_ORDER),
);

const AI_CHAT_MAX_RETRIES = parseNonNegativeInteger(
  process.env.AI_CHAT_MAX_RETRIES,
  1,
);

const AI_CHAT_RETRY_BACKOFF_MS = parsePositiveInteger(
  process.env.AI_CHAT_RETRY_BACKOFF_MS,
  250,
);

const CONTROL_PLANE_CONTEXT_BASE_URL =
  process.env.CONTROL_PLANE_CONTEXT_BASE_URL || "";

const AI_CONTEXT_LIMITS = Object.freeze({
  overviewRecentItems: 5,
  auditLimit: 8,
  healingHistoryLimit: 8,
  serviceLogTailLines: 80,
  maxLogCharacters: 8000,
  maxQuestionCharacters: 1200,
  maxPromptCharacters: 24000,
});

module.exports = {
  AI_ASSISTANT_MODES,
  AI_CHAT_PROVIDER_ORDER,
  AI_CHAT_MAX_RETRIES,
  AI_CHAT_RETRY_BACKOFF_MS,
  LM_STUDIO_BASE_URL,
  LM_STUDIO_MODEL,
  LM_STUDIO_TIMEOUT_MS,
  OPENROUTER_CHAT_BASE_URL,
  OPENROUTER_CHAT_MODEL,
  OPENROUTER_CHAT_TIMEOUT_MS,
  CONTROL_PLANE_CONTEXT_BASE_URL,
  AI_CONTEXT_LIMITS,
};
