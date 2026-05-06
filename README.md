# 🧠 Self-Healing Cloud Platform

> Production-grade Kubernetes platform with event-driven microservices, full observability, and a roadmap toward automated self-healing.

![Status](https://img.shields.io/badge/status-active-brightgreen)
![Platform](https://img.shields.io/badge/platform-Kubernetes%20%28EKS%29-blue)
![Stack](https://img.shields.io/badge/stack-Node.js%20%7C%20Kafka%20%7C%20PostgreSQL-orange)
![Stage](https://img.shields.io/badge/stage-Self--Monitoring-yellow)

---

## 📖 Overview

A production-grade, cloud-native platform built to demonstrate how modern distributed systems can **monitor themselves**, **detect failures automatically**, and eventually **recover without manual intervention**.

The platform runs five independent microservices communicating through REST APIs and Kafka events, deployed on AWS EKS with a full observability stack. When something breaks, the system detects it in seconds and fires an alert — and is actively being built to fix itself.

---

## ✨ Features

- **Event-driven architecture** — order events flow through Kafka to payment and search consumers asynchronously
- **Full observability** — Prometheus metrics, Grafana dashboards, Alertmanager rules, Slack notifications
- **Reliability patterns** — Kafka retry logic and dead letter queue (DLQ) ensure failures are never silently dropped
- **Environment isolation** — `dev` / `prod` namespaces with separate topic and DB naming
- **Immutable deployments** — Git-SHA image tagging for full traceability and rollback support
- **Structured runbooks** — documented release, promotion, rollback, and debugging playbooks

---

## 🏗️ Architecture

```
User / Client
     │
     ▼
Ingress / API
     │
     ├──► user-service      ──► userdb
     ├──► order-service     ──► orderdb ──► Kafka
     └──► product-service   ──► productdb
                                   │
                          ┌────────┴────────┐
                          ▼                 ▼
                   payment-service    search-service
                       │                   │
                    paymentdb          searchdb + Redis

Prometheus ──► all services ──► Alertmanager ──► Slack
Grafana    ──► Prometheus
```

### Order Lifecycle

1. User calls `POST /api/orders`
2. `order-service` validates, saves to `orderdb`, publishes `ORDER_CREATED` to Kafka
3. `payment-service` consumes → processes payment → writes to `paymentdb`
4. `search-service` consumes → updates search index → updates Redis cache
5. On failure → retry → DLQ → alert fires → *(healer-service, coming soon)*

---

## 🧩 Microservices

| Service | Port | Responsibility | DB |
|---|---|---|---|
| user-service | 3000 | Auth, registration, JWT | userdb |
| order-service | 3003 | Create orders, publish events | orderdb |
| payment-service | 4000 | Consume events, process payments | paymentdb |
| product-service | 3005 | Product data and validation | productdb |
| search-service | 5003 | Consume events, cache, index | searchdb + Redis |

---

## 📊 Observability Stack

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

## 🚀 Roadmap

| Phase | Name | Status |
|---|---|---|
| 1 | Foundation — EKS, Kafka, PostgreSQL, Microservices | ✅ Done |
| 2 | Observability — Prometheus + Grafana | ✅ Done |
| 3 | Alerting — Alertmanager + Slack | ✅ Done |
| 4 | Versioning — Git-SHA tags, immutable images | 🔜 Current |
| 5 | Environments — dev / prod isolation | 🔜 Next |
| 6 | CI/CD — Jenkins build once, promote through envs | 🔜 Upcoming |
| 7 | Rollback — redeploy previous SHA | 🔜 Upcoming |
| 8 | Access Layer — custom domain, HTTPS, Ingress | 🔜 Upcoming |
| 9 | Control Plane UI — view services, alerts, restart | 🔜 Future |
| 10 | Self-Healing — alert → automated recovery action | 🔜 Future |
| 11 | AI Layer — anomaly detection, cost optimization | ⏳ Future |
| 12 | Control Plane Service — admin APIs, guarded actions, audit | ✅ Done |

> **Current focus:** Phase 4 — replacing `:latest` tags with immutable Git-SHA image tags to enable rollback and traceability.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Services | Node.js |
| Messaging | Apache Kafka + Zookeeper |
| Databases | PostgreSQL 15 (per-service) · Redis |
| Orchestration | Kubernetes (AWS EKS) |
| Containers | Docker |
| Package management | Helm |
| Observability | Prometheus · Grafana · Alertmanager |
| Registry | AWS ECR |
| CI/CD *(upcoming)* | Jenkins |

---

## ⚙️ Local Development

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

## 🚢 Deploy to Kubernetes

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

## 📦 Release & Rollback

The platform follows a **build once, promote everywhere** model:

```
git push → Jenkins → build image → deploy to dev → promote to prod
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

## 📁 Project Structure

```
self-healing-cloud-platform/
├── services/
│   ├── user-service/
│   ├── order-service/
│   ├── payment-service/
│   ├── product-service/
│   └── search-service/
├── k8s/
│   ├── user-service/
│   ├── order-service/
│   ├── payment-service/
│   ├── product-service/
│   ├── search-service/
│   ├── postgres/
│   └── monitoring/
├── docker-compose.yml
└── README.md
```

---

## 🧠 Key Design Principles

- **One service → one responsibility → one database**
- **Kafka for all async communication** — REST for sync only
- **Observability first** — metrics and alerts before features
- **Version before automation** — immutable tags before CI/CD or self-healing
- **Configuration over code** — only config differs between environments, never code

---

## 👤 Author

**Praveen Ranjan**
- GitHub: [@colonelEnigma](https://github.com/colonelEnigma)
- LinkedIn: [https://www.linkedin.com/in/ranjanpraveen/]
