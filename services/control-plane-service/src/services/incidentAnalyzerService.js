const {
  getAlertsFromPrometheus,
  getHealingHistory,
} = require("./externalReadService");
const { getServiceEvents, getServiceLogs } = require("./kubernetesService");
const {
  listControlPlaneActionsByServiceAndWindow,
} = require("./auditService");
const {
  listExecutionsByService,
} = require("./chaosExecutionRepository");
const {
  upsertIncidentSummaryByExecutionId,
  listIncidentSummariesByService,
} = require("./incidentSummaryRepository");
const {
  upsertSingleIncidentEmbedding,
} = require("./incidentVectorSyncService");

const DEFAULT_LOOKBACK_MINUTES = 30;
const DEFAULT_MAX_INCIDENTS = 10;

const toDate = (value) => {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const textContains = (value, token) =>
  String(value || "").toLowerCase().includes(String(token || "").toLowerCase());

const isWithinWindow = (value, fromDate, toDateBound) => {
  const ts = toDate(value);
  if (!ts) {
    return false;
  }
  return ts.getTime() >= fromDate.getTime() && ts.getTime() <= toDateBound.getTime();
};

const normalizeExecution = (execution) => ({
  executionId: execution.id,
  scenarioId: execution.scenario_id,
  service: execution.service,
  reason: execution.reason || null,
  startedAt: execution.started_at,
  endedAt: execution.reverted_at || execution.expires_at || null,
  status: execution.status,
  result: execution.result,
  revertMode: execution.revert_mode || null,
  metadata: execution.metadata_json || {},
});

const makeBaseCandidates = (execution) => {
  const scenarioLabel = execution.scenarioId || "unknown";
  return [
    {
      key: "chaos_scenario_triggered",
      label: `Scenario ${scenarioLabel} triggered`,
      score: 0.45,
      evidence: ["chaos_execution_record"],
    },
    {
      key: "kubernetes_runtime_symptom",
      label: "Kubernetes runtime symptoms detected",
      score: 0,
      evidence: [],
    },
    {
      key: "prometheus_alert_correlation",
      label: "Prometheus alerts correlated to incident",
      score: 0,
      evidence: [],
    },
    {
      key: "manual_or_healer_recovery_action",
      label: "Recovery actions executed",
      score: 0,
      evidence: [],
    },
  ];
};

const buildTimeline = ({
  execution,
  events,
  alerts,
  auditActions,
  healerActions,
}) => {
  const timeline = [];
  timeline.push({
    timestamp: execution.startedAt,
    type: "chaos_trigger",
    source: "chaos_execution",
    detail: `${execution.scenarioId} triggered for ${execution.service}`,
  });

  for (const event of events) {
    timeline.push({
      timestamp: event.lastTimestamp || event.firstTimestamp || null,
      type: "k8s_event",
      source: "kubernetes",
      detail: `${event.reason || "Event"}: ${event.message || ""}`.trim(),
      severity: event.type || null,
    });
  }

  for (const alert of alerts) {
    timeline.push({
      timestamp: alert.activeAt || null,
      type: "prometheus_alert",
      source: "prometheus",
      detail: `${alert.name || "Alert"} (${alert.state || "unknown"})`,
      severity: alert.severity || null,
    });
  }

  for (const action of auditActions) {
    timeline.push({
      timestamp: action.created_at,
      type: "audit_action",
      source: "control_plane_actions",
      detail: `${action.action || "action"} result=${action.result || "unknown"}${action.reason ? ` reason=${action.reason}` : ""}`,
    });
  }

  for (const healerAction of healerActions) {
    timeline.push({
      timestamp: healerAction.created_at,
      type: "healer_action",
      source: "healer_service",
      detail: `${healerAction.action || "heal"} result=${healerAction.result || "unknown"}${healerAction.reason ? ` reason=${healerAction.reason}` : ""}`,
    });
  }

  if (execution.endedAt) {
    timeline.push({
      timestamp: execution.endedAt,
      type: "scenario_end",
      source: "chaos_execution",
      detail: `${execution.scenarioId} ${execution.status}`,
    });
  }

  return timeline
    .filter((entry) => entry.timestamp)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
};

const scoreCandidates = ({
  execution,
  events,
  logs,
  alerts,
  auditActions,
  healerActions,
}) => {
  const candidates = makeBaseCandidates(execution);
  const runtimeCandidate = candidates[1];
  const alertCandidate = candidates[2];
  const recoveryCandidate = candidates[3];

  const hasK8sWarningEvent = events.some((event) =>
    ["Warning", "Error"].includes(event.type),
  );
  const k8sFailureHints = events.some((event) =>
    ["Failed", "BackOff", "Unhealthy", "Killing"].some((token) =>
      textContains(event.reason, token),
    ),
  );
  const logHints = (logs.entries || []).some((entry) =>
    ["error", "exception", "timeout", "connection refused", "crash"].some((token) =>
      textContains(entry.log, token),
    ),
  );

  if (hasK8sWarningEvent) {
    runtimeCandidate.score += 0.15;
    runtimeCandidate.evidence.push("k8s_warning_event");
  }
  if (k8sFailureHints) {
    runtimeCandidate.score += 0.2;
    runtimeCandidate.evidence.push("k8s_failure_reason");
  }
  if (logHints) {
    runtimeCandidate.score += 0.15;
    runtimeCandidate.evidence.push("service_log_error_pattern");
  }

  const activeAlerts = alerts.filter((alert) => alert.state === "firing");
  if (activeAlerts.length > 0) {
    alertCandidate.score += 0.2;
    alertCandidate.evidence.push("prometheus_firing_alert");
  }
  if (activeAlerts.some((alert) => textContains(alert.name, "down"))) {
    alertCandidate.score += 0.1;
    alertCandidate.evidence.push("prometheus_service_down");
  }
  if (activeAlerts.some((alert) => textContains(alert.name, "latency"))) {
    alertCandidate.score += 0.05;
    alertCandidate.evidence.push("prometheus_latency_alert");
  }

  const successfulAuditActions = auditActions.filter((action) => action.result === "success");
  const healerSuccessActions = healerActions.filter((action) => action.result === "success");
  const healerFailedActions = healerActions.filter((action) =>
    ["failed", "error"].includes(String(action.result || "").toLowerCase()),
  );

  if (successfulAuditActions.length > 0) {
    recoveryCandidate.score += 0.1;
    recoveryCandidate.evidence.push("manual_action_success");
  }
  if (healerSuccessActions.length > 0) {
    recoveryCandidate.score += 0.2;
    recoveryCandidate.evidence.push("healer_action_success");
  }
  if (healerFailedActions.length > 0) {
    recoveryCandidate.score += 0.05;
    recoveryCandidate.evidence.push("healer_action_failure_observed");
  }

  return candidates
    .map((candidate) => ({
      ...candidate,
      score: Number(clamp(candidate.score, 0, 0.99).toFixed(4)),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);
};

const deriveRecovery = ({ execution, healerActions, auditActions }) => {
  const healerSuccess = healerActions.some((action) => action.result === "success");
  const manualSuccess = auditActions.some(
    (action) =>
      action.action === "scale" &&
      action.result === "success" &&
      isWithinWindow(action.created_at, toDate(execution.startedAt), toDate(execution.endedAt || execution.startedAt) || new Date()),
  );

  if (execution.status === "active") {
    return {
      state: "in_progress",
      outcome: "scenario_active",
      by: "none",
    };
  }

  if (healerSuccess || manualSuccess || execution.result === "success") {
    return {
      state: "recovered",
      outcome: "service_recovered",
      by: healerSuccess ? "healer" : manualSuccess ? "manual" : "auto_revert",
    };
  }

  return {
    state: "degraded",
    outcome: "recovery_unconfirmed",
    by: "unknown",
  };
};

const pickPrimarySymptom = ({ events, alerts, logs }) => {
  const firstWarning = events.find((event) => event.type === "Warning");
  if (firstWarning?.message) {
    return firstWarning.message;
  }

  const firingAlert = alerts.find((alert) => alert.state === "firing");
  if (firingAlert?.name) {
    return `Alert firing: ${firingAlert.name}`;
  }

  const erroredLog = (logs.entries || []).find((entry) =>
    textContains(entry.log, "error"),
  );
  if (erroredLog?.log) {
    return "Service logs include error patterns";
  }

  return "No dominant symptom detected";
};

const computeIncidentForExecution = async ({
  execution,
  lookbackMinutes,
}) => {
  const warnings = [];
  const start = toDate(execution.startedAt) || new Date();
  const end = toDate(execution.endedAt) || new Date(start.getTime() + lookbackMinutes * 60 * 1000);
  const fromDate = new Date(start.getTime() - lookbackMinutes * 60 * 1000);
  const toDateBound = new Date(end.getTime() + lookbackMinutes * 60 * 1000);

  let events = [];
  let logs = { entries: [] };
  let alerts = [];
  let auditActions = [];
  let healerActions = [];

  try {
    events = await getServiceEvents(execution.service);
  } catch (err) {
    warnings.push(`k8s events unavailable: ${err.message}`);
  }

  try {
    logs = await getServiceLogs(execution.service, { tailLines: 200, maxPods: 2 });
  } catch (err) {
    warnings.push(`service logs unavailable: ${err.message}`);
  }

  try {
    const allAlerts = await getAlertsFromPrometheus();
    alerts = allAlerts.filter(
      (alert) =>
        alert.service === execution.service &&
        (!alert.activeAt || isWithinWindow(alert.activeAt, fromDate, toDateBound)),
    );
  } catch (err) {
    warnings.push(`prometheus alerts unavailable: ${err.message}`);
  }

  try {
    auditActions = await listControlPlaneActionsByServiceAndWindow({
      service: execution.service,
      from: fromDate.toISOString(),
      to: toDateBound.toISOString(),
      limit: 200,
    });
  } catch (err) {
    warnings.push(`audit actions unavailable: ${err.message}`);
  }

  try {
    const healerHistory = await getHealingHistory({
      deployment: execution.service,
      from: fromDate.toISOString(),
      to: toDateBound.toISOString(),
      limit: 100,
      page: 1,
      sort: "asc",
    });
    healerActions = healerHistory.actions || [];
  } catch (err) {
    warnings.push(`healer history unavailable: ${err.message}`);
  }

  const timeline = buildTimeline({
    execution,
    events,
    alerts,
    auditActions,
    healerActions,
  });

  const probableCauseCandidates = scoreCandidates({
    execution,
    events,
    logs,
    alerts,
    auditActions,
    healerActions,
  });
  const topCandidate = probableCauseCandidates[0] || null;

  const confidence = Number(
    clamp(
      topCandidate ? topCandidate.score : 0.2,
      0,
      0.99,
    ).toFixed(4),
  );

  const recovery = deriveRecovery({
    execution,
    healerActions,
    auditActions,
  });

  const symptom = pickPrimarySymptom({ events, alerts, logs });
  const probableCause = topCandidate ? topCandidate.label : "No probable cause candidates";
  const healerAction = healerActions[healerActions.length - 1]?.action || null;

  const incident = {
    executionId: execution.executionId,
    service: execution.service,
    scenarioId: execution.scenarioId,
    startedAt: execution.startedAt,
    endedAt: execution.endedAt,
    symptom,
    probableCause,
    confidence,
    healerAction,
    outcome: recovery.outcome,
    timeline,
    probableCauseCandidates,
    recovery,
    warnings,
  };

  const persistedSummary = await upsertIncidentSummaryByExecutionId({
    executionId: incident.executionId,
    service: incident.service,
    scenarioId: incident.scenarioId,
    startedAt: incident.startedAt,
    endedAt: incident.endedAt,
    symptom: incident.symptom,
    probableCause: incident.probableCause,
    confidence: incident.confidence,
    healerAction: incident.healerAction,
    outcome: incident.outcome,
    timelineJson: incident.timeline,
  });

  try {
    await upsertSingleIncidentEmbedding(persistedSummary);
  } catch (err) {
    warnings.push(`incident embedding upsert failed: ${err.message}`);
  }

  return incident;
};

const getIncidentTimelineByService = async ({
  service,
  limit = DEFAULT_MAX_INCIDENTS,
  lookbackMinutes = DEFAULT_LOOKBACK_MINUTES,
}) => {
  const normalizedLookback = clamp(
    Number.parseInt(lookbackMinutes, 10) || DEFAULT_LOOKBACK_MINUTES,
    5,
    180,
  );
  const normalizedLimit = clamp(
    Number.parseInt(limit, 10) || DEFAULT_MAX_INCIDENTS,
    1,
    20,
  );

  const executions = await listExecutionsByService({
    service,
    limit: normalizedLimit,
  });

  if (!executions.length) {
    return {
      service,
      generatedAt: new Date().toISOString(),
      timeline: [],
      probableCauseCandidates: [],
      confidence: 0,
      recovery: {
        state: "no_incidents",
        outcome: "no_incidents",
        by: "none",
      },
      warnings: [],
      incidents: [],
    };
  }

  const incidents = [];
  for (const executionRow of executions) {
    const normalized = normalizeExecution(executionRow);
    const incident = await computeIncidentForExecution({
      execution: normalized,
      lookbackMinutes: normalizedLookback,
    });
    incidents.push(incident);
  }

  const latestIncident = incidents[0];
  const mergedTimeline = incidents
    .flatMap((item) => item.timeline)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const candidateScores = new Map();
  for (const incident of incidents) {
    for (const candidate of incident.probableCauseCandidates) {
      const existing = candidateScores.get(candidate.key) || {
        key: candidate.key,
        label: candidate.label,
        score: 0,
        evidence: new Set(),
      };
      existing.score += candidate.score;
      for (const evidence of candidate.evidence || []) {
        existing.evidence.add(evidence);
      }
      candidateScores.set(candidate.key, existing);
    }
  }

  const probableCauseCandidates = Array.from(candidateScores.values())
    .map((entry) => ({
      key: entry.key,
      label: entry.label,
      score: Number(clamp(entry.score / incidents.length, 0, 0.99).toFixed(4)),
      evidence: Array.from(entry.evidence).sort(),
    }))
    .sort((a, b) => b.score - a.score);

  const summaryConfidence = probableCauseCandidates[0]?.score || latestIncident.confidence || 0;
  const warnings = Array.from(
    new Set(incidents.flatMap((incident) => incident.warnings || [])),
  ).sort();

  const persisted = await listIncidentSummariesByService({
    service,
    limit: normalizedLimit,
  });

  return {
    service,
    generatedAt: new Date().toISOString(),
    timeline: mergedTimeline,
    probableCauseCandidates,
    confidence: Number(clamp(summaryConfidence, 0, 0.99).toFixed(4)),
    recovery: latestIncident.recovery,
    warnings,
    incidents: incidents.map((incident) => ({
      executionId: incident.executionId,
      scenarioId: incident.scenarioId,
      startedAt: incident.startedAt,
      endedAt: incident.endedAt,
      symptom: incident.symptom,
      probableCause: incident.probableCause,
      confidence: incident.confidence,
      outcome: incident.outcome,
    })),
    persistedSummaries: persisted.length,
  };
};

module.exports = {
  getIncidentTimelineByService,
  _internal: {
    buildTimeline,
    scoreCandidates,
    deriveRecovery,
  },
};
