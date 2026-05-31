# Debug Bundle Reference

A debug bundle is a ZIP archive of diagnostic data collected from a Redpanda
broker or cluster. It contains logs, metrics snapshots, Admin API responses,
OS-level data, and optionally CPU profiles. This is the primary artifact to
share with Redpanda support.

## Two collection modes

| Mode | Command | When to use |
|---|---|---|
| Local | `rpk debug bundle` | Run on the broker node itself; collects the richest OS-level data (syslog, /proc, ss, top, vmstat) |
| Remote | `rpk debug remote-bundle` | Run from any machine with Admin API access; collects from all configured brokers; no SSH required |

---

## rpk debug bundle (local)

### Basic usage

```bash
# Run on the broker host (Linux). Writes to ./<timestamp>-bundle.zip by default.
rpk debug bundle

# Specify output location
rpk debug bundle --output /tmp/bundle.zip

# Upload directly to Redpanda support using the signed URL they provide
rpk debug bundle --upload-url "https://redpanda-support-uploads.s3.amazonaws.com/..."
```

### All flags

Flags come from `DebugBundleSharedOptions` in
`redpanda/src/go/rpk/pkg/cli/debug/debugbundle/common.go`.

| Flag | Default | Notes |
|---|---|---|
| `--logs-since` | `yesterday` | journalctl date (YYYY-MM-DD, `yesterday`, `today`, or any journalctl-compatible format) |
| `--logs-until` | _(empty — no end)_ | journalctl date for the end of the log window |
| `--logs-size-limit` | `100MiB` | Stop reading logs once this size is reached; accepts human units (3MB, 1GiB) |
| `--controller-logs-size-limit` | `132MB` | Max size of controller logs included |
| `--cpu-profiler-wait` | `30s` | Duration for CPU profiler collection; must be > 15s (Seastar samples every ~13s) |
| `--metrics-samples` | `2` | Number of Prometheus metric snapshots; must be >= 2 |
| `--metrics-interval` | `10s` | Interval between metric snapshots |
| `--partition` / `-p` | _(none)_ | Extra Admin API requests for specific partitions. Format: `{namespace}/topic/partition,...` (namespace optional, defaults to `kafka`). Example: `--partition foo/1,2,3` or `--partition _redpanda-internal/bar/2` |
| `--namespace` / `-n` | _(empty)_ | Kubernetes namespace to collect resources from (K8s only) |
| `--label-selector` / `-l` | `app.kubernetes.io/name=redpanda` | K8s label selector for Pods to collect (K8s only) |
| `--kafka-connections-limit` | `256` | Max Kafka connection records to store |
| `--output` / `-o` | `./<timestamp>-bundle.zip` | Output path |
| `--upload-url` | _(none)_ | Pre-signed S3 URL from support for direct upload |
| `--timeout` | `60s` | Timeout for child commands (e.g., 30s, 1.5m) |

### Linux vs Kubernetes detection

The `bundle` command auto-detects the environment by checking the
`KUBERNETES_SERVICE_HOST` and `KUBERNETES_SERVICE_PORT` environment variables.
If both are set, it runs the Kubernetes collection path. This means on a bare-
metal or VM host the environment variables must NOT be set for the Linux path
to run.

### Kubernetes prerequisites

Before running `rpk debug bundle` inside a Kubernetes Pod, ensure the Pod
has RBAC permissions to read Kubernetes resources:

```bash
# Quick ClusterRoleBinding (development/support use only)
kubectl create clusterrolebinding redpanda \
  --clusterrole=view \
  --serviceaccount=redpanda:default

# Or via Helm (recommended for production)
helm upgrade redpanda redpanda/redpanda -n redpanda --reuse-values \
  --set serviceAccount.create=true \
  --set rbac.enabled=true
```

Then run the bundle from inside the Pod:

```bash
kubectl exec -it -n redpanda redpanda-0 -c redpanda -- \
  rpk debug bundle --namespace redpanda
```

Copy it to your local machine:

