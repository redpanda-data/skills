# rpk debug bundle

`rpk debug bundle` collects environment data from the **local** Redpanda broker process and packages it into a ZIP file (the "diagnostics bundle"). It is the primary tool for capturing a point-in-time snapshot of a broker's health for support or self-triage.

The command auto-detects whether it is running inside Kubernetes by checking the `KUBERNETES_SERVICE_HOST` and `KUBERNETES_SERVICE_PORT` environment variables, then selects the appropriate collection mode.

> **Kubernetes note:** You must run `rpk debug bundle` inside the container running the Redpanda broker (not on the host or in a sidecar).

> **Redpanda Cloud:** not applicable. Cloud clusters (Serverless/BYOC/Dedicated) do not support debug bundles or `rpk debug`, and do not expose broker hosts to run this on — see "Scope: Self-Managed Deployments Only" in SKILL.md.

---

## Synopsis

```bash
rpk debug bundle [flags]
```

---

## Flag Reference

All flags are optional. Defaults are shown.

| Flag | Type | Default | Description |
|---|---|---|---|
| `-o, --output` | string | `./<timestamp>-bundle.zip` | Output ZIP file path. If the directory is not writable and no flag was provided, falls back to `$HOME/<timestamp>-bundle.zip`. Extension must be `.zip` or absent. |
| `--logs-since` | string | `yesterday` | Include journald logs from this date onward. Accepts journalctl date formats: `YYYY-MM-DD`, `yesterday`, `today`, or any format supported by `journalctl --since`. |
| `--logs-until` | string | (none) | Include journald logs up to this date. Same format as `--logs-since`. **Not supported in Kubernetes.** |
| `--logs-size-limit` | string | `100MiB` | Stop reading logs once this size is reached. Supports human suffixes: `3MB`, `1GiB`. |
| `--controller-logs-size-limit` | string | `132MB` | Maximum size of controller log segments to include. If the controller log directory exceeds this, the command keeps the first and last `limit/2` bytes of the sorted log files. |
| `--cpu-profiler-wait` | duration | `30s` | Duration for collecting CPU profiler samples. **Must be >= 15s** (the command rejects values less than 15s; Seastar polls metrics approximately every 13 seconds). |
| `--metrics-samples` | int | `2` | Number of Prometheus metrics snapshots. **Must be >=2** (so consumers can compute rate deltas). |
| `--metrics-interval` | duration | `10s` | Time between metrics snapshots. |
| `-p, --partition` | stringArray | (none) | Extra Admin API requests for specific partitions. Format: `[namespace/]topic/partition[,partition...]`. If namespace is omitted, defaults to `kafka`. Example: `--partition foo/0,1,2` or `--partition _redpanda-internal/bar/2`. |
| `-n, --namespace` | string | (none) | Kubernetes namespace from which to collect resources and pod logs. **Kubernetes only.** |
| `-l, --label-selector` | stringArray | `app.kubernetes.io/name=redpanda` | K8s label selectors to filter pods/resources. Comma-separated key=value pairs. **Kubernetes only.** |
| `--kafka-connections-limit` | int | `256` | Maximum number of Kafka connections to include in `admin/kafka_connections.json` (passed as the `PageSize` to the Admin API `ListKafkaConnections` call). Collected on both Linux and Kubernetes. |
| `--upload-url` | string | (none) | If provided, upload the completed bundle to this URL (HTTP PUT with `Content-Type: application/zip`). The URL is typically provided by Redpanda Support as a pre-signed S3 URL. |
| `--timeout` | duration | `60s` | Timeout for each child command (e.g., `journalctl`, `ss`, `dmidecode`). |
| `--config` | string | (auto-detected) | Path to `rpk.yaml` or `redpanda.yaml`. Default search order: `/var/lib/redpanda/.config/rpk/rpk.yaml`, `$PWD/redpanda.yaml`, `/etc/redpanda/redpanda.yaml`. |
| `-X, --config-opt` | stringArray | (none) | Override any rpk config setting inline. See `rpk -X help` for available keys. |
| `--profile` | string | (none) | Named rpk profile to use for Admin API connection details. |
| `-v, --verbose` | bool | false | Enable verbose logging. |

---

