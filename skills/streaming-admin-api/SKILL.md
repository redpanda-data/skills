---
name: streaming-admin-api
description: >-
  Operate a Redpanda cluster via its HTTP Admin API on port 9644 (base path /v1).
  Covers authentication (Basic, Bearer, mTLS), all major endpoint groups (brokers,
  partitions, cluster config, cluster health, features, licensing, transactions,
  cloud_storage, security/RBAC, debug, debug_bundle), and ConnectRPC endpoints added
  in v25.3. Also covers configuring and operating Redpanda's Enterprise features
  through the Admin API: Tiered Storage / shadow indexing, Cloud Topics, Iceberg
  Topics, Continuous Data Balancing (partition_autobalancing_mode=continuous), Shadow
  Linking cross-cluster disaster recovery (ShadowLinkService ConnectRPC), Remote Read
  Replicas, Topic Recovery / Whole Cluster Restore, Audit Logging, Role-Based Access
  Control (RBAC), OIDC/OAuthBearer/Kerberos authentication, FIPS mode, Server-Side
  Schema ID Validation, and Leadership Pinning (most require an Enterprise license).
  Use when: calling the Redpanda Admin API directly over HTTP, decommissioning or
  recommissioning brokers, reading or altering cluster configuration, moving or
  recovering partitions, checking cluster health, managing feature flags or
  licensing (including enterprise-feature violation checks), managing security users
  and roles (RBAC), inspecting transactions, querying or configuring tiered storage
  (cloud_storage), enabling Iceberg/Cloud Topics/Audit Logging/Continuous Data
  Balancing, setting up shadow links for disaster recovery, running self-test or cpu
  profiling via the debug endpoints, starting a debug bundle via HTTP, or scripting
  cluster operations without rpk. Port 9644, base path /v1.
---

# Redpanda Streaming: Admin API

The Redpanda Admin API is an HTTP interface served on **port 9644** (default) with base path `/v1`. It lets you manage brokers, partitions, cluster configuration, security, features, tiered storage, and diagnostics. All operations that `rpk` performs against the cluster go through this API.

Starting in **Redpanda v25.3**, new endpoints are served as **ConnectRPC** services alongside the legacy `/v1` REST endpoints — both on port 9644. Legacy endpoints remain fully supported.

## Quickstart

```bash
ADMIN=http://localhost:9644

# List all brokers in the cluster
curl "$ADMIN/v1/brokers"

# Get cluster health overview
curl "$ADMIN/v1/cluster/health_overview"

# Get cluster config schema (describes every cluster config property)
curl "$ADMIN/v1/cluster_config/schema"

# Get current cluster config (non-default values only)
curl "$ADMIN/v1/cluster_config"

# Get the full cluster config including defaults
curl "$ADMIN/v1/cluster_config?include_defaults=true"

# --- With Basic auth (when authentication is enabled) ---
curl -u admin:password "$ADMIN/v1/brokers"

# --- With Bearer token ---
curl -H "Authorization: Bearer <token>" "$ADMIN/v1/brokers"

# Decommission broker 3
curl -u admin:password -X PUT "$ADMIN/v1/brokers/3/decommission"

# Check decommission progress
curl -u admin:password "$ADMIN/v1/brokers/3/decommission"

# Alter cluster config: set log_compression_type
curl -u admin:password -X PUT "$ADMIN/v1/cluster_config" \
  -H "Content-Type: application/json" \
  -d '{"upsert": {"log_compression_type": "snappy"}, "remove": []}'

# Get features and cluster logical version
curl "$ADMIN/v1/features"

# Get license information
curl -u admin:password "$ADMIN/v1/features/license"
```

## Base URL and Port

```
http://<broker-address>:9644/v1/<path>
```

All brokers in the cluster serve the Admin API. Any broker can answer read requests; write operations that mutate cluster state are forwarded internally to the controller leader. You can target any broker with any request.

## Authentication

Authentication is **optional** — it mirrors the authentication configuration of the cluster. When enabled:

- **Basic auth**: `curl -u <user>:<password> ...`
- **Bearer token**: `curl -H "Authorization: Bearer <token>" ...`
- **mTLS**: Provide a client certificate and key when TLS is configured with `require_client_auth: true`.

Most write endpoints and some read endpoints require **superuser** privileges. Some endpoints are public (no auth required even when auth is enabled).

See [auth-and-connection.md](references/auth-and-connection.md) for full details.

## Endpoint Groups

