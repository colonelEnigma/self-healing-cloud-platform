const axios = require("axios");
const {
  CONTROL_PLANE_NAMESPACE,
  ALLOWED_APP_DEPLOYMENTS,
  isAllowedDeployment,
} = require("../config/allowlist");
const {
  AI_ASSISTANT_MODES,
  LM_STUDIO_BASE_URL,
  LM_STUDIO_MODEL,
  LM_STUDIO_TIMEOUT_MS,
  CONTROL_PLANE_CONTEXT_BASE_URL,
  AI_CONTEXT_LIMITS,
} = require("../config/ai");
const {
  getAllowlistedDeploymentSummaries,
  getServiceDeploymentSummary,
  getServiceEvents,
  getServiceLogs,
} = require("./kubernetesService");
const {
  getServiceHealthFromPrometheus,
  getAlertsFromPrometheus,
  getHealingHistory,
  getOrderServiceResilience,
} = require("./externalReadService");
const { listControlPlaneActions } = require("./auditService");
const {
  HEALER_SERVICE_DOWN_POLICY,
  MANUAL_SCALE_GUARD,
} = require("../config/resilience");

const lmStudioClient = axios.create({
  baseURL: LM_STUDIO_BASE_URL.replace(/\/$/, ""),
  timeout: LM_STUDIO_TIMEOUT_MS,
});

const contextClient = CONTROL_PLANE_CONTEXT_BASE_URL
  ? axios.create({
      baseURL: CONTROL_PLANE_CONTEXT_BASE_URL.replace(/\/$/, ""),
      timeout: 12000,
    })
  : null;

const truncateText = (value, maxCharacters) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text || text.length <= maxCharacters) {
    return text;
  }

  return `${text.slice(0, maxCharacters)}\n[truncated ${text.length - maxCharacters} characters]`;
};

const safeRead = async (label, reader, warnings) => {
  try {
    return await reader();
  } catch (err) {
    warnings.push(`${label} unavailable: ${err.message}`);
    return null;
  }
};

const compactDeployment = (deployment = {}) => ({
  service: deployment.service || deployment.name || deployment.metadata?.name || null,
  namespace: deployment.namespace || deployment.metadata?.namespace || null,
  status: deployment.status || null,
  desiredReplicas: deployment.desiredReplicas ?? deployment.spec?.replicas ?? null,
  readyReplicas: deployment.readyReplicas ?? deployment.status?.readyReplicas ?? null,
  availableReplicas:
    deployment.availableReplicas ?? deployment.status?.availableReplicas ?? null,
  unavailableReplicas:
    deployment.unavailableReplicas ?? deployment.status?.unavailableReplicas ?? null,
  image: deployment.image || null,
});

const compactAlert = (alert = {}) => ({
  state: alert.state || null,
  name: alert.name || alert.labels?.alertname || null,
  service: alert.service || alert.labels?.service || alert.labels?.deployment || null,
  namespace: alert.namespace || alert.labels?.namespace || null,
  severity: alert.severity || alert.labels?.severity || null,
  summary: alert.summary || alert.annotations?.summary || null,
  activeAt: alert.activeAt || null,
});

const compactAction = (action = {}) => ({
  service: action.service || action.deployment || null,
  namespace: action.namespace || null,
  action: action.action || action.alert_name || null,
  result: action.result || null,
  reason: action.reason || null,
  createdAt: action.created_at || action.createdAt || null,
});

const compactOverview = (overview = {}) => ({
  namespace: overview.namespace || overview.namespaceScope || CONTROL_PLANE_NAMESPACE,
  generatedAt: overview.generatedAt || null,
  serviceCounts: overview.serviceCounts || null,
  deployments: (overview.deployments || []).map(compactDeployment),
  prometheusHealth: overview.prometheusHealth || {},
  activeAlerts: (overview.activeAlerts || overview.alerts || []).map(compactAlert),
  recentHealingActions: (overview.recentHealingActions || [])
    .slice(0, AI_CONTEXT_LIMITS.overviewRecentItems)
    .map(compactAction),
  recentManualActions: (overview.recentManualActions || [])
    .slice(0, AI_CONTEXT_LIMITS.overviewRecentItems)
    .map(compactAction),
  warnings: overview.warnings || [],
});

