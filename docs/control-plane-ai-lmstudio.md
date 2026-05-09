# Control Plane AI Assistant (OpenRouter, Prod-Routed)

## Purpose

Control Plane exposes read-only admin AI APIs:

- `GET /api/control-plane/ai/status`
- `POST /api/control-plane/ai/chat`

The assistant is advisory only and must not mutate cluster resources.

## Current Routing Model

- Control Panel APIs, including AI, are routed through prod ingress tunnel:
  - `/api/control-plane/*` -> `http://localhost:18080`
  - `/api/control-plane/ai/*` -> `http://localhost:18080`
- Backend runtime target is `control-plane-service` in namespace `monitoring`.

Local `control-plane-service` + LM Studio is no longer the default path for Control Panel AI.

## Chat Provider Model

- Active provider: OpenRouter
- Recommended provider order in prod: `AI_CHAT_PROVIDER_ORDER=openrouter`
- Chat model: `OPENROUTER_CHAT_MODEL` (current default can be `openrouter/auto`)
- Embedding model is separate and used for vector retrieval only.

## API Request Contract

`POST /api/control-plane/ai/chat`

```json
{
  "service": "payment-service",
  "question": "if a pod readiness fails. how to fix it?"
}
```

Notes:
- `mode` is no longer accepted in request payload.
- `service` must be allowlisted if provided.

## API Response Shape

```json
{
  "provider": "openrouter",
  "model": "openrouter/auto",
  "mode": "incident-summary",
  "service": "payment-service",
  "answer": "...",
  "contextUsed": ["overview", "service", "events", "healing-history", "logs", "resilience"],
  "warnings": [],
  "generatedAt": "2026-05-09T10:00:37.822Z"
}
```

## AI Error Response Shape (Provider Failure, Sanitized)

`POST /api/control-plane/ai/chat` returns `502` with sanitized provider failure details when all providers fail:

```json
{
  "message": "Failed to generate Control Plane AI response",
  "provider": "openrouter",
  "model": "openrouter/auto",
  "error": "No chat provider succeeded",
  "providerFailure": "upstream_http_429",
  "providerFailures": [
    { "provider": "openrouter", "error": "upstream_http_429" },
    { "provider": "lmstudio", "error": "timeout" }
  ]
}
```

Notes:
- `providerFailure` and `providerFailures` are sanitized and must not include secrets/tokens.
- Existing fields remain for backward compatibility.

## Ops Advice Response Shape (Phase 5 End-Cap Start)

`POST /api/control-plane/ops/advice`

```json
{
  "service": "payment-service",
  "namespace": "prod",
  "question": "What should I do next to stabilize this incident?",
  "intent": "recovery_plan",
  "confidence": "medium",
  "answer": "Prioritize production stabilization checks for payment-service...",
  "advice": [
    "Primary signal: ...",
    "Incident is still active; monitor recovery progression and avoid concurrent manual mutations.",
    "Prometheus still shows 1 firing alert(s) for this service; prioritize alert-specific runbook checks."
  ],
  "evidence": {
    "liveTelemetry": {
      "deployment": {
        "service": "payment-service",
        "status": "degraded",
        "desiredReplicas": 1,
        "readyReplicas": 0,
        "unavailableReplicas": 1
      },
      "firingAlerts": [
        {
          "name": "ServiceDown",
          "severity": "critical",
          "activeAt": "2026-05-09T10:45:00.000Z",
          "summary": "Payment service down"
        }
      ],
      "incidentRecovery": {
        "state": "in_progress",
        "outcome": "degradation_active",
        "by": "unknown"
      }
    },
    "similarIncidents": [
      {
        "executionId": 102,
        "scenarioId": "ScaleToZero",
        "outcome": "service_recovered",
        "score": 0.79
      }
    ],
    "docsAndRunbooks": [
      {
        "path": "docs/rollback-runbook.md",
        "section": "Rollback Steps",
        "excerpt": "..."
      }
    ],
    "latestIncidentSummary": {
      "executionId": 102,
      "scenarioId": "ScaleToZero",
      "outcome": "service_recovered",
      "startedAt": "2026-05-09T10:40:00.000Z",
      "endedAt": "2026-05-09T10:44:00.000Z"
    }
  },
  "unknowns": [],
  "citations": [
    {
      "path": "docs/rollback-runbook.md",
      "section": "Rollback Steps",
      "excerpt": "..."
    }
  ],
  "incidentContext": {
    "recovery": { "state": "in_progress" },
    "probableCauseCandidates": [],
    "summary": null
  },
  "warnings": [],
  "generatedAt": "2026-05-09T10:50:00.000Z",
  "readOnly": true
}
```

## Troubleshooting

1. `Failed to generate Control Plane AI response` with `No chat provider succeeded`
- Likely upstream provider failure (commonly `429`).
- Validate OpenRouter directly and check control-plane pod logs.

2. Frequent upstream `429`
- Increase retries/backoff (`AI_CHAT_MAX_RETRIES`, `AI_CHAT_RETRY_BACKOFF_MS`).
- Use a less rate-limited chat model.

3. `mode` rejected with `400`
- Remove `mode` from UI payload; send only `service` + `question`.

## Safety Rules

- Admin-only
- Read-only advisory behavior
- No secret exposure
- No mutation permissions added by AI endpoints
