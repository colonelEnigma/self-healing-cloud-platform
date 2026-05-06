const {
  CONTROL_PLANE_NAMESPACE,
  isAllowedDeployment,
} = require("../config/allowlist");
const {
  CHAOS_SCENARIOS,
  MAX_ACTIVE_CHAOS_SCENARIOS,
  getScenarioById,
} = require("../config/chaosScenarios");
const {
  getServiceDeploymentSummary,
  scaleServiceDeployment,
} = require("./kubernetesService");
const {
  recordControlPlaneAction,
} = require("./auditService");
const {
  createExecution,
  countActiveExecutions,
  listActiveExecutions,
  findActiveExecutionByService,
  findExecutionForManualRevert,
  listDueAutoRevertExecutions,
  markExecutionReverted,
} = require("./chaosExecutionRepository");

class ChaosServiceError extends Error {
  constructor(statusCode, message, details = {}) {
    super(message);
    this.name = "ChaosServiceError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

const toIntegerOrNull = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
};

const ensureSafeReplicaValue = (value, label) => {
  if (!Number.isInteger(value) || ![0, 1].includes(value)) {
    throw new ChaosServiceError(400, `${label} must be exactly 0 or 1`, {
      replicaValue: value,
    });
  }
};

const resolveDurationSeconds = ({ scenario, durationSeconds }) => {
  if (durationSeconds == null || durationSeconds === "") {
    return scenario.defaultDurationSeconds;
  }

  const parsed = toIntegerOrNull(durationSeconds);
  if (!Number.isInteger(parsed)) {
    throw new ChaosServiceError(400, "durationSeconds must be an integer", {
      durationSeconds,
    });
  }

  if (
    parsed < scenario.minDurationSeconds ||
    parsed > scenario.maxDurationSeconds
  ) {
    throw new ChaosServiceError(
      400,
      `durationSeconds must be between ${scenario.minDurationSeconds} and ${scenario.maxDurationSeconds}`,
      {
        durationSeconds: parsed,
      },
    );
  }

  return parsed;
};

const buildAuditReason = ({
  scenarioId,
  message,
  durationSeconds,
  extra = null,
}) => {
  const parts = [
    `scenario=${scenarioId}`,
    message,
  ];

  if (Number.isInteger(durationSeconds)) {
    parts.push(`durationSeconds=${durationSeconds}`);
  }

  if (extra) {
    parts.push(extra);
  }

  return parts.join("; ");
};

const writeChaosAudit = async ({
  actor = {},
  action,
  service,
  requestedReplicas = null,
  previousReplicas = null,
  result,
  reason,
}) => {
  return recordControlPlaneAction({
    userId: actor.userId || null,
    userEmail: actor.userEmail || null,
    namespace: CONTROL_PLANE_NAMESPACE,
    service: service || "unknown",
    action,
    requestedReplicas,
    previousReplicas,
    result,
    reason,
  });
};

const summarizeExecution = (execution) => {
  if (!execution) {
    return null;
  }

  return {
    id: execution.id,
    scenarioId: execution.scenario_id,
    service: execution.service,
    requestedBy: execution.requested_by,
    reason: execution.reason,
    startedAt: execution.started_at,
    expiresAt: execution.expires_at,
    revertedAt: execution.reverted_at,
    revertMode: execution.revert_mode,
    status: execution.status,
    result: execution.result,
    metadata: execution.metadata_json || {},
  };
};

const getScenarioCatalog = async () => {
  const activeExecutions = await listActiveExecutions({ limit: 500 });
  const activeByScenario = activeExecutions.reduce((acc, execution) => {
    const scenarioId = execution.scenario_id;
    acc[scenarioId] = (acc[scenarioId] || 0) + 1;
    return acc;
  }, {});

  return {
    namespace: CONTROL_PLANE_NAMESPACE,
    maxActiveScenarios: MAX_ACTIVE_CHAOS_SCENARIOS,
    activeScenarioCount: activeExecutions.length,
    generatedAt: new Date().toISOString(),
    scenarios: CHAOS_SCENARIOS.map((scenario) => ({
      id: scenario.id,
      category: scenario.category,
      name: scenario.name,
      purpose: scenario.purpose,
      defaultDurationSeconds: scenario.defaultDurationSeconds,
      minDurationSeconds: scenario.minDurationSeconds,
      maxDurationSeconds: scenario.maxDurationSeconds,
      blastRadiusLimit: scenario.blastRadiusLimit,
      autoRevert: scenario.autoRevert,
      enabled: scenario.enabled,
      activeCount: activeByScenario[scenario.id] || 0,
    })),
    activeExecutions: activeExecutions.map(summarizeExecution),
  };
};

const revertExecutionRecord = async ({
  execution,
  revertMode,
  actor,
}) => {
  const scenario = getScenarioById(execution.scenario_id);
  if (!scenario) {
    throw new ChaosServiceError(500, "Scenario definition not found for execution", {
      executionId: execution.id,
      scenarioId: execution.scenario_id,
    });
  }

  if (scenario.executionType !== "scale_replicas") {
    throw new ChaosServiceError(
      400,
      `Scenario ${execution.scenario_id} is not revert-enabled in Phase 1`,
      {
        executionId: execution.id,
        scenarioId: execution.scenario_id,
      },
    );
  }

  const previousReplicas = execution.metadata_json?.previousReplicas;
  ensureSafeReplicaValue(previousReplicas, "previousReplicas");

  const scaleResult = await scaleServiceDeployment({
    service: execution.service,
    replicas: previousReplicas,
  });

  const revertedExecution = await markExecutionReverted({
    id: execution.id,
    revertMode,
    result: "success",
    metadataJson: {
      lastRevertAt: new Date().toISOString(),
      revertedToReplicas: previousReplicas,
      revertChanged: scaleResult.changed,
    },
  });

  return {
    execution: summarizeExecution(revertedExecution),
    scaleResult,
  };
};

const triggerScenarioExecution = async ({
  scenarioId,
  service,
  typedServiceConfirmation,
  typedScenarioConfirmation,
  durationSeconds,
  reason,
  actor,
}) => {
  const scenario = getScenarioById(scenarioId);
  const action = "chaos_trigger";

  const auditFailureAndThrow = async (statusCode, message, details = {}) => {
    await writeChaosAudit({
      actor,
      action,
      service,
      requestedReplicas: scenario?.targetReplicas ?? null,
      previousReplicas: null,
      result: statusCode < 500 ? "blocked" : "error",
      reason: buildAuditReason({
        scenarioId: scenarioId || "unknown",
        message,
        extra: details?.extra || null,
      }),
    });

    throw new ChaosServiceError(statusCode, message, details);
  };

  if (!scenario) {
    await auditFailureAndThrow(400, "Unknown scenarioId");
  }

  if (!scenario.enabled) {
    await auditFailureAndThrow(
      400,
      `Scenario ${scenario.id} is not enabled in Phase 1`,
    );
  }

  if (!isAllowedDeployment(service)) {
    await auditFailureAndThrow(
      400,
      "Service is not allowlisted for chaos actions",
    );
  }

  if (typedServiceConfirmation !== service) {
    await auditFailureAndThrow(
      400,
      "Typed service confirmation must exactly match service",
    );
  }

  if (typedScenarioConfirmation !== scenario.id) {
    await auditFailureAndThrow(
      400,
      "Typed scenario confirmation must exactly match scenarioId",
    );
  }

  const resolvedDurationSeconds = resolveDurationSeconds({
    scenario,
    durationSeconds,
  });

  const currentActiveCount = await countActiveExecutions();
  if (currentActiveCount >= MAX_ACTIVE_CHAOS_SCENARIOS) {
    await auditFailureAndThrow(
      409,
      `Max concurrent active scenarios reached (${MAX_ACTIVE_CHAOS_SCENARIOS})`,
    );
  }

  const existingActive = await findActiveExecutionByService(service);
  if (existingActive) {
    await auditFailureAndThrow(
      409,
      `Service already has an active scenario execution (${existingActive.scenario_id})`,
    );
  }

  if (scenario.executionType !== "scale_replicas") {
    await auditFailureAndThrow(
      400,
      `Scenario ${scenario.id} is not executable in Phase 1`,
    );
  }

  ensureSafeReplicaValue(scenario.targetReplicas, "targetReplicas");

  let deploymentSummary;
  try {
    deploymentSummary = await getServiceDeploymentSummary(service);
  } catch (err) {
    await auditFailureAndThrow(
      503,
      `Failed to fetch current deployment state: ${err.message}`,
    );
  }

  const previousReplicas = deploymentSummary?.desiredReplicas;
  ensureSafeReplicaValue(previousReplicas, "current desired replicas");

  if (previousReplicas === scenario.targetReplicas) {
    await auditFailureAndThrow(
      409,
      `Service already at requested chaos state (replicas=${scenario.targetReplicas})`,
    );
  }

  let scaleResult;
  try {
    scaleResult = await scaleServiceDeployment({
      service,
      replicas: scenario.targetReplicas,
    });
  } catch (err) {
    await auditFailureAndThrow(503, `Failed to apply scenario: ${err.message}`);
  }

  const startedAt = new Date();
  const expiresAt = new Date(
    startedAt.getTime() + resolvedDurationSeconds * 1000,
  );

  const execution = await createExecution({
    scenarioId: scenario.id,
    service,
    requestedBy: actor?.userEmail || null,
    reason: reason || null,
    startedAt: startedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    metadataJson: {
      namespace: CONTROL_PLANE_NAMESPACE,
      previousReplicas: scaleResult.previousReplicas,
      requestedReplicas: scenario.targetReplicas,
      durationSeconds: resolvedDurationSeconds,
      triggeredBy: actor?.userEmail || null,
      triggerSource: "api",
    },
  });

  const audit = await writeChaosAudit({
    actor,
    action,
    service,
    requestedReplicas: scenario.targetReplicas,
    previousReplicas: scaleResult.previousReplicas,
    result: "success",
    reason: buildAuditReason({
      scenarioId: scenario.id,
      message: "triggered",
      durationSeconds: resolvedDurationSeconds,
      extra: reason ? `reason=${reason}` : null,
    }),
  });

  return {
    scenario: {
      id: scenario.id,
      name: scenario.name,
      category: scenario.category,
      autoRevert: scenario.autoRevert,
    },
    execution: summarizeExecution(execution),
    scale: {
      previousReplicas: scaleResult.previousReplicas,
      requestedReplicas: scenario.targetReplicas,
      changed: scaleResult.changed,
    },
    audit,
  };
};

const revertScenarioExecution = async ({
  executionId,
  scenarioId,
  service,
  actor,
  revertMode = "manual",
}) => {
  const action = "chaos_revert";
  const execution = await findExecutionForManualRevert({
    executionId,
    scenarioId,
    service,
  });

  if (!execution) {
    throw new ChaosServiceError(404, "Scenario execution not found");
  }

  if (execution.status === "reverted") {
    return {
      alreadyReverted: true,
      execution: summarizeExecution(execution),
      audit: null,
    };
  }

  if (execution.status !== "active") {
    throw new ChaosServiceError(
      409,
      `Execution is not active (status=${execution.status})`,
      {
        executionId: execution.id,
      },
    );
  }

  try {
    const reverted = await revertExecutionRecord({
      execution,
      revertMode,
      actor,
    });

    const audit = await writeChaosAudit({
      actor,
      action,
      service: execution.service,
      requestedReplicas: reverted.execution.metadata?.revertedToReplicas ?? null,
      previousReplicas:
        execution.metadata_json?.requestedReplicas ?? execution.metadata_json?.previousReplicas ?? null,
      result: "success",
      reason: buildAuditReason({
        scenarioId: execution.scenario_id,
        message: `reverted (${revertMode})`,
      }),
    });

    return {
      alreadyReverted: false,
      execution: reverted.execution,
      scale: reverted.scaleResult,
      audit,
    };
  } catch (err) {
    await writeChaosAudit({
      actor,
      action,
      service: execution.service,
      requestedReplicas: execution.metadata_json?.previousReplicas ?? null,
      previousReplicas: execution.metadata_json?.requestedReplicas ?? null,
      result: "error",
      reason: buildAuditReason({
        scenarioId: execution.scenario_id,
        message: `revert failed (${revertMode}): ${err.message}`,
      }),
    });

    throw err;
  }
};

const revertAllActiveScenarioExecutions = async ({ actor }) => {
  const activeExecutions = await listActiveExecutions({ limit: 500 });
  const results = [];

  for (const execution of activeExecutions) {
    try {
      const reverted = await revertScenarioExecution({
        executionId: execution.id,
        actor,
        revertMode: "manual",
      });
      results.push({
        executionId: execution.id,
        service: execution.service,
        scenarioId: execution.scenario_id,
        status: "reverted",
        result: reverted,
      });
    } catch (err) {
      results.push({
        executionId: execution.id,
        service: execution.service,
        scenarioId: execution.scenario_id,
        status: "error",
        error: err.message,
      });
    }
  }

  return {
    total: activeExecutions.length,
    reverted: results.filter((item) => item.status === "reverted").length,
    failed: results.filter((item) => item.status === "error").length,
    results,
  };
};

const processDueAutoReverts = async () => {
  const dueExecutions = await listDueAutoRevertExecutions({ limit: 100 });
  const actor = {
    userId: null,
    userEmail: "system:auto-revert",
  };
  const results = [];

  for (const execution of dueExecutions) {
    try {
      const reverted = await revertScenarioExecution({
        executionId: execution.id,
        actor,
        revertMode: "auto",
      });
      results.push({
        executionId: execution.id,
        status: reverted.alreadyReverted ? "already_reverted" : "reverted",
      });
    } catch (err) {
      results.push({
        executionId: execution.id,
        status: "error",
        error: err.message,
      });
    }
  }

  return {
    checked: dueExecutions.length,
    reverted: results.filter((item) => item.status === "reverted").length,
    errors: results.filter((item) => item.status === "error").length,
    results,
  };
};

module.exports = {
  ChaosServiceError,
  getScenarioCatalog,
  triggerScenarioExecution,
  revertScenarioExecution,
  revertAllActiveScenarioExecutions,
  processDueAutoReverts,
};
