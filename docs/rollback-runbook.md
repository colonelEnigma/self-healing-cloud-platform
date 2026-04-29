# Rollback Runbook

## Purpose

This runbook explains the current Jenkins rollback flow for application services in `dev`, `test`, and `prod`.

Rollback is controlled by:

```text
jenkins/rollback.env
```

The Jenkins pipeline only enters rollback mode when `jenkins/rollback.env` changes in the pushed commit and contains a complete, confirmed rollback request.

## Supported Rollback Targets

Supported namespaces:

- `dev`
- `test`
- `prod`

Supported services:

- `user-service`
- `order-service`
- `payment-service`
- `product-service`
- `search-service`

Do not use this rollback path for Kafka, PostgreSQL, PVCs, namespaces, Prometheus, Grafana, Alertmanager, or shared infrastructure.

## How Jenkins Detects Rollback

During `Detect Changed Services`, Jenkins checks changed files with:

```bash
git diff --name-only HEAD~1 HEAD
```

Rollback mode is enabled only when:

- `jenkins/rollback.env` is present in that changed-file list.
- `ACTION=rollback`
- `CONFIRM_ROLLBACK=true`
- `ROLLBACK_SERVICE` is set.
- `ROLLBACK_NAMESPACE` is set.
- `ROLLBACK_IMAGE_TAG` is set.

When rollback mode is enabled, normal changed-service build/deploy stages are skipped.

## Rollback Configuration

Edit `jenkins/rollback.env`:

```env
ACTION=rollback
ROLLBACK_SERVICE=payment-service
ROLLBACK_NAMESPACE=prod
ROLLBACK_IMAGE_TAG=<known-good-short-git-sha>
CONFIRM_ROLLBACK=true
```

Use the exact image tag that should be restored. EKS application images use short Git SHA tags, not `latest`.

The current Jenkins rollback stage builds the image reference as:

```text
348071628290.dkr.ecr.ap-south-1.amazonaws.com/<service>:<image-tag>
```

It then runs the equivalent of:

```bash
kubectl set image deployment/<service> \
  <service>=348071628290.dkr.ecr.ap-south-1.amazonaws.com/<service>:<image-tag> \
  -n <namespace>

kubectl rollout status deployment/<service> -n <namespace>
kubectl get pods -n <namespace>
```

This assumes the deployment container name matches the service name.

## Rollback Procedure

1. Identify the last known-good short Git SHA image tag.

```bash
kubectl get deployment payment-service -n prod \
  -o jsonpath='{.spec.template.spec.containers[0].image}'
```

2. Update `jenkins/rollback.env` with the target service, namespace, image tag, and `CONFIRM_ROLLBACK=true`.

3. Commit and push only the rollback request, or keep the commit tightly scoped to the rollback request.

```bash
git add jenkins/rollback.env
git commit -m "Rollback payment-service in prod"
git push
```

4. Watch the Jenkins job and confirm it enters the `Rollback` stage.

5. Confirm Jenkins reports successful rollout status for the target deployment.

## Verification

Check rollout status:

```bash
kubectl rollout status deployment/payment-service -n prod
```

Check pods:

```bash
kubectl get pods -n prod -l app=payment-service
```

Check the active image:

```bash
kubectl get deployment payment-service -n prod \
  -o jsonpath='{.spec.template.spec.containers[0].image}'
```

Check recent service logs:

```bash
kubectl logs deployment/payment-service -n prod --tail=120
```

Check service endpoints:

```bash
kubectl get endpoints payment-service -n prod
```

Check the service health endpoint through a short port-forward:

```bash
kubectl port-forward svc/payment-service 4000:4000 -n prod
curl -i http://localhost:4000/health
```

For ingress validation, use a known public API route for the service under rollback. Some service APIs require authentication, so an expected `401` or `403` is better than a connection failure or `5xx`.

## Observability Checks

Prometheus and Grafana are aligned for `dev` and `prod`.

For `dev` or `prod`, confirm the service target is up:

```bash
kubectl exec deployment/grafana -n monitoring -- \
  wget -qO- 'http://prometheus-server.default.svc.cluster.local/api/v1/query?query=up%7Bdeployment%3D%22payment-service%22%2Cnamespace%3D%22prod%22%7D'
```

In Grafana, open:

```text
Dashboards -> Self-Healing Cloud Platform -> Self-Healing Cloud Platform
```

Check:

- `Service Health`
- HTTP request panels
- Kafka panels for Kafka-aware services
- `Latest Healing Actions` if the rollback was related to a self-healing event

Optional healer history check:

```bash
kubectl port-forward svc/healer-service 7000:7000 -n default
curl "http://localhost:7000/history?namespace=prod&deployment=payment-service&sort=desc&page=1&limit=5"
```

## Post-Rollback Cleanup

After the rollback is verified, reset `jenkins/rollback.env` in a follow-up commit:

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

## Failure Handling

If rollback does not start:

- Confirm `jenkins/rollback.env` changed in the pushed commit.
- Confirm all required rollback fields are populated.
- Confirm `CONFIRM_ROLLBACK=true`.
- Confirm the Jenkins job checked out the expected commit.

If rollout fails:

```bash
kubectl describe deployment/payment-service -n prod
kubectl get pods -n prod -l app=payment-service
kubectl describe pod <pod-name> -n prod
kubectl logs deployment/payment-service -n prod --tail=160
```

Common causes:

- Image tag does not exist in ECR.
- Container name does not match the service name.
- The old image starts but fails readiness.
- Required config, Secret, topic, or database state changed after the target image was built.

Do not delete pods, PVCs, namespaces, Kafka, or PostgreSQL as part of rollback unless explicitly approved.
