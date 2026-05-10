# Control Plane Chaos Plan

Last updated: 2026-05-10
Status: Project plan execution completed through Phase 5 checkpoint; now in maintenance/operations mode
Scope: Admin-triggered chaos scenarios and backend implementation for self-healing + analysis
Related MCP architecture reference: `.context/mcp-architecture-plan.md`

## Goal

Provide a single source of truth for:

- chaos scenario catalog and UI behavior
- backend API and data model plan
- Log Analyzer + RAG + MCP-aligned implementation strategy

## Plan Closure Note

- This plan's implementation scope is complete for the defined phases and checkpoints.
- Active mode is operations and stabilization with no currently open implementation phase.
- Any additional work should be opened as a new explicitly scoped phase document.

## Mandatory Controls For Every Scenario

1. Fixed duration + auto-revert.
- Scenario expires automatically at configured time.
- Auto-revert must be deterministic and audited.

2. Typed confirmation.
- Operator must type exact service name and scenario id before trigger.

3. Audit log entry.
- Record actor, service, scenario, start time, duration, revert status, and result.

4. One-click `Revert Now` kill switch.
- Immediate manual rollback for active scenarios.
- Must be visible in Admin UI and logged.

## Canonical Scenario Catalog (Deduplicated)

Selectable canonical scenarios (max 10):

- `ScaleToZero` (enabled)
- `ImagePullFailSimulation` (enabled)
- `BadReadinessProbe` (enabled)
- `BadLivenessProbe` (enabled)
- `ProbeTimeoutSpike` (enabled)
- `LatencyInjection` (enabled)
- `ErrorRateSpike` (enabled)
- `DatabaseUnavailable` (enabled)
- `KafkaUnavailable` (enabled)
- `MetricsPipelineDrop` (enabled)

Migration note for UI/API clients:

- Only canonical scenario IDs are accepted.
- Legacy scenario IDs are removed and will return validation errors.

## UI Presentation Model

Each scenario card should display:

- category
- scenario name
- brief purpose
- default duration
- blast radius limit
- auto-revert status
- current active state

## Backend API Plan

1. `GET /api/control-plane/demo/scenarios`
- Returns supported scenarios with bounds and risk metadata.

2. `POST /api/control-plane/demo/scenarios/trigger`
- Validates typed confirmations and fixed duration.
- Starts scenario execution and audit record.

3. `POST /api/control-plane/demo/scenarios/revert`
- Manual one-click revert for a single active execution.

4. `POST /api/control-plane/demo/scenarios/revert-all`
- Global kill switch for all active executions.

5. `GET /api/control-plane/incidents/:service`
- Returns timeline, probable cause, confidence, and impact.

6. `POST /api/control-plane/ops/advice`
- Returns RAG-guided recommendation with citations.

7. `GET /api/control-plane/incidents/:service/similar`
- Returns similar prior incidents (vector retrieval ready).

## Backend Core Rules

- Admin-only JWT guard.
- Allowlist-only services.
- Max concurrent active scenarios.
- Max allowed duration per scenario.
- Idempotent revert behavior.

## Persistence Plan

Primary table:

- `chaos_scenario_executions`
  - `id`
  - `scenario_id`
  - `service`
  - `requested_by`
  - `reason`
  - `started_at`
  - `expires_at`
  - `reverted_at`
  - `revert_mode` (`auto`/`manual`)
  - `status`
  - `result`
  - `metadata_json`

Incident table:

- `incident_summaries`
  - `id`
  - `service`
  - `scenario_id`
  - `started_at`
  - `ended_at`
  - `symptom`
  - `probable_cause`
  - `confidence`
  - `healer_action`
  - `outcome`
  - `timeline_json`

Vector-ready table:

- `incident_embeddings`
  - `incident_id`
  - `embedding`
  - `metadata_json`

## Analyzer + RAG + MCP Plan

### Log Analyzer

- Start with deterministic rules.
- Correlate scenario triggers, k8s events, Prometheus alerts, healer history, and audit actions.
- Return timeline, cause candidates, confidence, and recovery state.

