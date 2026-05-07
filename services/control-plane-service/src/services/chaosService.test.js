jest.mock("../config/allowlist", () => ({
  CONTROL_PLANE_NAMESPACE: "prod",
  isAllowedDeployment: jest.fn(() => true),
}));

jest.mock("./kubernetesService", () => ({
  getServiceDeploymentSummary: jest.fn(),
  getServiceChaosPrerequisites: jest.fn(),
  scaleServiceDeployment: jest.fn(),
  patchServiceContainerImage: jest.fn(),
  patchServiceReadinessProbe: jest.fn(),
  patchServiceLivenessProbe: jest.fn(),
  patchServiceContainerLifecycle: jest.fn(),
  patchServiceContainerEnvVar: jest.fn(),
  patchServicePodTemplateAnnotation: jest.fn(),
}));

jest.mock("./auditService", () => ({
  recordControlPlaneAction: jest.fn(),
}));

jest.mock("./chaosExecutionRepository", () => ({
  createExecution: jest.fn(),
  countActiveExecutions: jest.fn(),
  listActiveExecutions: jest.fn(),
  findActiveExecutionByService: jest.fn(),
  findExecutionForManualRevert: jest.fn(),
  listDueAutoRevertExecutions: jest.fn(),
  markExecutionReverted: jest.fn(),
}));

const { isAllowedDeployment } = require("../config/allowlist");
const {
  getServiceDeploymentSummary,
  getServiceChaosPrerequisites,
  patchServiceContainerImage,
  patchServiceReadinessProbe,
  patchServiceLivenessProbe,
  patchServiceContainerLifecycle,
  patchServiceContainerEnvVar,
  patchServicePodTemplateAnnotation,
} = require("./kubernetesService");
const { recordControlPlaneAction } = require("./auditService");
const {
  createExecution,
  countActiveExecutions,
  findActiveExecutionByService,
  findExecutionForManualRevert,
  markExecutionReverted,
} = require("./chaosExecutionRepository");
const {
  triggerScenarioExecution,
  revertScenarioExecution,
  ChaosServiceError,
} = require("./chaosService");

const buildDefaultChaosPrerequisites = () => ({
  service: "payment-service",
  containerName: "payment-service",
  portEnvEntry: { name: "PORT", value: "4000" },
  containerPorts: [{ name: null, containerPort: 4000 }],
  servicePorts: [{ name: null, port: 80, targetPort: 4000 }],
  podAnnotations: { "prometheus.io/scrape": "true" },
  serviceAnnotations: {},
});

beforeEach(() => {
  getServiceChaosPrerequisites.mockResolvedValue(buildDefaultChaosPrerequisites());
});

