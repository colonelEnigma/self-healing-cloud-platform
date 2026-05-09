---
tags: [debugging, troubleshooting, kubernetes, kafka, prometheus, devops]
aliases: [Debugging Playbook, Debug Guide, Troubleshooting]
created: 2026-04-26
---

# 🧪 Debugging Playbook

> [[🧠 Self-Healing Cloud Platform]] · [[03-Operations-Playbook|Operations]] · [[01-Commands|Commands]] · [[02-Kubectl-Grep-Cheatsheet|kubectl+grep]]

---

## 🔥 Golden Rule #1

> **Always verify WHAT you are hitting.**
> Wrong service = 90% of bugs.

---

## Debug Mindset

| Layer | Always Check |
|---|---|
| API | Correct endpoint and port-forward |
| Kubernetes | Correct namespace |
| DB | Correct database |
| Kafka | Correct topic and consumer group |
| CI/CD | Correct image SHA |

**Process:**
1. Identify the symptom
2. Match with a case below
3. Apply fix
4. Verify with DB or logs — not just API response

---

## 1. API Not Working / Wrong Response

**Symptoms:** API returns success but DB not updated · wrong data returned · old data appears

```bash
# Step 1: Port-forward with explicit namespace
kubectl port-forward svc/order-service 3003:3003 -n dev

# Use DIFFERENT ports per env to avoid conflicts
kubectl port-forward svc/order-service 31003:3003 -n test

# Or use unique port to avoid all conflicts
kubectl port-forward pod/order-service-xxxx 39003:3003 -n dev

# Step 2: Verify namespace
kubectl get pods -n dev
kubectl get pods -n test
```

**Root causes:** Wrong service · wrong namespace · old port-forward still running

---

## 2. DB Not Updating

**Symptoms:** API says "Order created" but DB has no new records

```bash
# Query DB directly
kubectl exec -it postgres-postgresql-0 -n default -- \
  psql -U admin -d orderdb -c "SELECT * FROM orders ORDER BY id DESC LIMIT 10;"

# Check DB connection config
kubectl get deploy order-service -n dev -o yaml | grep DB_
```

**Root causes:** Wrong service hit · wrong DB_HOST · multiple environments sharing same DB

---

## 3. Kafka Not Working

**Symptoms:** Order created but payment/search not updated · no event processing

```bash
# Check topics exist
kubectl exec -it deployment/kafka -n default -- \
  kafka-topics --bootstrap-server localhost:9092 --list

# Expected topics (with env isolation):
# order_created_dev
# order_created_test
# order_created_dlq_dev
# order_created_dlq_test

# Check consumer groups
kubectl exec -it deployment/kafka -n default -- \
  kafka-consumer-groups --bootstrap-server localhost:9092 --list

# Check consumer logs
kubectl logs -f deployment/payment-service -n dev
kubectl logs -f deployment/payment-service -n test
```

**Env isolation check:**
```
dev → order_created_dev    ← must NOT mix
test → order_created_test  ← must NOT mix
```

**Root causes:** Topic mismatch · consumer group collision · hardcoded topic name

**Fix:** Use env vars — `ORDER_CREATED_TOPIC=order_created`

---

## 4. Messages Not Going to DLQ

**Symptoms:** Errors happening but DLQ is empty

```bash
# Verify DLQ metric
increase(kafka_dlq_messages_total[5m])
```

**Test by injecting error:**
```js
if (orderId) {
  throw new Error("DLQ test error");
}
```

**Root causes:** Error not thrown correctly · retry not exhausted · DLQ function not called

---

## 5. Pod Not Starting (CrashLoopBackOff / Pending)

```bash
kubectl logs <pod-name> -n <namespace>
kubectl describe pod <pod-name> -n <namespace>
```

**DB connection failed:**
```
getaddrinfo ENOTFOUND postgres
```
Fix:
```yaml
DB_HOST: postgres.default.svc.cluster.local
```

**Kafka connection failed:**
```
ENOTFOUND kafka
```
Fix:
```yaml
KAFKA_BROKER: kafka.default.svc.cluster.local:9092
```

---

## 6. Deployment Stuck (Rollout Issue)

**Symptoms:** `Waiting for deployment... 0 replicas available`

