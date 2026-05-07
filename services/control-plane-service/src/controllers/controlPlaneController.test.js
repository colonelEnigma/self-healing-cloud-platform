jest.mock("../services/kubernetesService", () => ({
  getAllowlistedDeploymentSummaries: jest.fn(),
  getServiceDeploymentSummary: jest.fn(),
  listReplicaSetsByService: jest.fn(),
  getServiceEvents: jest.fn(),
  getServiceLogs: jest.fn(),
  scaleServiceDeployment: jest.fn(),
}));

jest.mock("../services/auditService", () => ({
  recordControlPlaneAction: jest.fn(),
  listControlPlaneActions: jest.fn(),
}));

jest.mock("../services/externalReadService", () => ({
  getServiceHealthFromPrometheus: jest.fn(),
  getAlertsFromPrometheus: jest.fn(),
  getHealingHistory: jest.fn(),
  getOrderServiceResilience: jest.fn(),
}));

jest.mock("../services/chaosService", () => {
  class MockChaosServiceError extends Error {
    constructor(statusCode, message, details = {}) {
      super(message);
      this.name = "ChaosServiceError";
      this.statusCode = statusCode;
      this.details = details;
    }
  }

  return {
    ChaosServiceError: MockChaosServiceError,
    getScenarioCatalog: jest.fn(),
    triggerScenarioExecution: jest.fn(),
    revertScenarioExecution: jest.fn(),
    revertAllActiveScenarioExecutions: jest.fn(),
  };
});

const {
  scaleServiceDeployment,
} = require("../services/kubernetesService");
const {
  recordControlPlaneAction,
} = require("../services/auditService");
const {
  getHealingHistory,
  getOrderServiceResilience,
} = require("../services/externalReadService");
const {
  ChaosServiceError,
  getScenarioCatalog,
  triggerScenarioExecution,
  revertScenarioExecution,
  revertAllActiveScenarioExecutions,
} = require("../services/chaosService");
const {
  getResilience,
  getChaosScenarios,
  postTriggerChaosScenario,
  postRevertChaosScenario,
  postRevertAllChaosScenarios,
  postScaleAction,
} = require("./controlPlaneController");

const buildResponse = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe("postScaleAction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("audits an error when an otherwise valid scale request fails", async () => {
    const scaleError = new Error("kubernetes patch failed");
    scaleServiceDeployment.mockRejectedValue(scaleError);
    recordControlPlaneAction.mockResolvedValue({
      id: 42,
      created_at: "2026-05-01T15:45:00.000Z",
    });

    const req = {
      user: {
        id: 7,
        email: "admin@example.test",
        role: "admin",
      },
      body: {
        namespace: "prod",
        service: "product-service",
        replicas: 1,
        confirmation: "product-service",
      },
    };
    const res = buildResponse();

    await postScaleAction(req, res);

    expect(scaleServiceDeployment).toHaveBeenCalledWith({
      service: "product-service",
      replicas: 1,
    });
    expect(recordControlPlaneAction).toHaveBeenCalledWith({
      userId: 7,
      userEmail: "admin@example.test",
      namespace: "prod",
      service: "product-service",
      action: "scale",
      requestedReplicas: 1,
      previousReplicas: null,
      result: "error",
      reason: "kubernetes patch failed",
    });
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      message: "Scale action failed",
      namespace: "prod",
      service: "product-service",
      requestedReplicas: 1,
      error: "kubernetes patch failed",
      auditId: 42,
    });
  });
});

describe("getResilience", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns healer safeguards and order circuit breaker diagnostics", async () => {
    const recentTime = new Date().toISOString();
    getHealingHistory.mockResolvedValue({
      actions: [
        {
          alert_name: "ServiceDown",
          namespace: "prod",
          deployment: "payment-service",
          result: "error",
          reason: "patch failed",
          created_at: recentTime,
        },
        {
          alert_name: "ServiceDown",
          namespace: "prod",
          deployment: "payment-service",
          result: "error",
          reason: "patch failed",
          created_at: recentTime,
        },
        {
          alert_name: "ServiceDown",
          namespace: "prod",
          deployment: "payment-service",
          result: "error",
          reason: "patch failed",
          created_at: recentTime,
        },
      ],
    });
    getOrderServiceResilience.mockResolvedValue({
      service: "order-service",
      circuitBreakers: [
        {
          dependency: "product-service",
          state: "closed",
        },
      ],
    });

    const res = buildResponse();

    await getResilience({}, res);

    expect(getHealingHistory).toHaveBeenCalledWith({
      alertName: "ServiceDown",
      limit: 100,
      page: 1,
    });
    expect(getOrderServiceResilience).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);

    const payload = res.json.mock.calls[0][0];
    const paymentState =
      payload.mechanisms.healerServiceDownPolicy.serviceState.find(
        (item) => item.service === "payment-service",
      );

    expect(payload.namespace).toBe("prod");
    expect(payload.mechanisms.orderProductCircuitBreaker.service).toBe(
      "order-service",
    );
    expect(payload.mechanisms.manualScaleGuard.allowedReplicas).toEqual([0, 1]);
    expect(paymentState.circuitBreaker).toEqual({
      state: "open",
      failureCount: 3,
      failureThreshold: 3,
      windowMinutes: 30,
    });
  });
});

