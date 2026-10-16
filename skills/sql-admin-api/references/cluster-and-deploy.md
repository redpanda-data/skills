# Oxla Cluster Topology and Deployment

## Cluster Model

An Oxla cluster consists of one **leader** node and zero or more **worker** nodes. The leader is designated by setting `leader_election.leader_name` to the `host_name` of the intended leader. Every node in the cluster must have:

- The same `network.cluster_name` value
- A unique `network.host_name` value
- `leader_election.leader_name` set to the hostname of the leader node

A node whose `host_name` matches `leader_name` boots as the leader. All other nodes boot as workers and discover the leader through the inter-node port (default 5771).

```
                    Client (psql/JDBC)
                          |
                       port 5432
                          |
             ┌────────────┴────────────┐
             │       Leader Node       │
             │   cluster_name=cluster  │
             │   host_name=oxla_node_1 │
             │   leader_name=oxla_node_1│
             └──────────5771───────────┘
                    /           \
              5771 /             \ 5771
                  /               \
     ┌────────────┴───┐    ┌───────┴────────────┐
     │  Worker Node 2  │    │   Worker Node 3     │
     │  host_name=     │    │   host_name=        │
     │  oxla_node_2    │    │   oxla_node_3       │
     │  leader_name=   │    │   leader_name=      │
     │  oxla_node_1    │    │   oxla_node_1       │
     └─────────────────┘    └────────────────────┘
```

**Port summary per node:**

| Port | Purpose | Required externally? |
|------|---------|---------------------|
| 5432 | PostgreSQL client connections | Yes (for SQL clients) |
| 5770 | Slot (pipeline data) between nodes | Nodes only |
| 5771 | Inter-node discovery + heartbeat | Nodes only |
| 8080 | Prometheus metrics | Optional (monitoring) |
| 9090 | Admin API (ConnectRPC) | Optional (ops) |

---

## Single-Node Deployment

> **No public image.** Redpanda SQL is offered through BYOC and the Agentic Data Plane, and there is
> no publicly pullable container image for running it yourself. The Docker examples in this skill
> illustrate the engine's runtime configuration with a `<redpanda-sql-image>` placeholder; they
> are not steps for a BYOC or Agentic Data Plane cluster.

For a single node, `leader_name` and `host_name` are the same value. There is no inter-node communication.

### Minimal Docker run

```bash
docker run --rm -it \
  -p 5432:5432 \
  -p 8080:8080 \
  -p 9090:9090 \
  -e OXLA__LEADER_ELECTION__LEADER_NAME=oxla_node_1 \
  -e OXLA__STORAGE__OXLA_HOME=/oxla/data \
  -e OXLA__LOGGING__LEVEL=INFO \
  <redpanda-sql-image>
```

### Single-node with persistence (local volume)

```bash
docker run --rm -it \
  -p 5432:5432 \
  -p 8080:8080 \
  -p 9090:9090 \
  -v oxla_data:/oxla/data \
  -v /path/to/logs:/oxla/logs \
  -e OXLA_LOG_FILE=/oxla/logs/oxla_node_1.log \
  -e OXLA__LEADER_ELECTION__LEADER_NAME=oxla_node_1 \
  -e OXLA__STORAGE__OXLA_HOME=/oxla/data \
  -e OXLA__LOGGING__LEVEL=INFO \
  <redpanda-sql-image>
```

### Single-node with S3 storage (MinIO example)

This matches the `one_node_minio_no_cas.yml` reference configuration:

```bash
# 1. Start MinIO
docker run -d --name minio \
  -e MINIO_ROOT_USER=oxla-user \
  -e MINIO_ROOT_PASSWORD=oxla-password \
  -e MINIO_REGION=oxla-region \
  minio/minio:RELEASE.2023-09-30T07-02-29Z server /data

# 2. Create bucket
docker exec minio mc alias set local http://localhost:9000 oxla-user oxla-password
docker exec minio mc mb local/oxla-data

# 3. Run Oxla with S3 home
docker run --rm -it \
  -p 5432:5432 \
  --link minio \
  -e OXLA__STORAGE__OXLA_HOME=s3://oxla-data/oxla_home \
  -e OXLA__STORAGE__S3__ENDPOINT=http://minio:9000 \
  -e AWS_DEFAULT_REGION=oxla-region \
  -e AWS_ACCESS_KEY_ID=oxla-user \
  -e AWS_SECRET_ACCESS_KEY=oxla-password \
  -e OXLA__LEADER_ELECTION__LEADER_NAME=oxla_node_1 \
  -e OXLA__FEATURE_FLAGS__ALLOW_TABLE_OPERATIONS=true \
  -e OXLA__FEATURE_FLAGS__ALLOW_NONATOMIC_STORAGE=true \
  -e OXLA__DISTRIBUTED_CATALOG__CACHE_ENABLED=false \
  -e OXLA__DISTRIBUTED_CATALOG__CACHE_CONSISTENCY_ENABLED=false \
  <redpanda-sql-image>
```

