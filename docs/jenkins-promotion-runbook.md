# Jenkins Promotion Runbook

## Purpose

This runbook documents the current Jenkins delivery flow for application services.

Current behavior:

```text
Git push
-> Jenkins detects changed services
-> Buildah builds one image per changed service
-> Jenkins tags the image with the short Git SHA
-> Jenkins pushes the image to ECR
-> Jenkins deploys the same image tag to dev
-> Jenkins deploys the same image tag to test
-> Jenkins deploys the same image tag to prod
```

Manual approval gates are a desired delivery model in the project notes, but they are not currently enforced by `jenkins/common.groovy`. The current pipeline deploys sequentially to `dev`, then `test`, then `prod` without an approval pause.

## Current Pipeline Shape

Main files:

```text
Jenkinsfile
jenkins/common.groovy
jenkins/user-service.groovy
jenkins/order-service.groovy
jenkins/payment-service.groovy
jenkins/product-service.groovy
jenkins/search-service.groovy
jenkins/rollback.env
```

The main pipeline has these high-level stages:

- `Checkout`
- `Detect Changed Services`
- `Update Prometheus` when `prometheus-values.yaml` changes
- `Rollback` when `jenkins/rollback.env` contains a confirmed rollback request
- `Run Changed Services` for normal service builds and deployments

Jenkins uses Kubernetes agent pods. Build work uses Buildah, not the Docker daemon.

## Changed-Service Detection

Jenkins detects changed files with:

```bash
git diff --name-only HEAD~1 HEAD
```

For each service, Jenkins runs that service pipeline when the commit changes one of:

- `services/<service>/`
- `k8s/<service>/`
- the service-specific `jenkins/<service>.groovy`
- `Jenkinsfile`
- `jenkins/common.groovy`

If `Jenkinsfile` or `jenkins/common.groovy` changes, Jenkins treats all services as changed.

If `jenkins/rollback.env` contains a confirmed rollback request, Jenkins skips normal service builds and runs rollback only.

## Build And Image Tagging

For each changed service, Jenkins:

1. Checks out the repository.
2. Computes the image tag:

```bash
git rev-parse --short HEAD
```

3. Logs in to ECR using Jenkins credentials.
4. Builds the service image with Buildah.
5. Pushes the image to ECR.

Image format:

```text
348071628290.dkr.ecr.ap-south-1.amazonaws.com/<service>:<short-git-sha>
```

Do not use `latest` for EKS application deployments.

## Environment Deployment Flow

For each changed service, the same image tag is deployed in this order:

1. `dev`
2. `test`
3. `prod`

The current implementation applies Kubernetes manifests by substituting placeholders with `sed`, then piping the rendered manifest into `kubectl apply -f -`.

For non-Kafka services, Jenkins substitutes:

- `${NAMESPACE}`
- `${IMAGE_TAG}`

For Kafka-aware services, Jenkins also substitutes:

- `${ORDER_CREATED_TOPIC}`
- `${ORDER_CREATED_DLQ_TOPIC}`
- `${KAFKA_CONSUMER_GROUP}`

## Kafka-Aware Service Configuration

Kafka-aware services:

- `order-service`
- `payment-service`
- `product-service`
- `search-service`

Current topic mapping:

| Environment | Main topic | DLQ topic |
|---|---|---|
| `dev` | `order_created_dev` | `order_created_dlq_dev` |
| `test` | `order_created_test` | `order_created_dlq_test` |
| `prod` | `order_created` | `order_created_dlq` |

Current consumer group mapping:

| Service | Dev | Test | Prod |
|---|---|---|---|
| `payment-service` | `payment-group-dev` | `payment-group-test` | `payment-group` |
| `search-service` | `search-group-dev` | `search-group-test` | `search-group` |
| `product-service` | `product-group-dev` | `product-group-test` | `product-group` |

Kafka topic and group names should continue to come from environment variables in service code.

## Promotion Procedure

1. Commit the service or manifest change.

```bash
git status
git add <changed-files>
git commit -m "Update payment service"
git push
```

2. Watch Jenkins and confirm the expected service is detected.

3. Confirm Buildah builds and pushes the image with the expected short Git SHA tag.

4. Confirm Jenkins applies the manifests and rollout succeeds in `dev`, then `test`, then `prod`.

5. Record the image tag and affected environments in the PR or handoff notes.

Because the current pipeline does not pause for approvals, only push changes when sequential promotion to all three environments is acceptable.

## Verification After Each Environment

Check rollout:

```bash
kubectl rollout status deployment/payment-service -n dev
kubectl rollout status deployment/payment-service -n test
kubectl rollout status deployment/payment-service -n prod
```

Check pods:

```bash
kubectl get pods -n dev -l app=payment-service
kubectl get pods -n test -l app=payment-service
kubectl get pods -n prod -l app=payment-service
```

Check active image:

```bash
kubectl get deployment payment-service -n dev \
  -o jsonpath='{.spec.template.spec.containers[0].image}'
```

Check logs:

```bash
kubectl logs deployment/payment-service -n dev --tail=120
```

Check service endpoints:

```bash
kubectl get endpoints payment-service -n dev
```

Check service health through a short port-forward:

```bash
kubectl port-forward svc/payment-service 4000:4000 -n dev
curl -i http://localhost:4000/health
```

Repeat in `test` or `prod` when needed, changing the namespace and local port if required.

For ingress validation, use a known public API route for the service being promoted. Some service APIs require authentication, so an expected `401` or `403` is better than a connection failure or `5xx`.

## Observability Verification

Prometheus and Grafana are intentionally aligned for `dev` and `prod` only. `test` is not required to appear in Prometheus or Grafana unless explicitly requested later.

Check Prometheus targets from Grafana:

```bash
kubectl exec deployment/grafana -n monitoring -- \
  wget -qO- 'http://prometheus-server.default.svc.cluster.local/api/v1/query?query=up%7Benvironment%3D~%22dev%7Cprod%22%7D'
```

In Grafana, open:

```text
Dashboards -> Self-Healing Cloud Platform -> Self-Healing Cloud Platform
```

Confirm:

- `dev` and `prod` service health looks correct.
- HTTP panels show traffic after requests are sent.
- Kafka panels query successfully for Kafka-aware services.
- `Latest Healing Actions` does not show unexpected recovery activity.

For prod changes, confirm Alertmanager and Slack behavior if the change affects metrics, alerts, or service availability.

## Failure Handling

If Jenkins detects the wrong services:

- Check the changed files in the latest commit.
- Remember that `Jenkinsfile` or `jenkins/common.groovy` changes trigger all services.
- Confirm the service-specific Groovy file path matches the service.

If Buildah fails:

- Check the service Dockerfile and build context.
- Confirm Jenkins ECR credentials are available.
- Confirm the ECR repository exists for the service.

If rollout fails:

```bash
kubectl describe deployment/payment-service -n <namespace>
kubectl get pods -n <namespace> -l app=payment-service
kubectl describe pod <pod-name> -n <namespace>
kubectl logs deployment/payment-service -n <namespace> --tail=160
```

If prod is unhealthy after promotion, use `docs/rollback-runbook.md` to restore a known-good image tag.

## Future Hardening

Manual approval gates should be added before treating the Jenkins flow as a true controlled promotion pipeline.

Target model:

```text
deploy to dev
-> verify
-> approval
-> promote same image to test
-> verify
-> approval
-> promote same image to prod
```

Until that is implemented in Jenkins, the current flow is sequential deployment, not approval-gated promotion.
