---
name: sql-admin-api
description: >-
  Configures and operates an Oxla cluster: YAML config (default_config.yml),
  OXLA__ environment-variable overrides, node ports and roles, leader election,
  storage backends (local/S3/GCS/Azure), memory limits, access control, TLS,
  OIDC, and the HTTP-based ConnectRPC admin service (port 9090) with its
  LoggingService (GetLogLevel/SetLogLevel). Also covers the Prometheus metrics
  endpoint (port 8080) and Docker/Compose deployment patterns. Covers Oxla's
  lakehouse and streaming differentiators: Apache Iceberg REST catalogs
  (CREATE ICEBERG CATALOG, oauth2/basic/aws_sigv4 auth, feature_flags.allow_iceberg_queries),
  transparent Redpanda/Kafka integration (CREATE REDPANDA CATALOG, topic-backed
  tables, schema_lookup_policy/error_handling_policy), object-storage connections
  (CREATE STORAGE TYPE S3/GCS/ABS), plus security: OIDC/JWT auth, SCRAM passwords,
  centralized access control, and AES-256-GCM secret encryption (OXLA_ENCRYPTION_KEY).
  Use when: configuring an Oxla cluster; setting ports or node names; enabling
  TLS or OIDC authentication; choosing a storage backend (S3/GCS/Azure);
  setting up Iceberg catalogs or a lakehouse; querying Redpanda/Kafka topics as
  tables; creating storage connections; encrypting connection secrets; tuning
  memory limits; running Oxla via Docker; changing log levels at runtime
  via the admin API; checking cluster health via /healthz; scraping Prometheus
  metrics on port 8080; deploying a single-node or multi-node Oxla cluster;
  overriding config values with OXLA__ env vars; or any Oxla operations or
  administration task.
---

# Redpanda SQL: Administration & Operations

Oxla is a distributed columnar analytical database with a PostgreSQL wire-compatible interface. **There is no REST admin API.** Administration is performed through three mechanisms: (1) a YAML configuration file loaded at startup, (2) `OXLA__` environment-variable overrides, and (3) a ConnectRPC-based HTTP admin service (default port 9090) that currently exposes runtime log-level control. A Prometheus metrics endpoint runs on port 8080.

Clients connect to Oxla via the PostgreSQL wire protocol on port 5432. SQL-level administration (roles, grants, system tables) is covered in the `sql` skill.

## Quickstart

### Single-node via Docker (minimal config)

```bash
# Run a single Oxla node with local storage and all defaults
docker run --rm -it \
  -p 5432:5432 \
  -p 8080:8080 \
  -p 9090:9090 \
  -e OXLA__LEADER_ELECTION__LEADER_NAME=oxla_node_1 \
  -e OXLA__STORAGE__OXLA_HOME=/oxla/data \
  -e OXLA__LOGGING__LEVEL=INFO \
  778696301129.dkr.ecr.eu-central-1.amazonaws.com/oxla-devel:latest
```

### Single-node with S3 storage

```bash
docker run --rm -it \
  -p 5432:5432 \
  -e OXLA__LEADER_ELECTION__LEADER_NAME=oxla_node_1 \
  -e OXLA__STORAGE__OXLA_HOME=s3://my-bucket/oxla_home \
  -e OXLA__STORAGE__S3__ENDPOINT=https://s3.amazonaws.com \
  -e AWS_DEFAULT_REGION=us-east-1 \
  -e AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE \
  -e AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY \
  778696301129.dkr.ecr.eu-central-1.amazonaws.com/oxla-devel:latest
```

### Three-node cluster (Docker Compose)

```bash
# The reference three-node compose requires AWS credentials (uses `?err` substitution).
# Export them before running:
export AWS_DEFAULT_REGION=us-east-1
export AWS_ACCESS_KEY_ID=<key>
export AWS_SECRET_ACCESS_KEY=<secret>

docker compose \
  -f tests/blackbox/configurations/three_nodes.yml \
  -f tests/blackbox/configurations/three_nodes_ports.yml \
  up
```

### Override a config value via env var

```bash
# YAML path: network.postgresql.port → env var: OXLA__NETWORK__POSTGRESQL__PORT
docker run ... -e OXLA__NETWORK__POSTGRESQL__PORT=5433 ...

# Change log level to DEBUG
docker run ... -e OXLA__LOGGING__LEVEL=DEBUG ...
```

### Mount a custom config file

```bash
# Place your config.yml in /path/to/config/ and mount it
docker run --rm -it \
  -p 5432:5432 \
  -v /path/to/config:/oxla/startup_config \
  778696301129.dkr.ecr.eu-central-1.amazonaws.com/oxla-devel:latest
```