```bash
kubectl rollout status deployment/<service> -n <namespace>
kubectl get pods -n <namespace>

# Free resources if cluster is full
kubectl scale deployment <service> -n default --replicas=0
```

---

## 7. Prometheus Not Showing Targets

**Symptoms:** `/targets` page empty or services DOWN

```bash
# Check metrics endpoint manually
curl http://payment-service:4000/metrics
```

Check prometheus config:
```yaml
metrics_path: /metrics
```

---

## 8. Alert Goes Pending but Never Fires

**Symptoms:** Alert appears → disappears without firing

**Cause:** Condition not true long enough for `for:` duration

**Fix:**
```yaml
expr: increase(kafka_processing_errors_total[5m]) > 0
for: 0m
```

Once confirmed, raise `for:` duration.

---

## 9. Alerts Not Showing in Prometheus

**Symptoms:** `/rules` page empty

```bash
# Check values applied
helm get values prometheus

# Inspect rules inside pod
kubectl exec -it deploy/prometheus-server -c prometheus-server -- \
  cat //etc/config/alerting_rules.yml
```

---

## 10. Slack Alerts Not Working

**Symptoms:** Alerts firing in Prometheus but no Slack message

```bash
kubectl logs statefulset/prometheus-alertmanager
```

Check config has:
```yaml
slack_api_url: "<webhook-url>"
```

---

## 11. Kubernetes Service Not Accessible

**Symptoms:** No external IP · cannot access service

```bash
kubectl get svc
```

If `EXTERNAL-IP` is missing:
```bash
kubectl port-forward svc/prometheus-server 9090:80
```

Or change service type:
```yaml
type: LoadBalancer
```

---

## 12. CI/CD Image Mismatch

**Symptoms:** Logs show old behavior · new changes not visible

```bash
# Check currently deployed image
kubectl get deployment <service> -o jsonpath="{.spec.template.spec.containers[0].image}"

# Force update with correct SHA
kubectl set image deployment/<service> <container>=<image>:<sha>
```

---

## 13. Using `latest` Tag (BIG MISTAKE)

**Problem:** No rollback · no traceability · debugging impossible

**Fix:** Always use Git SHA tags.

---

## 14. Environment Confusion (dev vs test)

**Symptoms:** Test uses dev data · same records appear in both

**Cause:** Shared DB or Kafka topic

**Fix:**
- Use different DB names per env (`orderdb_dev`, `orderdb_test`)
- OR use different Kafka topics (`order_created_dev`, `order_created_test`)
- OR accept shared DB in early stage (document it)

---

## 15. Changes Not Reflecting After Code Update

**Symptoms:** Code changed but behavior unchanged

```bash
docker build --no-cache -t service-name .
docker push <ECR_URL>
kubectl rollout restart deployment/service-name
```

---

## 16. Helm Upgrade Not Applying

```bash
helm upgrade prometheus prometheus-community/prometheus -f prometheus-values.yaml
helm get values prometheus
```

---

## Full Flow Test (Best Check)

When unsure, run the full flow:

1. Create user
2. Create order
3. Check DBs:
   - `orderdb`
   - `paymentdb`
   - `searchdb`

Expected:
```
API → order-service → Kafka → payment-service / search-service → DB
```

---

## Step-by-Step Debug Sequence

```bash
# 1. Check pods
kubectl get pods -n <namespace>

# 2. Check logs
kubectl logs -f deployment/<service> -n <namespace>

# 3. Check services
kubectl get svc -n <namespace>

# 4. Check metrics
# /targets  →  /alerts

# 5. Query DB
kubectl exec -it postgres-postgresql-0 -n default -- psql -U admin -d <db>
```

**Signal priority:**
- Logs → first signal
- Metrics → second signal
- Alerts → confirmation
- DB → final truth

---

## Golden Rules

- ❌ Never assume → always verify
- ❌ Never trust only the API response
- ❌ Never use `latest` tag
- ✅ Always check the DB to confirm
- ✅ Always isolate environments

> Most bugs = wrong environment / wrong service / wrong config.

---

## Related Notes

- [[01-Release-Promotion-Rollback-Runbook]] — Release and rollback procedure
- [[03-Operations-Playbook]] — Kafka, DB, Prometheus workflows
- [[01-Commands]] — All commands
- [[02-Kubectl-Grep-Cheatsheet]] — Filtering and live debugging
