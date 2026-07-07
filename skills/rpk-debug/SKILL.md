---
name: rpk-debug
description: >-
  Collects local and remote Redpanda diagnostics bundles and gathers broker
  process info using the `rpk debug` command group. Use when: collecting a
  debug bundle for Redpanda support or self-triage, generating a
  remote (cluster-wide) bundle via the Admin API, gathering local broker
  process or diagnostic info from the CLI, using rpk debug bundle or rpk debug
  remote-bundle, troubleshooting a Redpanda cluster and needing to capture
  logs/metrics/profiles, passing a debug bundle to the support team, or
  running rpk debug on Linux or Kubernetes. Also covers triaging enterprise
  (license-gated) features from a bundle — Tiered Storage, Cloud Topics,
  Iceberg Topics, Continuous Data Balancing, Shadow Linking (cross-cluster
  DR), Remote Read Replicas, Audit Logging, RBAC/GBAC, OIDC/OAuthBearer/
  Kerberos auth, FIPS mode, Server-side Schema ID Validation, Schema Registry
  Authorization, and Leadership Pinning, plus checking license status and
  license violations. Applies to self-managed deployments only (Linux hosts
  and Kubernetes) — Redpanda Cloud clusters do not support rpk debug or
  debug bundles.
---

# rpk debug: Debug Bundles & Local Diagnostics

`rpk debug` is the CLI command group for collecting diagnostic data from a Redpanda cluster. It produces a ZIP archive (a "diagnostics bundle") containing logs, metrics, Admin API snapshots, CPU profiles, Kafka metadata, and system information. Bundles can be collected locally on a single node (`rpk debug bundle`) or cluster-wide through the Admin API (`rpk debug remote-bundle`).

The bundle can be sent directly to the Redpanda support team via `--upload-url`, or inspected locally with standard tools such as `unzip` and `jq`.

There are three subcommands: `bundle`, `remote-bundle`, and `info` (the last is a hidden no-op originally for sending usage stats to Redpanda Data; has a `status` alias; kept for backward compatibility).

## Scope: Self-Managed Deployments Only

`rpk debug` targets **self-managed** deployments: bare-metal/VM Linux hosts (run `bundle` on the broker host) and Kubernetes (run inside the Redpanda container, with `--namespace`). It does **not** work against **Redpanda Cloud** clusters (Serverless, BYOC, or Dedicated): the Cloud docs list Redpanda debug bundles, the Admin API, and `rpk debug` itself as unsupported functionality, and Cloud clusters do not expose broker hosts to run a local bundle on (`remote-bundle` needs the Admin API, which Cloud does not expose). Cluster-side diagnostics for Cloud clusters are handled by Redpanda — open a ticket with Redpanda Support instead of trying to collect a bundle.

The usual live-triage fallbacks are also unsupported on Cloud: `rpk cluster health`, `rpk cluster license`, `rpk cluster maintenance`, `rpk cluster partitions`, and `rpk cluster self-test` do not work there. For client-side triage against a Cloud cluster, use the Kafka-API surface via your cloud profile (`rpk cloud login`, then cluster select): for example `rpk cluster info`, `rpk topic describe`/`consume`, `rpk group describe`, and `rpk cluster logdirs describe`.

## Quickstart

