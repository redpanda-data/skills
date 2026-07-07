# Triage Playbooks

Step-by-step workflows for the most common Redpanda failure modes. Each
playbook starts with the fastest signal, then drills deeper.

---

## Playbook 1: Disk pressure

**Symptom**: Produce latency spike, `LEADER_NOT_AVAILABLE` errors, broker
becoming unavailable, or a Redpanda alert email about storage.

### Step 1 — Confirm disk pressure

```bash
# disk_free_space_alert: 0=OK 1=Low 2=Degraded
curl -s http://localhost:9644/public_metrics | grep storage_disk_free_space_alert

# Absolute free bytes
curl -s http://localhost:9644/public_metrics | grep storage_disk_free_bytes

# Which broker? (check all Admin API hosts)
for host in broker1 broker2 broker3; do
  echo "=== $host ==="
  curl -s http://$host:9644/public_metrics | grep storage_disk_free_bytes
done
```

### Step 2 — Identify large consumers

```bash
# Disk usage breakdown of the data directory
du -sh /var/lib/redpanda/data/kafka/*  # per-topic directories
du -sh /var/lib/redpanda/data/kafka/*/*  # per-partition

# In the debug bundle
cat utils/du.txt
```

Look for one partition that is significantly larger than its peers — this can
indicate a stuck consumer (lag growing) or a misconfigured retention policy.

### Step 3 — Short-term relief options

```bash
# Option A: Reduce retention on a problematic topic immediately
rpk topic alter-config my-topic --set retention.bytes=5368709120  # 5 GiB/partition
rpk topic alter-config my-topic --set retention.ms=86400000        # 1 day

# Option B: Check and fix the cluster-level retention defaults
rpk cluster config get log_retention_ms
rpk cluster config get retention_bytes
rpk cluster config set retention_bytes 10737418240  # 10 GiB per partition

# Option C: Compact topics (for topics with cleanup.policy=compact+delete)
# compaction runs automatically; you can observe via log segments reducing
```

### Step 4 — Confirm recovery

```bash
# Watch disk free space
watch -n5 "curl -s http://localhost:9644/public_metrics | grep storage_disk_free"

# disk_free_space_alert should return to 0
```

### Step 5 — Longer term

- Enable Tiered Storage to offload cold segments to object storage
- Set per-topic `retention.bytes` limits for all topics
- Alert on `redpanda_storage_disk_free_space_alert >= 1`

---

## Playbook 2: Under-replicated partitions

**Symptom**: Produce latency increased, some partitions show `URP` (under-
replicated replicas) in monitoring, or `rpk cluster health` reports issues.

### Step 1 — Confirm and measure

```bash
# Quick check
rpk cluster health

# Count of under-replicated replicas (0 = healthy)
# Labeled by redpanda_namespace, redpanda_topic, redpanda_partition
curl -s http://localhost:9644/public_metrics | grep kafka_under_replicated_replicas

# Which specific partitions are affected?
# GET /v1/partitions returns partition_summary objects: ns, topic, partition_id, core, materialized, leader
# Use the metric labels to identify the specific topic/partition, then drill in:
curl -s http://localhost:9644/v1/partitions | jq '.[] | select(.leader == -1)'

# Get full state for a specific partition (status, leader_id, replicas)
curl -s http://localhost:9644/v1/partitions/kafka/my-topic/0 | jq

# Deepest per-replica debug info
curl -s http://localhost:9644/v1/debug/partition/kafka/my-topic/0 | jq
```

### Step 2 — Identify the lagging broker

```bash
# Check that all brokers are up
curl -s http://localhost:9644/v1/brokers | jq '.[] | {node_id, is_alive, membership_status}'

# Is a specific broker down or decommissioning?
rpk cluster info
```

If a broker is down, its replicas are in-sync until the `raft_election_timeout`
expires (default: 1500ms), then a new leader is elected. Replicas on the
unavailable broker become under-replicated.

### Step 3 — Check recovery progress

