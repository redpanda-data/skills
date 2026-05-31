# Metrics Reference

Redpanda exposes two Prometheus-format endpoints on the Admin API (default port 9644).

## /public_metrics vs /metrics

| Endpoint | Purpose | Stability |
|---|---|---|
| `GET /public_metrics` | Stable, supported metrics — use for dashboards and alerting | Stable across versions |
| `GET /metrics` | Internal Seastar/Redpanda metrics — more verbose, unlabeled internals | May change between versions |

```bash
# Public metrics
curl -s http://localhost:9644/public_metrics

# Internal metrics
curl -s http://localhost:9644/metrics

# Discover all available public metrics
curl -s http://localhost:9644/public_metrics | grep '^# HELP'

# Same for internal
curl -s http://localhost:9644/metrics | grep '^# HELP'
```

Note: metrics are only exported for features in use. If no consumer groups
exist, consumer-group metrics will not appear. If Tiered Storage is disabled,
its metrics will not appear.

---

## Key health and SLO metrics

All metrics below are from `/public_metrics` unless noted.

### Cluster-level health

#### redpanda_cluster_unavailable_partitions

Number of partitions that lack an active leader (no quorum among replicas).

- **Type**: gauge
- **Alert threshold**: > 0 immediately
- **Cause**: broker down, majority of replicas unavailable, raft election in progress (transient)

```promql
redpanda_cluster_unavailable_partitions > 0
```

#### redpanda_kafka_under_replicated_replicas

Number of partition replicas that are live but lagging behind the leader's
latest offset. Labeled by `{redpanda_namespace, redpanda_topic, redpanda_partition}`.

- **Type**: gauge
- **Alert threshold**: > 0 sustained (brief spikes during broker restarts are normal)
- **Cause**: follower fallen behind, network congestion, disk slow on follower

```promql
# Total under-replicated replicas across all partitions
sum(redpanda_kafka_under_replicated_replicas)

# Alert if any partition is under-replicated
redpanda_kafka_under_replicated_replicas > 0
```

#### redpanda_cluster_brokers

Total number of fully commissioned brokers.

- **Type**: gauge
- **Alert threshold**: drop below your expected broker count

```promql
redpanda_cluster_brokers < 3  # if you expect 3 brokers
```

#### redpanda_cluster_partitions

Total logical partitions managed by the cluster (excludes replicas, includes
controller topic).

- **Type**: gauge

---

### Disk and storage

#### redpanda_storage_disk_free_bytes

Free disk bytes on the data storage.

- **Type**: gauge
- **Alert threshold**: below your safety margin (e.g., 20% of total)

```promql
redpanda_storage_disk_free_bytes / redpanda_storage_disk_total_bytes < 0.2
```

#### redpanda_storage_disk_free_space_alert

Alert state for disk free space:
- `0` = OK
- `1` = Low space (Redpanda considers space low)
- `2` = Degraded (critically low; Redpanda may begin refusing writes)

- **Type**: gauge
- **Alert threshold**: >= 1

```promql
redpanda_storage_disk_free_space_alert >= 1
```

#### redpanda_storage_disk_total_bytes

Total disk capacity.

- **Type**: gauge

#### redpanda_storage_cache_disk_free_bytes / redpanda_storage_cache_disk_free_space_alert

Same semantics as the data-disk metrics but for the tiered-storage cache
directory (if configured separately).

---

### Memory

#### redpanda_memory_available_memory

**Use this, not `allocated_memory`, for monitoring.**
Free memory deducting reclaimable batch-cache memory. A low value indicates
genuine memory pressure.

- **Type**: gauge
- **Alert threshold**: below a threshold appropriate for your broker's RAM (e.g., < 1 GiB)

```promql
redpanda_memory_available_memory < 1073741824  # < 1 GiB
```

#### redpanda_memory_allocated_memory

Total allocated memory including reclaimable batch cache. May appear high
even when memory is not under pressure. Prefer `available_memory` for alerts.

- **Type**: gauge

#### redpanda_memory_available_memory_low_water_mark

Lowest observed `available_memory` since last reset; useful for detecting
past memory pressure even if the current value looks fine.

- **Type**: gauge

---

### Raft recovery

#### redpanda_raft_recovery_partitions_to_recover

Total partition replicas pending recovery on this broker.

- **Type**: gauge
- **Interpretation**: non-zero after a broker restart/join is normal; stuck at
  a large non-zero value for minutes indicates a problem

#### redpanda_raft_recovery_partitions_active

Partition replicas currently undergoing recovery (a subset of
`to_recover`).

- **Type**: gauge

#### redpanda_raft_recovery_offsets_pending

Sum of offsets still to be recovered across all recovering partitions.

- **Type**: gauge

#### redpanda_raft_recovery_partition_movement_available_bandwidth / consumed_bandwidth

Available and consumed network bandwidth for partition movement
(in bytes/s), per shard.

- **Type**: gauge

#### redpanda_raft_leadership_changes

Counter of successful leader elections per topic. A high sustained rate
indicates leadership instability.

- **Type**: counter
- **Prometheus query** (rate over 5 minutes):

```promql
sum(rate(redpanda_raft_leadership_changes[5m]))
```

#### redpanda_raft_learners_gap_bytes

Total bytes that must be delivered to learner replicas to bring them up to
date, per shard.

- **Type**: gauge

---

### Produce and consume throughput

#### redpanda_kafka_request_bytes_total

