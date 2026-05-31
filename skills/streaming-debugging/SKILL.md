---
name: streaming-debugging
description: >-
  Diagnoses a Redpanda broker or cluster using debug bundles, metrics endpoints,
  logs, CPU profiling, partition and raft health checks, and triage playbooks.
  Use when: a Redpanda broker is unhealthy, crashing, lagging, under-replicated,
  slow, or out of disk; when collecting a debug bundle for Redpanda support;
  when reading /public_metrics or /metrics; when triaging cluster health,
  partition movement, or raft recovery issues; when a broker won't start or
  keeps crashing; when consumer lag is growing unexpectedly; when disk pressure
  or a leadership imbalance is suspected; when running rpk debug bundle or
  rpk debug remote-bundle; when interpreting prometheus metrics from a Redpanda
  cluster; when debugging enterprise features and their health signals —
  Tiered Storage / shadow indexing, Continuous Data Balancing
  (partition_autobalancing_mode=continuous) and intra-broker core_balancing,
  Cloud Topics, Iceberg Topics (redpanda.iceberg.mode and the DLQ), Shadow
  Linking cross-cluster DR (rpk shadow), Remote Read Replicas, Leadership
  Pinning, and Audit Logging; when checking enterprise license status or a
  license violation (rpk cluster license info). Most of these features require
  an Enterprise license.
---

# Redpanda Streaming: Debugging & Diagnostics

A practical debugging playbook for Redpanda operators. Covers the first-response workflow when something is wrong, how to collect a debug bundle for support, how to read the Prometheus metrics endpoints, and step-by-step triage for the most common failure modes.

For raw HTTP Admin API endpoint detail see the `streaming-admin-api` skill. For CLI flag depth on `rpk debug bundle` see the `rpk-debug` skill.

## Quickstart

The first three moves when something is wrong.

### 1. Check cluster health

```bash
# Overall cluster health — are all brokers up? Any leaderless/under-replicated partitions?
rpk cluster health

# List brokers with their current status
rpk cluster info

# Get broker list via Admin API (port 9644)
curl -s http://localhost:9644/v1/brokers | jq
```

### 2. Scrape key /public_metrics

```bash
# The three most important health signals — pipe through grep to see them fast
curl -s http://localhost:9644/public_metrics \
  | grep -E '(under_replicated|unavailable_partitions|storage_disk_free_space_alert|memory_available_memory\{)'
```

Expected healthy output:
```
redpanda_kafka_under_replicated_replicas{...} 0
redpanda_cluster_unavailable_partitions 0
redpanda_storage_disk_free_space_alert 0
redpanda_memory_available_memory{...} <large positive number>
```

Non-zero `under_replicated_replicas` or `unavailable_partitions` or a
`disk_free_space_alert` value of `1` (low) or `2` (degraded) all require
immediate investigation.

### 3. Collect a debug bundle

```bash
# On a Linux broker node — defaults: logs since yesterday, 30s CPU profile, 2 metrics samples
rpk debug bundle

# Narrow the log window for faster collection
rpk debug bundle --logs-since 2024-01-15 --logs-until 2024-01-16

# From a remote machine — collects from ALL brokers configured in your profile
rpk debug remote-bundle start
rpk debug remote-bundle status   # poll until "success"
rpk debug remote-bundle download
# Add --no-confirm for non-interactive/scripted use
rpk debug remote-bundle download --no-confirm
```

The ZIP lands at `./<timestamp>-bundle.zip` (local). Remote download prompts
for confirmation by default; pass `--no-confirm` to skip the prompt in scripts.
The default download filename is `<timestamp>-remote-bundle.zip`.

Unzip and inspect with jq:
```bash
unzip 1675440652-bundle.zip -d bundle/
cd bundle/

# Broker versions and maintenance status
cat admin/brokers.json | jq '.[] | {node_id, version, maintenance_status}'

# Cluster health overview
cat admin/health_overview.json | jq

# Check for under-replicated/leaderless partitions
cat admin/health_overview.json | jq '.leaderless_count, .under_replicated_count'

# Disk usage per data directory
cat utils/du.txt

# NTP clock drift
cat utils/ntp.txt | jq .offset
```

Note: cluster-scoped Admin API files appear once in the bundle
(`admin/brokers.json`, `admin/health_overview.json`,
`admin/cluster_config.json`, `admin/license.json`,
`admin/partition_balancer_status.json`). Node-scoped files are suffixed per
broker address (e.g., `admin/controller_status_<addr>.json`,
`admin/partition_leader_table_<addr>.json`,
`admin/disk_stat_data_<addr>.json`,
`admin/cpu_profile_<addr>.json`).
Metrics snapshots live under `metrics/<broker-addr>/t0_public_metrics.txt`,
`metrics/<broker-addr>/t0_metrics.txt`, etc. (one subdir per broker, N samples).