```bash
# Partitions actively recovering on this broker
curl -s http://localhost:9644/public_metrics | grep raft_recovery_partitions

# Offsets still pending recovery
curl -s http://localhost:9644/public_metrics | grep raft_recovery_offsets_pending

# Recovery bandwidth
curl -s http://localhost:9644/public_metrics | grep raft_recovery_partition_movement
```

Recovery is automatic. If `raft_recovery_partitions_to_recover` is large and
not decreasing, check the rate of `raft_recovery_partition_movement_consumed_bandwidth`.
If it is near zero, the recovering broker may be disk- or network-bound.

### Step 4 — If a broker is permanently lost

```bash
# Decommission the lost broker (redistributes its partitions)
rpk redpanda admin brokers decommission <node-id>

# Monitor decommission progress
rpk redpanda admin brokers decommission-status <node-id>
curl -s http://localhost:9644/v1/brokers/<node-id>/decommission | jq
```

### Step 5 — Force partition recovery (last resort)

Only use `force_recover_from_nodes` after confirming data on the listed nodes
is permanently lost. This is a destructive, data-loss operation. Both
`dead_nodes` AND `partitions_to_force_recover` are required in the request
body. Use the two-step flow:

```bash
# Step A: identify which partitions lost majority (CSV query param)
curl -s "http://localhost:9644/v1/partitions/majority_lost?dead_nodes=2,3" | jq \
  > majority_lost.json

# Step B: POST both fields — supply the list from majority_lost as-is
curl -s -X POST http://localhost:9644/v1/partitions/force_recover_from_nodes \
  -H 'Content-Type: application/json' \
  -d "{\"dead_nodes\": [2, 3], \"partitions_to_force_recover\": $(cat majority_lost.json)}"
```

---

## Playbook 3: Leaderless (unavailable) partitions

**Symptom**: Consumers and producers get `LEADER_NOT_AVAILABLE` for some
topics; `rpk cluster health` shows `is_healthy: false`.

### Step 1 — Confirm

```bash
rpk cluster health

curl -s http://localhost:9644/public_metrics | grep cluster_unavailable_partitions

# Which partitions are leaderless?
# GET /v1/partitions returns partition_summary objects; the leader field is -1 when no leader
curl -s http://localhost:9644/v1/partitions | jq '.[] | select(.leader == -1)'
```

### Step 2 — Identify the cause

Leaderless partitions occur when no broker holds a majority of replicas for
that partition. Common causes:

- Majority of replica brokers are down
- Split-brain / network partition between brokers
- Raft election in progress (transient, typically resolves in seconds)

```bash
# Check broker health
curl -s http://localhost:9644/v1/brokers | jq '.[] | {node_id, is_alive}'

# Check if node is isolated
curl -s http://localhost:9644/v1/debug/is_node_isolated

# Controller status — is the controller log progressing?
curl -s http://localhost:9644/v1/debug/controller_status | jq
```

### Step 3 — Restore quorum

Bring back the failed brokers. Redpanda will re-elect leaders automatically
once a quorum is available.

If enough brokers are permanently lost to break quorum for some partitions,
you may need to use `force_recover_from_nodes` (see Under-replicated Playbook,
Step 5) or restore from backup/Tiered Storage.

### Step 4 — Prevent future occurrences

- Use a replication factor of 3 (minimum) for all production topics
- Ensure rack awareness is enabled (`rpk cluster config get enable_rack_awareness`)
  and each broker has `rack` set in its `redpanda.yaml` node config
  (`redpanda.rack: <zone-id>`), so replicas span physical failure domains
- Set `redpanda_cluster_unavailable_partitions > 0` as a critical alert

---

## Playbook 4: Leadership imbalance

**Symptom**: Uneven CPU/memory usage across brokers, one broker handling
most produce/consume traffic while others are idle.

### Step 1 — Detect imbalance

