const {
  CONTROL_PLANE_NAMESPACE,
  ALLOWED_APP_DEPLOYMENTS,
  isAllowedDeployment,
} = require("../config/allowlist");
const { mcpConfig } = require("../config/mcp");
const { getAlertsFromPrometheus } = require("./externalReadService");
const { getIncidentTimelineByService } = require("./incidentAnalyzerService");
const { getServiceDeploymentSummary } = require("./kubernetesService");
const { getSimilarIncidentsByService } = require("./similarIncidentService");
const { listIncidentSummariesByService } = require("./incidentSummaryRepository");
const mcpDataGateway = require("../mcp/gateway/mcpDataGateway");

const MAX_QUESTION_CHARACTERS = 800;
const DEFAULT_INCIDENT_LIMIT = 1;
const DEFAULT_LOOKBACK_MINUTES = 15;
const MAX_CITATIONS = 6;
const MAX_SIMILAR_INCIDENTS = 3;

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
  if (/\b(root cause|why|cause|failure|failed|incident|what happened)\b/.test(normalized)) {
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
  const outcome = latestSummary?.outcome || incident?.recovery?.outcome || "unknown_outcome";
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

const buildEvidence = ({ deployment, alerts, incident, latestSummary, similarIncidents, citations }) => ({
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

  if (typeof question !== "string" || !question.trim() || question.length > MAX_QUESTION_CHARACTERS) {
    return {
      valid: false,
      status: 400,
      message: `question is required and must be ${MAX_QUESTION_CHARACTERS} characters or fewer`,
    };
  }

  return { valid: true };
};

const buildAdviceBullets = ({ incident, latestSummary, activeAlerts }) => {
  const bullets = [];

  if (incident?.probableCauseCandidates?.length) {
    const top = incident.probableCauseCandidates[0];
    bullets.push(`Primary signal: ${top.label} (${Math.round(top.score * 100)}% evidence alignment).`);
  }

  if (latestSummary?.outcome === "service_recovered") {
    bullets.push("Service appears recovered; continue monitoring for alert re-fire during the next 15 minutes.");
  } else if (incident?.recovery?.state === "in_progress") {
    bullets.push("Incident is still active; monitor recovery progression and avoid concurrent manual mutations.");
  } else {
    bullets.push("Recovery is unconfirmed; verify deployment/pod health and recent control-plane actions before escalation.");
  }

  if (activeAlerts.length > 0) {
    bullets.push(`Prometheus still shows ${activeAlerts.length} firing alert(s) for this service; prioritize alert-specific runbook checks.`);
  } else {
    bullets.push("No firing Prometheus alerts currently match this service.");
  }

  return bullets;
};

const getCoreContextFallback = ({ service }) =>
  Promise.all([
    getIncidentTimelineByService({
      service,
      limit: DEFAULT_INCIDENT_LIMIT,
      lookbackMinutes: DEFAULT_LOOKBACK_MINUTES,
    }),
    listIncidentSummariesByService({ service, limit: 1 }),
  ]).then(([incident, summaries]) => ({ incident, summaries }));

const getCoreContextMcp = ({ service, traceId }) =>
  Promise.all([
    mcpDataGateway.getIncidentTimeline({
      service,
      limit: DEFAULT_INCIDENT_LIMIT,
      lookbackMinutes: DEFAULT_LOOKBACK_MINUTES,
      traceId,
    }),
    mcpDataGateway.getIncidentSummaries({ service, limit: 1, traceId }),
  ]).then(([incident, summaries]) => ({ incident, summaries }));

const getOpsAdvice = async ({ service, question }) => {
  const trimmedQuestion = question.trim();
  const intent = classifyIntent(trimmedQuestion);
  const traceId = `ops-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const warnings = [];

  const { incident, summaries } = mcpConfig.opsAdviceEnabled
    ? await getCoreContextMcp({ service, traceId })
    : await getCoreContextFallback({ service });
  const latestSummary = summaries[0] || null;

  const [deployment, similarResult] = await Promise.all([
    (mcpConfig.opsAdviceEnabled
      ? mcpDataGateway.getDeploymentState({ service, traceId })
      : getServiceDeploymentSummary(service)
    ).catch(() => null),
    getSimilarIncidentsByService({
      service,
      limit: MAX_SIMILAR_INCIDENTS,
      anchorExecutionId: null,
    }).catch((err) => {
      warnings.push(`similar incident retrieval unavailable: ${err.message}`);
      return { results: [], warnings: [] };
    }),
  ]);

  let alerts = [];
  if (mcpConfig.opsAdviceEnabled) {
    try {
      alerts = (await mcpDataGateway.getAlerts({ service, traceId })).filter(
        (alert) => alert.state === "firing",
      );
    } catch (err) {
      warnings.push(`prometheus alerts unavailable: ${err.message}`);
    }
  } else {
    try {
      const allAlerts = await getAlertsFromPrometheus();
      alerts = allAlerts.filter((alert) => alert.service === service && alert.state === "firing");
    } catch (err) {
      warnings.push(`prometheus alerts unavailable: ${err.message}`);
    }
  }

  const similarIncidents = similarResult.results || [];
  if (Array.isArray(similarResult.warnings)) {
    warnings.push(...similarResult.warnings);
  }

  let citations = [];
  if (mcpConfig.opsAdviceEnabled) {
    try {
      citations = await mcpDataGateway.getDocEvidence({
        question: trimmedQuestion,
        service,
        scenarioId: incident.incidents?.[0]?.scenarioId || null,
        outcome: latestSummary?.outcome || incident.recovery?.outcome || null,
        intent,
        maxResults: MAX_CITATIONS,
        traceId,
      });
      if (
        intent === "runbook_lookup" &&
        citations.length > 0 &&
        citations.every((citation) => Number(citation.score || 0) === 0)
      ) {
        warnings.push(
          "runbook_lookup fallback citations were returned with low lexical confidence; verify against live service state before acting.",
        );
      }
    } catch (err) {
      warnings.push(`docs retrieval unavailable: ${err.message}`);
    }
  }

  const advice = buildAdviceBullets({ incident, latestSummary, activeAlerts: alerts });
  const confidence = toConfidenceLabel(incident.confidence);
  const clearAnswer = buildClearAnswer({ intent, incident, latestSummary, alerts, deployment });
  const evidence = buildEvidence({
    deployment,
    alerts,
    incident,
    latestSummary,
    similarIncidents,
    citations,
  });
  const unknowns = buildUnknowns({ latestSummary, incident, deployment, warnings, citations });

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
