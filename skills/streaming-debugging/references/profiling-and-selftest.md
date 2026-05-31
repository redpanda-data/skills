# CPU Profiling, Disk Stat, Self-Test, and Controller Status

Deep diagnostic tools available through the Redpanda Admin API (port 9644)
and the `rpk cluster self-test` CLI.

---

## CPU Profiling

The Admin API exposes a built-in CPU profiler via the `/v1/debug/cpu_profile`
endpoint. It samples CPU across all Seastar shards.

### Endpoint

```
GET /v1/debug/cpu_profile
```

Query parameters:
- `wait_ms` (optional, long) — milliseconds to collect samples; Seastar samples
  every ~13 seconds, so use at least 15000 (15s). The debug bundle default
  (`--cpu-profiler-wait`) is 30s.
- `shard` (optional, long) — collect from a single shard only; omit for all shards

### Usage

```bash
# 30 seconds of CPU profile (all shards)
curl -s "http://localhost:9644/v1/debug/cpu_profile?wait_ms=30000" \
  > cpu_profile.json

# Single shard (0-indexed)
curl -s "http://localhost:9644/v1/debug/cpu_profile?shard=0&wait_ms=30000" \
  > cpu_profile_shard0.json

# View top samples per shard by occurrences
cat cpu_profile.json | jq \
  '.profile[] | {shard: .shard_id, top: (.samples | sort_by(-.occurrences) | .[0:10])}'
```

### Interpreting the output

The response is a JSON **object** (not an array) with top-level fields:

- `schema`, `arch`, `version` — metadata about the profile format
- `wait_ms` — the collection duration requested
- `sample_period_ms` — Seastar's sampling interval (~13s)
- `profile` — array of per-shard objects (`cpu_profile_shard_samples`)

Each shard object has:

- `shard_id` — zero-based Seastar shard index
- `dropped_samples` — samples dropped due to buffer overflow
- `samples` — array of `cpu_profile_sample` objects

Each sample has:

- `user_backtrace` — call stack (list of frame addresses or symbols)
- `scheduling_group` — Seastar scheduling group name (e.g., `raft`, `kafka`)
- `occurrences` — how many times this exact stack was sampled

High `occurrences` stacks indicate where CPU time is being spent. Common hot
paths in a healthy cluster include fsync/write system calls (disk I/O path),
Kafka protocol parsing, and Raft log appends. Unexpected hot paths (excessive
allocation, lock contention) are worth escalating to Redpanda support.

---

## Sampled Memory Profile

```bash
# Live memory samples for all shards
curl -s "http://localhost:9644/v1/debug/sampled_memory_profile" | jq

# For a specific shard
curl -s "http://localhost:9644/v1/debug/sampled_memory_profile?shard=0" | jq
```

Returns a list of `memory_profile` objects per shard showing where memory is
currently allocated. Useful when `redpanda_memory_available_memory` is low
and you need to find the large allocator.

---

## Disk Stat

The `/v1/debug/storage/disk_stat/{type}` endpoint returns disk space statistics.

### Endpoint

```
GET /v1/debug/storage/disk_stat/{type}
```

Path parameter `type` selects the disk partition to query:
- `data` — the Redpanda data directory disk
- `cache` — the Tiered Storage cache directory disk (if configured separately)

```bash
# Data disk stats
curl -s http://localhost:9644/v1/debug/storage/disk_stat/data | jq

# Cache disk stats
curl -s http://localhost:9644/v1/debug/storage/disk_stat/cache | jq
```

Example output:
```json
{
  "total_bytes": 107374182400,
  "free_bytes": 42949672960
}
```

Fields:
- `total_bytes` — total capacity of the disk in bytes
- `free_bytes` — free (available) bytes on the disk

### Force refresh disk health info

The Admin API also exposes an endpoint to force a refresh of the node's
internal disk health state (useful after manually freeing space):

```bash
curl -s -X POST http://localhost:9644/v1/debug/refresh_disk_health_info
```

---

## Controller Status

The controller log tracks all cluster configuration changes (topic creation,
partition moves, broker membership). A healthy controller log should be making
continuous progress.

```bash
GET /v1/debug/controller_status
```

```bash
curl -s http://localhost:9644/v1/debug/controller_status | jq
```

Example output:
```json
{
  "last_applied_offset": 12345,
  "committed_index": 12345
}
```

- `last_applied_offset` — the highest offset that has been applied to the
  in-memory state machine on this node
- `committed_index` — the highest offset committed by the Raft quorum

In a healthy cluster `committed_index >= last_applied_offset` and both are
advancing. If `committed_index` is stuck, the controller Raft group has lost
quorum. If `last_applied_offset` is far behind `committed_index`, this node's
state machine is lagging.

---

## Partition Leader Table

Lists the partition leaders known to this broker's in-memory table.

```bash
GET /v1/debug/partition_leaders_table
```

```bash
# All partition leaders (fields: ns, topic, partition_id, leader, previous_leader,
# last_stable_leader_term, update_term, partition_revision)
curl -s http://localhost:9644/v1/debug/partition_leaders_table | jq '.[0:10]'

# Summarize leader count per broker
curl -s http://localhost:9644/v1/debug/partition_leaders_table | jq \
  'group_by(.leader) | map({broker: .[0].leader, partition_count: length}) | sort_by(-.partition_count)'
```

