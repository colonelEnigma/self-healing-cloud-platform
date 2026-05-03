# Grafana Runbook

## Purpose

Grafana visualizes the self-healing cloud platform for `dev` and `prod`.

Current scope:

- `dev`
- `prod`

The `test` environment has been decommissioned; Grafana dashboard alignment is scoped to `dev` and `prod`.

## Current Provisioning Model

Grafana runs in the `monitoring` namespace as Helm release `grafana`.

Dashboard and datasource provisioning are now versioned in Git:

```text
k8s/monitoring/grafana-values.yaml
k8s/monitoring/grafana/kustomization.yaml
k8s/monitoring/grafana/dashboards/self-healing-platform.json
```

Dashboard ConfigMap:

```text
grafana-dashboard-self-healing-platform
```

Dashboard folder:

```text
Self-Healing Cloud Platform
```

Dashboard UID:

```text
self-healing-platform
```

Grafana persistence is currently disabled. This is acceptable for the current model because dashboards and datasources are provisioned from Git. UI-only changes can be lost when the Grafana pod is replaced, so export and commit important UI changes back into:

```text
k8s/monitoring/grafana/dashboards/self-healing-platform.json
```

## Datasources

Provisioned datasources:

| Name | UID | Type | Purpose |
|---|---|---|---|
| `Prometheus` | `prometheus` | Prometheus | service health, HTTP, Kafka, alert metrics |
| `Healer PostgreSQL` | `healer-postgres` | PostgreSQL | `healerdb.healing_actions` audit history |

Prometheus URL:

```text
http://prometheus-server.default.svc.cluster.local
```

PostgreSQL URL:

```text
postgres.default.svc.cluster.local:5432
```

PostgreSQL database:

```text
healerdb
```

## Required Secret

Grafana reads PostgreSQL datasource credentials from a Secret in the `monitoring` namespace:

```text
grafana-postgres-datasource
```

Required keys:

```text
GRAFANA_POSTGRES_USER
GRAFANA_POSTGRES_PASSWORD
```

Create or refresh it without printing credentials:

```bash
kubectl create secret generic grafana-postgres-datasource \
  -n monitoring \
  --from-literal=GRAFANA_POSTGRES_USER='<postgres-user>' \
  --from-literal=GRAFANA_POSTGRES_PASSWORD='<postgres-password>' \
  --dry-run=client -o yaml | kubectl apply -f -
```

Do not commit real PostgreSQL credentials.

## Deploy Grafana Dashboard Changes

Apply dashboard ConfigMap:

```bash
kubectl apply -k k8s/monitoring/grafana
```

Upgrade Grafana with provisioned datasources and dashboard provider:

```bash
helm upgrade grafana grafana/grafana \
  -n monitoring \
  -f k8s/monitoring/grafana-values.yaml
```

## Validate Before Applying

Validate dashboard ConfigMap generation:

```bash
kubectl apply -k k8s/monitoring/grafana --dry-run=client
```

Validate Helm rendering:

```bash
helm template grafana grafana/grafana \
  -n monitoring \
  -f k8s/monitoring/grafana-values.yaml
```

## Verify Current State

Check rollout:

```bash
kubectl rollout status deployment/grafana -n monitoring
kubectl get pods -n monitoring -l app.kubernetes.io/name=grafana
```

Check dashboard ConfigMap:

```bash
kubectl get configmap grafana-dashboard-self-healing-platform -n monitoring
```

Check provisioning logs:

```bash
kubectl logs deployment/grafana -n monitoring --tail=160 \
  | grep -E 'provisioning.datasources|provisioning.dashboard|inserting datasource|finished to provision dashboards'
```

Expected provisioning log messages include:

```text
inserting datasource from configuration name=Prometheus uid=prometheus
inserting datasource from configuration name="Healer PostgreSQL" uid=healer-postgres
finished to provision dashboards
```

## Test Datasources From Grafana UI

In Grafana:

1. Go to `Connections`.
2. Open `Data sources`.
3. Open `Prometheus`.
4. Click `Save & test`.
5. Open `Healer PostgreSQL`.
6. Click `Save & test`.

Expected:

- Prometheus query succeeds.
- PostgreSQL connection succeeds.

## Test Dashboard Panels

Open:

```text
Dashboards -> Self-Healing Cloud Platform -> Self-Healing Cloud Platform
```

Use:

```text
Environment: dev or prod
Service: payment-service or All
Time range: Last 15 minutes, Last 24 hours, or Last 7 days
```

Expected:

- `Service Health` shows `dev` and `prod` service targets.
- HTTP panels show request data when traffic exists.
- Kafka panels query successfully.
- `Latest Healing Actions` reads rows from `healerdb.healing_actions`.

## In-Cluster Smoke Tests

Check Prometheus reachability from Grafana:

```bash
kubectl exec deployment/grafana -n monitoring -- \
  wget -qO- 'http://prometheus-server.default.svc.cluster.local/api/v1/query?query=up%7Benvironment%3D~%22dev%7Cprod%22%7D'
```

Expected:

- Query status is `success`.
- `dev` and `prod` service targets are present.
- `test` targets should not exist after decommission.

Check PostgreSQL network reachability from Grafana:

```bash
kubectl exec deployment/grafana -n monitoring -- \
  sh -c 'nc -z postgres.default.svc.cluster.local 5432'
```

Expected:

```text
exit code 0
```

Check the PostgreSQL datasource env var is mounted without printing the password:

```bash
kubectl exec deployment/grafana -n monitoring -- printenv GRAFANA_POSTGRES_USER
```

## Controlled End-To-End Test

Prefer `dev` for routine dashboard validation:

```bash
kubectl scale deployment/payment-service -n dev --replicas=0
kubectl get deployment payment-service -n dev -w
```

Expected:

- Prometheus detects `ServiceDown`.
- Alertmanager routes the alert to healer-service.
- healer-service restores replicas to `1`.
- `Latest Healing Actions` shows the new `dev/payment-service` row.

Only test in `prod` intentionally and with operator attention:

```bash
kubectl scale deployment/payment-service -n prod --replicas=0
kubectl get deployment payment-service -n prod -w
```

Expected:

- Slack receives the prod alert.
- healer-service restores replicas to `1`.
- Grafana `Latest Healing Actions` shows the prod audit row.

## Troubleshooting

Dashboard missing:

```bash
kubectl get configmap grafana-dashboard-self-healing-platform -n monitoring
kubectl logs deployment/grafana -n monitoring --tail=160
```

Datasource missing:

```bash
kubectl logs deployment/grafana -n monitoring --tail=160 \
  | grep -E 'datasource|provisioning'
```

PostgreSQL datasource fails:

```bash
kubectl get secret grafana-postgres-datasource -n monitoring
kubectl exec deployment/grafana -n monitoring -- printenv GRAFANA_POSTGRES_USER
kubectl exec deployment/grafana -n monitoring -- sh -c 'nc -z postgres.default.svc.cluster.local 5432'
```

Prometheus panels are empty:

```bash
kubectl exec deployment/grafana -n monitoring -- \
  wget -qO- 'http://prometheus-server.default.svc.cluster.local/api/v1/query?query=up%7Benvironment%3D~%22dev%7Cprod%22%7D'
```

If an older UI-created dashboard shows `data source not found`, use the provisioned dashboard:

```text
Self-Healing Cloud Platform
```

or export and normalize the older dashboard JSON to use datasource UIDs:

```text
prometheus
healer-postgres
```

## Security Notes

- Do not commit Grafana admin passwords, PostgreSQL credentials, Slack webhooks, kubeconfigs, or tokens.
- The Grafana PostgreSQL datasource secret must stay in the `monitoring` namespace.
- The PostgreSQL password is referenced through Grafana environment expansion, not stored in committed values.
- Grafana persistence is disabled; commit important dashboard changes to Git instead of relying on UI-only state.