const normalizeMode = (mode) =>
  AI_ASSISTANT_MODES.includes(mode) ? mode : "platform-summary";

const validateAiChatRequest = ({ mode, service, question }) => {
  if (mode && !AI_ASSISTANT_MODES.includes(mode)) {
    return {
      valid: false,
      status: 400,
      message: "Unsupported AI assistant mode",
      allowedModes: AI_ASSISTANT_MODES,
    };
  }

  if (service && !isAllowedDeployment(service)) {
    return {
      valid: false,
      status: 400,
      message: "Service is not allowlisted for control plane AI context",
      service,
      allowedDeployments: ALLOWED_APP_DEPLOYMENTS,
    };
  }

  if (
    typeof question !== "string" ||
    !question.trim() ||
    question.length > AI_CONTEXT_LIMITS.maxQuestionCharacters
  ) {
    return {
      valid: false,
      status: 400,
      message: `Question is required and must be ${AI_CONTEXT_LIMITS.maxQuestionCharacters} characters or fewer`,
    };
  }

  return { valid: true };
};

const buildOverviewContext = async (warnings) => {
  const deployments =
    (await safeRead(
      "deployments",
      () => getAllowlistedDeploymentSummaries(),
      warnings,
    )) || [];
  const serviceHealth =
    (await safeRead(
      "prometheus health",
      () => getServiceHealthFromPrometheus(),
      warnings,
    )) || {};
  const activeAlerts =
    (await safeRead(
      "prometheus alerts",
      () => getAlertsFromPrometheus(),
      warnings,
    )) || [];
  const recentHealingActions =
    (await safeRead(
      "healer history",
      () =>
        getHealingHistory({
          limit: AI_CONTEXT_LIMITS.overviewRecentItems,
          page: 1,
        }),
      warnings,
    )) || { actions: [] };
  const recentManualActions =
    (await safeRead(
      "manual action audit",
      () =>
        listControlPlaneActions({
          limit: AI_CONTEXT_LIMITS.overviewRecentItems,
          page: 1,
        }),
      warnings,
    )) || { actions: [] };

  return {
    deployments: deployments.map(compactDeployment),
    serviceHealth,
    activeAlerts: activeAlerts.map(compactAlert),
    recentHealingActions: recentHealingActions.actions || [],
    recentManualActions: recentManualActions.actions || [],
  };
};

const buildServiceContext = async (service, mode, warnings) => {
  if (!service) {
    return null;
  }

  const deployment = await safeRead(
    `${service} deployment`,
    () => getServiceDeploymentSummary(service),
    warnings,
  );
  const events =
    (await safeRead(`${service} events`, () => getServiceEvents(service), warnings)) ||
    [];
  const healingHistory =
    (await safeRead(
      `${service} healing history`,
      () =>
        getHealingHistory({
          namespace: CONTROL_PLANE_NAMESPACE,
          deployment: service,
          limit: AI_CONTEXT_LIMITS.healingHistoryLimit,
        }),
      warnings,
    )) || { actions: [] };

  let logs = null;
  if (["incident-summary", "service-diagnostics", "logs"].includes(mode)) {
    logs = await safeRead(
      `${service} logs`,
      () =>
        getServiceLogs(service, {
          tailLines: AI_CONTEXT_LIMITS.serviceLogTailLines,
          maxPods: 2,
        }),
      warnings,
    );

    if (logs) {
      logs = {
        ...logs,
        entries: (logs.entries || []).map((entry) => ({
          ...entry,
          log: truncateText(entry.log || "", AI_CONTEXT_LIMITS.maxLogCharacters),
        })),
      };
    }
  }

  return {
    service,
    deployment,
    events,
    healingHistory: healingHistory.actions || [],
    logs,
  };
};

