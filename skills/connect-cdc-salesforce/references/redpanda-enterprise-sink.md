# Redpanda Enterprise Features for the Salesforce CDC Sink

The `salesforce_cdc` input is itself a **Redpanda Connect enterprise connector** (gated by
`license.CheckRunningEnterprise`). Beyond the connector, the Redpanda topics that receive the
CDC/Platform-Event stream can use Redpanda's broker-side **enterprise features**. This reference
documents the enterprise features that are relevant to a Salesforce-CDC-into-Redpanda pipeline,
with their exact config keys, grounded in Redpanda docs/source.

All features below require a valid **Redpanda Enterprise Edition license** on the destination
cluster. Check status with:

```bash
rpk cluster license info        # license violation: true|false
```

New clusters (Redpanda 24.3+) get a 30-day trial license automatically. After expiry, you cannot
enable these features and active ones enter a restricted state.

Grounded in:
- `docs/modules/get-started/pages/licensing/overview.adoc` (enterprise feature tables)
- `docs/modules/get-started/pages/licensing/disable-enterprise-features.adoc` (disable actions)
- `docs/modules/reference/partials/properties/topic-properties.adoc` (topic property specs)
- `docs/modules/manage/pages/iceberg/about-iceberg-topics.adoc` (Iceberg modes/prereqs)
- `docs/modules/develop/pages/manage-topics/cloud-topics.adoc` (Cloud Topics enable/create)
- `docs/modules/manage/pages/schema-reg/schema-id-validation.adoc` (schema ID validation)
- `connect/internal/license/shared_service.go` (Connect license enforcement)

---

## 1. The connector itself (Redpanda Connect enterprise connector)

`salesforce_cdc` is an enterprise-only input. Without a valid Connect-product license, startup
fails with the exact error (`connect/internal/license/shared_service.go:44`):

```
this feature requires a valid Redpanda Enterprise Edition license that includes the
Connect product. For more information check out:
https://docs.redpanda.com/redpanda-connect/get-started/licensing/
```

| Behavior | Detail |
|---|---|
| License scope | Connect product line (separate from the broker license) |
| Trial | 30-day evaluation; after expiry enterprise connectors are blocked |
| Apply a key | `rpk connect run` reads the license from `redpanda-connect` license config, env, or the connected cluster — see https://docs.redpanda.com/redpanda-connect/get-started/licensing/ |
| Restriction on expiry | All enterprise connectors (including `salesforce_cdc`) are blocked |

Note: `rpk cluster license info` reports violations only for **broker** enterprise features. It does
**not** report Connect or Console license violations.

---

## 2. Iceberg Topics — analytics-ready CDC tables (Enterprise)

The natural downstream pattern: land Salesforce CDC events in a Redpanda topic that is also
materialized as an Apache Iceberg table, so Snowflake/Databricks/Spark/Flink can query the change
stream without a separate ETL pipeline.

**Prerequisites** (`about-iceberg-topics.adoc`):
- Enterprise license.
- **Tiered Storage must be enabled** for the topic (Iceberg writes Parquet alongside Tiered Storage
  segments). See section 3.
- Cluster property `iceberg_enabled=true`.

Enable at the cluster level, then per topic:

```bash
rpk cluster config set iceberg_enabled true
# optional unique namespace per cluster (set together with iceberg_enabled; immutable after)
rpk cluster config set iceberg_default_catalog_namespace salesforce_cdc

rpk topic alter-config sf.cdc.account --set redpanda.iceberg.mode=value_schema_latest
```

### Topic-level Iceberg properties

| Property | Type | Default | Values / notes |
|---|---|---|---|
| `redpanda.iceberg.mode` | string | `disabled` (`null` raw default) | `disabled`, `key_value`, `value_schema_id_prefix`, `value_schema_latest` |
| `redpanda.iceberg.delete` | boolean | `true` | Delete the Iceberg table when the topic is deleted |
| `redpanda.iceberg.invalid.record.action` | string (enum) | `dlq_table` | `drop`, `dlq_table` — where invalid records go |
| `redpanda.iceberg.partition.spec` | string | `(hour(redpanda.timestamp))` | Iceberg partitioning spec |
| `redpanda.iceberg.target.lag.ms` | integer (ms) | `null` | How often the Iceberg table is refreshed from the topic |

