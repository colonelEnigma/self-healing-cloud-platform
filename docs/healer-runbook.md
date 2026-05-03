# Healer Service Runbook

## Purpose

`healer-service` receives Alertmanager webhooks and performs controlled self-healing for known `ServiceDown` alerts.

Current allowed environments:

- `dev`
- `prod`

The `test` environment has been decommissioned. Healer automation is scoped to `dev` and `prod`.

Current allowed deployments:

- `user-service`
- `order-service`
- `payment-service`
- `product-service`
- `search-service`

## How Healing Works

Flow:

```text
Prometheus ServiceDown alert
-> Alertmanager webhook
-> healer-service /heal
-> policy, cooldown, rate limit, circuit breaker checks
-> Kubernetes deployment get/patch
-> healing_actions audit record
```

Behavior for `ServiceDown`:

- If deployment replicas are `0`, healer scales the deployment to `1`.
- If deployment replicas are already running, healer performs a rollout restart.
- Every success, blocked action, and error is written to the `healing_actions` table.

The active policy lives in:

```text
services/healer-service/src/config/actions.js
```

Kubernetes RBAC lives in:

```text
k8s/healer-service/rbac.yaml
```

Grafana dashboard operations live in:

```text
docs/grafana-runbook.md
```

## Verify Current State

Check healer pod:

```bash
kubectl get pods -n default | grep healer-service
kubectl rollout status deployment/healer-service -n default
```

Check healer service:

```bash
kubectl get svc healer-service -n default
```

Check RBAC:

```bash
kubectl auth can-i get deployments -n dev --as system:serviceaccount:default:healer-service
kubectl auth can-i patch deployments -n dev --as system:serviceaccount:default:healer-service
kubectl auth can-i get deployments -n prod --as system:serviceaccount:default:healer-service
kubectl auth can-i patch deployments -n prod --as system:serviceaccount:default:healer-service
```

Expected:

```text
yes
yes
yes
yes
```

Check Alertmanager routing:

```bash
kubectl get configmap prometheus-alertmanager -n default -o yaml \
  | grep -E 'healer-service|namespace=~|dev|prod|7000|slack-notifications'
```

Expected:

```text
http://healer-service.default.svc.cluster.local:7000/heal
namespace=~"dev|prod"
namespace="prod"
slack-notifications
```

## Check Healing History

Port-forward healer:

```bash
kubectl port-forward svc/healer-service 7000:7000 -n default
```

Latest actions:

```bash
curl "http://localhost:7000/history?sort=desc&page=1&limit=10"
```

Prod payment-service actions:

```bash
curl "http://localhost:7000/history?namespace=prod&deployment=payment-service&sort=desc&page=1&limit=5"
```

Useful filters:

```bash
curl "http://localhost:7000/history?namespace=dev&result=success&sort=desc&page=1&limit=10"
curl "http://localhost:7000/history?namespace=prod&result=blocked&sort=desc&page=1&limit=10"
curl "http://localhost:7000/history?alertName=ServiceDown&sort=desc&page=1&limit=10"
```

## Controlled Healing Test

Use this only when you intentionally want to trigger self-healing.

Dev test:

```bash
kubectl scale deployment/payment-service -n dev --replicas=0
kubectl get deployment payment-service -n dev -w
```

Prod test:

```bash
kubectl scale deployment/payment-service -n prod --replicas=0
kubectl get deployment payment-service -n prod -w
```

Expected:

- Prometheus fires `ServiceDown` after the alert window.
- Alertmanager sends the webhook to healer.
- Healer scales the deployment back to `1`.
- `/history` records `result: success` with `reason: replicas were 0`.

Check history:

```bash
curl "http://localhost:7000/history?namespace=prod&deployment=payment-service&sort=desc&page=1&limit=5"
```

Check Grafana:

1. Open the `Self-Healing Cloud Platform` dashboard.
2. Set `Environment` to `dev` or `prod`.
3. Set `Service` to the deployment under test.
4. Confirm `Service Health` recovers.
5. Confirm `Latest Healing Actions` shows the new audit row from `healerdb.healing_actions`.

