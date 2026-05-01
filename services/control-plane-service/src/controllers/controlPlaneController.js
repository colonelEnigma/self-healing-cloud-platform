const {
  CONTROL_PLANE_NAMESPACE,
  ALLOWED_APP_DEPLOYMENTS,
  isAllowedDeployment,
} = require("../config/allowlist");
const {
  getAllowlistedDeploymentSummaries,
  getServiceDeploymentSummary,
  listReplicaSetsByService,
  getServiceEvents,
  getServiceLogs,
  scaleServiceDeployment,
} = require("../services/kubernetesService");
const {
  recordControlPlaneAction,
  listControlPlaneActions,
} = require("../services/auditService");
const {
  getServiceHealthFromPrometheus,
  getAlertsFromPrometheus,
  getHealingHistory,
  getOrderServiceResilience,
} = require("../services/externalReadService");
const {
  HEALER_SERVICE_DOWN_POLICY,
  MANUAL_SCALE_GUARD,
} = require("../config/resilience");

const clampInteger = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
};

const getK8sErrorStatus = (err) => {
  const statusCandidate =
    err?.statusCode ||
    err?.response?.statusCode ||
    err?.response?.status ||
    err?.body?.code;

  if (Number.isInteger(statusCandidate) && statusCandidate >= 400) {
    return statusCandidate;
  }

  return 503;
};

const recordActionAndRespondIfAuditFails = async (res, payload) => {
  try {
    const audit = await recordControlPlaneAction(payload);
    return { ok: true, audit };
  } catch (auditErr) {
    return res.status(500).json({
      message: "Failed to write control plane audit record",
      error: auditErr.message,
    });
  }
};

const buildActionPayload = (req, body = {}) => ({
  userId: req.user?.id || null,
  userEmail: req.user?.email || null,
  namespace: body.namespace || CONTROL_PLANE_NAMESPACE,
  service: body.service || "unknown",
  action: "scale",
  requestedReplicas:
    Number.isInteger(body.requestedReplicas) ? body.requestedReplicas : null,
  previousReplicas:
    Number.isInteger(body.previousReplicas) ? body.previousReplicas : null,
  result: body.result || "error",
  reason: body.reason || null,
});

const getStatus = (req, res) => {
  res.status(200).json({
    service: "control-plane-service",
    status: "ready",
    namespaceScope: CONTROL_PLANE_NAMESPACE,
    allowedDeployments: ALLOWED_APP_DEPLOYMENTS,
  });
};

const getOverview = async (req, res) => {
  try {
    const deployments = await getAllowlistedDeploymentSummaries();
    const warnings = [];
    let serviceHealth = {};
    let alerts = [];
    let healingHistory = { actions: [] };
    let manualActions = { actions: [] };

    try {
      serviceHealth = await getServiceHealthFromPrometheus();
    } catch (err) {
      warnings.push(`prometheus health unavailable: ${err.message}`);
    }

    try {
      alerts = await getAlertsFromPrometheus();
    } catch (err) {
      warnings.push(`prometheus alerts unavailable: ${err.message}`);
    }

    try {
      healingHistory = await getHealingHistory({ limit: 5, page: 1 });
    } catch (err) {
      warnings.push(`healer history unavailable: ${err.message}`);
    }

    try {
      manualActions = await listControlPlaneActions({ limit: 5, page: 1 });
    } catch (err) {
      warnings.push(`manual action audit unavailable: ${err.message}`);
    }

    const totalServices = deployments.length;
    const healthyServices = deployments.filter(
      (deployment) => deployment.status === "healthy",
    ).length;
    const degradedServices = deployments.filter((deployment) =>
      ["degraded", "not_found"].includes(deployment.status),
    ).length;
    const scaledDownServices = deployments.filter(
      (deployment) => deployment.status === "scaled_down",
    ).length;

    return res.status(200).json({
      namespace: CONTROL_PLANE_NAMESPACE,
      generatedAt: new Date().toISOString(),
      serviceCounts: {
        total: totalServices,
        healthy: healthyServices,
        degraded: degradedServices,
        scaledDown: scaledDownServices,
      },
      deployments,
      prometheusHealth: serviceHealth,
      activeAlerts: alerts,
      recentHealingActions: healingHistory.actions || [],
      recentManualActions: manualActions.actions || [],
      warnings,
    });
  } catch (err) {
    return res.status(getK8sErrorStatus(err)).json({
      message: "Failed to load control plane overview",
      error: err.message,
    });
  }
};

