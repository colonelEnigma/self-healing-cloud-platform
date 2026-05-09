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
created: 2026-04-26
---

# ⚙️ Operations Playbook

> [[🧠 Self-Healing Cloud Platform]] · [[02-Debugging-Playbook|Debugging]] · [[01-Release-Promotion-Rollback-Runbook|Release Runbook]] · [[01-Commands|Commands]]

Workflow-focused reference for daily operations across Kubernetes, Kafka, PostgreSQL, Prometheus, Helm, and Docker.

---

## ☸️ Kubernetes Workflow

### Deploy a Service

```bash
kubectl apply -f k8s/user-service/deployment.yml
kubectl apply -f k8s/user-service/service.yml
```

### Restart & Verify

```bash
kubectl rollout restart deployment/user-service -n dev
kubectl rollout status deployment/user-service -n dev
```

### Check Logs & Service

```bash
kubectl get svc -n dev
kubectl logs deploy/user-service -n dev --tail=50
```

### Check Running Image

```bash
kubectl get deployment product-service -o yaml | grep image:
```

---

## 📨 Kafka Workflow

### Check Kafka Logs

```bash
kubectl logs -l app=kafka
```

### Verify Consumers Are Running

```bash
kubectl logs -f deployment/payment-service
kubectl logs -f deployment/search-service
```

### Test Full Event Flow

```bash
# Trigger order
curl -X POST http://<api>/orders ...

# Watch consumers
kubectl logs -f deployment/payment-service
kubectl logs -f deployment/search-service
```

---

## 🗄️ PostgreSQL Workflow

### Connect to DB

```bash
kubectl exec -it <postgres-pod> -- psql -U admin
```

### Useful Queries

```sql
\l                        -- list databases
\c userdb                 -- connect to DB
\dt                       -- list tables
SELECT * FROM users;
```

### Debug DB Pod

```bash
kubectl get pods | grep postgres
kubectl logs <postgres-pod>
```

---

## 📊 Prometheus Workflow

### Get Prometheus URL

```bash
kubectl get svc
# Look for: prometheus-server   LoadBalancer   <CLUSTER-IP>   <EXTERNAL-IP>
```

Navigate to:
- `http://<EXTERNAL-IP>/targets`
- `http://<EXTERNAL-IP>/alerts`
- `http://<EXTERNAL-IP>/rules`

### If No External IP

```bash
kubectl port-forward svc/prometheus-server 9090:80
# Then: http://localhost:9090/targets
```

### Verify Metrics

Search in Prometheus UI:
```
kafka_processing_errors_total
kafka_dlq_messages_total
```

### Test Alert (ServiceDown)

```bash
kubectl scale deployment payment-service --replicas=0
# Alert fires → Slack notification expected
kubectl scale deployment payment-service --replicas=1  # restore
```

### Debug Missing Metrics

```bash
curl http://payment-service:4000/metrics
```

---

## 📦 Helm Workflow

### Upgrade Config

```bash
helm upgrade prometheus prometheus-community/prometheus -f prometheus-values.yaml
```

### Verify Applied Values

```bash
helm get values prometheus
```

### Inspect Live Config

```bash
kubectl exec -it deploy/prometheus-server -c prometheus-server -- \
  cat //etc/config/prometheus.yml
```

---

## 🐳 Docker Workflow

### Build

```bash
docker build -t product-service:local ./services/product-service
```

### Tag & Push to ECR

```bash
docker tag product-service:local <ECR_URL>/product-service:abc1234
docker push <ECR_URL>/product-service:abc1234
```

### Force Redeploy

```bash
kubectl rollout restart deployment/product-service
```

### Fix Cache Issue

```bash
docker build --no-cache -t product-service:local .
```

---

## 🧠 End-to-End Debug Flow

When something breaks, work through this order:

```bash
# 1. Check pods
kubectl get pods -n <namespace>

# 2. Check logs
kubectl logs -f deployment/<service> -n <namespace>

# 3. Check Kafka consumer
kubectl logs -f deployment/payment-service

# 4. Check database
# kubectl exec → psql → SELECT * FROM <table>

# 5. Check metrics
# /targets → /alerts
```

**Signal priority:**
- Logs → first signal
- Metrics → second signal
- Alerts → confirmation
- DB → final truth

---

## Related Notes

- [[02-Debugging-Playbook]] — Symptom → fix guide
- [[01-Release-Promotion-Rollback-Runbook]] — Release and rollback procedure
- [[01-Commands]] — Full commands reference
- [[02-Kubectl-Grep-Cheatsheet]] — kubectl filtering
