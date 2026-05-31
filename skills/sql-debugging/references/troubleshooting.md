# Oxla Troubleshooting Playbooks

---

## Playbook 1: Investigate a Slow or Stuck Query

### Step 1 — Find the query in system.queries

```sql
-- Active queries, oldest first
SELECT qid, requester, scheduler, state,
       workers,
       EXTRACT(EPOCH FROM (NOW() - created)) AS age_seconds,
       created, accepted, scheduled, executed
FROM system.queries
WHERE finished IS NULL
ORDER BY created ASC;
```

If a query has been running for unexpectedly long, note its `qid` and `state`.

**State interpretation** (actual `state` column values from `src/scheduler/states/context.cpp` and `src/executor/executor.cpp`):

| State | Meaning |
|---|---|
| `created` | Received by the requester node, not yet admitted |
| `scheduling` | Being processed by the admission/scheduler |
| `scheduled` | Picked up by the scheduler on a worker node |
| `executing` | Execution started |
| `cancelling` | Cancellation in progress |
| `cleanup` | Post-execution cleanup |
| `ready` | Ready to execute |
| `finished` | Completed (and visible in system.queries for a short period) |

Note: `accepted` and `executed` are **timestamp column names** in the schema, not `state` values.

A query stuck in `created` or `scheduling` for a long time suggests admission control pressure (see Playbook 3).

### Step 2 — Check per-node execution fragments

```sql
-- Execution fragments for the specific query
SELECT node, data_task_id, state, memory, privileged
FROM system.execs
WHERE qid = '<qid-from-step-1>'
ORDER BY memory DESC;

-- Total memory used by that query
SELECT SUM(memory) AS total_bytes
FROM system.execs
WHERE qid = '<qid-from-step-1>';
```

### Step 3 — Check Prometheus metrics for execution patterns

```bash
# Query error counters — are there oom or execution errors?
curl -s http://<host>:8080/metrics | grep oxla_query_errors_total

# Is the admission queue backed up?
curl -s http://<host>:8080/metrics \
  | grep -E 'oxla_admission_(active|enqueued|timeout)'

# How many queries are ongoing right now?
curl -s http://<host>:8080/metrics | grep oxla_net_postgres_queries_ongoing
```

### Step 4 — Query duration histograms

```bash
# p99 duration for select queries (requires Prometheus server)
# histogram_quantile(0.99, rate(oxla_query_duration_seconds_bucket{stmt_type="select"}[5m]))

# Without a Prometheus server, look at individual components
curl -s http://<host>:8080/metrics | grep -E 'oxla_query_(parse|plan|execute)_duration_seconds'
```

### Step 5 — Look at storage read throughput

```bash
# Are single-file reads progressing?
curl -s http://<host>:8080/metrics | grep oxla_sf_read_bytes

# Is the file cache hit rate reasonable?
curl -s http://<host>:8080/metrics | grep oxla_file_cache_use_total
```

### Step 6 — Increase log level for targeted investigation

```bash
# Runtime — no restart required
grpcurl -plaintext \
  -d '{"level": "LOG_LEVEL_DEBUG"}' \
  <host>:9090 \
  oxla.admin.v1.LoggingService/SetLogLevel

# Watch the log file ($TMPDIR defaults to /tmp when unset)
tail -f ${TMPDIR:-/tmp}/oxla/server.*.log | grep -i "<qid-substring>"

# When done, reset to INFO
grpcurl -plaintext \
  -d '{"level": "LOG_LEVEL_INFO"}' \
  <host>:9090 \
  oxla.admin.v1.LoggingService/SetLogLevel
```

---

## Playbook 2: Diagnose Memory / OOM Pressure

### Background

Oxla's `OOMMonitor` runs a background thread every 100 ms that reads the process RSS from `/proc/self/status` (the `_status_file_path` member points to this file — it is the RSS source, not a file the monitor writes). When RSS exceeds the operational limit — `total - 1%` (margin factor `k_oom_monitor_margin_factor = 0.01`, from `src/mem/limits.h`), where `total` is the computed memory limit derived from `memory.max` or auto-detection — it takes emergency action:

1. Cancels all running tasks/queries.
2. Evicts the entire storage cache.
3. Logs an allocation-state report.

Memory is configured in `config/Release/default_config.yml` (exact path is deployment-dependent):

```yaml
memory:
  max: 0            # 0 = auto-detect available RAM; set explicitly if needed (e.g. 16G)
  max_non_query: 6442M  # memory reserved for non-query overhead; must be at least 6442M
```

### Step 1 — Check current RSS

```bash
curl -s http://<host>:8080/metrics | grep oxla_process_memory_total
# Output example: oxla_process_memory_total{} 17179869184
# That's 17 GB RSS
```

### Step 2 — Check admission control — are queries being queued due to load?

```bash
curl -s http://<host>:8080/metrics \
  | grep -E 'oxla_admission_(active_queries|enqueued_queries|timeout_queries_failed_total)'
```

