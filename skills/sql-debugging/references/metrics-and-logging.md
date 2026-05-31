# Oxla Metrics & Logging

---

## Prometheus Metrics Endpoint

Oxla exposes a Prometheus-compatible metrics endpoint via HTTP. Configuration is in `config/Release/default_config.yml` (exact path is deployment-dependent):

```yaml
metrics:
  port: 8080       # HTTP port for the Prometheus exposition
  no_exposer: false # set true to disable the exposer entirely
```

### Scraping

```bash
# Full scrape
curl -s http://<host>:8080/metrics

# Filter to a specific metric family
curl -s http://<host>:8080/metrics | grep oxla_query_errors_total

# Scrape multiple nodes in parallel
for node in node1 node2 node3; do
  echo "=== $node ==="
  curl -s "http://$node:8080/metrics" | grep oxla_cluster_has_leader_bool
done
```

The endpoint speaks standard Prometheus text exposition format (no authentication by default).

---

## Metric Catalog

All metric names are prefixed `oxla_`. The following are grounded in `src/monitoring/metrics/` header files.

### Cluster & Node Health

| Metric | Type | Labels | Description |
|---|---|---|---|
| `oxla_cluster_has_leader_bool` | Gauge | — | 1 if the cluster has a leader, 0 otherwise |
| `oxla_node_is_leader_bool` | Gauge | — | 1 if this node is the leader |
| `oxla_node_is_ready_bool` | Gauge | — | 1 if this node is ready to serve queries |
| `oxla_node_is_degraded_bool` | Gauge | — | 1 if this node is in a degraded state |
| `oxla_num_nodes_connected` | Gauge | — | Number of peer nodes currently connected |
| `oxla_num_open_connections` | Gauge | — | Number of open connection handlers (StateHandler instances) |

**Prometheus alert expressions:**

```promql
# Cluster has no leader
oxla_cluster_has_leader_bool == 0

# Any node is degraded
oxla_node_is_degraded_bool == 1

# Node not ready for 5 minutes
oxla_node_is_ready_bool == 0
```

---

### Query Throughput & Errors

| Metric | Type | Labels | Description |
|---|---|---|---|
| `oxla_net_postgres_client_queries_count` | Counter | `query_type` ∈ {`INSERT`, `COPY`, `SELECT`}; unlabeled series for total | Queries received from clients by type |
| `oxla_net_postgres_client_queries_failed_count` | Counter | `error_type` ∈ {`EXECUTION ERROR`, `CANCELED`, `OTHER`}; unlabeled series for total | Failed queries by failure type |
| `oxla_net_postgres_client_queries_successful_count` | Counter | — | Successfully completed queries |
| `oxla_net_postgres_queries_ongoing` | Gauge | — | Number of currently running queries |
| `oxla_net_postgres_command_count` | Counter | — | Total PostgreSQL wire-protocol commands received |
| `oxla_net_postgres_connections` | Gauge | — | Current PostgreSQL client connections |
| `oxla_net_postgres_nonlocalhost_connections_count` | Gauge | — | Non-localhost connections (useful for external client monitoring) |

```promql
# Query error rate (per minute)
rate(oxla_net_postgres_client_queries_failed_count[1m])

# Currently running queries
oxla_net_postgres_queries_ongoing
```

---

### Query Errors (Detailed)

| Metric | Type | Labels | Description |
|---|---|---|---|
| `oxla_query_errors_total` | Counter | `error_type` | Total query errors broken down by type |

**Label values for `error_type`:** `parse_error`, `plan_error`, `execution_error`, `oom`, `cancelled`, `other`

```promql
# OOM-caused query failures
oxla_query_errors_total{error_type="oom"}

# Parse errors (indicates SQL syntax problems)
oxla_query_errors_total{error_type="parse_error"}

# Rate of all errors
rate(oxla_query_errors_total[5m])
```

---

### Query Duration

| Metric | Type | Labels | Description |
|---|---|---|---|
| `oxla_query_duration_seconds` | Histogram | `stmt_type` | End-to-end query duration in seconds |
| `oxla_query_parse_duration_seconds` | Histogram | — | Time spent parsing SQL |
| `oxla_query_plan_duration_seconds` | Histogram | — | Time spent planning |
| `oxla_query_execute_duration_seconds` | Histogram | — | Time spent executing |

Sources: `src/monitoring/metrics/query_parse_duration.h`, `query_plan_duration.h`, `query_execute_duration.h` (k_name fields).

**Label values for `stmt_type`:** `select`, `insert`, `copy`, `other`

```promql
# 99th percentile query duration for SELECT statements
histogram_quantile(0.99, rate(oxla_query_duration_seconds_bucket{stmt_type="select"}[5m]))

# Average execution time
rate(oxla_query_execute_duration_seconds_sum[5m]) / rate(oxla_query_execute_duration_seconds_count[5m])
```