### Health check and log-level management via the admin API

```bash
# Health check (plain HTTP GET; returns "OK" with 200)
curl http://localhost:9090/healthz

# Get current log level (ConnectRPC, JSON encoding)
curl -s -X POST http://localhost:9090/oxla.admin.v1.LoggingService/GetLogLevel \
  -H "Content-Type: application/json" \
  -d '{}'

# Set log level to DEBUG
curl -s -X POST http://localhost:9090/oxla.admin.v1.LoggingService/SetLogLevel \
  -H "Content-Type: application/json" \
  -d '{"level": "LOG_LEVEL_DEBUG"}'

# Set log level back to INFO
curl -s -X POST http://localhost:9090/oxla.admin.v1.LoggingService/SetLogLevel \
  -H "Content-Type: application/json" \
  -d '{"level": "LOG_LEVEL_INFO"}'
```

### Scrape Prometheus metrics

```bash
curl http://localhost:8080/metrics
```

### Connect with psql

```bash
psql -h localhost -p 5432 -U oxla -d oxla
# default password: oxla (set by access_control.initial_password)
```

---

## Configuration Model

Oxla uses a layered configuration system:

1. **Compiled defaults** (built into the binary)
2. **Config file** — partial YAML at `/oxla/startup_config/config.yml` (only fields you specify are applied; missing fields use defaults)
3. **Environment variables** — `OXLA__` prefix, always take precedence over the config file

The YAML path separator in env var names is `__` (double underscore). Example:

| YAML path | Environment variable |
|-----------|---------------------|
| `network.postgresql.port` | `OXLA__NETWORK__POSTGRESQL__PORT` |
| `logging.level` | `OXLA__LOGGING__LEVEL` |
| `storage.oxla_home` | `OXLA__STORAGE__OXLA_HOME` |
| `leader_election.leader_name` | `OXLA__LEADER_ELECTION__LEADER_NAME` |
| `memory.max` | `OXLA__MEMORY__MAX` |

If no config file is present at startup, Oxla generates one from env-var overrides at `/oxla/startup_config/config.yml`. To use a specific config file path, set `OXLA_CONFIG_FILE=path/to/config.yml`. An empty path (`OXLA_CONFIG_FILE=`) signals Oxla to use compiled defaults only.

Unknown `OXLA__` env vars cause a degraded-state warning but do not prevent startup.

---

## Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| **5432** | PostgreSQL wire | Client SQL connections |
| **5770** | Internal (slot) | Pipeline data exchange between nodes |
| **5771** | Internal (node) | Inter-node discovery and heartbeat |
| **8080** | HTTP | Prometheus metrics scrape |
| **9090** | HTTP (ConnectRPC) | Admin API (log levels, health check) |

---

## Admin API (ConnectRPC, port 9090)

The admin API is an HTTP server using the ConnectRPC protocol. It accepts both `application/proto` (binary protobuf) and `application/json` content types.

**URL pattern:** `POST /<package>.<ServiceName>/<MethodName>`

**Health check:** `GET /healthz` returns `200 OK` with body `OK`.

Currently implemented service: `oxla.admin.v1.LoggingService` with two RPCs:
- `GetLogLevel` — returns the current runtime log level
- `SetLogLevel` — changes the runtime log level without restart

Log levels (from `logging.proto`): `LOG_LEVEL_NONE`, `LOG_LEVEL_FATAL`, `LOG_LEVEL_ERROR`, `LOG_LEVEL_WARNING`, `LOG_LEVEL_INFO`, `LOG_LEVEL_DEBUG`, `LOG_LEVEL_VERBOSE`

The admin API can be TLS-secured independently of the PostgreSQL port. See the [Admin gRPC and Runtime](references/admin-grpc-and-runtime.md) reference.

---

## Storage Backends

Set `storage.oxla_home` (or `OXLA__STORAGE__OXLA_HOME`) to a path or URI:

| Backend | URI scheme | Example |
|---------|-----------|---------|
| Local disk | `/path/to/dir` | `/oxla/data` |
| AWS S3 | `s3://bucket/prefix` | `s3://my-bucket/oxla_home` |
| GCS | `gs://bucket/prefix` | `gs://my-bucket/oxla_home` |
| Azure Blob | `az://container/prefix` | `az://my-container/oxla_home` |

For S3, set `AWS_DEFAULT_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` as standard AWS env vars. For a custom S3-compatible endpoint (e.g., MinIO), also set `OXLA__STORAGE__S3__ENDPOINT`.

