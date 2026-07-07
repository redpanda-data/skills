# Debugging Enterprise Features

Redpanda's enterprise differentiators each surface their own health signals,
status commands, and failure modes. When you debug a cluster that has any of
these enabled, you must know the config keys that turn them on, the metrics
that report their health, and how they behave when the license expires.

All features below require a valid **Enterprise license** (RCL). Check license
state first — many "broken feature" reports are actually license violations:

```bash
# Organization, Type, Expires, License Status (valid|expired|not_present),
# and Violation (true if enterprise features are used without a valid license).
rpk cluster license info
rpk cluster license info --format json

# In a debug bundle, the same data is at:
#   admin/license.json
cat admin/license.json | jq
```

**License expiration behavior**: the cluster keeps operating without data loss,
but you cannot *enable* or *modify* enterprise features. Each feature degrades
differently (noted per-feature below). After expiry, configuration is retained
so re-applying a license restores full function.

To bring a cluster back into compliance without a license, disable the feature
(see the per-feature "Disable" rows below).

---

## Continuous Data Balancing

Self-healing partition rebalancing on node/rack availability and disk pressure.
Enabled by default on new clusters **with a valid license**. This is a common
source of "partitions keep moving" or "moves are stalled" debugging tickets.

**Enable / mode** — cluster property `partition_autobalancing_mode`:

| Value | Behavior |
|---|---|
| `node_add` | Balance only when a broker is added. Default **without** a license. |
| `continuous` | Continuous monitoring + auto-rebalance. Default **with** a license. Enterprise. |
| `off` | All Redpanda balancing disabled. Not recommended in production. |

**Continuous-mode tuning** (cluster properties):

| Property | Default | Purpose |
|---|---|---|
| `partition_autobalancing_node_availability_timeout_sec` | `900` | After a node is unreachable this long, recreate its replicas elsewhere (node stays in cluster). |
| `partition_autobalancing_node_autodecommission_timeout_sec` | `null` (disabled) | After a node is unavailable this long, permanently decommission it. Only one at a time; `continuous` mode only. |
| `partition_autobalancing_max_disk_usage_percent` | `80` | When a node hits this disk %, move replicas to nodes below the threshold. |
| `partition_autobalancing_tick_interval_ms` | — | How often the balancer runs. |
| `partition_autobalancing_topic_aware` | `true` | Balance per-topic replica counts, not just total counts. |
| `raft_learner_recovery_rate` | — | Total bandwidth for replicating moving/under-replicated partitions. |

**Debug status**:

```bash
# Status: off | ready | starting | in-progress | stalled
# Shows time since last balance, in-flight moves, unavailable nodes,
# and nodes over the disk threshold.
rpk cluster partitions balancer-status

# In a debug bundle (cluster-scoped, appears once):
cat admin/partition_balancer_status.json | jq
```

**`stalled` checklist** (from the balancer): not enough healthy nodes for the
replication factor; cluster over disk threshold everywhere; a partition lacks
quorum; or a node is in maintenance mode.

```bash
# Cancel all in-flight moves, or scope to one node:
rpk cluster partitions movement-cancel
rpk cluster partitions movement-cancel --node 1
# To fully stop: set mode off FIRST, then cancel (else it reschedules).
rpk cluster config set partition_autobalancing_mode off
```

**On expiry**: reverts to `node_add` (balances only when a broker is added).
**Disable**: `rpk cluster config set partition_autobalancing_mode node_add`.

### Continuous Intra-Broker (core) Partition Balancing

Balances replicas across CPU cores *within* a broker. Diagnose with the
per-core CPU metrics (see Metrics reference).

| Cluster property | Default | Notes |
|---|---|---|
| `core_balancing_on_core_count_change` | `true` | Rebalance across cores after startup if core count changed. Not enterprise. |
| `core_balancing_continuous` | `false` | Continuous runtime core rebalancing. **Enterprise.** |

```bash
# Manually trigger a one-time core rebalance (no license needed):
curl -X POST http://localhost:9644/v1/partitions/rebalance_cores
```

