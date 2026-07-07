# Enterprise Features via the Admin API

Redpanda's enterprise differentiators are configured and operated through the same Admin API surface this skill covers: cluster config (`PUT /v1/cluster_config`), the features/licensing endpoints (`/v1/features/*`), the cloud_storage endpoints (`/v1/cloud_storage/*`), the security/RBAC endpoints (`/v1/security/roles*`), and ConnectRPC services (v25.3+).

**All features below require a valid Enterprise license** unless noted. Topic-level enterprise properties (`redpanda.iceberg.*`, `redpanda.remote.*`, `redpanda.leaders.preference`) are set on topics via the Kafka API / `rpk`, but the cluster-wide enablement keys are set via the Admin API cluster config.

Verify any key against the live schema before relying on it:

```bash
curl -s "$ADMIN/v1/cluster_config/schema" | jq '.<property_name>'
```

Check current license + which enterprise features are in use / in violation:

```bash
curl -u admin:secret "$ADMIN/v1/features/license"     # loaded license details
curl -u admin:secret "$ADMIN/v1/features/enterprise"  # license_status, violation, features[] in use
```

`license_status` values: `valid`, `expired`, `not_present`. If `violation` is `true`, an enterprise feature is enabled without a valid license. See [licensing](#licensing-and-violation-handling).

---

## Tiered Storage (Shadow Indexing) — Enterprise

Enables cloud object storage as long-term retention. Cluster-wide enablement and the cloud_storage operational endpoints are in the Admin API; per-topic toggles are topic properties.

Cluster config keys (set via `PUT /v1/cluster_config`):

| Key | Type | Purpose |
|-----|------|---------|
| `cloud_storage_enabled` | boolean | Master switch for Tiered Storage (Enterprise). Setting `false` disables the feature for license compliance. |
| `cloud_storage_enable_remote_read` | boolean | Default cluster-wide remote read (also gates Remote Read Replicas). |
| `cloud_storage_enable_remote_write` | boolean | Default cluster-wide remote write (uploads). |
| `cloud_storage_bucket` | string | Object storage bucket/container name. |
| `cloud_storage_region` | string | Object storage region. |
| `cloud_storage_credentials_source` | string | `config_file`, `aws_instance_metadata`, `sts`, `gcp_instance_metadata`, etc. |
| `cloud_storage_access_key` | string | Access key (when `credentials_source=config_file`). |
| `cloud_storage_secret_key` | string (secret) | Secret key (when `credentials_source=config_file`). |
| `cloud_storage_api_endpoint` | string | Custom S3/GCS endpoint. |
| `cloud_storage_api_endpoint_port` | integer | Endpoint port. |
| `cloud_storage_cache_size` | integer (bytes) | Local cache size for hydrated segments. |
| `cloud_storage_cache_size_percent` | number | Cache size as a percentage of disk. |
| `cloud_storage_cache_max_objects` | integer | Max objects in the local cache. |
| `cloud_storage_housekeeping_interval_ms` | integer (ms) | Interval for cloud storage housekeeping. |
| `cloud_storage_spillover_manifest_max_segments` | integer | Segments per spillover manifest. |
| `cloud_storage_manifest_cache_size` | integer (bytes) | In-memory manifest cache size. |

Per-topic properties: `redpanda.remote.read`, `redpanda.remote.write`, `redpanda.remote.delete`.

Operational endpoints (see [endpoints-overview.md](endpoints-overview.md) `shadow_indexing.json`):

```bash
# Per-partition tiered storage status
curl "$ADMIN/v1/cloud_storage/status/my-topic/0"
# In-memory partition manifest
curl "$ADMIN/v1/cloud_storage/manifest/my-topic/0"
# Total bytes in cloud storage across all partitions (debug)
curl "$ADMIN/v1/debug/cloud_storage_usage"
```

---

## Topic Recovery & Whole Cluster Restore (WCR) — Enterprise

Restore from Tiered Storage. Both are Admin API operations under `/v1/cloud_storage/`.

```bash
# Whole-cluster restore from a source cluster snapshot in object storage
curl -u admin:secret -X POST "$ADMIN/v1/cloud_storage/automated_recovery" \
  -H "Content-Type: application/json" -d '{}'
curl -u admin:secret "$ADMIN/v1/cloud_storage/automated_recovery"   # status

# Single-topic recovery: scan the bucket and restore a topic
curl -u admin:secret -X POST "$ADMIN/v1/cloud_storage/topic_recovery" \
  -H "Content-Type: application/json" -d '{}'
curl -u admin:secret "$ADMIN/v1/cloud_storage/topic_recovery"       # status
```

Topic recovery uses topic property `redpanda.remote.recovery=true`. Without a valid license, topic recovery and WCR are blocked.

---

## Remote Read Replicas — Enterprise

A read-only topic in a remote cluster that reads another cluster's data from object storage. Disable for license compliance:

```bash
curl -u admin:secret -X PUT "$ADMIN/v1/cluster_config" \
  -H "Content-Type: application/json" \
  -d '{"upsert": {"cloud_storage_enable_remote_read": false}, "remove": []}'
```

Per-topic property: `redpanda.remote.readreplica` (object storage bucket of the source topic). Related: `redpanda.remote.allowgaps`.

---

## Cloud Topics — Enterprise

Object-storage-native topics that use durable object storage as the primary backing store instead of local disk replication.

| Key | Type | Purpose |
|-----|------|---------|
| `cloud_topics_enabled` | boolean | Master switch for Cloud Topics (Enterprise). |
| `cloud_topics_produce_upload_interval` | duration | How often buffered produce data is uploaded to object storage. |
| `cloud_topics_produce_batching_size_threshold` | integer | Produce batch size that triggers an upload. |
| `cloud_topics_reconciliation_interval` | duration | Base reconciliation loop interval. |
| `cloud_topics_reconciliation_target_fill_ratio` | number | Target object fill ratio used during reconciliation. |
| `cloud_topics_num_metastore_partitions` | integer | Partition count for the Cloud Topics metastore. |
| `cloud_topics_compaction_interval_ms` | integer (ms) | Compaction loop interval. |
| `cloud_topics_allow_materialization_failure` | boolean | Whether materialization failures are tolerated. |

Without a valid license, new Cloud Topics cannot be created and existing ones cannot be modified (including partition changes).

---

## Iceberg Topics — Enterprise

Exposes Redpanda topics as Apache Iceberg tables. Per-topic mode is a topic property; cluster-wide catalog config is in the Admin API cluster config.

Per-topic properties:

| Property | Purpose |
|----------|---------|
| `redpanda.iceberg.mode` | `disabled`, `key_value`, `value_schema_id_prefix`, `value_schema_latest` |
| `redpanda.iceberg.delete` | Whether to drop the Iceberg table when the topic is deleted |
| `redpanda.iceberg.partition.spec` | Iceberg partition spec for the table |
| `redpanda.iceberg.target.lag.ms` | Target lag (ms) for committing records to the table |
| `redpanda.iceberg.invalid.record.action` | `dlq` or `drop` — how to handle records that fail to translate |

Cluster config keys:

| Key | Type | Purpose |
|-----|------|---------|
| `iceberg_enabled` | boolean | Master switch for Iceberg Topics (Enterprise). |
| `iceberg_catalog_type` | string | `object_storage` or `rest`. |
| `iceberg_catalog_base_location` | string | Base location for the catalog/tables in object storage. |
| `iceberg_default_catalog_namespace` | string | Default namespace for created tables. |
| `iceberg_catalog_commit_interval_ms` | integer (ms) | How often translated data is committed to the catalog. |
| `iceberg_target_lag_ms` | integer (ms) | Cluster default target lag for commits. |
| `iceberg_default_partition_spec` | string | Cluster default partition spec. |
| `iceberg_invalid_record_action` | string | Cluster default invalid-record action (`dlq`/`drop`). |
| `iceberg_delete` | boolean | Cluster default for dropping tables on topic deletion. |
| `iceberg_dlq_table_suffix` | string | Suffix appended to the dead-letter-queue table name. |
| `iceberg_rest_catalog_endpoint` | string | REST catalog endpoint (when `iceberg_catalog_type=rest`). |
| `iceberg_rest_catalog_authentication_mode` | string | REST catalog auth mode (e.g. `oauth2`). |
| `iceberg_rest_catalog_client_id` | string | OAuth2 client ID for the REST catalog. |
| `iceberg_rest_catalog_client_secret` | string (secret) | OAuth2 client secret for the REST catalog. |
| `iceberg_rest_catalog_token` | string (secret) | Bearer token for the REST catalog. |
| `iceberg_rest_catalog_warehouse` | string | REST catalog warehouse name. |

Without a valid license, topics cannot be created or modified with `redpanda.iceberg.mode`.

---

## Continuous Data Balancing — Enterprise

Continuously rebalances partitions across the cluster based on disk pressure and node availability. Set `partition_autobalancing_mode=continuous` (Enterprise). The other modes (`off`, `node_add`) are free.

| Key | Type | Purpose |
|-----|------|---------|
| `partition_autobalancing_mode` | string | `off`, `node_add` (free), `continuous` (**Enterprise**). |
| `partition_autobalancing_max_disk_usage_percent` | integer | Disk-usage threshold (%) that triggers a continuous rebalance. |
| `partition_autobalancing_node_availability_timeout_sec` | integer (s) | How long a node must be unavailable before its partitions are moved. |
| `partition_autobalancing_node_autodecommission_timeout_sec` | integer (s) | Auto-decommission a node unavailable for this long. |
| `partition_autobalancing_concurrent_moves` | integer | Max concurrent partition moves. |
| `partition_autobalancing_movement_batch_size_bytes` | integer (bytes) | Batch size per movement. |
| `partition_autobalancing_min_size_threshold` | integer (bytes) | Minimum partition size considered for balancing. |
| `partition_autobalancing_tick_interval_ms` | integer (ms) | Balancer tick interval. |
| `partition_autobalancing_tick_moves_drop_threshold` | number | Threshold for dropping queued moves per tick. |
| `partition_autobalancing_topic_aware` | boolean | Spread replicas of the same topic across nodes. |

Disable for license compliance: `partition_autobalancing_mode=node_add`. Status is observable at `GET /v1/cluster/partition_balancer/status` (see [endpoints-overview.md](endpoints-overview.md)).

### Continuous Intra-Broker (core) Balancing — Enterprise

Balances partition replicas across CPU cores within a single broker.

| Key | Type | Purpose |
|-----|------|---------|
| `core_balancing_continuous` | boolean | Continuous intra-broker core balancing (**Enterprise**). Set `false` to disable. |
| `core_balancing_on_core_count_change` | boolean | Rebalance cores when the broker's core count changes (free). |
| `core_balancing_debounce_timeout` | duration | Debounce window before acting on imbalance. |

---

## Leadership Pinning — Enterprise

Pins partition leaders to a preferred set of availability zones / racks.

| Key / Property | Type | Purpose |
|----------------|------|---------|
| `default_leaders_preference` (cluster config) | string | Cluster default. `none`, `racks:<rack1>,<rack2>` etc. Set `none` to disable for license compliance. |
| `redpanda.leaders.preference` (topic property) | string | Per-topic override of leadership preference. |

Without a valid license, Leader Pinning is disabled on all topics.

---

## Audit Logging — Enterprise

Writes detailed cluster-activity logs to an internal topic (`_redpanda.audit_log`). Disable: `audit_enabled=false`.

| Key | Type | Purpose |
|-----|------|---------|
| `audit_enabled` | boolean | Master switch (**Enterprise**). |
| `audit_enabled_event_types` | array | Event categories to log (e.g. `management`, `authenticate`, `produce`, `consume`, `describe`, `heartbeat`, `admin`, `schema_registry`). |
| `audit_log_num_partitions` | integer | Partitions for the audit log topic. |
| `audit_log_replication_factor` | integer | Replication factor for the audit log topic. |
| `audit_excluded_principals` | array | Principals whose actions are not audited. |
| `audit_excluded_topics` | array | Topics excluded from audit logging. |
| `audit_failure_policy` | string | Behavior when audit writes fail. |
| `audit_queue_max_buffer_size_per_shard` | integer | Per-shard audit buffer size. |
| `audit_queue_drain_interval_ms` | integer (ms) | Audit queue drain interval. |
| `audit_client_max_buffer_size` | integer | Audit client buffer size. |

On license expiration, logging continues but read access to the audit log topic is denied.

---

## Role-Based Access Control (RBAC) — Enterprise

Roles bundle ACLs and are managed via the Admin API security endpoints (`security.json`).

| Method | Path | Nickname | Description |
|--------|------|----------|-------------|
| GET | `/v1/security/roles` | `roles_list` / `list_roles` | List roles (filterable) |
| POST | `/v1/security/roles` | `create_role` | Create a role |
| GET | `/v1/security/roles/{role}` | `get_role` | Get a role |
| DELETE | `/v1/security/roles/{role}` | `delete_role` | Delete a role |
| GET | `/v1/security/roles/{role}/members` | `list_role_members` | List role members |
| POST | `/v1/security/roles/{role}/members` | `update_role_members` | Add/remove members |
| GET | `/v1/security/users/roles` | `list_user_roles` | List roles for the calling user |

```bash
# Create a role
curl -u admin:secret -X POST "$ADMIN/v1/security/roles" \
  -H "Content-Type: application/json" -d '{"role": "data-engineers"}'

# Add members to a role
curl -u admin:secret -X POST "$ADMIN/v1/security/roles/data-engineers/members" \
  -H "Content-Type: application/json" \
  -d '{"add": [{"name": "alice", "principal_type": "User"}], "remove": []}'
```

Without a valid license, roles and role-associated ACLs cannot be created or modified; deletion is allowed (used to come back into compliance).

---

## Authentication: OIDC / OAuthBearer / Kerberos — Enterprise

Configured via cluster config. SASL/SCRAM and mTLS are free; **OIDC/OAUTHBEARER and Kerberos (GSSAPI) require Enterprise**.

OIDC / OAUTHBEARER keys:

| Key | Type | Purpose |
|-----|------|---------|
| `sasl_mechanisms` | array | Enabled SASL mechanisms. Include `OAUTHBEARER` for OIDC over Kafka; remove to disable. |
| `http_authentication` | array | HTTP auth mechanisms (e.g. `BASIC`, `OIDC`) for Admin API / proxies; remove `OIDC` to disable. |
| `oidc_discovery_url` | string | OIDC provider discovery URL. |
| `oidc_token_audience` | string | Expected token `aud` claim. |
| `oidc_principal_mapping` | string | Maps a token claim to a Redpanda principal. |
| `oidc_group_claim_path` | string | Path to the groups claim (enables Group-Based Access Control). |
| `oidc_clock_skew_tolerance` | integer (s) | Allowed clock skew when validating tokens. |
| `oidc_keys_refresh_interval` | duration | How often to refresh signing keys (JWKS). |
| `oidc_http_proxy_url` | string | Proxy for reaching the OIDC provider. |

Kerberos (GSSAPI) keys:

| Key | Type | Purpose |
|-----|------|---------|
| `sasl_mechanisms` | array | Include `GSSAPI` to enable Kerberos; remove to disable. |
| `sasl_kerberos_config` | string | Path to the Kerberos `krb5.conf`. |
| `sasl_kerberos_keytab` | string | Path to the broker keytab. |
| `sasl_kerberos_principal` | string | The broker's service principal. |
| `sasl_kerberos_principal_mapping` | array | Rules mapping Kerberos principals to Redpanda principals. |

Inspect an OIDC bearer token's resolved principal:

```bash
curl -H "Authorization: Bearer <jwt>" "$ADMIN/v1/security/oidc/whoami"
```

Group-Based Access Control (GBAC) uses OIDC group claims for `Group:` ACL principals (Enterprise).

---

## Server-Side Schema ID Validation — Enterprise

Brokers reject records whose embedded schema ID is not registered. Enable: `enable_schema_id_validation`.

| Key | Type | Purpose |
|-----|------|---------|
| `enable_schema_id_validation` | string | `none` (off), `redpanda` (native), `compat` (Confluent-compatible). Set `none`/`false` to disable. |
| `kafka_schema_id_validation_cache_capacity` | integer | Per-shard cache size for validation lookups. |

Without a valid license, topics with schema validation settings cannot be created or modified.

---

## FIPS Compliance — Enterprise

FIPS 140-3 cryptography mode. This is **node config** (`redpanda.yaml`), not cluster config.

| Key | Type | Purpose |
|-----|------|---------|
| `fips_mode` | string (node config) | `disabled`, `enabled`, `permissive`. Set via `rpk redpanda config set redpanda.fips_mode disabled` to disable. |

A broker's runtime FIPS state is reported in the broker object as `in_fips_mode` (see `broker` response schema in [endpoints-overview.md](endpoints-overview.md)).

---

## Shadow Linking / Cross-Cluster Disaster Recovery — Enterprise (ConnectRPC, v25.3+)

Shadowing provides offset-preserving, asynchronous replication between two distinct Redpanda clusters for cross-region DR. It is exposed as the **ConnectRPC `ShadowLinkService`** on port 9644 (not a `/v1` REST endpoint). All methods are **POST** with a JSON or Protobuf body. Service path prefix: `redpanda.core.admin.v2.ShadowLinkService/`.

| Method | Purpose |
|--------|---------|
| `CreateShadowLink` | Create a shadow link to a source cluster |
| `GetShadowLink` | Get one shadow link (config + status) |
| `ListShadowLinks` | List all shadow links on the cluster |
| `UpdateShadowLink` | Update a shadow link (uses `update_mask`) |
| `DeleteShadowLink` | Delete a link (`force: true` to delete with active shadow topics) |
| `FailOver` | Promote shadow topics to writable. Omit `shadow_topic_name` to fail over the whole link, or set it to fail over a single topic |
| `GetShadowTopic` / `ListShadowTopics` | Inspect shadow topics within a link |

### Create a shadow link

```bash
curl -u admin:secret -X POST \
  "$ADMIN/redpanda.core.admin.v2.ShadowLinkService/CreateShadowLink" \
  -H "Content-Type: application/json" \
  -d '{
    "shadow_link": {
      "name": "dr-east",
      "configurations": {
        "client_options": {
          "bootstrap_servers": ["source-broker:9092"],
          "source_cluster_id": "<optional-expected-cluster-id>"
        },
        "topic_metadata_sync_options": {
          "auto_create_shadow_topic_filters": [{"name": "orders"}],
          "start_at_earliest": {}
        },
        "consumer_offset_sync_options": {},
        "security_sync_options": {},
        "schema_registry_sync_options": {"shadow_schema_registry_topic": {}}
      }
    }
  }'
```

### Fail over (DR promotion)

```bash
# Whole link
curl -u admin:secret -X POST \
  "$ADMIN/redpanda.core.admin.v2.ShadowLinkService/FailOver" \
  -H "Content-Type: application/json" -d '{"name": "dr-east"}'

# Single shadow topic
curl -u admin:secret -X POST \
  "$ADMIN/redpanda.core.admin.v2.ShadowLinkService/FailOver" \
  -H "Content-Type: application/json" \
  -d '{"name": "dr-east", "shadow_topic_name": "orders"}'
```

### `ShadowLinkConfigurations` nested structure (from `shadow_link.proto`)

- `client_options` (`ShadowLinkClientOptions`): `bootstrap_servers` (required), `source_cluster_id`, `tls_settings`, `authentication_configuration` (SASL/SCRAM or SASL/PLAIN), `metadata_max_age_ms`, `connection_timeout_ms`, `retry_backoff_ms`, `fetch_wait_max_ms`, `fetch_min_bytes`, `fetch_max_bytes`, `fetch_partition_max_bytes`.
- `topic_metadata_sync_options` (`TopicMetadataSyncOptions`): `interval`, `auto_create_shadow_topic_filters` (`NameFilter[]`), `synced_shadow_topic_properties`, `exclude_default`, `start_at_earliest` / `start_at_latest` / `start_at_timestamp` (oneof start offset), `paused`.
- `consumer_offset_sync_options` (`ConsumerOffsetSyncOptions`): `interval`, `group_filters`, `paused`.
- `security_sync_options` (`SecuritySettingsSyncOptions`): `interval`, `acl_filters` (`ACLFilter[]`), `paused`.
- `schema_registry_sync_options` (`SchemaRegistrySyncOptions`): `shadow_schema_registry_topic` (replicates `_schemas` byte-for-byte).

Replicated-by-default topic properties: partition count, `max.message.bytes`, `cleanup.policy`, `timestamp.type`, plus (unless `exclude_default=true`) `compression.type`, `retention.bytes`, `retention.ms`, `delete.retention.ms`, replication factor, `min.compaction.lag.ms`, `max.compaction.lag.ms`. Properties that may **not** be synced: `redpanda.remote.readreplica`, `redpanda.remote.recovery`, `redpanda.remote.allowgaps`, `redpanda.virtual.cluster.id`, `redpanda.leaders.preference`, `redpanda.storage.mode`.

Without a valid license, new shadow links cannot be created; existing links keep operating and can be updated/failed over.

SDKs for the ConnectRPC services can be generated from `buf.build/redpandadata/core`.

---

## Licensing and violation handling

```bash
# Upload a license
curl -u admin:secret -X PUT "$ADMIN/v1/features/license" \
  --data-binary @redpanda.license

# Check loaded license
curl -u admin:secret "$ADMIN/v1/features/license"

# Check enterprise status + violation flag
curl -u admin:secret "$ADMIN/v1/features/enterprise"
```

To bring a cluster back into compliance without a license (mirrors `rpk cluster license info` violations), disable the enterprise features in use via cluster config:

| Feature | Disable action |
|---------|----------------|
| Audit Logging | `audit_enabled=false` |
| Continuous Data Balancing | `partition_autobalancing_mode=node_add` |
| Continuous Intra-Broker Balancing | `core_balancing_continuous=false` |
| Tiered Storage | `cloud_storage_enabled=false` |
| Remote Read Replicas | `cloud_storage_enable_remote_read=false` |
| Server-Side Schema ID Validation | `enable_schema_id_validation=false` |
| Leader Pinning | `default_leaders_preference=none` |
| Kerberos | remove `GSSAPI` from `sasl_mechanisms` |
| OIDC/OAUTHBEARER | remove `OIDC`/`OAUTHBEARER` from `sasl_mechanisms` and `http_authentication` |
| FIPS | `fips_mode=disabled` (node config) |
| RBAC | delete roles (`DELETE /v1/security/roles/{role}`) |

Example:

```bash
curl -u admin:secret -X PUT "$ADMIN/v1/cluster_config" \
  -H "Content-Type: application/json" \
  -d '{"upsert": {"audit_enabled": false, "partition_autobalancing_mode": "node_add"}, "remove": []}'
```
