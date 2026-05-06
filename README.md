# ðŸ§  Self-Healing Cloud Platform

> Production-grade Kubernetes platform with event-driven microservices, full observability, and a roadmap toward automated self-healing.

![Status](https://img.shields.io/badge/status-active-brightgreen)
![Platform](https://img.shields.io/badge/platform-Kubernetes%20%28EKS%29-blue)
![Stack](https://img.shields.io/badge/stack-Node.js%20%7C%20Kafka%20%7C%20PostgreSQL-orange)
![Stage](https://img.shields.io/badge/stage-Self--Monitoring-yellow)

---

## ðŸ“– Overview

A production-grade, cloud-native platform built to demonstrate how modern distributed systems can **monitor themselves**, **detect failures automatically**, and eventually **recover without manual intervention**.

The platform runs five independent microservices communicating through REST APIs and Kafka events, deployed on AWS EKS with a full observability stack. When something breaks, the system detects it in seconds and fires an alert â€” and is actively being built to fix itself.

---

## âœ¨ Features

- **Event-driven architecture** â€” order events flow through Kafka to payment and search consumers asynchronously
- **Full observability** â€” Prometheus metrics, Grafana dashboards, Alertmanager rules, Slack notifications
- **Reliability patterns** â€” Kafka retry logic and dead letter queue (DLQ) ensure failures are never silently dropped
- **Environment isolation** â€” `dev` / `prod` namespaces with separate topic and DB naming
- **Immutable deployments** â€” Git-SHA image tagging for full traceability and rollback support
- **Structured runbooks** â€” documented release, promotion, rollback, and debugging playbooks

---

## ðŸ—ï¸ Architecture

```
User / Client
     â”‚
     â–¼
Ingress / API
     â”‚
     â”œâ”€â”€â–º user-service      â”€â”€â–º userdb
     â”œâ”€â”€â–º order-service     â”€â”€â–º orderdb â”€â”€â–º Kafka
     â””â”€â”€â–º product-service   â”€â”€â–º productdb
                                   â”‚
                          â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”
                          â–¼                 â–¼
                   payment-service    search-service
                       â”‚                   â”‚
                    paymentdb          searchdb + Redis

Prometheus â”€â”€â–º all services â”€â”€â–º Alertmanager â”€â”€â–º Slack
Grafana    â”€â”€â–º Prometheus
```

### Order Lifecycle

1. User calls `POST /api/orders`
2. `order-service` validates, saves to `orderdb`, publishes `ORDER_CREATED` to Kafka
3. `payment-service` consumes â†’ processes payment â†’ writes to `paymentdb`
4. `search-service` consumes â†’ updates search index â†’ updates Redis cache
5. On failure â†’ retry â†’ DLQ â†’ alert fires â†’ *(healer-service, coming soon)*

---

## ðŸ§© Microservices

| Service | Port | Responsibility | DB |
|---|---|---|---|
| user-service | 3000 | Auth, registration, JWT | userdb |
| order-service | 3003 | Create orders, publish events | orderdb |
| payment-service | 4000 | Consume events, process payments | paymentdb |
| product-service | 3005 | Product data and validation | productdb |
| search-service | 5003 | Consume events, cache, index | searchdb + Redis |

---

## ðŸ“Š Observability Stack

| Tool | Role |
|---|---|
| Prometheus | Scrapes metrics from all services |
| Grafana | Live dashboards (service health, Kafka, DB, alerts) |
| Alertmanager | Routes alerts to Slack |
| Slack | Real-time notifications |

### Metrics Tracked

- `http_requests_total` / `http_request_duration_seconds`
- `kafka_messages_consumed_total`
- `kafka_processing_errors_total`
- `kafka_retry_attempts_total`
- `kafka_dlq_messages_total`

### Alert Rules

| Alert | Trigger |
|---|---|
| `ServiceDown` | Pod unavailable |
| `KafkaProcessingErrorsHigh` | Error rate spike |
| `KafkaDLQMessagesDetected` | Messages in dead letter queue |
| `HighKafkaProcessingLatency` | Latency threshold exceeded |

---

## ðŸš€ Roadmap

| Phase | Name | Status |
|---|---|---|
| 1 | Foundation â€” EKS, Kafka, PostgreSQL, Microservices | âœ… Done |
| 2 | Observability â€” Prometheus + Grafana | âœ… Done |
| 3 | Alerting â€” Alertmanager + Slack | âœ… Done |
| 4 | Versioning - Git-SHA tags, immutable images | Done |
| 5 | Environments - dev / prod isolation | Done |
| 6 | CI/CD - Jenkins build once, promote through envs | Done |
| 7 | Rollback - redeploy previous SHA | Done |
| 8 | Access Layer â€” custom domain, HTTPS, Ingress | ðŸ”œ Upcoming |
| 9 | Control Plane UI â€” view services, alerts, restart | ðŸ”œ Future |
| 10 | Self-Healing â€” alert â†’ automated recovery action | ðŸ”œ Future |
| 11 | AI Layer â€” anomaly detection, cost optimization | â³ Future |
| 12 | Control Plane Service â€” admin APIs, guarded actions, audit | âœ… Done |

> **Current focus:** Log Analyzer, AI Cost Advisor, and RAG over runbooks/docs/incidents with MCP-aligned integration.

---

## ðŸ› ï¸ Tech Stack

| Layer | Technology |
|---|---|
| Services | Node.js |
| Messaging | Apache Kafka + Zookeeper |
| Databases | PostgreSQL 15 (per-service) Â· Redis |
| Orchestration | Kubernetes (AWS EKS) |
| Containers | Docker |
| Package management | Helm |
| Observability | Prometheus Â· Grafana Â· Alertmanager |
| Registry | AWS ECR |
| CI/CD | Jenkins |

---

## âš™ï¸ Local Development

### Prerequisites

- Docker + Docker Compose
- Node.js
- `kubectl` configured for your cluster

### Run Locally

```bash
git clone https://github.com/<your-username>/self-healing-cloud-platform.git
cd self-healing-cloud-platform

# Start full local stack
docker-compose up --build
```

Local services use `_local` suffix for DBs and Kafka topics to stay isolated from cluster environments.

### Naming Conventions (Local vs Cluster)

| Config | Local | Cluster |
|---|---|---|
| Image tag | `payment-service:local` | `payment-service:<git-sha>` |
| DB name | `paymentdb_local` | `paymentdb` |
| Kafka topic | `order_created_local` | `order_created` |

---

## ðŸš¢ Deploy to Kubernetes

```bash
# Apply manifests
kubectl apply -f k8s/user-service/
kubectl apply -f k8s/order-service/
kubectl apply -f k8s/payment-service/
kubectl apply -f k8s/product-service/
kubectl apply -f k8s/search-service/

# Verify rollout
kubectl rollout status deployment/payment-service -n dev
kubectl logs deployment/payment-service -n dev --tail=50
```

---

## ðŸ“¦ Release & Rollback

The platform follows a **build once, promote everywhere** model:

```
git push â†’ Jenkins â†’ build image â†’ deploy to dev â†’ promote to prod
```

To rollback:

```bash
kubectl set image deployment/<service> \
  <service>=<ecr-url>/<service>:<previous-sha> \
  -n prod

kubectl rollout status deployment/<service> -n prod
```

See the [Jenkins Promotion Runbook](./docs/jenkins-promotion-runbook.md) and [Rollback Runbook](./docs/rollback-runbook.md) for details.

---

## ðŸ“ Project Structure

```
self-healing-cloud-platform/
â”œâ”€â”€ services/
â”‚   â”œâ”€â”€ user-service/
â”‚   â”œâ”€â”€ order-service/
â”‚   â”œâ”€â”€ payment-service/
â”‚   â”œâ”€â”€ product-service/
â”‚   â””â”€â”€ search-service/
â”œâ”€â”€ k8s/
â”‚   â”œâ”€â”€ user-service/
â”‚   â”œâ”€â”€ order-service/
â”‚   â”œâ”€â”€ payment-service/
â”‚   â”œâ”€â”€ product-service/
â”‚   â”œâ”€â”€ search-service/
â”‚   â”œâ”€â”€ postgres/
â”‚   â””â”€â”€ monitoring/
â”œâ”€â”€ docker-compose.yml
â””â”€â”€ README.md
```

---

## ðŸ§  Key Design Principles

- **One service â†’ one responsibility â†’ one database**
- **Kafka for all async communication** â€” REST for sync only
- **Observability first** â€” metrics and alerts before features
- **Version before automation** â€” immutable tags before CI/CD or self-healing
- **Configuration over code** â€” only config differs between environments, never code

---

## ðŸ‘¤ Author

**Praveen Ranjan**
- GitHub: [@colonelEnigma](https://github.com/colonelEnigma)
- LinkedIn: [https://www.linkedin.com/in/ranjanpraveen/]
