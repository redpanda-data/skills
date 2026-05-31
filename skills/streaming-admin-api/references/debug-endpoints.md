# Debug and Debug Bundle Endpoints

Reference for `/v1/debug/*` and `/v1/debug/bundle` endpoints. These are primarily used for diagnostics, performance profiling, and collecting support bundles.

For a full triage workflow, cross-reference the `streaming-debugging` skill.

---

## CPU Profiling

### Get CPU Profile Samples

```bash
# Wait 5 seconds for profiler samples, then return results
curl "http://localhost:9644/v1/debug/cpu_profile?wait_ms=5000"

# Get profile for a specific shard only
curl "http://localhost:9644/v1/debug/cpu_profile?shard=0&wait_ms=5000"
```

Query parameters:
- `wait_ms` (optional long) — how long to wait before reading samples in milliseconds
- `shard` (optional long) — restrict to a specific CPU shard

Response schema (`cpu_profile_result`):

```json
{
  "schema": 1,
  "arch": "amd64",
  "version": "v25.1.2 - abc123",
  "wait_ms": 5000,
  "sample_period_ms": 10,
  "profile": [
    {
      "shard_id": 0,
      "dropped_samples": 0,
      "samples": [
        {
          "user_backtrace": "storage::log_reader::do_load_slice ... (truncated)",
          "scheduling_group": "kafka",
          "occurrences": 142
        }
      ]
    }
  ]
}
```

Fields:
- `arch` — `amd64` or `arm64`
- `sample_period_ms` — configured sampling period per shard
- `dropped_samples` — samples lost due to buffer overflow during the measurement window
- `user_backtrace` — symbol string for the call stack
- `scheduling_group` — the Seastar scheduling group (e.g., `kafka`, `raft`, `admin`)
- `occurrences` — how many times this backtrace was sampled

High `occurrences` in a specific scheduling group indicates CPU pressure in that subsystem.

---

## Disk Statistics

### Get Disk Stats

```bash
# Get data directory disk stats
curl "http://localhost:9644/v1/debug/storage/disk_stat/data"

# Get tiered-storage cache disk stats
curl "http://localhost:9644/v1/debug/storage/disk_stat/cache"
```

The `{type}` path parameter must be exactly `data` (the primary data directory) or `cache` (the tiered-storage cache directory). Any other value returns HTTP 400 bad_param. Response schema (`disk_stat`):

```json
{
  "total_bytes": 107374182400,
  "free_bytes": 49283072000
}
```

This is the **effective** disk stat used by Redpanda's storage subsystem — it may differ from OS-reported values if overrides have been applied.

### Override Disk Stats (Testing Only)

Used to simulate disk pressure in test environments:

```bash
curl -u admin:secret -X PUT "http://localhost:9644/v1/debug/storage/disk_stat/data" \
  -H "Content-Type: application/json" \
  -d '{"free_bytes": 1048576}'
```

Body fields (`disk_stat_overrides`):
- `total_bytes` — override total size
- `free_bytes` — override free size (absolute)
- `free_bytes_delta` — adjust free size by a signed delta

### Get Local Storage Usage

Detailed breakdown of local disk usage:

```bash
curl "http://localhost:9644/v1/debug/local_storage_usage"
```

Response:
```json
{
  "data": 10737418240,
  "index": 52428800,
  "compaction": 0,
  "cloud_storage_cache_bytes": 1073741824,
  "cloud_storage_cache_objects": 512,
  "reclaimable_by_retention": 536870912,
  "target_min_capacity": 5368709120,
  "target_min_capacity_wanted": 5368709120
}
```

### Get Total Cloud Storage Usage

```bash
curl "http://localhost:9644/v1/debug/cloud_storage_usage"
```

Returns a long: total bytes across all partitions in cloud/tiered storage. Optional query params:
- `retries_allowed` — how many retries to allow when querying partitions
- `batch_size` — partitions to query per batch

---

## Partition Debug State

### Get Low-Level Partition State

Returns Raft and storage state for all replicas of a partition across all nodes:

```bash
# Kafka partition
curl "http://localhost:9644/v1/debug/partition/kafka/my-topic/0"

# Internal Redpanda partition
curl "http://localhost:9644/v1/debug/partition/redpanda/controller/0"
```

Response schema (`partition_state`): Contains `ntp` and an array of `partition_replica_state`, one per replica. Each replica state includes:

**Storage state:**
- `start_offset`, `committed_offset`, `last_stable_offset`, `high_watermark`, `dirty_offset`
- `log_size_bytes`, `non_log_disk_size_bytes`
- `is_read_replica_mode_enabled`, `is_remote_fetch_enabled`, `is_cloud_data_available`
- `start_cloud_offset`, `next_cloud_offset`
- `iceberg_mode`

**Raft state** (nested `raft_state`):
- `node_id`, `term`, `commit_index`, `flushed_offset`
- `is_leader`, `is_elected_leader`
- `write_caching_enabled`, `flush_ms`, `flush_bytes`
- `followers` — array of follower state (match_index, heartbeats_failed, ms_since_last_heartbeat, is_recovering)
- `stms` — attached state machine snapshots
- `follower_recovery_state` — if in recovery: `is_active`, `pending_offset_count`

### Get Producer Debug State

```bash
curl "http://localhost:9644/v1/debug/producers/kafka/my-topic/0"

# Limit number of producers returned
curl "http://localhost:9644/v1/debug/producers/kafka/my-topic/0?limit=10"
```

Response (`partition_producers`):
- `total_producer_count` — all producers tracked by the partition leader
- `producers` — array of `partition_producer_state` (id, epoch, in-flight/finished idempotent requests, transaction state)

---

## Controller Status

```bash
curl "http://localhost:9644/v1/debug/controller_status"
```

Response (`controller_status`):

| Field | Description |
|-------|-------------|
| `start_offset` | Start offset of the controller log |
| `last_applied_offset` | Last offset applied to the controller state machine |
| `committed_index` | Committed index in the controller Raft consensus group |
| `dirty_offset` | Controller log dirty offset (not yet flushed) |

If `committed_index` is much higher than `last_applied_offset`, the controller is behind applying entries.

---

## Self-Test (Disk/Network Benchmarks)

The self-test runs disk and network throughput benchmarks across all brokers.

### Start Self-Test

```bash
curl -u admin:secret -X POST "http://localhost:9644/v1/debug/self_test/start" \
  -H "Content-Type: application/json" \
  -d '{}'
```

You can pass a JSON body to configure which tests to run and parameters:
```json
{
  "tests": [
    {"type": "disk", "skip": false, "duration_ms": 5000, "parallelism": 4, "request_size": 4096},
    {"type": "network", "skip": false, "duration_ms": 5000, "request_size": 8192}
  ]
}
```

> **Note**: The `{"tests": [...]}` request body shape is not described in the Swagger spec (`api-doc/debug.json` defines no body model for `self_test_start`). The structure above is derived from `rpk` behavior and cluster source code, not the Swagger definition.

Returns HTTP 200 on success or 503 if the test fails to start.

### Stop Self-Test

```bash
curl -u admin:secret -X POST "http://localhost:9644/v1/debug/self_test/stop"
```

### Query Self-Test Status / Results

```bash
curl "http://localhost:9644/v1/debug/self_test/status"
```

Returns an array of `self_test_node_report` — one per broker:

```json
[
  {
    "node_id": 1,
    "status": "idle",
    "stage": "idle",
    "results": [
      {
        "test_id": "abc-uuid",
        "name": "512 KiB sequential write",
        "test_type": "disk",
        "p50": 123,
        "p90": 456,
        "p99": 890,
        "p999": 1200,
        "max_latency": 1500,
        "rps": 1024,
        "bps": 536870912,
        "timeouts": 0,
        "start_time": 1700000000000,
        "end_time": 1700000005000,
        "duration": 5000
      }
    ]
  }
]
```

Node `status` values: `idle`, `running`, `unreachable`.
Node `stage` values: `idle`, `net`, `disk`, `cloud`.

Latency values (p50/p90/p99/p999/max_latency) are in **microseconds**.
`rps` = requests per second, `bps` = bytes per second.
`timeouts` = number of I/O timeouts during the run.

---

## Node Isolation Check

Check whether this node considers itself isolated from the cluster:

```bash
curl "http://localhost:9644/v1/debug/is_node_isolated"
```

Returns a boolean. If `true`, the node cannot reach its peers.

---

## Peer Status

Check when this node last heard from a peer:

```bash
curl "http://localhost:9644/v1/debug/peer_status/2"
```

Response: `{"since_last_status": <milliseconds>}`. A large value indicates the peer may be down or unreachable.

---

## Partition Leaders Table

Get a snapshot of the partition leaders table on this node:

```bash
curl "http://localhost:9644/v1/debug/partition_leaders_table"
```