describe("chaosService image patch scenario", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isAllowedDeployment.mockReturnValue(true);
    countActiveExecutions.mockResolvedValue(0);
    findActiveExecutionByService.mockResolvedValue(null);
    recordControlPlaneAction.mockResolvedValue({ id: 1, created_at: "2026-05-06T00:00:00.000Z" });
  });

  it("triggers ImagePullFailSimulation with deterministic metadata", async () => {
    getServiceDeploymentSummary.mockResolvedValue({
      service: "payment-service",
      image: "repo/payment-service:abc123",
    });
    patchServiceContainerImage.mockResolvedValue({
      containerName: "payment-service",
      previousImage: "repo/payment-service:abc123",
      requestedImage: "repo/payment-service:chaos-invalid",
      changed: true,
    });
    createExecution.mockResolvedValue({
      id: 11,
      scenario_id: "ImagePullFailSimulation",
      service: "payment-service",
      requested_by: "admin@example.test",
      reason: "demo",
      started_at: "2026-05-06T00:00:00.000Z",
      expires_at: "2026-05-06T00:03:00.000Z",
      reverted_at: null,
      revert_mode: null,
      status: "active",
      result: "running",
      metadata_json: {},
    });

    const result = await triggerScenarioExecution({
      scenarioId: "ImagePullFailSimulation",
      service: "payment-service",
      typedServiceConfirmation: "payment-service",
      typedScenarioConfirmation: "ImagePullFailSimulation",
      durationSeconds: 180,
      reason: "demo",
      actor: { userId: 2, userEmail: "admin@example.test" },
    });

    expect(patchServiceContainerImage).toHaveBeenCalledWith({
      service: "payment-service",
      containerName: "payment-service",
      image: "repo/payment-service:chaos-invalid",
    });
    expect(result.mutation).toEqual({
      type: "patch_container_image",
      previousImage: "repo/payment-service:abc123",
      requestedImage: "repo/payment-service:chaos-invalid",
      changed: true,
    });
    expect(result.scenario.id).toBe("ImagePullFailSimulation");
  });

  it("reverts ImagePullFailSimulation execution using stored original image", async () => {
    findExecutionForManualRevert.mockResolvedValue({
      id: 22,
      scenario_id: "ImagePullFailSimulation",
      service: "payment-service",
      status: "active",
      metadata_json: {
        containerName: "payment-service",
        originalImage: "repo/payment-service:abc123",
        chaosImage: "repo/payment-service:chaos-invalid",
      },
    });
    patchServiceContainerImage.mockResolvedValue({
      containerName: "payment-service",
      previousImage: "repo/payment-service:chaos-invalid",
      requestedImage: "repo/payment-service:abc123",
      changed: true,
    });
    markExecutionReverted.mockResolvedValue({
      id: 22,
      scenario_id: "ImagePullFailSimulation",
      service: "payment-service",
      requested_by: "admin@example.test",
      reason: "demo",
      started_at: "2026-05-06T00:00:00.000Z",
      expires_at: "2026-05-06T00:03:00.000Z",
      reverted_at: "2026-05-06T00:01:00.000Z",
      revert_mode: "manual",
      status: "reverted",
      result: "success",
      metadata_json: {
        revertedToImage: "repo/payment-service:abc123",
      },
    });

    const result = await revertScenarioExecution({
      executionId: 22,
      actor: { userId: 2, userEmail: "admin@example.test" },
      revertMode: "manual",
    });

    expect(patchServiceContainerImage).toHaveBeenCalledWith({
      service: "payment-service",
      containerName: "payment-service",
      image: "repo/payment-service:abc123",
    });
    expect(result.alreadyReverted).toBe(false);
    expect(result.mutation.type).toBe("patch_container_image");
  });

  it("blocks non-allowlisted service and throws typed chaos error", async () => {
    isAllowedDeployment.mockReturnValue(false);

    await expect(
      triggerScenarioExecution({
        scenarioId: "ImagePullFailSimulation",
        service: "not-allowed",
        typedServiceConfirmation: "not-allowed",
        typedScenarioConfirmation: "ImagePullFailSimulation",
        durationSeconds: 180,
        reason: "demo",
        actor: { userId: 2, userEmail: "admin@example.test" },
      }),
    ).rejects.toBeInstanceOf(ChaosServiceError);
  });

  it("rejects deprecated/non-canonical scenario id", async () => {
    await expect(
      triggerScenarioExecution({
        scenarioId: "CrashLoopSimulation",
        service: "payment-service",
        typedServiceConfirmation: "payment-service",
        typedScenarioConfirmation: "CrashLoopSimulation",
        durationSeconds: 180,
        reason: "alias demo",
        actor: { userId: 2, userEmail: "admin@example.test" },
      }),
    ).rejects.toBeInstanceOf(ChaosServiceError);
  });
});