const buildResilienceContext = async (warnings) => {
  const healingHistory =
    (await safeRead(
      "ServiceDown healing history",
      () =>
        getHealingHistory({
          alertName: HEALER_SERVICE_DOWN_POLICY.alertName,
          limit: 50,
          page: 1,
        }),
      warnings,
    )) || { actions: [] };
  const orderServiceResilience = await safeRead(
    "order-service resilience",
    () => getOrderServiceResilience(),
    warnings,
  );

  return {
    healerServiceDownPolicy: {
      ...HEALER_SERVICE_DOWN_POLICY,
      allowedNamespaces: [CONTROL_PLANE_NAMESPACE],
      allowedDeployments: ALLOWED_APP_DEPLOYMENTS,
      recentActions: healingHistory.actions || [],
    },
    orderProductCircuitBreaker: orderServiceResilience,
    manualScaleGuard: {
      ...MANUAL_SCALE_GUARD,
      namespace: CONTROL_PLANE_NAMESPACE,
      allowedDeployments: ALLOWED_APP_DEPLOYMENTS,
    },
  };
};

const buildAuditContext = async (service, warnings) => {
  const data =
    (await safeRead(
      "manual action audit",
      () =>
        listControlPlaneActions({
          service,
          limit: AI_CONTEXT_LIMITS.auditLimit,
          page: 1,
        }),
      warnings,
    )) || { actions: [] };

  return data.actions || [];
};

const remoteRead = async (label, path, authHeader, warnings, params = {}) => {
  if (!contextClient) {
    return null;
  }

  return safeRead(
    label,
    async () => {
      const response = await contextClient.get(path, {
        headers: authHeader ? { Authorization: authHeader } : {},
        params,
      });
      return response.data;
    },
    warnings,
  );
};

const buildRemoteAiContext = async ({ mode, service, authHeader }) => {
  const warnings = [];
  const contextUsed = ["overview"];
  const overview = await remoteRead(
    "prod overview",
    "/overview",
    authHeader,
    warnings,
  );
  const context = {
    namespace: CONTROL_PLANE_NAMESPACE,
    allowedDeployments: ALLOWED_APP_DEPLOYMENTS,
    generatedAt: new Date().toISOString(),
    contextSource: CONTROL_PLANE_CONTEXT_BASE_URL,
    overview: overview ? compactOverview(overview) : null,
  };

  if (service) {
    context.service = await remoteRead(
      `prod ${service} detail`,
      `/services/${service}`,
      authHeader,
      warnings,
    );
    contextUsed.push("service", "events", "healing-history");

    if (["incident-summary", "service-diagnostics", "logs"].includes(mode)) {
      context.logs = await remoteRead(
        `prod ${service} logs`,
        `/logs/${service}`,
        authHeader,
        warnings,
        { tailLines: AI_CONTEXT_LIMITS.serviceLogTailLines },
      );
      if (context.logs) {
        context.logs = {
          ...context.logs,
          entries: (context.logs.entries || []).map((entry) => ({
            ...entry,
            log: truncateText(entry.log || "", AI_CONTEXT_LIMITS.maxLogCharacters),
          })),
        };
        contextUsed.push("logs");
      }
    }
  }

  if (["incident-summary", "resilience", "runbook"].includes(mode)) {
    context.resilience = await remoteRead(
      "prod resilience",
      "/resilience",
      authHeader,
      warnings,
    );
    contextUsed.push("resilience");
  }

  if (["audit-summary", "runbook"].includes(mode)) {
    context.audit = await remoteRead(
      "prod manual action audit",
      "/actions",
      authHeader,
      warnings,
      {
        service,
        limit: AI_CONTEXT_LIMITS.auditLimit,
        page: 1,
      },
    );
    contextUsed.push("audit");
  }

  return {
    context,
    contextUsed: [...new Set(contextUsed)],
    warnings,
  };
};

