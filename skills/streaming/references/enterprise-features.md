# Enterprise Features Index (Broker / Kafka API)

Redpanda ships a single binary that runs in Community (BSL) or Enterprise (RCL) edition. Enterprise features require a valid license key. New clusters (v24.3+) get a 30-day trial automatically; extend with `rpk generate license --apply`. On license expiration the cluster keeps running without data loss, but enterprise features become restricted (see per-feature behavior below).

Check license status / violations:

```bash
rpk cluster license info
# license violation: true  => an enterprise feature is enabled without a valid license
```

This index lists the enterprise differentiators relevant to the **Kafka API / broker / topic** domain that this skill covers, with the config keys to enable/disable each and where they are documented in detail.

## Enterprise Features Covered Here

| Feature | Enable key(s) | Disable key(s) | Behavior on license expiration | Detail |
|---|---|---|---|---|
| **Tiered Storage** (shadow indexing) | `redpanda.storage.mode=tiered` (topic) or `redpanda.remote.write/read=true`; cluster `cloud_storage_enabled=true` | `cloud_storage_enabled=false` | Topics can't be created/modified to enable it; can't add partitions to tiered topics | `references/tiered-storage.md` |
| **Cloud Topics** | `cloud_topics_enabled=true` (cluster) + `redpanda.storage.mode=cloud` (topic, create-only); `redpanda.cloud_topic.enabled` | — | New Cloud Topics can't be created; existing can't be modified; upgrades blocked in violation | `references/cloud-topics.md` |
| **Iceberg Topics** | `iceberg_enabled=true` (cluster) + `redpanda.iceberg.mode` (topic) | set `redpanda.iceberg.mode=disabled` | Topics can't be created/modified with `redpanda.iceberg.mode` | `references/iceberg-topics.md` |
| **Continuous Data Balancing** | `partition_autobalancing_mode=continuous` | `partition_autobalancing_mode=node_add` | Reverts to `node_add` balancing | `references/continuous-balancing.md` |
| **Continuous Intra-Broker (core) Balancing** | `core_balancing_continuous=true` | `core_balancing_continuous=false` | Disabled | `references/continuous-balancing.md` |
| **Shadowing / Shadow Links** (cross-cluster DR) | `enable_shadow_linking=true` + `rpk shadow create` | n/a | New shadow links can't be created; existing keep running | `references/shadow-linking.md` |
| **Remote Read Replicas** | `cloud_storage_enable_remote_read=true`; topic `redpanda.remote.readreplica` | `cloud_storage_enable_remote_read=false` | RRR topics can't be created/modified | `references/tiered-storage.md` (Remote Read Replicas section) |
| **Topic Recovery** (single-topic restore from Tiered Storage) | topic `redpanda.remote.recovery=true` | n/a | Can't create topics with `redpanda.remote.recovery=true` or run recovery | `references/tiered-storage.md` |
| **Leader Pinning** | topic `redpanda.leaders.preference=racks:<az>` / `ordered_racks:...`; cluster `default_leaders_preference` | `default_leaders_preference=none` | Leader Pinning disabled on all topics | `references/topic-management.md` (Leader Pinning section) |
| **Server-Side Schema ID Validation** | `enable_schema_id_validation=redpanda` (or `compat`) (cluster) + topic `redpanda.key.schema.id.validation` / `redpanda.value.schema.id.validation` | `enable_schema_id_validation=none` | Topics with schema-validation settings can't be created/modified | this file (below) |
| **Topic Deletion Control** | `delete_topic_enable=false` (cluster) | n/a | Reverts to `true` (deletion enabled) | this file (below) |

## Enterprise Features in Other Skills

These are enterprise differentiators but live outside the Kafka API surface; they are documented in sibling skills. Listed here so an agent knows they exist and require a license.

| Feature | Enable / disable key | Notes |
|---|---|---|
| Audit Logging | `audit_enabled=true/false` (cluster) | Records cluster activity to `_redpanda.audit_log`. See `streaming-admin-api` / security skill. |
| Role-Based Access Control (RBAC) | `rpk security role create/delete` | Roles + ACLs bound to roles. Security skill. |
| Group-Based Access Control (GBAC) | ACLs with `Group:` principals (OIDC groups) | Security skill. |
| OAUTHBEARER / OIDC auth | add `OIDC` to `sasl_mechanisms` and `http_authentication` | Security/auth skill. |
| Kerberos (GSSAPI) auth | add `GSSAPI` to `sasl_mechanisms` | Security/auth skill. |
| FIPS Compliance | node config `fips_mode=enabled` (disable: `disabled`) | Security skill. |
| Schema Registry Authorization | `schema_registry_enable_authorization=true` | Schema Registry skill. |
| Whole Cluster Restore (WCR) | restore from source snapshot | Disaster-recovery / admin skill. |

## Server-Side Schema ID Validation (key detail)

Enterprise. The cluster property `enable_schema_id_validation` is a **string enum**, not a boolean. Its default is `none` (disabled, Community). Set it to `redpanda` (validate, Redpanda topic properties only) or `compat` (validate, also accept Confluent-compatible topic-property aliases) to enable; both `redpanda` and `compat` require an Enterprise license. Per-topic nested properties:
- `redpanda.key.schema.id.validation` (boolean): validate that the schema ID in a record's key is registered in the Schema Registry per the subject-name strategy.
- `redpanda.value.schema.id.validation` (boolean): same for the record value.
- Subject-name strategy properties: `redpanda.key.subject.name.strategy`, `redpanda.value.subject.name.strategy`.

Records referencing unregistered schemas are dropped by the broker instead of reaching consumers. Enable with `rpk cluster config set enable_schema_id_validation redpanda` (or `compat`); disable with `rpk cluster config set enable_schema_id_validation none`.

## Topic Deletion Control (key detail)

Cluster property `delete_topic_enable`. When set to `false`, no user (including superusers) can delete topics via the Kafka `DeleteTopics` API — a cluster-wide safety guard against accidental deletion. On license expiration it reverts to `true` (deletion enabled).

```bash
rpk cluster config set delete_topic_enable false
```

## Disabling Enterprise Features (compliance)

To bring a cluster into compliance without a license, disable each active feature (see the per-feature disable keys above). Then re-check:

```bash
rpk cluster license info   # confirm "license violation" is now false
```