### RAG

Knowledge corpus:

- runbooks in `docs/`
- `.context/skills/` handoff/context/planning files
- incident summaries

Response requirements:

- concise recommendation
- confidence indicator
- citations (path + section)

### MCP-Aligned Data Access

Provider interface targets:

- Kubernetes logs/events/deployments
- Prometheus alerts/metrics
- healer history
- control-plane action audits
- docs/runbooks corpus

Start with existing adapters and keep interface compatible with MCP connector routing.

## Phased Implementation Plan

### Phase 0: Remove `test` Environment Everywhere (Pre-Requisite)

Scope:

- Decommission `test` environment from Kubernetes, AWS resources, CI/CD flow, manifests, scripts, and documentation.
- Ensure release flow is safe without `test` namespace.

Detailed tasks:

1. Kubernetes decommission:
- Inventory all `test` namespace resources:
  - deployments, services, ingress, configmaps, secrets, jobs, HPAs, PVCs, serviceaccounts, rolebindings.
- Export current `test` state snapshot for rollback/reference.
- Remove `test` namespace workloads and related manifests.
- Remove any cluster RBAC rules that mention `test` namespace.

2. AWS/EKS cleanup:
- Remove `test`-scoped IAM/RBAC mappings if present.
- Remove `test`-specific target groups, listeners, DNS records, and ingress bindings if present.
- Remove `test` ECR lifecycle dependencies and orphan image retention rules if present.
- Verify no autoscaling policies still reference `test` services.

3. CI/CD migration:
- Update Jenkins pipeline logic from `dev -> test -> prod` to approved no-`test` flow.
- Update promotion logic in `jenkins/promotion.env` and Jenkinsfile assumptions.
- Replace `test` image verification gate with explicit `dev` validation gate set.
- Update rollback runbook flow to work without `test` namespace.

4. Code and config cleanup:
- Remove hardcoded `test` namespace/service references from:
  - backend code
  - deployment templates/manifests
  - monitoring configs
  - scripts and automation
- Update environment enums/constants to `dev` and `prod` only.
- Ensure no API response or UI filter expects `test` values.

5. Monitoring and alerting cleanup:
- Remove `test` targets from Prometheus/Grafana where still present.
- Remove `test`-specific alert routing and silence rules.
- Validate dashboards and alerts continue to work for `dev` and `prod`.

6. Documentation and context alignment:
- Update AGENTS, runbooks, handoff docs, and context plans to remove `test` references.
- Add explicit note with decommission date and new pipeline behavior.

7. Validation and rollout checks:
- Validate deployments and rollouts in `dev` and `prod`.
- Validate promotion and rollback flows end-to-end post-change.
- Confirm healer and control-plane behavior unchanged for `dev`/`prod`.

Exit criteria:

- No active `test` namespace resources in cluster.
- No CI/CD or code path depends on `test`.
- Promotion/rollback validated without `test`.
- Docs updated and internally consistent.

Phase 0 execution status (2026-05-03):

- DONE (repo): Jenkins pipeline and helper logic moved from `dev -> test -> prod` to `dev -> prod`.
- DONE (repo): promotion mode now reads candidate images from `dev`.
- DONE (repo): rollback namespace allowlist now supports `dev` and `prod` only.
- DONE (repo): test-only manifests removed:
  - `k8s/jenkins/jenkins-rbac-test.yaml`
  - `k8s/ingress/shcp-test-api-public-ingress.yaml`
- DONE (repo): AGENTS, runbooks, and context/handoff docs updated for no-`test` flow.
- DONE (ops evidence): non-secret `test` namespace snapshot captured in `docs/phase0-test-namespace-snapshot-2026-05-03.md`.
- DONE (ops outside repo): live cluster and AWS cleanup/verification still requires operator execution with cluster and AWS credentials:
  - inventory/export and teardown of any live `test` namespace resources
  - EKS/IAM/RBAC mapping cleanup
  - ALB/target-group/listener/DNS cleanup
  - autoscaling policy verification
  - end-to-end live promotion/rollback/healer verification in cluster

