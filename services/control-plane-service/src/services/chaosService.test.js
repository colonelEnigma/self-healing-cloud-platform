jest.mock("../config/allowlist", () => ({
  CONTROL_PLANE_NAMESPACE: "prod",
  isAllowedDeployment: jest.fn(() => true),
}));

jest.mock("./kubernetesService", () => ({
  getServiceDeploymentSummary: jest.fn(),
  scaleServiceDeployment: jest.fn(),
  patchServiceContainerImage: jest.fn(),
  patchServiceReadinessProbe: jest.fn(),
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
  patchServiceContainerImage,
  patchServiceReadinessProbe,
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
