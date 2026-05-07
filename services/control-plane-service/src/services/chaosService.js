const {
  CONTROL_PLANE_NAMESPACE,
  isAllowedDeployment,
} = require("../config/allowlist");
const {
  CANONICAL_SCENARIOS,
  MAX_ACTIVE_CHAOS_SCENARIOS,
  getScenarioById,
  resolveScenarioId,
} = require("../config/chaosScenarios");
const {
  getServiceDeploymentSummary,
  getServiceChaosPrerequisites,
  scaleServiceDeployment,
  patchServiceContainerImage,
  patchServiceReadinessProbe,
  patchServiceLivenessProbe,
  patchServiceContainerLifecycle,
  patchServiceContainerEnvVar,
  patchServicePodTemplateAnnotation,
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

const buildChaosInvalidImage = (originalImage, suffix) => {
  const [repoAndTag, digest] = String(originalImage || "").split("@");
  if (!repoAndTag) {
    return "";
  }

  if (digest) {
    return `${repoAndTag}:${suffix}`;
  }

  const lastColon = repoAndTag.lastIndexOf(":");
  const lastSlash = repoAndTag.lastIndexOf("/");
  const hasTag = lastColon > lastSlash;

  if (hasTag) {
    return `${repoAndTag.substring(0, lastColon)}:${suffix}`;
  }

  return `${repoAndTag}:${suffix}`;
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

const toIntegerIfPossible = (value) => {
  if (Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
};

const validateErrorRateSpikePrerequisites = ({
  service,
  prerequisites,
  chaosPort,
}) => {
  const reasons = [];
  const portEnvValue = prerequisites?.portEnvEntry?.value;
  const currentPort = toIntegerIfPossible(portEnvValue);
  if (!Number.isInteger(currentPort)) {
    reasons.push("PORT env is missing or non-numeric");
  }

  const targetPorts = (prerequisites?.servicePorts || [])
    .map((item) => toIntegerIfPossible(item?.targetPort))
    .filter((item) => Number.isInteger(item));
  if (targetPorts.length === 0) {
    reasons.push("service targetPort is not a fixed numeric port");
  }

  if (targetPorts.includes(chaosPort)) {
    reasons.push("service targetPort already equals chaos PORT value");
  }

  if (Number.isInteger(currentPort) && !targetPorts.includes(currentPort)) {
    reasons.push("service targetPort does not match current PORT");
  }

  if (reasons.length > 0) {
    throw new ChaosServiceError(
      409,
      "ErrorRateSpike prerequisites not met",
      {
        service,
        reasons,
      },
    );
  }
};

const validateMetricsPipelineDropPrerequisites = ({
  service,
  prerequisites,
  annotationName,
}) => {
  const podAnnotationValue = prerequisites?.podAnnotations?.[annotationName];
  const serviceAnnotationValue =
    prerequisites?.serviceAnnotations?.[annotationName];
  const hasPrometheusScrapeSignal =
    String(podAnnotationValue || "").toLowerCase() === "true" ||
    String(serviceAnnotationValue || "").toLowerCase() === "true";

  if (!hasPrometheusScrapeSignal) {
    throw new ChaosServiceError(
      409,
      "MetricsPipelineDrop prerequisites not met",
      {
        service,
        reasons: [
          `${annotationName}=true not detected on pod template or service`,
        ],
      },
    );
  }
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
    scenarios: CANONICAL_SCENARIOS.map((scenario) => ({
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
}) => {
  const scenario = getScenarioById(execution.scenario_id);
  if (!scenario) {
    throw new ChaosServiceError(500, "Scenario definition not found for execution", {
      executionId: execution.id,
      scenarioId: execution.scenario_id,
    });
  }

  if (scenario.executionType === "scale_replicas") {
    const previousReplicas = execution.metadata_json?.previousReplicas;
    ensureSafeReplicaValue(previousReplicas, "previousReplicas");
    const scaleResult = await scaleServiceDeployment({ service: execution.service, replicas: previousReplicas });
    const revertedExecution = await markExecutionReverted({
      id: execution.id,
      revertMode,
      result: "success",
      metadataJson: { lastRevertAt: new Date().toISOString(), revertedToReplicas: previousReplicas, revertChanged: scaleResult.changed },
    });
    return { execution: summarizeExecution(revertedExecution), mutationResult: { type: "scale_replicas", ...scaleResult } };
  }

  if (scenario.executionType === "patch_container_image") {
    const originalImage = execution.metadata_json?.originalImage;
    const containerName = execution.metadata_json?.containerName;
    if (!originalImage || !containerName) {
      throw new ChaosServiceError(409, "Missing revert metadata for ImagePullFailSimulation", { executionId: execution.id });
    }
    const patchResult = await patchServiceContainerImage({ service: execution.service, containerName, image: originalImage });
    const revertedExecution = await markExecutionReverted({
      id: execution.id,
      revertMode,
      result: "success",
      metadataJson: { lastRevertAt: new Date().toISOString(), revertedToImage: originalImage, revertChanged: patchResult.changed },
    });
    return { execution: summarizeExecution(revertedExecution), mutationResult: { type: "patch_container_image", ...patchResult } };
  }

  if (scenario.executionType === "patch_readiness_probe" || scenario.executionType === "patch_readiness_probe_timeout") {
    const originalReadinessProbe = execution.metadata_json?.originalReadinessProbe;
    const containerName = execution.metadata_json?.containerName;
    if (!originalReadinessProbe || !containerName) {
      throw new ChaosServiceError(409, `Missing revert metadata for ${execution.scenario_id}`, { executionId: execution.id });
    }
    const patchResult = await patchServiceReadinessProbe({ service: execution.service, containerName, readinessProbe: originalReadinessProbe });
    const revertedExecution = await markExecutionReverted({
      id: execution.id,
      revertMode,
      result: "success",
      metadataJson: { lastRevertAt: new Date().toISOString(), revertedToReadinessProbe: originalReadinessProbe, revertChanged: patchResult.changed },
    });
    return { execution: summarizeExecution(revertedExecution), mutationResult: { type: "patch_readiness_probe", ...patchResult } };
  }

  if (scenario.executionType === "patch_liveness_probe") {
    const originalLivenessProbe = execution.metadata_json?.originalLivenessProbe;
    const containerName = execution.metadata_json?.containerName;
    if (!originalLivenessProbe || !containerName) {
      throw new ChaosServiceError(409, "Missing revert metadata for BadLivenessProbe", { executionId: execution.id });
    }
    const patchResult = await patchServiceLivenessProbe({ service: execution.service, containerName, livenessProbe: originalLivenessProbe });
    const revertedExecution = await markExecutionReverted({
      id: execution.id,
      revertMode,
      result: "success",
      metadataJson: { lastRevertAt: new Date().toISOString(), revertedToLivenessProbe: originalLivenessProbe, revertChanged: patchResult.changed },
    });
    return { execution: summarizeExecution(revertedExecution), mutationResult: { type: "patch_liveness_probe", ...patchResult } };
  }

  if (scenario.executionType === "patch_container_lifecycle_post_start_sleep") {
    const originalLifecycle = execution.metadata_json?.originalLifecycle;
    const containerName = execution.metadata_json?.containerName;
    if (!containerName) {
      throw new ChaosServiceError(409, "Missing revert metadata for LatencyInjection", { executionId: execution.id });
    }
    const patchResult = await patchServiceContainerLifecycle({
      service: execution.service,
      containerName,
      lifecycle: originalLifecycle || null,
    });
    const revertedExecution = await markExecutionReverted({
      id: execution.id,
      revertMode,
      result: "success",
      metadataJson: { lastRevertAt: new Date().toISOString(), revertedToLifecycle: originalLifecycle || null, revertChanged: patchResult.changed },
    });
    return { execution: summarizeExecution(revertedExecution), mutationResult: { type: "patch_container_lifecycle", ...patchResult } };
  }

  if (scenario.executionType === "patch_container_env_var") {
    const containerName = execution.metadata_json?.containerName;
    const chaosEnvVarName = execution.metadata_json?.chaosEnvVarName;
    const originalEnvEntry = execution.metadata_json?.originalEnvEntry || null;

    if (!containerName || !chaosEnvVarName) {
      throw new ChaosServiceError(
        409,
        "Missing revert metadata for env-var scenario",
        { executionId: execution.id },
      );
    }

    const patchResult = await patchServiceContainerEnvVar({
      service: execution.service,
      containerName,
      envName: chaosEnvVarName,
      envValue: originalEnvEntry?.value ?? null,
    });

    const revertedExecution = await markExecutionReverted({
      id: execution.id,
      revertMode,
      result: "success",
      metadataJson: {
        lastRevertAt: new Date().toISOString(),
        revertedEnvVarName: chaosEnvVarName,
        revertedToEnvEntry: originalEnvEntry,
        revertChanged: patchResult.changed,
      },
    });

    return {
      execution: summarizeExecution(revertedExecution),
      mutationResult: {
        type: "patch_container_env_var",
        ...patchResult,
      },
    };
  }

  if (scenario.executionType === "patch_pod_template_annotation") {
    const annotationName = execution.metadata_json?.chaosAnnotationName;
    const originalAnnotationValue =
      execution.metadata_json?.originalAnnotationValue ?? null;
    const hadOriginalAnnotation = Boolean(
      execution.metadata_json?.hadOriginalAnnotation,
    );

    if (!annotationName) {
      throw new ChaosServiceError(
        409,
        "Missing revert metadata for annotation scenario",
        { executionId: execution.id },
      );
    }

    const patchResult = await patchServicePodTemplateAnnotation({
      service: execution.service,
      annotationName,
      annotationValue: hadOriginalAnnotation ? originalAnnotationValue : null,
    });

    const revertedExecution = await markExecutionReverted({
      id: execution.id,
      revertMode,
      result: "success",
      metadataJson: {
        lastRevertAt: new Date().toISOString(),
        revertedAnnotationName: annotationName,
        revertedToAnnotationValue: hadOriginalAnnotation
          ? originalAnnotationValue
          : null,
        revertChanged: patchResult.changed,
      },
    });

    return {
      execution: summarizeExecution(revertedExecution),
      mutationResult: {
        type: "patch_pod_template_annotation",
        ...patchResult,
      },
    };
  }

  throw new ChaosServiceError(400, `Scenario ${execution.scenario_id} is not revert-enabled in Phase 1`, {
    executionId: execution.id,
    scenarioId: execution.scenario_id,
  });
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
  const resolvedScenarioId = resolveScenarioId(scenarioId);
  const scenario = resolvedScenarioId
    ? getScenarioById(resolvedScenarioId.canonicalId)
    : null;
  const requestedScenarioId = resolvedScenarioId?.originalId || scenarioId;
  const canonicalScenarioId = resolvedScenarioId?.canonicalId || null;
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
        scenarioId: canonicalScenarioId || requestedScenarioId || "unknown",
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

  if (
    typedScenarioConfirmation !== scenario.id &&
    typedScenarioConfirmation !== requestedScenarioId
  ) {
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

  if (scenario.executionType === "scale_replicas") {
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
      mutation: {
        type: "scale_replicas",
        previousReplicas: scaleResult.previousReplicas,
        requestedReplicas: scenario.targetReplicas,
        changed: scaleResult.changed,
      },
      audit,
    };
  }

  if (scenario.executionType === "patch_container_image") {
    let deploymentSummary;
    try {
      deploymentSummary = await getServiceDeploymentSummary(service);
    } catch (err) {
      await auditFailureAndThrow(
        503,
        `Failed to fetch current deployment state: ${err.message}`,
      );
    }

    const originalImage = deploymentSummary?.image;
    if (!originalImage) {
      await auditFailureAndThrow(409, "Current deployment image is missing");
    }

    const chaosImageTagSuffix = scenario.chaosImageTagSuffix || "chaos-invalid";
    const chaosImage = buildChaosInvalidImage(originalImage, chaosImageTagSuffix);
    if (!chaosImage || chaosImage === originalImage) {
      await auditFailureAndThrow(409, "Could not derive deterministic chaos image");
    }

    let patchResult;
    try {
      patchResult = await patchServiceContainerImage({
        service,
        containerName: service,
        image: chaosImage,
      });
    } catch (err) {
      await auditFailureAndThrow(503, `Failed to apply scenario: ${err.message}`);
    }

    if (!patchResult.previousImage) {
      await auditFailureAndThrow(409, "Current container image is missing");
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
        containerName: patchResult.containerName,
        originalImage: patchResult.previousImage,
        chaosImage,
        chaosImageTagSuffix,
        durationSeconds: resolvedDurationSeconds,
        triggeredBy: actor?.userEmail || null,
        triggerSource: "api",
      },
    });

    const audit = await writeChaosAudit({
      actor,
      action,
      service,
      requestedReplicas: null,
      previousReplicas: null,
      result: "success",
      reason: buildAuditReason({
        scenarioId: scenario.id,
        message: "triggered",
        durationSeconds: resolvedDurationSeconds,
        extra: `chaosImageTagSuffix=${chaosImageTagSuffix}${reason ? `; reason=${reason}` : ""}`,
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
      mutation: {
        type: "patch_container_image",
        previousImage: patchResult.previousImage,
        requestedImage: patchResult.requestedImage,
        changed: patchResult.changed,
      },
      audit,
    };
  }

  if (scenario.executionType === "patch_readiness_probe") {
    const chaosReadinessProbe = {
      httpGet: {
        path: scenario.chaosReadinessPath || "/__chaos__/not-ready",
        port: scenario.chaosReadinessPort || 65535,
      },
      initialDelaySeconds: 0,
      periodSeconds: 5,
      timeoutSeconds: 1,
      failureThreshold: 1,
    };

    let patchResult;
    try {
      patchResult = await patchServiceReadinessProbe({
        service,
        containerName: service,
        readinessProbe: chaosReadinessProbe,
      });
    } catch (err) {
      await auditFailureAndThrow(503, `Failed to apply scenario: ${err.message}`);
    }

    if (!patchResult.previousReadinessProbe) {
      await auditFailureAndThrow(409, "Current readiness probe is missing");
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
        containerName: patchResult.containerName,
        originalReadinessProbe: patchResult.previousReadinessProbe,
        chaosReadinessProbe: patchResult.requestedReadinessProbe,
        durationSeconds: resolvedDurationSeconds,
        triggeredBy: actor?.userEmail || null,
        triggerSource: "api",
      },
    });

    const audit = await writeChaosAudit({
      actor,
      action,
      service,
      requestedReplicas: null,
      previousReplicas: null,
      result: "success",
      reason: buildAuditReason({
        scenarioId: scenario.id,
        message: "triggered",
        durationSeconds: resolvedDurationSeconds,
        extra: `chaosReadinessPath=${chaosReadinessProbe.httpGet.path}; chaosReadinessPort=${chaosReadinessProbe.httpGet.port}${reason ? `; reason=${reason}` : ""}`,
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
      mutation: {
        type: "patch_readiness_probe",
        previousReadinessProbe: patchResult.previousReadinessProbe,
        requestedReadinessProbe: patchResult.requestedReadinessProbe,
        changed: patchResult.changed,
      },
      audit,
    };
  }

  if (scenario.executionType === "patch_liveness_probe") {
    const chaosLivenessProbe = {
      httpGet: {
        path: scenario.chaosLivenessPath || "/__chaos__/not-live",
        port: scenario.chaosLivenessPort || 65535,
      },
      initialDelaySeconds: 0,
      periodSeconds: 5,
      timeoutSeconds: 1,
      failureThreshold: 1,
    };

    let patchResult;
    try {
      patchResult = await patchServiceLivenessProbe({
        service,
        containerName: service,
        livenessProbe: chaosLivenessProbe,
      });
    } catch (err) {
      await auditFailureAndThrow(503, `Failed to apply scenario: ${err.message}`);
    }

    if (!patchResult.previousLivenessProbe) {
      await auditFailureAndThrow(409, "Current liveness probe is missing");
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
        containerName: patchResult.containerName,
        originalLivenessProbe: patchResult.previousLivenessProbe,
        chaosLivenessProbe: patchResult.requestedLivenessProbe,
        durationSeconds: resolvedDurationSeconds,
        triggeredBy: actor?.userEmail || null,
        triggerSource: "api",
      },
    });

    const audit = await writeChaosAudit({
      actor,
      action,
      service,
      requestedReplicas: null,
      previousReplicas: null,
      result: "success",
      reason: buildAuditReason({
        scenarioId: scenario.id,
        message: "triggered",
        durationSeconds: resolvedDurationSeconds,
        extra: `chaosLivenessPath=${chaosLivenessProbe.httpGet.path}; chaosLivenessPort=${chaosLivenessProbe.httpGet.port}${reason ? `; reason=${reason}` : ""}`,
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
      mutation: {
        type: "patch_liveness_probe",
        previousLivenessProbe: patchResult.previousLivenessProbe,
        requestedLivenessProbe: patchResult.requestedLivenessProbe,
        changed: patchResult.changed,
      },
      audit,
    };
  }

  if (scenario.executionType === "patch_readiness_probe_timeout") {
    const chaosProbeTimeoutSeconds = Number.isInteger(scenario.chaosProbeTimeoutSeconds)
      ? scenario.chaosProbeTimeoutSeconds
      : 1;
    const chaosProbeExecSleepSeconds = Number.isInteger(scenario.chaosProbeExecSleepSeconds)
      ? scenario.chaosProbeExecSleepSeconds
      : 5;
    const chaosReadinessProbe = {
      exec: {
        command: ["sh", "-c", `sleep ${chaosProbeExecSleepSeconds}`],
      },
      initialDelaySeconds: 0,
      periodSeconds: 5,
      timeoutSeconds: chaosProbeTimeoutSeconds,
      failureThreshold: 1,
      successThreshold: 1,
    };

    let patchResult;
    try {
      patchResult = await patchServiceReadinessProbe({
        service,
        containerName: service,
        readinessProbe: chaosReadinessProbe,
      });
    } catch (err) {
      await auditFailureAndThrow(503, `Failed to apply scenario: ${err.message}`);
    }

    if (!patchResult.previousReadinessProbe) {
      await auditFailureAndThrow(409, "Current readiness probe is missing");
    }

    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + resolvedDurationSeconds * 1000);
    const execution = await createExecution({
      scenarioId: scenario.id,
      service,
      requestedBy: actor?.userEmail || null,
      reason: reason || null,
      startedAt: startedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      metadataJson: {
        namespace: CONTROL_PLANE_NAMESPACE,
        containerName: patchResult.containerName,
        originalReadinessProbe: patchResult.previousReadinessProbe,
        chaosReadinessProbe: patchResult.requestedReadinessProbe,
        durationSeconds: resolvedDurationSeconds,
        triggeredBy: actor?.userEmail || null,
        triggerSource: "api",
      },
    });
    const audit = await writeChaosAudit({
      actor,
      action,
      service,
      requestedReplicas: null,
      previousReplicas: null,
      result: "success",
      reason: buildAuditReason({
        scenarioId: scenario.id,
        message: "triggered",
        durationSeconds: resolvedDurationSeconds,
        extra: `probeTimeoutSeconds=${chaosProbeTimeoutSeconds}; probeExecSleepSeconds=${chaosProbeExecSleepSeconds}${reason ? `; reason=${reason}` : ""}`,
      }),
    });
    return {
      scenario: { id: scenario.id, name: scenario.name, category: scenario.category, autoRevert: scenario.autoRevert },
      execution: summarizeExecution(execution),
      mutation: {
        type: "patch_readiness_probe",
        previousReadinessProbe: patchResult.previousReadinessProbe,
        requestedReadinessProbe: patchResult.requestedReadinessProbe,
        changed: patchResult.changed,
      },
      audit,
    };
  }

  if (scenario.executionType === "patch_container_lifecycle_post_start_sleep") {
    const chaosPostStartSleepSeconds = Number.isInteger(scenario.chaosPostStartSleepSeconds)
      ? scenario.chaosPostStartSleepSeconds
      : 12;
    const chaosLifecycle = {
      postStart: {
        exec: {
          command: ["sh", "-c", `sleep ${chaosPostStartSleepSeconds}`],
        },
      },
    };
    let patchResult;
    try {
      patchResult = await patchServiceContainerLifecycle({
        service,
        containerName: service,
        lifecycle: chaosLifecycle,
      });
    } catch (err) {
      await auditFailureAndThrow(503, `Failed to apply scenario: ${err.message}`);
    }
    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + resolvedDurationSeconds * 1000);
    const execution = await createExecution({
      scenarioId: scenario.id,
      service,
      requestedBy: actor?.userEmail || null,
      reason: reason || null,
      startedAt: startedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      metadataJson: {
        namespace: CONTROL_PLANE_NAMESPACE,
        containerName: patchResult.containerName,
        originalLifecycle: patchResult.previousLifecycle,
        chaosLifecycle: patchResult.requestedLifecycle,
        durationSeconds: resolvedDurationSeconds,
        triggeredBy: actor?.userEmail || null,
        triggerSource: "api",
      },
    });
    const audit = await writeChaosAudit({
      actor,
      action,
      service,
      requestedReplicas: null,
      previousReplicas: null,
      result: "success",
      reason: buildAuditReason({
        scenarioId: scenario.id,
        message: "triggered",
        durationSeconds: resolvedDurationSeconds,
        extra: `postStartSleepSeconds=${chaosPostStartSleepSeconds}${reason ? `; reason=${reason}` : ""}`,
      }),
    });
    return {
      scenario: { id: scenario.id, name: scenario.name, category: scenario.category, autoRevert: scenario.autoRevert },
      execution: summarizeExecution(execution),
      mutation: {
        type: "patch_container_lifecycle",
        previousLifecycle: patchResult.previousLifecycle,
        requestedLifecycle: patchResult.requestedLifecycle,
        changed: patchResult.changed,
      },
      audit,
    };
  }

  if (scenario.executionType === "patch_container_env_var") {
    const chaosEnvVarName = scenario.chaosEnvVarName;
    const chaosEnvVarValue = String(scenario.chaosEnvVarValue ?? "");
    if (!chaosEnvVarName) {
      await auditFailureAndThrow(500, "Scenario env var configuration missing");
    }

    if (scenario.id === "ErrorRateSpike") {
      let prerequisites;
      try {
        prerequisites = await getServiceChaosPrerequisites(service);
      } catch (err) {
        await auditFailureAndThrow(
          503,
          `Failed to read scenario prerequisites: ${err.message}`,
        );
      }

      try {
        validateErrorRateSpikePrerequisites({
          service,
          prerequisites,
          chaosPort: toIntegerIfPossible(chaosEnvVarValue),
        });
      } catch (err) {
        if (err instanceof ChaosServiceError) {
          await auditFailureAndThrow(err.statusCode, err.message, {
            extra: (err.details?.reasons || []).join(", "),
          });
        }
        throw err;
      }
    }

    let patchResult;
    try {
      patchResult = await patchServiceContainerEnvVar({
        service,
        containerName: service,
        envName: chaosEnvVarName,
        envValue: chaosEnvVarValue,
      });
    } catch (err) {
      await auditFailureAndThrow(503, `Failed to apply scenario: ${err.message}`);
    }

    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + resolvedDurationSeconds * 1000);
    const execution = await createExecution({
      scenarioId: scenario.id,
      service,
      requestedBy: actor?.userEmail || null,
      reason: reason || null,
      startedAt: startedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      metadataJson: {
        namespace: CONTROL_PLANE_NAMESPACE,
        containerName: patchResult.containerName,
        chaosEnvVarName,
        originalEnvEntry: patchResult.previousEnvEntry,
        chaosEnvEntry: patchResult.requestedEnvEntry,
        durationSeconds: resolvedDurationSeconds,
        triggeredBy: actor?.userEmail || null,
        triggerSource: "api",
      },
    });
    const audit = await writeChaosAudit({
      actor,
      action,
      service,
      requestedReplicas: null,
      previousReplicas: null,
      result: "success",
      reason: buildAuditReason({
        scenarioId: scenario.id,
        message: "triggered",
        durationSeconds: resolvedDurationSeconds,
        extra: `chaosEnvVar=${chaosEnvVarName}; chaosEnvValue=${chaosEnvVarValue}${reason ? `; reason=${reason}` : ""}`,
      }),
    });
    return {
      scenario: { id: scenario.id, name: scenario.name, category: scenario.category, autoRevert: scenario.autoRevert },
      execution: summarizeExecution(execution),
      mutation: {
        type: "patch_container_env_var",
        envName: patchResult.envName,
        previousEnvEntry: patchResult.previousEnvEntry,
        requestedEnvEntry: patchResult.requestedEnvEntry,
        changed: patchResult.changed,
      },
      audit,
    };
  }

  if (scenario.executionType === "patch_pod_template_annotation") {
    const chaosAnnotationName = scenario.chaosAnnotationName;
    const chaosAnnotationValue = String(scenario.chaosAnnotationValue ?? "");
    if (!chaosAnnotationName) {
      await auditFailureAndThrow(500, "Scenario annotation configuration missing");
    }

    if (scenario.id === "MetricsPipelineDrop") {
      let prerequisites;
      try {
        prerequisites = await getServiceChaosPrerequisites(service);
      } catch (err) {
        await auditFailureAndThrow(
          503,
          `Failed to read scenario prerequisites: ${err.message}`,
        );
      }

      try {
        validateMetricsPipelineDropPrerequisites({
          service,
          prerequisites,
          annotationName: chaosAnnotationName,
        });
      } catch (err) {
        if (err instanceof ChaosServiceError) {
          await auditFailureAndThrow(err.statusCode, err.message, {
            extra: (err.details?.reasons || []).join(", "),
          });
        }
        throw err;
      }
    }

    let patchResult;
    try {
      patchResult = await patchServicePodTemplateAnnotation({
        service,
        annotationName: chaosAnnotationName,
        annotationValue: chaosAnnotationValue,
      });
    } catch (err) {
      await auditFailureAndThrow(503, `Failed to apply scenario: ${err.message}`);
    }

    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + resolvedDurationSeconds * 1000);
    const execution = await createExecution({
      scenarioId: scenario.id,
      service,
      requestedBy: actor?.userEmail || null,
      reason: reason || null,
      startedAt: startedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      metadataJson: {
        namespace: CONTROL_PLANE_NAMESPACE,
        chaosAnnotationName,
        hadOriginalAnnotation: patchResult.hadPreviousAnnotation,
        originalAnnotationValue: patchResult.previousAnnotationValue,
        chaosAnnotationValue: patchResult.requestedAnnotationValue,
        durationSeconds: resolvedDurationSeconds,
        triggeredBy: actor?.userEmail || null,
        triggerSource: "api",
      },
    });
    const audit = await writeChaosAudit({
      actor,
      action,
      service,
      requestedReplicas: null,
      previousReplicas: null,
      result: "success",
      reason: buildAuditReason({
        scenarioId: scenario.id,
        message: "triggered",
        durationSeconds: resolvedDurationSeconds,
        extra: `chaosAnnotation=${chaosAnnotationName}; chaosAnnotationValue=${chaosAnnotationValue}${reason ? `; reason=${reason}` : ""}`,
      }),
    });
    return {
      scenario: { id: scenario.id, name: scenario.name, category: scenario.category, autoRevert: scenario.autoRevert },
      execution: summarizeExecution(execution),
      mutation: {
        type: "patch_pod_template_annotation",
        annotationName: patchResult.annotationName,
        hadPreviousAnnotation: patchResult.hadPreviousAnnotation,
        previousAnnotationValue: patchResult.previousAnnotationValue,
        requestedAnnotationValue: patchResult.requestedAnnotationValue,
        changed: patchResult.changed,
      },
      audit,
    };
  }

  await auditFailureAndThrow(400, `Scenario ${scenario.id} is not executable in Phase 1`);
};

const revertScenarioExecution = async ({
  executionId,
  scenarioId,
  service,
  actor,
  revertMode = "manual",
}) => {
  const action = "chaos_revert";
  const resolvedScenario = scenarioId ? resolveScenarioId(scenarioId) : null;
  const execution = await findExecutionForManualRevert({
    executionId,
    scenarioId: resolvedScenario?.canonicalId || scenarioId,
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
      mutation: reverted.mutationResult,
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
