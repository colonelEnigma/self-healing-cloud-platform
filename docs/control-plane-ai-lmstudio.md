# Control Plane AI With LM Studio

## Purpose

Control Plane exposes a read-only AI assistant API for frontend use:

- `GET /api/control-plane/ai/status`
- `POST /api/control-plane/ai/chat`

The endpoints use the same JWT and admin middleware as the rest of `/api/control-plane/*`. The assistant can summarize prod health, incidents, service diagnostics, resilience state, logs, and audit history, but it cannot mutate anything.

## Local Architecture

```text
cloudpulse-ui npm start
  http://localhost:3001

normal app APIs
  -> direct Docker Compose services
     users    http://localhost:3000
     orders   http://localhost:3003
     payment  http://localhost:4000
     products http://localhost:3005
     search   http://localhost:5003

prod Control Plane reads/actions
  /api/control-plane/*
  -> CRA proxy
  -> http://localhost:18080
  -> EKS ingress
  -> control-plane-service in monitoring

local AI assistant
  /api/control-plane/ai/*
  -> CRA proxy
  -> http://localhost:7100
  -> local Docker control-plane-service
  -> LM Studio http://host.docker.internal:1234/v1
  -> prod Control Plane context through http://host.docker.internal:18080/api/control-plane
```

This keeps the model local while keeping the assistant grounded in live prod Control Plane facts.

## Required Local Processes

- Docker Compose app services.
- Local frontend on `http://localhost:3001`.
- Prod ingress tunnel on `http://localhost:18080`.
- Local `control-plane-service` on `http://localhost:7100`.
- LM Studio server on `http://127.0.0.1:1234`.

Jenkins UI can keep using local port `8080`; Control Plane ingress uses `18080` to avoid that port conflict.

## LM Studio Setup

1. Open LM Studio.
2. Load the Gemma 3 4B model.
3. Start the OpenAI-compatible local server.
4. Confirm `/v1/models` includes the actual model id:

```text
google/gemma-3-4b
```

Docker Compose config uses:

```text
LM_STUDIO_BASE_URL=http://host.docker.internal:1234/v1
LM_STUDIO_MODEL=google/gemma-3-4b
LM_STUDIO_TIMEOUT_MS=120000
CONTROL_PLANE_CONTEXT_BASE_URL=http://host.docker.internal:18080/api/control-plane
```

`CONTROL_PLANE_CONTEXT_BASE_URL` is important. Without it, the local AI backend may read local Docker/Prometheus/Kubernetes context and produce wrong answers for prod.

## API Request

```http
POST /api/control-plane/ai/chat
Authorization: Bearer <admin-jwt>
Content-Type: application/json
```

```json
{
  "mode": "incident-summary",
  "service": "order-service",
  "question": "Why is order-service unhealthy?"
}
```

Supported modes:

- `platform-summary`
- `incident-summary`
- `service-diagnostics`
- `resilience`
- `audit-summary`
- `logs`
- `runbook`

`service` is optional. When provided, it must be one of the allowlisted prod app deployments.

## API Response

```json
{
  "model": "google/gemma-3-4b",
  "mode": "platform-summary",
  "service": "all",
  "answer": "All five services are healthy with one ready replica each.",
  "contextUsed": ["overview"],
  "warnings": [],
  "generatedAt": "2026-05-02T10:00:00.000Z"
}
```

## Context Rules

- The assistant reads bounded Control Plane context only.
- Context is compacted before being sent to LM Studio.
- Logs are truncated.
- Service-specific prompts use the same allowlist as the rest of Control Plane.
- If remote context is configured, local Docker/Kube facts are not used as fallback.

## Safety Rules

- AI is read-only and advisory.
- No scale, deploy, rollback, delete, Kafka mutation, database mutation, secret access, or RBAC broadening was added.
- Non-admin users cannot access the endpoint.
- Do not expose LM Studio publicly without a deliberate security review.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `contextBaseUrlConfigured:false` from `/ai/status` | Local Control Plane container is missing `CONTROL_PLANE_CONTEXT_BASE_URL` | Rebuild/restart `control-plane-service` with docker-compose config |
| AI says `deployments unavailable: connect ECONNREFUSED ::1:8080` | AI backend is reading local Kubernetes context instead of prod Control Plane context | Confirm `CONTROL_PLANE_CONTEXT_BASE_URL=http://host.docker.internal:18080/api/control-plane` |
| AI says `healer-service ENOTFOUND` | Local Docker context cannot resolve cluster healer service | Use prod Control Plane context through `18080` |
| AI claims `payment-service` is down while prod is healthy | Old local Prometheus target pointed at the wrong payment port | Use the corrected Docker Prometheus payment target on `payment-service:4000` |
| LM Studio returns model not found | Config uses display name instead of LM Studio model id | Use `LM_STUDIO_MODEL=google/gemma-3-4b` |
| AI request times out | Local model is slow to respond | Use `LM_STUDIO_TIMEOUT_MS=120000` |
| Jenkins port-forward cannot bind `8080` | Port `8080` is already in use | Keep Jenkins on `8080` and use Control Plane ingress tunnel on `18080` |