## Output Path Logic

1. If `--output` is not set, the filename is `<advertised-rpc-address>-<unix-timestamp>-bundle.zip` when the node's advertised RPC API address is known, otherwise `<unix-timestamp>-bundle.zip`.
2. If the path has no extension, `.zip` is appended automatically.
3. Extensions other than `.zip` are rejected.
4. If write permission is denied on the target directory and `--output` was **not** explicitly set, the file is placed in `$HOME/` instead.
5. If `--output` was explicitly set and the target directory is not writable, the command fails.

---

## Bundle Contents: Linux (Bare-Metal)

The following files are collected when running on a Linux host outside Kubernetes.

### Kafka Metadata (`kafka.json`)

A JSON array of Admin API results, including:

| Entry | Description |
|---|---|
| `metadata` | Cluster ID, controller node, broker list, topic/partition list |
| `topic_configs` | Per-topic configuration values |
| `broker_configs` | Per-broker configuration values |
| `log_start_offsets` | Earliest available offset per partition |
| `last_stable_offsets` | Last stable (committed) offset per partition |
| `high_watermarks` | High watermark (end offset) per partition |
| `groups` | All consumer groups with member and state info |
| `group_commits_<name>` | Committed offsets for each consumer group |

Inspect with `jq`:
```bash
# Cluster metadata (brokers, cluster ID)
cat kafka.json | jq '.[0]'

# Consumer groups
cat kafka.json | jq '.[] | select(.Name == "groups")'
```

### Admin API Snapshots (`admin/`)

Multiple Admin API endpoints are called and saved as JSON files. Cluster-wide files (one per cluster) and per-node files (one per broker address, with the address sanitized by replacing special characters with `-`) are both included.

**Cluster-wide files:**

| File | rpadmin client method | Content |
|---|---|---|
| `admin/brokers.json` | `cl.Brokers` | Broker list with node IDs, version, and maintenance status |
| `admin/broker_uuids.json` | `cl.GetBrokerUuids` | Broker UUID mapping |
| `admin/health_overview.json` | `cl.GetHealthOverview` | Cluster health: is_healthy, under-replicated/leaderless counts |
| `admin/license.json` | `cl.GetLicenseInfo` | Enterprise license info |
| `admin/reconfigurations.json` | `cl.Reconfigurations` | In-progress partition reconfigurations |
| `admin/features.json` | `cl.GetFeatures` | Feature flags |
| `admin/uuid.json` | `cl.ClusterUUID` | Cluster UUID |
| `admin/metrics_uuid.json` | `cl.MetricsUUID` | Metrics UUID |
| `admin/automated_recovery.json` | `cl.PollAutomatedRecoveryStatus` | Automated recovery status |
| `admin/cloud_storage_lifecycle.json` | `cl.CloudStorageLifecycle` | Tiered storage lifecycle state |
| `admin/partition_balancer_status.json` | `cl.GetPartitionStatus` | Partition balancer state |
| `admin/cluster_config.json` | `cl.Config` | All cluster-wide configuration values |
| `admin/cluster_config_status.json` | `cl.ClusterConfigStatus` | Cluster config status |
| `admin/cluster_partitions.json` | `cl.AllClusterPartitions` | All cluster partitions |
| `admin/kafka_connections.json` | `cl.ClusterService().ListKafkaConnections` | Kafka connections (up to `--kafka-connections-limit`) |

**Per-node files** (one per broker; `<addr>` is the sanitized broker address):

| File | rpadmin client method | Content |
|---|---|---|
| `admin/node_config_<addr>.json` | `cl.RawNodeConfig` | Node-specific configuration |
| `admin/cluster_view_<addr>.json` | `cl.ClusterView` | Cluster view from this node |
| `admin/maintenance_status_<addr>.json` | `cl.MaintenanceStatus` | Maintenance mode status |
| `admin/raft_status_<addr>.json` | `cl.RaftRecoveryStatus` | Raft recovery progress |
| `admin/partition_leader_table_<addr>.json` | `cl.PartitionLeaderTable` | Partition leader assignments |
| `admin/is_node_isolated_<addr>.json` | `cl.IsNodeIsolated` | Whether the node is network-isolated |
| `admin/controller_status_<addr>.json` | `cl.ControllerStatus` | Controller status |
| `admin/disk_stat_data_<addr>.json` | `cl.DiskData` | Data directory disk stats |
| `admin/disk_stat_cache_<addr>.json` | `cl.DiskCache` | Cache directory disk stats |
| `admin/cpu_profile_<addr>.json` | `cl.RawCPUProfile` | CPU flame-graph data (collected for `--cpu-profiler-wait` duration) |