```bash
kubectl cp redpanda/redpanda-0:/var/lib/redpanda/<bundle-name>.zip \
  debug-bundle/<bundle-name>.zip
```

---

## rpk debug remote-bundle (cluster-wide)

Orchestrates bundle collection through the Admin API on each broker in your
profile. Useful when you cannot SSH into each node.

### Full workflow

```bash
# 1. Ensure your rpk profile has all admin.hosts configured
rpk profile create prod \
  --set admin.hosts=broker1:9644,broker2:9644,broker3:9644

# 2. Start collection (prompts for confirmation by default)
rpk debug remote-bundle start

# Without confirmation (for scripts)
rpk debug remote-bundle start --no-confirm

# Wait inline for completion (default timeout: 300s)
rpk debug remote-bundle start --wait
rpk debug remote-bundle start --wait --wait-timeout 600s

# Target a single broker
rpk debug remote-bundle start -X admin.hosts=broker2:9644

# 3. Check status
rpk debug remote-bundle status

# 4. Download when status is "success" on all brokers
# Prompts for confirmation by default; use --no-confirm for scripts
rpk debug remote-bundle download
rpk debug remote-bundle download --no-confirm

# Download to a specific path (appends .zip extension; ~/bundles/ must exist as a dir but
# the output path must NOT be an existing directory — default filename is <timestamp>-remote-bundle.zip)
rpk debug remote-bundle download --output ~/bundles/cluster1  # saves as ~/bundles/cluster1.zip

# 5. Cancel if needed
rpk debug remote-bundle cancel
```

### Status values

The `status` command outputs a table with `BROKER`, `STATUS`, and `JOB-ID`
columns. `STATUS` can be:
- `running` — collection in progress
- `success` — bundle ready to download
- `error` — collection failed on that broker

Each broker runs its own bundle collection in parallel. A unique Job-ID UUID
is generated (or supplied with `--job-id`) to correlate the run across brokers.

### Shared flags

`rpk debug remote-bundle start` accepts the same `DebugBundleSharedOptions`
flags as `rpk debug bundle` (logs-since/until, cpu-profiler-wait, metrics-*,
partition, namespace, label-selector).

---

## Bundle contents

### Common files (all environments)

| Path | Contents |
|---|---|
| `admin/brokers.json` | Broker list, node IDs, versions, maintenance status |
| `admin/cluster_config.json` | Full cluster config (SASL credentials stripped) |
| `admin/health_overview.json` | Cluster health: `is_healthy`, `leaderless_count`, `under_replicated_count` |
| `admin/partition_balancer_status.json` | Partition balancer status |
| `admin/cloud_storage_lifecycle.json` | Tiered Storage / shadow-index status |
| `admin/cpu_profile_<addr>.json` | CPU profiler samples per broker (duration = `--cpu-profiler-wait`) |
| `admin/license.json` | Enterprise license info (loaded, org, type, expires) |
| `kafka.json` | Kafka metadata, topic/broker configs, log start/end offsets, consumer groups |
| `data-dir.txt` | Data directory structure: permissions, sizes, modification times (JSON) |
| `metrics/<broker-addr>/t0_public_metrics.txt` | Prometheus `/public_metrics` snapshots; one subdir per broker, N samples |
| `metrics/<broker-addr>/t0_metrics.txt` | Prometheus `/metrics` (internal) snapshots; same layout |
| `startup_log` | Startup/crash counter log (top-level bundle file) |
| `crash_reports/` | Crash report files from the broker data directory |
| `utils/ntp.txt` | NTP clock delta (vs pool.ntp.org), RTT |

### Bare-metal additional

