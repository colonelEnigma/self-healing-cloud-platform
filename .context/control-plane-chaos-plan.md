# Control Plane Chaos Plan

Last updated: 2026-05-07
Status: Phase 0 completed; Phase 1 implemented and validated for two executable scenarios
Scope: Admin-triggered chaos scenarios and backend implementation for self-healing + analysis

## Goal

Provide a single source of truth for:

- chaos scenario catalog and UI behavior
- backend API and data model plan
- Log Analyzer + RAG + MCP-aligned implementation strategy

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

## Scenario Categories

### 1) Availability Failures

- `ScaleToZero`: Set selected allowlisted service replicas to `0`.
- `CrashLoopSimulation`: Force repeated restarts.
- `ImagePullFailSimulation`: Use invalid image tag for rollout.
- `StuckRolloutSimulation`: New pods fail to become ready.

### 2) Health Probe Failures

- `BadReadinessProbe`: Misconfigure readiness path/port.
- `BadLivenessProbe`: Misconfigure liveness and induce restarts.
- `ProbeTimeoutSpike`: Simulate slow startup/response probe timeout.

### 3) Performance Degradation

- `CPUStress`: Inject CPU pressure.
- `MemoryStress`: Inject memory pressure.
- `LatencyInjection`: Add fixed endpoint delay.
- `SlowDependency`: Simulate slow upstream dependency.

### 4) Error & Reliability Failures

- `ErrorRateSpike`: Inject controlled 5xx response rate.
- `RetryStorm`: Simulate retry amplification.
- `ThunderingHerdRecovery`: Simulate recovery surge traffic.
- `CircuitBreakerOpenSimulation`: Trigger downstream failures to open breaker.

### 5) Dependency Failures

- `DatabaseUnavailable`: Temporarily break DB connectivity.
- `KafkaUnavailable`: Temporarily break broker connectivity.
- `DNSResolutionFailure`: Simulate intermittent DNS failure.
- `ConnectionPoolExhaustion`: Simulate exhausted client pools.
- `UpstreamRateLimit`: Simulate upstream throttling.

### 6) Deployment & Config Regressions

- `ConfigRegression`: Apply known-bad safe config with auto-revert.
- `SecretConfigDrift`: Simulate inconsistent config across pods.
- `JWTMismatch`: Simulate auth secret mismatch.
- `SchemaOrderMismatch`: Simulate app/dependency compatibility mismatch.

### 7) Messaging & Data Pipeline Issues

- `ConsumerLagSpike`: Simulate Kafka consumer lag.
- `PoisonMessageLoop`: Simulate repeated bad message failures.
- `IdempotencyFailureSimulation`: Simulate duplicate effects under retry.

### 8) Infrastructure & Platform Disruptions

- `PodEvictionSimulation`: Simulate node/pod disruption.
- `PartialZoneImpairment`: Simulate subset pod degradation.
- `EphemeralStoragePressure`: Simulate disk pressure instability.
- `ScopedEgressDeny`: Temporary scoped network deny for one dependency.

### 9) Observability & Control Plane Blind Spots

- `MetricsPipelineDrop`: Simulate missing metrics.
- `LogPipelineDrop`: Simulate missing log ingestion.
- `AlertRouteMisconfig`: Simulate alert routing failure.
- `HealerRateLimitConflict`: Simulate repeated incidents versus healer limits.

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
- DONE (execution scope): `ScaleToZero` and `ImagePullFailSimulation` are both executable in Phase 1.
- DONE (runtime validation): `ImagePullFailSimulation` validated in `monitoring` with:
  - typed-confirmed trigger
  - fixed-duration execution
  - deterministic auto-revert to stored original image
  - revert visibility in execution/audit records
- NOTE: remaining catalog scenarios are intentionally disabled placeholders for later phases.

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

Exit criteria:

- End-to-end flow works: trigger -> analyze -> advise -> revert.
- Error handling is stable under partial source failures.
- Operational runbook is updated for support/demo use.

## Non-Negotiables

- No secret access APIs.
- No delete permissions.
- No broad cluster mutation.
- All chaos actions audited.
- Revert paths must be reliable and test-covered.
