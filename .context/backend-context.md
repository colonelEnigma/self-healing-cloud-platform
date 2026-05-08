# Backend Context (Canonical)

Last updated: 2026-05-08 (Phase 3 complete)

## Purpose

Single source of truth for backend/shared project context, implementation status, validation progress, and next steps.

Related references:
- Frontend-only plan (do not merge here): `.context/PlanFrontendShadcn.md`
- Chaos implementation plan/source of truth: `.context/control-plane-chaos-plan.md`
- Repository operational guardrails: `AGENTS.md`

## Current Platform State

- EKS namespaces in active use: `dev` and `prod` (`test` decommissioned in repo config on 2026-05-03).
- Shared infra remains in `default` (Kafka, Zookeeper, PostgreSQL, Prometheus, Alertmanager, healer-service).
- `control-plane-service` is implemented and deployed in `monitoring`.
- Jenkins flow is active: deploy changed services to `dev`, promote immutable tags to `prod` through `jenkins/promotion.env`.
- Rollback is controlled through `jenkins/rollback.env`.

## Control Plane Scope and Safety

- Control Plane is admin-only, prod-only, live-data-only, allowlist-only.
- Allowed app deployments: `user-service`, `order-service`, `payment-service`, `product-service`, `search-service`.
- Only allowed mutation: typed-confirmed scale to replicas `0` or `1`, with audit logging.
- No secret access, no delete permissions, no broad cluster mutation.
- AI assistant endpoints are read-only/advisory:
  - `GET /api/control-plane/ai/status`
  - `POST /api/control-plane/ai/chat`

## Implemented Backend Surface

- Core control-plane routes implemented for status, overview, deployments, service detail, logs, events, alerts, resilience, healer history, and manual action audit.
- Guarded scale route implemented:
  - `POST /api/control-plane/actions/scale`
- Chaos Phase 1 routes implemented:
  - `GET /api/control-plane/demo/scenarios`
  - `POST /api/control-plane/demo/scenarios/trigger`
  - `POST /api/control-plane/demo/scenarios/revert`
  - `POST /api/control-plane/demo/scenarios/revert-all`
- Persistence implemented:
  - `control_plane_actions`
  - `chaos_scenario_executions`
- Auto-revert scheduler implemented via `CHAOS_AUTO_REVERT_POLL_MS` (default 15000 ms).

## Current Progress (Validated)

Phase 1 (Chaos Scenario Engine + Audit Foundation) is implemented and validated through UI/backend integration for the currently enabled scenario set.

Validated now:
- `ScaleToZero` trigger flow
- `ImagePullFailSimulation` trigger/revert flow
- `BadReadinessProbe` trigger/revert flow
- `BadLivenessProbe` trigger/revert flow
- `ProbeTimeoutSpike` trigger/revert flow
- `LatencyInjection` trigger/revert flow
- Manual revert (single active execution)
- Revert all active executions
- Audit trail visibility for actions
- Max active scenario limit behavior (`CHAOS_MAX_ACTIVE_SCENARIOS`, default 3)

Current execution scope:
- All canonical scenarios are enabled for Phase 1 execution.
- `ErrorRateSpike`, `DatabaseUnavailable`, and `KafkaUnavailable` now execute as real deployment env mutations with deterministic exact prior-value revert metadata (including previously-absent env var restoration).
- `MetricsPipelineDrop` now executes as a real deployment pod-template annotation mutation (`prometheus.io/scrape=false`) with deterministic exact prior annotation-state revert metadata.
- `ErrorRateSpike` and `MetricsPipelineDrop` trigger paths are fail-closed with live prerequisite checks:
  - `ErrorRateSpike` requires a safe/valid `PORT` and fixed Service targetPort mapping before mutation.
  - `MetricsPipelineDrop` requires annotation-based scrape signal (`prometheus.io/scrape=true` on pod template or service) before mutation.
- `ImagePullFailSimulation` and `BadReadinessProbe` have been validated end-to-end in `monitoring` (including UI trigger path), with deterministic auto-revert and audit visibility.
- `BadLivenessProbe` follows the same deterministic typed-confirmed trigger and stored-original-probe auto-revert model with no RBAC expansion (deployments patch only).
- Catalog dedup is in effect: the visible/selectable scenario list is canonicalized to:
  - `ScaleToZero`, `ImagePullFailSimulation`, `BadReadinessProbe`, `BadLivenessProbe`, `ProbeTimeoutSpike`, `LatencyInjection`, `ErrorRateSpike`, `DatabaseUnavailable`, `KafkaUnavailable`, `MetricsPipelineDrop`.
