---
name: sql-debugging
description: >-
  Diagnose and observe an Oxla distributed analytical database: query system
  catalog tables (system_nodes, system_queries, system_transactions,
  system_storage, system_execs), scrape Prometheus metrics from port 8080,
  change log levels at runtime via the admin gRPC service or config, monitor
  memory/OOM pressure, and follow troubleshooting workflows for slow queries
  and node health issues. Also covers debugging Oxla's external data sources:
  the Redpanda/Kafka ingestion path and the Apache Iceberg catalog Oxla reads
  (correlating stale-data or missing-row symptoms with the upstream Redpanda
  Iceberg Topics integration and its redpanda.iceberg.* / iceberg_* settings —
  an Enterprise-licensed Redpanda feature).
  Use when: troubleshooting Oxla, inspecting running queries or node health via
  system tables, scraping Prometheus metrics, changing log levels, diagnosing
  memory/OOM pressure, investigating slow or failed queries, checking cluster
  state, auditing storage connections and active transactions, or diagnosing
  Kafka/Redpanda ingestion stalls and stale or missing rows in Iceberg tables
  fed by Redpanda Iceberg Topics.
---

# Redpanda SQL: Debugging & Observability

Oxla is a closed-source C++ distributed columnar analytical database that speaks the PostgreSQL wire protocol. Its observability surface is three-layered: **system catalog virtual tables** (query via psql), a **Prometheus metrics endpoint** (HTTP on port 8080), and **structured log output** with a runtime-configurable level. There is no REST admin API — administration uses YAML config, environment variable overrides, a ConnectRPC admin service, and SQL system tables.

This skill covers the complete debugging workflow: from "what is running?" through "why is it slow?" to "is memory pressure causing OOM?".

## Quickstart

```bash
# 1. Connect to Oxla (PostgreSQL wire protocol, default port 5432)
psql -h <host> -p 5432 -U oxla

# 2. See all cluster nodes and their election state
SELECT name, election_state, connected_nodes_count, degradation_error
FROM system.nodes;

# 3. See active (and recently completed) queries across the cluster
SELECT qid, requester, state, created, accepted, scheduled, executed, finished
FROM system.queries
ORDER BY created DESC;

# 4. Scrape Prometheus metrics (no auth required by default)
curl -s http://<host>:8080/metrics | grep -E 'oxla_(query_errors|process_memory|num_nodes|admission)'
```

## System Catalog Tables

Oxla exposes virtual tables in the `system` schema for diagnostics. They are populated at query runtime — there is no materialized cache. See [system-tables.md](references/system-tables.md) for full column reference and example queries.

### Key tables at a glance

| Table | What it shows |
|---|---|
| `system.nodes` | Per-node election state, follower count, connected-node count, degradation error |
| `system.queries` | Query lifecycle (created → scheduling → scheduled → executing → finished), state, workers |
| `system.transactions` | Active catalog transactions (transaction_id, snapshot_id, owner node, owner name) |
| `system.storage_connections` | Storage connections (name, type, schema, database, parameters JSON) |
| `system.execs` | Per-node execution fragments (qid, data_task_id, state, memory bytes, privileged flag) |
| `system.catalogs` | External catalogs (Iceberg, Kafka/Redpanda) by name and type |
| `system.databases` | All databases accessible to the current role |
| `system.tables` | Tables by database, namespace, name |
| `system.columns` | Columns with type and nullability |
| `information_schema.tables` | Standard SQL information schema view of tables |
| `information_schema.columns` | Standard SQL information schema view of columns |

### Quick diagnostics

```sql
-- Is any node degraded?
SELECT name, election_state, degradation_error
FROM system.nodes
WHERE degradation_error IS NOT NULL;

-- What queries are stuck (not yet finished)?
SELECT qid, requester, state, created,
       EXTRACT(EPOCH FROM (NOW() - created)) AS age_seconds
FROM system.queries
WHERE finished IS NULL
ORDER BY created ASC;

-- Active catalog transactions (distributed catalog must be enabled)
SELECT * FROM system.transactions;
```

## Prometheus Metrics