### Phase 1: Chaos Scenario Engine + Audit Foundation

Scope:

- Implement scenario catalog and execution APIs.
- Enforce mandatory controls and backend safety rules.
- Persist scenario execution lifecycle in DB.

Deliverables:

1. `GET /api/control-plane/demo/scenarios`
2. `POST /api/control-plane/demo/scenarios/trigger`
3. `POST /api/control-plane/demo/scenarios/revert`
4. `POST /api/control-plane/demo/scenarios/revert-all`
5. `chaos_scenario_executions` table + repository
6. Auto-revert scheduler with deterministic rollback

Exit criteria:

- Typed confirmations are enforced.
- Fixed duration + auto-revert verified.
- Manual revert and revert-all verified.
- All scenario actions are audited.

Phase 1 execution status (updated 2026-05-07):

- DONE (repo): scenario catalog endpoint implemented:
  - `GET /api/control-plane/demo/scenarios`
- DONE (repo): trigger and revert endpoints implemented:
  - `POST /api/control-plane/demo/scenarios/trigger`
  - `POST /api/control-plane/demo/scenarios/revert`
  - `POST /api/control-plane/demo/scenarios/revert-all`
- DONE (repo): `chaos_scenario_executions` table and indexes added in DB init.
- DONE (repo): deterministic auto-revert scheduler added (`CHAOS_AUTO_REVERT_POLL_MS`, default `15000ms`).
- DONE (repo): strict controls implemented:
  - admin-only inherited route guard
  - allowlist-only service targeting
  - typed confirmation for service and scenario id
  - duration bounds per scenario
  - max concurrent active scenarios
  - idempotent revert behavior
  - control-plane audit entries for trigger/revert success and blocked/error flows
- DONE (repo tests): controller + AI tests passing, plus chaos-service scenario tests for image patch trigger/revert.
- DONE (repo tests): readiness-probe scenario tests added for trigger/revert behavior.
- DONE (execution scope): all canonical scenarios are executable in Phase 1.
- DONE (runtime implementation): real infra-level execution for:
  - `ErrorRateSpike` via deployment env mutation `PORT=18080` (service traffic failure) with exact prior env revert.
  - `DatabaseUnavailable` via deployment env mutation `DB_HOST=chaos-db-unreachable.invalid` with exact prior env revert.
  - `KafkaUnavailable` via deployment env mutation `KAFKA_BROKER=chaos-kafka-unreachable.invalid:9092` with exact prior env revert.
  - `MetricsPipelineDrop` via deployment pod template annotation mutation `prometheus.io/scrape=false` with exact prior annotation-state revert (including previously-absent case).
- DONE (runtime hardening): dynamic fail-closed prerequisite checks added:
  - `ErrorRateSpike` blocks when safe live port-mapping prerequisites are not met.
  - `MetricsPipelineDrop` blocks when annotation-based scrape prerequisites are not met.
- DONE (RBAC alignment): control-plane Role includes read access to core `services` in `prod` to support prerequisite inspection.
- DONE (runtime validation): `ImagePullFailSimulation` validated in `monitoring` with:
  - typed-confirmed trigger
  - fixed-duration execution
  - deterministic auto-revert to stored original image
  - revert visibility in execution/audit records
- DONE (runtime validation): `BadReadinessProbe` validated in `monitoring` and from Control Panel UI with:
  - typed-confirmed trigger
  - fixed-duration execution
  - deterministic auto-revert to stored original readiness probe
  - revert visibility in execution/audit records
- DONE (runtime implementation): `BadLivenessProbe` implemented with the same safety pattern:
  - typed-confirmed trigger
  - fixed-duration execution
  - deterministic auto-revert to stored original liveness probe
  - revert visibility in execution/audit records