**On expiry**: `core_balancing_continuous` is disabled.
**Disable**: `rpk cluster config set core_balancing_continuous false`.

---

## Tiered Storage (shadow indexing)

Offloads log segments to object storage. When debugging "slow reads",
"cache thrashing", or "upload backlog", these are the keys and metrics.

**Cluster properties** (object-storage):

| Property | Purpose |
|---|---|
| `cloud_storage_enabled` | Master switch for Tiered Storage. |
| `cloud_storage_enable_remote_write` | Creation-time default for new `unset` topics: upload to object storage. |
| `cloud_storage_enable_remote_read` | Creation-time default for new `unset` topics: fetch from object storage. |
| `default_redpanda_storage_mode` | Cluster-wide default storage mode for new topics. |

**Topic properties**:

| Property | Purpose |
|---|---|
| `redpanda.storage.mode` | `local` \| `tiered` \| `cloud` \| `unset`. Preferred over the legacy flags. |
| `redpanda.remote.write` | Upload this topic's data (used when `storage.mode=unset`). |
| `redpanda.remote.read` | Fetch this topic's data from object storage (used when `storage.mode=unset`). |
| `redpanda.remote.delete` | Whether to delete objects on topic delete. |
| `redpanda.remote.recovery` | Restore a topic from object storage at creation time (Topic Recovery — enterprise; create-time only). |

> Note: `cloud_storage_enable_remote_write/read` are **creation-time defaults
> only** for topics with `redpanda.storage.mode=unset`. They do not affect
> topics with an explicit `storage.mode`, nor existing topics.

**Key health metrics** (`/public_metrics`, all gauges/counters):

| Metric | What a problem looks like |
|---|---|
| `redpanda_cloud_storage_errors_total` | Rising = object-storage API errors (auth, throttling, connectivity). |
| `redpanda_cloud_storage_anomalies` | Missing partition-manifest anomalies. Non-zero = metadata integrity issue. |
| `redpanda_cloud_storage_segment_readers_delayed` | Rising = cluster saturated with Tiered Storage reads (reader-limit pressure). |
| `redpanda_cloud_storage_segment_materializations_delayed` | Materializations blocked by reader limits. |
| `redpanda_cloud_storage_cache_op_hit` / `_cache_op_miss` | Low hit / high miss ratio = cache too small or thrashing. |
| `redpanda_cloud_storage_cache_space_size_bytes` / `_cache_space_files` | Current cache footprint vs `_hwm_*` high-water marks. |
| `redpanda_cloud_storage_cache_trim_*` (`failed_trims`, `exhaustive_trims`, `fast_trims`) | Frequent/failed trims = cache under-provisioned. |
| `redpanda_cloud_storage_segment_uploads_total` | Stalled = upload pipeline blocked. |
| `redpanda_cloud_storage_jobs_*` (reuploads, deletions, metadata_syncs) | Housekeeping activity. |
| `redpanda_cloud_storage_segments` / `_segments_pending_deletion` | Per-topic segment counts in object storage. |

The tiered-storage cache uses a separate disk path; watch its disk metrics:
`redpanda_storage_cache_disk_free_bytes` and
`redpanda_storage_cache_disk_free_space_alert` (0=OK, 1=Low, 2=Degraded).

**Debug bundle**: `admin/cloud_storage_lifecycle.json` captures Tiered Storage
lifecycle status. **On expiry**: topics cannot be created/modified to enable
Tiered Storage and partitions cannot be added to TS topics.
**Disable**: `rpk cluster config set cloud_storage_enabled false`.

---

## Remote Read Replicas

A read-only mirror of a topic backed by another cluster's object storage —
used for DR and read fan-out.

| Property | Purpose |
|---|---|
| `cloud_storage_enable_remote_read` (cluster) | Must allow remote read. |
| `redpanda.remote.readreplica` (topic) | The bucket of the source topic. **Cannot** be combined with `redpanda.remote.read`/`write` (errors out). |

`redpanda.remote.delete` does **not** apply to read-replica topics (the source
objects are never deleted by the replica).