Note: MinIO (pre-late-2024 versions) does not fully support If-Match/Compare-and-Swap. Disable the distributed catalog CAS features as shown above.

---

## Multi-Node Docker Compose

### Three-node cluster (local storage)

The simplified illustrative three-node compose below shows the pattern. Key observations:
- All three nodes share the same `oxla_data_persistence` and `oxla_shmem` volumes
- `OXLA__LEADER_ELECTION__LEADER_NAME=oxla_node_1` on all three nodes
- Each node has a unique `OXLA__NETWORK__HOST_NAME`
- `OXLA__SHARED_MEMORY__CLUSTER__PATH=/oxla/shmem` and a shared Docker volume

```yaml
# docker-compose.yml — three-node cluster
volumes:
  oxla_data_persistence:
  oxla_shmem:

services:
  oxla_node_1:
    image: <redpanda-sql-image>
    stop_grace_period: 3m
    security_opt:
      - seccomp:unconfined
    volumes:
      - oxla_data_persistence:/oxla/data
      - oxla_shmem:/oxla/shmem
      - ./logs:/oxla/logs
    environment:
      - OXLA__NETWORK__HOST_NAME=oxla_node_1
      - OXLA__LEADER_ELECTION__LEADER_NAME=oxla_node_1
      - OXLA__NETWORK__CLUSTER_NAME=cluster_1    # must match all nodes
      - OXLA__SHARED_MEMORY__CLUSTER__PATH=/oxla/shmem
      - OXLA__STORAGE__OXLA_HOME=/oxla/data
      - OXLA__LOGGING__LEVEL=INFO
      - OXLA__FEATURE_FLAGS__ALLOW_TABLE_OPERATIONS=true
      - OXLA__FEATURE_FLAGS__ALLOW_NONATOMIC_STORAGE=true
      - OXLA__FEATURE_FLAGS__ARRAY_SUPPORT=TRUE
      - OXLA_LOG_FILE=/oxla/logs/oxla_node_1.log
      - OXLA_ENCRYPTION_KEY=<hex-string-up-to-64-chars>
    ulimits:
      nofile:
        soft: 20000
        hard: 40000

  oxla_node_2:
    image: <redpanda-sql-image>
    stop_grace_period: 3m
    security_opt:
      - seccomp:unconfined
    volumes:
      - oxla_data_persistence:/oxla/data
      - oxla_shmem:/oxla/shmem
      - ./logs:/oxla/logs
    environment:
      - OXLA__NETWORK__HOST_NAME=oxla_node_2            # unique per node
      - OXLA__LEADER_ELECTION__LEADER_NAME=oxla_node_1  # same as node_1
      - OXLA__NETWORK__CLUSTER_NAME=cluster_1
      - OXLA__SHARED_MEMORY__CLUSTER__PATH=/oxla/shmem
      - OXLA__STORAGE__OXLA_HOME=/oxla/data
      - OXLA__LOGGING__LEVEL=INFO
      - OXLA__FEATURE_FLAGS__ALLOW_TABLE_OPERATIONS=true
      - OXLA__FEATURE_FLAGS__ALLOW_NONATOMIC_STORAGE=true
      - OXLA__FEATURE_FLAGS__ARRAY_SUPPORT=TRUE
      - OXLA_LOG_FILE=/oxla/logs/oxla_node_2.log
      - OXLA_ENCRYPTION_KEY=<hex-string-up-to-64-chars>
    ulimits:
      nofile:
        soft: 20000
        hard: 40000

  oxla_node_3:
    image: <redpanda-sql-image>
    stop_grace_period: 3m
    security_opt:
      - seccomp:unconfined
    volumes:
      - oxla_data_persistence:/oxla/data
      - oxla_shmem:/oxla/shmem
      - ./logs:/oxla/logs
    environment:
      - OXLA__NETWORK__HOST_NAME=oxla_node_3            # unique per node
      - OXLA__LEADER_ELECTION__LEADER_NAME=oxla_node_1  # same as node_1
      - OXLA__NETWORK__CLUSTER_NAME=cluster_1
      - OXLA__SHARED_MEMORY__CLUSTER__PATH=/oxla/shmem
      - OXLA__STORAGE__OXLA_HOME=/oxla/data
      - OXLA__LOGGING__LEVEL=INFO
      - OXLA__FEATURE_FLAGS__ALLOW_TABLE_OPERATIONS=true
      - OXLA__FEATURE_FLAGS__ALLOW_NONATOMIC_STORAGE=true
      - OXLA__FEATURE_FLAGS__ARRAY_SUPPORT=TRUE
      - OXLA_LOG_FILE=/oxla/logs/oxla_node_3.log
      - OXLA_ENCRYPTION_KEY=<hex-string-up-to-64-chars>
    ulimits:
      nofile:
        soft: 20000
        hard: 40000
```