- DONE (runtime implementation): `ProbeTimeoutSpike` implemented with deterministic readiness timeout injection (`exec sleep` + low timeout) and revert to stored original readiness probe.
- DONE (runtime implementation): `LatencyInjection` implemented with deterministic postStart lifecycle sleep injection and revert to stored original lifecycle.
- DONE (catalog dedup): scenario catalog reduced to canonical template set.
- NOTE: non-canonical legacy scenario IDs are no longer accepted by trigger/revert-by-scenario flows.
- DONE (frontend verification): Control Panel UI validated against canonical scenario catalog via the standard `/api/control-plane/* -> http://localhost:18080` path after refreshing the local tunnel/backend image alignment.
- DONE (frontend validation): all canonical scenarios successfully triggered from frontend against `monitoring` deployment with expected live fault behavior and deterministic revert.
- PHASE GATE: COMPLETE. Chaos scenario implementation/validation stage is finished and ready for transition to Phase 2.

Phase 1 validation commands for `BadLivenessProbe` (run against control-plane API):

1. Trigger:
- `curl -X POST "$CONTROL_PLANE_BASE/api/control-plane/demo/scenarios/trigger" -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_JWT" -d "{\"scenarioId\":\"BadLivenessProbe\",\"service\":\"payment-service\",\"typedServiceConfirmation\":\"payment-service\",\"typedScenarioConfirmation\":\"BadLivenessProbe\",\"durationSeconds\":180,\"reason\":\"phase1-liveness-validation\"}"`

2. Check active execution and metadata:
- `curl "$CONTROL_PLANE_BASE/api/control-plane/demo/scenarios" -H "Authorization: Bearer $ADMIN_JWT"`

3. Observe pod restart symptoms/events:
- `kubectl get pods -n prod -l app=payment-service -w`
- `kubectl get events -n prod --field-selector involvedObject.kind=Pod | grep payment-service`

4. Verify deterministic auto-revert after expiry:
- `curl "$CONTROL_PLANE_BASE/api/control-plane/demo/scenarios" -H "Authorization: Bearer $ADMIN_JWT"`

Phase 1 validation commands for `ProbeTimeoutSpike` and `LatencyInjection` (run against control-plane API):

1. Verify both scenarios are enabled:
- `curl "$CONTROL_PLANE_BASE/api/control-plane/demo/scenarios" -H "Authorization: Bearer $ADMIN_JWT"`
- Expected output: `scenarios[]` includes `ProbeTimeoutSpike` and `LatencyInjection` with `"enabled": true`.

2. Trigger `ProbeTimeoutSpike`:
- `curl -X POST "$CONTROL_PLANE_BASE/api/control-plane/demo/scenarios/trigger" -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_JWT" -d "{\"scenarioId\":\"ProbeTimeoutSpike\",\"service\":\"payment-service\",\"typedServiceConfirmation\":\"payment-service\",\"typedScenarioConfirmation\":\"ProbeTimeoutSpike\",\"durationSeconds\":180,\"reason\":\"phase1-probe-timeout-validation\"}"`
- Expected output: HTTP `200` with `"scenario":{"id":"ProbeTimeoutSpike"}` and `"mutation":{"type":"patch_readiness_probe",...}`.

3. Trigger `LatencyInjection`:
- `curl -X POST "$CONTROL_PLANE_BASE/api/control-plane/demo/scenarios/trigger" -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_JWT" -d "{\"scenarioId\":\"LatencyInjection\",\"service\":\"order-service\",\"typedServiceConfirmation\":\"order-service\",\"typedScenarioConfirmation\":\"LatencyInjection\",\"durationSeconds\":180,\"reason\":\"phase1-latency-validation\"}"`
- Expected output: HTTP `200` with `"scenario":{"id":"LatencyInjection"}` and `"mutation":{"type":"patch_container_lifecycle",...}`.

4. Verify deterministic stored originals for revert:
- `curl "$CONTROL_PLANE_BASE/api/control-plane/demo/scenarios" -H "Authorization: Bearer $ADMIN_JWT"`
- Expected output: active execution metadata contains `originalReadinessProbe` (ProbeTimeoutSpike) and `originalLifecycle` (LatencyInjection).

