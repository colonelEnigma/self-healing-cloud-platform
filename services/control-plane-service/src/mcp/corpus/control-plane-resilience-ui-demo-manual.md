---
tags:
  - operations
  - kubernetes
  - kafka
  - prometheus
  - devops
  - docker
  - helm
aliases:
  - Operations Playbook
  - Ops Playbook
created: 01-05-2026
---
## Goal

  

Show that CloudPulse is not only monitoring services, but also enforcing safe resilience behavior:

  

- self-healing through healer-service

- rate limiting to avoid repeated automated actions

- circuit breaker behavior to stop unsafe repeated failures

- retry and cooldown policy

- application-level circuit breaker between `order-service` and `product-service`

- guarded manual scale actions with audit history

  

The UI should be read-only for resilience policy. It should show state and evidence, not expose controls to change thresholds or reset breakers.

  

## Main Navigation

  

Add a new Control Panel page:

  

```text

Control Panel -> Resilience

```

  

Suggested route:

  

```text

/control-panel/resilience

```

  

API source:

  

```text

GET /api/control-plane/resilience

```

  

## Page Layout

  

### Top Summary Strip

  

Show compact status cards:

  

```text

Healer Policy

Enabled

Action: scale-or-restart

  

Circuit Breakers

All Closed / Some Open

  

Rate Limits

Available / Limited

  

Manual Guardrails

Prod-only, 0/1 replicas

```

  

Example card text:

  

```text

Healer Safeguards

Enabled

Cooldown 300s · Retry 3x · Rate limit 3/20m

```

  

```text

Manual Actions

Guarded

prod only · typed confirmation · audited

```

  

## Section 1: Healer Safeguards

  

Purpose: explain what healer-service is allowed to do.

  

Display fields from:

  

```js

mechanisms.healerServiceDownPolicy

```

  

Recommended UI:

  

```text

Healer Safeguards

  

Alert: ServiceDown

Owner: healer-service

Action: scale-or-restart

Enabled: yes

  

Allowed namespace: prod

Allowed services:

user-service, order-service, payment-service, product-service, search-service

  

Cooldown: 300 seconds

Retry: 3 attempts, 500ms base delay

Rate limit: 3 actions per 20 minutes

Circuit breaker: opens after 3 failures in 30 minutes

```

  

Demo talking point:

  

```text

The healer is not a blind auto-repair script. It only works on allowlisted services, in prod, with cooldowns, retries, rate limits, and circuit breaker protection.

```

  

## Section 2: Service Resilience State

  

Purpose: show live per-service resilience state.

  

Display one row/card per item in:

  

```js

mechanisms.healerServiceDownPolicy.serviceState

```

  

Suggested table columns:

  

```text

Service

Circuit breaker

Failures

Rate limit

Cooldown

Last action

Blocked reasons

```

  

Example row:

  

```text

payment-service

Circuit breaker: closed

Failures: 0 / 3 in 30m

Rate limit: 1 / 3 in 20m

Cooldown: 300s

Last action: success · replicas were 0

Blocked reasons: none

```

  

If circuit breaker is open:

  

```text

payment-service

Circuit breaker: open

Failures: 3 / 3 in 30m

Rate limit: 2 / 3 in 20m

Last action: blocked · circuit breaker open

```

  

Status colors:

  

```text

closed      -> healthy/green

open        -> danger/red

half_open   -> warning/yellow

available   -> healthy/green

limited     -> warning/red

```

  

Demo talking point:

  

```text

This row explains why the healer will act, wait, or refuse to act for each service.

```

  

## Section 3: Order/Product Circuit Breaker

  

Purpose: show application-level resilience inside the business workflow.

  

Display from:

  

```js

mechanisms.orderProductCircuitBreaker

```

  

Suggested UI:

  

```text

Order/Product Circuit Breaker

  

Owner: order-service

Dependency: product-service

State: closed

Timeout: 3000ms

Failure threshold: 50%

Reset timeout: 10000ms

Fallback: PRODUCT_SERVICE_UNAVAILABLE

404 handling: ignored as business error

```

  

Also show retry behavior:

  

```text

Product HTTP Retry

  

Attempts: 3

Base delay: 500ms

Retries on:

ECONNREFUSED, ENOTFOUND, ECONNABORTED, network errors, retryable HTTP errors

```

  