For extra partition requests (when `--partition` is provided), files are written to a top-level `partitions/` directory (not under `admin/`), one file per request type per partition. The filename pattern is `partitions/<type>_<namespace>_<topic>_<partition>.json` (the cloud variants omit the namespace):

```bash
# Partition info / debug detail
cat partitions/info_<namespace>_<topic>_<partition>.json | jq
cat partitions/debug_<namespace>_<topic>_<partition>.json | jq

# Tiered-storage status for the partition (namespace omitted in the filename)
cat partitions/cloud_status_<topic>_<partition>.json | jq
cat partitions/cloud_manifest_<topic>_<partition>.json | jq
cat partitions/cloud_anomalies_<namespace>_<topic>_<partition>.json | jq

# Example for --partition kafka/orders/0:
cat partitions/info_kafka_orders_0.json | jq
```

Inspect key admin files:
```bash
# Check broker versions
cat admin/brokers.json | jq '.[] | {node_id, version}'

# Check maintenance mode status
cat admin/brokers.json | jq '.[] | {node_id, maintenance_status}'

# Get the full cluster config (useful for auditing)
cat admin/cluster_config.json | jq

# Check license
cat admin/license.json | jq
```

### Broker Metrics (`metrics/`)

Two Prometheus scrapes of `/metrics` and `/public_metrics` per broker, taken at `--metrics-interval` apart. Files are organized per broker address (with special characters replaced by `-` via `SanitizeName`):

```
metrics/<broker-addr>/t0_metrics.txt           # /metrics snapshot 0 for this broker
metrics/<broker-addr>/t0_public_metrics.txt    # /public_metrics snapshot 0 for this broker
metrics/<broker-addr>/t1_metrics.txt           # /metrics snapshot 1 for this broker
metrics/<broker-addr>/t1_public_metrics.txt    # /public_metrics snapshot 1 for this broker
```

Example with a broker at `127.0.0.1:9644`:
```
metrics/127.0.0.1-9644/t0_metrics.txt
metrics/127.0.0.1-9644/t0_public_metrics.txt
metrics/127.0.0.1-9644/t1_metrics.txt
metrics/127.0.0.1-9644/t1_public_metrics.txt
```

Useful for computing rates (e.g., bytes/sec) from counters.

### Redpanda Configuration (`redpanda.yaml`)

The node's `redpanda.yaml` with SASL credentials and other sensitive fields redacted to `(REDACTED)`.

### Logs (`redpanda.log`)

Journald logs for the `redpanda` systemd unit, starting from `--logs-since` (default: yesterday) up to `--logs-until`, capped at `--logs-size-limit` (default: 100MiB).

```bash
# Search for errors
grep -i "error\|warn\|panic" redpanda.log | tail -100
```

### Controller Logs (`controller-logs/`)

Raft controller log segments from `<data-dir>/redpanda/controller/0_0/`, stored under `controller-logs/redpanda/controller/0_0/`. Files follow the naming pattern `{base_offset}-{term}-v{version}.log`. If the directory exceeds `--controller-logs-size-limit`, the command keeps a slice from the head and tail of the sorted log (by base offset and term).

### Data Directory Map (`data-dir.txt`)

A JSON map of every file and directory in the Redpanda data directory. Each entry has the JSON keys: `size` (human-readable), `mode`, `modified`, `user`, `group`, and `size_bytes` (integer). Useful for spotting permission issues, unexpected files, or partition size imbalances.

```bash
# Check file permissions
cat data-dir.txt | jq 'to_entries[] | select(.value.mode | contains("---"))'

# Find large files
cat data-dir.txt | jq 'to_entries | sort_by(.value.size_bytes) | reverse | .[:20] | .[] | {path: .key, size: .value.size}'
```

