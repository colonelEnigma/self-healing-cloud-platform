# Backend Context (Canonical)

Last updated: 2026-05-07

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
- Manual revert (single active execution)
- Revert all active executions
- Audit trail visibility for actions
- Max active scenario limit behavior (`CHAOS_MAX_ACTIVE_SCENARIOS`, default 3)

Current execution scope:
- `ScaleToZero` and `ImagePullFailSimulation` are enabled for Phase 1 execution.
- `ImagePullFailSimulation` has been validated end-to-end in `monitoring`, including deterministic auto-revert and audit visibility.
- Other scenarios in the catalog (for example CrashLoop/CPU stress and related entries) remain disabled placeholders for later phases.

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
- `prometheus-values.yaml`
- `k8s/monitoring/grafana-values.yaml`

## Next Workstream

- Continue Phase 2+ from chaos plan:
  - Incident timeline and deterministic log analyzer
  - RAG advice with citations
  - Similar incident retrieval (vector-ready layer)
  - MCP-aligned provider hardening