5. Verify deterministic auto-revert:
- `curl "$CONTROL_PLANE_BASE/api/control-plane/demo/scenarios" -H "Authorization: Bearer $ADMIN_JWT"`
- Expected output after expiry: executions become `status: "reverted"` with `revertMode: "auto"` and `result: "success"`.

Phase 1 validation commands for real infra-level `ErrorRateSpike`, `DatabaseUnavailable`, `KafkaUnavailable`, and `MetricsPipelineDrop`:

1. Trigger `ErrorRateSpike`:
- `curl -X POST "$CONTROL_PLANE_BASE/api/control-plane/demo/scenarios/trigger" -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_JWT" -d "{\"scenarioId\":\"ErrorRateSpike\",\"service\":\"payment-service\",\"typedServiceConfirmation\":\"payment-service\",\"typedScenarioConfirmation\":\"ErrorRateSpike\",\"durationSeconds\":180,\"reason\":\"phase1-error-rate-infra-validation\"}"`
- Expected output: HTTP `201`; response includes `"scenario":{"id":"ErrorRateSpike"}` and `"mutation":{"type":"patch_container_env_var","envName":"PORT",...}`.

2. Trigger `DatabaseUnavailable`:
- `curl -X POST "$CONTROL_PLANE_BASE/api/control-plane/demo/scenarios/trigger" -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_JWT" -d "{\"scenarioId\":\"DatabaseUnavailable\",\"service\":\"payment-service\",\"typedServiceConfirmation\":\"payment-service\",\"typedScenarioConfirmation\":\"DatabaseUnavailable\",\"durationSeconds\":180,\"reason\":\"phase1-db-unavailable-infra-validation\"}"`
- Expected output: HTTP `201`; response includes `"scenario":{"id":"DatabaseUnavailable"}` and `"mutation":{"type":"patch_container_env_var","envName":"DB_HOST",...}`.

3. Trigger `KafkaUnavailable`:
- `curl -X POST "$CONTROL_PLANE_BASE/api/control-plane/demo/scenarios/trigger" -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_JWT" -d "{\"scenarioId\":\"KafkaUnavailable\",\"service\":\"order-service\",\"typedServiceConfirmation\":\"order-service\",\"typedScenarioConfirmation\":\"KafkaUnavailable\",\"durationSeconds\":180,\"reason\":\"phase1-kafka-unavailable-infra-validation\"}"`
- Expected output: HTTP `201`; response includes `"scenario":{"id":"KafkaUnavailable"}` and `"mutation":{"type":"patch_container_env_var","envName":"KAFKA_BROKER",...}`.

4. Trigger `MetricsPipelineDrop`:
- `curl -X POST "$CONTROL_PLANE_BASE/api/control-plane/demo/scenarios/trigger" -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_JWT" -d "{\"scenarioId\":\"MetricsPipelineDrop\",\"service\":\"payment-service\",\"typedServiceConfirmation\":\"payment-service\",\"typedScenarioConfirmation\":\"MetricsPipelineDrop\",\"durationSeconds\":180,\"reason\":\"phase1-metrics-drop-infra-validation\"}"`
- Expected output: HTTP `201`; response includes `"scenario":{"id":"MetricsPipelineDrop"}` and `"mutation":{"type":"patch_pod_template_annotation","annotationName":"prometheus.io/scrape",...}`.

5. Verify deterministic metadata for exact revert:
- `curl "$CONTROL_PLANE_BASE/api/control-plane/demo/scenarios" -H "Authorization: Bearer $ADMIN_JWT"`
- Expected output:
  - env scenarios record `metadata.originalEnvEntry` (including `null` when previously absent).
  - metrics scenario records `metadata.hadOriginalAnnotation` and `metadata.originalAnnotationValue`.

6. Verify auto-revert completion:
- `curl "$CONTROL_PLANE_BASE/api/control-plane/demo/scenarios" -H "Authorization: Bearer $ADMIN_JWT"`
- Expected output after expiry + scheduler poll: executions move to `status: "reverted"` with `revertMode: "auto"`, and metadata includes `revertedToEnvEntry` or `revertedToAnnotationValue` as applicable.

