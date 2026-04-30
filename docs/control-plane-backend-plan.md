---
title: Control Plane Backend Plan
status: in-progress
updated: 2026-04-30
tags:
  - control-plane
  - backend
  - planning
  - self-healing-platform
---

# Control Plane Backend Plan

This is the docs-facing planning and implementation reference for the active backend phase.

Canonical planning handoff:

```text
.context/control-plane-backend-plan.md
```

## Summary

The active implementation area is a new `control-plane-service` for an admin-only Control Panel inside the main prod-facing frontend. Backend implementation comes before frontend live data/action integration; frontend planning and UI-only progress are captured in `.context/control-plane-frontend-plan.md`.

V1 goals:

- Add `role` support to `user-service`. Done locally and verified.
- Hide the Control Panel unless `user.role === "admin"`.
- Create `services/control-plane-service`. Skeleton created and running locally on port `7100`.
- Use live prod data, not mocks.
- Show prod deployments, service health, separate logs, combined logs, Kubernetes events, Prometheus health, healer history, and manual action audit.
- Allow guarded Down/Up demo actions by scaling allowlisted prod app deployments to `0` or `1`.
- Audit all manual actions.

## Current Progress

- `user-service` role support is implemented: role column, default `user`, role in JWT, role in profile response, and profile updates do not change role.
- A first admin was bootstrapped manually in local PostgreSQL with SQL.
- `services/control-plane-service` exists with Express, CommonJS, JWT auth, admin-only middleware, service allowlist, `/health`, `/metrics`, and protected `/api/control-plane/*` route stubs.
- `docker-compose.yml` includes `control-plane-service` on `7100:7100` with frontend CORS origin `http://localhost:3001`.
- Local `product-service` and `order-service` now start HTTP before Kafka connection, so read endpoints remain available while Kafka is warming up.
- Separate frontend repo `cloudpulse-ui` now has UI-only Control Panel scaffolding. Live data wiring and guarded action UI remain deferred until backend APIs are implemented.

## Safety Boundary

The Control Plane must remain prod-focused and narrowly scoped:

- `prod` only in UI and API.
- allowlisted app services only.
- scale replicas must be exactly `0` or `1`.
- typed confirmation must exactly match the service name.
- no secret access.
- no pod deletion.
- no namespace deletion.
- no Kafka, PostgreSQL application-data, or PVC mutation.
- no Jenkins, Grafana, Prometheus, or Alertmanager mutation.
- no broad cluster permissions.

## Implemented Route Surface

Public endpoints:

| Method | Path | Current behavior |
|---|---|---|
| `GET` | `/health` | Returns service health |
| `GET` | `/metrics` | Returns Prometheus metrics |

Protected admin endpoints under `/api/control-plane`:

| Method | Path | Current behavior |
|---|---|---|
| `GET` | `/api/control-plane/status` | Implemented; returns service readiness, prod namespace scope, and allowlisted deployments |
| `GET` | `/api/control-plane/overview` | Route exists; returns `501` until live data implementation |
| `GET` | `/api/control-plane/deployments` | Route exists; returns `501` until Kubernetes deployment read implementation |
| `GET` | `/api/control-plane/services/:service` | Route exists with service allowlist guard; returns `501` until service detail implementation |
| `GET` | `/api/control-plane/healing-history` | Route exists; returns `501` until healer history integration |
| `GET` | `/api/control-plane/alerts` | Route exists; returns `501` until Prometheus integration |
| `GET` | `/api/control-plane/logs` | Route exists; returns `501` until combined log implementation |
| `GET` | `/api/control-plane/logs/:service` | Route exists with service allowlist guard; returns `501` until service log implementation |
| `GET` | `/api/control-plane/events/:service` | Route exists with service allowlist guard; returns `501` until event implementation |
| `POST` | `/api/control-plane/actions/scale` | Route exists; returns `501` until guarded scale and audit implementation |
| `GET` | `/api/control-plane/actions` | Route exists; returns `501` until manual action audit implementation |

All `/api/control-plane/*` routes require a valid JWT and `role === "admin"`.

## Deferred Docs

Create these when route behavior and operational procedures are stable enough to publish:

- `docs/control-plane-runbook.md`
- `docs/control-plane-api.md`

## Next Backend Work

- Add `controlplanedb` and `control_plane_actions` initialization for `control-plane-service`.
- Add Kubernetes client wiring for prod read-only deployment/pod/ReplicaSet/event/log views.
- Add Prometheus and healer-service read integrations.
- Add Kubernetes manifests and prod-only RBAC for `control-plane-service` in `monitoring`.
- Implement guarded scale `0/1` with typed confirmation and audit.
