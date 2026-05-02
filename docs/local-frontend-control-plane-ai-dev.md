# Local Frontend With Prod Control Plane And Local AI

## Purpose

Use local `cloudpulse-ui` for fast UI development while keeping app APIs local, Control Plane data/actions prod-backed, and AI local through LM Studio.

## Final Routing Model

```text
Frontend
  http://localhost:3001

Normal app APIs, direct to Docker Compose
  users    http://localhost:3000/api/users
  orders   http://localhost:3003/api/orders
  payment  http://localhost:4000/api/payment
  products http://localhost:3005/api/products
  search   http://localhost:5003/api/search

Prod Control Plane APIs, proxied by CRA dev server
  http://localhost:3001/api/control-plane/*
  -> http://localhost:18080/api/control-plane/*
  -> EKS prod ingress

Local AI assistant APIs, proxied by CRA dev server
  http://localhost:3001/api/control-plane/ai/*
  -> http://localhost:7100/api/control-plane/ai/*
  -> local Docker control-plane-service
  -> LM Studio
```

Production frontend builds must keep all API URLs relative, so deployed frontend uses prod ingress for all services and does not contain localhost URLs.

## Local Ports

| Component | Port |
|---|---|
| Frontend `npm start` | `3001` |
| Jenkins UI port-forward | `8080` |
| Prod ingress local tunnel | `18080` |
| Local `control-plane-service` AI backend | `7100` |
| LM Studio OpenAI-compatible server | `1234` |
| `user-service` | `3000` |
| `order-service` | `3003` |
| `payment-service` | `4000` |
| `product-service` | `3005` |
| `search-service` | `5003` |

## Frontend Dev Behavior

In the separate `cloudpulse-ui` repo:

- `src/config.js` uses Docker localhost ports only in development.
- `src/config.js` uses empty API bases in production.
- `src/setupProxy.js` proxies only Control Plane paths:
  - `/api/control-plane/ai` to `CONTROL_PLANE_AI_PROXY_TARGET || http://localhost:7100`
  - `/api/control-plane` to `CONTROL_PLANE_PROXY_TARGET || http://localhost:18080`
- `scripts/start-dev.js` keeps React on `PORT=3001` and starts/reuses the ingress tunnel on `18080`.
- `.env.development.local` should use:

```env
CONTROL_PLANE_PROXY_TARGET=http://localhost:18080
CONTROL_PLANE_AI_PROXY_TARGET=http://localhost:7100
PROD_INGRESS_LOCAL_PORT=18080
```

## Backend AI Behavior

Local Docker `control-plane-service` is responsible for AI calls because browser code should not call LM Studio directly.

```env
LM_STUDIO_BASE_URL=http://host.docker.internal:1234/v1
LM_STUDIO_MODEL=google/gemma-3-4b
LM_STUDIO_TIMEOUT_MS=120000
CONTROL_PLANE_CONTEXT_BASE_URL=http://host.docker.internal:18080/api/control-plane
```

The context base URL makes the local AI backend read live prod Control Plane facts. This prevents false local-only results such as stale Prometheus alerts or local Kubernetes `::1:8080` failures.

## Validation

Expected local browser network behavior:

- `/products` calls `http://localhost:3005/api/products`.
- login calls `http://localhost:3000/api/users/login`.
- orders call `http://localhost:3003/api/orders/...`.
- payment calls `http://localhost:4000/api/payment/...`.
- search calls `http://localhost:5003/api/search/...`.
- Control Panel calls `http://localhost:3001/api/control-plane/...`.
- AI Assistant calls `http://localhost:3001/api/control-plane/ai/...`.

Expected production build behavior:

- no `localhost:3000`
- no `localhost:3003`
- no `localhost:4000`
- no `localhost:3005`
- no `localhost:5003`
- no `localhost:7100`
- no `localhost:18080`

## Notes

- Control Plane remains prod-only, live-data-only, and allowlist-only.
- Guarded scale remains the only mutation, and only to replicas `0` or `1`.
- AI is read-only and advisory.
- Do not broaden Control Plane RBAC for this setup.
