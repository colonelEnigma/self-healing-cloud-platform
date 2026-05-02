---
title: Jenkins Promotion Runbook
tags:
  - jenkins
  - ci-cd
  - promotion
  - runbook
updated: 2026-05-02
related:
  - rollback-runbook
---

# Jenkins Promotion Runbook

> [!summary] Current model
> Normal service commits build one short-SHA image and automatically deploy it to `dev` and `test`. A later confirmed promotion commit promotes the immutable image already running in `test` to `prod`.

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
-> Jenkins tags each image with the current short Git SHA
-> Jenkins pushes images to ECR
-> Jenkins deploys changed services to dev
-> Jenkins deploys changed services to test

promotion.env commit
-> Jenkins reads images currently running in test
-> Jenkins compares test images against prod images
-> Jenkins promotes selected test image tags to prod
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
PROMOTE_NAMESPACE=prod
PROMOTE_SERVICES=
CONFIRM_PROMOTION=false
```

Confirmed prod promotion:

```env
ACTION=promote
PROMOTE_NAMESPACE=prod
PROMOTE_SERVICES=
CONFIRM_PROMOTION=true
```

Required values:

- `ACTION=promote`
- `PROMOTE_NAMESPACE=prod`
- `CONFIRM_PROMOTION=true`
- `PROMOTE_SERVICES` is optional.

If `PROMOTE_SERVICES` is blank, Jenkins promotes every supported app service where the `test` image differs from the `prod` image.

If `PROMOTE_SERVICES` is set, it must be a comma-separated list of service names only, with no image tags:

```env
PROMOTE_SERVICES=order-service,payment-service
```

Supported app service paths:

- `services/user-service/`, `k8s/user-service/`, `jenkins/user-service.groovy`
- `services/order-service/`, `k8s/order-service/`, `jenkins/order-service.groovy`
- `services/payment-service/`, `k8s/payment-service/`, `jenkins/payment-service.groovy`
- `services/product-service/`, `k8s/product-service/`, `jenkins/product-service.groovy`
- `services/search-service/`, `k8s/search-service/`, `jenkins/search-service.groovy`

## Procedure

1. Push the app service changes normally and let Jenkins deploy them to `dev` and `test`.

2. Verify the service in `test`.

3. Confirm prod promotion in `jenkins/promotion.env`.

```env
ACTION=promote
PROMOTE_NAMESPACE=prod
PROMOTE_SERVICES=order-service
CONFIRM_PROMOTION=true
```

4. Commit only the promotion request.

```bash
git add jenkins/promotion.env
git commit -m "Promote order-service to prod"
git push
```

5. Jenkins reads the image tag from `test/order-service` and deploys that same tag to `prod/order-service`.

6. Verify `prod`.

7. Reset `jenkins/promotion.env` in a follow-up commit.

```env
ACTION=none
PROMOTE_NAMESPACE=prod
PROMOTE_SERVICES=
CONFIRM_PROMOTION=false
```

## Example

Scenario: `order-service` and `payment-service` were already built and verified in `test`.

```bash
git add jenkins/promotion.env
git commit -m "Promote order and payment services to prod"
git push
```

Expected Jenkins behavior:

```text
Detect Changed Services
-> IS_PROMOTION=true
-> PROMOTION_MODE=promote-test-images-to-prod
-> read test/order-service image tag
-> read test/payment-service image tag
-> PROMOTION_PLAN=order-service:<test-tag>,payment-service:<test-tag>
-> promote order-service:def5678 to prod
-> promote payment-service:def5678 to prod
-> wait for rollout status
```

After verification, reset `jenkins/promotion.env` using the inactive state shown above.

## Jenkins Detection

Jenkins compares the current commit with `GIT_PREVIOUS_SUCCESSFUL_COMMIT` when Jenkins provides it. If that value is unavailable, Jenkins falls back to:

```bash
git diff --name-only HEAD~1 HEAD
```

Promotion mode starts when the diff includes `jenkins/promotion.env` and the file contains a confirmed promotion request.

Only one confirmed action is allowed per commit. Do not confirm promotion and rollback in the same commit.

Promotion is idempotent: if `prod` already runs the same image as `test`, Jenkins verifies rollout status and exits without reapplying manifests for explicitly selected services. With blank `PROMOTE_SERVICES`, Jenkins skips services where `test` and `prod` already match.

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

## Manifest-Only Service Fixes

If a service manifest changes, Jenkins treats that service as changed and deploys it to `dev` and `test`. For example, a `k8s/payment-service/deployment.yaml` JWT configuration fix should flow as:

```text
push payment-service manifest fix
-> Jenkins deploys payment-service to dev and test
-> verify test
-> promote with PROMOTE_SERVICES=payment-service
-> Jenkins reads the test image tag and applies that image plus rendered manifest to prod
```

`PROMOTE_SERVICES` still uses service names only. Do not add image tags to this value.

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
- Confirm `PROMOTE_NAMESPACE=prod`.
- Confirm `jenkins/rollback.env` is not also confirmed in the same commit.

If promotion fails validation:

- Confirm `PROMOTE_NAMESPACE=prod`.
- Confirm `PROMOTE_SERVICES`, if set, contains service names only and no tags.
- Confirm the selected service has a deployment in `test`.
- Confirm the `test` deployment image has a normal tag.

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