The metrics endpoint listens on port 8080 (configured in `metrics.port` in the cluster config file, e.g. `config/Release/default_config.yml`). No authentication is required by default. All metric names are prefixed `oxla_`.

```bash
# Full scrape
curl -s http://<host>:8080/metrics

# Filter to health indicators
curl -s http://<host>:8080/metrics \
  | grep -E 'oxla_(cluster_has_leader|node_is_ready|node_is_degraded|num_nodes_connected)'

# Query error rate
curl -s http://<host>:8080/metrics | grep oxla_query_errors_total

# Memory usage
curl -s http://<host>:8080/metrics | grep oxla_process_memory_total
```

See [metrics-and-logging.md](references/metrics-and-logging.md) for the full metric catalog with types, labels, and Prometheus query examples.

## Log Levels

Oxla uses the `plog` library. Log levels in ascending verbosity order:

`FATAL` → `ERROR` → `WARNING` → `INFO` → `DEBUG` → `VERBOSE`

Default is `INFO`. Logs are written to stdout (with colors in TTY mode) and to files under `$TMPDIR/oxla/` (defaults to `/tmp/oxla/` when `$TMPDIR` is unset) with the path pattern `server.<DATETIME>.<PID>.log`.

### Set log level in config (requires restart)

```yaml
# config/Release/default_config.yml (exact path is deployment-dependent)
logging:
  level: "DEBUG"
```

Or via environment variable (no restart needed at launch; restart required to pick up env change):

```bash
OXLA__LOGGING__LEVEL=DEBUG ./oxla_server
```

### Set log level at runtime (no restart) via admin gRPC service

The admin gRPC service listens on port 9090 by default (configured in `admin_api.port`). It speaks ConnectRPC (HTTP/1.1 or HTTP/2 with protobuf or JSON encoding).

```bash
# Using grpcurl — set level to DEBUG
grpcurl -plaintext \
  -d '{"level": "LOG_LEVEL_DEBUG"}' \
  <host>:9090 \
  oxla.admin.v1.LoggingService/SetLogLevel

# Get current level
grpcurl -plaintext \
  -d '{}' \
  <host>:9090 \
  oxla.admin.v1.LoggingService/GetLogLevel
```

Valid `level` values: `LOG_LEVEL_NONE`, `LOG_LEVEL_FATAL`, `LOG_LEVEL_ERROR`, `LOG_LEVEL_WARNING`, `LOG_LEVEL_INFO`, `LOG_LEVEL_DEBUG`, `LOG_LEVEL_VERBOSE`.

See [metrics-and-logging.md](references/metrics-and-logging.md) for full details.

## Memory / OOM Monitoring

Oxla runs an internal `OOMMonitor` background thread that checks the process RSS (Resident Set Size) from `/proc/self/status` every 100 ms. When RSS exceeds the operational limit — `total - 1%` (the 1% margin is `k_oom_monitor_margin_factor = 0.01` from `src/mem/limits.h`), where `total` is the computed memory limit derived from `memory.max` or auto-detection — it triggers emergency actions: (1) cancel all running tasks/queries and (2) evict the storage cache, logging an allocation-state report.

The memory limit is set in config (config/Release/default_config.yml, exact path is deployment-dependent):

```yaml
memory:
  max: 0          # 0 = auto-detect available RAM; otherwise set explicitly (e.g. 16G)
  max_non_query: 6442M  # RAM reserved for non-query overhead; minimum 6442M
```

Monitor memory via Prometheus:

```bash
# Current process RSS in bytes
curl -s http://<host>:8080/metrics | grep oxla_process_memory_total

# Admission queue (queries waiting due to memory/concurrency limits)
curl -s http://<host>:8080/metrics \
  | grep -E 'oxla_admission_(active_queries|enqueued_queries|timeout_queries_failed_total)'
```

See [troubleshooting.md](references/troubleshooting.md) for the full OOM investigation workflow.

## Troubleshooting Workflows

