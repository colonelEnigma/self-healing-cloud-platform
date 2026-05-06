# Repository Guidelines

## Current Project State

This project is a self-healing cloud platform running on EKS with `dev` and `prod` application namespaces. Shared infrastructure remains in `default`, including Kafka, Zookeeper, PostgreSQL, Prometheus, Alertmanager, and healer-service. Jenkins is the active delivery engine, using Buildah builds, short Git SHA image tags, Git-controlled promotion, and explicit rollback.

Recent verified state:

- Frontend source of truth now lives in the separate repo `C:\Users\ranja\Documents\projects\cloudpulse-ui`. Canonical plan: `.context/PlanFrontendShadcn.md`. Runbook: `docs/cloudpulse-ui-runbook.md`.
  - Auth: JWT stored in `localStorage`.
  - Local dev routing model (match existing platform ports):
    - Shop APIs call Docker Compose services directly (users `3000`, orders `3003`, payment `4000`, products `3005`, search `5003`).
    - `/api/control-plane/*` proxies to prod/EKS through local ingress tunnel `http://localhost:18080`.
    - `/api/control-plane/ai/*` proxies to local `control-plane-service` on `http://localhost:7100` (LM Studio).
  - Production build invariant: keep API bases relative (`""`); do not embed any `localhost:*` URLs.
  - Sequencing: complete shop pages (Home + Login + Signup + Catalog/Product list) before starting any Control Panel UI pages.
  - Control Panel non-negotiables: prod-only, live-data-only, allowlist-only; only mutation is typed-confirmed scale to replicas `0` or `1` with audit logging; no secret access; no delete permissions.

- Prometheus and Grafana alignment is intentionally focused on `dev` and `prod` only.
- `prometheus-values.yaml` is the active source of truth for Prometheus scrape config, alert rules, and Alertmanager config.
- Grafana dashboard provisioning is versioned through `k8s/monitoring/grafana-values.yaml` and `k8s/monitoring/grafana/`; the provisioned dashboard is `Self-Healing Cloud Platform`.
- `k8s/monitoring/alert-rules.yaml` is legacy/backup unless explicitly reused.
- healer-service is allowed to operate in `dev` and `prod`.
- Prod self-healing was verified by scaling `prod/payment-service` to `0`; healer scaled it back to `1` and recorded a successful audit entry.
- The previously exposed Slack webhook has been rotated; any future exposure requires immediate rotation.
- Current Jenkins service delivery builds changed services and deploys to `dev`; promotion to `prod` is controlled by `jenkins/promotion.env`.
- Git-controlled prod promotion through `jenkins/promotion.env` was tested successfully, and promoted services were verified healthy.
- Multi-service prod promotion is supported via service names only in `jenkins/promotion.env`, for example `PROMOTE_SERVICES=order-service,payment-service`; Jenkins reads immutable image tags from `dev` and promotes those images to `prod`.
- `test` environment was decommissioned in repository config on 2026-05-03. Current pipeline behavior is deploy-to-`dev`, then promote `dev` image tags to `prod`.
- Jenkins runs automatically every 2 minutes, so promotion/rollback detection is based on changed files since the previous successful commit when Jenkins provides that commit.
- Current implementation focus is Log Analyzer, AI Cost Advisor, and RAG over runbooks/docs/incidents with MCP integration; canonical backend/shared context is `.context/backend-context.md`.
- Chaos planning source of truth: `.context/control-plane-chaos-plan.md`.
- Chaos scenario status: only `ScaleToZero` is currently executable in Phase 1; the rest of the scenario catalog entries are defined but intentionally disabled placeholders.
- Frontend direction: treat the `cloudpulse-ui` shadcn/Tailwind UI as the primary frontend going forward. Any legacy/previous frontend implementations are not the default target for new UI work unless explicitly requested.
- `user-service` role support is implemented and locally verified; login/profile expose `role`.
- `services/control-plane-service` is implemented and deployed in `monitoring`; it exposes `/health`, `/metrics`, and admin-guarded `/api/control-plane/*` live read APIs plus guarded scale `0/1` with audit logging.
- `services/control-plane-service` also exposes read-only admin AI assistant endpoints for local LM Studio demos: `GET /api/control-plane/ai/status` and `POST /api/control-plane/ai/chat`, using model id `google/gemma-3-4b`.
- Local behavior note: `/api/control-plane/status` can return `ready` without live kube connectivity, while endpoints like `/overview` require real Kubernetes access.
- The Control Panel must remain prod-focused and use live data, not mocks.
- Control Panel mutation is limited to typed-confirmed scale `0` or `1` for allowlisted prod app deployments.
- Planned `control-plane-service` RBAC must stay narrow: prod read diagnostics/logs and patch deployments only, with no secret access and no delete permissions.

## Operational Rules

