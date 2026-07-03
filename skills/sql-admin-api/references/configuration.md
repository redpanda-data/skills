# Oxla Configuration Reference

Oxla uses a YAML configuration file (`config.yml`) with layered overrides. The authoritative defaults are in `config/Release/default_config.yml`. Every setting can also be overridden by an environment variable using the `OXLA__` prefix and `__` as the path separator.

## Configuration Layering

Priority order (highest wins):
1. `OXLA__*` environment variables
2. Mounted config file at `/oxla/startup_config/config.yml`
3. Compiled binary defaults

If no config file exists at startup, Oxla generates one at `/oxla/startup_config/config.yml` from the env-var overrides. Pass `OXLA_CONFIG_FILE=/path/to/config.yml` to override the config file path. Pass `OXLA_CONFIG_FILE=` (empty) to use defaults only.

A partial config file is valid — any missing field falls back to its compiled default. An empty config file is legitimate.

Unknown `OXLA__` env vars produce a degraded-state warning.

For array values, use YAML syntax in the env var value: `OXLA__OIDC__PROTECTED_USERS=[oxla, admin]`.

---

## Parameter Classification

Config parameters are classified as **public** (user-facing) or **internal** (operator/developer). Both are accepted via env vars. The classification is defined in `src/config/config_parameter_list.h`.

**Public parameters** (the ones operators are expected to set):

| YAML path | Env var | Description |
|-----------|---------|-------------|
| `access_control.mode` | `OXLA__ACCESS_CONTROL__MODE` | Access control mode (`default`, `on`, `off`) |
| `leader_election.leader_name` | `OXLA__LEADER_ELECTION__LEADER_NAME` | Hostname of the node designated as leader |
| `network.postgresql.port` | `OXLA__NETWORK__POSTGRESQL__PORT` | PostgreSQL wire protocol port (default: 5432) |
| `network.cluster_name` | `OXLA__NETWORK__CLUSTER_NAME` | Cluster name shared by all nodes |
| `network.host_name` | `OXLA__NETWORK__HOST_NAME` | Unique name for this node |
| `metrics.port` | `OXLA__METRICS__PORT` | Prometheus metrics HTTP port (default: 8080) |
| `metrics.no_exposer` | `OXLA__METRICS__NO_EXPOSER` | Disable metrics endpoint (bool) |
| `logging.level` | `OXLA__LOGGING__LEVEL` | Log level (see Logging section) |
| `storage.azure.account_name` | `OXLA__STORAGE__AZURE__ACCOUNT_NAME` | Azure Storage Account name |
| `storage.oxla_home` | `OXLA__STORAGE__OXLA_HOME` | Data directory path or cloud URI |
| `shared_memory.cluster.path` | `OXLA__SHARED_MEMORY__CLUSTER__PATH` | Shared memory directory path |
| `shared_memory.cluster.monitoring_period` | `OXLA__SHARED_MEMORY__CLUSTER__MONITORING_PERIOD` | Monitoring period (ms) |

---

## Network Section

```yaml
network:
  cluster_name: "cluster_1"     # same value on ALL nodes in the cluster
  host_name: "oxla_node_1"      # unique name for THIS node

  node:                          # inter-node communication (discovery + heartbeat)
    port: 5771                   # port for data exchange between nodes
    workers: 32
    heartbeat:
      interval: 10000 ms         # interval between heartbeat messages
      timeout: 60000 ms          # timeout for heartbeat responses
    keepalive:
      enabled: true
      idle: 30                   # seconds idle before TCP keepalive
      interval: 10               # seconds between keepalive retransmissions
      count: 5                   # unacked keepalives before connection considered dead

  postgresql:                    # PostgreSQL wire protocol (client connections)
    port: 5432
    workers: 32
    keepalive:
      enabled: true
      idle: 30
      interval: 10
      count: 5

  slot:                          # pipeline data exchange in multi-node configs
    port: 5770
    workers: 32
    keepalive:
      enabled: true
      idle: 30
      interval: 10
      count: 5
```