Returns an array of `leader_info`:
```json
[
  {
    "ns": "kafka",
    "topic": "my-topic",
    "partition_id": 0,
    "leader": 1,
    "previous_leader": 2,
    "last_stable_leader_term": 5,
    "update_term": 5,
    "partition_revision": 3
  }
]
```

---

## Sampled Memory Profile

Get the sampled live memory allocation profile:

```bash
# All shards
curl "http://localhost:9644/v1/debug/sampled_memory_profile"

# Specific shard
curl "http://localhost:9644/v1/debug/sampled_memory_profile?shard=0"
```

Returns an array of `memory_profile` per shard, each with `allocation_sites`:
- `size` — upscaled bytes currently allocated at this site
- `count` — number of live allocations
- `backtrace` — call stack string

---

## Debug Bundle via HTTP

The Admin API can start, monitor, and serve debug bundles — useful for automating bundle collection without using `rpk`.

### Start a Debug Bundle

```bash
curl -u admin:secret -X POST "http://localhost:9644/v1/debug/bundle" \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "my-bundle-job-uuid",
    "config": {
      "logs_since": "2024-01-01",
      "logs_until": "2024-01-02",
      "cpu_profiler_wait_seconds": 30,
      "metrics_samples": 5,
      "metrics_interval_seconds": 10
    }
  }'
```

`job_id` is a UUID string you provide. If a bundle is already running, returns HTTP 409.

Config parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `logs_since` | string | journalctl-format date for log start (e.g., `"yesterday"`, `"2024-01-01"`) |
| `logs_until` | string | journalctl-format date for log end |
| `logs_size_limit_bytes` | integer | Maximum log size to collect |
| `controller_logs_size_limit_bytes` | integer | Maximum controller log size |
| `cpu_profiler_wait_seconds` | integer | Seconds to run CPU profiler |
| `metrics_samples` | integer | Number of metrics samples to collect |
| `metrics_interval_seconds` | integer | Interval between metrics samples |
| `partition` | string | Specific partition to include extra data for |
| `tls_enabled` | boolean | Use TLS when connecting internally |
| `tls_insecure_skip_verify` | boolean | Skip TLS certificate verification |
| `namespace` | string | Kubernetes namespace filter |
| `label_selector` | array | K8s label selectors `[{"key": "app", "value": "redpanda"}]` |
| `authentication` | object | SASL credentials: `mechanism`, `username`, `password` or `token` |

### Check Bundle Status

```bash
curl -u admin:secret "http://localhost:9644/v1/debug/bundle"
```

Returns a `get_bundle_status` object with the current state.

### Abort a Running Bundle

```bash
curl -u admin:secret -X DELETE "http://localhost:9644/v1/debug/bundle/my-bundle-job-uuid"
```

Returns HTTP 204 on success. HTTP 409 if the job is not currently running.

### Download the Completed Bundle

First get the status to find the filename, then download:

```bash
curl -u admin:secret \
  "http://localhost:9644/v1/debug/bundle/file/bundle_2024-01-15_10-30-00.zip" \
  -o debug-bundle.zip
```

### Delete the Bundle File

After downloading:
```bash
curl -u admin:secret -X DELETE \
  "http://localhost:9644/v1/debug/bundle/file/bundle_2024-01-15_10-30-00.zip"
```

---

## Additional Debug Endpoints

### Reset Leader Info Cache

Clears this node's cached leader information:

```bash
curl -u admin:secret -X POST "http://localhost:9644/v1/debug/reset_leaders"
```

### Refresh Disk Health Info

Force a refresh of disk health information used by the partition balancer:

```bash
curl -u admin:secret -X POST "http://localhost:9644/v1/debug/refresh_disk_health_info"
```

### Get Broker UUID

```bash
curl "http://localhost:9644/v1/debug/broker_uuid"
```

Returns `{"node_uuid": "...", "node_id": 1}`.

### Offset Translator

Get Redpanda offset → Kafka offset mappings for a partition (advanced diagnostics):

```bash
curl "http://localhost:9644/v1/debug/storage/offset_translator/kafka/my-topic/0"
```

Optional `?translate_to=kafka` or `?translate_to=redpanda` to specify translation direction.

---

## Security Note

Most `/v1/debug/*` endpoints require **superuser** access. The self-test endpoints write to disk and network, so they have operational impact — do not run them on a production cluster unless you understand the implications.

The debug bundle collects logs, metrics, and potentially sensitive configuration — treat the resulting ZIP accordingly.
