# Triaging Enterprise Features in a Debug Bundle

`rpk debug bundle` and `rpk debug remote-bundle` are the primary diagnostic tools for Redpanda's **enterprise features**. Each enterprise feature leaves its configuration and runtime state inside the bundle, so when triaging an enterprise feature you inspect the captured Admin API snapshots, the cluster config, the topic configs, and the metrics scrapes.

This reference maps every **enterprise (license-gated) feature relevant to a debug bundle** to:
- the exact config keys / topic properties that control it (verified against the Redpanda property reference),
- where in the bundle to find them,
- and the `jq` you run to read them.

> **License note.** Every feature in this file is an **Enterprise Edition feature** and requires a valid Enterprise license. The bundle always captures `admin/license.json` (from `cl.GetLicenseInfo`) and the full cluster config in `admin/cluster_config.json`. Always check license status first when triaging an enterprise feature — an expired or missing license puts active enterprise features into a restricted state.

---

## Step 0: Always check the license first

```bash
# License type, expiry, and (critically) whether any enterprise feature is in violation
cat admin/license.json | jq

# The same data live: confirms the cluster is in/out of violation
rpk cluster license info
```

`rpk cluster license info` reports a `license violation` status that is `true` when an enterprise feature is enabled without a valid license. (It does **not** report violations for Redpanda Connect or Redpanda Console features.) If a feature behaves as "disabled / cannot be modified," check this first.

Enterprise features in `admin/features.json` (`cl.GetFeatures`) show feature-flag activation state cluster-wide.

---

## Tiered Storage (Enterprise)

Object-storage retention/offload. Enabled cluster-wide and per topic.

| Scope | Key | Notes |
|---|---|---|
| Cluster | `cloud_storage_enabled` | Master switch. Disable to drop the Tiered Storage enterprise feature (`rpk cluster config set cloud_storage_enabled false`). |
| Topic | `redpanda.remote.read` | Fetch from object storage (remote read / shadow indexing read path). |
| Topic | `redpanda.remote.write` | Upload local segments to object storage. |
| Topic | `redpanda.remote.delete` | Delete objects when the topic/segments are deleted. |
| Topic | `retention.local.target.bytes` | Local (on-disk) retention size cap; older data lives only in object storage. |
| Topic | `retention.local.target.ms` | Local retention time cap. |

Where to look in the bundle:

```bash
# Cluster master switch + all cloud_storage_* settings
cat admin/cluster_config.json | jq 'with_entries(select(.key | startswith("cloud_storage")))'

# Tiered Storage lifecycle state (cl.CloudStorageLifecycle)
cat admin/cloud_storage_lifecycle.json | jq

# Per-topic remote.read / remote.write / retention.local.* settings
cat kafka.json | jq '.[] | select(.Name == "topic_configs")'

# Per-partition tiered-storage detail (requires --partition at collection time)
cat partitions/cloud_status_<topic>_<partition>.json | jq
cat partitions/cloud_manifest_<topic>_<partition>.json | jq
cat partitions/cloud_anomalies_<namespace>_<topic>_<partition>.json | jq
```

> To capture per-partition cloud status, collect with `--partition <topic>/<partition>` (e.g. `rpk debug bundle --partition orders/0,1,2`). This produces the `partitions/cloud_*` files.

---

## Remote Read Replicas (Enterprise)

Read-only clusters that serve data from another cluster's object storage for DR.

| Scope | Key | Notes |
|---|---|---|
| Cluster | `cloud_storage_enable_remote_read` | Disable to drop the Remote Read Replicas enterprise feature. |
| Cluster | `cloud_storage_enable_remote_write` | Companion remote-write switch. |

```bash
cat admin/cluster_config.json | jq '{remote_read: .cloud_storage_enable_remote_read, remote_write: .cloud_storage_enable_remote_write}'
```

---

## Topic Recovery / Whole Cluster Restore (Enterprise)

| Scope | Key | Notes |
|---|---|---|
| Topic | `redpanda.remote.recovery` | Restore a single topic from Tiered Storage. License-gated. |

```bash
# Per-topic recovery flag
cat kafka.json | jq '.[] | select(.Name == "topic_configs")'

# Automated recovery status (cl.PollAutomatedRecoveryStatus)
cat admin/automated_recovery.json | jq
```

---

## Iceberg Topics (Enterprise)

Exposes topic data as Apache Iceberg tables. Requires cluster `iceberg_enabled=true` plus the per-topic `redpanda.iceberg.mode`.

| Scope | Key | Accepted values / notes |
|---|---|---|
| Cluster | `iceberg_enabled` | Master switch (`true`/`false`). |
| Cluster | `iceberg_catalog_type` | Catalog backend type. |
| Topic | `redpanda.iceberg.mode` | `key_value`, `value_schema_id_prefix`, `value_schema_latest`, `disabled` (default `disabled`). |
| Topic | `redpanda.iceberg.delete` | Delete the Iceberg table when the topic is deleted (default `true`). |
| Topic | `redpanda.iceberg.partition.spec` | Iceberg partitioning spec (default `(hour(redpanda.timestamp))`). |
| Topic | `redpanda.iceberg.target.lag.ms` | How often the Iceberg table is refreshed (ms). |
| Topic | `redpanda.iceberg.invalid.record.action` | `drop` or `dlq_table` (default `dlq_table`). |