- Legacy IDs (for example `CrashLoopSimulation`, `CPUStress`, `RetryStorm`, `LogPipelineDrop`) are no longer accepted.
- Migration note for UI/API clients: use canonical IDs only.
- Frontend validation complete: Control Panel Chaos page now shows the canonical 10-scenario catalog when routed through the standard local control-plane tunnel (`http://localhost:18080`).
- Frontend runtime validation complete in `monitoring`: all canonical scenarios were triggered successfully from Control Panel UI, with expected active-state behavior and deterministic revert paths.
- Operational note: if UI and direct backend responses diverge, verify the `18080` tunnel target first before changing frontend code.
- RBAC prerequisite for dynamic checks: control-plane service account needs `get/list/watch` on core `services` in namespace `prod`.

## Phase 1 Validation Commands (ProbeTimeoutSpike + LatencyInjection)

Assumptions:
- `CONTROL_PLANE_BASE` points to the standard local route (`http://localhost:18080`).
- `ADMIN_JWT` is a valid admin token.

1. Verify catalog contains canonical IDs and both scenarios are enabled:
- `curl "$CONTROL_PLANE_BASE/api/control-plane/demo/scenarios" -H "Authorization: Bearer $ADMIN_JWT"`
- Expected output: JSON includes `ProbeTimeoutSpike` and `LatencyInjection` in `scenarios[]` with `"enabled": true`.

2. Trigger `ProbeTimeoutSpike`:
- `curl -X POST "$CONTROL_PLANE_BASE/api/control-plane/demo/scenarios/trigger" -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_JWT" -d "{\"scenarioId\":\"ProbeTimeoutSpike\",\"service\":\"payment-service\",\"typedServiceConfirmation\":\"payment-service\",\"typedScenarioConfirmation\":\"ProbeTimeoutSpike\",\"durationSeconds\":180,\"reason\":\"phase1-probe-timeout-validation\"}"`
- Expected output: HTTP `200`, response contains `"scenario":{"id":"ProbeTimeoutSpike"}` and `"mutation":{"type":"patch_readiness_probe",...}`.

3. Trigger `LatencyInjection`:
- `curl -X POST "$CONTROL_PLANE_BASE/api/control-plane/demo/scenarios/trigger" -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_JWT" -d "{\"scenarioId\":\"LatencyInjection\",\"service\":\"order-service\",\"typedServiceConfirmation\":\"order-service\",\"typedScenarioConfirmation\":\"LatencyInjection\",\"durationSeconds\":180,\"reason\":\"phase1-latency-validation\"}"`
- Expected output: HTTP `200`, response contains `"scenario":{"id":"LatencyInjection"}` and `"mutation":{"type":"patch_container_lifecycle",...}`.

4. Verify active execution + deterministic revert metadata:
- `curl "$CONTROL_PLANE_BASE/api/control-plane/demo/scenarios" -H "Authorization: Bearer $ADMIN_JWT"`
- Expected output:
  - `activeExecutions[]` includes active records for triggered scenarios.
  - `metadata` includes stored originals (`originalReadinessProbe` for `ProbeTimeoutSpike`, `originalLifecycle` for `LatencyInjection`).

5. Wait for expiry and verify auto-revert:
- `curl "$CONTROL_PLANE_BASE/api/control-plane/demo/scenarios" -H "Authorization: Bearer $ADMIN_JWT"`
- Expected output (after duration + scheduler interval): executions move from `status: "active"` to `status: "reverted"` with `revertMode: "auto"` and `result: "success"`.

## Phase 1 Validation Commands (Infra-Level ErrorRateSpike/DatabaseUnavailable/KafkaUnavailable/MetricsPipelineDrop)

Assumptions:
- `CONTROL_PLANE_BASE` points to `http://localhost:18080`.
- `ADMIN_JWT` is a valid admin token.

