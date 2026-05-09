const fs = require("fs/promises");
const path = require("path");
const {
  CONTROL_PLANE_NAMESPACE,
  ALLOWED_APP_DEPLOYMENTS,
  isAllowedDeployment,
} = require("../config/allowlist");
const { getAlertsFromPrometheus } = require("./externalReadService");
const { getIncidentTimelineByService } = require("./incidentAnalyzerService");
const { getServiceDeploymentSummary } = require("./kubernetesService");
const {
  getSimilarIncidentsByService,
} = require("./similarIncidentService");
const {
  listIncidentSummariesByService,
} = require("./incidentSummaryRepository");

const MAX_QUESTION_CHARACTERS = 800;
const DEFAULT_INCIDENT_LIMIT = 1;
const DEFAULT_LOOKBACK_MINUTES = 15;
const MAX_CITATIONS = 6;
const MAX_SIMILAR_INCIDENTS = 3;

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

const classifyIntent = (question) => {
  const normalized = String(question || "").toLowerCase();
  if (
    /\b(root cause|why|cause|failure|failed|incident|what happened)\b/.test(
      normalized,
    )
  ) {
    return "incident_diagnosis";
  }
  if (/\b(next|mitigate|recover|restore|stabilize|action|step)\b/.test(normalized)) {
    return "recovery_plan";
  }
  if (/\b(escalate|page|sev|severity|risk|impact)\b/.test(normalized)) {
    return "risk_assessment";
  }
  if (/\b(runbook|procedure|playbook|document|docs)\b/.test(normalized)) {
    return "runbook_lookup";
  }
  return "general_ops";
};

const buildClearAnswer = ({ intent, incident, latestSummary, alerts, deployment }) => {
  const topCause = incident?.probableCauseCandidates?.[0] || null;
  const recoveryState = incident?.recovery?.state || "unknown";
  const outcome =
    latestSummary?.outcome || incident?.recovery?.outcome || "unknown_outcome";
  const alertCount = alerts.length;
  const deploymentStatus = deployment?.status || "unknown";

  if (intent === "incident_diagnosis" && topCause) {
    return `Most likely current issue is ${topCause.label} based on recent incident evidence; recovery state is ${recoveryState} and deployment status is ${deploymentStatus}.`;
  }
  if (intent === "recovery_plan") {
    return `Prioritize production stabilization checks for ${deployment?.service || "the service"}: verify live alerts, deployment health, and recent healing/audit signals before any escalation. Current recovery state is ${recoveryState}.`;
  }
  if (intent === "risk_assessment") {
    return `Current operational risk is ${alertCount > 0 ? "elevated" : "moderate"} with ${alertCount} firing alert(s) and recovery outcome ${outcome}.`;
  }
  if (intent === "runbook_lookup") {
    return "Use the cited runbook/document sections that match this service and incident outcome; they are ranked by lexical relevance to your question and current signals.";
  }
  return `Current state summary for ${deployment?.service || "service"}: deployment=${deploymentStatus}, recovery=${recoveryState}, firingAlerts=${alertCount}.`;
};

const buildUnknowns = ({ latestSummary, incident, deployment, warnings, citations }) => {
  const unknowns = [];
  if (!latestSummary) {
    unknowns.push("No recent incident summary row found in incident_summaries.");
  }
  if (!incident?.incidents?.length) {
    unknowns.push("No recent incident executions found in lookback window.");
  }
  if (!deployment) {
    unknowns.push("Live deployment detail was unavailable from Kubernetes.");
  }
  if (!citations.length) {
    unknowns.push("No matching runbook/document citations were found for this query.");
  }
  for (const warning of warnings) {
    unknowns.push(warning);
  }
  return unknowns;
};

const buildEvidence = ({
  deployment,
  alerts,
  incident,
  latestSummary,
  similarIncidents,
  citations,
}) => ({
  liveTelemetry: {
    deployment: deployment
      ? {
          service: deployment.service || deployment.name || null,
          status: deployment.status || null,
          desiredReplicas: deployment.desiredReplicas ?? null,
          readyReplicas: deployment.readyReplicas ?? null,
          unavailableReplicas: deployment.unavailableReplicas ?? null,
        }
      : null,
    firingAlerts: alerts.map((alert) => ({
      name: alert.name || alert.labels?.alertname || null,
      severity: alert.severity || alert.labels?.severity || null,
      activeAt: alert.activeAt || null,
      summary: alert.summary || alert.annotations?.summary || null,
    })),
    incidentRecovery: incident?.recovery || null,
  },
  similarIncidents: similarIncidents.map((item) => ({
    executionId: item?.incident?.executionId || null,
    scenarioId: item?.incident?.scenarioId || null,
    outcome: item?.incident?.outcome || null,
    score: item?.score ?? null,
  })),
  docsAndRunbooks: citations.map((citation) => ({
    path: citation.path,
    section: citation.section,
    excerpt: citation.excerpt,
  })),
  latestIncidentSummary: latestSummary
    ? {
        executionId: latestSummary.execution_id,
        scenarioId: latestSummary.scenario_id,
        outcome: latestSummary.outcome,
        startedAt: latestSummary.started_at,
        endedAt: latestSummary.ended_at,
      }
    : null,
});

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
  const trimmedQuestion = question.trim();
  const intent = classifyIntent(trimmedQuestion);
  const [incident, summaries, deployment] = await Promise.all([
    getIncidentTimelineByService({
      service,
      limit: DEFAULT_INCIDENT_LIMIT,
      lookbackMinutes: DEFAULT_LOOKBACK_MINUTES,
    }),
    listIncidentSummariesByService({
      service,
      limit: 1,
    }),
    getServiceDeploymentSummary(service).catch(() => null),
  ]);
  const latestSummary = summaries[0] || null;

  let alerts = [];
  const warnings = [];
  let similarIncidents = [];
  try {
    const allAlerts = await getAlertsFromPrometheus();
    alerts = allAlerts.filter(
      (alert) => alert.service === service && alert.state === "firing",
    );
  } catch (err) {
    warnings.push(`prometheus alerts unavailable: ${err.message}`);
  }
  try {
    const similarResult = await getSimilarIncidentsByService({
      service,
      limit: MAX_SIMILAR_INCIDENTS,
      anchorExecutionId: null,
    });
    similarIncidents = similarResult.results || [];
    if (Array.isArray(similarResult.warnings)) {
      warnings.push(...similarResult.warnings);
    }
  } catch (err) {
    warnings.push(`similar incident retrieval unavailable: ${err.message}`);
  }

  const advice = buildAdviceBullets({
    incident,
    latestSummary,
    activeAlerts: alerts,
  });
  const confidence = toConfidenceLabel(incident.confidence);
  const scenarioId = incident.incidents?.[0]?.scenarioId || null;
  const citations = await buildCitations({
    question: trimmedQuestion,
    service,
    scenarioId,
    outcome: latestSummary?.outcome || incident.recovery?.outcome || null,
  });
  const clearAnswer = buildClearAnswer({
    intent,
    incident,
    latestSummary,
    alerts,
    deployment,
  });
  const evidence = buildEvidence({
    deployment,
    alerts,
    incident,
    latestSummary,
    similarIncidents,
    citations,
  });
  const unknowns = buildUnknowns({
    latestSummary,
    incident,
    deployment,
    warnings,
    citations,
  });

  return {
    service,
    namespace: CONTROL_PLANE_NAMESPACE,
    question: trimmedQuestion,
    intent,
    confidence,
    answer: clearAnswer,
    advice,
    evidence,
    unknowns,
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