**Mode meanings** (`about-iceberg-topics.adoc`):
- `key_value`: two-column table — record metadata (incl. key) + a binary value column. Good for the
  raw CDC JSON payload when you have no registered schema.
- `value_schema_id_prefix`: table columns match the topic's registered schema; producers must use the
  Schema Registry wire format. Requires a registered schema.
- `value_schema_latest`: table columns match the latest registered subject schema.
- `disabled` (default): no Iceberg table.

For Salesforce CDC payloads (nested `ChangeEventHeader` + sObject fields), `key_value` is the
simplest mode; use `value_schema_*` only if you register a schema for the produced records (e.g. via
a `schema_registry_encode` processor in Connect).

**On license expiry**: topics cannot be created or modified with `redpanda.iceberg.mode`.

---

## 3. Tiered Storage — long retention of the CDC stream (Enterprise)

Tiered Storage offloads CDC topic data to object storage for cheap long-term retention and is a
**prerequisite for Iceberg Topics**. Salesforce retains CDC events for only 24h (72h with Enhanced
Event Retention); Tiered Storage lets you keep the materialized change history in Redpanda
indefinitely.

Enable at cluster level, then per topic (`topic-properties.adoc`, `disable-enterprise-features.adoc`):

```bash
rpk cluster config set cloud_storage_enabled true     # cluster-wide enable
rpk topic alter-config sf.cdc.account \
  --set redpanda.remote.write=true \
  --set redpanda.remote.read=true
```

### Relevant topic-level properties

| Property | Type | Default | Notes |
|---|---|---|---|
| `redpanda.remote.write` | boolean | `false` | Upload local segments to object storage (cluster prop: `cloud_storage_enable_remote_write`) |
| `redpanda.remote.read` | boolean | `false` | Fetch from object storage to local (cluster prop: `cloud_storage_enable_remote_read`) |
| `redpanda.remote.recovery` | string/bool | — | Topic recovery from Tiered Storage; **create-time only**, cannot be set on existing topics |
| `retention.ms` | — | cluster default | Total retention (local + remote) by time |
| `retention.bytes` | — | cluster default | Total retention by size |
| `retention.local.target.ms` | — | cluster default | Local (hot) retention by time before offload |
| `retention.local.target.bytes` | — | cluster default | Local (hot) retention by size before offload |

Setting both `redpanda.remote.read=true` and `redpanda.remote.write=true` enables Tiered Storage for
the topic.

**Disable** (compliance without license): `rpk cluster config set cloud_storage_enabled false`.

**On license expiry**: topics cannot be created/modified to enable Tiered Storage; you cannot add
partitions to topics with Tiered Storage properties.

---

## 4. Cloud Topics — object-storage-native CDC topics (Enterprise)

Cloud Topics are "diskless" Redpanda topics that store data directly in object storage as the
primary backing store (instead of local-disk replication), using local storage only as a write
buffer. They trade higher latency for lower cost, which fits cost-sensitive CDC retention where
the Salesforce change stream does not need single-digit-ms reads. This is a distinct destination
storage type, parallel to Tiered Storage (section 3) and the Iceberg pattern (section 2).

**Prerequisites** (`cloud-topics.adoc`):
- Enterprise license (the cluster property `cloud_topics_enabled=true` requires Enterprise).
- rpk v26.1 or later.
- Cloud storage (object storage) enabled and configured on the cluster — same setup as Tiered
  Storage (`rpk cluster config set cloud_storage_enabled true` plus object-storage config).

Enable at the cluster level, then create the topic in `cloud` storage mode:

```bash
rpk cluster config set cloud_topics_enabled=true   # cluster prop; requires a restart to take effect

# A topic can be made a Cloud Topic only at creation time:
rpk topic create -c redpanda.storage.mode=cloud sf.cdc.account
```

To make every new topic in the cluster a Cloud Topic by default, set the cluster-wide
`default_redpanda_storage_mode=cloud`.

### Relevant properties