**Key points:**
- `cluster_name` must be identical on all cluster nodes; a node that receives a connection from a different `cluster_name` will reject it.
- `host_name` must be unique per node. It is used as the node identity.
- Port 5771 (inter-node) and 5770 (slot) must be reachable between nodes but need not be exposed externally.

---

## Leader Election Section

```yaml
leader_election:
  leader_name: "oxla_node_1"   # hostname of the designated leader node
```

In a multi-node cluster, all nodes set `leader_name` to the same value — the `host_name` of the node that should serve as the leader. A node whose own `host_name` matches `leader_name` boots as the leader; all others boot as workers.

---

## Access Control Section

```yaml
access_control:
  mode: default                 # "default", "on", or "off"
  initial_password: oxla        # password set for the built-in 'oxla' superuser
  cache_update_interval: 5s     # how often the access control cache is refreshed
```

- `mode: default` — password authentication is enforced with the `initial_password`.
- `mode: on` — full access control enabled.
- `mode: off` — no authentication required (suitable for isolated development).
- `initial_password` is classified as **internal** (not in the public set), but can be overridden via `OXLA__ACCESS_CONTROL__INITIAL_PASSWORD`.

---

## Metrics Section

```yaml
metrics:
  port: 8080      # HTTP port for Prometheus scrape
  no_exposer: false  # set to true to disable the metrics endpoint
```

Prometheus scrapes `GET http://<node>:8080/metrics`.

---

## Storage Section

```yaml
storage:
  oxla_home: "/oxla/data"       # data directory — local path or cloud URI

  azure:
    no_cache: false             # disable Azure content caching
    enable_tenant_discovery: false
    max_retries: 3
    retry_delay: 10000 ms
    max_retry_delay: 30000 ms
    account_name: ""            # Azure Storage Account name (public param)

  gcs:
    no_cache: false
    write_buffer_size: 8M
    read_buffer_size: 1M

  local:
    no_cache: false

  s3:
    requests: 0                 # max concurrent TCP connections to AWS (0=default)
    no_cache: false
    enable_discovery: true
    use_dual_stack: true
    http: "https"               # URI scheme: "https" or "http"
    endpoint: ""                # custom S3-compatible endpoint (e.g. MinIO)
    read_bitrate: 0             # bandwidth limit for reads (0=none)
    write_bitrate: 0            # bandwidth limit for writes (0=none)

  indexed_file_levels:
    first_level_max_file_size: 1024
    max_num_files_on_level: 4
    num_levels: 12

  not_indexed_file_levels:
    first_level_max_file_size: 1024
    max_num_files_on_level: 4
    num_levels: 12
```

### Storage backend selection

| Backend | `oxla_home` value | Notes |
|---------|------------------|-------|
| Local disk | `/oxla/data` | Default; data lives in the container |
| AWS S3 | `s3://bucket/prefix` | Set AWS env vars; use `storage.s3.endpoint` for MinIO |
| GCS | `gs://bucket/prefix` | Set `GOOGLE_APPLICATION_CREDENTIALS` |
| Azure Blob | `az://container/prefix` | Set `AZURE_CLIENT_ID/SECRET/TENANT_ID` + `storage.azure.account_name` |

For S3/MinIO, always set the standard AWS environment variables:
```
AWS_DEFAULT_REGION=<region>
AWS_ACCESS_KEY_ID=<key>
AWS_SECRET_ACCESS_KEY=<secret>
```

For a MinIO endpoint, add `OXLA__STORAGE__S3__ENDPOINT=http://minio:9000`.

---

## Memory Section

```yaml
memory:
  max: 0             # query memory budget; 0 = Oxla auto-detects available RAM
                     # must be 0 or at least 8G when set explicitly
  max_non_query: 6442M  # non-query memory budget; must be at least 6442M
```

- `max: 0` instructs Oxla to read available RAM from the OS and calculate the limit automatically.
- `max_non_query` covers internal overhead (buffers, catalog, etc.) and must be at least ~6 GB.
- These are **internal** parameters — not listed in the public set but settable via `OXLA__MEMORY__MAX` and `OXLA__MEMORY__MAX_NON_QUERY`.