```bash
# --- Local bundle (bare-metal, run on the broker host) ---

# Basic: collect yesterday's logs (default), 30s CPU profile, 2 metrics samples
rpk debug bundle

# With an explicit log window and a larger log size limit
rpk debug bundle \
  --logs-since "2024-11-01" \
  --logs-until "2024-11-02" \
  --logs-size-limit 500MiB

# Write to a specific path and upload directly to Redpanda Support
rpk debug bundle \
  --output /tmp/my-bundle.zip \
  --upload-url "https://...presigned-s3-url..."

# Include extra Admin API detail for specific partitions
rpk debug bundle --partition my-topic/0,1,2

# Kubernetes: run inside the Redpanda container, specify the namespace
rpk debug bundle --namespace redpanda

# --- Remote bundle (cluster-wide, uses Admin API) ---

# Start collection on all brokers configured in your rpk profile
rpk debug remote-bundle start

# Or target specific brokers and wait for completion
rpk debug remote-bundle start \
  -X admin.hosts=broker-0:9644,broker-1:9644 \
  --wait --wait-timeout 10m

# Check status across all brokers
rpk debug remote-bundle status

# Download completed bundles (ZIP-of-ZIPs) to disk
rpk debug remote-bundle download --output /tmp/cluster-bundle.zip

# Cancel an in-progress collection
rpk debug remote-bundle cancel

# --- Inspect the bundle ---
unzip 1234567890-bundle.zip -d bundle-dir
cd bundle-dir/<timestamp>-bundle/

# View broker versions
cat admin/brokers.json | jq '.[] | .version'

# Check cluster health data
cat admin/health_overview.json | jq

# View Redpanda logs (Linux)
cat redpanda.log | grep ERROR

# Check NTP clock drift
cat utils/ntp.txt | jq

# View Kafka metadata
cat kafka.json | jq '.[0]'

# View cluster configuration
cat admin/cluster_config.json | jq
```

## Subcommands

| Subcommand | Purpose |
|---|---|
| `bundle` | Collect a diagnostics bundle from the **local** broker process |
| `remote-bundle start` | Start bundle collection on all brokers via the Admin API |
| `remote-bundle status` | Poll bundle-collection status across all brokers |
| `remote-bundle download` | Download completed per-broker bundles into a ZIP-of-ZIPs |
| `remote-bundle cancel` | Cancel an in-progress remote bundle collection |
| `info` | (Hidden, no-op) Originally for sending usage stats to Redpanda Data; has a hidden `status` alias. Kept for backward compatibility only. |

## When to Use Each

**`rpk debug bundle`** is the right choice when:
- You have shell access to the broker host or Kubernetes pod.
- You need the most complete set of OS-level data (syslog, sysctl, NTP drift, ethtool, lspci, dmidecode, socket info).
- You are on a single node and do not need data from every broker.

**`rpk debug remote-bundle`** is the right choice when:
- You want a cluster-wide bundle without logging in to each broker.
- You are running in an environment where shell access to individual brokers is restricted.
- You want the Admin API to orchestrate collection and can poll status until ready.

## What a Bundle Contains

See [bundle.md](references/bundle.md) for the full file manifest. Key sections:

- `admin/` — Snapshots of Admin API responses. Cluster-wide files include `brokers.json`, `broker_uuids.json`, `health_overview.json`, `license.json`, `features.json`, `partition_balancer_status.json`, `cloud_storage_lifecycle.json`, `cluster_config.json`, `cluster_partitions.json`, and more. Per-node files use the pattern `<type>_<sanitized-addr>.json` (e.g., `raft_status_<addr>.json`, `cpu_profile_<addr>.json`, `maintenance_status_<addr>.json`).
- `kafka.json` — Kafka metadata: broker configs, topic configs, offsets, consumer groups and committed offsets
- `redpanda.yaml` — Node configuration (SASL credentials redacted)
- `redpanda.log` — Journald logs for the `redpanda` unit (Linux), or per-pod logs (Kubernetes)
- `controller-logs/` — Raft controller log segments up to `--controller-logs-size-limit`
- `data-dir.txt` — JSON map of every file/directory in the Redpanda data directory; per-entry keys: `size`, `mode`, `modified`, `user`, `group`, `size_bytes`
- `resource-usage.json` — CPU %, free memory for the Redpanda process
- `utils/` — `ntp.txt`, `df.txt`, `du.txt`, `syslog.txt`, `ss.txt`, `ip.txt`, `uname.txt`, `uptime.txt`, `free.txt`, `dig.txt`, `sysctl.txt`, `lspci.txt`, `lsblk.txt`, `dmidecode.txt`, `top.txt`, `vmstat.txt`, `ethtool/`
- `proc/` — Sampled snapshots of `/proc/cpuinfo`, `/proc/diskstats`, `/proc/interrupts`, `/proc/softirqs`
- `k8s/` (Kubernetes only) — Kubernetes manifests for pods, services, configmaps, endpoints, events, PVCs, etc.
- `crash_reports/` and `startup_log` — Present if Redpanda has previously crashed