describe("chaosService readiness probe scenario", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isAllowedDeployment.mockReturnValue(true);
    countActiveExecutions.mockResolvedValue(0);
    findActiveExecutionByService.mockResolvedValue(null);
    recordControlPlaneAction.mockResolvedValue({ id: 1, created_at: "2026-05-07T00:00:00.000Z" });
  });

  it("triggers BadReadinessProbe with deterministic readiness metadata", async () => {
    patchServiceReadinessProbe.mockResolvedValue({
      containerName: "payment-service",
      previousReadinessProbe: {
        httpGet: { path: "/health", port: 4000 },
        periodSeconds: 5,
      },
      requestedReadinessProbe: {
        httpGet: { path: "/__chaos__/not-ready", port: 65535 },
        initialDelaySeconds: 0,
        periodSeconds: 5,
        timeoutSeconds: 1,
        failureThreshold: 1,
      },
      changed: true,
    });
    createExecution.mockResolvedValue({
      id: 12,
      scenario_id: "BadReadinessProbe",
      service: "payment-service",
      requested_by: "admin@example.test",
      reason: "probe demo",
      started_at: "2026-05-07T00:00:00.000Z",
      expires_at: "2026-05-07T00:03:00.000Z",
      reverted_at: null,
      revert_mode: null,
      status: "active",
      result: "running",
      metadata_json: {},
    });

    const result = await triggerScenarioExecution({
      scenarioId: "BadReadinessProbe",
      service: "payment-service",
      typedServiceConfirmation: "payment-service",
      typedScenarioConfirmation: "BadReadinessProbe",
      durationSeconds: 180,
      reason: "probe demo",
      actor: { userId: 2, userEmail: "admin@example.test" },
    });

    expect(patchServiceReadinessProbe).toHaveBeenCalledWith({
      service: "payment-service",
      containerName: "payment-service",
      readinessProbe: {
        httpGet: { path: "/__chaos__/not-ready", port: 65535 },
        initialDelaySeconds: 0,
        periodSeconds: 5,
        timeoutSeconds: 1,
        failureThreshold: 1,
      },
    });
    expect(result.mutation.type).toBe("patch_readiness_probe");
  });

  it("reverts BadReadinessProbe execution using stored probe config", async () => {
    findExecutionForManualRevert.mockResolvedValue({
      id: 23,
      scenario_id: "BadReadinessProbe",
      service: "payment-service",
      status: "active",
      metadata_json: {
        containerName: "payment-service",
        originalReadinessProbe: {
          httpGet: { path: "/health", port: 4000 },
          periodSeconds: 5,
        },
      },
    });
    patchServiceReadinessProbe.mockResolvedValue({
      containerName: "payment-service",
      previousReadinessProbe: {
        httpGet: { path: "/__chaos__/not-ready", port: 65535 },
      },
      requestedReadinessProbe: {
        httpGet: { path: "/health", port: 4000 },
        periodSeconds: 5,
      },
      changed: true,
    });
    markExecutionReverted.mockResolvedValue({
      id: 23,
      scenario_id: "BadReadinessProbe",
      service: "payment-service",
      requested_by: "admin@example.test",
      reason: "probe demo",
      started_at: "2026-05-07T00:00:00.000Z",
      expires_at: "2026-05-07T00:03:00.000Z",
      reverted_at: "2026-05-07T00:01:00.000Z",
      revert_mode: "manual",
      status: "reverted",
      result: "success",
      metadata_json: {
        revertedToReadinessProbe: {
          httpGet: { path: "/health", port: 4000 },
          periodSeconds: 5,
        },
      },
    });

    const result = await revertScenarioExecution({
      executionId: 23,
      actor: { userId: 2, userEmail: "admin@example.test" },
      revertMode: "manual",
    });

    expect(patchServiceReadinessProbe).toHaveBeenCalledWith({
      service: "payment-service",
      containerName: "payment-service",
      readinessProbe: {
        httpGet: { path: "/health", port: 4000 },
        periodSeconds: 5,
      },
    });
    expect(result.alreadyReverted).toBe(false);
    expect(result.mutation.type).toBe("patch_readiness_probe");
  });
});