describe("chaos scenario endpoints", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns scenario catalog", async () => {
    getScenarioCatalog.mockResolvedValue({
      activeScenarioCount: 0,
      scenarios: [{ id: "ScaleToZero", enabled: true }],
    });

    const res = buildResponse();
    await getChaosScenarios({}, res);

    expect(getScenarioCatalog).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      activeScenarioCount: 0,
      scenarios: [{ id: "ScaleToZero", enabled: true }],
    });
  });

  it("triggers chaos scenario with typed confirmations", async () => {
    triggerScenarioExecution.mockResolvedValue({
      scenario: {
        id: "ScaleToZero",
        name: "Scale To Zero",
        category: "Availability Failures",
        autoRevert: true,
      },
      execution: {
        id: 10,
        scenarioId: "ScaleToZero",
        service: "payment-service",
      },
      mutation: {
        previousReplicas: 1,
        requestedReplicas: 0,
        changed: true,
      },
      scale: {
        previousReplicas: 1,
        requestedReplicas: 0,
        changed: true,
      },
      audit: {
        id: 55,
        created_at: "2026-05-03T10:00:00.000Z",
      },
    });

    const req = {
      user: {
        id: 2,
        email: "admin@example.test",
      },
      body: {
        scenarioId: "ScaleToZero",
        service: "payment-service",
        durationSeconds: 180,
        confirmationService: "payment-service",
        confirmationScenario: "ScaleToZero",
        reason: "demo",
      },
    };
    const res = buildResponse();

    await postTriggerChaosScenario(req, res);

    expect(triggerScenarioExecution).toHaveBeenCalledWith({
      scenarioId: "ScaleToZero",
      service: "payment-service",
      typedServiceConfirmation: "payment-service",
      typedScenarioConfirmation: "ScaleToZero",
      durationSeconds: 180,
      reason: "demo",
      actor: {
        userId: 2,
        userEmail: "admin@example.test",
      },
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      message: "Chaos scenario triggered",
      scenario: {
        id: "ScaleToZero",
        name: "Scale To Zero",
        category: "Availability Failures",
        autoRevert: true,
      },
      execution: {
        id: 10,
        scenarioId: "ScaleToZero",
        service: "payment-service",
      },
      mutation: {
        previousReplicas: 1,
        requestedReplicas: 0,
        changed: true,
      },
      scale: {
        previousReplicas: 1,
        requestedReplicas: 0,
        changed: true,
      },
      auditId: 55,
      auditedAt: "2026-05-03T10:00:00.000Z",
    });
  });

  it("returns typed error response when trigger fails validation", async () => {
    triggerScenarioExecution.mockRejectedValue(
      new ChaosServiceError(400, "Typed scenario confirmation must exactly match scenarioId"),
    );

    const req = {
      user: {
        id: 2,
        email: "admin@example.test",
      },
      body: {
        scenarioId: "ScaleToZero",
        service: "payment-service",
        confirmationService: "payment-service",
        confirmationScenario: "WrongScenario",
      },
    };
    const res = buildResponse();

    await postTriggerChaosScenario(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: "Typed scenario confirmation must exactly match scenarioId",
    });
  });

  it("returns 400 when revert executionId is invalid", async () => {
    const req = {
      user: {
        id: 2,
        email: "admin@example.test",
      },
      body: {
        executionId: "abc",
      },
    };
    const res = buildResponse();

    await postRevertChaosScenario(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: "executionId must be an integer when provided",
    });
  });

  it("reverts all active chaos scenarios", async () => {
    revertAllActiveScenarioExecutions.mockResolvedValue({
      total: 2,
      reverted: 2,
      failed: 0,
      results: [],
    });

    const req = {
      user: {
        id: 2,
        email: "admin@example.test",
      },
      body: {},
    };
    const res = buildResponse();

    await postRevertAllChaosScenarios(req, res);

    expect(revertAllActiveScenarioExecutions).toHaveBeenCalledWith({
      actor: {
        userId: 2,
        userEmail: "admin@example.test",
      },
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: "Processed revert-all request for active chaos scenarios",
      total: 2,
      reverted: 2,
      failed: 0,
      results: [],
    });
  });
});
