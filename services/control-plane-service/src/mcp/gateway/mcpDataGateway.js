const fs = require("fs/promises");
const path = require("path");
const { mcpConfig } = require("../../config/mcp");
const { runProviderOperation } = require("../client/mcpClient");
const { toDeploymentState } = require("../adapters/k8sAdapter");
const { toAlertRecords } = require("../adapters/prometheusAdapter");
const { toIncidentTimeline, toIncidentSummaries } = require("../adapters/incidentsAdapter");
const { toDocEvidence } = require("../adapters/docsAdapter");
const { getServiceDeploymentSummary } = require("../../services/kubernetesService");
const { getAlertsFromPrometheus } = require("../../services/externalReadService");
const { getIncidentTimelineByService } = require("../../services/incidentAnalyzerService");
const { listIncidentSummariesByService } = require("../../services/incidentSummaryRepository");

const DOC_SOURCES = [
  ".context/backend-context.md",
  ".context/control-plane-chaos-plan.md",
  "docs/rollback-runbook.md",
  "docs/jenkins-promotion-runbook.md",
  "docs/cloudpulse-ui-runbook.md",
];
const REPO_ROOT = path.resolve(__dirname, "../../../..");

const splitMarkdownSections = (content) => {
  const lines = String(content || "").split("\n");
  const sections = [];
  let current = { heading: "Document", lines: [] };
  for (const line of lines) {
    if (/^#{1,3}\s+/.test(line)) {
      if (current.lines.length) {
        sections.push({ heading: current.heading, text: current.lines.join("\n").trim() });
      }
      current = { heading: line.replace(/^#{1,3}\s+/, "").trim(), lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  if (current.lines.length) {
    sections.push({ heading: current.heading, text: current.lines.join("\n").trim() });
  }
  return sections.filter((section) => section.text);
};

const tokenize = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);

const computeTextScore = (text, tokens) => {
  const corpus = String(text || "").toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (corpus.includes(token)) {
      score += 1;
    }
  }
  return score;
};

const getDeploymentState = async ({ service, traceId }) => {
  const payload = await runProviderOperation({
    provider: "k8s",
    operation: "getDeploymentState",
    traceId,
    config: mcpConfig,
    executor: () => getServiceDeploymentSummary(service),
  });
  return toDeploymentState(payload);
};

const getAlerts = async ({ service, traceId }) => {
  const payload = await runProviderOperation({
    provider: "prometheus",
    operation: "getAlerts",
    traceId,
    config: mcpConfig,
    executor: async () => {
      const alerts = await getAlertsFromPrometheus();
      return alerts.filter((alert) => alert.service === service);
    },
  });
  return toAlertRecords(payload);
};

const getIncidentTimeline = async ({ service, limit, lookbackMinutes, traceId }) => {
  const payload = await runProviderOperation({
    provider: "incidents",
    operation: "getIncidentTimeline",
    traceId,
    config: mcpConfig,
    executor: () => getIncidentTimelineByService({ service, limit, lookbackMinutes }),
  });
  return toIncidentTimeline(payload);
};

const getIncidentSummaries = async ({ service, limit, traceId }) => {
  const payload = await runProviderOperation({
    provider: "incidents",
    operation: "getIncidentSummaries",
    traceId,
    config: mcpConfig,
    executor: () => listIncidentSummariesByService({ service, limit }),
  });
  return toIncidentSummaries(payload);
};

const getDocEvidence = async ({ question, service, scenarioId, outcome, maxResults, traceId }) => {
  const payload = await runProviderOperation({
    provider: "docs",
    operation: "getDocEvidence",
    traceId,
    config: mcpConfig,
    executor: async () => {
      const queryText = [question, service, scenarioId, outcome].filter(Boolean).join(" ");
      const tokens = Array.from(new Set(tokenize(queryText)));
      const candidates = [];
      for (const relativePath of DOC_SOURCES) {
        try {
          const content = await fs.readFile(path.join(REPO_ROOT, relativePath), "utf8");
          for (const section of splitMarkdownSections(content)) {
            candidates.push({
              path: relativePath,
              section: section.heading,
              excerpt: section.text.slice(0, 280).trim(),
              score: computeTextScore(section.text, tokens),
            });
          }
        } catch (_err) {
          // docs retrieval is best-effort by design
        }
      }
      return candidates
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);
    },
  });
  return toDocEvidence(payload);
};

module.exports = {
  getDeploymentState,
  getAlerts,
  getIncidentTimeline,
  getIncidentSummaries,
  getDocEvidence,
};