describe("chaosService liveness probe scenario", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isAllowedDeployment.mockReturnValue(true);
    countActiveExecutions.mockResolvedValue(0);
    findActiveExecutionByService.mockResolvedValue(null);
    recordControlPlaneAction.mockResolvedValue({ id: 1, created_at: "2026-05-07T00:00:00.000Z" });
  });

  it("triggers BadLivenessProbe with deterministic liveness metadata", async () => {
    patchServiceLivenessProbe.mockResolvedValue({
      containerName: "payment-service",
      previousLivenessProbe: {
        httpGet: { path: "/health", port: 4000 },
        periodSeconds: 5,
      },
      requestedLivenessProbe: {
        httpGet: { path: "/__chaos__/not-live", port: 65535 },
        initialDelaySeconds: 0,
        periodSeconds: 5,
        timeoutSeconds: 1,
        failureThreshold: 1,
      },
      changed: true,
    });
    createExecution.mockResolvedValue({
      id: 13,
      scenario_id: "BadLivenessProbe",
      service: "payment-service",
      requested_by: "admin@example.test",
      reason: "liveness demo",
      started_at: "2026-05-07T00:00:00.000Z",
      expires_at: "2026-05-07T00:03:00.000Z",
      reverted_at: null,
      revert_mode: null,
      status: "active",
      result: "running",
      metadata_json: {},
    });

    const result = await triggerScenarioExecution({
      scenarioId: "BadLivenessProbe",
      service: "payment-service",
      typedServiceConfirmation: "payment-service",
      typedScenarioConfirmation: "BadLivenessProbe",
      durationSeconds: 180,
      reason: "liveness demo",
      actor: { userId: 2, userEmail: "admin@example.test" },
    });

    expect(patchServiceLivenessProbe).toHaveBeenCalledWith({
      service: "payment-service",
      containerName: "payment-service",
      livenessProbe: {
        httpGet: { path: "/__chaos__/not-live", port: 65535 },
        initialDelaySeconds: 0,
        periodSeconds: 5,
        timeoutSeconds: 1,
        failureThreshold: 1,
      },
    });
    expect(result.mutation.type).toBe("patch_liveness_probe");
  });

  it("reverts BadLivenessProbe execution using stored probe config", async () => {
    findExecutionForManualRevert.mockResolvedValue({
      id: 24,
      scenario_id: "BadLivenessProbe",
      service: "payment-service",
      status: "active",
      metadata_json: {
        containerName: "payment-service",
        originalLivenessProbe: {
          httpGet: { path: "/health", port: 4000 },
          periodSeconds: 5,
        },
      },
    });
    patchServiceLivenessProbe.mockResolvedValue({
      containerName: "payment-service",
      previousLivenessProbe: {
        httpGet: { path: "/__chaos__/not-live", port: 65535 },
      },
      requestedLivenessProbe: {
        httpGet: { path: "/health", port: 4000 },
        periodSeconds: 5,
      },
      changed: true,
    });
    markExecutionReverted.mockResolvedValue({
      id: 24,
      scenario_id: "BadLivenessProbe",
      service: "payment-service",
      requested_by: "admin@example.test",
      reason: "liveness demo",
      started_at: "2026-05-07T00:00:00.000Z",
      expires_at: "2026-05-07T00:03:00.000Z",
      reverted_at: "2026-05-07T00:01:00.000Z",
      revert_mode: "manual",
      status: "reverted",
      result: "success",
      metadata_json: {
        revertedToLivenessProbe: {
          httpGet: { path: "/health", port: 4000 },
          periodSeconds: 5,
        },
      },
    });

    const result = await revertScenarioExecution({
      executionId: 24,
      actor: { userId: 2, userEmail: "admin@example.test" },
      revertMode: "manual",
    });

    expect(patchServiceLivenessProbe).toHaveBeenCalledWith({
      service: "payment-service",
      containerName: "payment-service",
      livenessProbe: {
        httpGet: { path: "/health", port: 4000 },
        periodSeconds: 5,
      },
    });
    expect(result.alreadyReverted).toBe(false);
    expect(result.mutation.type).toBe("patch_liveness_probe");
  });
});