```bash
# Leadership changes — a high rate indicates instability
curl -s http://localhost:9644/public_metrics | grep raft_leadership_changes

# Partition leader table on this node
# Response: leader_info objects with fields: ns, topic, partition_id, leader, previous_leader,
# last_stable_leader_term, update_term, partition_revision
curl -s http://localhost:9644/v1/debug/partition_leaders_table | jq \
  'group_by(.leader) | map({broker: .[0].leader, partition_count: length}) | sort_by(-.partition_count)'

# Or via rpk
rpk cluster partitions list
```

### Step 2 — Check partition balancer status

```bash
rpk cluster partitions balancer-status

# Via Admin API
curl -s http://localhost:9644/v1/cluster/partition_balancer/status | jq
```

### Step 3 — Trigger rebalance

Redpanda's partition balancer runs automatically. If it's disabled or if you
want to force it:

```bash
# Check if balancer is enabled
rpk cluster config get partition_autobalancing_mode

# Enable continuous balancing
rpk cluster config set partition_autobalancing_mode continuous

# Trigger a one-off rebalance
rpk cluster partitions balance
```

### Step 4 — Monitor resolution

```bash
# Watch leadership counts per broker
watch -n10 "curl -s http://localhost:9644/v1/debug/partition_leaders_table | \
  jq 'group_by(.leader) | map({broker: .[0].leader, leaders: length}) | sort_by(-.leaders)'"
```

---

## Playbook 5: Raft recovery stuck

**Symptom**: `redpanda_raft_recovery_partitions_to_recover` is non-zero and
not decreasing; broker joined/restarted but is not catching up.

### Step 1 — Measure recovery status

```bash
# All recovery metrics
curl -s http://localhost:9644/public_metrics | grep raft_recovery

# Controller log progress (for the controller partition specifically)
curl -s http://localhost:9644/v1/debug/controller_status | jq
```

### Step 2 — Check recovery bandwidth

```bash
# Is bandwidth consumed? If 0 = recovery is stalled
curl -s http://localhost:9644/public_metrics | grep raft_recovery_partition_movement_consumed_bandwidth
```

If `consumed_bandwidth` is 0:

1. Check disk health on the recovering broker (`iostat -x 1 10`)
2. Check network connectivity between brokers
3. Check the `recovery_bandwidth` cluster config:

```bash
rpk cluster config get raft_learner_recovery_rate
# Default is unlimited; can be throttled for large clusters
```

### Step 3 — Raft learner gap

```bash
# Bytes that learners (recovering replicas) still need to receive
curl -s http://localhost:9644/public_metrics | grep raft_learners_gap_bytes
```

### Step 4 — Force recheck disk health

```bash
# Force Admin API to refresh disk health info
curl -s -X POST http://localhost:9644/v1/debug/refresh_disk_health_info
```

### Step 5 — Check for stuck partition specifically

```bash
# Debug info for a specific partition
curl -s http://localhost:9644/v1/debug/partition/kafka/my-topic/0 | jq

# Producers active on a partition
curl -s http://localhost:9644/v1/debug/producers/kafka/my-topic/0 | jq
```

### Step 6 — Controller (raft0) reconfiguration wedged

If it's the *controller* group that's stuck — a node joined as a raft0 learner
and died before catching up, so membership changes (decommission, add) hang —
`/v1/debug/partition/redpanda/controller/0` shows raft0 stuck mid-reconfiguration
(`is_leader` replica with a non-`simple` group configuration). As of
**v26.1.12** two Admin API escape hatches target the controller partition
(`redpanda/controller/0`), routed to the raft0 leader:

```bash
# Cancel the in-flight controller reconfiguration (clean; run repeatedly to
# drain a backlog of stuck adds one at a time)
curl -s -X POST http://localhost:9644/v1/partitions/redpanda/controller/0/cancel_reconfiguration

# Last resort: force raft0 to exactly this replica set, nuking anything wedged
# or queued behind it (requires evil_mode=true)
curl -s -X POST \
  "http://localhost:9644/v1/debug/partitions/redpanda/controller/0/force_replicas?evil_mode=true" \
  -H "Content-Type: application/json" \
  -d '[{"node_id": 1, "core": 0}, {"node_id": 2, "core": 0}, {"node_id": 3, "core": 0}]'
```