const getDeployments = async (req, res) => {
  try {
    const deployments = await getAllowlistedDeploymentSummaries();
    let serviceHealth = {};
    let warning = null;

    try {
      serviceHealth = await getServiceHealthFromPrometheus();
    } catch (err) {
      warning = `prometheus health unavailable: ${err.message}`;
    }

    return res.status(200).json({
      namespace: CONTROL_PLANE_NAMESPACE,
      count: deployments.length,
      deployments,
      prometheusHealth: serviceHealth,
      warning,
    });
  } catch (err) {
    return res.status(getK8sErrorStatus(err)).json({
      message: "Failed to fetch prod deployments",
      error: err.message,
    });
  }
};

const getServiceDetail = async (req, res) => {
  const { service } = req.params;

  try {
    const deployment = await getServiceDeploymentSummary(service);
    const [replicaSets, events] = await Promise.all([
      listReplicaSetsByService(service),
      getServiceEvents(service),
    ]);

    let health = null;
    let healingHistory = [];
    const warnings = [];

    try {
      const healthByService = await getServiceHealthFromPrometheus();
      health = healthByService[service] || null;
    } catch (err) {
      warnings.push(`prometheus health unavailable: ${err.message}`);
    }

    try {
      const history = await getHealingHistory({
        namespace: CONTROL_PLANE_NAMESPACE,
        deployment: service,
        limit: 10,
      });
      healingHistory = history.actions || [];
    } catch (err) {
      warnings.push(`healer history unavailable: ${err.message}`);
    }

    return res.status(200).json({
      namespace: CONTROL_PLANE_NAMESPACE,
      service,
      deployment,
      replicaSets,
      events,
      health,
      healingHistory,
      warnings,
    });
  } catch (err) {
    return res.status(getK8sErrorStatus(err)).json({
      message: `Failed to fetch details for ${service}`,
      error: err.message,
    });
  }
};

const getHealingHistoryHandler = async (req, res) => {
  const deployment = req.query.deployment;

  if (deployment && !isAllowedDeployment(deployment)) {
    return res.status(400).json({
      message: "Deployment is not allowlisted for control plane history",
      deployment,
    });
  }

  const page = clampInteger(req.query.page, 1, 1, 100000);
  const limit = clampInteger(req.query.limit, 20, 1, 100);

  try {
    const data = await getHealingHistory({
      namespace: CONTROL_PLANE_NAMESPACE,
      deployment,
      result: req.query.result,
      alertName: req.query.alertName,
      from: req.query.from,
      to: req.query.to,
      page,
      limit,
      sort: req.query.sort === "asc" ? "asc" : "desc",
    });

    return res.status(200).json(data);
  } catch (err) {
    return res.status(502).json({
      message: "Failed to fetch healing history from healer-service",
      error: err.message,
    });
  }
};

const getAlerts = async (req, res) => {
  try {
    const alerts = await getAlertsFromPrometheus();
    return res.status(200).json({
      namespace: CONTROL_PLANE_NAMESPACE,
      count: alerts.length,
      alerts,
    });
  } catch (err) {
    return res.status(502).json({
      message: "Failed to fetch Prometheus alerts",
      error: err.message,
    });
  }
};

const isWithinWindow = (createdAt, windowMinutes) => {
  const createdTime = new Date(createdAt || 0).getTime();
  if (!createdTime) {
    return false;
  }

  return Date.now() - createdTime <= windowMinutes * 60 * 1000;
};

const summarizeReasons = (actions = []) =>
  actions.reduce((acc, action) => {
    const reason = action.reason || "unspecified";
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});

