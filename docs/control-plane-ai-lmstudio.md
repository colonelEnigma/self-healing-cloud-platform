# Control Plane AI With LM Studio

## Purpose

Control Plane now exposes a read-only AI assistant API for frontend use:

- `GET /api/control-plane/ai/status`
- `POST /api/control-plane/ai/chat`

The endpoint is protected by the same JWT and admin middleware as the rest of `/api/control-plane/*`.

## Local LM Studio Setup

1. Open LM Studio.
2. Load `gemma3:4b`.
3. Start the local server with the OpenAI-compatible API enabled.
4. Use this base URL:

```text
http://localhost:1234/v1
```

For docker-compose local backend testing, the service is configured to call:

```text
http://host.docker.internal:1234/v1
```

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

`service` is optional, but when provided it must be one of the allowlisted prod app deployments.

## API Response

```json
{
  "model": "gemma3:4b",
  "mode": "incident-summary",
  "service": "order-service",
  "answer": "...",
  "contextUsed": ["overview", "service", "events", "healing-history", "logs", "resilience"],
  "warnings": [],
  "generatedAt": "2026-05-02T10:00:00.000Z"
}
```

## Safety Rules

- AI is read-only and advisory.
- No scale, deploy, rollback, delete, Kafka mutation, database mutation, secret access, or RBAC broadening was added.
- The prompt includes only bounded Control Plane context from allowlisted prod services.
- Logs are truncated before being sent to LM Studio.
- Non-admin users cannot access the endpoint.

## Important Network Note

If `control-plane-service` runs inside EKS, `localhost:1234` means the Kubernetes pod, not your laptop. For a local LM Studio demo, use one of these:

- Run `control-plane-service` locally or through docker-compose so it can reach LM Studio on your machine.
- Or provide an `LM_STUDIO_BASE_URL` that is reachable from the cluster.

Do not expose LM Studio publicly without a deliberate security review.
