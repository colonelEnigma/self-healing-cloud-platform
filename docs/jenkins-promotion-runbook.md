---
title: Jenkins Promotion Runbook
tags:
  - jenkins
  - ci-cd
  - promotion
  - runbook
updated: 2026-04-29
related:
  - rollback-runbook
---

# Jenkins Promotion Runbook

> [!summary] Current model
> Normal service commits build one short-SHA image and automatically deploy it to `dev` and `test`. Production deployment is a separate Git-controlled promotion through `jenkins/promotion.env`.

## Quick Facts

| Item | Value |
|---|---|
| Promotion file | `jenkins/promotion.env` |
| Promotion target | `prod` only |
| Auto-deploy targets | `dev`, `test` |
| Image tag | short Git SHA |
| Jenkins trigger | automatic every 2 minutes |
| Related rollback doc | [Rollback Runbook](rollback-runbook.md) |

> [!warning]
> Do not use Jenkins UI approval buttons for this flow. Prod approval is represented by reviewing, committing, and pushing `jenkins/promotion.env`.

## Flow

```text
service change commit
-> Jenkins detects changed services
-> Buildah builds one image per changed service
-> Jenkins tags the image with the short Git SHA
-> Jenkins pushes the image to ECR
-> Jenkins deploys the image to dev
-> Jenkins deploys the same image to test

promotion.env commit
-> Jenkins skips build
-> Jenkins deploys the existing image tag to prod
```

Image format:

```text
348071628290.dkr.ecr.ap-south-1.amazonaws.com/<service>:<short-git-sha>
```

Do not use `latest` for EKS application deployments.

## Promotion File

Default inactive state:

```env
ACTION=none
PROMOTE_SERVICE=
PROMOTE_NAMESPACE=prod
PROMOTE_IMAGE_TAG=
CONFIRM_PROMOTION=false
```

Confirmed prod promotion:

```env
ACTION=promote
PROMOTE_SERVICE=payment-service
PROMOTE_NAMESPACE=prod
PROMOTE_IMAGE_TAG=<short-git-sha-proven-in-test>
CONFIRM_PROMOTION=true
```

Required values:

- `ACTION=promote`
- `PROMOTE_SERVICE` is one of the supported app services.
- `PROMOTE_NAMESPACE=prod`
- `PROMOTE_IMAGE_TAG` is an existing ECR image tag.
- `CONFIRM_PROMOTION=true`

## Procedure

1. Push the service change and let Jenkins deploy it to `dev` and `test`.

2. Verify the deployed image in `test`.

```bash
SERVICE=payment-service
kubectl rollout status deployment/$SERVICE -n test
kubectl get pods -n test -l app=$SERVICE
kubectl get deployment $SERVICE -n test \
  -o jsonpath='{.spec.template.spec.containers[0].image}'
```

3. Edit `jenkins/promotion.env` with the same image tag that was verified in `test`.

4. Commit and push the prod promotion request.

```bash
git add jenkins/promotion.env
git commit -m "Promote payment-service to prod"
git push
```

5. Verify `prod`.

6. Reset `jenkins/promotion.env` in a follow-up commit.

```env
ACTION=none
PROMOTE_SERVICE=
PROMOTE_NAMESPACE=prod
PROMOTE_IMAGE_TAG=
CONFIRM_PROMOTION=false
```

## Example

Scenario: `payment-service` image tag `def5678` was built by Jenkins and verified in `dev` and `test`.

Set `jenkins/promotion.env` to:

```env
ACTION=promote
PROMOTE_SERVICE=payment-service
PROMOTE_NAMESPACE=prod
PROMOTE_IMAGE_TAG=def5678
CONFIRM_PROMOTION=true
```

Commit and push:

```bash
git add jenkins/promotion.env
git commit -m "Promote payment-service to prod"
git push
```

Expected Jenkins behavior:

```text
Detect Changed Services
-> IS_PROMOTION=true
-> skip normal service builds
-> render payment-service manifests for prod
-> deploy existing payment-service:def5678 image to prod
-> wait for rollout status
```

After verification, reset `jenkins/promotion.env` using the inactive state shown above.

## Jenkins Detection

Jenkins compares the current commit with `GIT_PREVIOUS_SUCCESSFUL_COMMIT` when Jenkins provides it. If that value is unavailable, Jenkins falls back to:

```bash
git diff --name-only HEAD~1 HEAD
```

Promotion mode starts only when the diff includes `jenkins/promotion.env` and the file contains a confirmed promotion request.

Only one confirmed action is allowed per commit. Do not confirm promotion and rollback in the same commit.

Promotion is idempotent: if `prod` already runs the requested image, Jenkins verifies rollout status and exits without reapplying manifests.

## Manifest Rendering

Promotion uses the same manifest rendering helper as normal deployment.

For all services, Jenkins substitutes:

- `${NAMESPACE}`
- `${IMAGE_TAG}`

For Kafka-aware services, Jenkins also substitutes:

- `${ORDER_CREATED_TOPIC}`
- `${ORDER_CREATED_DLQ_TOPIC}`
- `${KAFKA_CONSUMER_GROUP}`

Kafka-aware services:

- `order-service`
- `payment-service`
- `product-service`
- `search-service`

Topic mapping:

| Environment | Main topic | DLQ topic |
|---|---|---|
| `dev` | `order_created_dev` | `order_created_dlq_dev` |
| `test` | `order_created_test` | `order_created_dlq_test` |
| `prod` | `order_created` | `order_created_dlq` |

Consumer group mapping:

| Service | Dev | Test | Prod |
|---|---|---|---|
| `payment-service` | `payment-group-dev` | `payment-group-test` | `payment-group` |
| `search-service` | `search-group-dev` | `search-group-test` | `search-group` |
| `product-service` | `product-group-dev` | `product-group-test` | `product-group` |

Kafka topic and group names must continue to come from environment variables in service code.

## Verification

Use the promoted service name in the commands below.

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

For ingress validation, use a known public API route for the service being promoted. Some service APIs require authentication, so an expected `401` or `403` is better than a connection failure or `5xx`.

Grafana checks:

- Open `Self-Healing Cloud Platform`.
- Confirm `prod` service health looks correct.
- Confirm HTTP panels show traffic after requests are sent.
- Confirm Kafka panels query successfully for Kafka-aware services.
- Confirm `Latest Healing Actions` does not show unexpected recovery activity.

For prod changes, confirm Alertmanager and Slack behavior if the change affects metrics, alerts, or service availability.

## Troubleshooting

If Jenkins does not enter promotion mode:

- Confirm `jenkins/promotion.env` changed in the pushed commit.
- Confirm `ACTION=promote`.
- Confirm `CONFIRM_PROMOTION=true`.
- Confirm service, namespace, and image tag are populated.
- Confirm `jenkins/rollback.env` is not also confirmed in the same commit.

If promotion fails validation:

- Confirm `PROMOTE_SERVICE` is one of the supported services.
- Confirm `PROMOTE_NAMESPACE=prod`.
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

If prod is unhealthy after promotion, use [Rollback Runbook](rollback-runbook.md) to restore a known-good image tag.