const buildHealerResilienceState = (actions = []) => {
  const policy = HEALER_SERVICE_DOWN_POLICY;

  return ALLOWED_APP_DEPLOYMENTS.map((service) => {
    const serviceActions = actions.filter(
      (action) =>
        action.deployment === service &&
        action.namespace === CONTROL_PLANE_NAMESPACE &&
        action.alert_name === policy.alertName,
    );

    const recentFailures = serviceActions.filter(
      (action) =>
        ["error", "failed"].includes(action.result) &&
        isWithinWindow(
          action.created_at,
          policy.circuitBreaker.windowMinutes,
        ),
    );
    const recentRateLimitActions = serviceActions.filter(
      (action) =>
        ["success", "failed"].includes(action.result) &&
        isWithinWindow(action.created_at, policy.rateLimit.windowMinutes),
    );
    const recentBlockedActions = serviceActions.filter(
      (action) =>
        action.result === "blocked" &&
        isWithinWindow(
          action.created_at,
          policy.circuitBreaker.windowMinutes,
        ),
    );

    return {
      service,
      circuitBreaker: {
        state:
          recentFailures.length >= policy.circuitBreaker.failureThreshold
            ? "open"
            : "closed",
        failureCount: recentFailures.length,
        failureThreshold: policy.circuitBreaker.failureThreshold,
        windowMinutes: policy.circuitBreaker.windowMinutes,
      },
      rateLimit: {
        state:
          recentRateLimitActions.length >= policy.rateLimit.maxActionsPerWindow
            ? "limited"
            : "available",
        actionCount: recentRateLimitActions.length,
        maxActionsPerWindow: policy.rateLimit.maxActionsPerWindow,
        windowMinutes: policy.rateLimit.windowMinutes,
      },
      cooldownSeconds: policy.cooldownSeconds,
      retry: policy.retry,
      recentBlockedReasonCounts: summarizeReasons(recentBlockedActions),
      lastAction: serviceActions[0] || null,
    };
  });
};

const getResilience = async (req, res) => {
  const warnings = [];
  let healingHistory = { actions: [] };
  let orderServiceResilience = null;

  try {
    healingHistory = await getHealingHistory({
      alertName: HEALER_SERVICE_DOWN_POLICY.alertName,
      limit: 100,
      page: 1,
    });
  } catch (err) {
    warnings.push(`healer history unavailable: ${err.message}`);
  }

  try {
    orderServiceResilience = await getOrderServiceResilience();
  } catch (err) {
    warnings.push(`order-service resilience status unavailable: ${err.message}`);
  }

  return res.status(200).json({
    namespace: CONTROL_PLANE_NAMESPACE,
    generatedAt: new Date().toISOString(),
    mechanisms: {
      healerServiceDownPolicy: {
        ...HEALER_SERVICE_DOWN_POLICY,
        allowedNamespaces: [CONTROL_PLANE_NAMESPACE],
        allowedDeployments: ALLOWED_APP_DEPLOYMENTS,
        serviceState: buildHealerResilienceState(
          healingHistory.actions || [],
        ),
      },
      orderProductCircuitBreaker: orderServiceResilience,
      manualScaleGuard: {
        ...MANUAL_SCALE_GUARD,
        namespace: CONTROL_PLANE_NAMESPACE,
        allowedDeployments: ALLOWED_APP_DEPLOYMENTS,
      },
    },
    warnings,
  });
};

const getCombinedLogs = async (req, res) => {
  const tailLines = clampInteger(req.query.tailLines, 100, 10, 500);
  const logs = [];
  const warnings = [];

  for (const service of ALLOWED_APP_DEPLOYMENTS) {
    try {
      const serviceLogs = await getServiceLogs(service, {
        tailLines,
        maxPods: 1,
      });
      logs.push(serviceLogs);
    } catch (err) {
      warnings.push(`${service}: ${err.message}`);
    }
  }

  return res.status(200).json({
    namespace: CONTROL_PLANE_NAMESPACE,
    tailLinesPerService: tailLines,
    generatedAt: new Date().toISOString(),
    count: logs.length,
    services: logs,
    warnings,
  });
};

const getServiceLogsHandler = async (req, res) => {
  const { service } = req.params;
  const tailLines = clampInteger(req.query.tailLines, 200, 10, 500);

  try {
    const logs = await getServiceLogs(service, { tailLines, maxPods: 3 });
    return res.status(200).json(logs);
  } catch (err) {
    return res.status(getK8sErrorStatus(err)).json({
      message: `Failed to fetch logs for ${service}`,
      error: err.message,
    });
  }
};

const getServiceEventsHandler = async (req, res) => {
  const { service } = req.params;

  try {
    const events = await getServiceEvents(service);
    return res.status(200).json({
      namespace: CONTROL_PLANE_NAMESPACE,
      service,
      count: events.length,
      events,
    });
  } catch (err) {
    return res.status(getK8sErrorStatus(err)).json({
      message: `Failed to fetch events for ${service}`,
      error: err.message,
    });
  }
};