**On expiry**: read-replica topics cannot be created or modified.
**Disable**: `rpk cluster config set cloud_storage_enable_remote_read false`.

---

## Cloud Topics

A topic type whose primary store is object storage (local disk is only a write
buffer). Debug disk-vs-object-store behavior with these.

| Property | Purpose |
|---|---|
| `cloud_topics_enabled` (cluster) | Master switch: `rpk cluster config set cloud_topics_enabled=true`. |
| `redpanda.cloud_topic.enabled` (topic) | Enable Cloud Topic mode on a topic. Prefer `redpanda.storage.mode=cloud`. |

**On expiry**: new Cloud Topics cannot be created; existing ones cannot be
modified (including partition changes); major upgrades are blocked in violation.

---

## Iceberg Topics

Materializes topic data as Apache Iceberg tables. When debugging "table not
updating", "records missing", or "DLQ growing", these are the controls.

**Cluster properties**:

| Property | Purpose |
|---|---|
| `iceberg_enabled` | Master switch (requires restart on a running cluster). |
| `iceberg_catalog_type` | e.g. `rest` or `object_storage`. |
| `iceberg_catalog_base_location` | Base path for `object_storage` catalog. Default `redpanda-iceberg-catalog`. |
| `iceberg_default_catalog_namespace` | Namespace for tables (default `redpanda`); set at enable time, cannot change later. |
| `iceberg_invalid_record_action` | Cluster default for invalid records (`drop` \| `dlq_table`). |
| `iceberg_delete` | Cluster default for `redpanda.iceberg.delete`. |
| `iceberg_default_partition_spec` | Cluster default for `redpanda.iceberg.partition.spec`. |

**Topic properties** (`redpanda.iceberg.*`):

| Property | Values / Default | Purpose |
|---|---|---|
| `redpanda.iceberg.mode` | `key_value` \| `value_schema_id_prefix` \| `value_schema_latest` \| `disabled` (default) | Enable + choose table schema strategy. |
| `redpanda.iceberg.invalid.record.action` | `drop` \| `dlq_table` (default) | Route bad records to drop or the `<topic>~dlq` table. |
| `redpanda.iceberg.target.lag.ms` | integer | How often the table is refreshed with new topic data. |
| `redpanda.iceberg.partition.spec` | string, default `(hour(redpanda.timestamp))` | Iceberg partitioning spec. |
| `redpanda.iceberg.delete` | `true` (default) | Delete the Iceberg table when the topic is deleted. |

**Troubleshooting metrics** (`/public_metrics`):

| Metric | Meaning |
|---|---|
| `redpanda_iceberg_translation_dlq_files_created` | Non-zero & rising = records failing to translate (inspect the `<topic>~dlq` table). |
| `redpanda_iceberg_translation_invalid_records` | Invalid records during translation, labeled by cause. |
| `redpanda_iceberg_rest_client_num_commit_table_update_requests_failed` | Failed commits to a REST catalog (`iceberg_catalog_type: rest`) — catalog connectivity/permission issues. |

DLQ records land in an Iceberg table named `<topic-name>~dlq` (key_value
schema). Misconfiguration (not bad data) instead **pauses** translation until
fixed, rather than writing to the DLQ.

**On expiry**: topics cannot be created/modified with `redpanda.iceberg.mode`.

---

## Leader Pinning

Pins partition leaders to preferred availability zones / racks. Useful when
debugging cross-AZ latency or DR leadership placement.

| Property | Scope | Values |
|---|---|---|
| `enable_rack_awareness` (cluster) | Prerequisite | Must be `true`; if `false`, Leader Pinning is disabled cluster-wide. |
| `default_leaders_preference` (cluster) | Default for topics | `none` (default), `racks:<r1>,...`, or `ordered_racks:<r1>,<r2>,...` (v26.1+). |
| `redpanda.leaders.preference` (topic) | Per-topic override | Same value formats; inherits `default_leaders_preference` when unset. |

**On expiry**: Leader Pinning is disabled on all topics.
**Disable**: `rpk cluster config set default_leaders_preference none`.

---

## Shadow Linking (cross-cluster DR)