---

## Debug Bundle

### rpk debug bundle (local)

Run directly on the broker node. Requires access to the broker host.

```bash
# Minimal — uses defaults
rpk debug bundle

# Custom time window and CPU profiler duration
rpk debug bundle \
  --logs-since 2024-01-15 \
  --logs-until 2024-01-16 \
  --cpu-profiler-wait 60s \
  --output /tmp/bundle.zip

# Save additional Admin API data for specific partitions
rpk debug bundle --partition my-topic/0,1,2

# Kubernetes — run inside the Pod, pass the namespace for K8s resource collection
kubectl exec -it -n redpanda redpanda-0 -c redpanda -- \
  rpk debug bundle --namespace redpanda
```

Key flags (from `debugbundle.DebugBundleSharedOptions`):

| Flag | Default | Description |
|---|---|---|
| `--logs-since` | `yesterday` | journalctl-format start date (YYYY-MM-DD, 'yesterday', 'today') |
| `--logs-until` | _(none)_ | journalctl-format end date |
| `--logs-size-limit` | `100MiB` | Stop reading logs once this size is reached |
| `--controller-logs-size-limit` | `132MB` | Max controller log size in bundle |
| `--cpu-profiler-wait` | `30s` | Must be > 15s; Seastar samples every ~13s |
| `--metrics-samples` | `2` | Number of metrics snapshots (must be >= 2) |
| `--metrics-interval` | `10s` | Interval between metrics snapshots |
| `--partition` / `-p` | _(none)_ | Extra Admin API requests for `{ns}/topic/partition,...` |
| `--namespace` / `-n` | _(none)_ | Kubernetes namespace (K8s only) |
| `--label-selector` / `-l` | `app.kubernetes.io/name=redpanda` | K8s label selector |
| `--kafka-connections-limit` | `256` | Max Kafka connections stored |
| `--output` / `-o` | `./<timestamp>-bundle.zip` | Output file path |
| `--upload-url` | _(none)_ | S3-signed URL from Redpanda support for direct upload |
| `--timeout` | `60s` | Child command timeout |

### rpk debug remote-bundle (cluster-wide)

Drives bundle collection through the Admin API — no node SSH required.

```bash
# Create an rpk profile pointing at all admin endpoints first
rpk profile create prod --set admin.hosts=broker1:9644,broker2:9644,broker3:9644

# Start collection on all brokers
rpk debug remote-bundle start

# Skip confirmation prompt (useful in scripts)
rpk debug remote-bundle start --no-confirm

# Wait for completion inline (up to 5 minutes by default)
rpk debug remote-bundle start --wait

# Poll status manually
rpk debug remote-bundle status

# Download when status is "success"
rpk debug remote-bundle download
rpk debug remote-bundle download --output ~/bundles/cluster1

# Cancel a running collection
rpk debug remote-bundle cancel
```

### What the bundle contains

**Common (all environments):**
- `admin/brokers.json` — broker list, versions, maintenance status
- `admin/cluster_config.json` — full cluster config (SASL credentials stripped)
- `admin/health_overview.json` — cluster health summary
- `admin/partition_balancer_status.json` — partition balancer status
- `admin/cloud_storage_lifecycle.json` — Tiered Storage status
- `admin/cpu_profile_<addr>.json` — CPU profiler samples (one per broker)
- `admin/license.json` — enterprise license info
- `kafka.json` — metadata, topic/broker configs, offsets, groups
- `data-dir.txt` — data directory structure (permissions, sizes, mtimes)
- `metrics/<broker-addr>/t0_public_metrics.txt`, `t0_metrics.txt`, ... — Prometheus metric snapshots (N samples per broker)
- `crash_reports/` — crash reports from the data directory
- `startup_log` — startup/crash counter log (top-level bundle file)
- `utils/ntp.txt` — NTP clock delta and RTT
- `utils/du.txt` — disk usage per directory

**Bare-metal additional:**
- `redpanda.log` — journald logs for the time window
- `utils/syslog.txt` — kernel ring buffer
- `proc/` — /proc files (CPU, memory, filesystems, interrupts)
- `utils/ss.txt` — active socket info
- `utils/top.txt` — running process info
- `utils/vmstat.txt` — virtual memory stats
- `utils/ip.txt` — network config
- `utils/lspci.txt` — PCI devices

**Kubernetes additional:**
- `logs/redpanda-N.txt` — per-Pod logs
- `k8s/` — Kubernetes manifests (configmaps, events, pods, PVCs, services, etc.)

---

## Metrics Endpoints

Redpanda exposes two Prometheus-format endpoints on the Admin API (port 9644):

| Endpoint | Purpose |
|---|---|
| `/public_metrics` | Stable, supported metrics for dashboards and alerting |
| `/metrics` | Internal Seastar/Redpanda metrics — more verbose, may change between versions |