const buildAiContext = async ({ mode, service, authHeader }) => {
  if (contextClient) {
    return buildRemoteAiContext({ mode, service, authHeader });
  }

  const warnings = [];
  const contextUsed = ["overview"];
  const context = {
    namespace: CONTROL_PLANE_NAMESPACE,
    allowedDeployments: ALLOWED_APP_DEPLOYMENTS,
    generatedAt: new Date().toISOString(),
    overview: await buildOverviewContext(warnings),
  };

  if (service) {
    context.service = await buildServiceContext(service, mode, warnings);
    contextUsed.push("service", "events", "healing-history");
    if (context.service?.logs) {
      contextUsed.push("logs");
    }
  }

  if (["incident-summary", "resilience", "runbook"].includes(mode)) {
    context.resilience = await buildResilienceContext(warnings);
    contextUsed.push("resilience");
  }

  if (["audit-summary", "runbook"].includes(mode)) {
    context.audit = await buildAuditContext(service, warnings);
    contextUsed.push("audit");
  }

  return {
    context,
    contextUsed: [...new Set(contextUsed)],
    warnings,
  };
};

const buildMessages = ({ mode, service, question, context }) => {
  const contextText = truncateText(
    JSON.stringify(context, null, 2),
    AI_CONTEXT_LIMITS.maxPromptCharacters,
  );

  return [
    {
      role: "system",
      content: [
        "You are the CloudPulse Control Plane AI assistant.",
        "Use only the provided live prod control-plane context.",
        "Be concise, operational, and specific.",
        "This is a read-only assistant: do not claim you can scale, deploy, roll back, delete, mutate Kafka, mutate databases, read secrets, or change Kubernetes resources.",
        "If context is missing or warnings are present, say what is unknown.",
        `Allowed prod app deployments: ${ALLOWED_APP_DEPLOYMENTS.join(", ")}.`,
      ].join(" "),
    },
    {
      role: "user",
      content: [
        `Mode: ${mode}`,
        `Selected service: ${service || "none"}`,
        `Question: ${question.trim()}`,
        "Live context:",
        contextText,
      ].join("\n\n"),
    },
  ];
};

const chatWithLmStudio = async ({ mode, service, question, authHeader }) => {
  const normalizedMode = normalizeMode(mode);
  const { context, contextUsed, warnings } = await buildAiContext({
    mode: normalizedMode,
    service,
    authHeader,
  });
  const messages = buildMessages({
    mode: normalizedMode,
    service,
    question,
    context,
  });

  const response = await lmStudioClient.post("/chat/completions", {
    model: LM_STUDIO_MODEL,
    messages,
    temperature: 0.2,
    max_tokens: 700,
  });
  const answer = response.data?.choices?.[0]?.message?.content;

  if (!answer) {
    throw new Error("LM Studio returned no assistant message");
  }

  return {
    model: LM_STUDIO_MODEL,
    mode: normalizedMode,
    service: service || null,
    answer,
    contextUsed,
    warnings,
    generatedAt: new Date().toISOString(),
  };
};

const getAiAssistantStatus = () => ({
  provider: "lm-studio",
  model: LM_STUDIO_MODEL,
  baseUrlConfigured: Boolean(process.env.LM_STUDIO_BASE_URL),
  defaultBaseUrl: process.env.LM_STUDIO_BASE_URL ? null : LM_STUDIO_BASE_URL,
  contextBaseUrlConfigured: Boolean(CONTROL_PLANE_CONTEXT_BASE_URL),
  contextBaseUrl: CONTROL_PLANE_CONTEXT_BASE_URL || null,
  modes: AI_ASSISTANT_MODES,
  readOnly: true,
  mutationEndpointsAdded: false,
});

module.exports = {
  validateAiChatRequest,
  chatWithLmStudio,
  getAiAssistantStatus,
};