```bash
# Cluster-level Iceberg config
cat admin/cluster_config.json | jq 'with_entries(select(.key | startswith("iceberg")))'

# Per-topic redpanda.iceberg.* settings
cat kafka.json | jq '.[] | select(.Name == "topic_configs")'
```

---

## Cloud Topics (Enterprise)

Topic type backed primarily by durable object storage instead of local disk replication.

| Scope | Key | Notes |
|---|---|---|
| Topic | `redpanda.cloud_topic.enabled` | Marks the topic as a Cloud Topic. New Cloud Topics cannot be created without a valid license. |

```bash
cat kafka.json | jq '.[] | select(.Name == "topic_configs")'
```

---

## Continuous Data Balancing (Enterprise)

Automatic partition rebalancing driven by disk-pressure and broker-availability thresholds. Enabled by default on new licensed clusters; reverts to `node_add` on license expiry.

| Key | Default-relevant notes |
|---|---|
| `partition_autobalancing_mode` | `continuous` (enterprise) vs `node_add` (community fallback) vs `off`. Set to `node_add` to disable the enterprise feature. |
| `partition_autobalancing_max_disk_usage_percent` | Disk-pressure threshold that triggers a rebalance. |
| `partition_autobalancing_min_size_threshold` | Minimum partition size considered for movement. |
| `partition_autobalancing_concurrent_moves` | Cap on concurrent partition moves. |
| `partition_autobalancing_movement_batch_size_bytes` | Per-batch movement byte budget. |
| `partition_autobalancing_node_availability_timeout_sec` | How long a node must be unavailable before its partitions are moved. |
| `partition_autobalancing_node_autodecommission_timeout_sec` | Auto-decommission timeout for unavailable nodes. |
| `partition_autobalancing_tick_interval_ms` | Balancer tick cadence. |
| `partition_autobalancing_tick_moves_drop_threshold` | Threshold for dropping queued moves on a tick. |
| `partition_autobalancing_topic_aware` | Spread replicas of a topic evenly across brokers. |
| `core_balancing_continuous` | Continuous Intra-Broker Partition Balancing across CPU cores (separate enterprise feature; disable with `core_balancing_continuous false`). |

Where to look:

```bash
# All autobalancing thresholds + mode + core balancing
cat admin/cluster_config.json | jq 'with_entries(select(.key | startswith("partition_autobalancing") or .key == "core_balancing_continuous"))'

# Live balancer state (cl.GetPartitionStatus): violations, in-progress moves
cat admin/partition_balancer_status.json | jq

# In-progress reconfigurations (cl.Reconfigurations)
cat admin/reconfigurations.json | jq
```

---

## Shadowing / Shadow Linking — cross-cluster DR (Enterprise)

Enterprise-grade disaster recovery via asynchronous, offset-preserving replication between distinct Redpanda clusters. Managed with the `rpk shadow` command group (`rpk shadow create/list/describe/status/update/delete/failover`, `rpk shadow config generate`). New shadow links cannot be created without a valid license; existing links keep operating.

When triaging shadowing, the live state comes from `rpk shadow status`/`rpk shadow describe`; the bundle captures the surrounding cluster config and health. Run alongside a bundle:

```bash
# Live shadow-link state (run against the shadow/target cluster)
rpk shadow list
rpk shadow status
rpk shadow describe <shadow-link>

# Bundle-side corroboration: cluster health + config of the DR target
cat admin/health_overview.json | jq
cat admin/cluster_config.json | jq
```

---

## Leadership Pinning (Enterprise)

Pins partition leaders to a preferred set of availability zones.

| Key | Notes |
|---|---|
| `default_leaders_preference` | Cluster default AZ preference. Set to `none` to disable the enterprise feature. Per-topic `redpanda.leaders.preference` overrides it. |

```bash
cat admin/cluster_config.json | jq '.default_leaders_preference'

# Per-topic override + actual leader placement
cat kafka.json | jq '.[] | select(.Name == "topic_configs")'
cat admin/partition_leader_table_<addr>.json | jq   # per-node leader assignments
```

---

## Audit Logging (Enterprise)

Records cluster activity to the `_redpanda.audit_log` topic for compliance.

| Key | Notes |
|---|---|
| `audit_enabled` | Master switch. Disable with `rpk cluster config set audit_enabled false`. |
| `audit_enabled_event_types` | Which event categories are recorded. |
| `audit_excluded_principals` | Principals excluded from auditing. |
| `audit_excluded_topics` | Topics excluded from auditing. |
| `audit_failure_policy` | Behavior when audit records cannot be written. |
| `audit_log_num_partitions` | Partition count of the audit log topic. |
| `audit_log_replication_factor` | Replication factor of the audit log topic. |
| `audit_client_max_buffer_size`, `audit_queue_max_buffer_size_per_shard`, `audit_queue_drain_interval_ms` | Buffering/drain tuning. |