```bash
# Public metrics — recommended for monitoring
curl -s http://localhost:9644/public_metrics

# Internal metrics
curl -s http://localhost:9644/metrics

# See all available public metrics
curl -s http://localhost:9644/public_metrics | grep '^# HELP'
```

Note: metrics are only exported for features in use. If no consumer groups
exist, consumer-group metrics will not appear.

See [Metrics Reference](references/metrics.md) for the full list of key metrics and example Prometheus queries.

---

## Triage Playbooks

Quick-reference for the most common failure modes. Each links to the detailed playbook in references.

### Under-replicated or leaderless partitions

```bash
# Check count
curl -s http://localhost:9644/public_metrics \
  | grep -E '(under_replicated_replicas|unavailable_partitions)'

# Which specific partitions are under-replicated — use /v1/partitions (no namespace)
# The response is partition_summary objects with fields: ns, topic, partition_id, core, materialized, leader
rpk cluster health --watch   # shows counts

# Inspect a specific partition's full state (status, leader_id, replicas)
curl -s http://localhost:9644/v1/partitions/kafka/my-topic/0 | jq

# Or use the debug endpoint for deeper per-replica state
curl -s http://localhost:9644/v1/debug/partition/kafka/my-topic/0 | jq
```

### Disk pressure

```bash
# disk_free_space_alert: 0=OK 1=Low 2=Degraded
curl -s http://localhost:9644/public_metrics | grep disk_free_space_alert

# Free bytes
curl -s http://localhost:9644/public_metrics | grep storage_disk_free_bytes

# Disk stat via Admin API
curl -s http://localhost:9644/v1/debug/storage/disk_stat/data | jq
```

### Memory pressure

```bash
# Available memory (deducts reclaimable batch-cache memory)
curl -s http://localhost:9644/public_metrics | grep memory_available_memory

# Sampled live memory profile per shard
curl -s "http://localhost:9644/v1/debug/sampled_memory_profile" | jq
```

### Leadership imbalance

```bash
# Leadership changes counter — sustained high rate = instability
curl -s http://localhost:9644/public_metrics | grep raft_leadership_changes

# Partition leader table on this node
curl -s http://localhost:9644/v1/debug/partition_leaders_table | jq '.[0:5]'
```

### Raft recovery stuck

```bash
# Partitions pending recovery on this broker
curl -s http://localhost:9644/public_metrics | grep -E 'raft_recovery_partitions'

# Controller status (last applied / committed offset)
curl -s http://localhost:9644/v1/debug/controller_status | jq
```

### Slow produce/consume (high latency)

```bash
# p99 produce latency (histogram)
curl -s http://localhost:9644/public_metrics \
  | grep 'kafka_request_latency_seconds_bucket{.*produce.*}'

# Consumer group lag
rpk group describe <group-name>
curl -s http://localhost:9644/public_metrics | grep consumer_group_lag_max
```

See [Triage Playbooks](references/triage-playbooks.md) for step-by-step workflows covering each failure mode.

---

## CPU Profiling and Self-Test

### CPU profiling via Admin API

```bash
# Collect 30 seconds of CPU profiler samples (wait_ms in milliseconds)
curl -s "http://localhost:9644/v1/debug/cpu_profile?wait_ms=30000" | jq > cpu_profile.json

# Single shard only
curl -s "http://localhost:9644/v1/debug/cpu_profile?shard=0&wait_ms=30000" | jq
```

The endpoint path is `/v1/debug/cpu_profile` (GET). The `wait_ms` parameter controls
how long to collect samples. Seastar samples approximately every 13 seconds so
setting `wait_ms` < 15000 returns empty results.

### Disk stat

```bash
# Data disk stats
curl -s http://localhost:9644/v1/debug/storage/disk_stat/data | jq

# Cache disk stats
curl -s http://localhost:9644/v1/debug/storage/disk_stat/cache | jq
```

### Cluster self-test (hardware benchmarks)

```bash
# Start disk + network benchmarks (interactive confirmation required)
rpk cluster self-test start

# Check status while running
rpk cluster self-test status

# Results in JSON format for scripting
rpk cluster self-test status --format=json

# Stop early if needed
rpk cluster self-test stop
```

Self-test benchmarks disk throughput/IOPS/latency and network throughput
between broker pairs. Use it to verify hardware is performing to spec when
unexplained latency appears.

See [Profiling and Self-Test](references/profiling-and-selftest.md) for output interpretation.

---

## Logs

**Linux (systemd):**
```bash
# Current Redpanda logs
journalctl -u redpanda --since yesterday

# Specific time window
journalctl -u redpanda --since "2024-01-15 10:00" --until "2024-01-15 12:00"

# Follow live
journalctl -u redpanda -f

# Increase log level for a subsystem temporarily (does not persist across restart)
# Use --level/-l flag; --expiry-seconds 0 keeps it until next restart
rpk redpanda admin config log-level set kafka --level debug --host localhost:9644
```

