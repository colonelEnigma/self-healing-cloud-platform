const { toDeploymentState } = require("./k8sAdapter");
const { toAlertRecords } = require("./prometheusAdapter");
const { toDocEvidence } = require("./docsAdapter");

describe("MCP adapters contract validation", () => {
  it("maps valid deployment payload", () => {
    expect(
      toDeploymentState({
        service: "payment-service",
        status: "healthy",
        desiredReplicas: 1,
        readyReplicas: 1,
        unavailableReplicas: 0,
      }),
    ).toEqual({
      service: "payment-service",
      status: "healthy",
      desiredReplicas: 1,
      readyReplicas: 1,
      unavailableReplicas: 0,
    });
  });

  it("rejects malformed deployment payload", () => {
    expect(() => toDeploymentState({ service: "payment-service" })).toThrow(
      "Malformed DeploymentState payload",
    );
  });

  it("maps valid alert records", () => {
    expect(
      toAlertRecords([
        {
          service: "payment-service",
          name: "ServiceDown",
          severity: "critical",
          state: "firing",
          activeAt: "2026-05-09T10:00:00.000Z",
          summary: "svc down",
        },
      ]),
    ).toEqual([
      {
        service: "payment-service",
        name: "ServiceDown",
        severity: "critical",
        state: "firing",
        activeAt: "2026-05-09T10:00:00.000Z",
        summary: "svc down",
      },
    ]);
  });

  it("rejects malformed docs payload", () => {
    expect(() => toDocEvidence({})).toThrow("Malformed DocEvidence payload");
  });
});