- If `oxla_admission_enqueued_queries > 0` and is growing, the system is under load.
- If `oxla_admission_timeout_queries_failed_total` is increasing, queries are timing out waiting for admission — reduce the query load or increase `resource_management.max_concurrent_queries` (with caution).

### Step 3 — Check for OOM-caused query errors

```bash
curl -s http://<host>:8080/metrics | grep 'oxla_query_errors_total.*oom'
```

An increasing `oom` count in `oxla_query_errors_total` confirms the OOM monitor is firing.

### Step 4 — Look at admission wait times

```bash
curl -s http://<host>:8080/metrics | grep oxla_admission_wait_milliseconds
```

Long admission waits indicate the system is near capacity.

### Step 5 — Tune memory config

If OOM events are recurring, set an explicit memory limit that leaves headroom for the OS and other processes:

```yaml
memory:
  max: 12G        # Example: 12 GB on a 16 GB machine
  max_non_query: 6442M
```

Adjust `resource_management.max_concurrent_queries` to reduce peak concurrent memory usage:

```yaml
resource_management:
  max_concurrent_queries: 50     # Default is 100; reduce under memory pressure
  query_queue_timeout: 30 s      # How long a query waits before admission timeout
```

### Step 6 — Identify memory-hungry queries

Use `system.execs` to find which query fragments are using the most memory:

```sql
SELECT qid, SUM(memory) AS total_memory_bytes
FROM system.execs
GROUP BY qid
ORDER BY total_memory_bytes DESC;
```

---

## Playbook 3: Diagnose Node Health / Cluster State

### Step 1 — Check node states

```sql
-- Full node overview
SELECT name, election_state, followers_count, connected_nodes_count, degradation_error
FROM system.nodes;
```

**What to look for:**

- `election_state` should be `Leader` for exactly one node and `Follower` for all others.
- `connected_nodes_count` should be `(total_nodes - 1)` on each node.
- `degradation_error IS NOT NULL` — a degraded node needs immediate attention.
- No node shows `Leader` → cluster has lost quorum.

### Step 2 — Check the cluster leader metric

```bash
curl -s http://<host>:8080/metrics | grep oxla_cluster_has_leader_bool
# Expected: oxla_cluster_has_leader_bool{} 1
```

If this is 0, the cluster has no leader and queries will fail or block.

### Step 3 — Check node ready/degraded status via Prometheus

```bash
curl -s http://<host>:8080/metrics \
  | grep -E 'oxla_node_is_(leader|ready|degraded)_bool'
```

Expected steady state per node:
- `oxla_node_is_ready_bool{} 1`
- `oxla_node_is_degraded_bool{} 0`
- `oxla_node_is_leader_bool{} 1` on exactly one node.

### Step 4 — Check connected peer count

```bash
curl -s http://<host>:8080/metrics | grep oxla_num_nodes_connected
```

If this drops below `(total_nodes - 1)` on any node, there is a network partition or a node is down.

### Step 5 — Check logs on the degraded node

```bash
# Look at the log file on the suspect node ($TMPDIR defaults to /tmp when unset)
tail -200 ${TMPDIR:-/tmp}/oxla/server.*.log | grep -E 'ERROR|FATAL|degraded'

# Or temporarily enable debug logging to get more context
grpcurl -plaintext \
  -d '{"level": "LOG_LEVEL_DEBUG"}' \
  <host>:9090 \
  oxla.admin.v1.LoggingService/SetLogLevel
```

### Step 6 — Network partition check

If multiple nodes show low `connected_nodes_count`:

```bash
# On each node: can it reach other cluster nodes on port 5771 (inter-node)?
nc -zv <other-node-ip> 5771

# Check the heartbeat timeout in config (default: 60 seconds)
# If heartbeat.timeout elapses without a response, the node is considered disconnected
```

---

## Playbook 4: Kafka Ingestion Stalled

If data is not flowing from Kafka into Oxla:

### Step 1 — Check Kafka metrics

```bash
curl -s http://<host>:8080/metrics \
  | grep -E 'oxla_kafka_(messages_consumed|messages_failed|bytes_consumed)'
```

If `oxla_kafka_messages_consumed_total` is not increasing, ingestion has stopped.
If `oxla_kafka_messages_failed_total` is increasing, there are message processing errors.

### Step 2 — Check catalog entries

```sql
-- Are the Kafka connections registered?
SELECT * FROM system.catalogs WHERE type = 'redpanda';

-- Are the Kafka tables visible?
SELECT * FROM system.tables WHERE namespace_name IN (
  SELECT namespace_name FROM system.catalogs WHERE type = 'redpanda'
);
```

### Step 3 — Enable debug logging for Kafka-related messages