const postScaleAction = async (req, res) => {
  const namespace = req.body.namespace;
  const service = req.body.service;
  const replicas = Number(req.body.replicas);
  const confirmation = req.body.confirmation;

  if (namespace !== CONTROL_PLANE_NAMESPACE) {
    const auditResponse = await recordActionAndRespondIfAuditFails(
      res,
      buildActionPayload(req, {
        namespace: namespace || "unknown",
        service,
        requestedReplicas: Number.isInteger(replicas) ? replicas : null,
        result: "blocked",
        reason: "namespace must be prod",
      }),
    );
    if (!auditResponse?.ok) {
      return auditResponse;
    }

    return res.status(400).json({
      message: "Scale action is restricted to namespace prod",
      namespace,
    });
  }

  if (!isAllowedDeployment(service)) {
    const auditResponse = await recordActionAndRespondIfAuditFails(
      res,
      buildActionPayload(req, {
        namespace,
        service,
        requestedReplicas: Number.isInteger(replicas) ? replicas : null,
        result: "blocked",
        reason: "service is not allowlisted",
      }),
    );
    if (!auditResponse?.ok) {
      return auditResponse;
    }

    return res.status(400).json({
      message: "Service is not allowlisted for control plane actions",
      service,
    });
  }

  if (!Number.isInteger(replicas) || ![0, 1].includes(replicas)) {
    const auditResponse = await recordActionAndRespondIfAuditFails(
      res,
      buildActionPayload(req, {
        namespace,
        service,
        requestedReplicas: null,
        result: "blocked",
        reason: "replicas must be exactly 0 or 1",
      }),
    );
    if (!auditResponse?.ok) {
      return auditResponse;
    }

    return res.status(400).json({
      message: "Replicas must be exactly 0 or 1",
      replicas: req.body.replicas,
    });
  }

  if (confirmation !== service) {
    const auditResponse = await recordActionAndRespondIfAuditFails(
      res,
      buildActionPayload(req, {
        namespace,
        service,
        requestedReplicas: replicas,
        result: "blocked",
        reason: "typed confirmation does not match service",
      }),
    );
    if (!auditResponse?.ok) {
      return auditResponse;
    }

    return res.status(400).json({
      message: "Typed confirmation must exactly match service name",
    });
  }

  try {
    const scaleResult = await scaleServiceDeployment({ service, replicas });
    const actionReason = scaleResult.changed
      ? "replicas patched"
      : "requested replicas already active";

    const auditWrite = await recordActionAndRespondIfAuditFails(
      res,
      buildActionPayload(req, {
        namespace,
        service,
        requestedReplicas: replicas,
        previousReplicas: scaleResult.previousReplicas,
        result: "success",
        reason: actionReason,
      }),
    );
    if (!auditWrite?.ok) {
      return auditWrite;
    }

    return res.status(200).json({
      message: scaleResult.changed
        ? "Scale action applied"
        : "Scale action completed with no change",
      namespace,
      service,
      previousReplicas: scaleResult.previousReplicas,
      requestedReplicas: replicas,
      changed: scaleResult.changed,
      auditId: auditWrite.audit.id,
      auditedAt: auditWrite.audit.created_at,
    });
  } catch (err) {
    const auditWrite = await recordActionAndRespondIfAuditFails(
      res,
      buildActionPayload(req, {
        namespace,
        service,
        requestedReplicas: Number.isInteger(replicas) ? replicas : null,
        result: "error",
        reason: err.message,
      }),
    );
    if (!auditWrite?.ok) {
      return auditWrite;
    }

    return res.status(getK8sErrorStatus(err)).json({
      message: "Scale action failed",
      namespace,
      service,
      requestedReplicas: replicas,
      error: err.message,
      auditId: auditWrite.audit.id,
    });
  }
};

const getControlPlaneActions = async (req, res) => {
  const service = req.query.service;
  if (service && !isAllowedDeployment(service)) {
    return res.status(400).json({
      message: "Service is not allowlisted for control plane audit lookup",
      service,
    });
  }

  try {
    const data = await listControlPlaneActions({
      page: req.query.page,
      limit: req.query.limit,
      service,
      result: req.query.result,
      from: req.query.from,
      to: req.query.to,
      sort: req.query.sort === "asc" ? "asc" : "desc",
    });

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({
      message: "Failed to fetch control plane action audit history",
      error: err.message,
    });
  }
};

module.exports = {
  getStatus,
  getOverview,
  getDeployments,
  getServiceDetail,
  getHealingHistoryHandler,
  getAlerts,
  getResilience,
  getCombinedLogs,
  getServiceLogsHandler,
  getServiceEventsHandler,
  postScaleAction,
  getControlPlaneActions,
};