describe("chaosService probe timeout spike scenario", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isAllowedDeployment.mockReturnValue(true);
    countActiveExecutions.mockResolvedValue(0);
    findActiveExecutionByService.mockResolvedValue(null);
    recordControlPlaneAction.mockResolvedValue({ id: 1, created_at: "2026-05-07T00:00:00.000Z" });
  });

  it("triggers ProbeTimeoutSpike with deterministic readiness timeout metadata", async () => {
    patchServiceReadinessProbe.mockResolvedValue({
      containerName: "payment-service",
      previousReadinessProbe: {
        httpGet: { path: "/health", port: 4000 },
        periodSeconds: 5,
      },
      requestedReadinessProbe: {
        exec: { command: ["sh", "-c", "sleep 5"] },
        initialDelaySeconds: 0,
        periodSeconds: 5,
        timeoutSeconds: 1,
        failureThreshold: 1,
        successThreshold: 1,
      },
      changed: true,
    });
    createExecution.mockResolvedValue({
      id: 14,
      scenario_id: "ProbeTimeoutSpike",
      service: "payment-service",
      requested_by: "admin@example.test",
      reason: "timeout demo",
      started_at: "2026-05-07T00:00:00.000Z",
      expires_at: "2026-05-07T00:03:00.000Z",
      reverted_at: null,
      revert_mode: null,
      status: "active",
      result: "running",
      metadata_json: {},
    });

    const result = await triggerScenarioExecution({
      scenarioId: "ProbeTimeoutSpike",
      service: "payment-service",
      typedServiceConfirmation: "payment-service",
      typedScenarioConfirmation: "ProbeTimeoutSpike",
      durationSeconds: 180,
      reason: "timeout demo",
      actor: { userId: 2, userEmail: "admin@example.test" },
    });

    expect(patchServiceReadinessProbe).toHaveBeenCalledWith({
      service: "payment-service",
      containerName: "payment-service",
      readinessProbe: {
        exec: { command: ["sh", "-c", "sleep 5"] },
        initialDelaySeconds: 0,
        periodSeconds: 5,
        timeoutSeconds: 1,
        failureThreshold: 1,
        successThreshold: 1,
      },
    });
    expect(result.mutation.type).toBe("patch_readiness_probe");
  });
});

