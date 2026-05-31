# Enterprise Features for Transform Topics

Data Transforms themselves are a **free, source-available (BSL)** feature — `data_transforms_enabled` does not require an Enterprise license. However, the input and output topics that a transform reads from and writes to commonly use Redpanda **Enterprise** features. This reference documents those enterprise differentiators and their exact config keys, grounded in the Redpanda docs. A transform is frequently the "shaping" stage in a pipeline whose output topic feeds a lakehouse (Iceberg) or long-term object storage (Tiered Storage).

All features below require a valid **Enterprise license**. Check license status with:

```bash
rpk cluster license info
```

> Note: `rpk cluster license info` reports license violations only for enterprise features in Redpanda core (not Redpanda Connect or Console).

---

## Iceberg Topics (output → lakehouse)

**License: Enterprise.** A recommended pattern (see the Redpanda data-transforms build docs) is to route transformed records — encoded in the Schema Registry wire format — into **Iceberg-enabled output topics** so cleaned/structured data lands directly in lakehouse tables (Snowflake, Databricks, ClickHouse, Spark, Flink) with no separate ETL. Iceberg stores topic data as Parquet in object storage **in addition to** Tiered Storage log segments, so the output topic must also have Tiered Storage enabled.

### Enable at the cluster level

`iceberg_enabled` (cluster property) must be `true` to activate the feature; the value `true` requires an Enterprise license. Requires restart.

```bash
rpk cluster config set iceberg_enabled true
```

| Cluster property | Purpose / values |
|---|---|
| `iceberg_enabled` | Master switch. `true` (Enterprise) \| `false` (default). Requires restart. |
| `iceberg_catalog_type` | Catalog integration: object-storage catalog vs. REST catalog. |
| `iceberg_default_catalog_namespace` | Namespace for tables (default `redpanda`). Set per-cluster to avoid name collisions when multiple clusters share a REST catalog (e.g. AWS Glue). Cannot change after enabling. |
| `iceberg_delete` | Cluster default for `redpanda.iceberg.delete`. |
| `iceberg_invalid_record_action` | Cluster default for `redpanda.iceberg.invalid.record.action`. |
| `iceberg_default_partition_spec` | Cluster default for `redpanda.iceberg.partition.spec`. |
| `iceberg_target_lag_ms` | Cluster default for `redpanda.iceberg.target.lag.ms`. |
| `iceberg_rest_catalog_endpoint`, `iceberg_rest_catalog_client_id`, `iceberg_rest_catalog_client_secret`, `iceberg_rest_catalog_authentication_mode`, `iceberg_rest_catalog_aws_*` | REST catalog connection/auth settings. |

### Enable per output topic

Set `redpanda.iceberg.mode` on the transform's output topic. The four modes:

| `redpanda.iceberg.mode` value | Behavior |
|---|---|
| `disabled` | Iceberg integration off for the topic. |
| `key_value` | Two-column table: one column for record metadata (incl. key), one binary column for the value. No schema needed. |
| `value_schema_id_prefix` | Structured table; Redpanda decodes each record value using the schema ID in the Schema Registry wire-format prefix. |
| `value_schema_latest` | Structured table using the latest registered schema for the topic's value subject. |

Nested topic-level Iceberg properties (all `redpanda.iceberg.*`):

| Topic property | Type | Default | Purpose |
|---|---|---|---|
| `redpanda.iceberg.mode` | string (enum above) | `null` | Enable/select Iceberg mode for the topic. |
| `redpanda.iceberg.delete` | boolean | `true` | Delete the Iceberg table when the topic is deleted. `false` keeps the table. Cluster default: `iceberg_delete`. |
| `redpanda.iceberg.invalid.record.action` | string enum: `drop` \| `dlq_table` | `dlq_table` | What to do with records that fail Iceberg translation: drop them, or write to a dead-letter-queue table. Cluster default: `iceberg_invalid_record_action`. |
| `redpanda.iceberg.partition.spec` | string | `(hour(redpanda.timestamp))` | Iceberg partitioning spec for the table. Cluster default: `iceberg_default_partition_spec`. |
| `redpanda.iceberg.target.lag.ms` | integer (ms) | `null` | How often the Iceberg table is refreshed with new topic data; Redpanda commits within this lag target. Cluster default: `iceberg_target_lag_ms`. |

```bash
# Create a transform output topic that lands directly in a lakehouse table
rpk topic create clean-events --topic-config=redpanda.iceberg.mode=value_schema_id_prefix

# Or enable Iceberg on an existing output topic
rpk topic alter-config clean-events --set redpanda.iceberg.mode=key_value
rpk topic alter-config clean-events --set redpanda.iceberg.target.lag.ms=60000
rpk topic alter-config clean-events --set redpanda.iceberg.invalid.record.action=dlq_table
```

To use the structured modes (`value_schema_id_prefix` / `value_schema_latest`), the transform must write records in the Schema Registry wire format (magic byte + 4-byte schema ID + payload) — use the Go or Rust SDK Schema Registry client (see develop-and-build.md).

**On license expiration**: topics cannot be created or modified with the `redpanda.iceberg.mode` property.

---

## Tiered Storage (input/output topic backing)

**License: Enterprise.** Tiered Storage offloads topic log segments to cloud object storage for long-term retention. It is also a prerequisite for Iceberg output topics. Transform throughput is unaffected — CPU time for the Wasm runtime is dynamically scheduled so it does not block Tiered Storage uploads.