- Prefer Bash commands in user-facing instructions unless the user explicitly asks for PowerShell.
- Do not print, commit, or reuse secrets, including Slack webhooks, kubeconfigs, DB passwords, AWS keys, GitHub tokens, Jenkins secrets, or Kubernetes tokens.
- Alertmanager does not expand `${SLACK_WEBHOOK_URL}` inside its config file. When applying `prometheus-values.yaml`, pass the resolved secret through Helm or use a safer secret-management approach.
- Grafana PostgreSQL datasource credentials must come from Secret `grafana-postgres-datasource` in namespace `monitoring`; do not commit datasource credentials.
- Grafana persistence is currently disabled; commit dashboard changes to Git instead of relying on UI-only edits.
- Jenkins rollback and promotion operations are documented in `docs/rollback-runbook.md` and `docs/jenkins-promotion-runbook.md`.
- Use Git-controlled prod promotion through `jenkins/promotion.env`; do not rely on Jenkins UI approval buttons unless that flow is explicitly restored and tested.
- Use `.context/backend-context.md` as the canonical backend/shared context. Frontend live integration plan and runbook references are maintained in the `cloudpulse-ui` repo.
- For Control Plane work, do not grant secret access, delete permissions, namespace permissions, pod deletion, Kafka mutation, PostgreSQL application-data mutation, or broad cluster permissions.
- If Helm conflicts with Alertmanager after manual `kubectl edit`, use the documented `--server-side=true --force-conflicts` approach.
- Keep healer RBAC narrow: `get` and `patch` on deployments only in allowed namespaces.
- Do not automate Kafka, PostgreSQL, PVC, namespace, or pod deletion operations.

## Project Structure & Module Organization

This repository contains a self-healing cloud platform built from Node.js microservices and Kubernetes infrastructure. Service code lives under `services/`: `user-service`, `order-service`, `payment-service`, `product-service`, `search-service`, `healer-service`, and `control-plane-service`. Each service keeps runtime code in `src/`, usually split into `routes/`, `controllers/`, `middleware/`, `metrics/`, `config/`, or `kafka/`. Frontend implementation now lives in the separate `cloudpulse-ui` repo.

Infrastructure and delivery assets are separate: `k8s/` contains Kubernetes manifests, `docker/` local observability and database support files, `jenkins/` and `Jenkinsfile` CI/CD behavior, `argocd/` GitOps config, `docs/` architecture notes, and `helm-archive/` older Helm charts.

## Build, Test, and Development Commands

- `docker-compose up --build`: starts services, databases, Kafka, and observability.
- `cd services/<service-name> && npm install`: installs dependencies for one service.
- `npm run dev`: runs most services with `nodemon` for local development.
- `npm start`: runs a service with `node src/server.js`.
- `docker-compose up --build postgres user-service control-plane-service`: starts the local role-aware user service and Control Plane service container for local API testing.
- `curl http://localhost:7100/health`: verifies local `control-plane-service` health.
- `kubectl apply -f k8s/<component>/`: applies Kubernetes manifests.
- `kubectl rollout status deployment/<service-name> -n dev`: verifies a deployment rollout.
- `helm upgrade prometheus prometheus-community/prometheus -n default -f prometheus-values.yaml`: applies Prometheus/Alertmanager config.
- `kubectl apply -k k8s/monitoring/grafana`: applies the provisioned Grafana dashboard ConfigMap.
- `helm upgrade grafana grafana/grafana -n monitoring -f k8s/monitoring/grafana-values.yaml`: applies Grafana datasource and dashboard provisioning.
- `kubectl auth can-i patch deployments -n prod --as system:serviceaccount:default:healer-service`: verifies healer prod RBAC.

## Coding Style & Naming Conventions

Services use CommonJS Node.js (`require`, `module.exports`) and Express. Follow existing two-space JSON formatting and keep JavaScript semicolon use consistent with nearby code. Use kebab-case for service and deployment directories, camelCase for JavaScript variables/functions, and descriptive module names such as `orderRoutes.js`, `authMiddleware.js`, or `metricsMiddleware.js`.

Keep environment-specific names explicit. Local resources use `_local` suffixes for databases and Kafka topics; cluster resources use environment namespaces such as `dev` and `prod`.

## Testing Guidelines

No test framework or `npm test` script is currently committed. When adding tests, add the framework and script to the affected `package.json`, keep tests close to that service, and use names like `*.test.js` or `*.spec.js`. For infrastructure changes, validate manifests with `kubectl apply --dry-run=client -f <path>`.

## Commit & Pull Request Guidelines

Recent commits use short, imperative summaries such as `updating search routes` or `Add public path-based routing for dev and prod APIs`. Keep commits focused on one service or infrastructure area.

Pull requests should include a change summary, affected services or manifests, verification steps, linked issues, and screenshots or logs when UI, Grafana, Jenkins, or Kubernetes behavior changes. Call out environment variable, secret, namespace, image tag, or database/topic naming changes.

## Security & Configuration Tips

Do not commit real secrets, kubeconfigs, registry credentials, Slack webhooks, or production `.env` values. Prefer Kubernetes Secrets, Jenkins credentials, or local untracked `.env` files. Preserve immutable image tagging with Git SHAs for cluster deployments; use `:local` only for local development images.
