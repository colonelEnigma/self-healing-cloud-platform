jest.mock("./externalReadService", () => ({
  getAlertsFromPrometheus: jest.fn(),
}));

jest.mock("./incidentAnalyzerService", () => ({
  getIncidentTimelineByService: jest.fn(),
}));

jest.mock("./kubernetesService", () => ({
  getServiceDeploymentSummary: jest.fn(),
}));

jest.mock("./similarIncidentService", () => ({
  getSimilarIncidentsByService: jest.fn(),
}));

jest.mock("./incidentSummaryRepository", () => ({
  listIncidentSummariesByService: jest.fn(),
}));

const { getAlertsFromPrometheus } = require("./externalReadService");
const { getIncidentTimelineByService } = require("./incidentAnalyzerService");
const { getServiceDeploymentSummary } = require("./kubernetesService");
const { getSimilarIncidentsByService } = require("./similarIncidentService");
const { listIncidentSummariesByService } = require("./incidentSummaryRepository");
const { getOpsAdvice } = require("./opsAdviceService");

describe("getOpsAdvice", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("fails closed when incident timeline or summary sources fail", async () => {
    getIncidentTimelineByService.mockRejectedValue(
      new Error("incident store unavailable"),
    );
    listIncidentSummariesByService.mockRejectedValue(new Error("db timeout"));
    getServiceDeploymentSummary.mockResolvedValue({
      service: "payment-service",
      status: "healthy",
      desiredReplicas: 1,
      readyReplicas: 1,
      unavailableReplicas: 0,
    });
    getAlertsFromPrometheus.mockResolvedValue([]);
    getSimilarIncidentsByService.mockResolvedValue({ results: [], warnings: [] });

    await expect(
      getOpsAdvice({
        service: "payment-service",
        question: "What should I check next?",
      }),
    ).rejects.toThrow("incident store unavailable");
  });
});
