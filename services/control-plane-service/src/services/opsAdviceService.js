const fs = require("fs/promises");
const path = require("path");
const {
  CONTROL_PLANE_NAMESPACE,
  ALLOWED_APP_DEPLOYMENTS,
  isAllowedDeployment,
} = require("../config/allowlist");
const { getAlertsFromPrometheus } = require("./externalReadService");
const { getIncidentTimelineByService } = require("./incidentAnalyzerService");
const {
  listIncidentSummariesByService,
} = require("./incidentSummaryRepository");

const MAX_QUESTION_CHARACTERS = 800;
const DEFAULT_INCIDENT_LIMIT = 1;
const DEFAULT_LOOKBACK_MINUTES = 15;
const MAX_CITATIONS = 6;

const DOC_SOURCES = [
  ".context/backend-context.md",
  ".context/control-plane-chaos-plan.md",
  "docs/rollback-runbook.md",
  "docs/jenkins-promotion-runbook.md",
  "docs/cloudpulse-ui-runbook.md",
];

const REPO_ROOT = path.resolve(__dirname, "../../..");

const splitMarkdownSections = (content) => {
  const lines = String(content || "").split("\n");
  const sections = [];
  let current = { heading: "Document", lines: [] };

  for (const line of lines) {
    if (/^#{1,3}\s+/.test(line)) {
      if (current.lines.length) {
        sections.push({
          heading: current.heading,
          text: current.lines.join("\n").trim(),
        });
      }
      current = {
        heading: line.replace(/^#{1,3}\s+/, "").trim(),
        lines: [],
      };
      continue;
    }
    current.lines.push(line);
  }

  if (current.lines.length) {
    sections.push({
      heading: current.heading,
      text: current.lines.join("\n").trim(),
    });
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

const loadCitationCandidates = async () => {
  const candidates = [];

  for (const relativePath of DOC_SOURCES) {
    const absolutePath = path.join(REPO_ROOT, relativePath);
    try {
      const content = await fs.readFile(absolutePath, "utf8");
      const sections = splitMarkdownSections(content);
      for (const section of sections) {
        candidates.push({
          path: relativePath,
          section: section.heading,
          text: section.text,
        });
      }
    } catch (err) {
      // best-effort citation source loading
    }
  }

  return candidates;
};

const buildCitations = ({ question, service, scenarioId, outcome }) => {
  const queryText = [question, service, scenarioId, outcome].filter(Boolean).join(" ");
  const tokens = Array.from(new Set(tokenize(queryText)));

  return loadCitationCandidates().then((candidates) =>
    candidates
      .map((item) => ({
        ...item,
        score: computeTextScore(item.text, tokens),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_CITATIONS)
      .map((item) => ({
        path: item.path,
        section: item.section,
        excerpt: item.text.slice(0, 280).trim(),
      })),
  );
};

const toConfidenceLabel = (value) => {
  const score = Number(value || 0);
  if (score >= 0.61) {
    return "high";
  }
  if (score >= 0.31) {
    return "medium";
  }
  return "low";
};

const validateOpsAdviceRequest = ({ service, question }) => {
  if (!isAllowedDeployment(service)) {
    return {
      valid: false,
      status: 400,
      message: "Service is not allowlisted for control-plane ops advice",
      service,
      allowedDeployments: ALLOWED_APP_DEPLOYMENTS,
    };
  }

  if (
    typeof question !== "string" ||
    !question.trim() ||
    question.length > MAX_QUESTION_CHARACTERS
  ) {
    return {
      valid: false,
      status: 400,
      message: `question is required and must be ${MAX_QUESTION_CHARACTERS} characters or fewer`,
    };
  }

  return { valid: true };
};

const buildAdviceBullets = ({
  incident,
  latestSummary,
  activeAlerts,
}) => {
  const bullets = [];

  if (incident?.probableCauseCandidates?.length) {
    const top = incident.probableCauseCandidates[0];
    bullets.push(
      `Primary signal: ${top.label} (${Math.round(top.score * 100)}% evidence alignment).`,
    );
  }

  if (latestSummary?.outcome === "service_recovered") {
    bullets.push("Service appears recovered; continue monitoring for alert re-fire during the next 15 minutes.");
  } else if (incident?.recovery?.state === "in_progress") {
    bullets.push("Incident is still active; monitor recovery progression and avoid concurrent manual mutations.");
  } else {
    bullets.push("Recovery is unconfirmed; verify deployment/pod health and recent control-plane actions before escalation.");
  }

  if (activeAlerts.length > 0) {
    bullets.push(
      `Prometheus still shows ${activeAlerts.length} firing alert(s) for this service; prioritize alert-specific runbook checks.`,
    );
  } else {
    bullets.push("No firing Prometheus alerts currently match this service.");
  }

  return bullets;
};

const getOpsAdvice = async ({ service, question }) => {
  const incident = await getIncidentTimelineByService({
    service,
    limit: DEFAULT_INCIDENT_LIMIT,
    lookbackMinutes: DEFAULT_LOOKBACK_MINUTES,
  });
  const summaries = await listIncidentSummariesByService({
    service,
    limit: 1,
  });
  const latestSummary = summaries[0] || null;

  let alerts = [];
  const warnings = [];
  try {
    const allAlerts = await getAlertsFromPrometheus();
    alerts = allAlerts.filter(
      (alert) => alert.service === service && alert.state === "firing",
    );
  } catch (err) {
    warnings.push(`prometheus alerts unavailable: ${err.message}`);
  }

  const advice = buildAdviceBullets({
    incident,
    latestSummary,
    activeAlerts: alerts,
  });
  const confidence = toConfidenceLabel(incident.confidence);
  const scenarioId = incident.incidents?.[0]?.scenarioId || null;
  const citations = await buildCitations({
    question,
    service,
    scenarioId,
    outcome: latestSummary?.outcome || incident.recovery?.outcome || null,
  });

  return {
    service,
    namespace: CONTROL_PLANE_NAMESPACE,
    question: question.trim(),
    confidence,
    advice,
    citations,
    incidentContext: {
      recovery: incident.recovery,
      probableCauseCandidates: incident.probableCauseCandidates || [],
      summary: latestSummary
        ? {
            executionId: latestSummary.execution_id,
            scenarioId: latestSummary.scenario_id,
            outcome: latestSummary.outcome,
            startedAt: latestSummary.started_at,
            endedAt: latestSummary.ended_at,
          }
        : null,
    },
    warnings,
    generatedAt: new Date().toISOString(),
    readOnly: true,
  };
};

module.exports = {
  validateOpsAdviceRequest,
  getOpsAdvice,
};