```bash
cat admin/cluster_config.json | jq 'with_entries(select(.key | startswith("audit")))'
```

> On license expiry, read access to the audit log topic is denied but logging continues.

---

## RBAC / GBAC (Enterprise)

Role-Based and Group-Based Access Control. Roles/ACLs cannot be created or modified without a valid license (deletion is still allowed).

Triage with the live security commands plus the captured config:

```bash
# Live role state
rpk security role list
rpk security role describe <role-name>

# Group ACLs (GBAC) appear in the live ACL list with Group: principals
rpk security acl list
```

---

## Authentication: OIDC / OAuthBearer / Kerberos (Enterprise)

| Key | Notes |
|---|---|
| `sasl_mechanisms` | Enabled SASL mechanisms. `GSSAPI` here = Kerberos (enterprise); `OAUTHBEARER`/`OIDC` = OIDC (enterprise). Remove `GSSAPI`/`OIDC` to disable those enterprise features. |
| `http_authentication` | HTTP-layer auth mechanisms (e.g. for the Admin/proxy APIs); remove `OIDC` to disable OIDC there. |

```bash
cat admin/cluster_config.json | jq '{sasl_mechanisms, http_authentication}'
```

---

## Server-Side Schema ID Validation (Enterprise)

Broker-side validation that records reference a registered schema; unregistered-schema records are dropped at the broker.

| Key | Notes |
|---|---|
| `enable_schema_id_validation` | Master switch. Disable with `rpk cluster config set enable_schema_id_validation false`. |
| `redpanda.key.schema.id.validation`, `redpanda.value.schema.id.validation` | Per-topic enable flags. |
| `redpanda.key.subject.name.strategy`, `redpanda.value.subject.name.strategy` | Per-topic subject-name strategy. |

```bash
cat admin/cluster_config.json | jq '.enable_schema_id_validation'
cat kafka.json | jq '.[] | select(.Name == "topic_configs")'   # per-topic schema id validation
```

---

## Schema Registry Authorization (Enterprise)

ACL-based authorization for Schema Registry requests. When `true`, Schema Registry uses ACL-based authorization instead of the default `public/user/superuser` authorization model. This is distinct from Kafka-resource RBAC/GBAC: it governs ACLs on Schema Registry subjects/resources specifically. On license expiry you can no longer enable `schema_registry_enable_authorization`, nor create or modify schema ACLs.

| Key | Notes |
|---|---|
| `schema_registry_enable_authorization` | Boolean cluster config, default `false`; the value `true` requires an Enterprise license. Enables ACL-based authorization for Schema Registry. Disable with `rpk cluster config set schema_registry_enable_authorization false`. |

```bash
cat admin/cluster_config.json | jq '.schema_registry_enable_authorization'
```

> Schema ACLs themselves are managed live (not in the bundle). When this is `true`, confirm the relevant schema ACLs exist on the live cluster.

---

## FIPS Compliance (Enterprise)

FIPS-compliant cryptography mode. This is a **node** (broker) config, not cluster config.

| Key | Notes |
|---|---|
| `fips_mode` | Node config: `disabled`, `enabled`, `permissive`. Disable with `rpk redpanda config set redpanda.fips_mode disabled`. |

```bash
# Node config in the bundle (per-node snapshot)
cat admin/node_config_<addr>.json | jq '.fips_mode'

# The node's own redpanda.yaml is also captured (sensitive fields redacted)
cat redpanda.yaml
```

---

## Topic Deletion Control (Enterprise)

| Key | Notes |
|---|---|
| `delete_topic_enable` | When `false`, blocks all topic deletion via the Kafka DeleteTopics API (cluster-wide safety guard). Reverts to `true` on license expiry. |

```bash
cat admin/cluster_config.json | jq '.delete_topic_enable'
```

---

## Quick "what enterprise features are active" sweep

```bash
cat admin/cluster_config.json | jq '{
  tiered_storage: .cloud_storage_enabled,
  remote_read_replica: .cloud_storage_enable_remote_read,
  iceberg: .iceberg_enabled,
  autobalancing_mode: .partition_autobalancing_mode,
  core_balancing_continuous: .core_balancing_continuous,
  audit_logging: .audit_enabled,
  schema_id_validation: .enable_schema_id_validation,
  schema_registry_authorization: .schema_registry_enable_authorization,
  leader_pinning: .default_leaders_preference,
  sasl_mechanisms: .sasl_mechanisms,
  http_authentication: .http_authentication,
  delete_topic_enable: .delete_topic_enable
}'

# Then confirm there is no license violation:
cat admin/license.json | jq
```