describe("chaosService latency injection scenario", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isAllowedDeployment.mockReturnValue(true);
    countActiveExecutions.mockResolvedValue(0);
    findActiveExecutionByService.mockResolvedValue(null);
    recordControlPlaneAction.mockResolvedValue({ id: 1, created_at: "2026-05-07T00:00:00.000Z" });
  });

  it("triggers LatencyInjection with deterministic postStart sleep metadata", async () => {
    patchServiceContainerLifecycle.mockResolvedValue({
      containerName: "payment-service",
      previousLifecycle: null,
      requestedLifecycle: {
        postStart: {
          exec: {
            command: ["sh", "-c", "sleep 12"],
          },
        },
      },
      changed: true,
    });
    createExecution.mockResolvedValue({
      id: 15,
      scenario_id: "LatencyInjection",
      service: "payment-service",
      requested_by: "admin@example.test",
      reason: "latency demo",
      started_at: "2026-05-07T00:00:00.000Z",
      expires_at: "2026-05-07T00:03:00.000Z",
      reverted_at: null,
      revert_mode: null,
      status: "active",
      result: "running",
      metadata_json: {},
    });

    const result = await triggerScenarioExecution({
      scenarioId: "LatencyInjection",
      service: "payment-service",
      typedServiceConfirmation: "payment-service",
      typedScenarioConfirmation: "LatencyInjection",
      durationSeconds: 180,
      reason: "latency demo",
      actor: { userId: 2, userEmail: "admin@example.test" },
    });

    expect(patchServiceContainerLifecycle).toHaveBeenCalledWith({
      service: "payment-service",
      containerName: "payment-service",
      lifecycle: {
        postStart: {
          exec: {
            command: ["sh", "-c", "sleep 12"],
          },
        },
      },
    });
    expect(result.mutation.type).toBe("patch_container_lifecycle");
  });

  it("reverts LatencyInjection using stored original lifecycle", async () => {
    findExecutionForManualRevert.mockResolvedValue({
      id: 25,
      scenario_id: "LatencyInjection",
      service: "payment-service",
      status: "active",
      metadata_json: {
        containerName: "payment-service",
        originalLifecycle: null,
        chaosLifecycle: {
          postStart: {
            exec: {
              command: ["sh", "-c", "sleep 12"],
            },
          },
        },
      },
    });
    patchServiceContainerLifecycle.mockResolvedValue({
      containerName: "payment-service",
      previousLifecycle: {
        postStart: {
          exec: {
            command: ["sh", "-c", "sleep 12"],
          },
        },
      },
      requestedLifecycle: null,
      changed: true,
    });
    markExecutionReverted.mockResolvedValue({
      id: 25,
      scenario_id: "LatencyInjection",
      service: "payment-service",
      requested_by: "admin@example.test",
      reason: "latency demo",
      started_at: "2026-05-07T00:00:00.000Z",
      expires_at: "2026-05-07T00:03:00.000Z",
      reverted_at: "2026-05-07T00:01:00.000Z",
      revert_mode: "manual",
      status: "reverted",
      result: "success",
      metadata_json: {
        revertedToLifecycle: null,
      },
    });

    const result = await revertScenarioExecution({
      executionId: 25,
      actor: { userId: 2, userEmail: "admin@example.test" },
      revertMode: "manual",
    });

    expect(patchServiceContainerLifecycle).toHaveBeenCalledWith({
      service: "payment-service",
      containerName: "payment-service",
      lifecycle: null,
    });
    expect(result.alreadyReverted).toBe(false);
    expect(result.mutation.type).toBe("patch_container_lifecycle");
  });
});