### Process and System (`proc/`, `resource-usage.json`)

| File | Content |
|---|---|
| `proc/cpuinfo` | `/proc/cpuinfo` — CPU make, cores, cache, frequency |
| `proc/diskstats/t0.txt`, `proc/diskstats/t1.txt` | Sampled `/proc/diskstats` |
| `proc/interrupts/t0.txt`, `proc/interrupts/t1.txt` | Sampled `/proc/interrupts` |
| `proc/softirqs/t0.txt`, `proc/softirqs/t1.txt` | Sampled `/proc/softirqs` |
| `proc/mounts` | `/proc/mounts` — mounted filesystems |
| `proc/cmdline` | `/proc/cmdline` — kernel command line |
| `proc/mdstat` | `/proc/mdstat` — RAID status |
| `proc/kallsyms` | `/proc/kallsyms` — kernel symbol table |
| `proc/slabinfo` | `/proc/slabinfo` — kernel slab allocator (requires root) |
| `resource-usage.json` | CPU %, free memory for the Redpanda process |

### Utilities (`utils/`)

| File | Source command | Content |
|---|---|---|
| `utils/ntp.txt` | `pool.ntp.org` NTP query | RTT, remote time, local time, clock offset. Useful for diagnosing clock skew. |
| `utils/df.txt` | `df -aT` | All mounted filesystem usage |
| `utils/du.txt` | `du -h <data-dir>` | Disk usage of Redpanda data directory |
| `utils/syslog.txt` | syslog ring buffer | Kernel and system messages |
| `utils/sysctl.txt` | `sysctl -a` | All kernel parameters |
| `utils/ss.txt` | `ss` | Active socket connections |
| `utils/ip.txt` | `ip addr` | Network interface configuration |
| `utils/uname.txt` | `uname -a` | Kernel version and build |
| `utils/uptime.txt` | `uptime` | System load average and uptime |
| `utils/free.txt` | `free` | Memory usage summary |
| `utils/dig.txt` | `dig` | DNS lookup against `/etc/resolv.conf` |
| `utils/lspci.txt` | `lspci` | PCI bus devices |
| `utils/lsblk.txt` | `lsblk --all` | Block device list |
| `utils/dmidecode.txt` | `dmidecode` | DMI/SMBIOS table (root only) |
| `utils/top.txt` | `top -b -n 10 -H -d 1` | 10 iterations of top (threads, per-second updates) |
| `utils/vmstat.txt` | `vmstat -w 1 10` | 10 samples of virtual memory stats |
| `utils/ethtool/<iface>_i.txt` | `ethtool -i <iface>` | NIC driver and firmware info (physical interfaces only) |
| `utils/ethtool/<iface>_l.txt` | `ethtool -l <iface>` | NIC channel/queue counts |
| `utils/ethtool/<iface>_c.txt` | `ethtool -c <iface>` | NIC coalesce settings |

Check NTP drift:
```bash
cat utils/ntp.txt | jq '{offset_ms: (.offset / 1000000), rtt_ms: .roundTripTimeMs}'
```

### Crash Information

| File | Description |
|---|---|
| `startup_log` | Startup log from `<data-dir>/startup_log` if present |
| `crash_reports/<file>` | All files under `<data-dir>/crash_reports/` if present |

---

## Bundle Contents: Kubernetes

When running inside a Kubernetes pod (detected by `KUBERNETES_SERVICE_HOST` and `KUBERNETES_SERVICE_PORT` being set), the bundle uses the in-cluster Kubernetes API to discover resources and collect pod logs.

**Files present (same as Linux):** `admin/`, `kafka.json`, `redpanda.yaml`, `data-dir.txt`, `resource-usage.json`, `proc/cpuinfo`, `proc/diskstats`, `proc/interrupts`, `proc/softirqs`, `proc/mounts`, `proc/cmdline`, `proc/mdstat`, `proc/kallsyms`, `proc/slabinfo`, `utils/df.txt`, `utils/du.txt`, `utils/ntp.txt`, `utils/lsblk.txt`, `utils/uname.txt`, `controller-logs/`, `crash_reports/`, `startup_log`

**Additional Kubernetes files:**

