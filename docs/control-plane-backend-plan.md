---
title: Control Plane Backend Plan
status: planning
updated: 2026-04-29
tags:
  - control-plane
  - backend
  - planning
  - self-healing-platform
---

# Control Plane Backend Plan

This is the docs-facing planning reference for the next backend phase.

Canonical planning handoff:

```text
.context/control-plane-backend-plan.md
```

## Summary

The next implementation area is a new `control-plane-service` for an admin-only Control Panel inside the main prod-facing frontend. Backend implementation comes before frontend implementation; frontend planning is captured in `.context/control-plane-frontend-plan.md`.

V1 goals:

- Add `role` support to `user-service`.
- Hide the Control Panel unless `user.role === "admin"`.
- Create `services/control-plane-service`.
- Use live prod data, not mocks.
- Show prod deployments, service health, separate logs, combined logs, Kubernetes events, Prometheus health, healer history, and manual action audit.
- Allow guarded Down/Up demo actions by scaling allowlisted prod app deployments to `0` or `1`.
- Audit all manual actions.

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

## Planned API

```text
GET  /api/control-plane/overview
GET  /api/control-plane/deployments
GET  /api/control-plane/services/:service
GET  /api/control-plane/healing-history
GET  /api/control-plane/alerts
GET  /api/control-plane/logs/:service
GET  /api/control-plane/logs
GET  /api/control-plane/events/:service
POST /api/control-plane/actions/scale
GET  /api/control-plane/actions
```

## Deferred Docs

Create these when implementation begins:

- `docs/control-plane-runbook.md`
- `docs/control-plane-api.md`
