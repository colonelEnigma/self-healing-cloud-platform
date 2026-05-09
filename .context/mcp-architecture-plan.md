# MCP Architecture Plan (Control Plane)

Last updated: 2026-05-09
Status: Draft approved for implementation start in next session
Scope: End-to-end MCP integration for `services/control-plane-service` read paths (no mutation)

## 1) Goal

Implement a clean MCP-based data access layer for Control Plane diagnostics and `POST /api/control-plane/ops/advice` while preserving current guardrails:

- admin-only
- prod-only
- allowlist-only
- read-only for AI/advice/retrieval
- no RBAC broadening
- no secret access
- no delete permissions

## 2) Why This Shape

MCP is introduced in one place first: `control-plane-service`.

Reason:
- keeps business services (`user/order/payment/product/search`) simple and fast
- avoids spreading protocol and reliability complexity across all services
- gives one safe control point for observability, policy, and security

## 3) High-Level Design

`control-plane-service` remains the API entrypoint and becomes an MCP client through one internal gateway layer.

### Runtime layers

1. Controller layer
- existing endpoints unchanged (for UI/API compatibility)

2. Domain service layer
- `opsAdviceService` and analyzer services use canonical domain models only

3. MCP data gateway layer (new)
- one interface for all read sources:
  - deployments/events/logs
  - alerts/metrics
  - incident/audit/healer context
  - docs/runbooks retrieval

4. MCP adapters (new)
- map MCP provider responses to canonical internal contracts
- enforce schema validation and error normalization at boundary

## 4) Canonical Contracts

All MCP adapters must return canonical objects (not provider-native payloads):

- `DeploymentState`
  - `service`, `status`, `desiredReplicas`, `readyReplicas`, `unavailableReplicas`
- `AlertRecord`
  - `name`, `severity`, `state`, `activeAt`, `summary`, `service`
- `IncidentTimeline`
  - existing internal incident timeline shape (no API break)
- `AuditRecord`
  - `action`, `service`, `result`, `reason`, `createdAt`
- `DocEvidence`
  - `path`, `section`, `excerpt`, `score`

Schema rule:
- malformed provider payloads are rejected at adapter boundary and converted to normalized provider errors.

## 5) Reliability Model

Per-provider controls:
- timeout budget per operation
- bounded retries with backoff
- lightweight circuit breaker (open after threshold failures, auto half-open)

Policy:
- strict fail-closed for core advice dependencies:
  - incident timeline
  - incident summaries
- degraded-with-warning for non-core sources:
  - alerts
  - similar incidents
  - docs retrieval
  - optional deployment detail

## 6) Security Model

Enforcement order:
1. auth/admin checks
2. prod namespace enforcement
3. allowlist service validation
4. only then MCP read calls

MCP capability policy:
- read-only capability allowlist in config
- no secret-returning operations
- no write/delete operations exposed through MCP layer

Error hygiene:
- sanitize provider failures
- never include tokens/headers/raw secret values in responses or logs

## 7) Observability

Keep existing:
- `ops_advice_total`
- `ops_advice_duration_ms`

Add MCP metrics:
- `mcp_requests_total{provider,operation,status}`
- `mcp_request_duration_ms{provider,operation,status}`
- `mcp_circuit_state{provider}` (gauge)
- `mcp_failures_total{provider,operation,reason}`

Logging:
- structured logs with `traceId`, `provider`, `operation`, `status`, `latencyMs`

## 8) Configuration

Feature flags:
- `MCP_OPS_ADVICE_ENABLED` (default `false` until cutover)
- `MCP_PROVIDER_TIMEOUT_MS`
- `MCP_PROVIDER_MAX_RETRIES`
- `MCP_PROVIDER_BACKOFF_MS`
- provider endpoint/env keys per source

Guardrail:
- if MCP flag is off, current non-MCP path remains active.

## 9) Rollout Plan (Single Implementation, Controlled Activation)

1. Build full MCP gateway + adapters + tests in one implementation pass.
2. Deploy with `MCP_OPS_ADVICE_ENABLED=false` (code present, inactive).
3. Enable flag in controlled window.
4. Validate:
  - response contract parity
  - fail-closed core behavior
  - metrics/logging visibility
5. Keep rollback simple: disable feature flag.

## 10) Testing Requirements

Must pass before enablement:

- adapter contract tests (valid + malformed payloads)
- ops-advice integration tests with mocked MCP providers
- failure-path tests:
  - core dependency timeout -> `502`
  - non-core dependency timeout -> `200` + warnings
- metrics assertions for MCP counters/histograms
- no regression for existing endpoint schema expected by `cloudpulse-ui`

## 11) File Layout (Target)

Under `services/control-plane-service/src/`:

- `mcp/`
  - `client/` (transport + retries + timeout + circuit)
  - `adapters/`
    - `k8sAdapter.js`
    - `prometheusAdapter.js`
    - `incidentsAdapter.js`
    - `docsAdapter.js`
  - `contracts/`
    - `schemas.js`
  - `errors/`
    - `mcpErrors.js`
  - `gateway/`
    - `mcpDataGateway.js`

Integration points:
- `services/opsAdviceService.js` -> consume `mcpDataGateway` when feature flag is enabled
- existing services remain fallback path

## 12) Non-Goals

- no migration of shop runtime APIs to MCP
- no MCP write operations
- no control-plane mutation expansion
- no RBAC expansion beyond current policy

## 13) Acceptance Criteria

Implementation is complete when all are true:

1. `ops/advice` can run through MCP with no response contract break.
2. Core dependencies preserve strict fail-closed behavior (`502`).
3. Non-core source failures produce warnings and grounded output.
4. MCP metrics and traceable logs are visible.
5. Guardrails (admin/prod/allowlist/read-only) remain enforced.
6. Feature-flag rollback path is verified.

