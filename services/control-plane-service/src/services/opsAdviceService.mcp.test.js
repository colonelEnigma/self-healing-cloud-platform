describe("getOpsAdvice MCP mode", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.MCP_OPS_ADVICE_ENABLED = "true";
  });

  afterEach(() => {
    delete process.env.MCP_OPS_ADVICE_ENABLED;
  });

  it("fails closed when MCP core incident timeline fails", async () => {
    jest.doMock("./similarIncidentService", () => ({
      getSimilarIncidentsByService: jest.fn().mockResolvedValue({ results: [], warnings: [] }),
    }));
    jest.doMock("../mcp/gateway/mcpDataGateway", () => ({
      getIncidentTimeline: jest.fn().mockRejectedValue(new Error("core timeout")),
      getIncidentSummaries: jest.fn().mockResolvedValue([]),
      getDeploymentState: jest.fn().mockResolvedValue(null),
      getAlerts: jest.fn().mockResolvedValue([]),
      getDocEvidence: jest.fn().mockResolvedValue([]),
    }));

    const { getOpsAdvice } = require("./opsAdviceService");

    await expect(
      getOpsAdvice({ service: "payment-service", question: "What failed?" }),
    ).rejects.toThrow("core timeout");
  });

  it("degrades non-core docs retrieval with warnings and returns contract", async () => {
    jest.doMock("./similarIncidentService", () => ({
      getSimilarIncidentsByService: jest.fn().mockResolvedValue({ results: [], warnings: [] }),
    }));
    jest.doMock("../mcp/gateway/mcpDataGateway", () => ({
      getIncidentTimeline: jest.fn().mockResolvedValue({
        service: "payment-service",
        incidents: [{ scenarioId: "ScaleToZero" }],
        confidence: 0.4,
        probableCauseCandidates: [],
        recovery: { state: "in_progress" },
      }),
      getIncidentSummaries: jest.fn().mockResolvedValue([]),
      getDeploymentState: jest.fn().mockResolvedValue({
        service: "payment-service",
        status: "degraded",
        desiredReplicas: 1,
        readyReplicas: 0,
        unavailableReplicas: 1,
      }),
      getAlerts: jest.fn().mockResolvedValue([]),
      getDocEvidence: jest.fn().mockRejectedValue(new Error("docs timeout")),
    }));

    const { getOpsAdvice } = require("./opsAdviceService");
    const result = await getOpsAdvice({
      service: "payment-service",
      question: "what should I check",
    });

    expect(result).toEqual(
      expect.objectContaining({
        service: "payment-service",
        intent: expect.any(String),
        answer: expect.any(String),
        evidence: expect.any(Object),
        unknowns: expect.any(Array),
        citations: expect.any(Array),
      }),
    );
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining("docs retrieval unavailable")]));
  });

  it("adds low-confidence warning when runbook_lookup uses fallback citations", async () => {
    jest.doMock("./similarIncidentService", () => ({
      getSimilarIncidentsByService: jest.fn().mockResolvedValue({ results: [], warnings: [] }),
    }));
    jest.doMock("../mcp/gateway/mcpDataGateway", () => ({
      getIncidentTimeline: jest.fn().mockResolvedValue({
        service: "payment-service",
        incidents: [{ scenarioId: "ScaleToZero" }],
        confidence: 0.4,
        probableCauseCandidates: [],
        recovery: { state: "in_progress" },
      }),
      getIncidentSummaries: jest.fn().mockResolvedValue([]),
      getDeploymentState: jest.fn().mockResolvedValue(null),
      getAlerts: jest.fn().mockResolvedValue([]),
      getDocEvidence: jest.fn().mockResolvedValue([
        {
          path: "docs/rollback-runbook.md",
          section: "Document",
          excerpt: "fallback",
          score: 0,
        },
      ]),
    }));

    const { getOpsAdvice } = require("./opsAdviceService");
    const result = await getOpsAdvice({
      service: "payment-service",
      question: "show runbook procedure for rollback",
    });

    expect(result.intent).toBe("runbook_lookup");
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("low lexical confidence")]),
    );
  });
});