### Enable at the cluster level

```bash
rpk cluster config set cloud_storage_enabled true
```

| Property | Scope | Purpose |
|---|---|---|
| `cloud_storage_enabled` | cluster | Master switch for Tiered Storage (Enterprise). |
| `cloud_storage_enable_remote_read` | cluster | Cluster default for remote read (also the Remote Read Replicas toggle). |
| `cloud_storage_enable_remote_write` | cluster | Cluster default for remote write. |
| `redpanda.remote.read` | topic | Fetch topic data from object storage to local storage. |
| `redpanda.remote.write` | topic | Upload topic segments to object storage. Set with `redpanda.remote.read` to enable Tiered Storage on the topic. |
| `redpanda.remote.delete` | topic | Delete objects from storage when topic data is deleted. |
| `redpanda.remote.recovery` | topic | Recover/restore a topic from object storage (create-time only). |

```bash
# Enable Tiered Storage on a transform output topic (required before Iceberg)
rpk topic alter-config clean-events --set redpanda.remote.read=true --set redpanda.remote.write=true
```

**On license expiration**: topics cannot be created or modified to enable Tiered Storage; partitions cannot be added to Tiered-Storage topics.

---

## Server-Side Schema ID Validation (output topic guard)

**License: Enterprise.** When a transform produces records in the Confluent/Schema Registry wire format, server-side schema ID validation makes the broker detect and **drop** records on the output topic whose encoded schema ID is not registered in the Schema Registry under the configured subject name strategy. This catches malformed transform output at the broker instead of at the consumer.

> Validation only checks that the encoded schema ID is registered — it does not verify the payload conforms to the schema.

### Enable at the cluster level

`enable_schema_id_validation` defaults to `none`; set it to `redpanda` (Redpanda-native) or `compat` (Confluent-compatible) to enable.

```bash
rpk cluster config set enable_schema_id_validation redpanda
```

### Enable per output topic

| Topic property | Default | Purpose |
|---|---|---|
| `redpanda.key.schema.id.validation` | `false` | Validate the schema ID encoded in record keys. |
| `redpanda.key.subject.name.strategy` | `TopicNameStrategy` | Subject name strategy for keys. |
| `redpanda.value.schema.id.validation` | `false` | Validate the schema ID encoded in record values. |
| `redpanda.value.subject.name.strategy` | `TopicNameStrategy` | Subject name strategy for values. |
| `confluent.key.subject.name.strategy` / `confluent.value.subject.name.strategy` | — | Confluent-prefixed equivalents (use with `compat` mode; strategy names prefixed `io.confluent.kafka.serializers.subject.`). |

Supported subject name strategies: `TopicNameStrategy`, `RecordNameStrategy`, `TopicRecordNameStrategy`.

```bash
# Validate that transform output carries a registered value schema ID
rpk topic alter-config clean-events \
  --set redpanda.value.schema.id.validation=true \
  --set redpanda.value.subject.name.strategy=TopicNameStrategy
```

**On license expiration**: topics with schema validation settings cannot be created or modified; `enable_schema_id_validation` cannot be re-enabled.

---

## Leadership Pinning (where transform processors run)

**License: Enterprise.** A transform processor runs on the same CPU core as the **partition leader** of its input topic. Leadership Pinning constrains which availability zones / racks host the leaders of a topic's partitions, so it controls which AZs a transform's processors execute in — useful for keeping transform compute co-located with data and minimizing cross-AZ traffic.

### Cluster default and per-topic override

| Property | Scope | Values |
|---|---|---|
| `default_leaders_preference` | cluster | Default for all topics. `none` (default) \| `racks:<rack1>,<rack2>` \| `ordered_racks:<rack1>,<rack2>` |
| `redpanda.leaders.preference` | topic | Per-topic override; inherits `default_leaders_preference`. Same value formats. |

```bash
# Pin leaders (and therefore transform processors) of the input topic to specific racks/AZs
rpk topic alter-config input-topic --set redpanda.leaders.preference=ordered_racks:rack-a,rack-b

# Cluster-wide default
rpk cluster config set default_leaders_preference racks:rack-a,rack-b
```

**On license expiration**: Leader Pinning is disabled on all topics. To disable manually: set `default_leaders_preference` to `none`.

---

## Access Control for Transform Topics (RBAC / ACLs)

**License: Enterprise** for Role-Based Access Control (`rpk security role …`) and Audit Logging. ACLs themselves are free, but role-based management of who may deploy/manage transforms and read/write the transform's input/output topics is the enterprise differentiator.

- **RBAC**: manage permissions via roles. On license expiration, roles and role-bound ACLs cannot be created or modified (deletion is allowed). Disable by deleting roles:

  ```bash
  rpk security role list
  rpk security role delete <role-name>
  ```

- **Audit Logging**: records cluster activity (including topic and transform-related admin operations) for compliance. Enable/disable:

  ```bash
  rpk cluster config set audit_enabled true   # false to disable
  ```

  On license expiration, read access to the audit log topic is denied but logging continues.

---

## Quick license / compliance check

```bash
# Is a valid license applied, and are any enterprise features in violation?
rpk cluster license info
```

If `license violation` is `true`, either apply a valid license or disable the offending feature (e.g. `iceberg_enabled false`, `cloud_storage_enabled false`, `enable_schema_id_validation false`, `default_leaders_preference none`).