Total bytes read/written to topic partitions. Labeled by
`{redpanda_namespace, redpanda_topic, redpanda_request=("produce"|"consume")}`.

- **Type**: counter

```promql
# Produce throughput (bytes/s) across the cluster
sum(rate(redpanda_kafka_request_bytes_total{redpanda_request="produce"}[1m]))

# Per-topic
sum by (redpanda_topic) (rate(redpanda_kafka_request_bytes_total[1m]))
```

#### redpanda_kafka_records_produced_total / redpanda_kafka_records_fetched_total

Cumulative records produced/fetched per topic.

- **Type**: counter

```promql
rate(redpanda_kafka_records_produced_total[1m])
```

---

### Produce/consume latency

#### redpanda_kafka_request_latency_seconds

Histogram of produce and consume request latency at the broker.
Labeled by `{redpanda_request=("produce"|"consume")}`.

- **Type**: histogram

```promql
# p99 produce latency
histogram_quantile(0.99,
  sum(rate(redpanda_kafka_request_latency_seconds_bucket{redpanda_request="produce"}[5m]))
  by (le)
)

# p99 consume latency
histogram_quantile(0.99,
  sum(rate(redpanda_kafka_request_latency_seconds_bucket{redpanda_request="consume"}[5m]))
  by (le)
)
```

---

### Consumer group metrics

Consumer group metrics require the `enable_consumer_group_metrics` cluster
property to be set. Valid options:

```bash
# Enable all consumer group metrics
rpk cluster config set enable_consumer_group_metrics \
  "consumer_lag,group,partition"
```

#### redpanda_kafka_consumer_group_lag_max

Maximum lag across all partitions in the group. Requires `consumer_lag` option.

- **Type**: gauge
- **Labels**: `{redpanda_group}`

```promql
# Alert if any group's max lag exceeds 100k
redpanda_kafka_consumer_group_lag_max > 100000
```

#### redpanda_kafka_consumer_group_lag_sum

Total lag across all partitions in the group. Requires `consumer_lag` option.

- **Type**: gauge
- **Labels**: `{redpanda_group}`

#### redpanda_kafka_consumer_group_consumers

Number of active consumers in the group. Requires `group` option.

- **Type**: gauge
- **Labels**: `{redpanda_group, shard}`

#### redpanda_kafka_consumer_group_committed_offset

Committed offset for the group per topic-partition. Requires `partition` option.

- **Type**: gauge
- **Labels**: `{redpanda_group, redpanda_topic, redpanda_partition, shard}`

---

### Node status RPCs (inter-broker health)

#### redpanda_node_status_rpcs_timed_out

RPC timeouts on this broker when communicating with peers. A rising value
indicates network connectivity issues between brokers.

- **Type**: gauge

#### redpanda_node_status_rpcs_received / redpanda_node_status_rpcs_sent

Counters for node-status RPCs — useful for confirming inter-broker
communication is active.

---

### Debug bundle metrics

#### redpanda_debug_bundle_successful_generation_count / redpanda_debug_bundle_failed_generation_count

Counters for debug bundle generation outcomes per shard. Useful for alerting
on failed bundle requests.

---

## Internal metrics (/metrics)

The `/metrics` endpoint exposes the raw Seastar and Redpanda internal metrics.
Metric names are prefixed with `vectorized_` (legacy Seastar prefix).

Equivalents for key health metrics:

| Public metric | Internal equivalent |
|---|---|
| `redpanda_kafka_under_replicated_replicas` | `vectorized_cluster_partition_under_replicated_replicas` |
| `redpanda_memory_available_memory` | `vectorized_memory_available_memory` |
| `redpanda_memory_available_memory_low_water_mark` | `vectorized_memory_available_memory_low_water_mark` |

The internal metrics are significantly more verbose (thousands of time series)
and are useful for deep-dive debugging but are not recommended for production
dashboards.

---

## Sample alerting rules (Prometheus)

```yaml
groups:
  - name: redpanda_health
    rules:
      - alert: RedpandaUnavailablePartitions
        expr: redpanda_cluster_unavailable_partitions > 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Redpanda has {{ $value }} leaderless partitions"

      - alert: RedpandaUnderReplicatedPartitions
        expr: sum(redpanda_kafka_under_replicated_replicas) > 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Redpanda has {{ $value }} under-replicated replicas"

      - alert: RedpandaDiskLow
        expr: redpanda_storage_disk_free_space_alert >= 1
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "Redpanda disk space alert: {{ $value }} (1=low, 2=degraded)"

      - alert: RedpandaDiskDegraded
        expr: redpanda_storage_disk_free_space_alert >= 2
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Redpanda disk critically low"

      - alert: RedpandaMemoryLow
        expr: redpanda_memory_available_memory < 1073741824  # 1 GiB
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Redpanda available memory: {{ $value | humanize1024 }}B"

      - alert: RedpandaBrokerDown
        expr: redpanda_cluster_brokers < 3  # adjust to your expected count
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Expected 3 brokers, only {{ $value }} are up"

      - alert: RedpandaHighLeadershipChurn
        expr: sum(rate(redpanda_raft_leadership_changes[5m])) > 5
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Raft leadership changing rapidly: {{ $value }}/s"

      - alert: RedpandaConsumerGroupLagHigh
        expr: redpanda_kafka_consumer_group_lag_max > 100000
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Group {{ $labels.redpanda_group }} lag: {{ $value }}"
```