---

### Query Data Volume

| Metric | Type | Labels | Description |
|---|---|---|---|
| `oxla_query_rows_processed_total` | Counter | `direction` | Rows processed by queries |
| `oxla_query_rows_returned_total` | Counter | — | Rows sent back to clients |
| `oxla_query_bytes_processed_total` | Counter | `direction` | Bytes transferred in wire protocol |
| `oxla_sf_read_bytes` | Counter | `query`, `data_task` | Bytes read by single-file readers from storage |

**Label values for `direction`:** `read`, `written`

```promql
# Storage read throughput
rate(oxla_sf_read_bytes[5m])

# Data scan rate (rows per second)
rate(oxla_query_rows_processed_total{direction="read"}[1m])
```

---

### Admission Control

Admission control limits concurrency and queues queries when the system is under load. The configuration knobs are `resource_management.max_concurrent_queries` and `resource_management.query_queue_timeout` in the cluster config file (e.g. `config/Release/default_config.yml`).

| Metric | Type | Labels | Description |
|---|---|---|---|
| `oxla_admission_active_queries` | Gauge | — | Queries currently admitted and executing |
| `oxla_admission_enqueued_queries` | Gauge | — | Queries waiting in the admission queue |
| `oxla_admission_timeout_queries_failed_total` | Counter | — | Queries that timed out waiting for admission |
| `oxla_admission_wait_milliseconds` | Histogram | — | Time queries spent waiting in the admission queue |

```promql
# Is the admission queue building up?
oxla_admission_enqueued_queries > 0

# Admission timeout rate
rate(oxla_admission_timeout_queries_failed_total[5m])

# Average admission wait
rate(oxla_admission_wait_milliseconds_sum[5m]) / rate(oxla_admission_wait_milliseconds_count[5m])
```

---

### Memory

| Metric | Type | Labels | Description |
|---|---|---|---|
| `oxla_process_memory_total` | Gauge | — | Process RSS (Resident Set Size) in bytes |
| `oxla_current_max_capacity` | Gauge | — | Current calculated maximum memory capacity |

```promql
# Process RSS in GB
oxla_process_memory_total / 1e9

# RSS as fraction of configured max (if max is known)
oxla_process_memory_total / <memory_max_bytes>
```

---

### Storage / File I/O

| Metric | Type | Labels | Description |
|---|---|---|---|
| `oxla_sf_read_bytes` | Counter | `query`, `data_task` | Bytes read by single-file readers |
| `oxla_file_cache_use_total` | Counter | `use_type` ∈ {`hit`, `hit_on_retry`, `miss`, `cant_get_descriptor`, `cant_allocate_line`} | File cache hits/misses by access outcome |
| `oxla_file_flushed_total` | Counter | — | Files written/flushed to storage |
| `oxla_file_flush_duration_ms` | Histogram | — | Duration of file flush operations (milliseconds) |
| `oxla_db_event_journal_size` | Gauge | — | Current journal size |
| `oxla_readers_opened_total` / `oxla_readers_closed_total` | Counter | — | Lifecycle of file reader objects |
| `oxla_writers_opened_total` / `oxla_writers_closed_total` | Counter | — | Lifecycle of file writer objects |

Sources: `src/monitoring/metrics/file_cache_use.cpp` (label key `use_type`), `src/monitoring/metrics/` header files for k_name strings.

```promql
# File cache hit rate
rate(oxla_file_cache_use_total{use_type="hit"}[5m])
/
(rate(oxla_file_cache_use_total{use_type="hit"}[5m]) + rate(oxla_file_cache_use_total{use_type="miss"}[5m]))
```

---

### S3 / AWS

| Metric | Type | Description |
|---|---|---|
| `oxla_aws_bytes_downloaded_total` | Counter | Total bytes downloaded from AWS S3 |
| `oxla_s3_connections_started_total` | Counter | S3 connections opened |
| `oxla_s3_connections_finished_total` | Counter | S3 connections closed |

---

### Kafka Ingestion

| Metric | Type | Description |
|---|---|---|
| `oxla_kafka_messages_consumed_total` | Counter | Total Kafka messages successfully consumed |
| `oxla_kafka_messages_failed_total` | Counter | Kafka messages that failed to process |
| `oxla_kafka_bytes_consumed_total` | Counter | Total bytes consumed from Kafka |

```promql
# Kafka ingestion failure rate
rate(oxla_kafka_messages_failed_total[5m])

# Kafka throughput in messages/second
rate(oxla_kafka_messages_consumed_total[1m])
```

---

### Catalog Transactions

| Metric | Type | Description |
|---|---|---|
| `oxla_catalog_transactions_active` | Gauge | Number of currently active catalog transactions |
| `oxla_catalog_transactions_total` | Counter | Total catalog transactions started |

