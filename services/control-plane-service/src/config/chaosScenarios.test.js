const {
  CANONICAL_SCENARIOS,
  resolveScenarioId,
} = require("./chaosScenarios");

describe("chaosScenarios resolver", () => {
  it("resolves canonical scenario id directly", () => {
    const resolved = resolveScenarioId("ScaleToZero");
    expect(resolved).toEqual({
      originalId: "ScaleToZero",
      canonicalId: "ScaleToZero",
      isDeprecatedAlias: false,
    });
  });

  it("returns null for unknown scenario id", () => {
    expect(resolveScenarioId("NotARealScenario")).toBeNull();
  });

  it("keeps canonical catalog compact", () => {
    expect(CANONICAL_SCENARIOS.length).toBeLessThanOrEqual(10);
  });
});