describe("chaosService infra env-var scenarios", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isAllowedDeployment.mockReturnValue(true);
    countActiveExecutions.mockResolvedValue(0);
    findActiveExecutionByService.mockResolvedValue(null);
    recordControlPlaneAction.mockResolvedValue({ id: 1, created_at: "2026-05-07T00:00:00.000Z" });
  });

  it("triggers DatabaseUnavailable by patching DB_HOST and stores prior value", async () => {
    patchServiceContainerEnvVar.mockResolvedValue({
      containerName: "payment-service",
      envName: "DB_HOST",
      previousEnvEntry: { name: "DB_HOST", value: "postgres.default.svc.cluster.local" },
      requestedEnvEntry: { name: "DB_HOST", value: "chaos-db-unreachable.invalid" },
      changed: true,
    });
    createExecution.mockResolvedValue({
      id: 31,
      scenario_id: "DatabaseUnavailable",
      service: "payment-service",
      requested_by: "admin@example.test",
      reason: "db demo",
      started_at: "2026-05-07T00:00:00.000Z",
      expires_at: "2026-05-07T00:03:00.000Z",
      status: "active",
      result: "running",
      metadata_json: {},
    });

    const result = await triggerScenarioExecution({
      scenarioId: "DatabaseUnavailable",
      service: "payment-service",
      typedServiceConfirmation: "payment-service",
      typedScenarioConfirmation: "DatabaseUnavailable",
      durationSeconds: 180,
      reason: "db demo",
      actor: { userId: 2, userEmail: "admin@example.test" },
    });

    expect(patchServiceContainerEnvVar).toHaveBeenCalledWith({
      service: "payment-service",
      containerName: "payment-service",
      envName: "DB_HOST",
      envValue: "chaos-db-unreachable.invalid",
    });
    expect(result.mutation.type).toBe("patch_container_env_var");
  });

  it("triggers ErrorRateSpike by patching PORT to force real service traffic failure", async () => {
    patchServiceContainerEnvVar.mockResolvedValue({
      containerName: "payment-service",
      envName: "PORT",
      previousEnvEntry: { name: "PORT", value: "4000" },
      requestedEnvEntry: { name: "PORT", value: "18080" },
      changed: true,
    });
    createExecution.mockResolvedValue({
      id: 35,
      scenario_id: "ErrorRateSpike",
      service: "payment-service",
      requested_by: "admin@example.test",
      reason: "error demo",
      started_at: "2026-05-07T00:00:00.000Z",
      expires_at: "2026-05-07T00:03:00.000Z",
      status: "active",
      result: "running",
      metadata_json: {},
    });

    const result = await triggerScenarioExecution({
      scenarioId: "ErrorRateSpike",
      service: "payment-service",
      typedServiceConfirmation: "payment-service",
      typedScenarioConfirmation: "ErrorRateSpike",
      durationSeconds: 180,
      reason: "error demo",
      actor: { userId: 2, userEmail: "admin@example.test" },
    });

    expect(patchServiceContainerEnvVar).toHaveBeenCalledWith({
      service: "payment-service",
      containerName: "payment-service",
      envName: "PORT",
      envValue: "18080",
    });
    expect(result.mutation.type).toBe("patch_container_env_var");
  });

  it("fails closed for ErrorRateSpike when PORT/service targetPort prerequisites are not met", async () => {
    getServiceChaosPrerequisites.mockResolvedValue({
      service: "payment-service",
      containerName: "payment-service",
      portEnvEntry: null,
      containerPorts: [],
      servicePorts: [{ name: null, port: 80, targetPort: "http" }],
      podAnnotations: { "prometheus.io/scrape": "true" },
      serviceAnnotations: {},
    });

    await expect(
      triggerScenarioExecution({
        scenarioId: "ErrorRateSpike",
        service: "payment-service",
        typedServiceConfirmation: "payment-service",
        typedScenarioConfirmation: "ErrorRateSpike",
        durationSeconds: 180,
        reason: "error blocked",
        actor: { userId: 2, userEmail: "admin@example.test" },
      }),
    ).rejects.toMatchObject({
      name: "ChaosServiceError",
      statusCode: 409,
      message: "ErrorRateSpike prerequisites not met",
    });
  });

  it("reverts KafkaUnavailable to absent env var when it did not previously exist", async () => {
    findExecutionForManualRevert.mockResolvedValue({
      id: 32,
      scenario_id: "KafkaUnavailable",
      service: "user-service",
      status: "active",
      metadata_json: {
        containerName: "user-service",
        chaosEnvVarName: "KAFKA_BROKER",
        originalEnvEntry: null,
      },
    });
    patchServiceContainerEnvVar.mockResolvedValue({
      containerName: "user-service",
      envName: "KAFKA_BROKER",
      previousEnvEntry: { name: "KAFKA_BROKER", value: "chaos-kafka-unreachable.invalid:9092" },
      requestedEnvEntry: null,
      changed: true,
    });
    markExecutionReverted.mockResolvedValue({
      id: 32,
      scenario_id: "KafkaUnavailable",
      service: "user-service",
      status: "reverted",
      result: "success",
      metadata_json: {},
    });

    const result = await revertScenarioExecution({
      executionId: 32,
      actor: { userId: 2, userEmail: "admin@example.test" },
      revertMode: "manual",
    });

    expect(patchServiceContainerEnvVar).toHaveBeenCalledWith({
      service: "user-service",
      containerName: "user-service",
      envName: "KAFKA_BROKER",
      envValue: null,
    });
    expect(result.mutation.type).toBe("patch_container_env_var");
  });
});