---

## Lakehouse, Streaming & Security Differentiators

Oxla's differentiators in its analytical-database domain are configured through SQL connection objects and cluster config (none require a separate license key — Oxla ships as a single binary):

- **Apache Iceberg REST catalogs** — `CREATE ICEBERG CATALOG name STORAGE conn WITH (uri=..., auth_type='oauth2'|'basic'|'aws_sigv4', ...)`. Gated by `feature_flags.allow_iceberg_queries` (default `false`) for direct SELECT. This is Oxla's analog of Redpanda's Iceberg Topics open-table-format differentiator. See [lakehouse-and-streaming.md](references/lakehouse-and-streaming.md).
- **Transparent Redpanda/Kafka** — `CREATE REDPANDA CATALOG` (or `KAFKA`) `WITH (initial_brokers=..., schema_registry_url=..., ...)` and `CREATE TABLE catalog=>tbl WITH (topic='...', schema_lookup_policy='LATEST'|'SCHEMA_ID', error_handling_policy='FAIL'|'FILL_NULL'|'DROP_RECORD')`. A Kafka catalog can link an Iceberg catalog via `USING CATALOG`. See [lakehouse-and-streaming.md](references/lakehouse-and-streaming.md).
- **Object-storage connections** — `CREATE STORAGE name TYPE = S3|GCS|ABS WITH (...)`. Reusable, credential-bearing connections referenced by Iceberg catalogs. See [lakehouse-and-streaming.md](references/lakehouse-and-streaming.md).
- **OIDC/JWT auth, SCRAM passwords, centralized access control, AES-256-GCM secret encryption** (`OXLA_ENCRYPTION_KEY`). See [auth-and-security.md](references/auth-and-security.md).

---

## Reference Directory

- [configuration.md](references/configuration.md): The YAML config file section by section — network ports, heartbeat, leader election, storage backends, metrics, access control, memory, SSL, OIDC, logging. The OXLA__ env-var override scheme and the public vs internal parameter classification.
- [cluster-and-deploy.md](references/cluster-and-deploy.md): Cluster topology (cluster_name, host_name, leader vs worker nodes, inter-node ports), single-node and multi-node Docker Compose deployment patterns, environment-variable wiring from the reference configurations, and the Ansible playbooks (`ansible/devcluster_deploy.yml`, `ansible/devcluster_deploy_aws.yml`) and Terraform module (`terraform/devcluster/`) for deploying to real servers and EC2.
- [admin-grpc-and-runtime.md](references/admin-grpc-and-runtime.md): The ConnectRPC admin server on port 9090 — LoggingService (GetLogLevel/SetLogLevel), the /healthz endpoint, TLS/mTLS for the admin API, the Prometheus metrics endpoint on port 8080, and memory/OOM controls.
- [lakehouse-and-streaming.md](references/lakehouse-and-streaming.md): Oxla's lakehouse and streaming integration surfaces — object-storage connections (`CREATE STORAGE TYPE S3/GCS/ABS` with full per-type option keys), Apache Iceberg REST catalogs (`CREATE ICEBERG CATALOG` with oauth2/basic/aws_sigv4 auth, TLS options, `feature_flags.allow_iceberg_queries`), and transparent Redpanda/Kafka integration (`CREATE REDPANDA/KAFKA CATALOG`, topic-backed tables, `schema_lookup_policy`/`error_handling_policy`/`struct_mapping_policy`/`confluent_wire_protocol`, and the `USING CATALOG` Iceberg link). All option keys grounded in `src/sqlparser` and `src/catalog`. No separate license key required.
- [auth-and-security.md](references/auth-and-security.md): Authentication and security — access-control modes (`access_control.mode`), SCRAM-SHA-256 passwords, OIDC/JWT bearer auth (all `oidc.*` keys), centralized access control (`feature_flags.centralized_access_control.*`), and AES-256-GCM at-rest encryption of connection secrets via `OXLA_ENCRYPTION_KEY` (hex, ≤64 chars, cycled to a 256-bit key).

## Scripts and Resources

- [scripts/set_log_level.sh](scripts/set_log_level.sh): Saves the current log level, sets a new one (default: DEBUG), waits for you to press Enter, then restores the original. Usage: `./scripts/set_log_level.sh [LEVEL] [ADMIN_URL]`
- [resources/docker-compose-local.yml](resources/docker-compose-local.yml): Self-contained single-node Oxla with local storage — no AWS credentials required. Run with: `docker compose -f resources/docker-compose-local.yml up`