| Group | Base path | What it covers |
|---|---|---|
| Brokers | `/v1/brokers` | List, get, decommission, recommission, maintenance mode |
| Partitions | `/v1/partitions` | Node-local partition list, replica state, move replicas, rebalance |
| Cluster | `/v1/cluster/` | Health overview, partition balancer status, cluster-wide partition metadata |
| Cluster Config | `/v1/cluster_config` | Read/alter cluster configuration, schema, per-node status |
| Features | `/v1/features` | Feature flags, licensing, enterprise status |
| Security | `/v1/security/` | SASL users (create/list/delete/update), OIDC whoami, RBAC roles (Enterprise) |
| Transactions | `/v1/transactions` | List transactions, find coordinator, abort stuck transactions |
| Cloud Storage | `/v1/cloud_storage/` | Tiered storage status per partition, cluster recovery, manifest |
| Debug | `/v1/debug/` | CPU profile, disk stat, partition state, self-test, controller status |
| Debug Bundle | `/v1/debug/bundle` | Start, status, cancel, download a debug bundle ZIP |
| ConnectRPC (v25.3+) | `/redpanda.core.admin.v2.<Service>/<Method>` | Shadowing, connected-client monitoring, and future features |

## Key Operations by Use Case

### Broker Lifecycle

```bash
# List all brokers
curl "$ADMIN/v1/brokers"

# Get a specific broker
curl "$ADMIN/v1/brokers/1"

# Put broker into maintenance mode (drains leadership before restart)
curl -u admin:password -X PUT "$ADMIN/v1/brokers/2/maintenance"

# Remove from maintenance mode
curl -u admin:password -X DELETE "$ADMIN/v1/brokers/2/maintenance"

# Decommission (permanently remove broker from cluster)
curl -u admin:password -X PUT "$ADMIN/v1/brokers/3/decommission"

# Recommission (cancel a decommission in progress)
curl -u admin:password -X PUT "$ADMIN/v1/brokers/3/recommission"

# Check pre-restart safety
curl "$ADMIN/v1/broker/pre_restart_probe"
```

### Partition Operations

```bash
# Get partitions hosted on this node (node-local only)
curl "$ADMIN/v1/partitions"

# Get detailed state for a specific partition (namespace/topic/partition)
curl "$ADMIN/v1/partitions/kafka/my-topic/0"

# Get all partitions across the cluster
curl "$ADMIN/v1/cluster/partitions"

# Move partition replicas to different nodes
curl -u admin:password -X POST "$ADMIN/v1/partitions/kafka/my-topic/0/replicas" \
  -H "Content-Type: application/json" \
  -d '[{"node_id": 1, "core": 0}, {"node_id": 2, "core": 0}, {"node_id": 3, "core": 0}]'

# Cancel an ongoing reconfiguration
curl -u admin:password -X POST "$ADMIN/v1/partitions/kafka/my-topic/0/cancel_reconfiguration"

# Trigger on-demand partition rebalance
curl -u admin:password -X POST "$ADMIN/v1/partitions/rebalance"

# Check partition balancer status
curl "$ADMIN/v1/cluster/partition_balancer/status"
```

### Cluster Configuration

```bash
# Full config schema — inspect property types, defaults, needs_restart, visibility
curl "$ADMIN/v1/cluster_config/schema" | jq '.["log_retention_ms"]'

# Read a single config property
curl "$ADMIN/v1/cluster_config?key=log_retention_ms"

# Alter config
curl -u admin:password -X PUT "$ADMIN/v1/cluster_config" \
  -H "Content-Type: application/json" \
  -d '{"upsert": {"log_retention_ms": 86400000}, "remove": []}'

# Dry-run a config change (validates without applying)
curl -u admin:password -X PUT "$ADMIN/v1/cluster_config?dry_run=1" \
  -H "Content-Type: application/json" \
  -d '{"upsert": {"log_retention_ms": -1}, "remove": []}'

# Check which nodes need restart after a config change
curl "$ADMIN/v1/cluster_config/status"
```

### Health and Diagnostics

```bash
# Cluster health overview (is_healthy, leaderless/under-replicated counts, nodes down)
curl "$ADMIN/v1/cluster/health_overview"

# Get CPU profile (wait 5 seconds for samples)
curl "$ADMIN/v1/debug/cpu_profile?wait_ms=5000"

# Disk stat for data directory
curl "$ADMIN/v1/debug/storage/disk_stat/data"

# Controller log status (last_applied_offset, committed_index)
curl "$ADMIN/v1/debug/controller_status"

# Self-test: start disk + network benchmarks
curl -u admin:password -X POST "$ADMIN/v1/debug/self_test/start" \
  -H "Content-Type: application/json" -d '{}'
# Query results
curl "$ADMIN/v1/debug/self_test/status"
```

