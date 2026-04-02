# System Architecture

## Overview

The Self-Healing Cloud Platform is a distributed microservices system designed to demonstrate modern cloud-native architecture with built-in reliability, observability, and AI-driven operations.

The platform simulates a production environment where multiple microservices interact through APIs and event streams while the system continuously monitors itself and performs automated optimization.

---

## High Level Flow

Users
↓
API Gateway
↓
Kubernetes Cluster

Microservices

* user-service
* order-service
* payment-service
* search-service

↓
Event Streaming (Kafka)

↓
Data Layer

* PostgreSQL
* Redis
* DynamoDB

↓
Observability Stack

* Prometheus (metrics)
* Grafana (dashboards)
* ELK Stack (logs)
* Jaeger (tracing)

↓
Platform Services

* Reliability Controller
* Cost Optimizer

↓
AI Services

* Log Analyzer
* Incident Assistant
* AI Cost Advisor

---

## Key Architecture Principles

### Microservices

Each service runs independently and communicates through APIs and events.

### Event Driven Design

Services publish and consume events using Kafka.

### Observability First

Metrics, logs, and traces are collected from all services.

### Reliability Engineering

The platform implements SRE practices such as health checks, retries, and auto-scaling.

### AI Operations

AI services analyze system telemetry to detect incidents and recommend optimizations.