1. Trigger `ErrorRateSpike`:
- `curl -X POST "$CONTROL_PLANE_BASE/api/control-plane/demo/scenarios/trigger" -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_JWT" -d "{\"scenarioId\":\"ErrorRateSpike\",\"service\":\"payment-service\",\"typedServiceConfirmation\":\"payment-service\",\"typedScenarioConfirmation\":\"ErrorRateSpike\",\"durationSeconds\":180,\"reason\":\"phase1-error-rate-infra-validation\"}"`
- Expected output: HTTP `201`; payload includes `"scenario":{"id":"ErrorRateSpike"}` and `"mutation":{"type":"patch_container_env_var","envName":"PORT",...}`.

2. Trigger `DatabaseUnavailable`:
- `curl -X POST "$CONTROL_PLANE_BASE/api/control-plane/demo/scenarios/trigger" -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_JWT" -d "{\"scenarioId\":\"DatabaseUnavailable\",\"service\":\"payment-service\",\"typedServiceConfirmation\":\"payment-service\",\"typedScenarioConfirmation\":\"DatabaseUnavailable\",\"durationSeconds\":180,\"reason\":\"phase1-db-unavailable-infra-validation\"}"`
- Expected output: HTTP `201`; payload includes `"scenario":{"id":"DatabaseUnavailable"}` and `"mutation":{"type":"patch_container_env_var","envName":"DB_HOST",...}`.

3. Trigger `KafkaUnavailable`:
- `curl -X POST "$CONTROL_PLANE_BASE/api/control-plane/demo/scenarios/trigger" -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_JWT" -d "{\"scenarioId\":\"KafkaUnavailable\",\"service\":\"order-service\",\"typedServiceConfirmation\":\"order-service\",\"typedScenarioConfirmation\":\"KafkaUnavailable\",\"durationSeconds\":180,\"reason\":\"phase1-kafka-unavailable-infra-validation\"}"`
- Expected output: HTTP `201`; payload includes `"scenario":{"id":"KafkaUnavailable"}` and `"mutation":{"type":"patch_container_env_var","envName":"KAFKA_BROKER",...}`.

4. Trigger `MetricsPipelineDrop`:
- `curl -X POST "$CONTROL_PLANE_BASE/api/control-plane/demo/scenarios/trigger" -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_JWT" -d "{\"scenarioId\":\"MetricsPipelineDrop\",\"service\":\"payment-service\",\"typedServiceConfirmation\":\"payment-service\",\"typedScenarioConfirmation\":\"MetricsPipelineDrop\",\"durationSeconds\":180,\"reason\":\"phase1-metrics-drop-infra-validation\"}"`
- Expected output: HTTP `201`; payload includes `"scenario":{"id":"MetricsPipelineDrop"}` and `"mutation":{"type":"patch_pod_template_annotation","annotationName":"prometheus.io/scrape",...}`.

5. Verify deterministic revert metadata:
- `curl "$CONTROL_PLANE_BASE/api/control-plane/demo/scenarios" -H "Authorization: Bearer $ADMIN_JWT"`
- Expected output:
  - env scenarios: `metadata.originalEnvEntry` captured, possibly `null` if absent.
  - metrics scenario: `metadata.hadOriginalAnnotation` and `metadata.originalAnnotationValue` captured.

6. Verify auto-revert outcome:
- `curl "$CONTROL_PLANE_BASE/api/control-plane/demo/scenarios" -H "Authorization: Bearer $ADMIN_JWT"`
- Expected output after expiry + auto-revert poll: each execution shows `status: "reverted"`, `revertMode: "auto"`, `result: "success"` and revert metadata (`revertedToEnvEntry` or `revertedToAnnotationValue`).

## Local Dev Routing Model (CloudPulse UI)

- Frontend local: `http://localhost:3001`
- Shop APIs: direct to local Docker services (`3000`, `3003`, `4000`, `3005`, `5003`)
- `/api/control-plane/*`: proxy to prod/EKS through local ingress tunnel `http://localhost:18080`
- `/api/control-plane/ai/*`: proxy to local `control-plane-service` `http://localhost:7100`
- Production build invariant: keep API bases relative (`""`), no embedded localhost URLs.

## Important Runbooks and Files

- `docs/jenkins-promotion-runbook.md`
- `docs/rollback-runbook.md`
- `docs/control-plane-ai-lmstudio.md`
- `docs/cloudpulse-ui-runbook.md`
- `docs/vector-retrieval-runbook.md` (planned for Phase 4 implementation tracking)
- `prometheus-values.yaml`
- `k8s/monitoring/grafana-values.yaml`

## Next Workstream