---

## Logging Section

```yaml
logging:
  level: "INFO"   # startup log level
```

Valid levels (from `logging.proto`): `NONE`, `FATAL`, `ERROR`, `WARNING`, `INFO`, `DEBUG`, `VERBOSE`

The runtime log level can be changed without restart via the admin API (port 9090). See [admin-grpc-and-runtime.md](admin-grpc-and-runtime.md).

---

## SSL Section (PostgreSQL client connections)

```yaml
ssl:
  mode: "off"         # "off" | "optional" | "require"
  ca_crt_file: ""     # CA certificate file path (for client-cert verification)
  cert_file: ""       # server certificate file path
  key_file: ""        # server private key file path
  min_protocol_version: 1.2   # 1.2 or 1.3
  max_protocol_version: 1.3   # 1.2 or 1.3
```

SSL modes:
- `off` — TLS not supported for client connections
- `optional` — both TLS and plain connections accepted
- `require` — only TLS connections accepted

When `ca_crt_file` is provided, the server requires client certificates (mTLS). This is only valid with `mode: require`.

Example env-var SSL setup (from `one_node_ssl.yml`):
```
OXLA__SSL__MODE=optional
OXLA__SSL__CERT_FILE=/ssl/tls.crt
OXLA__SSL__KEY_FILE=/ssl/tls.key
OXLA__SSL__MIN_PROTOCOL_VERSION=1.2
OXLA__SSL__MAX_PROTOCOL_VERSION=1.3
```

---

## OIDC Section

```yaml
oidc:
  enabled: false
  issuer_url: ""
  audience: ""
  jwks_refresh_interval: 300s
  jwks_force_refresh_cooldown: 60s
  clock_skew_tolerance: 30s
  oidc_principal_mapping: "$.sub"   # JSONPath expression to extract principal from JWT
  disable_password_auth: false
  require_tls: true
  protected_users:
    - "oxla"              # users always authenticated via password, not OIDC
```

When `oidc.enabled: true`, clients can authenticate with JWT bearer tokens from the configured OIDC issuer. The `protected_users` list contains users that always use password authentication even when OIDC is enabled.

---

## Admin API Section

```yaml
admin_api:
  enabled: true
  port: 9090
  workers: 2
  ssl:
    mode: "off"           # "off" | "optional" | "require"
    ca_crt_file: ""
    cert_file: ""
    key_file: ""
    min_protocol_version: 1.2
    max_protocol_version: 1.3
```

The admin API SSL config is separate from the PostgreSQL SSL config. All parameters are **internal**. Set via env vars:
```
OXLA__ADMIN_API__ENABLED=true
OXLA__ADMIN_API__PORT=9090
OXLA__ADMIN_API__SSL__MODE=require
OXLA__ADMIN_API__SSL__CERT_FILE=/certs/admin.crt
OXLA__ADMIN_API__SSL__KEY_FILE=/certs/admin.key
```

---

## Resource Management Section

```yaml
resource_management:
  max_concurrent_queries: 100   # maximum queries processed simultaneously
                                 # must be > 0; setting 0 causes a fatal startup error
                                 # (do not use 0 to mean "unlimited")
  query_queue_timeout: 30 s     # how long a queued query waits before timing out
```

---

## Insertion / Pipeline / Query Planner Sections

```yaml
insertion:
  buffer_size_limit: 42M               # flush threshold for small inserts (<4MB)
  buffer_timeout: 100 ms               # time-based flush for small inserts
  large_copy_buffer_size_limit: 128M   # flush threshold for large COPY
  large_insert_into_buffer_size_limit: 128M  # buffer per large INSERT INTO

pipeline:
  groupby_hashmap_size_threshold: -1   # -1 = auto-select

query_planner:
  pipeline: false   # true = use pipeline-based SELECT planner
```

---

## Feature Flags Section

Feature flags control experimental or gated features. All are **internal** parameters.