**Kubernetes:**
```bash
# Logs from a specific Pod
kubectl logs redpanda-0 -n redpanda -c redpanda

# Aggregate from all Pods
kubectl logs -n redpanda -l app.kubernetes.io/component=redpanda-statefulset

# Increase log level via Helm (persists)
helm upgrade redpanda redpanda/redpanda -n redpanda --reuse-values \
  --set logging.logLevel=debug
```

**Log levels** (valid values): `trace`, `debug`, `info`, `warn`, `error`

Crash reports live in the `crash_reports/` subdirectory of the broker data
directory (`/var/lib/redpanda/data/crash_reports/` by default). The
`startup_log` file is at the data directory root
(`/var/lib/redpanda/data/startup_log`). Both are included in the debug bundle
automatically (`crash_reports/` directory and a top-level `startup_log` file).

---

## Enterprise Features

Many Redpanda differentiators have their own health signals, status commands,
and failure modes. They all require a valid **Enterprise license** (RCL) — and
a surprising number of "feature is broken" tickets are actually license
violations. **Check the license first:**

```bash
# Violation: true  => an enterprise feature is enabled without a valid license
rpk cluster license info
rpk cluster license info --format json
# In a debug bundle: admin/license.json
```

On license expiration the cluster keeps running without data loss, but you can
no longer enable/modify enterprise features (each degrades differently).

Quick pointers for the features most relevant to broker/cluster debugging:

```bash
# Continuous Data Balancing — status: off|ready|starting|in-progress|stalled
rpk cluster partitions balancer-status
# bundle: admin/partition_balancer_status.json
# Enable/disable via cluster property partition_autobalancing_mode
#   continuous (enterprise default) | node_add (community default) | off

# Tiered Storage health (object storage offload) — watch on /public_metrics:
curl -s http://localhost:9644/public_metrics \
  | grep -E 'cloud_storage_(errors_total|anomalies|segment_readers_delayed|cache_op_(hit|miss))'
# bundle: admin/cloud_storage_lifecycle.json ; master switch cloud_storage_enabled

# Iceberg Topics — DLQ / translation failures:
curl -s http://localhost:9644/public_metrics \
  | grep -E 'iceberg_translation_(dlq_files_created|invalid_records)'
# topic property redpanda.iceberg.mode (key_value|value_schema_id_prefix|value_schema_latest|disabled)

# Shadow Linking (cross-cluster DR) — lag + task health:
rpk shadow list
rpk shadow status <shadow-link-name>
curl -s http://localhost:9644/public_metrics | grep shadow_link_shadow_lag
```

See [Enterprise Features](references/enterprise-features.md) for the full set of
config keys (including nested `partition_autobalancing_*`, `redpanda.iceberg.*`,
`cloud_storage_*`, `redpanda.remote.*`, `audit_*`, and `*_leaders_preference`
properties), the health metrics for each feature, what breaks on license
expiry, and the disable-for-compliance action per feature.

---

## Reference Directory

- [Debug Bundle](references/debug-bundle.md): `rpk debug bundle` and `rpk debug remote-bundle` — all flags, what gets collected, generating on Linux vs Kubernetes, and how to inspect the archive with jq.
- [Metrics Reference](references/metrics.md): `/public_metrics` vs `/metrics`, the most important health/SLO metrics with Prometheus query examples, and how to enable consumer-group metrics.
- [Triage Playbooks](references/triage-playbooks.md): Step-by-step playbooks for disk pressure, leadership imbalance, under-replicated/leaderless partitions, raft recovery stuck, slow produce/consume, and broker won't start.
- [Profiling and Self-Test](references/profiling-and-selftest.md): CPU profiling via the Admin API (`/v1/debug/cpu_profile`), disk stat, `rpk cluster self-test` (disk/network benchmarks), and reading controller/raft recovery status.
- [Enterprise Features](references/enterprise-features.md): Debugging Redpanda's licensed differentiators — license status/violation checks (`rpk cluster license info`, `admin/license.json`), Continuous Data Balancing (`partition_autobalancing_*`, balancer-status) and intra-broker `core_balancing_continuous`, Tiered Storage (`cloud_storage_*`, `redpanda.remote.*`, cache/upload/error metrics), Remote Read Replicas, Cloud Topics (`cloud_topics_enabled`, `redpanda.cloud_topic.enabled`), Iceberg Topics (`iceberg_*`, `redpanda.iceberg.*`, DLQ + translation metrics), Leader Pinning (`default_leaders_preference`), Shadow Linking DR (`rpk shadow`, `redpanda_shadow_link_*` metrics, task/topic states), and Audit Logging (`audit_*`). Notes license requirements and disable-for-compliance actions.