Demo talking point:

  

```text

Even before Kubernetes healing happens, order-service protects itself from product-service failures using timeout, retries, circuit breaker, and fallback.

```

  

## Section 4: Manual Action Guardrails

  

Purpose: explain why the UI scale buttons are safe.

  

Display from:

  

```js

mechanisms.manualScaleGuard

```

  

Suggested UI:

  

```text

Manual Action Guardrails

  

Namespace: prod only

Allowed services:

user-service, order-service, payment-service, product-service, search-service

  

Allowed replicas: 0 or 1

Typed confirmation: required

Audit results: success, blocked, error

```

  

Demo talking point:

  

```text

Admins can demonstrate failure and recovery, but they cannot run arbitrary Kubernetes mutations from the UI.

```

  

## Section 5: Warnings Area

  

Display `warnings[]` from the API.

  

Example:

  

```text

order-service resilience status unavailable: connect ECONNREFUSED

```

  

Rules:

  

- Show warnings as non-blocking alerts.

- Do not replace missing live data with mock data.

- Keep the rest of the page usable.

  

## Demo Flow 1: Self-Healing

  

### Setup

  

Open:

  

```text

Control Panel -> Services -> payment-service

```

  

### Steps

  

1. Show current replicas:

  

```text

Desired: 1

Ready: 1

Status: healthy

```

  

2. Click:

  

```text

Scale Down

```

  

3. Type confirmation:

  

```text

payment-service

```

  

4. Submit.

  

5. Go to:

  

```text

Control Panel -> Audit

```

  

Show:

  

```text

payment-service - scale

Result: success

Requested replicas: 0

Previous replicas: 1

Reason: replicas patched

```

  

6. Wait for healer-service.

  

7. Go to:

  

```text

Control Panel -> Incidents / Healing History

```

  

Show healer entry:

  

```text

payment-service

Result: success

Reason: replicas were 0

Action: scale

```

  

8. Return to Services and show service healthy again.

  

Demo message:

  

```text

The admin created a controlled failure. The platform detected it, healer-service repaired it, and both the manual action and automated recovery were audited.

```

  

## Demo Flow 2: Guarded Manual Action

  

### Steps

  

Try a scale action with wrong typed confirmation.

  

Expected UI result:

  

```text

Action blocked

Typed confirmation must exactly match service name

```

  

Audit should show:

  

```text

Result: blocked

Reason: typed confirmation does not match service

Previous replicas: N/A

```

  

Demo message:

  

```text

Blocked actions are also audited, so failed or unsafe attempts do not disappear.

```

  

## Demo Flow 3: Rate Limit

  

### UI Story

  

Open:

  

```text

Control Panel -> Resilience

```

  

Show:

  

```text

Rate limit: 0 / 3 actions in 20m

State: available

```

  

After repeated healer actions for the same service, show:

  

```text

Rate limit: 3 / 3 actions in 20m

State: limited

Recent blocked reason: rate limit exceeded

```

  

Demo message:

  

```text

The healer avoids repeatedly touching the same service during a noisy incident.

```

  

Note: This may require repeated controlled events. Do not force this in prod unless you are intentionally running a demo.

  

## Demo Flow 4: Circuit Breaker

  

### UI Story

  

Open:

  

```text

Control Panel -> Resilience

```

  

Normal state:

  

```text

Circuit breaker: closed

Failures: 0 / 3 in 30m

```

  

Failure state:

  

```text

Circuit breaker: open

Failures: 3 / 3 in 30m

Last blocked reason: circuit breaker open

```

  

Demo message:

  

```text

If healing itself starts failing, the platform stops repeating unsafe repair attempts.

```

  

Note: This is best shown with seeded/demo failure history or a controlled non-prod environment.

  

## Frontend Implementation Notes

  

Use only:

  

```text

GET /api/control-plane/resilience

```

  

Do not add:

  

```text

POST /resilience

PATCH /resilience

DELETE /resilience

reset circuit breaker

edit threshold

edit healer policy

```

  

Expected page states:

  

```text

Loading

Loaded

Empty

Partial data with warnings

Error

Unauthorized

```

  

Do not show this page to normal users. Backend still enforces admin authorization.