| Flag | Default | Description |
|------|---------|-------------|
| `feature_flags.array_support` | `true` | Enable ARRAY column type |
| `feature_flags.allow_table_operations` | `false` | Allow CREATE/DROP TABLE, INSERT, COPY, UPDATE, DELETE |
| `feature_flags.allow_nonatomic_storage` | `false` | Allow non-atomic storage operations |
| `feature_flags.allow_iceberg_queries` | `false` | Allow direct SELECT from Iceberg catalogs (transparent Kafka+Iceberg queries are unaffected). See [lakehouse-and-streaming.md](lakehouse-and-streaming.md) |
| `feature_flags.centralized_access_control.enabled` | `false` | Centralized (control-plane) access control. With `.organization_id`, `.datastorage_id`, `.cluster_id`. See [auth-and-security.md](auth-and-security.md) |
| `feature_flags.disable_table_tasks` | `false` | Disable background table tasks |
| `feature_flags.allow_data_task_cancel` | `false` | Allow cancellation of data tasks |
| `feature_flags.gen_recompact_data_task` | `true` | Generate recompaction data tasks |
| `feature_flags.pipeline_visualization` | `false` | Enable pipeline visualization |
| `feature_flags.distinct_folds_support` | `false` | Enable distinct-fold support |
| `feature_flags.errors_source_location` | `false` | Include source location in errors |
| `feature_flags.dont_use_copy_compactor` | `false` | Disable compaction during insertions |
| `feature_flags.force_large_insertions` | `true` | All inserters use private buffers |
| `feature_flags.skip_memory_sanity_checks` | `false` | Bypass memory sanity checks |
| `feature_flags.decommission_timeout` | `80s` | Wait for active work to drain on shutdown |
| `feature_flags.force_catalog_ac_consistency` | `true` | Enforce catalog access-control consistency |
| `feature_flags.print_query_plan` | `false` | Log query plans |

In the reference Docker Compose configurations for testing, these flags are typically enabled:
```
OXLA__FEATURE_FLAGS__ALLOW_TABLE_OPERATIONS=true
OXLA__FEATURE_FLAGS__ALLOW_NONATOMIC_STORAGE=true
OXLA__FEATURE_FLAGS__ARRAY_SUPPORT=TRUE
OXLA__FEATURE_FLAGS__FORCE_LARGE_INSERTIONS=true
```

---

## Data Tasks Section

```yaml
data_tasks:
  max_capacity: 0        # max concurrent data tasks; 0 = use hardware concurrency
  under_load_capacity: 1  # reduced capacity used when the system is under load
  compaction_timeout: 10s # timeout for a compaction data task
```

Data tasks are background jobs (e.g. compaction). `max_capacity: 0` lets Oxla size them to the hardware concurrency.

---

## Executor Section

```yaml
executor:
  workers: 0   # threads hosting the per-Executor strands; 0 = hardware concurrency
```

`executor.workers` sizes the thread pool that runs the per-Executor strands,
independently of the `network.*.workers` pools. Following the same convention as
`network.*.workers` and `data_tasks.max_capacity`, a value of `0` means "use
hardware concurrency". This is an **internal** parameter (settable via
`OXLA__EXECUTOR__WORKERS`).

---

## Distributed Catalog Section

```yaml
distributed_catalog:
  cache_enabled: true
  cache_consistency_enabled: true
  transaction_timeout: 1h
  cache_wait_for_leader_response_timeout: 3000 ms
  cache_wait_for_snapshot_reload_timeout: 3000 ms
  sleep_time_for_garbage_collector: 30000 ms
  remove_dangling_objects: false
  cas_timeout: 30s
```

The distributed catalog manages schema and metadata across nodes. `cache_enabled` and `cache_consistency_enabled` can be set to `false` for MinIO/S3 backends that do not support Compare-and-Swap (see `one_node_minio_no_cas.yml`).

---

## Shared Memory Section

```yaml
shared_memory:
  cluster:
    path: /oxla/shmem            # shared memory directory
    monitoring_period: 1000       # ms
```

In multi-node setups, the shared memory path must be accessible by all nodes (e.g., a shared Docker volume).