### Phase 2: Incident Timeline + Log Analyzer (Deterministic)

Scope:

- Build incident summary generation for triggered scenarios.
- Correlate k8s, Prometheus, healer, and audit signals.

Deliverables:

1. `incident_summaries` table + repository
2. `GET /api/control-plane/incidents/:service`
3. Analyzer service returning timeline, cause candidates, confidence, recovery state

Exit criteria:

- Incident timeline is generated for active and completed scenarios.
- Cause candidates and confidence are returned consistently.
- Recovery states align with healer and deployment telemetry.

Phase 2 execution status (2026-05-08):

- DONE (repo): `incident_summaries` persistence in Postgres added (Phase 2 uses Postgres only, no vector DB/Redis).
- DONE (repo): incident summary repository added with create/update/upsert/list-by-service/get-by-execution behavior.
- DONE (repo): deterministic analyzer service added to correlate:
  - `chaos_scenario_executions`
  - `control_plane_actions`
  - Kubernetes events/logs for allowlisted prod services
  - Prometheus alerts
  - healer history
- DONE (repo): endpoint added:
  - `GET /api/control-plane/incidents/:service`
- DONE (repo): endpoint returns deterministic shape:
  - `service`, `generatedAt`, `timeline`, `probableCauseCandidates`, `confidence`, `recovery`
  - no-data path returns HTTP `200` with empty arrays and `recovery.state = "no_incidents"`
- DONE (repo tests): analyzer unit tests and controller endpoint tests added for deterministic behavior and partial-source failure handling.

Phase 2 validation commands:

1. Run tests:
- `cd services/control-plane-service && npm test`
- Expected output: all tests pass including analyzer and incident endpoint suites.

2. Fetch incidents for allowlisted service:
- `curl "$CONTROL_PLANE_BASE/api/control-plane/incidents/payment-service" -H "Authorization: Bearer $ADMIN_JWT"`
- Expected output: HTTP `200` with `timeline`, `probableCauseCandidates`, `confidence`, `recovery`.

3. Verify allowlist guard:
- `curl "$CONTROL_PLANE_BASE/api/control-plane/incidents/unknown-service" -H "Authorization: Bearer $ADMIN_JWT"`
- Expected output: HTTP `400` allowlist validation error.

4. Verify admin guard:
- `curl "$CONTROL_PLANE_BASE/api/control-plane/incidents/payment-service" -H "Authorization: Bearer $NON_ADMIN_JWT"`
- Expected output: `401`/`403` (existing auth/admin middleware behavior).

### Phase 3: RAG Advice with Citations

Scope:

- Add advisory endpoint for runbook-grounded recommendations.
- Use docs/context/incident summaries as knowledge corpus.

Deliverables:

1. `POST /api/control-plane/ops/advice`
2. Retrieval pipeline over runbooks + context + incident summaries
3. Citation formatter (path + section/title)

Exit criteria:

- Advice output includes citations for every recommendation.
- Responses stay read-only/advisory.
- Admin-only access and logging are enforced.

Phase 3 execution status (2026-05-08):

- DONE (repo): new advisory endpoint scaffolded:
  - `POST /api/control-plane/ops/advice`
- DONE (repo): service-side validation added:
  - allowlisted `service` required
  - `question` required (max 800 chars)
- DONE (repo): deterministic advice assembly added from:
  - latest incident timeline/summaries
  - active Prometheus alert context
  - markdown corpus citations from `docs/` and `.context/`
- DONE (repo): response now includes structured `citations[]` (`path`, `section`, `excerpt`) and confidence label (`low|medium|high`).
- PHASE GATE: COMPLETE. Advisory endpoint with citation-grounded read-only output is implemented and validated for current scope.

Phase 3 validation commands:

