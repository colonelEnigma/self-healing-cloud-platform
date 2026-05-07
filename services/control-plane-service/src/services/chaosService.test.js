jest.mock("../config/allowlist", () => ({
  CONTROL_PLANE_NAMESPACE: "prod",
  isAllowedDeployment: jest.fn(() => true),
}));

jest.mock("./kubernetesService", () => ({
  getServiceDeploymentSummary: jest.fn(),
  scaleServiceDeployment: jest.fn(),
  patchServiceContainerImage: jest.fn(),
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
