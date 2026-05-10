---
title: AWS Pause and Resume Runbook
tags:
  - aws
  - eks
  - operations
  - runbook
updated: 2026-05-10
---

# AWS Pause and Resume Runbook

Use this runbook to pause cloud costs safely and restart later without deleting core project state.

## Scope

- EKS workloads in `dev`, `prod`, `monitoring`, and `default`
- EKS managed node groups
- Optional standalone EC2 instances (for example Jenkins or Qdrant)

## Important Cost Note

EKS control plane itself cannot be paused. If the cluster exists, control-plane billing continues.

## Prerequisites

- `aws` CLI authenticated to the correct account/region
- `kubectl` context set to the target cluster
- Permission to scale deployments and update nodegroup config

## Step 1: Capture Current State (Before Pause)

```bash
kubectl get deploy -A -o wide
kubectl get nodes -o wide
aws eks list-nodegroups --cluster-name <CLUSTER_NAME>
```

Record current node group scaling values (`minSize`, `maxSize`, `desiredSize`) for restart.

## Step 2: Pause Kubernetes Workloads

```bash
kubectl scale deploy -n dev --all --replicas=0
kubectl scale deploy -n prod --all --replicas=0
kubectl scale deploy -n monitoring --all --replicas=0
kubectl scale deploy -n default --all --replicas=0
```

Verify:

```bash
kubectl get deploy -A
```

Expected: workloads show `0` desired/ready replicas.

## Step 3: Scale EKS Node Groups to Zero

Run once per node group:

```bash
aws eks update-nodegroup-config \
  --cluster-name <CLUSTER_NAME> \
  --nodegroup-name <NODEGROUP_NAME> \
  --scaling-config minSize=0,maxSize=<MAX_SIZE>,desiredSize=0
```

Verify:

```bash
aws eks describe-nodegroup \
  --cluster-name <CLUSTER_NAME> \
  --nodegroup-name <NODEGROUP_NAME> \
  --query "nodegroup.scalingConfig"
```

Expected: `desiredSize=0` and `minSize=0`.

## Step 4: Stop Standalone EC2 (Optional)

```bash
aws ec2 stop-instances --instance-ids <INSTANCE_ID_1> <INSTANCE_ID_2>
```

Verify:

```bash
aws ec2 describe-instances \
  --instance-ids <INSTANCE_ID_1> <INSTANCE_ID_2> \
  --query "Reservations[].Instances[].State.Name"
```

Expected: `stopping` then `stopped`.

## Resume Later

## Step 1: Start EC2 (If Used)

```bash
aws ec2 start-instances --instance-ids <INSTANCE_ID_1> <INSTANCE_ID_2>
```

## Step 2: Scale Node Groups Back Up

Use recorded values from Step 1:

```bash
aws eks update-nodegroup-config \
  --cluster-name <CLUSTER_NAME> \
  --nodegroup-name <NODEGROUP_NAME> \
  --scaling-config minSize=<MIN_SIZE>,maxSize=<MAX_SIZE>,desiredSize=<DESIRED_SIZE>
```

Wait until nodes are ready:

```bash
kubectl get nodes -w
```

## Step 3: Restore Workloads

Set replicas back to the normal values for each namespace/workload.

Example quick restore to `1` for app workloads:

```bash
kubectl scale deploy -n dev --all --replicas=1
kubectl scale deploy -n prod --all --replicas=1
kubectl scale deploy -n monitoring --all --replicas=1
kubectl scale deploy -n default --all --replicas=1
```

If specific services need different replica counts, set them explicitly per deployment.

## Step 4: Validation After Resume

```bash
kubectl get nodes
kubectl get pods -A
kubectl get ingress -A
kubectl get svc -A
```

Control-plane API spot check:

```bash
curl -i http://localhost:18080/api/control-plane/status
```

Expected: healthy node/workload state and reachable control-plane routes.