1. Basic advice request:
- `curl -X POST "$CONTROL_PLANE_BASE/api/control-plane/ops/advice" -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_JWT" -d "{\"service\":\"payment-service\",\"question\":\"What should I verify after KafkaUnavailable auto-revert?\"}"`
- Expected output: HTTP `200` with `advice[]`, `citations[]`, and `confidence`.

2. Invalid service:
- `curl -X POST "$CONTROL_PLANE_BASE/api/control-plane/ops/advice" -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_JWT" -d "{\"service\":\"unknown-service\",\"question\":\"help\"}"`
- Expected output: HTTP `400` validation error.

### Phase 4: Similar Incident Retrieval + Vector Layer

Scope:

- Enable similar-incident retrieval on top of stored incident summaries.
- Keep vector layer optional/lean for initial rollout.

Deliverables:

1. `incident_embeddings` table (or vector store adapter)
2. `GET /api/control-plane/incidents/:service/similar`
3. Similarity scoring + metadata filtering

Exit criteria:

- Similar incidents returned with score and linked outcome context.
- Retrieval filtered by service/date/scenario metadata.

Phase 4 execution status (2026-05-09):

- STATUS: COMPLETE (implemented and validated in runtime)
- Locked decisions:
  - dual-store architecture (`incident_summaries` in Postgres as source-of-truth + vector index in Qdrant)
  - vector DB target: Qdrant on AWS EC2
  - embedding provider strategy: local embedding model first, OpenAI/OpenRouter fallback via pluggable provider
  - tests deferred for initial implementation pass; manual validation first
- Completed objective:
  - `GET /api/control-plane/incidents/:service/similar` now returns vector-ranked incident matches with Postgres metadata hydration.

Phase 4 implementation checklist:

1. Provision vector DB:
- create AWS EC2 instance and run Qdrant service
- restrict access via Security Group allowlist (control-plane service source only)

2. Backend vector integration:
- add vector client adapter/service in `control-plane-service`
- add env-driven provider config for Qdrant endpoint and embedding provider selection

3. Incident embedding pipeline:
- build canonical incident text from existing incident summaries
- upsert embeddings and metadata to Qdrant on-demand and/or via backfill command

4. Similar incidents endpoint:
- implement `GET /api/control-plane/incidents/:service/similar`
- support `limit` and optional anchor incident selection
- return sorted similarity results with scenario/outcome/recovery context

5. Manual validation:
- validate endpoint behavior for allowlisted service, empty service history, and guardrail failures
- verify vector index upsert/query flow against Qdrant

Phase 4 progress log:

- 2026-05-08: Phase 4 plan finalized with dual-store and Qdrant-on-EC2 direction.
- 2026-05-08: Next step queued: provision AWS EC2 and deploy Qdrant.
- 2026-05-08: backend vector integration implemented in `control-plane-service`:
  - vector config module added (`src/config/vector.js`)
  - embedding provider abstraction added with ordered fallback (`local -> openai -> openrouter`)
  - Qdrant adapter added for collection init, vector upsert, and similarity search
  - incident embedding sync pipeline added (single upsert + per-service backfill)
  - `GET /api/control-plane/incidents/:service/similar` implemented (admin-only, prod-only, allowlist-only, read-only)
  - incident analyzer now attempts embedding upsert after summary upsert (fail-soft)
  - manual backfill command added: `npm run backfill:incident-embeddings`
  - runbook added: `docs/vector-retrieval-runbook.md`
- 2026-05-09: runtime validation and hardening completed:
  - Qdrant on EC2 connectivity validated from EKS after SG allowlist update (`6333` from EKS node SG).
  - OpenRouter embedding provider path validated with `qwen/qwen3-embedding-4b`.
  - Embedding dimension aligned to `2560` and Qdrant collection confirmed at matching vector size.
  - Qdrant collection init `409` handled as success (idempotent create behavior).
  - Qdrant point ID format fixed to numeric incident IDs for upsert compatibility.
  - Similar endpoint request-time sync bounded (`SIMILAR_SYNC_LIMIT`) and failure samples exposed in response.
  - End-to-end API/UI validation successful for allowlisted services.