### ConnectRPC Endpoints (v25.3+)

```bash
# ConnectRPC endpoints use POST and fully-qualified service paths
curl -u admin:password \
  -X POST "http://localhost:9644/redpanda.core.admin.v2.ShadowLinkService/FailOver" \
  -H "Content-Type: application/json" \
  -d '{"name": "<shadow-link-name>", "shadowTopicName": "<shadow-topic-name>"}'
```

ConnectRPC endpoints also accept binary Protobuf bodies with `Content-Type: application/proto`. SDKs can be generated from the Buf Schema Registry at `buf.build/redpandadata/core`.

## Enterprise Features

Most of Redpanda's enterprise differentiators are configured and operated through this same Admin API — cluster config (`PUT /v1/cluster_config`), the cloud_storage endpoints, the RBAC `/v1/security/roles*` endpoints, and the ConnectRPC `ShadowLinkService`. **These require a valid Enterprise license.**

```bash
# Is an enterprise feature enabled without a valid license?
curl -u admin:secret "$ADMIN/v1/features/enterprise"   # license_status, violation, features[]
curl -u admin:secret "$ADMIN/v1/features/license"       # loaded license details

# Enable Continuous Data Balancing (Enterprise)
curl -u admin:secret -X PUT "$ADMIN/v1/cluster_config" \
  -H "Content-Type: application/json" \
  -d '{"upsert": {"partition_autobalancing_mode": "continuous"}, "remove": []}'

# Shadow Linking / DR failover (ConnectRPC, v25.3+)
curl -u admin:secret -X POST "$ADMIN/redpanda.core.admin.v2.ShadowLinkService/FailOver" \
  -H "Content-Type: application/json" -d '{"name": "dr-east"}'
```

Features and their cluster-config / topic keys: Tiered Storage (`cloud_storage_enabled`, `redpanda.remote.*`), Cloud Topics (`cloud_topics_enabled`), Iceberg Topics (`iceberg_enabled`, `redpanda.iceberg.mode/.delete/.partition.spec/.target.lag.ms/.invalid.record.action`), Continuous Data Balancing (`partition_autobalancing_mode=continuous`, `partition_autobalancing_*`, `core_balancing_continuous`), Shadow Linking (`ShadowLinkService`), Remote Read Replicas (`cloud_storage_enable_remote_read`, `redpanda.remote.readreplica`), Audit Logging (`audit_*`), RBAC (`/v1/security/roles*`), OIDC/Kerberos (`sasl_mechanisms`, `oidc_*`, `sasl_kerberos_*`), Server-Side Schema ID Validation (`enable_schema_id_validation`), Leadership Pinning (`default_leaders_preference`, `redpanda.leaders.preference`), FIPS (`fips_mode`, node config). See [enterprise-features.md](references/enterprise-features.md) for every nested key, grounded in source.

## Reference Directory

- [endpoints-overview.md](references/endpoints-overview.md): Full endpoint-group map with HTTP methods, paths, and what each returns — grounded in the Swagger 1.2 JSON specs.
- [auth-and-connection.md](references/auth-and-connection.md): Base URL, port 9644, TLS configuration, Basic auth, Bearer tokens, mTLS, and the auth_level model (public / authenticated / superuser).
- [brokers-and-partitions.md](references/brokers-and-partitions.md): Broker lifecycle (list, decommission, recommission, maintenance mode) and partition operations (state, move replicas, rebalance, force recover). Full curl examples and response schemas.
- [cluster-config.md](references/cluster-config.md): Reading the config schema, getting and altering cluster configuration, the `needs_restart` flag, the difference between cluster config and node config, and the per-node status endpoint.
- [debug-endpoints.md](references/debug-endpoints.md): The `/v1/debug/*` endpoints — cpu_profile, disk_stat, partition state, self-test, controller status, sampled memory profile — plus the debug_bundle HTTP API. curl examples and response field meanings.
- [enterprise-features.md](references/enterprise-features.md): Redpanda Enterprise differentiators driven through the Admin API, with every nested config key and topic property grounded in source: Tiered Storage / shadow indexing, Topic Recovery / Whole Cluster Restore, Remote Read Replicas, Cloud Topics, Iceberg Topics, Continuous Data Balancing (+ intra-broker core balancing), Leadership Pinning, Audit Logging, RBAC roles endpoints, OIDC/OAuthBearer/Kerberos auth, Server-Side Schema ID Validation, FIPS, and the ShadowLinkService ConnectRPC API for cross-cluster disaster recovery. Includes the license-violation remediation table (which config key disables each feature).
