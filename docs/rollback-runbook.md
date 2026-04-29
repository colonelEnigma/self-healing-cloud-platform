---
title: Rollback Runbook
tags:
  - jenkins
  - rollback
  - incident-response
  - runbook
updated: 2026-04-29
related:
  - jenkins-promotion-runbook
---

# Rollback Runbook

> [!summary] Current model
> Rollback is a Git-controlled Jenkins action through `jenkins/rollback.env`. It skips normal service builds and points one deployment back to a known-good short-SHA image tag.

## Quick Facts

| Item | Value |
|---|---|
| Rollback file | `jenkins/rollback.env` |
| Supported namespaces | `dev`, `test`, `prod` |
| Supported services | `user-service`, `order-service`, `payment-service`, `product-service`, `search-service` |
| Rollback command | `kubectl set image` |
| Jenkins trigger | automatic every 2 minutes |
| Related promotion doc | [Jenkins Promotion Runbook](jenkins-promotion-runbook.md) |

> [!warning]
> Do not use this rollback path for Kafka, PostgreSQL, PVCs, namespaces, Prometheus, Grafana, Alertmanager, or shared infrastructure.

## Flow

```text
rollback.env commit
-> Jenkins detects confirmed rollback
-> Jenkins skips normal service builds
-> Jenkins validates service, namespace, and image tag
-> Jenkins sets the deployment image
-> Jenkins waits for rollout status
```

Image format:

```text
348071628290.dkr.ecr.ap-south-1.amazonaws.com/<service>:<short-git-sha>
```

Do not use `latest` for EKS application rollbacks.

## Rollback File

Default inactive state:

```env
ACTION=none
ROLLBACK_SERVICE=
ROLLBACK_NAMESPACE=
ROLLBACK_IMAGE_TAG=
CONFIRM_ROLLBACK=false
```

Confirmed rollback:

```env
ACTION=rollback
ROLLBACK_SERVICE=payment-service
ROLLBACK_NAMESPACE=prod
ROLLBACK_IMAGE_TAG=<known-good-short-git-sha>
CONFIRM_ROLLBACK=true
```

Required values:

- `ACTION=rollback`
- `ROLLBACK_SERVICE` is one of the supported app services.
- `ROLLBACK_NAMESPACE` is `dev`, `test`, or `prod`.
- `ROLLBACK_IMAGE_TAG` is an existing ECR image tag.
- `CONFIRM_ROLLBACK=true`

## Procedure

1. Identify the last known-good image tag.

```bash
SERVICE=payment-service
NAMESPACE=prod
kubectl get deployment $SERVICE -n $NAMESPACE \
  -o jsonpath='{.spec.template.spec.containers[0].image}'
```

2. Edit `jenkins/rollback.env` with the target service, namespace, and image tag.

3. Commit and push the rollback request.

```bash
git add jenkins/rollback.env
git commit -m "Rollback payment-service in prod"
git push
```

4. Watch Jenkins and confirm it enters the `Rollback` stage.

5. Verify the target deployment.

6. Reset `jenkins/rollback.env` in a follow-up commit.

```env
ACTION=none
ROLLBACK_SERVICE=
ROLLBACK_NAMESPACE=
ROLLBACK_IMAGE_TAG=
CONFIRM_ROLLBACK=false
```

## Example

Scenario: `payment-service` in `prod` is unhealthy after a release, and the last known-good image tag is `abc1234`.

Set `jenkins/rollback.env` to:

```env
ACTION=rollback
ROLLBACK_SERVICE=payment-service
ROLLBACK_NAMESPACE=prod
ROLLBACK_IMAGE_TAG=abc1234
CONFIRM_ROLLBACK=true
```

Commit and push:

```bash
git add jenkins/rollback.env
git commit -m "Rollback payment-service in prod"
git push
```

Expected Jenkins behavior:

```text
Detect Changed Services
-> IS_ROLLBACK=true
-> skip normal service builds
-> set prod/payment-service image to payment-service:abc1234
-> wait for rollout status
```

