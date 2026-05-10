describe("mcpDataGateway getDocEvidence intent-aware ranking", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  const loadGatewayWithCorpus = (resolver) => {
    jest.doMock("fs/promises", () => ({
      readFile: jest.fn(async (absPath) => resolver(absPath)),
    }));
    jest.doMock("../client/mcpClient", () => ({
      runProviderOperation: jest.fn(async ({ executor }) => executor()),
    }));
    return require("./mcpDataGateway");
  };

  it("prefers rollback/promotion runbooks over .context for runbook_lookup", async () => {
    const gateway = loadGatewayWithCorpus((absPath) => {
      if (absPath.includes("backend-context.md")) {
        return "# Context\nrollback rollback rollback operational notes";
      }
      if (absPath.includes("rollback-runbook.md")) {
        return "# Rollback Steps\nrollback";
      }
      if (absPath.includes("jenkins-promotion-runbook.md")) {
        return "# Promotion Steps\npromotion";
      }
      return "# Doc\n";
    });

    const results = await gateway.getDocEvidence({
      question: "need rollback runbook procedure",
      service: "payment-service",
      intent: "runbook_lookup",
      maxResults: 3,
      traceId: "t-1",
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toBe("docs/rollback-runbook.md");
    expect(results.some((item) => item.path.startsWith(".context/"))).toBe(true);
  });

  it("returns non-empty fallback runbook citations for runbook_lookup when lexical matches are sparse", async () => {
    const gateway = loadGatewayWithCorpus(() => "# Generic\nplugh xyzzy qwerty");

    const results = await gateway.getDocEvidence({
      question: "zxqv unmatched token",
      service: "payment-service",
      intent: "runbook_lookup",
      maxResults: 4,
      traceId: "t-2",
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((item) => item.path.startsWith("docs/"))).toBe(true);
    expect(results.some((item) => item.path === "docs/rollback-runbook.md")).toBe(true);
    expect(results.some((item) => item.path === "docs/jenkins-promotion-runbook.md")).toBe(true);
    expect(results.every((item) => Number(item.score) === 0)).toBe(true);
  });

  it("keeps existing lexical-first behavior for non-runbook intents", async () => {
    const gateway = loadGatewayWithCorpus((absPath) => {
      if (absPath.includes("backend-context.md")) {
        return "# Context\nfailure failure failure incident diagnostics";
      }
      if (absPath.includes("rollback-runbook.md")) {
        return "# Rollback\nfailure";
      }
      return "# Doc\n";
    });

    const results = await gateway.getDocEvidence({
      question: "failure incident diagnostics",
      service: "payment-service",
      intent: "incident_diagnosis",
      maxResults: 2,
      traceId: "t-3",
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toBe(".context/backend-context.md");
  });

  it("boosts runbook synonyms for jenkins promote phrasing", async () => {
    const gateway = loadGatewayWithCorpus((absPath) => {
      if (absPath.includes("jenkins-promotion-runbook.md")) {
        return "# Promotion\npipeline promotion workflow";
      }
      if (absPath.includes("backend-context.md")) {
        return "# Context\npipeline pipeline pipeline notes";
      }
      return "# Doc\n";
    });

    const results = await gateway.getDocEvidence({
      question: "what is the jenkins promote flow for prod",
      service: "order-service",
      intent: "runbook_lookup",
      maxResults: 2,
      traceId: "t-4",
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toBe("docs/jenkins-promotion-runbook.md");
  });
});
