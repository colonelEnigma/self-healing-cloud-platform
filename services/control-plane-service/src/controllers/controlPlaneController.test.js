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
  getResilience,
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