| Path | Contents |
|---|---|
| `redpanda.log` | Redpanda journald logs for the time window |
| `utils/syslog.txt` | Kernel ring buffer (dmesg / syslog) |
| `sysctl.txt` | Kernel parameters |
| `proc/` | /proc files: CPU info, caches, frequencies, interrupts, mounts, meminfo, cmdline |
| `utils/ss.txt` | Active socket info (`ss` output) |
| `utils/top.txt` | Running process info (`top`) |
| `utils/vmstat.txt` | Virtual memory stats |
| `utils/ip.txt` | Network configuration (`ip addr`) |
| `utils/lspci.txt` | PCI devices |
| `utils/du.txt` | Disk usage of the data directory |
| `utils/df.txt` | Disk free space |
| `utils/free.txt` | Memory usage summary |
| `utils/lsblk.txt` | Block device layout |
| `utils/uname.txt` | Kernel/OS version |
| `utils/dmidecode.txt` | DMI table (only if run as root) |
| `utils/uptime.txt` | System load average |
| `utils/dig.txt` | DNS info (`dig`) |

### Kubernetes additional

| Path | Contents |
|---|---|
| `logs/redpanda-N.txt` | Per-Pod logs for the namespace |
| `k8s/configmaps.json` | ConfigMaps |
| `k8s/events.json` | Kubernetes events (sort by `creationTimestamp` for recent issues) |
| `k8s/pods.json` | Pod manifests and status |
| `k8s/persistentvolumeclaims.json` | PVCs |
| `k8s/services.json` | Services |
| `k8s/endpoints.json` | Endpoints |
| `k8s/serviceaccounts.json` | Service accounts |

---

## Inspecting the bundle

Install `jq` for readable JSON output. All Admin API responses are JSON files.

```bash
unzip 1675440652-bundle.zip -d bundle/
cd bundle/

# Broker versions
cat admin/brokers.json | jq '.[] | {node_id: .node_id, version: .version}'

# Is the cluster healthy? How many leaderless/under-replicated partitions?
cat admin/health_overview.json | jq '{is_healthy, leaderless_count, under_replicated_count}'

# Maintenance status per broker
cat admin/brokers.json | jq '.[] | {node_id: .node_id, maintenance: .maintenance_status}'

# Check enterprise license
cat admin/license.json | jq '{loaded: .loaded, org: .license.org, expires: .license.expires}'

# Cluster config value (e.g., retention)
cat admin/cluster_config.json | jq '.log_retention_ms'

# Disk usage anomalies — look for one partition much larger than others
cat utils/du.txt

# NTP offset in microseconds (large values = clock drift)
cat utils/ntp.txt | jq .offset

# Consumer group lag from kafka.json
cat kafka.json | jq '.[] | select(.Name == "groups")'

# CPU profile — top samples by occurrences (replace <addr> with actual broker address)
# Response: {profile: [{shard_id, dropped_samples, samples: [{user_backtrace, scheduling_group, occurrences}]}]}
cat admin/cpu_profile_<addr>.json | jq \
  '.profile[] | {shard: .shard_id, top: (.samples | sort_by(-.occurrences) | .[0:5])}'

# Kubernetes events sorted by time
cat k8s/events.json | jq '.items | sort_by(.metadata.creationTimestamp) | .[-20:]'
```

### Crash / startup loop investigation

```bash
# startup_log is a top-level file in the bundle (tracks consecutive crash count; resets after 1 hour)
cat startup_log

# Recent crash stack traces live in crash_reports/ (plural)
ls crash_reports/
cat crash_reports/*.txt | head -100
```

---

## Automatic bundle removal

Configure the `debug_bundle_auto_removal_seconds` cluster property to
automatically delete bundles from broker nodes after a period of time:

```bash
rpk cluster config set debug_bundle_auto_removal_seconds 86400  # 24 hours
```

**Note:** This property only governs bundles triggered remotely — via
`rpk debug remote-bundle`, Redpanda Console, or the Admin API. It does **not**
affect bundles created with `rpk debug bundle` (local collection), which must
be deleted manually.

---

## Related skills

- `rpk-debug` — CLI flag reference for `rpk debug bundle` and `rpk debug remote-bundle`
- `streaming-admin-api` — Raw HTTP Admin API endpoint reference (port 9644)
- `streaming-debugging` (SKILL.md) — Triage playbooks and metrics reference