Prefer `cancel_reconfiguration`; reach for `force_replicas` only when a clean
cancel can't clear the wedge. See the streaming-admin-api skill for details. A
voter dropped by a force reconfiguration lingers in the members table until you
decommission it.

---

## Playbook 6: Slow produce / high produce latency

**Symptom**: Producer `acks` latency spikes; clients see timeouts; p99 latency
above SLO.

### Step 1 — Measure current latency

```bash
# p99 produce latency histogram
curl -s http://localhost:9644/public_metrics | grep kafka_request_latency_seconds_bucket

# Prometheus query (if you have Prometheus)
# histogram_quantile(0.99, sum(rate(redpanda_kafka_request_latency_seconds_bucket{redpanda_request="produce"}[5m])) by (le))
```

### Step 2 — Check disk I/O on broker

```bash
# Disk stat for data directory
curl -s http://localhost:9644/v1/debug/storage/disk_stat/data | jq

# On the host
iostat -x 1 10 | grep -v '^$'
```

High `await` on the data disk causes produce latency directly (Redpanda
fsyncs on every batch when `acks=all`).

### Step 3 — Check CPU saturation

```bash
# CPU profile — 30 seconds of samples
# Response is an object: {schema, arch, version, wait_ms, sample_period_ms, profile:[]}
# profile[] = shards: {shard_id, dropped_samples, samples:[{user_backtrace, scheduling_group, occurrences}]}
curl -s "http://localhost:9644/v1/debug/cpu_profile?wait_ms=30000" | jq \
  '.profile[] | {shard: .shard_id, top: (.samples | sort_by(-.occurrences) | .[0:5])}'

# Is reactor blocked?
curl -s -X PUT "http://localhost:9644/v1/debug/blocked_reactor_notify_ms?timeout=100" | jq
```

### Step 4 — Check for quota throttling

```bash
# Are clients being throttled?
curl -s http://localhost:9644/public_metrics | grep kafka_quotas_client_quota_throttle_time
```

### Step 5 — Check for memory pressure

```bash
curl -s http://localhost:9644/public_metrics | grep memory_available_memory
```

Low `available_memory` causes the batch cache to shrink, increasing read
amplification and putting more pressure on disk.

### Step 6 — Run self-test to check hardware baseline

```bash
rpk cluster self-test start
rpk cluster self-test status  # wait for completion
```

If disk IOPS or latency in the self-test results are far below vendor specs,
the hardware (not Redpanda config) is the bottleneck.

---

## Playbook 7: Slow consume / consumer lag growing

**Symptom**: Consumer group lag is growing, consumers are not keeping up with
the producer rate.

### Step 1 — Measure lag

```bash
# Describe the consumer group
rpk group describe <group-name>

# Via public_metrics (requires enable_consumer_group_metrics=consumer_lag)
curl -s http://localhost:9644/public_metrics | grep consumer_group_lag
```

### Step 2 — Identify where lag is growing

```bash
# Is it all partitions or specific ones?
rpk group describe <group-name> --format json | jq \
  '.partitions | sort_by(-.lag) | .[0:5]'
```

If lag is growing on all partitions uniformly, the consumer is too slow.
If it's concentrated on a few partitions, a consumer in the group may be
stuck or dead.

### Step 3 — Check for stuck consumers

```bash
# Are all group members active?
rpk group describe <group-name> | grep MEMBER

# Reset offsets if a stuck consumer needs to be skipped forward
# (ONLY do this if you understand the data loss implications)
# Stop the consumer application first, then:
rpk group seek <group-name> --to end --topics my-topic
```

### Step 4 — Scale consumers

Add more consumer instances to the group (up to the partition count). Each
additional consumer instance can take over partitions from the lagging
instances.