## Triaging Enterprise Features from a Bundle

A debug bundle is the primary diagnostic surface for Redpanda's **enterprise (license-gated) features**: their config and runtime state are captured in `admin/cluster_config.json`, `kafka.json` (topic configs), the per-node `admin/node_config_<addr>.json`, the metrics scrapes, and feature-specific Admin API snapshots (`admin/license.json`, `admin/cloud_storage_lifecycle.json`, `admin/partition_balancer_status.json`, `admin/automated_recovery.json`).

When triaging any enterprise feature, **check the license first** — an expired or missing license puts active enterprise features into a restricted state:

```bash
cat admin/license.json | jq          # in-bundle license + violation status
rpk cluster license info             # live: 'license violation' true/false
```

Enterprise features whose state lives in a bundle, and their controlling keys (all require an Enterprise license):

| Feature | Primary key(s) | Where in bundle |
|---|---|---|
| Tiered Storage | `cloud_storage_enabled`; topic `redpanda.remote.read/write/delete`, `retention.local.target.{bytes,ms}` | `admin/cluster_config.json`, `admin/cloud_storage_lifecycle.json`, `kafka.json`, `partitions/cloud_*` |
| Remote Read Replicas | `cloud_storage_enable_remote_read`, `cloud_storage_enable_remote_write` | `admin/cluster_config.json` |
| Topic Recovery / WCR | topic `redpanda.remote.recovery` | `kafka.json`, `admin/automated_recovery.json` |
| Iceberg Topics | `iceberg_enabled`, `iceberg_catalog_type`; topic `redpanda.iceberg.mode` (`key_value`/`value_schema_id_prefix`/`value_schema_latest`/`disabled`), `.delete`, `.partition.spec`, `.target.lag.ms`, `.invalid.record.action` (`drop`/`dlq_table`) | `admin/cluster_config.json`, `kafka.json` |
| Cloud Topics | topic `redpanda.cloud_topic.enabled` | `kafka.json` |
| Continuous Data Balancing | `partition_autobalancing_mode` (`continuous`/`node_add`/`off`), `partition_autobalancing_max_disk_usage_percent`, `partition_autobalancing_concurrent_moves`, `partition_autobalancing_node_availability_timeout_sec`, `core_balancing_continuous` | `admin/cluster_config.json`, `admin/partition_balancer_status.json`, `admin/reconfigurations.json` |
| Shadow Linking (DR) | live `rpk shadow status`/`describe` | `admin/health_overview.json`, `admin/cluster_config.json` |
| Leadership Pinning | `default_leaders_preference`; topic `redpanda.leaders.preference` | `admin/cluster_config.json`, `admin/partition_leader_table_<addr>.json` |
| Audit Logging | `audit_enabled`, `audit_log_num_partitions`, `audit_log_replication_factor`, `audit_failure_policy`, `audit_excluded_principals/topics` | `admin/cluster_config.json` |
| RBAC / GBAC | live `rpk security role/acl list` | live commands |
| OIDC / OAuthBearer / Kerberos | `sasl_mechanisms` (`OIDC`, `OAUTHBEARER`, `GSSAPI`), `http_authentication` | `admin/cluster_config.json` |
| Server-side Schema ID Validation | `enable_schema_id_validation`; topic `redpanda.{key,value}.schema.id.validation`, `.subject.name.strategy` | `admin/cluster_config.json`, `kafka.json` |
| Schema Registry Authorization | `schema_registry_enable_authorization` (boolean, default `false`; `true` requires Enterprise) | `admin/cluster_config.json` |
| FIPS Compliance | node `fips_mode` (`disabled`/`enabled`/`permissive`) | `admin/node_config_<addr>.json`, `redpanda.yaml` |
| Topic Deletion Control | `delete_topic_enable` | `admin/cluster_config.json` |