describe("chaosService metrics annotation scenario", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isAllowedDeployment.mockReturnValue(true);
    countActiveExecutions.mockResolvedValue(0);
    findActiveExecutionByService.mockResolvedValue(null);
    recordControlPlaneAction.mockResolvedValue({ id: 1, created_at: "2026-05-07T00:00:00.000Z" });
  });

  it("triggers MetricsPipelineDrop by patching prometheus scrape annotation", async () => {
    patchServicePodTemplateAnnotation.mockResolvedValue({
      annotationName: "prometheus.io/scrape",
      hadPreviousAnnotation: true,
      previousAnnotationValue: "true",
      requestedAnnotationValue: "false",
      changed: true,
    });
    createExecution.mockResolvedValue({
      id: 33,
      scenario_id: "MetricsPipelineDrop",
      service: "payment-service",
      requested_by: "admin@example.test",
      reason: "metrics demo",
      started_at: "2026-05-07T00:00:00.000Z",
      expires_at: "2026-05-07T00:03:00.000Z",
      status: "active",
      result: "running",
      metadata_json: {},
    });

    const result = await triggerScenarioExecution({
      scenarioId: "MetricsPipelineDrop",
      service: "payment-service",
      typedServiceConfirmation: "payment-service",
      typedScenarioConfirmation: "MetricsPipelineDrop",
      durationSeconds: 180,
      reason: "metrics demo",
      actor: { userId: 2, userEmail: "admin@example.test" },
    });

    expect(patchServicePodTemplateAnnotation).toHaveBeenCalledWith({
      service: "payment-service",
      annotationName: "prometheus.io/scrape",
      annotationValue: "false",
    });
    expect(result.mutation.type).toBe("patch_pod_template_annotation");
  });

  it("fails closed for MetricsPipelineDrop when annotation-based scrape signal is absent", async () => {
    getServiceChaosPrerequisites.mockResolvedValue({
      service: "payment-service",
      containerName: "payment-service",
      portEnvEntry: { name: "PORT", value: "4000" },
      containerPorts: [{ name: null, containerPort: 4000 }],
      servicePorts: [{ name: null, port: 80, targetPort: 4000 }],
      podAnnotations: {},
      serviceAnnotations: {},
    });

    await expect(
      triggerScenarioExecution({
        scenarioId: "MetricsPipelineDrop",
        service: "payment-service",
        typedServiceConfirmation: "payment-service",
        typedScenarioConfirmation: "MetricsPipelineDrop",
        durationSeconds: 180,
        reason: "metrics blocked",
        actor: { userId: 2, userEmail: "admin@example.test" },
      }),
    ).rejects.toMatchObject({
      name: "ChaosServiceError",
      statusCode: 409,
      message: "MetricsPipelineDrop prerequisites not met",
    });
  });

  it("reverts MetricsPipelineDrop to exact prior annotation value", async () => {
    findExecutionForManualRevert.mockResolvedValue({
      id: 34,
      scenario_id: "MetricsPipelineDrop",
      service: "payment-service",
      status: "active",
      metadata_json: {
        chaosAnnotationName: "prometheus.io/scrape",
        hadOriginalAnnotation: true,
        originalAnnotationValue: "true",
      },
    });
    patchServicePodTemplateAnnotation.mockResolvedValue({
      annotationName: "prometheus.io/scrape",
      hadPreviousAnnotation: true,
      previousAnnotationValue: "false",
      requestedAnnotationValue: "true",
      changed: true,
    });
    markExecutionReverted.mockResolvedValue({
      id: 34,
      scenario_id: "MetricsPipelineDrop",
      service: "payment-service",
      status: "reverted",
      result: "success",
      metadata_json: {},
    });

    const result = await revertScenarioExecution({
      executionId: 34,
      actor: { userId: 2, userEmail: "admin@example.test" },
      revertMode: "manual",
    });

    expect(patchServicePodTemplateAnnotation).toHaveBeenCalledWith({
      service: "payment-service",
      annotationName: "prometheus.io/scrape",
      annotationValue: "true",
    });
    expect(result.mutation.type).toBe("patch_pod_template_annotation");
  });
});
