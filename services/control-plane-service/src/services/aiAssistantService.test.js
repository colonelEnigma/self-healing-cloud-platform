jest.mock("axios", () => ({
  create: jest.fn(),
}));

jest.mock("./kubernetesService", () => ({
  getAllowlistedDeploymentSummaries: jest.fn(),
  getServiceDeploymentSummary: jest.fn(),
  getServiceEvents: jest.fn(),
  getServiceLogs: jest.fn(),
}));

jest.mock("./externalReadService", () => ({
  getServiceHealthFromPrometheus: jest.fn(),
  getAlertsFromPrometheus: jest.fn(),
  getHealingHistory: jest.fn(),
  getOrderServiceResilience: jest.fn(),
}));

jest.mock("./auditService", () => ({
  listControlPlaneActions: jest.fn(),
}));

const axios = require("axios");
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
const postMock = jest.fn();
axios.create.mockReturnValue({ post: postMock });
const service = require("./aiAssistantService");

describe("aiAssistantService", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    process.env.LM_STUDIO_MODEL = "gemma3:4b";
    process.env.LM_STUDIO_BASE_URL = "http://localhost:1234/v1";

    getAllowlistedDeploymentSummaries.mockResolvedValue([
      {
        service: "order-service",
        namespace: "prod",
        status: "healthy",
        desiredReplicas: 1,
        readyReplicas: 1,
      },
    ]);
    getServiceHealthFromPrometheus.mockResolvedValue({
      "order-service": { status: "up", value: 1 },
    });
    getAlertsFromPrometheus.mockResolvedValue([]);
    getHealingHistory.mockResolvedValue({ actions: [] });
    listControlPlaneActions.mockResolvedValue({ actions: [] });
    getServiceDeploymentSummary.mockResolvedValue({
      service: "order-service",
      status: "healthy",
    });
    getServiceEvents.mockResolvedValue([]);
    getServiceLogs.mockResolvedValue({
      service: "order-service",
      namespace: "prod",
      entries: [
        {
          service: "order-service",
          pod: "order-service-abc",
          container: "order-service",
          log: "2026-05-02T10:00:00Z ok",
        },
      ],
    });
    getOrderServiceResilience.mockResolvedValue({
      service: "order-service",
      circuitBreakers: [{ dependency: "product-service", state: "closed" }],
    });
  });

  afterEach(() => {
    delete process.env.LM_STUDIO_MODEL;
    delete process.env.LM_STUDIO_BASE_URL;
  });

  it("rejects non-allowlisted service context", () => {
    const result = service.validateAiChatRequest({
      mode: "service-diagnostics",
      service: "inventory-service",
      question: "What is wrong?",
    });

    expect(result).toEqual({
      valid: false,
      status: 400,
      message: "Service is not allowlisted for control plane AI context",
      service: "inventory-service",
      allowedDeployments: [
        "user-service",
        "order-service",
        "payment-service",
        "product-service",
        "search-service",
      ],
    });
  });

  it("calls LM Studio with bounded live context and read-only instructions", async () => {
    postMock.mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              content: "order-service is healthy.",
            },
          },
        ],
      },
    });

    const result = await service.chatWithLmStudio({
      mode: "incident-summary",
      service: "order-service",
      question: "Why is order-service unhealthy?",
    });

    expect(postMock).toHaveBeenCalledWith("/chat/completions", {
      model: "gemma3:4b",
      messages: expect.any(Array),
      temperature: 0.2,
      max_tokens: 700,
    });
    const messages = postMock.mock.calls[0][1].messages;
    expect(messages[0].content).toContain("read-only assistant");
    expect(messages[1].content).toContain("Selected service: order-service");
    expect(messages[1].content).toContain("Live context:");
    expect(getServiceLogs).toHaveBeenCalledWith("order-service", {
      tailLines: 80,
      maxPods: 2,
    });
    expect(result).toMatchObject({
      model: "gemma3:4b",
      mode: "incident-summary",
      service: "order-service",
      answer: "order-service is healthy.",
      contextUsed: expect.arrayContaining([
        "overview",
        "service",
        "logs",
        "resilience",
      ]),
    });
  });
});