| Symptom | First move |
|---|---|
| Queries stuck / not progressing | `system.queries` WHERE `finished IS NULL`; check `state` |
| Node not participating | `system.nodes` — look for `degradation_error IS NOT NULL` |
| Out-of-memory / process killed | `oxla_process_memory_total` metric; check `memory.max` config |
| Query admission failures / timeouts | `oxla_admission_timeout_queries_failed_total` metric |
| Kafka ingestion stalled | `oxla_kafka_messages_consumed_total` and `oxla_kafka_messages_failed_total` |
| Iceberg table stale / rows missing | Check upstream Redpanda `redpanda.iceberg.target.lag.ms`, DLQ table, REST catalog auth — see [redpanda-iceberg-source.md](references/redpanda-iceberg-source.md) |
| Storage reads slow | `oxla_sf_read_bytes` (single-file reader throughput) |
| No cluster leader | `oxla_cluster_has_leader_bool == 0` |
| Background tasks stalled | `oxla_tasks_ongoing_total{scheduler_role,file_task_type}` (compaction/merge) |

See [troubleshooting.md](references/troubleshooting.md) for step-by-step playbooks.

## External Data Sources: Redpanda / Kafka & Iceberg

Oxla ingests from external systems registered in `system.catalogs` (`type` is
`redpanda` for a Kafka-protocol connection, or `iceberg` for an Apache Iceberg
catalog). When ingestion stalls or an Iceberg table looks stale, the root cause is
frequently on the **Redpanda side**, in Redpanda's **Iceberg Topics** integration
— the producer of the Iceberg tables Oxla reads.

```sql
-- What external sources are registered, and of what type?
SELECT name, namespace_name, type FROM system.catalogs;
```

Redpanda Iceberg Topics (and its Tiered Storage prerequisite, and Server-Side
Schema ID Validation) are **Redpanda Enterprise Edition** features — without a
valid Redpanda license, topics cannot be created or modified with
`redpanda.iceberg.mode`. Verify on the Redpanda cluster with
`rpk cluster license info`.

Key upstream knobs to correlate with an Oxla symptom:

| Symptom in Oxla | Upstream Redpanda setting |
|---|---|
| Iceberg table stale / lags real time | `redpanda.iceberg.target.lag.ms` (commit cadence) |
| Rows silently missing | `redpanda.iceberg.invalid.record.action` (`drop` vs `dlq_table`) + the `<topic>~dlq` table |
| Table cannot be loaded | `iceberg_catalog_type=rest` auth keys (`iceberg_rest_catalog_*`) |
| Table vanished after topic delete | `redpanda.iceberg.delete` (default `true`) |
| No Iceberg data ever produced | `iceberg_enabled`, Enterprise license, Tiered Storage prerequisite |

Full property tables (cluster-level `iceberg_*`, topic-level `redpanda.iceberg.*`,
REST catalog auth keys, DLQ inspection, and the symptom-to-cause checklist) are in
[redpanda-iceberg-source.md](references/redpanda-iceberg-source.md).

## Reference Directory

- [system-tables.md](references/system-tables.md): Full column schema for every diagnostic system catalog table, with copy-pasteable example queries for node health, active queries, transactions, storage connections, and execution fragments.
- [metrics-and-logging.md](references/metrics-and-logging.md): Prometheus endpoint setup, the complete metric catalog (names, types, labels, descriptions), log level control via config/env/admin gRPC, and example PromQL queries.
- [troubleshooting.md](references/troubleshooting.md): Step-by-step workflows for diagnosing slow queries, memory/OOM pressure, node health problems, Kafka ingestion issues, and admission control failures.
- [redpanda-iceberg-source.md](references/redpanda-iceberg-source.md): Debugging Oxla's external data sources — the Redpanda/Kafka ingestion path and the Apache Iceberg catalog Oxla reads. Documents the upstream Redpanda **Iceberg Topics** integration (Enterprise-licensed): cluster properties (`iceberg_enabled`, `iceberg_catalog_type`, `iceberg_default_catalog_namespace`, `iceberg_delete`, `iceberg_invalid_record_action`, `iceberg_default_partition_spec`), REST catalog auth keys (`iceberg_rest_catalog_*`), topic properties (`redpanda.iceberg.mode`/`delete`/`invalid.record.action`/`partition.spec`/`target.lag.ms`), Schema ID Validation interplay, the `<topic>~dlq` dead-letter queue, and an Oxla-symptom-to-Redpanda-cause checklist. Notes the Enterprise license requirement.
