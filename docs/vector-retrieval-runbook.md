# Vector Retrieval Runbook (Phase 4)

Last updated: 2026-05-09
Scope: control-plane similar incident retrieval with Postgres + Qdrant

## Architecture

- Postgres (`incident_summaries`) is source-of-truth for incident metadata.
- Qdrant is the vector index for semantic similarity ranking.
- Control-plane retrieval endpoint:
  - `GET /api/control-plane/incidents/:service/similar`

## Security and Scope Guardrails

- Admin-only access (existing JWT + admin middleware).
- Prod-only service scope via existing control-plane allowlist.
- Allowlist-only services (`user-service`, `order-service`, `payment-service`, `product-service`, `search-service`).
- Retrieval endpoint is read-only.
- Never return secrets in logs/responses.

## Step 2: Provision Qdrant on AWS EC2 (low-cost aware)

Recommended baseline:
- Instance: `t3.micro` (or `t2.micro` where free-tier applies).
- OS: Ubuntu 22.04 LTS.
- Disk: 20 GB gp3.
- Network: private subnet preferred; if public subnet is used, restrict Security Group source CIDR tightly.

Security Group minimum rules:
- Inbound TCP `6333` from control-plane egress source only.
- Optional SSH `22` from operator IP only.
- Deny `6333` from `0.0.0.0/0`.

Install and run Qdrant via Docker on EC2:

```bash
sudo apt-get update
sudo apt-get install -y docker.io
sudo systemctl enable docker
sudo systemctl start docker
sudo mkdir -p /opt/qdrant/storage
sudo docker run -d --name qdrant \
  -p 6333:6333 \
  -v /opt/qdrant/storage:/qdrant/storage \
  --restart unless-stopped \
  qdrant/qdrant:v1.12.5
```

Optional API key hardening:

```bash
sudo docker rm -f qdrant
sudo docker run -d --name qdrant \
  -p 6333:6333 \
  -v /opt/qdrant/storage:/qdrant/storage \
  -e QDRANT__SERVICE__API_KEY="replace-with-strong-key" \
  --restart unless-stopped \
  qdrant/qdrant:v1.12.5
```

Health check from trusted source:

```bash
curl http://<qdrant-host>:6333/healthz
```

Expected output:
- HTTP `200`
- Body includes health status indicator (`ok`).

## Control Plane Env Configuration

Set these for `control-plane-service`:

```bash
VECTOR_RETRIEVAL_ENABLED=true
QDRANT_URL=http://<qdrant-host>:6333
QDRANT_API_KEY=<optional-if-enabled>
QDRANT_COLLECTION=incident_summaries_prod
QDRANT_DISTANCE=Cosine
EMBEDDING_DIMENSION=2560
EMBEDDING_PROVIDER_ORDER=openrouter

LOCAL_EMBEDDING_BASE_URL=http://localhost:1234/v1
LOCAL_EMBEDDING_MODEL=nomic-embed-text-v1.5

OPENAI_API_KEY=<optional-fallback>
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

OPENROUTER_API_KEY=<optional-fallback>
OPENROUTER_EMBEDDING_MODEL=qwen/qwen3-embedding-4b
SIMILAR_SYNC_LIMIT=5
```

## Backfill and Sync

Backfill embeddings for allowlisted services:

```bash
cd services/control-plane-service
npm run backfill:incident-embeddings
```

Optional scoped backfill:

```bash
INCIDENT_EMBEDDING_SERVICES=payment-service INCIDENT_EMBEDDING_LIMIT=100 npm run backfill:incident-embeddings
```

Expected output:
- Lines like:
  - `[incident-embedding-backfill] service=payment-service synced=NN failed=0`

## Endpoint Validation

Assumptions:
- `CONTROL_PLANE_BASE=http://localhost:18080`
- `ADMIN_JWT` is valid admin token.

Fetch similar incidents for latest anchor:

```bash
curl "$CONTROL_PLANE_BASE/api/control-plane/incidents/payment-service/similar?limit=5" \
  -H "Authorization: Bearer $ADMIN_JWT"
```

Fetch similar incidents for explicit anchor execution:

```bash
curl "$CONTROL_PLANE_BASE/api/control-plane/incidents/payment-service/similar?limit=5&anchorExecutionId=<executionId>" \
  -H "Authorization: Bearer $ADMIN_JWT"
```

Expected output:
- HTTP `200`
- `readOnly: true`
- `anchor` object populated when summaries exist
- `results[]` sorted by semantic score
- `vector.embeddingProvider` shows successful provider used
- `vector.syncStatus` includes `synced`, `failed`, and sampled `failures[]` for operator debugging

Guardrail check:

```bash
curl "$CONTROL_PLANE_BASE/api/control-plane/incidents/unknown-service/similar" \
  -H "Authorization: Bearer $ADMIN_JWT"
```

Expected output:
- HTTP `400` allowlist validation error.

## Rollback Notes

- To disable vector retrieval safely:
  - `VECTOR_RETRIEVAL_ENABLED=false`
- Retrieval endpoint then returns configuration-unavailable error without mutating incident metadata.
- Existing incident timeline and ops advice endpoints continue to use Postgres-only source paths.

## Known Operational Notes

- If Qdrant collection already exists, create/ensure behavior is idempotent and should not fail requests.
- If similar endpoint is slow, reduce request-time sync using `SIMILAR_SYNC_LIMIT` and run backfill separately.
- `anchorExecutionId` must be an integer execution ID; scenario IDs like `ScaleToZero` are invalid for this query parameter.