Asynchronous, offset-preserving replication between clusters — the key DR
feature. When debugging DR readiness, RPO, or failover, start here.

**Status / debug commands**:

```bash
rpk shadow list                       # list links; state ACTIVE | PAUSED
rpk shadow describe <link>            # full config: connection, filters, sync
rpk shadow status <link>              # states + per-partition lag
```

**States to watch**:
- Shadow link: `ACTIVE`, `PAUSED`.
- Topic: `ACTIVE`, `FAULTED`, `FAILING_OVER`, `FAILED_OVER`, `PAUSED`.
- Task: `ACTIVE`, `FAULTED`, `NOT_RUNNING`, `LINK_UNAVAILABLE`.

**Metrics** (`/public_metrics`):

| Metric | Type | Use |
|---|---|---|
| `redpanda_shadow_link_shadow_lag` | gauge | Source LSO − shadow HWM, per `shadow_link_name`/`topic`/`partition`. Alert when it exceeds your RPO. |
| `redpanda_shadow_link_client_errors` | count | Rapid increase = connection/protocol issues to source. |
| `redpanda_shadow_link_shadow_topic_state` | gauge | Count of topics per `state` — alert on `FAULTED`. |
| `redpanda_shadow_link_total_bytes_fetched` / `_written` | count | Throughput in/out; a drop signals a problem. |
| `redpanda_shadow_link_total_records_fetched` / `_written` | count | Record throughput. |

**Alert on**: high `shadow_lag` (RPO breach); rising `client_errors`; topics in
`FAULTED`; tasks in `FAULTED`/`NOT_RUNNING`; `LINK_UNAVAILABLE` (source
unreachable); throughput drops.

**On expiry**: new shadow links cannot be created; existing links keep running
and can be updated.

---

## Audit Logging

Writes activity to the internal `_redpanda.audit_log` topic. Relevant when
debugging missing audit data or the audit buffer back-pressuring requests.

| Cluster property | Default | Purpose |
|---|---|---|
| `audit_enabled` | `true`* | Master switch; auto-creates `_redpanda.audit_log` if absent. |
| `audit_log_num_partitions` | `12` | Partitions for a newly created audit topic; not alterable later. |
| `audit_enabled_event_types` | `["management","authenticate","admin"]` | Subset of: `management, produce, consume, describe, heartbeat, authenticate, schema_registry, admin`. |
| `audit_client_max_buffer_size` | `16777216` | Audit client buffer bytes; toggle `audit_enabled` off/on to apply changes. |
| `audit_queue_max_buffer_size_per_shard` | `1048576` | Per-shard audit buffer; when full, audit-log writes return a non-retryable error. |

\* Default may be `false` in some deploy paths (e.g. Helm `auditLogging.enabled`).

**On expiry**: read access to the audit-log topic is denied, but logging
continues. **Disable**: `rpk cluster config set audit_enabled false`.

---

## Other enterprise features (license-relevant during triage)

These rarely cause broker-health symptoms but commonly appear in license
violations during debugging. Disable actions for compliance:

| Feature | Enable key | Disable for compliance |
|---|---|---|
| FIPS Compliance | node config `fips_mode` | `rpk redpanda config set redpanda.fips_mode disabled` |
| Kerberos (GSSAPI) auth | `sasl_mechanisms` includes `GSSAPI` | remove `GSSAPI` from `sasl_mechanisms` |
| OAUTHBEARER/OIDC auth | `sasl_mechanisms`/`http_authentication` include `OIDC` | remove `OIDC` from both |
| RBAC | roles exist | delete roles: `rpk security role delete <role>` |
| Server-side Schema ID Validation | `enable_schema_id_validation` | `rpk cluster config set enable_schema_id_validation false` |
| Schema Registry Authorization | `schema_registry_enable_authorization` | set to `false` |
| Topic Recovery | `redpanda.remote.recovery=true` (create-time) | cannot create such topics without a license |
| Whole Cluster Restore (WCR) | — | blocked without a valid license on source/target |

Run `rpk cluster license info` and check `Violation: true` to find which of
these are active without a license.