| Property | Level | Type | Default | Notes |
|---|---|---|---|---|
| `cloud_topics_enabled` | cluster | boolean | `false` | Enables Cloud Topics for the cluster; `true` requires Enterprise; requires restart |
| `redpanda.storage.mode` | topic | string (enum) | unset (cluster default) | `local`, `tiered`, `cloud`, `unset`; set `cloud` at create time for a Cloud Topic (introduced in v26.1.1) |
| `redpanda.cloud_topic.enabled` | topic | string | `null` | Nested key that enables Cloud Topic storage mode; `redpanda.storage.mode` is the more flexible, preferred control |
| `default_redpanda_storage_mode` | cluster | string (enum) | — | Cluster-wide default storage mode; set `cloud` so new topics are Cloud Topics by default |

**Limitation**: a topic can be made a Cloud Topic only at creation time; you cannot convert an
existing topic. For multi-AZ clusters, pair with Follower Fetching and leader pinning to cut
cross-AZ networking costs.

**On license expiry**: new Cloud Topics cannot be created, and existing Cloud Topics cannot be
modified (including adding or modifying partitions); major upgrades are blocked in a violation state.

---

## 5. Server-Side Schema ID Validation (Enterprise)

If you encode the produced Salesforce records with the Schema Registry wire format (e.g. a
`schema_registry_encode` processor before the Kafka output), the destination topic can enforce that
only records carrying a registered schema ID are accepted — invalid records are dropped by the
broker, not the consumer.

Enable at the cluster level (`schema-id-validation.adoc`):

```bash
# none (default) | redpanda | compat
rpk cluster config set enable_schema_id_validation redpanda
```

### Topic-level properties

| Property | Type | Default | Notes |
|---|---|---|---|
| `redpanda.key.schema.id.validation` | boolean | `false` | Validate the key's encoded schema ID |
| `redpanda.value.schema.id.validation` | boolean | `false` | Validate the value's encoded schema ID |
| `redpanda.key.subject.name.strategy` | string (enum) | `TopicNameStrategy` | `TopicNameStrategy`, `RecordNameStrategy`, `TopicRecordNameStrategy` |
| `redpanda.value.subject.name.strategy` | string (enum) | `TopicNameStrategy` | same enum as key |

```bash
rpk topic alter-config sf.cdc.account \
  --set redpanda.value.schema.id.validation=true \
  --set redpanda.value.subject.name.strategy=TopicNameStrategy
```

**Disable**: `rpk cluster config set enable_schema_id_validation false` (or `none`).

**On license expiry**: topics with schema validation settings cannot be created or modified.

---

## 6. Other enterprise features (cluster-wide, apply to CDC topics indirectly)

These are not specific to this connector but secure/operate the destination cluster. They use
cluster-level config, not per-topic settings on the CDC topics. Documented here so the skill points
to them; full details live in the broker docs.

| Feature | Key config | Disable action |
|---|---|---|
| RBAC (role-based access control) | `rpk security role create/list/delete` | Delete all roles to drop to community |
| Audit Logging | `audit_enabled=true` | `rpk cluster config set audit_enabled false` |
| OIDC / OAUTHBEARER auth | add `OIDC` to `sasl_mechanisms` / `http_authentication` | remove `OIDC` from those lists |
| Kerberos (GSSAPI) auth | add `GSSAPI` to `sasl_mechanisms` | remove `GSSAPI` |
| FIPS compliance | node config `fips_mode` | `rpk redpanda config set redpanda.fips_mode disabled` |
| Continuous Data Balancing | `partition_autobalancing_mode=continuous` | set to `node_add` |
| Leader Pinning | topic-level leader preference + `default_leaders_preference` | set `default_leaders_preference none` |
| Remote Read Replicas | `redpanda.remote.readreplica=<bucket>` (topic) | `cloud_storage_enable_remote_read false` |
| Shadowing (cross-cluster DR) | `rpk shadow` (shadow links) | new links blocked on expiry; existing keep running |

For RBAC specifically, you would typically create a role for the Connect producer's principal and
grant it `WRITE`/`CREATE` on the `sf.cdc.*` topics. That ACL/role management is the enterprise RBAC
feature; the producer credentials are configured in the Connect Kafka output (`sasl` block), not in
the `salesforce_cdc` input.