- Phase 2 (Incident Timeline + Deterministic Log Analyzer) is now implemented in `control-plane-service`:
  - Postgres persistence added for `incident_summaries` (no vector DB/Redis in Phase 2).
  - New endpoint added: `GET /api/control-plane/incidents/:service` (admin-only, prod-only, allowlist-only).
  - Deterministic analyzer correlates:
    - chaos execution records
    - control-plane audit actions
    - Kubernetes events/logs
    - Prometheus alerts
    - healer history
  - Response shape includes `service`, `generatedAt`, `timeline`, `probableCauseCandidates`, `confidence`, `recovery`.
  - No-data behavior: HTTP `200` with empty `timeline`/`probableCauseCandidates` and `recovery.state = "no_incidents"`.
- Next queued phases from chaos plan:
  - Phase 4: Similar incident retrieval (vector-ready layer)
  - Phase 5: MCP-aligned provider hardening
  
Phase 3 (RAG advice with citations) is complete for current scope:
- `POST /api/control-plane/ops/advice` implemented.
- Citation-grounded advisory output implemented.
- Admin-only and read-only guardrails enforced.

Phase 4 is now in progress with locked architecture decisions:
- dual-store: Postgres metadata + Qdrant vector index
- Qdrant deployment target: AWS EC2
- embedding strategy: local model first, OpenAI/OpenRouter fallback
- immediate next action: provision EC2 and bring up Qdrant before backend vector endpoint wiring

## Phase 3 Complete (Ops Advice with Citations)

Implemented backend surface:
- `POST /api/control-plane/ops/advice`

Request body:
- `service` (required, allowlisted)
- `question` (required, max 800 chars)

Response shape:
- `service`, `namespace`, `question`
- `confidence` (`low` | `medium` | `high`)
- `advice` (string array)
- `citations` (`path`, `section`, `excerpt`)
- `incidentContext` (recovery + probable causes + latest summary)
- `warnings`, `generatedAt`, `readOnly`

Safety:
- Admin-only and read-only (no mutation)
- Prod scope only via control-plane namespace and allowlist checks
- No secret access

## Phase 2 Validation Commands (Incident Timeline + Deterministic Analyzer)

Assumptions:
- `CONTROL_PLANE_BASE` points to `http://localhost:18080`.
- `ADMIN_JWT` is a valid admin token.
- `NON_ADMIN_JWT` is a valid non-admin token.

1. Run backend tests:
- `cd services/control-plane-service && npm test`
- Expected output: Jest passes including `incidentAnalyzerService.test.js` and controller incident endpoint tests.

2. Fetch incident timeline for allowlisted service:
- `curl "$CONTROL_PLANE_BASE/api/control-plane/incidents/payment-service" -H "Authorization: Bearer $ADMIN_JWT"`
- Expected output: HTTP `200` with keys:
  - `service`
  - `generatedAt`
  - `timeline` (array)
  - `probableCauseCandidates` (array)
  - `confidence` (number)
  - `recovery` (object)

3. Verify allowlist enforcement:
- `curl "$CONTROL_PLANE_BASE/api/control-plane/incidents/unknown-service" -H "Authorization: Bearer $ADMIN_JWT"`
- Expected output: HTTP `400` with allowlist validation error.

4. Verify admin guard:
- `curl "$CONTROL_PLANE_BASE/api/control-plane/incidents/payment-service" -H "Authorization: Bearer $NON_ADMIN_JWT"`
- Expected output: JWT/admin guard rejection (`401` or `403`, depending on middleware path).

## Phase 3 Validation Commands (Ops Advice)

Assumptions:
- `CONTROL_PLANE_BASE` points to `http://localhost:18080`.
- `ADMIN_JWT` is a valid admin token.

1. Request advice for allowlisted service:
- `curl -X POST "$CONTROL_PLANE_BASE/api/control-plane/ops/advice" -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_JWT" -d "{\"service\":\"payment-service\",\"question\":\"What should I check next for KafkaUnavailable recovery stability?\"}"`
- Expected output: HTTP `200` with `advice[]` and `citations[]` plus `confidence`.

2. Verify allowlist enforcement:
- `curl -X POST "$CONTROL_PLANE_BASE/api/control-plane/ops/advice" -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_JWT" -d "{\"service\":\"unknown-service\",\"question\":\"help\"}"`
- Expected output: HTTP `400` with allowlist validation error.
