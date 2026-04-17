# Self-Healing Cloud Platform

## Overview

Self-Healing Cloud Platform is a distributed microservices system designed to automatically monitor, analyze, and optimize itself using observability, reliability engineering (SRE), and AI-driven operations (AIOps).

The platform demonstrates how modern cloud systems can detect failures, recover automatically, and optimize infrastructure usage.

## Architecture

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
Event Streaming

↓
Data Layer

* PostgreSQL
* Redis
* DynamoDB

↓
Observability

* Prometheus
* Grafana
* ELK Stack
* Jaeger

↓
Platform Services

* Cost Optimizer
* Reliability Controller
* Developer Platform

↓
AI Services

* Log Analyzer
* Incident Assistant
* AI Cost Advisor

## Goals

* Build a production-style cloud platform
* Implement microservices architecture
* Apply Site Reliability Engineering practices
* Implement observability and monitoring
* Introduce AI-driven operations

## Tech Stack

* Node.js
* Docker
* Kubernetes
* AWS
* Kafka
* PostgreSQL
* Redis
* DynamoDB
* Prometheus & Grafana
* ELK Stack
* Jaeger

## Project Phases

1. Architecture & Planning
2. Microservices Development
3. Kubernetes Infrastructure
4. Event Streaming
5. Observability Stack
6. Reliability Engineering
7. AI / AIOps Layer
8. Self-Healing Automation
9. CI/CD Automation
10. Chaos Testing & Scaling


## Databases

1. user-service → userdb
2. order-service → orderdb
3. payment-service → paymentdb
4. product-service → productdb
5. search-service → searchdb