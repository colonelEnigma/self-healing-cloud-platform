jest.mock("./externalReadService", () => ({
  getAlertsFromPrometheus: jest.fn(),
  getHealingHistory: jest.fn(),
}));

jest.mock("./kubernetesService", () => ({
  getServiceEvents: jest.fn(),
  getServiceLogs: jest.fn(),
}));

jest.mock("./auditService", () => ({
  listControlPlaneActionsByServiceAndWindow: jest.fn(),
}));

jest.mock("./chaosExecutionRepository", () => ({
  listExecutionsByService: jest.fn(),
}));

jest.mock("./incidentSummaryRepository", () => ({
  upsertIncidentSummaryByExecutionId: jest.fn(),
  listIncidentSummariesByService: jest.fn(),
}));

const {
  getAlertsFromPrometheus,
  getHealingHistory,
} = require("./externalReadService");
const { getServiceEvents, getServiceLogs } = require("./kubernetesService");
const {
  listControlPlaneActionsByServiceAndWindow,
} = require("./auditService");
const { listExecutionsByService } = require("./chaosExecutionRepository");
const {
  upsertIncidentSummaryByExecutionId,
  listIncidentSummariesByService,
} = require("./incidentSummaryRepository");
const {
  getIncidentTimelineByService,
} = require("./incidentAnalyzerService");

describe("incidentAnalyzerService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listIncidentSummariesByService.mockResolvedValue([]);
  });

  it("returns deterministic empty payload when no executions exist", async () => {
    listExecutionsByService.mockResolvedValue([]);

    const result = await getIncidentTimelineByService({
      service: "payment-service",
    });

    expect(result).toEqual(
      expect.objectContaining({
        service: "payment-service",
        timeline: [],
        probableCauseCandidates: [],
        confidence: 0,
        recovery: expect.objectContaining({ state: "no_incidents" }),
      }),
    );
  });

  it("builds deterministic timeline, candidates, confidence and persists summaries", async () => {
    listExecutionsByService.mockResolvedValue([
      {
        id: 101,
        scenario_id: "ScaleToZero",
        service: "payment-service",
        reason: "test",
        started_at: "2026-05-08T09:00:00.000Z",
        expires_at: "2026-05-08T09:05:00.000Z",
        reverted_at: "2026-05-08T09:03:00.000Z",
        revert_mode: "auto",
        status: "reverted",
        result: "success",
        metadata_json: {},
      },
    ]);
    getServiceEvents.mockResolvedValue([
      {
        type: "Warning",
        reason: "Failed",
        message: "Readiness probe failed",
        firstTimestamp: "2026-05-08T09:01:00.000Z",
        lastTimestamp: "2026-05-08T09:01:30.000Z",
      },
    ]);
    getServiceLogs.mockResolvedValue({
      entries: [{ log: "ERROR timeout connection refused" }],
    });
    getAlertsFromPrometheus.mockResolvedValue([
      {
        state: "firing",
        name: "ServiceDown",
        service: "payment-service",
        activeAt: "2026-05-08T09:02:00.000Z",
      },
    ]);
    listControlPlaneActionsByServiceAndWindow.mockResolvedValue([
      {
        action: "scale",
        result: "success",
        reason: "replicas patched",
        created_at: "2026-05-08T09:03:10.000Z",
      },
    ]);
    getHealingHistory.mockResolvedValue({
      actions: [
        {
          action: "heal",
          result: "success",
          created_at: "2026-05-08T09:02:30.000Z",
        },
      ],
    });

    const result = await getIncidentTimelineByService({
      service: "payment-service",
      limit: 5,
      lookbackMinutes: 30,
    });

    expect(upsertIncidentSummaryByExecutionId).toHaveBeenCalledTimes(1);
    expect(result.timeline.length).toBeGreaterThan(0);
    expect(result.probableCauseCandidates.length).toBeGreaterThan(0);
    expect(
      result.probableCauseCandidates.map((candidate) => candidate.key),
    ).toContain("chaos_scenario_triggered");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.recovery.state).toBe("recovered");
  });

  it("derives in_progress recovery for active execution", async () => {
    listExecutionsByService.mockResolvedValue([
      {
        id: 201,
        scenario_id: "LatencyInjection",
        service: "order-service",
        started_at: "2026-05-08T09:00:00.000Z",
        expires_at: "2026-05-08T09:10:00.000Z",
        reverted_at: null,
        status: "active",
        result: "running",
        metadata_json: {},
      },
    ]);
    getServiceEvents.mockResolvedValue([]);
    getServiceLogs.mockResolvedValue({ entries: [] });
    getAlertsFromPrometheus.mockResolvedValue([]);
    listControlPlaneActionsByServiceAndWindow.mockResolvedValue([]);
    getHealingHistory.mockResolvedValue({ actions: [] });

    const result = await getIncidentTimelineByService({
      service: "order-service",
    });

    expect(result.recovery).toEqual({
      state: "in_progress",
      outcome: "scenario_active",
      by: "none",
    });
  });

  it("continues with warnings when alerts/logs reads fail", async () => {
    listExecutionsByService.mockResolvedValue([
      {
        id: 301,
        scenario_id: "ProbeTimeoutSpike",
        service: "search-service",
        started_at: "2026-05-08T09:00:00.000Z",
        expires_at: "2026-05-08T09:10:00.000Z",
        reverted_at: "2026-05-08T09:04:00.000Z",
        status: "reverted",
        result: "success",
        metadata_json: {},
      },
    ]);
    getServiceEvents.mockResolvedValue([]);
    getServiceLogs.mockRejectedValue(new Error("k8s log stream closed"));
    getAlertsFromPrometheus.mockRejectedValue(new Error("prometheus timeout"));
    listControlPlaneActionsByServiceAndWindow.mockResolvedValue([]);
    getHealingHistory.mockResolvedValue({ actions: [] });

    const result = await getIncidentTimelineByService({
      service: "search-service",
    });

    expect(result.warnings).toContain("service logs unavailable: k8s log stream closed");
    expect(result.warnings).toContain("prometheus alerts unavailable: prometheus timeout");
    expect(result.timeline).toEqual(expect.any(Array));
  });
});
