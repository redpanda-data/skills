# Enterprise Features on Dedicated Clusters

Redpanda Cloud is a managed deployment of Redpanda **Enterprise Edition**. On a Dedicated cluster, enterprise features are part of the managed subscription — you do **not** apply a separate license key. You enable and tune them with **topic properties** (via the Data Plane `TopicService`, `rpk topic`, or Kafka `AlterConfigs`) and **cluster configuration properties** (via `ClusterCreate.cluster_configuration.custom_properties`, `PATCH /v1/clusters/{id}` with `cluster_configuration`, or `rpk cluster config set`).

This page documents the enterprise differentiators and their **nested settings/config keys**. Each section notes whether the feature requires Enterprise Edition (all listed here do; on Cloud Dedicated the license is included).

The canonical enterprise-feature list and license-expiration behavior are in the upstream docs: `get-started/pages/licensing/overview.adoc` (table "Enterprise features in Redpanda") and `get-started/pages/licensing/disable-enterprise-features.adoc`. The verbatim sources for each feature below are cited inline.

> **Setting cluster properties on a Dedicated cluster.** Numeric `custom_properties` values must be passed as JSON **strings** (see [Create Cluster](create-cluster.md#custom-cluster-configuration)). Some properties require a cluster restart; the Control Plane `PATCH` performs this as a long-running Operation. Poll `GET /v1/operations/{id}` until `STATE_COMPLETED`.

```bash
# Set a cluster property via Control Plane API (returns an Operation)
curl -s -X PATCH "https://api.redpanda.com/v1/clusters/${CLUSTER_ID}?update_mask=cluster_configuration" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d '{"cluster_configuration":{"custom_properties":{"iceberg_enabled":"true"}}}'
```

> **Encryption keys:** Customer-managed encryption keys (BYOK / CMK) are **not** offered on Cloud Dedicated. Data at rest uses the cloud provider's default volume encryption (AES-256), and Tiered Storage uses a Redpanda-managed, periodically rotated master key (SSE-S3). Source: `cloud-data-platform/security/cloud-encryption/`.

> **Kafka Connect (managed connectors)** is **disabled by default on new clusters** (since Jul 2025). To enable it on a Dedicated cluster, contact Redpanda Support; to disable it again, use the Cloud API. Source: `develop/managed-connectors/disable-kc.adoc`, `get-started/cloud-overview.adoc`.

---

## Tiered Storage (Enterprise)

Offloads log segments to cloud object storage (S3/GCS/Azure Blob). On Dedicated, the object storage and `cloud_storage_*` credentials are Redpanda-managed; you control it per topic.

**Cluster properties** (creation-time defaults for new `redpanda.storage.mode=unset` topics):

| Property | Notes |
|---|---|
| `cloud_storage_enabled` | Master switch for Tiered Storage on the cluster. Set `false` to fully disable the feature. |
| `cloud_storage_enable_remote_write` | Default for new unset topics' `redpanda.remote.write`. No effect on topics whose `redpanda.storage.mode` is explicitly `local`/`tiered`/`cloud`. |
| `cloud_storage_enable_remote_read` | Default for new unset topics' `redpanda.remote.read`. Also gates Remote Read Replicas (see below). |
| `default_redpanda_storage_mode` | Cluster-wide default storage mode applied to all new topics. |

**Topic properties:**

| Property | Values / Notes |
|---|---|
| `redpanda.storage.mode` | `unset` (default), `local`, `tiered`, `cloud`. v26.1+ recommended way to enable: set `tiered`. When set to a non-`unset` value, `redpanda.remote.read`/`redpanda.remote.write` have no effect. |
| `redpanda.remote.write` | `true`/`false`. Uploads segments to object storage. Applies only when `redpanda.storage.mode=unset`. |
| `redpanda.remote.read` | `true`/`false`. Fetches segments from object storage. Applies only when `redpanda.storage.mode=unset`. |
| `redpanda.remote.recovery` | `true` on topic create to restore a topic from object storage (Topic Recovery — Enterprise). |
| `retention.local.target.ms` | Local-disk retention by time when Tiered Storage is on (equivalent to `retention.ms` without TS). |
| `retention.local.target.bytes` | Local-disk retention by size when Tiered Storage is on. |

```bash
# Tiered topic (v26.1+ preferred)
rpk topic create events -c redpanda.storage.mode=tiered
# or, on unset topics, the classic toggles:
rpk topic alter-config events --set redpanda.remote.read=true --set redpanda.remote.write=true \
  --set retention.local.target.ms=86400000
```

Source: `manage/partials/tiered-storage.adoc` (`redpanda.storage.mode`, `redpanda.remote.read/write/recovery`, `retention.local.target.*`, `cloud_storage_enable_remote_*`, `default_redpanda_storage_mode`); licensing `overview.adoc` (Tiered Storage, Topic Recovery rows).

---

## Cloud Topics (Enterprise)

Object-storage-native topics that use durable object storage as the primary backing store instead of local-disk replication, reducing cross-AZ replication cost.

| Property | Scope | Notes |
|---|---|---|
| `cloud_topics_enabled` | Cluster | `true` to allow Cloud Topics. Requires a cluster restart. |
| `redpanda.storage.mode` | Topic | Set to `cloud` at **topic create time only** to make a Cloud Topic. |

```bash
rpk cluster config set cloud_topics_enabled=true   # restart required
rpk topic create my-cloud-topic -c redpanda.storage.mode=cloud
```

License expiration: new Cloud Topics cannot be created and existing ones cannot be modified (including partition changes). Pair with Follower Fetching and [Leader Pinning](#leadership-pinning-enterprise) for further cross-AZ cost reduction.

Source: `develop/pages/manage-topics/cloud-topics.adoc` (`cloud_topics_enabled`, `redpanda.storage.mode=cloud`); licensing `overview.adoc` (Cloud Topics row).

---

## Iceberg Topics (Enterprise)

Stores topic data in the Apache Iceberg open table format (Parquet) in object storage, queryable by Snowflake, Databricks, Spark, Flink, etc. Requires Tiered Storage enabled on the topic. On Cloud, the Iceberg integration is supported on BYOC/BYOVPC and Dedicated clusters (v25.1+).

**Cluster properties:**

| Property | Notes |
|---|---|
| `iceberg_enabled` | `true` to enable the integration cluster-wide. Requires restart. |
| `iceberg_default_catalog_namespace` | JSON array, e.g. `["my-namespace"]`. Default namespace is `redpanda`. Cannot be changed after enabling. |
| `iceberg_catalog_type` | `object_storage` (default, filesystem/Hadoop catalog) or `rest`. |
| `iceberg_rest_catalog_endpoint` | Required when `iceberg_catalog_type=rest`. Must be set at the same time. |
| `iceberg_target_lag_ms` | Commit window; Redpanda tries to commit produced data within this lag. Default 60000 (1 minute). |
| `iceberg_delete` | Cluster default for `redpanda.iceberg.delete`. |
| `iceberg_invalid_record_action` | Cluster default for `redpanda.iceberg.invalid.record.action`. |

**Topic properties:**

| Property | Values / Notes |
|---|---|
| `redpanda.iceberg.mode` | `disabled` (default), `key_value`, `value_schema_id_prefix`, `value_schema_latest`. The `value_schema_*` modes require a registered Schema Registry schema. |
| `redpanda.iceberg.delete` | `true` (default) drops the Iceberg table when the topic is deleted; `false` keeps it. |
| `redpanda.iceberg.invalid.record.action` | `dlq_table` (default; routes invalid records to a `<topic>~dlq` table) or `drop`. |
| `redpanda.iceberg.partition.spec` | Partitioning scheme, e.g. `(col1)`, `(col1, col2)`, `(year(ts1), col1)`. |
| `redpanda.iceberg.target.lag.ms` | Per-topic override of `iceberg_target_lag_ms`. |

```bash
rpk cluster config set iceberg_enabled true   # restart required
rpk topic create clicks -p5 -r3 \
  -c redpanda.iceberg.mode=value_schema_id_prefix \
  -c "redpanda.iceberg.partition.spec=(year(ts), user_id)" \
  -c redpanda.iceberg.target.lag.ms=300000
```

License expiration: topics cannot be created or modified with `redpanda.iceberg.mode`.

Source: `manage/pages/iceberg/about-iceberg-topics.adoc` (`iceberg_enabled`, `iceberg_default_catalog_namespace`, `redpanda.iceberg.mode` values, `iceberg_delete`/`redpanda.iceberg.delete`); `iceberg/iceberg-performance-tuning.adoc` (`redpanda.iceberg.partition.spec`, `iceberg_target_lag_ms`, `redpanda.iceberg.target.lag.ms`); `iceberg/iceberg-troubleshooting.adoc` (`redpanda.iceberg.invalid.record.action`, `iceberg_invalid_record_action`); `iceberg/use-iceberg-catalogs.adoc` (`iceberg_catalog_type`, `iceberg_rest_catalog_endpoint`).

---

## Continuous Data Balancing (Enterprise)

Continuously monitors node/rack availability and disk usage, dynamically rebalancing partitions. Enabled by default on new clusters with a valid license. Without a license it reverts to `node_add` (rebalance only when a broker is added).

**Cluster properties:**

| Property | Notes |
|---|---|
| `partition_autobalancing_mode` | `continuous` (Enterprise) \| `node_add` \| `off`. |
| `partition_autobalancing_node_availability_timeout_sec` | Treat an unreachable node as decommissioned and re-create its replicas after this many seconds. Default 900 (15 min). |
| `partition_autobalancing_node_autodecommission_timeout_sec` | When set, permanently decommissions a node unavailable for this long. `continuous` mode only. Default null (disabled). |
| `partition_autobalancing_max_disk_usage_percent` | Start moving replicas off a node above this disk usage percentage. Default 80. |
| `partition_autobalancing_min_size_threshold` | Minimum partition size considered for autobalancing moves. |

Related intra-broker balancing (separate Enterprise feature): `core_balancing_continuous` (`true`/`false`) balances replicas across CPU cores within a broker.

```bash
rpk cluster config set partition_autobalancing_mode continuous
rpk cluster config set partition_autobalancing_max_disk_usage_percent 75
rpk cluster partitions balancer-status   # off|ready|starting|in-progress|stalled
```

Source: `manage/pages/cluster-maintenance/continuous-data-balancing.adoc` (`partition_autobalancing_mode`, `_node_availability_timeout_sec`, `_node_autodecommission_timeout_sec`, `_max_disk_usage_percent`); licensing `disable-enterprise-features.adoc` (`node_add` fallback, `core_balancing_continuous`).

---

## Shadow Linking — Cross-Cluster Disaster Recovery (Enterprise)

Asynchronous, offset-preserving replication between distinct Redpanda clusters for cross-region DR. Supported on BYOC and Dedicated clusters running v25.3+. The shadow (destination) cluster **pulls** from the source cluster. Shadow Linking is a first-class **Control Plane API** service (`ShadowLinkService` under `https://api.redpanda.com`, `/v1/shadow-links`), complementary to the `rpk shadow` CLI and the Cloud UI. Each mutating call returns a long-running `Operation`.

> The control-plane `ShadowLinkService` is keyed by **shadow link ID** (`/v1/shadow-links/{id}`, a 20-char XID). A separate data-plane `ShadowLinkService` (keyed by link **name**, `/v1/shadow-links/{name}`) on the cluster's Data Plane URL exposes per-link operational endpoints (`failover`, `metrics`, per-topic). Create/manage links through the control plane.

**Control Plane API paths** (`shadow_link.proto`):

| Method | Path | Returns |
|---|---|---|
| POST | `/v1/shadow-links` | `Operation` (`TYPE_CREATE_SHADOW_LINK = 15`) |
| GET | `/v1/shadow-links/{id}` | `ShadowLink` |
| GET | `/v1/shadow-links` | list of `ShadowLinkListItem` |
| PATCH | `/v1/shadow-links/{shadow_link.id}` | `Operation` (`TYPE_UPDATE_SHADOW_LINK = 16`); required top-level `update_mask` |
| DELETE | `/v1/shadow-links/{id}` | `Operation` (`TYPE_DELETE_SHADOW_LINK = 17`) |

`ShadowLink.state` (output only): `STATE_CREATING`, `STATE_CREATION_FAILED`, `STATE_DELETING`, `STATE_DELETION_FAILED`, `STATE_ACTIVE`, `STATE_PAUSED`.

**`ShadowLinkCreate` top-level fields** (no `cloud_options` wrapper):

| Field | Required | Notes |
|---|---|---|
| `shadow_redpanda_id` | Yes | Destination (shadow) cluster ID; `min_len: 1`. Immutable on the created `ShadowLink`. |
| `name` | Yes | DNS-1123 subdomain: lowercase alphanumeric + hyphens, max 63 chars, pattern `^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`. |
| `source_redpanda_id` | One of | Source cluster ID. **Mutually exclusive** with `client_options.bootstrap_servers` — provide exactly one. If set, bootstrap info is fetched automatically. |
| `client_options` | One of | Internal Kafka client config (see below). Provide `bootstrap_servers[]` here when `source_redpanda_id` is not set. |
| `topic_metadata_sync_options` | No | `interval`, `auto_create_shadow_topic_filters[]`, starting offset, `paused`. |
| `consumer_offset_sync_options` | No | `interval`, `paused`, `group_filters[]`. |
| `security_sync_options` | No | `interval`, `paused`, `acl_filters[]`. |
| `schema_registry_sync_options` | No | `shadow_schema_registry_topic` ({} enables byte-for-byte `_schemas` replication). |

**`ShadowLinkClientOptions` nested keys** (`client_options`):
- `bootstrap_servers[]` — source cluster brokers; required if `source_redpanda_id` is not provided.
- `source_cluster_id` — source cluster ID (lives **inside** `client_options`, not at the top level).
- `tls_settings` — the Control Plane API `TLSSettings` message is **flat**: `enabled` (bool), `ca`, `key` (input only; must reference a data-plane secret `${secrets.<SECRET_ID>}`), `cert` (`key`/`cert` are both-or-neither), `do_not_set_sni_hostname` (bool). Note: the nested `tls_pem_settings.{ca,key,cert}` / `tls_file_settings.{ca_path,key_path,cert_path}` form is the **rpk / self-managed YAML shape**, not the Control Plane API.
- `authentication_configuration.scram_configuration`: `username`, `password` (must reference `${secrets.<sasl-password-secret-id>}`), `scram_mechanism` (Control Plane API uses `SCRAM_MECHANISM_SCRAM_SHA_256` / `SCRAM_MECHANISM_SCRAM_SHA_512`; rpk YAML uses `SCRAM_SHA_256`/`SCRAM_SHA_512`).
- Connection tuning (defaults applied when 0): `metadata_max_age_ms` (10000), `connection_timeout_ms` (1000), `retry_backoff_ms` (100), `fetch_wait_max_ms` (500), `fetch_min_bytes` (5242880), `fetch_max_bytes` (20971520), `fetch_partition_max_bytes` (1048576).

**Filters** (`auto_create_shadow_topic_filters`, `group_filters`, `acl_filters`):
- `pattern_type`: `LITERAL` | `PREFIX` (API: `PATTERN_TYPE_LITERAL` / `PATTERN_TYPE_PREFIX`); ACL `resource_filter.pattern_type` uses `LITERAL`/`PREFIXED`.
- `filter_type`: `INCLUDE` | `EXCLUDE` (API: `FILTER_TYPE_INCLUDE` / `FILTER_TYPE_EXCLUDE`). **EXCLUDE wins**; unmatched items are excluded.
- Starting offset (one of): `start_at_earliest: {}` (default), `start_at_latest: {}`, `start_at_timestamp: <RFC3339>` — applies only to new shadow topics.
- ACL `acl_filters[].access_filter`: `principal`, `operation` (`READ`/`WRITE`/`CREATE`/`DELETE`/`ALTER`/`DESCRIBE`/`ANY`), `permission_type` (`ALLOW`/`DENY`), `host`.

System-topic rules: literal filters for `__consumer_offsets` and `_redpanda.audit_log` are rejected; prefix filters for `_redpanda`/`__redpanda` are rejected; `*` does not match `_redpanda`/`__redpanda`.

**Service account ACLs on the source cluster** (for the replication user): topic `read`; `describe_configs` on topics; consumer-group `describe`+`read`; ACL `describe`; cluster `describe`.

**Create via Control Plane API:**

```bash
curl -s -X POST "https://api.redpanda.com/v1/shadow-links" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d '{"shadow_link":{
    "shadow_redpanda_id":"<dest-cluster-id>","name":"production-dr",
    "client_options":{
      "bootstrap_servers":["src-1:9092","src-2:9092"],
      "tls_settings":{"enabled":true},
      "authentication_configuration":{"scram_configuration":{
        "username":"shadow-replication-user",
        "password":"${secrets.<sasl-password-secret-id>}",
        "scram_mechanism":"SCRAM_MECHANISM_SCRAM_SHA_256"}}},
    "topic_metadata_sync_options":{"interval":"30s",
      "auto_create_shadow_topic_filters":[
        {"name":"*","filter_type":"FILTER_TYPE_INCLUDE","pattern_type":"PATTERN_TYPE_LITERAL"}],
      "start_at_earliest":{},"paused":false},
    "consumer_offset_sync_options":{"paused":true},
    "security_sync_options":{"paused":true}}}'
# Returns an Operation; poll GET /v1/operations/{id} until STATE_COMPLETED.

# Get / list / update / delete (control plane):
curl -s "https://api.redpanda.com/v1/shadow-links/${SHADOW_LINK_ID}" -H "Authorization: Bearer ${TOKEN}"
curl -s "https://api.redpanda.com/v1/shadow-links" -H "Authorization: Bearer ${TOKEN}"
# PATCH body maps to shadow_link; update_mask is a required query parameter:
curl -s -X PATCH "https://api.redpanda.com/v1/shadow-links/${SHADOW_LINK_ID}?update_mask=client_options" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d '{"shadow_link":{"id":"'"${SHADOW_LINK_ID}"'","client_options":{"fetch_min_bytes":10485760}}}'
curl -s -X DELETE "https://api.redpanda.com/v1/shadow-links/${SHADOW_LINK_ID}" -H "Authorization: Bearer ${TOKEN}"
```

**rpk workflow** (run from the shadow cluster):

```bash
rpk shadow config generate --for-cloud -o shadow-config.yaml   # template
rpk shadow create --config-file shadow-config.yaml             # create
rpk shadow status <link-name>                                  # monitor replication
rpk shadow failover <link-name> --all                          # DR cutover: converts shadow topics to regular topics, stops replication
rpk shadow failover <link-name> --topic orders                 # per-topic failover
```

License expiration: new shadow links cannot be created; existing links keep operating and can be updated.

Source: `controlplane/v1/shadow_link.proto` (control-plane `ShadowLinkService` paths, `ShadowLinkCreate` fields, `ShadowLinkClientOptions`, flat `TLSSettings`, `ShadowLink.State`); `controlplane/v1/operation.proto` (`TYPE_CREATE/UPDATE/DELETE_SHADOW_LINK = 15/16/17`); `manage/pages/disaster-recovery/shadowing/setup.adoc` (rpk/self-managed `ShadowLinkConfig` YAML, filter/pattern/auth keys, service-account ACLs, system-topic rules); `reference/pages/rpk/rpk-shadow/rpk-shadow-create.adoc` and `rpk-shadow-failover.adoc`.

---

## Remote Read Replicas (Enterprise)

A read-only topic that mirrors a Tiered Storage topic on another cluster by reading directly from object storage (no load on the origin cluster). The origin topic must have Tiered Storage enabled. Not supported on Azure.

| Property | Scope | Notes |
|---|---|---|
| `cloud_storage_enable_remote_read` | Cluster | Must be `true`. Setting `false` disables Remote Read Replicas (the documented disable action). |
| `redpanda.remote.readreplica` | Topic | Set to the origin object-storage bucket/container name at topic create. Do **not** combine with `redpanda.remote.read`/`redpanda.remote.write` (ignored on read-replica topics). |

```bash
# On the remote cluster, with object storage configured to the same bucket as origin:
rpk topic create <topic> -c redpanda.remote.readreplica=<origin-bucket>
# Cross-region (AWS): include region + endpoint query params
rpk topic create <topic> \
  -c 'redpanda.remote.readreplica=my-bucket?region=us-east-1&endpoint=s3.us-east-1.amazonaws.com'
```

License expiration: Remote Read Replica topics cannot be created or modified.

Source: `manage/partials/remote-read-replicas.adoc` (`redpanda.remote.readreplica`, cross-region query params, Azure unsupported); `disable-enterprise-features.adoc` (`cloud_storage_enable_remote_read`).

---

## Mountable Topics (Tiered Storage; Enterprise)

Detach (unmount) a Tiered Storage topic to keep its data in object storage and free local resources, then mount it to the same or a different cluster. On Cloud, exposed through the Data Plane `CloudStorageService` (`/v1/cloud-storage/...`): `ListMountableTopics`, `MountTopics`, `UnmountTopics`, and mount-task endpoints (`GetMountTask`, `ListMountTasks`, `UpdateMountTask`, `DeleteMountTask`).

Source: `manage/pages/mountable-topics.adoc`; data-plane `CloudStorageService`.

---

## Leadership Pinning (Enterprise)

Pins partition leaders to preferred availability zones/racks to lower cross-AZ latency and networking cost.

| Property | Scope | Values |
|---|---|---|
| `default_leaders_preference` | Cluster | Default for topics without an explicit preference. Same format as the topic property; default `none`. Setting `none` is the documented disable action. |
| `redpanda.leaders.preference` | Topic | `none`; `racks:<rack1>[,<rack2>,...]`; `ordered_racks:<rack1>[,...]` (priority order, v26.1+). |

```bash
rpk cluster info   # discover rack identifiers per broker
rpk topic alter-config orders --set redpanda.leaders.preference=ordered_racks:us-east-1a,us-east-1b
```

License expiration: Leader Pinning is disabled on all topics.

Source: `develop/pages/produce-data/leader-pinning.adoc` (`redpanda.leaders.preference` values, `default_leaders_preference`); `disable-enterprise-features.adoc` (`default_leaders_preference none`).

---

## Server-Side Schema ID Validation (Enterprise)

Brokers detect and drop records whose encoded schema ID is not registered in the Schema Registry, before consumers fetch them.

| Property | Scope | Values |
|---|---|---|
| `enable_schema_id_validation` | Cluster | `none` (default, disabled) \| `redpanda` (Redpanda topic props only) \| `compat` (Redpanda + Confluent props). Set `false`/`none` to disable. |
| `redpanda.key.schema.id.validation` | Topic | `true`/`false`. Confluent equivalent: `confluent.key.schema.validation`. |
| `redpanda.key.subject.name.strategy` | Topic | `TopicNameStrategy` (default) \| `RecordNameStrategy` \| `TopicRecordNameStrategy`. Confluent: `confluent.key.subject.name.strategy`. |
| `redpanda.value.schema.id.validation` | Topic | `true`/`false`. Confluent: `confluent.value.schema.validation`. |
| `redpanda.value.subject.name.strategy` | Topic | Same values as the key strategy. Confluent: `confluent.value.subject.name.strategy`. |

```bash
rpk cluster config set enable_schema_id_validation redpanda
rpk topic alter-config events --set redpanda.value.schema.id.validation=true \
  --set redpanda.value.subject.name.strategy=TopicNameStrategy
```

License expiration: topics with schema-validation settings cannot be created or modified.

Source: `manage/pages/schema-reg/schema-id-validation.adoc` (`enable_schema_id_validation` values, `redpanda.{key,value}.schema.id.validation`, `redpanda.{key,value}.subject.name.strategy`, Confluent equivalents).

---

## Audit Logging (Enterprise)

Records cluster activity to the immutable `_redpanda.audit_log` topic for compliance/monitoring. Configured entirely with cluster properties.

| Property | Notes / Default |
|---|---|
| `audit_enabled` | Master switch. Default on Cloud `true`. Set `false` to disable (documented disable action). Creates `_redpanda.audit_log` if absent. |
| `audit_log_num_partitions` | Partitions of the audit topic; cannot be altered after creation. Default 12. |
| `audit_log_replication_factor` | Replication factor of the audit topic; set before enabling. Default null (uses `internal_topic_replication_factor`). |
| `audit_enabled_event_types` | JSON array; any of `management, produce, consume, describe, heartbeat, authenticate, schema_registry, admin`. Default `["management","authenticate","admin"]`. |
| `audit_excluded_topics` | JSON array of topics to ignore (cannot include `_redpanda.audit_log`). Default null. |
| `audit_excluded_principals` | JSON array of principals to ignore (`User:name` or `name`). Default null. |
| `audit_client_max_buffer_size` | Bytes for the internal audit client buffer. Default 16777216. |
| `audit_queue_drain_interval_ms` | Interval to drain in-memory audit batches to the topic. Default 500. |
| `audit_queue_max_buffer_size_per_shard` | Max audit buffer memory per shard, in bytes. Default 1048576. |

```bash
rpk cluster config set audit_enabled true
rpk cluster config set audit_enabled_event_types '["management","authenticate","admin","produce","consume"]'
```

License expiration: read access to the audit log topic is denied, but logging continues.

Source: `manage/partials/audit-logging.adoc` (all `audit_*` properties, defaults, event types); `disable-enterprise-features.adoc` (`audit_enabled false`).

---

## RBAC / GBAC (Enterprise)

**Role-Based Access Control** manages permissions via roles. On Dedicated, manage roles through the Data Plane `SecurityService` at `/v1/roles` (see [Data Plane → Security Roles](data-plane.md#security-roles-rbac)) or `rpk security role`. Disable action: delete all roles (`rpk security role delete <name>`).

**Group-Based Access Control (GBAC)** maps OIDC group memberships to ACLs/role assignments using `Group:` principals in ACLs. License expiration: ACLs with `Group:` principals cannot be created (existing ones are still evaluated and can be deleted).

Source: licensing `overview.adoc` (RBAC, GBAC rows); `disable-enterprise-features.adoc` (RBAC disable via `rpk security role delete`); data-plane `SecurityService`.

---

## Authentication: OIDC / OAuthBearer / Kerberos (Enterprise)

External-identity and Kerberos authentication for the Kafka and HTTP layers, configured with cluster properties.

| Property | Notes |
|---|---|
| `sasl_mechanisms` | Enabled SASL mechanisms. Includes `OAUTHBEARER` (OIDC) and `GSSAPI` (Kerberos), alongside `SCRAM-SHA-256`/`SCRAM-SHA-512`. Removing `OIDC`/`GSSAPI` disables those features. |
| `http_authentication` | Auth methods for HTTP layers (Schema Registry/HTTP Proxy); includes `OIDC`. Remove `OIDC` to disable OIDC for HTTP. |

OIDC additionally uses `oidc_*` cluster properties (for example, the discovery URL and token audience) to point at the identity provider. License expiration for OIDC/OAuthBearer and Kerberos: no change to running behavior.

Source: `disable-enterprise-features.adoc` (Kerberos = remove `GSSAPI` from `sasl_mechanisms`; OIDC = remove `OIDC` from `sasl_mechanisms` and `http_authentication`); licensing `overview.adoc` (OAUTHBEARER/OIDC, Kerberos rows).

---

## FIPS Compliance (Enterprise)

Runs Redpanda with a FIPS-validated cryptographic module. Node-level configuration.

| Property | Scope | Values |
|---|---|---|
| `fips_mode` | Node config | `disabled` \| `enabled` \| `permissive`. Disable via `rpk redpanda config set redpanda.fips_mode disabled`. |

License expiration: no change.

Source: `disable-enterprise-features.adoc` (`fips_mode disabled`); licensing `overview.adoc` (FIPS Compliance row).

---

## Whole Cluster Restore & Topic Recovery (Enterprise)

- **Whole Cluster Restore (WCR):** recover a cluster from a source cluster's snapshot in object storage. License expiration blocks WCR; an expired source-cluster license propagates the restriction to the target.
- **Topic Recovery:** restore a single topic from Tiered Storage via `redpanda.remote.recovery=true` at topic create (see [Tiered Storage](#tiered-storage-enterprise)).

Source: licensing `overview.adoc` (Whole Cluster Restore, Topic Recovery rows).
