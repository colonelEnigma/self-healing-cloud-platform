# Grafana Dashboard Provisioning

This directory versions the Grafana dashboard for the self-healing platform.

## Required Secret

Create the PostgreSQL datasource secret in the `monitoring` namespace before applying `grafana-values.yaml`:

```bash
kubectl create secret generic grafana-postgres-datasource \
  -n monitoring \
  --from-literal=GRAFANA_POSTGRES_USER='<postgres-user>' \
  --from-literal=GRAFANA_POSTGRES_PASSWORD='<postgres-password>'
```

Do not commit real credentials.

## Apply

```bash
kubectl apply -k k8s/monitoring/grafana

helm upgrade grafana grafana/grafana \
  -n monitoring \
  -f k8s/monitoring/grafana-values.yaml
```

## Validate First

```bash
kubectl apply -k k8s/monitoring/grafana --dry-run=client

helm template grafana grafana/grafana \
  -n monitoring \
  -f k8s/monitoring/grafana-values.yaml
```