After verification, reset `jenkins/rollback.env` using the inactive state shown above.

## Jenkins Detection

Jenkins compares the current commit with `GIT_PREVIOUS_SUCCESSFUL_COMMIT` when Jenkins provides it. If that value is unavailable, Jenkins falls back to:

```bash
git diff --name-only HEAD~1 HEAD
```

Rollback mode starts only when the diff includes `jenkins/rollback.env` and the file contains a confirmed rollback request.

Before running `kubectl set image`, Jenkins validates that the service and namespace are allowlisted and that the image tag contains only normal tag characters.

Only one confirmed action is allowed per commit. Do not confirm rollback and promotion in the same commit.

## Verification

Use the rollback target service and namespace in the commands below.

```bash
SERVICE=payment-service
NAMESPACE=prod
kubectl rollout status deployment/$SERVICE -n $NAMESPACE
kubectl get pods -n $NAMESPACE -l app=$SERVICE
kubectl get deployment $SERVICE -n $NAMESPACE \
  -o jsonpath='{.spec.template.spec.containers[0].image}'
kubectl logs deployment/$SERVICE -n $NAMESPACE --tail=120
kubectl get endpoints $SERVICE -n $NAMESPACE
```

Check service health through a short port-forward:

```bash
kubectl port-forward svc/payment-service 4000:4000 -n prod
curl -i http://localhost:4000/health
```

For ingress validation, use a known public API route for the service under rollback. Some service APIs require authentication, so an expected `401` or `403` is better than a connection failure or `5xx`.

Grafana checks:

- Open `Self-Healing Cloud Platform`.
- Confirm service health recovers in `dev` or `prod`.
- Confirm HTTP panels show expected traffic.
- Confirm Kafka panels query successfully for Kafka-aware services.
- Check `Latest Healing Actions` if the rollback was related to a self-healing event.

Optional healer history check:

```bash
kubectl port-forward svc/healer-service 7000:7000 -n default
curl "http://localhost:7000/history?namespace=prod&deployment=payment-service&sort=desc&page=1&limit=5"
```

## Cleanup

After rollback is verified, reset `jenkins/rollback.env`:

```env
ACTION=none
ROLLBACK_SERVICE=
ROLLBACK_NAMESPACE=
ROLLBACK_IMAGE_TAG=
CONFIRM_ROLLBACK=false
```

Commit and push the reset:

```bash
git add jenkins/rollback.env
git commit -m "Reset rollback configuration"
git push
```

This prevents future unrelated commits from carrying an active rollback request.

## Troubleshooting

If Jenkins does not enter rollback mode:

- Confirm `jenkins/rollback.env` changed in the pushed commit.
- Confirm `ACTION=rollback`.
- Confirm `CONFIRM_ROLLBACK=true`.
- Confirm service, namespace, and image tag are populated.
- Confirm `jenkins/promotion.env` is not also confirmed in the same commit.

If rollback fails validation:

- Confirm `ROLLBACK_SERVICE` is one of the supported services.
- Confirm `ROLLBACK_NAMESPACE` is `dev`, `test`, or `prod`.
- Confirm the image tag contains only normal tag characters.
- Confirm the image tag exists in ECR.

If rollout fails:

```bash
SERVICE=payment-service
NAMESPACE=prod
kubectl describe deployment/$SERVICE -n $NAMESPACE
kubectl get pods -n $NAMESPACE -l app=$SERVICE
kubectl describe pod <pod-name> -n $NAMESPACE
kubectl logs deployment/$SERVICE -n $NAMESPACE --tail=160
```

Common causes:

- Image tag does not exist in ECR.
- Container name does not match the service name.
- The old image starts but fails readiness.
- Required config, Secret, topic, or database state changed after the target image was built.

Do not delete pods, PVCs, namespaces, Kafka, or PostgreSQL as part of rollback unless explicitly approved.
