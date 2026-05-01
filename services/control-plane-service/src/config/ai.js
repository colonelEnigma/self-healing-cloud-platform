const AI_ASSISTANT_MODES = Object.freeze([
  "platform-summary",
  "incident-summary",
  "service-diagnostics",
  "resilience",
  "audit-summary",
  "logs",
  "runbook",
]);

const LM_STUDIO_BASE_URL =
  process.env.LM_STUDIO_BASE_URL || "http://localhost:1234/v1";

const LM_STUDIO_MODEL = process.env.LM_STUDIO_MODEL || "gemma3:4b";

const LM_STUDIO_TIMEOUT_MS =
  Number.parseInt(process.env.LM_STUDIO_TIMEOUT_MS, 10) || 30000;

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
  LM_STUDIO_BASE_URL,
  LM_STUDIO_MODEL,
  LM_STUDIO_TIMEOUT_MS,
  AI_CONTEXT_LIMITS,
};