### Step 5 — Check fetch latency

```bash
curl -s http://localhost:9644/public_metrics | grep 'kafka_request_latency_seconds_bucket{.*consume.*}'
```

If consume latency is high (not just throughput limited), there may be a disk
or network bottleneck — see Playbook 6 steps for disk/network diagnosis.

---

## Playbook 8: Broker won't start / crash loop

**Symptom**: `systemctl status redpanda` shows failed/crashed state; Pod in
`CrashLoopBackOff` in Kubernetes.

### Step 1 — Read the startup log and crash report

```bash
# startup_log tracks consecutive crashes; reset counter is 1 hour
cat /var/lib/redpanda/data/startup_log

# Crash reports
ls /var/lib/redpanda/data/crash_reports/
```

On Kubernetes:
```bash
kubectl logs redpanda-0 -n redpanda -c redpanda --previous
```

The default `crash_loop_limit` is 5 consecutive crashes within 1 hour. After
that the broker terminates instead of restarting. To troubleshoot during the
sleep window:

```bash
# Set crash_loop_sleep_sec to give yourself access time
# (configure via Helm or node config before the limit is reached)
config:
  node:
    crash_loop_limit: 5
    crash_loop_sleep_sec: 60  # seconds to sleep before terminating
```

### Step 2 — Check for missing data directory or permissions

```bash
# Data directory must exist and be writable by the redpanda user
ls -la /var/lib/redpanda/data/
stat /var/lib/redpanda/data/

# Fix permissions if needed
chown -R redpanda:redpanda /var/lib/redpanda/data/
```

### Step 3 — Check for corrupt segment files

Large amounts of data in crash reports combined with log messages mentioning
"segment" or "log" corruption indicate segment file corruption.

```bash
journalctl -u redpanda -n 1000 | grep -i -E '(corrupt|segment|error|fatal)'
```

### Step 4 — Check for missing enterprise license

```bash
journalctl -u redpanda -n 100 | grep -i license
```

If the log contains a message like "A Redpanda Enterprise Edition license is
required", you must either apply a valid license or disable the enterprise
features before the broker will start.

```bash
# On a running broker in the cluster (if only one broker is affected)
rpk cluster license set <license-key>
```

### Step 5 — Check redpanda.yaml for invalid config

```bash
cat /etc/redpanda/redpanda.yaml

# Validate config (if broker can start briefly)
rpk redpanda check
```

### Step 6 — Reset the crash counter manually

```bash
# Delete the startup_log to reset the crash counter
rm /var/lib/redpanda/data/startup_log

# On Kubernetes
kubectl exec redpanda-0 -n redpanda -c redpanda -- \
  rm /var/lib/redpanda/data/startup_log
```

The counter also resets automatically after 1 hour since the last crash.

---

## Quick reference: which metric/command for which problem

| Symptom | First check | Then |
|---|---|---|
| Unavailable partitions | `redpanda_cluster_unavailable_partitions` | `rpk cluster health`, check broker health |
| Under-replicated replicas | `redpanda_kafka_under_replicated_replicas` | `curl /v1/debug/partition/...`, check recovery metrics |
| Disk full / low space | `redpanda_storage_disk_free_space_alert` | `du -sh /var/lib/redpanda/data/kafka/*/` |
| Memory pressure | `redpanda_memory_available_memory` | `curl /v1/debug/sampled_memory_profile` |
| Produce latency spike | `redpanda_kafka_request_latency_seconds` (p99) | disk stat, CPU profile, iostat |
| Consumer lag growing | `rpk group describe <group>` | `redpanda_kafka_consumer_group_lag_max` |
| Leadership instability | `redpanda_raft_leadership_changes` (rate) | balancer status, partition leader table |
| Raft recovery stuck | `redpanda_raft_recovery_partitions_to_recover` | `consumed_bandwidth`, disk health |
| Broker won't start | journald / Pod logs | startup_log, crash_reports, license check |