---

### DDL Operations

| Metric | Type | Labels | Description |
|---|---|---|---|
| `oxla_ddl_operations_total` | Counter | `ddl_type` | DDL operations by type |

**Label values for `ddl_type`:** `create`, `drop`, `alter`, `privilege`

---

### Task Scheduling

| Metric | Type | Labels | Description |
|---|---|---|---|
| `oxla_tasks_ongoing_total` | Gauge | `scheduler_role`, `file_task_type` | Background tasks currently executing |
| `oxla_tasks_scheduled_total` | Counter | — | Total tasks scheduled |
| `oxla_data_task_duration` | Histogram | — | Duration of data tasks (compaction, merge) |
| `oxla_scheduler_queries_running` | Gauge | — | Queries currently in the scheduler |
| `oxla_executor_tasks_running` | Gauge | — | Executor tasks currently running |

**Label values for `scheduler_role`:** `inserter`, `leader`
**Label values for `file_task_type`:** `compact`, `merge`

Source: `src/monitoring/metrics/tasks_ongoing.h`

---

### Thread Pool

| Metric | Type | Description |
|---|---|---|
| `oxla_thread_pool_size_total` | Gauge | Current thread pool size |
| `oxla_thread_pool_tasks_started` | Counter | Tasks submitted to thread pool |
| `oxla_thread_pool_tasks_finished` | Counter | Tasks completed by thread pool |

---

## Log Level Control

### Levels (ascending verbosity)

| Proto enum | Config string | plog severity | When to use |
|---|---|---|---|
| `LOG_LEVEL_NONE` | `"NONE"` | `none` | Silence all output |
| `LOG_LEVEL_FATAL` | `"FATAL"` | `fatal` | Crash-level errors only |
| `LOG_LEVEL_ERROR` | `"ERROR"` | `error` | Errors only |
| `LOG_LEVEL_WARNING` | `"WARNING"` | `warning` | Warnings and above |
| `LOG_LEVEL_INFO` | `"INFO"` | `info` | Normal operational output (default) |
| `LOG_LEVEL_DEBUG` | `"DEBUG"` | `debug` | Detailed internal flow |
| `LOG_LEVEL_VERBOSE` | `"VERBOSE"` | `verbose` | Very detailed — high volume |

### Log file location

Logs are written in parallel to stdout and to files under `$TMPDIR/oxla/` (defaults to `/tmp/oxla/` when `$TMPDIR` is unset):

```
$TMPDIR/oxla/server.<DATETIME>.<PID>.log
# Example (default): /tmp/oxla/server.20241015-093012.48291.log
```

Source: `src/util/plog.h` — `initPlog(plog::Severity max_severity)`

### Set level in config (requires process restart)

```yaml
# config/Release/default_config.yml (exact path is deployment-dependent)
logging:
  level: "DEBUG"   # one of: NONE, FATAL, ERROR, WARNING, INFO, DEBUG, VERBOSE
```

### Set level via environment variable (requires restart to pick up)

The OXLA env-override scheme uses `OXLA__` prefix with `__` as section separator:

```bash
OXLA__LOGGING__LEVEL=DEBUG ./oxla_server
```

### Set level at runtime via admin gRPC (no restart required)

The admin server listens on port 9090 (configurable via `admin_api.port` in config). It uses ConnectRPC over HTTP.

**Using grpcurl:**

```bash
# Get current log level
grpcurl -plaintext \
  -d '{}' \
  <host>:9090 \
  oxla.admin.v1.LoggingService/GetLogLevel

# Set to DEBUG
grpcurl -plaintext \
  -d '{"level": "LOG_LEVEL_DEBUG"}' \
  <host>:9090 \
  oxla.admin.v1.LoggingService/SetLogLevel

# Set back to INFO
grpcurl -plaintext \
  -d '{"level": "LOG_LEVEL_INFO"}' \
  <host>:9090 \
  oxla.admin.v1.LoggingService/SetLogLevel
```

**Using curl with ConnectRPC JSON encoding:**

```bash
# Set level to WARNING via HTTP POST
curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"level": "LOG_LEVEL_WARNING"}' \
  http://<host>:9090/oxla.admin.v1.LoggingService/SetLogLevel
```

Source: `src/admin/proto/logging.proto`, `src/admin/logging_service_impl.cpp`

The admin API is only available when `admin_api.enabled: true` (default) in config.

### Operational guidance

- Increase to `DEBUG` or `VERBOSE` only while actively investigating — these levels generate very high log volume.
- Return to `INFO` when investigation is complete using the runtime gRPC call (no restart needed).
- On multi-node clusters, set the level independently on each node via its admin port.
- The change takes effect immediately and is reflected in both stdout and the log file.