---

## TLS Configuration

For TLS client connections, see the SSL section in [configuration.md](configuration.md). The `one_node_ssl.yml` reference mounts certs from `configurations/certs/`:

```bash
docker run --rm -it \
  -p 5432:5432 \
  -v /path/to/certs:/ssl \
  -e OXLA__SSL__MODE=optional \
  -e OXLA__SSL__CERT_FILE=/ssl/tls.crt \
  -e OXLA__SSL__KEY_FILE=/ssl/tls.key \
  -e OXLA__SSL__MIN_PROTOCOL_VERSION=1.2 \
  -e OXLA__SSL__MAX_PROTOCOL_VERSION=1.3 \
  -e OXLA__ACCESS_CONTROL__MODE=on \
  -e OXLA__LEADER_ELECTION__LEADER_NAME=oxla_node_1 \
  <redpanda-sql-image>
```

---

## Environment Variables Reference for Deployment

### Essential per-node variables

```bash
OXLA__NETWORK__CLUSTER_NAME=cluster_1        # same on all nodes
OXLA__NETWORK__HOST_NAME=oxla_node_1         # unique per node
OXLA__LEADER_ELECTION__LEADER_NAME=oxla_node_1  # leader's host_name, same on all nodes
OXLA__STORAGE__OXLA_HOME=/oxla/data          # or s3://... gs://... az://...
OXLA_LOG_FILE=/oxla/logs/oxla_node_1.log     # log file path (not YAML; directly read)
OXLA_ENCRYPTION_KEY=<hex-string>            # encryption key: up to 64 hex chars; shorter values are accepted
                                             # and expanded internally to a 32-byte/256-bit key.
                                             # Recommended: use the full 64 hex chars for maximum entropy.
```

### Memory sizing (set when you know your RAM)

```bash
OXLA__MEMORY__MAX=32G            # 0 = auto-detect
OXLA__MEMORY__MAX_NON_QUERY=6442M
```

### Feature flags commonly set in production

```bash
OXLA__FEATURE_FLAGS__ALLOW_TABLE_OPERATIONS=true
OXLA__FEATURE_FLAGS__ALLOW_NONATOMIC_STORAGE=true
OXLA__FEATURE_FLAGS__ARRAY_SUPPORT=TRUE
OXLA__FEATURE_FLAGS__FORCE_LARGE_INSERTIONS=true
```

### Shared memory for multi-node

```bash
OXLA__SHARED_MEMORY__CLUSTER__PATH=/oxla/shmem
OXLA__SHARED_MEMORY__CLUSTER__MONITORING_PERIOD=5000
```

### Cloud storage auth

**AWS S3:**
```bash
AWS_DEFAULT_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI...
# Optional for custom endpoint:
OXLA__STORAGE__S3__ENDPOINT=https://s3.example.com
```

**GCS:**
```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

**Azure:**
```bash
AZURE_CLIENT_ID=<app-id>
AZURE_CLIENT_SECRET=<secret>
AZURE_TENANT_ID=<tenant-id>
OXLA__STORAGE__AZURE__ACCOUNT_NAME=<storage-account-name>
```

---

## Config File Mounting

Mount a directory containing `config.yml`:

```bash
docker run --rm -it \
  -p 5432:5432 \
  -v /path/to/my/config:/oxla/startup_config \
  <redpanda-sql-image>
```

The config file does not need to be complete. A minimal `config.yml` for a single node with S3 storage:

```yaml
network:
  cluster_name: "production"
  host_name: "node1"

leader_election:
  leader_name: "node1"

storage:
  oxla_home: "s3://my-bucket/oxla_home"

logging:
  level: "INFO"

access_control:
  mode: "on"
  initial_password: "change-me-in-production"
```

All other settings will use compiled defaults.

---

## Resource Limits and ulimits

In production and the reference Docker Compose files, set the file descriptor limit:

```yaml
ulimits:
  nofile:
    soft: 20000
    hard: 40000
```

Also set `security_opt: [seccomp:unconfined]` on each node service.