## Disable Prod Healing

To stop prod auto-healing, remove `prod` from:

```text
services/healer-service/src/config/actions.js
```

Change:

```js
allowedNamespaces: ["dev", "prod"],
```

To:

```js
allowedNamespaces: ["dev"],
```

Then rebuild and redeploy `healer-service`.

To also remove Kubernetes permission in prod, remove the `prod` `Role` and `RoleBinding` from:

```text
k8s/healer-service/rbac.yaml
```

Then apply:

```bash
kubectl apply -f k8s/healer-service/rbac.yaml
```

## Deploy Config Changes

Apply healer RBAC:

```bash
kubectl apply -f k8s/healer-service/rbac.yaml
```

Apply Prometheus and Alertmanager config:

```bash
SLACK_WEBHOOK_URL="$(kubectl get secret alertmanager-secrets -n default -o jsonpath='{.data.SLACK_WEBHOOK_URL}' | base64 -d)"
```

```bash
helm upgrade prometheus prometheus-community/prometheus \
  -n default \
  -f prometheus-values.yaml \
  --set-string "alertmanager.config.global.slack_api_url=$SLACK_WEBHOOK_URL" \
  --server-side=true \
  --force-conflicts
```

```bash
unset SLACK_WEBHOOK_URL
```

Important: Alertmanager does not expand `${SLACK_WEBHOOK_URL}` inside its config file. Helm must receive the resolved webhook value or Alertmanager will fail with:

```text
unsupported scheme "" for URL
```

## Troubleshooting

Alertmanager is crashing:

```bash
kubectl logs prometheus-alertmanager-0 -n default --tail=120
kubectl get configmap prometheus-alertmanager -n default -o jsonpath='{.data.alertmanager\.yml}' \
  | sed -n '/slack_api_url/p'
```

Validate Alertmanager config:

```bash
kubectl run amtool-check \
  -n default \
  --rm -i --restart=Never \
  --image=quay.io/prometheus/alertmanager:v0.32.0 \
  --overrides='{"spec":{"containers":[{"name":"amtool-check","image":"quay.io/prometheus/alertmanager:v0.32.0","command":["amtool","check-config","/etc/alertmanager/alertmanager.yml"],"volumeMounts":[{"name":"cfg","mountPath":"/etc/alertmanager"}]}],"volumes":[{"name":"cfg","configMap":{"name":"prometheus-alertmanager","items":[{"key":"alertmanager.yml","path":"alertmanager.yml"}]}}]}}'
```

Helm conflict after manual `kubectl edit`:

```bash
helm upgrade prometheus prometheus-community/prometheus \
  -n default \
  -f prometheus-values.yaml \
  --set-string "alertmanager.config.global.slack_api_url=$SLACK_WEBHOOK_URL" \
  --server-side=true \
  --force-conflicts
```

Healer did not act:

```bash
kubectl logs deployment/healer-service -n default --tail=100
kubectl auth can-i patch deployments -n prod --as system:serviceaccount:default:healer-service
curl "http://localhost:7000/history?sort=desc&page=1&limit=10"
```

Check likely causes:

- Alert did not fire yet.
- Alertmanager did not route to healer.
- Namespace is not in `allowedNamespaces`.
- Deployment is not in `allowedDeployments`.
- Cooldown is active.
- Rate limit is active.
- Circuit breaker is open.
- RBAC does not allow deployment patching.

## Security Notes

- The previously exposed Slack webhook was rotated; rotate immediately if any webhook is exposed again.
- Do not commit Slack webhooks, kubeconfigs, DB passwords, AWS keys, or tokens.
- Keep Slack webhook in Kubernetes Secret `alertmanager-secrets` with key `SLACK_WEBHOOK_URL`.
- Current healer RBAC is limited to `get` and `patch` deployments in `dev` and `prod`.
- Do not grant healer access to Kafka, PostgreSQL, PVCs, pods, or namespaces unless explicitly approved.