| File/Directory | Content |
|---|---|
| `k8s/pods.json` | Pod manifests in the target namespace |
| `k8s/services.json` | Service manifests |
| `k8s/configmaps.json` | ConfigMap manifests |
| `k8s/endpoints.json` | Endpoints |
| `k8s/events.json` | Kubernetes events |
| `k8s/persistentvolumeclaims.json` | PVC manifests |
| `k8s/serviceaccounts.json` | ServiceAccount manifests |
| `k8s/limitranges.json` | LimitRange manifests |
| `k8s/resourcequotas.json` | ResourceQuota manifests |
| `k8s/replicationcontrollers.json` | ReplicationController manifests |
| `logs/<pod>-<container>.txt` | Logs from each container of each Redpanda pod |
| `logs/<pod>-init-<container>.txt` | Logs from each init container of each Redpanda pod |

**Not collected in Kubernetes:** syslog, sysctl, ss, ip addr, lspci, dmidecode, ethtool, dig, top, vmstat, free, redpanda.log (journald) — these are OS-level utilities or journald, which are not available inside the container.

**K8s label selector:** Use `--label-selector` to filter which pods' logs are collected. Default is `app.kubernetes.io/name=redpanda`. Multiple selectors are comma-separated.

**Permissions:** The ServiceAccount running the bundle command needs `list`/`get`/`watch` on pods, services, configmaps, endpoints, events, PVCs, serviceaccounts, limitranges, resourcequotas, and `get` on pod logs in the target namespace.

---

## Examples

### Collect logs from a specific date range

```bash
rpk debug bundle \
  --logs-since "2024-11-15" \
  --logs-until "2024-11-16" \
  --logs-size-limit 200MiB
```

### Collect with a longer CPU profile

```bash
rpk debug bundle --cpu-profiler-wait 60s
```

### Collect extra partition diagnostics

```bash
# Extra Admin API detail for partitions 0, 1, 2 of topic "orders"
rpk debug bundle --partition orders/0,1,2

# Internal namespace
rpk debug bundle --partition _redpanda-internal/controller/0
```

### Kubernetes with a custom namespace

```bash
rpk debug bundle --namespace my-redpanda-ns
```

### Kubernetes with custom pod label selector

```bash
rpk debug bundle \
  --namespace my-redpanda-ns \
  --label-selector "app.kubernetes.io/name=redpanda,app.kubernetes.io/instance=prod"
```

### Upload to Redpanda Support

```bash
rpk debug bundle \
  --output /tmp/support-bundle.zip \
  --upload-url "https://redpanda-support.s3.amazonaws.com/...presigned-url..."
```

### Collect with a non-default Admin API address

```bash
rpk debug bundle -X admin.hosts=192.168.100.5:9644
```

---

## Inspecting the Bundle

```bash
# Unzip
unzip 1234567890-bundle.zip -d bundle-dir
cd bundle-dir/1234567890-bundle/

# Broker versions
cat admin/brokers.json | jq '.[] | {node_id, version}'

# Cluster health (under-replicated partitions, leaderless partitions)
cat admin/health_overview.json | jq

# Cluster config
cat admin/cluster_config.json | jq '{"log_retention_ms": .log_retention_ms, "log_segment_size": .log_segment_size}'

# Redpanda logs (Linux)
grep -i "WARN\|ERROR" redpanda.log | tail -50

# Data dir anomalies: largest files
cat data-dir.txt | jq 'to_entries | sort_by(.value.size_bytes) | reverse | .[:10] | .[] | {path: .key, size: .value.size}'

# NTP offset (microseconds, negative = local clock behind)
cat utils/ntp.txt | jq '{offset_us: (.offset / 1000), rtt_ms: .roundTripTimeMs}'

# Consumer group lag
cat kafka.json | jq '.[] | select(.Name == "groups") | .Response'

# CPU profile (per-node; replace <addr> with the sanitized broker address, e.g. 127.0.0.1-9644)
cat admin/cpu_profile_<addr>.json | jq 'length'
```

---

## `errors.txt`

If any collection step fails (e.g., `journalctl` not found, Admin API unreachable), the error details are written to `errors.txt` inside the bundle. The ZIP is still created — partial data is better than no data.
