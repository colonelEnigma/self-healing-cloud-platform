---
title: Control Plane Frontend Plan
status: in-progress
updated: 2026-04-30
tags:
  - control-plane
  - frontend
  - planning
  - self-healing-platform
---

# Control Plane Frontend Plan

This is the docs-facing planning reference for the frontend direction and current UI-only Control Panel progress.

Canonical planning handoff:

```text
.context/control-plane-frontend-plan.md
```

## Summary

The frontend will be based on the existing Creative Tim Material Dashboard React app at:

```text
C:\Users\ranja\Documents\projects\cloudpulse-ui
```

UI-only Control Panel scaffolding has started in the frontend repo. Live Control Plane data integration and guarded actions still start after the Control Plane backend is implemented and verified. Backend work remains first: `user-service` role support, `control-plane-service`, live prod Control Plane APIs, guarded scale actions, audit history, and narrow RBAC.

## App Direction

The app remains user-centric for normal users:

- Sign In
- Sign Up
- Home / Categories
- Products by Category
- Cart / Checkout
- Orders
- Profile

Admins see the normal user experience plus a hidden-unless-admin top tab named `Control Panel`.

## Control Panel Layout

Control Panel V1 will use five pages:

- `Overview`: prod platform health, degraded services, alert-style state, and recent activity.
- `Services`: allowlisted prod deployments and service detail drill-down.
- `Logs`: separate service logs and combined prod app logs.
- `Incidents`: Prometheus alert-style state, Kubernetes events, diagnostics, and healer history.
- `Audit`: manual Control Panel action history.

## Safety Boundary

- Prod-only Control Panel.
- Live backend data only, no mocks.
- Hidden unless `user.role === "admin"`.
- Backend authorization still required for all `/api/control-plane/*` calls.
- Scale mutation is limited to typed-confirmed replicas `0` or `1`.
- Scale actions apply only to allowlisted prod app deployments.
- No UI controls for secrets, deletes, pod deletion, namespace/PVC/Kafka/PostgreSQL application-data/Jenkins/Grafana/Prometheus/Alertmanager mutation, or broad Kubernetes mutation.

## Implementation Notes

When frontend live/backend integration resumes:

- Preserve the Creative Tim Material Dashboard foundation.
- Use ingress-relative `/api/...` paths for deployed API calls.
- Clean up current auth path inconsistencies.
- Load `/api/users/profile` after login and store `user.role` in auth state.
- Render the `Control Panel` tab only for admins.
- Add `/api/control-plane/*` client helpers after backend routes are available.

## Recent Progress (UI-only)

- 2026-04-30: Control Panel UI scaffolding committed. The frontend now contains `src/layouts/control-panel/*` with placeholder pages and nested routing for Overview, Services (with drill-down), Logs, Incidents, and Audit.
- Frontend auth handling improved: profile normalization from `localStorage` and API responses, and `AuthProvider` now waits for profile load when a token exists to avoid premature redirects.
- Routing updated to `/control-panel/*` and `src/services/authService.js` login helper was adjusted to use the ingress-relative `/api/users/login` path.
- Backend status as of 2026-04-30: `user-service` role support is locally verified, `control-plane-service` exists locally on port `7100`, `GET /api/control-plane/status` is implemented for admin JWTs, and the remaining Control Plane routes currently return `501` until live integrations are added.

## Deferred

- Live backend data integration and guarded action wiring.
- Frontend Kubernetes/Jenkins deployment integration.
- Final screenshots, README demo walkthrough, and UI polish.