```bash
grpcurl -plaintext \
  -d '{"level": "LOG_LEVEL_DEBUG"}' \
  <host>:9090 \
  oxla.admin.v1.LoggingService/SetLogLevel

tail -f ${TMPDIR:-/tmp}/oxla/server.*.log | grep -i kafka
```

Look for connection errors, authentication failures, or consumer group rebalance issues.

### Step 4 — If the source is a Redpanda Iceberg Topic, check the upstream side

If `system.catalogs` shows an `iceberg` (or `redpanda`) source and the table looks
stale or rows are missing, the cause is often on the Redpanda cluster, not in Oxla.
See [redpanda-iceberg-source.md](redpanda-iceberg-source.md) for the full
symptom-to-cause checklist: `redpanda.iceberg.target.lag.ms` (commit cadence),
the `<topic>~dlq` dead-letter table, `redpanda.iceberg.invalid.record.action`,
`iceberg_enabled` / Enterprise license / Tiered Storage prerequisite, and REST
catalog auth (`iceberg_rest_catalog_*`).

---

## Playbook 5: Query Admission Timeouts

Symptoms: queries return errors immediately without executing, or wait a long time before failing.

### Step 1 — Check admission metrics

```bash
curl -s http://<host>:8080/metrics \
  | grep -E 'oxla_admission_(active|enqueued|timeout|wait)'
```

- `oxla_admission_enqueued_queries` persistently > 0 → queue is backed up
- `oxla_admission_timeout_queries_failed_total` increasing → queries are timing out

### Step 2 — Check current active queries

```sql
SELECT COUNT(*) AS active_query_count
FROM system.queries
WHERE finished IS NULL;
```

Compare against `resource_management.max_concurrent_queries` (default: 100).

### Step 3 — Check if specific queries are holding the system

```sql
-- Long-running queries that should be investigated
SELECT qid, requester, state,
       EXTRACT(EPOCH FROM (NOW() - created)) AS age_seconds
FROM system.queries
WHERE finished IS NULL
ORDER BY age_seconds DESC
LIMIT 10;
```

### Step 4 — Adjust admission config

```yaml
# config/Release/default_config.yml (exact path is deployment-dependent)
resource_management:
  max_concurrent_queries: 50    # Reduce to reduce memory pressure
  query_queue_timeout: 60 s     # Increase timeout if queries are worth waiting for
```

Reload the config by restarting the node (there is no live config reload for these parameters).

---

## Playbook 6: Storage / S3 Issues

### Step 1 — Check file I/O metrics

```bash
curl -s http://<host>:8080/metrics \
  | grep -E 'oxla_(sf_read_bytes|file_cache_use|aws_bytes|s3_connections)'
```

- `oxla_sf_read_bytes` not increasing → reads are stalled
- `oxla_file_cache_use_total{use_type="miss"}` high → poor cache hit rate (too small cache or first-access scan)
- `oxla_s3_connections_started_total` / `oxla_s3_connections_finished_total` — track connection lifecycle

### Step 2 — Check storage connections

```sql
SELECT name, type, parameters FROM system.storage_connections;
```

Verify that the expected storage backend is registered with the correct endpoint and parameters.

### Step 3 — Check active file readers/writers

```bash
curl -s http://<host>:8080/metrics \
  | grep -E 'oxla_(readers|writers)_(opened|closed)_total'

# Calculate open readers: opened - closed
```

---

## Quick-Reference Diagnostic Checklist

Run this sequence whenever Oxla is behaving unexpectedly:

```bash
# 1. Is the cluster healthy? (Prometheus)
curl -s http://<host>:8080/metrics \
  | grep -E 'oxla_(cluster_has_leader|node_is_ready|node_is_degraded|num_nodes_connected)'

# 2. Any query errors? (Prometheus)
curl -s http://<host>:8080/metrics | grep oxla_query_errors_total

# 3. Memory pressure? (Prometheus)
curl -s http://<host>:8080/metrics | grep oxla_process_memory_total

# 4. Admission queue? (Prometheus)
curl -s http://<host>:8080/metrics | grep oxla_admission_enqueued_queries
```

```sql
-- 5. Node health (psql)
SELECT name, election_state, degradation_error FROM system.nodes;

-- 6. Stuck queries (psql)
SELECT qid, requester, state,
       EXTRACT(EPOCH FROM (NOW() - created)) AS age_seconds
FROM system.queries
WHERE finished IS NULL
ORDER BY age_seconds DESC;
```

If the above does not yield a clear root cause, increase the log level to DEBUG on the suspect node:

```bash
grpcurl -plaintext \
  -d '{"level": "LOG_LEVEL_DEBUG"}' \
  <host>:9090 \
  oxla.admin.v1.LoggingService/SetLogLevel
```

And monitor `${TMPDIR:-/tmp}/oxla/server.*.log` for error or warning messages.

Cross-reference [sql-admin-api](../../sql-admin-api/SKILL.md) for configuration details and [sql](../../sql/SKILL.md) for writing queries against these tables.
