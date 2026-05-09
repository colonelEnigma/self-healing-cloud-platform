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
  {
    path: ".context/backend-context.md",
    absPath: path.resolve(__dirname, "../corpus/backend-context.md"),
  },
  {
    path: ".context/control-plane-chaos-plan.md",
    absPath: path.resolve(__dirname, "../corpus/control-plane-chaos-plan.md"),
  },
  {
    path: "docs/rollback-runbook.md",
    absPath: path.resolve(__dirname, "../corpus/rollback-runbook.md"),
  },
  {
    path: "docs/jenkins-promotion-runbook.md",
    absPath: path.resolve(__dirname, "../corpus/jenkins-promotion-runbook.md"),
  },
  {
    path: "docs/cloudpulse-ui-runbook.md",
    absPath: path.resolve(__dirname, "../corpus/cloudpulse-ui-runbook.md"),
  },
  {
    path: "docs/mcp-corpus/healer-service-playbook.md",
    absPath: path.resolve(__dirname, "../corpus/healer-service-playbook.md"),
  },
  {
    path: "docs/mcp-corpus/grafana-playbook.md",
    absPath: path.resolve(__dirname, "../corpus/grafana-playbook.md"),
  },
  {
    path: "docs/mcp-corpus/control-plane-resilience-ui-demo-manual.md",
    absPath: path.resolve(__dirname, "../corpus/control-plane-resilience-ui-demo-manual.md"),
  },
  {
    path: "docs/mcp-corpus/debugging-playbook.md",
    absPath: path.resolve(__dirname, "../corpus/debugging-playbook.md"),
  },
  {
    path: "docs/mcp-corpus/operations-playbook.md",
    absPath: path.resolve(__dirname, "../corpus/operations-playbook.md"),
  },
];

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

const isRunbookPath = (docPath) =>
  docPath === "docs/rollback-runbook.md" ||
  docPath === "docs/jenkins-promotion-runbook.md" ||
  docPath.startsWith("docs/mcp-corpus/");

const getSourceWeight = ({ intent, path: docPath }) => {
  if (intent !== "runbook_lookup") {
    return 0;
  }
  if (docPath === "docs/rollback-runbook.md") {
    return 40;
  }
  if (docPath === "docs/jenkins-promotion-runbook.md") {
    return 35;
  }
  if (docPath.startsWith("docs/mcp-corpus/")) {
    return 20;
  }
  if (docPath.startsWith(".context/")) {
    return -15;
  }
  return 0;
};

const sortByRank = (a, b) => {
  if (b.rankScore !== a.rankScore) {
    return b.rankScore - a.rankScore;
  }
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  const pathCmp = String(a.path || "").localeCompare(String(b.path || ""));
  if (pathCmp !== 0) {
    return pathCmp;
  }
  return String(a.section || "").localeCompare(String(b.section || ""));
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

const getDocEvidence = async ({ question, service, scenarioId, outcome, maxResults, traceId, intent }) => {
  const payload = await runProviderOperation({
    provider: "docs",
    operation: "getDocEvidence",
    traceId,
    config: mcpConfig,
    executor: async () => {
      const queryText = [question, service, scenarioId, outcome].filter(Boolean).join(" ");
      const tokens = Array.from(new Set(tokenize(queryText)));
      const candidates = [];
      const fallbackRunbookCandidates = [];
      for (const source of DOC_SOURCES) {
        try {
          const content = await fs.readFile(source.absPath, "utf8");
          for (const section of splitMarkdownSections(content)) {
            const lexicalScore = computeTextScore(section.text, tokens);
            const weightedScore = lexicalScore + getSourceWeight({ intent, path: source.path });
            const candidate = {
              path: source.path,
              section: section.heading,
              excerpt: section.text.slice(0, 280).trim(),
              score: lexicalScore,
              rankScore: weightedScore,
            };
            candidates.push(candidate);
            if (intent === "runbook_lookup" && isRunbookPath(source.path)) {
              fallbackRunbookCandidates.push(candidate);
            }
          }
        } catch (_err) {
          // docs retrieval is best-effort by design
        }
      }
      const matched = candidates
        .filter((item) => item.score > 0)
        .sort(sortByRank)
        .slice(0, maxResults)
        .map(({ rankScore: _rankScore, ...item }) => item);

      if (intent === "runbook_lookup" && matched.length === 0) {
        const fallback = fallbackRunbookCandidates
          .sort(sortByRank)
          .slice(0, maxResults)
          .map(({ rankScore: _rankScore, ...item }) => item);
        return fallback;
      }

      return matched;
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