Use this to spot leadership imbalances across brokers.

---

## Cluster Self-Test

`rpk cluster self-test` runs hardware benchmarks to verify disk and network
performance against vendor specs. Run it when you suspect hardware is the
bottleneck (not Redpanda configuration).

### What it tests

- **Disk tests**: concurrent sequential reads and writes; measures throughput
  (bytes/s), latency, and IOPS
- **Network tests**: unique pairs of brokers as client/server; measures
  throughput between each pair
- **Cloud storage tests** (if Tiered Storage is configured): validates
  object storage connectivity and read/write performance

### Usage

```bash
# Start self-test (prompts for confirmation — it consumes significant resources)
rpk cluster self-test start

# Skip confirmation (for automation)
rpk cluster self-test start --no-confirm

# Check status while running
rpk cluster self-test status

# Get results in JSON for scripting/alerting
rpk cluster self-test status --format=json

# Stop early if needed
rpk cluster self-test stop
```

Example output when running:
```
Nodes [0 1 2] are still running jobs
```

Example results output (abbreviated):
```
NODE ID  TEST           THROUGHPUT    LATENCY    IOPS
0        disk-write     450 MiB/s     0.15ms     28800
0        disk-read      520 MiB/s     0.12ms     33280
0        net-0->1       9.4 Gb/s      0.5ms      —
```

### Interpreting results

Compare against your hardware specs:

| Hardware | Typical production target |
|---|---|
| NVMe SSD (data disk) | > 500 MB/s write throughput, < 1ms p99 latency |
| Network | > 1 Gb/s between broker pairs |
| HDD (not recommended) | > 150 MB/s sequential, < 20ms p99 |

If self-test results are significantly below vendor specs, the issue is
hardware-level (faulty disk, saturated NIC, noisy neighbor) rather than
Redpanda configuration.

---

## Local Storage Usage

```bash
GET /v1/debug/local_storage_usage
```

Returns the total bytes used by local storage across all partitions.

```bash
curl -s http://localhost:9644/v1/debug/local_storage_usage | jq
```

---

## Cloud Storage Usage

```bash
GET /v1/debug/cloud_storage_usage
```

Returns the sum of cloud (Tiered) storage log bytes across all partitions.
Accepts optional `retries_allowed` and `batch_size` query parameters.

```bash
curl -s http://localhost:9644/v1/debug/cloud_storage_usage | jq
```

---

## Partition Debug Info

Get low-level state for all replicas of a partition (any node can be queried,
not just the leader):

```bash
GET /v1/debug/partition/{namespace}/{topic}/{partition}
```

```bash
# kafka namespace, topic "orders", partition 0
curl -s http://localhost:9644/v1/debug/partition/kafka/orders/0 | jq

# Internal topics
curl -s http://localhost:9644/v1/debug/partition/_redpanda-internal/controller/0 | jq
```

Get producer info for a partition (queries the leader):

```bash
GET /v1/debug/producers/{namespace}/{topic}/{partition}
```

```bash
curl -s http://localhost:9644/v1/debug/producers/kafka/orders/0 | jq

# Limit results
curl -s "http://localhost:9644/v1/debug/producers/kafka/orders/0?limit=10" | jq
```

---

## Blocked Reactor Detection

The Seastar reactor reports when it has been blocked for longer than a
threshold. Temporarily lower the threshold to catch even brief stalls:

```bash
PUT /v1/debug/blocked_reactor_notify_ms
```

Parameters:
- `timeout` (required, long) — threshold in ms; reactor logs a warning if
  blocked longer than this
- `expires` (optional, long) — seconds until original threshold is restored
  (default: 5 minutes)

```bash
# Set threshold to 100ms, restore after 60 seconds
curl -s -X PUT "http://localhost:9644/v1/debug/blocked_reactor_notify_ms?timeout=100&expires=60"
```

Useful when investigating intermittent latency spikes that don't show in
normal CPU profiling.

---

## Log Backtrace (emit to broker log)

```bash
POST /v1/debug/log_backtrace
```

Causes the broker to emit a backtrace to its log. Useful for diagnosing
stuck operations.

```bash
# Emit full backtrace
curl -s -X POST "http://localhost:9644/v1/debug/log_backtrace"

# Simple backtrace (fewer frames)
curl -s -X POST "http://localhost:9644/v1/debug/log_backtrace?simple=true"
```

Then check the logs:
```bash
journalctl -u redpanda -n 200 | grep -A 50 "backtrace"
```

---

## Reset Leaders (flush in-memory leader cache)

```bash
POST /v1/debug/reset_leaders
```

Forces the broker to re-fetch leader information from Raft. This is a
diagnostic tool — call it if the local leader table appears stale.

```bash
curl -s -X POST http://localhost:9644/v1/debug/reset_leaders
```

---

## Related skills

- `streaming-admin-api` — Full Admin API endpoint reference
- `streaming-debugging` (SKILL.md) — First-response workflow and triage playbooks
- `rpk-cluster` — `rpk cluster self-test` CLI reference
