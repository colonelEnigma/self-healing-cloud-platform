jest.mock("../../metrics/metrics", () => ({
  observeMcpRequest: jest.fn(),
  observeMcpRequestDuration: jest.fn(),
  observeMcpFailure: jest.fn(),
  setMcpCircuitState: jest.fn(),
}));

const { runProviderOperation } = require("./mcpClient");

describe("runProviderOperation", () => {
  const baseConfig = {
    providerTimeoutMs: 20,
    providerMaxRetries: 0,
    providerBackoffMs: 1,
    circuitFailureThreshold: 1,
    circuitOpenMs: 1000,
  };

  it("times out core provider call and throws provider error", async () => {
    await expect(
      runProviderOperation({
        provider: "incidents",
        operation: "getIncidentTimeline",
        config: baseConfig,
        executor: () => new Promise((resolve) => setTimeout(resolve, 100)),
      }),
    ).rejects.toThrow("MCP provider operation failed");
  });

  it("opens circuit after threshold failures", async () => {
    await expect(
      runProviderOperation({
        provider: "docs",
        operation: "getDocEvidence",
        config: baseConfig,
        executor: () => {
          throw new Error("down");
        },
      }),
    ).rejects.toThrow("MCP provider operation failed");

    await expect(
      runProviderOperation({
        provider: "docs",
        operation: "getDocEvidence",
        config: baseConfig,
        executor: () => [],
      }),
    ).rejects.toThrow("circuit is open");
  });
});
