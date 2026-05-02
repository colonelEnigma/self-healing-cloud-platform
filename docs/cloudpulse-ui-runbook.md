---
title: CloudPulse UI Runbook
tags:
  - frontend
  - shadcn
  - tailwind
  - runbook
updated: 2026-05-03
---

# CloudPulse UI Runbook

The frontend UI is maintained in the separate repo `C:\Users\ranja\Documents\projects\cloudpulse-ui` and built with `shadcn/ui` + Tailwind. The canonical phased plan is in `.context/PlanFrontendShadcn.md`.

This runbook reflects the current frontend implementation in `cloudpulse-ui`.

## Scope And Sequencing

- Phase order is mandatory:
  1. Shop pages first: Home + Login + Signup + Catalog/Product list.
  2. Admin Control Panel UI only after shop pages are complete.
- Shop UI should be spacious and image-forward.
- Admin UI (later) should be a quiet/dense ops console.

## Routing Model (Must Match Platform Conventions)

Local development must use the same split routing model as the existing platform ports:

- Normal shop APIs call Docker Compose services directly:
  - users: `http://localhost:3000`
  - orders: `http://localhost:3003`
  - payment: `http://localhost:4000`
  - products: `http://localhost:3005`
  - search: `http://localhost:5003`
- Prod Control Plane APIs (later) use the proxy path:
  - `/api/control-plane/*` -> `http://localhost:18080` -> EKS prod ingress
- Local AI assistant APIs (later) use the proxy path:
  - `/api/control-plane/ai/*` -> `http://localhost:7100` -> local `control-plane-service` -> LM Studio

Production builds must keep API bases relative (`""`) so the deployed UI does not contain `localhost:*` URLs.

## Auth Model

- JWT is stored in `localStorage`.
- UI must attach `Authorization: Bearer <jwt>` when calling authenticated endpoints.
- UI should fetch `GET /api/users/profile` to determine `role`.

## Local Prerequisites

Expected local processes:

- Docker Compose backend services (users/orders/payment/products/search).
- (Later) prod ingress tunnel on `http://localhost:18080` for Control Plane.
- (Later) local `control-plane-service` on `http://localhost:7100` for AI assistant.
- (Later) LM Studio server on `http://127.0.0.1:1234`.

## How To Run

App path:

`C:\Users\ranja\Documents\projects\cloudpulse-ui`

Commands:

- `cd C:\Users\ranja\Documents\projects\cloudpulse-ui`
- `npm install`
- `npm run dev`
- `npm run build`

`npm run dev` notes:

- Uses `scripts/start-dev.cjs`.
- If `CONTROL_PLANE_PROXY_TARGET` resolves to localhost and `SKIP_KUBE_PORT_FORWARD` is not `true`, it attempts to auto-start:
  - `kubectl port-forward -n ingress-nginx svc/ingress-nginx-controller 18080:80`
- You can disable auto-port-forward:
  - `SKIP_KUBE_PORT_FORWARD=true npm run dev`

Proxy env vars used by dev startup and Vite:

- `CONTROL_PLANE_PROXY_TARGET` (default `http://localhost:18080`)
- `CONTROL_PLANE_AI_PROXY_TARGET` (default `http://localhost:7100`)
- `PROD_INGRESS_LOCAL_PORT` (default `18080`)

## Verification Checklist

Shop MVP:

- Signup works against local `user-service`.
- Login stores JWT in `localStorage`.
- Profile returns `role` and UI reflects logged-in state.
- Catalog/product list loads from local `product-service` with no mocks.
- Cart and checkout flow is active (order creation on checkout success clears cart).
- Orders list and order-detail pages are active:
  - `/orders`
  - `/orders/:orderId`

Production build invariants:

- The build output must not contain any `localhost:3000`, `localhost:3003`, `localhost:4000`, `localhost:3005`, `localhost:5003`, `localhost:7100`, or `localhost:18080` strings.

Reproducible check commands:

- `cd C:\Users\ranja\Documents\projects\cloudpulse-ui`
- `rm -rf dist && npm run build`
- `rg -n "localhost:(3000|3003|4000|3005|5003|7100|18080)" dist`
- Expected result: no matches.

Phase 3 hardening checks:

- If token is expired/invalid, authenticated requests should trigger logout and redirect to `/login`.
- Control panel and shop remain usable in both light and dark mode.
- Mobile nav is present for small screens.

## Control Panel Status

Current implemented admin routes:

- `/admin/overview`
- `/admin/deployments`
- `/admin/services/:service`
- `/admin/logs`
- `/admin/incidents`
- `/admin/resilience`
- `/admin/ai`
- `/admin/audit`

Current implemented admin capabilities:

- `/admin/overview`: summary metrics + Service Health panel.
- `/admin/deployments`: allowlisted service cards with Details navigation.
- `/admin/services/:service`: deployment diagnostics, logs/events/actions, and guarded scale.
- `/admin/logs`: all-services and single-service log rendering from `entries` payloads.
- `/admin/incidents`: alerts + healing history + service events, including healing timestamps.
- `/admin/resilience`: healer safeguards, manual action guardrails, per-service resilience state, order/product breaker diagnostics.
- `/admin/audit`: manual action audit trail with result/replicas/admin/reason/timestamp.

UI gating:

- Admin routes require `role === "admin"` in frontend gating.
- Non-admin users are shown an access denied page.

## Control Panel Rules (Active And Ongoing)

When admin Control Panel pages are implemented:

- UI must remain prod-focused and use live data, not mocks.
- UI must gate admin routes unless `user.role === "admin"` (UX only; backend remains the real enforcement).
- UI must not add any new mutation paths beyond the existing guarded scale `0/1` flow for allowlisted prod deployments.
- Do not broaden RBAC or add secret access.