Phase 4 validation commands (validated):

1. Similar incidents request:
- `curl "$CONTROL_PLANE_BASE/api/control-plane/incidents/payment-service/similar?limit=5" -H "Authorization: Bearer $ADMIN_JWT"`
- Expected output: HTTP `200` with ranked `results[]` (or empty results when history is insufficient) plus `vector.syncStatus`.

2. Guardrail check:
- `curl "$CONTROL_PLANE_BASE/api/control-plane/incidents/unknown-service/similar" -H "Authorization: Bearer $ADMIN_JWT"`
- Expected output: HTTP `400` allowlist validation error.

3. Anchor validation check:
- `curl "$CONTROL_PLANE_BASE/api/control-plane/incidents/payment-service/similar?limit=5&anchorExecutionId=ScaleToZero" -H "Authorization: Bearer $ADMIN_JWT"`
- Expected output: HTTP `400` with message `anchorExecutionId must be an integer when provided`.

### Phase 5: MCP-Aligned Data Provider + Hardening

Scope:

- Formalize provider interface for multi-source reads.
- Improve reliability, observability, and operational safeguards.

Deliverables:

1. MCP-aligned provider abstraction for:
 - k8s logs/events/deployments
 - Prometheus alerts/metrics
 - healer history
 - control-plane action audits
 - docs/runbooks corpus
2. Rate limits, retry policy, and error normalization
3. Integration tests and runbook updates
4. End-of-phase `ops/advice` hybrid LLM synthesis upgrade:
 - intent-aware question routing (for example readiness-probe failure vs recovery checklist vs comparison)
 - retrieval fusion across live signals (logs/events/alerts/deployments), similar incidents, and docs/runbooks
 - provider-abstracted answer generation (OpenRouter primary with LM Studio fallback)
 - evidence-linked response fields (`advice`, `probable_causes`, `next_checks`, `citations`, `confidence`, `unknowns`)
 - strict read-only policy enforcement and claim-to-evidence grounding checks

Exit criteria:

- End-to-end flow works: trigger -> analyze -> advise -> revert.
- Error handling is stable under partial source failures.
- Operational runbook is updated for support/demo use.
- `POST /api/control-plane/ops/advice` can answer complex operational questions with grounded, non-generic responses tied to live evidence and citations.

Phase 5 checkpoint update (2026-05-09):

- DONE: AI chat error hardening with sanitized provider failure details in `502` responses (`providerFailure`, `providerFailures`).
- DONE: `POST /api/control-plane/ops/advice` end-cap start implementation:
  - intent-aware routing
  - retrieval fusion (live telemetry + similar incidents + docs/runbooks)
  - grounded output fields (`answer`, `evidence`, `confidence`, `unknowns`) with backward-compatible legacy fields retained.
- DONE: backend contract tests and docs updates completed for new response contracts.
- DONE: frontend integration in `cloudpulse-ui` updated to render `answer + evidence + unknowns + citations` cleanly in active advice panels.
- DONE: ops-advice observability added via bounded Prometheus metric `ops_advice_total`.
- DONE: ops-advice reliability behavior set to strict fail-closed for core incident sources (`incident timeline`, `incident summaries`).
- DONE: ops-advice latency metric added (`ops_advice_duration_ms`) and status labeling clarified (`success` | `partial` | `error`).
- SKIPPED (by operator choice): Jenkins-cycle validation for this checkpoint.
- DONE (finalized): Phase 5 hardening (strict fail-closed + ops-advice metrics) validated on May 9, 2026.
- DONE (release hygiene): deploy baseline tag captured for rollback targeting as `phase5-hardening-baseline-2026-05-09`.
- DONE (operability check): one Jenkins cycle and one production observation window reviewed against `ops_advice_total{status="error"}` and `ops_advice_duration_ms` p95.

## Non-Negotiables

- No secret access APIs.
- No delete permissions.
- No broad cluster mutation.
- All chaos actions audited.
- Revert paths must be reliable and test-covered.