See [enterprise-triage.md](references/enterprise-triage.md) for the full per-feature key reference, the exact `jq` to read each, and the "what enterprise features are active" sweep command.

## Key Flags for `rpk debug bundle`

| Flag | Default | Description |
|---|---|---|
| `--logs-since` | `yesterday` | Include journald logs from this date onward (YYYY-MM-DD, `yesterday`, `today`) |
| `--logs-until` | (none) | Include journald logs up to this date. Not supported in Kubernetes |
| `--logs-size-limit` | `100MiB` | Stop reading logs after this size |
| `--controller-logs-size-limit` | `132MB` | Size cap on controller log segments |
| `--cpu-profiler-wait` | `30s` | How long to collect CPU profile samples. Must be >= 15s (values less than 15s are rejected) |
| `--metrics-samples` | `2` | Number of Prometheus metrics snapshots. Must be >=2 |
| `--metrics-interval` | `10s` | Time between metrics snapshots |
| `-p, --partition` | (none) | Extra Admin API requests for specific partitions (`topic/0,1,2`) |
| `-n, --namespace` | (none) | Kubernetes namespace (K8s only) |
| `-l, --label-selector` | `app.kubernetes.io/name=redpanda` | K8s label selector (K8s only) |
| `-o, --output` | `./<timestamp>-bundle.zip` | Output file path |
| `--upload-url` | (none) | Upload the bundle to this URL after creating it |
| `--timeout` | `60s` | Timeout for child commands |

## Key Flags for `rpk debug remote-bundle start`

| Flag | Default | Description |
|---|---|---|
| `--job-id` | (auto UUID) | Custom UUID for the job |
| `--no-confirm` | false | Skip confirmation prompt |
| `--wait` | false | Block until collection completes |
| `--wait-timeout` | `5m0s` | Local wait timeout when `--wait` is set |
| `--logs-since`, `--logs-until`, `--logs-size-limit`, `--controller-logs-size-limit`, `--cpu-profiler-wait`, `--metrics-samples`, `--metrics-interval`, `--partition`, `--namespace`, `--label-selector` | (same defaults as `bundle`) | Same semantics as `rpk debug bundle` |

## Connection Flags

Both commands accept standard rpk connection overrides:

```bash
# Override Admin API hosts inline
rpk debug bundle -X admin.hosts=192.168.1.10:9644

# Use a named profile
rpk debug bundle --profile prod-cluster

# With TLS
rpk debug bundle -X admin.tls.enabled=true -X admin.tls.ca=/path/to/ca.pem
```

## Reference Directory

- [bundle.md](references/bundle.md): Complete flag reference for `rpk debug bundle`, full file manifest by environment (Linux vs Kubernetes), output path logic, and examples for inspecting key files with `jq`.
- [remotebundle.md](references/remotebundle.md): `rpk debug remote-bundle` deep reference — start/status/cancel/download lifecycle, flags, Admin API interaction, the ZIP-of-ZIPs output format, and when to use remote vs local bundles.
- [enterprise-triage.md](references/enterprise-triage.md): How to triage every enterprise (license-gated) feature from a bundle — Tiered Storage, Remote Read Replicas, Topic Recovery/WCR, Iceberg Topics, Cloud Topics, Continuous Data Balancing, Shadow Linking (DR), Leadership Pinning, Audit Logging, RBAC/GBAC, OIDC/OAuthBearer/Kerberos, Server-side Schema ID Validation, Schema Registry Authorization, FIPS, and Topic Deletion Control. Maps each to its exact config keys / topic properties and the `jq` to read them, plus license-check-first guidance.
