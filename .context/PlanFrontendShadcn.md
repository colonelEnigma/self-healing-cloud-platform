# PlanFrontendShadcn

Last updated: 2026-05-03

This plan defines the React frontend built with `shadcn/ui` + Tailwind in the separate repo `C:\Users\ranja\Documents\projects\cloudpulse-ui`. The project is delivered in phases; do not build everything at once.

## Decisions Locked

- One app contains both the user-facing shop and (later) the admin Control Panel.
- JWT storage: `localStorage`.
- Local dev routing model must match the platform ports and existing behavior:
  - Normal shop APIs call Docker Compose services directly:
    - users: `http://localhost:3000`
    - orders: `http://localhost:3003`
    - payment: `http://localhost:4000`
    - products: `http://localhost:3005`
    - search: `http://localhost:5003`
  - `/api/control-plane/*` proxies to prod/EKS through local ingress tunnel: `http://localhost:18080`
  - `/api/control-plane/ai/*` proxies to local `control-plane-service`: `http://localhost:7100`
- Production build invariant: API bases must be relative (`""`); no `localhost:*` URLs may be embedded in the production build output.
- Scope sequencing:
  1. Shop pages first: Home + Login + Signup + Catalog/Product list.
  2. Admin Control Panel UI only after shop pages are complete.
- Themes: light + dark.
  - Shop look and feel: spacious, image-forward.
  - Admin look and feel (later): quiet/dense ops console.

## Target Location

Canonical frontend repo:

`C:\Users\ranja\Documents\projects\cloudpulse-ui`

## Phase Plan

### Phase 0: Scaffold + UI Foundations

Goal: establish the base app, styling system, and API routing configuration.

Deliverables:

- New React app scaffold under the chosen `ui/...` folder.
- Tailwind configured with dark mode support.
- shadcn/ui initialized (component generation enabled, shared theme tokens).
- App shell:
  - top navigation
  - responsive layout container
  - theme toggle (persisted locally)
- API configuration module that supports:
  - dev: direct Docker Compose bases for shop services
  - dev: proxy paths reserved for Control Plane and AI (`/api/control-plane/*`, `/api/control-plane/ai/*`)
  - production: relative API bases only

Done when:

- App starts locally and renders a basic home route.
- Theme toggle works in both light/dark.
- A production build can be produced (even if no pages exist yet) and does not contain any hardcoded `localhost:*` API bases.

### Phase 1: Auth (Shop First)

Goal: implement login/signup and role-aware navigation primitives without any Control Panel pages yet.

Deliverables:

- Pages:
  - `/login`
  - `/signup`
- Auth module:
  - store JWT in `localStorage`
  - attach `Authorization: Bearer <jwt>` to authenticated calls
  - fetch `GET /api/users/profile` to obtain `role`
- Navigation:
  - always show shop navigation
  - reserve an admin entry point, but do not implement admin pages until later

Done when:

- Signup works end-to-end against local `user-service`.
- Login works end-to-end and persists the JWT.
- Profile fetch returns role and the UI state reflects logged-in vs logged-out.

### Phase 2: Shop MVP (Home + Catalog/Product List)

Goal: ship the initial consumer-facing shop surface.

Deliverables:

- `/` Home:
  - hero section
  - featured products block (if available) or newest products block
- `/products` Catalog/product list:
  - product grid (image, name, price)
  - basic loading/empty/error states

Done when:

- Product list renders from live `product-service` local API with no mocks.
- The UI remains usable in both light and dark themes.

Current implementation status:

- `/products` is live and category-driven.
- Product cards support add-to-cart.
- Cart and checkout flow is implemented:
  - cart is persisted locally
  - checkout creates order through `order-service`
  - success clears cart and is reflected in `/orders`
- Orders pages are implemented:
  - `/orders`
  - `/orders/:orderId` with payment lookup by order ID.

### Phase 3: Hardening (Before Admin UI)

Goal: make the shop demo-ready and prevent regressions around routing and auth.

Deliverables:

- Logout clears `localStorage` token and returns to public routes.
- 401 handling forces re-login (no infinite retry loops).
- Production build invariant check documented and reproducible.
- Minimal dev docs in `docs/cloudpulse-ui-runbook.md` updated with real commands.

Done when:

- A reviewer can run the new UI locally following the runbook.
- Production build passes the no-`localhost` invariant.

Current implementation status:

- Global auth-expiry handling is implemented (401/403 -> logout + redirect to `/login`).
- Theme handling was fixed to class-based dark mode with responsive mobile nav.

### Phase 4: Admin Control Panel UI (After Shop Completion)

Goal: add admin-only operational screens using existing Control Plane APIs and rules.

Entry constraints (non-negotiable):

- Admin routes must be gated by `role === "admin"` (UI gating) and still rely on backend auth.
- Control Plane screens must use live prod data only and remain prod-focused.
- Only mutation allowed: typed-confirmed scale to replicas `0` or `1` for allowlisted prod deployments, with audit logging.

Deliverables:

- Route group: `/admin/...` with role gate.
- Implemented pages:
  - `/admin/overview`
  - `/admin/deployments`
  - `/admin/services/:service`
  - `/admin/logs`
  - `/admin/incidents`
  - `/admin/resilience`
  - `/admin/ai`
  - `/admin/audit`
Current implementation status:

- Typed-confirmed guarded scale flow is implemented in service detail:
  - uses `POST /api/control-plane/actions/scale`
  - requires exact service-name confirmation
  - allows replicas `0` or `1` only
  - displays audit feedback (`auditId`, `auditedAt`, replica delta, `changed`)
- Admin routes are implemented and role-gated:
  - `/admin/overview`, `/admin/deployments`, `/admin/services/:service`, `/admin/logs`, `/admin/incidents`, `/admin/resilience`, `/admin/ai`, `/admin/audit`
- Overview includes Service Health panel.
- Services includes Details navigation to service diagnostics.
- Logs supports both all-services and per-service entries payloads.
- Incidents healing history includes timestamp display.
- Resilience includes healer safeguards, manual guardrails, per-service state, and order/product breaker diagnostics.
- Audit includes manual action trail details (result, replicas, admin identity, reason, timestamp).

Done when:

- Admin can safely view prod state and perform the guarded scale action without exposing broader mutation capability.

## Notes / Risks

- `localStorage` JWT is intentionally chosen for simplicity; treat it as a demo-friendly model, not a hardened security posture.
- Production build must never ship hardcoded local API endpoints. Enforce this early, before any Control Panel work begins.
