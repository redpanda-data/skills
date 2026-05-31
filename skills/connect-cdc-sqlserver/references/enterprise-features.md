# Enterprise Features for SQL Server CDC Pipelines

`microsoft_sql_server_cdc` is itself a Redpanda Connect **Enterprise connector**:
it requires a valid Redpanda Enterprise license to run. This file covers that
license requirement plus the Redpanda **destination-side** enterprise features
that pair naturally with a CDC pipeline writing change events into Redpanda:
landing CDC data in a lakehouse (Iceberg Topics), guaranteeing schema integrity
on the destination topics (server-side Schema ID Validation), and long-term
retention of the CDC topics (Tiered Storage / Cloud Topics).

All keys/flags below are grounded in the Redpanda source/docs (see the path
notes per section). Items marked **Enterprise license required** are gated by a
valid Redpanda Enterprise Edition license; without one, the feature cannot be
enabled (Connect enterprise connectors are blocked, and the cluster topic
properties cannot be set).

---

## 1. Redpanda Connect Enterprise license (required for this connector)

`microsoft_sql_server_cdc` is one of the Redpanda Connect
[enterprise connectors](https://docs.redpanda.com/redpanda-connect/components/catalog/?support=enterprise).
Running it without a license fails at startup. After the 30-day evaluation
period you are blocked from using enterprise connectors unless you upgrade to an
Enterprise Edition license.

Source: `connect/internal/cli/flags_redpanda.go`,
`connect/internal/license/service.go`.

### How a license is supplied to `rpk connect run` / Redpanda Connect

| Mechanism | Value | Notes |
|---|---|---|
| CLI flag | `--redpanda-license <license-string>` | Inline license string. Takes precedence over env/file. |
| Env var | `REDPANDA_LICENSE` | Inline license string. |
| Env var | `REDPANDA_LICENSE_FILEPATH` | Path to a license file. |
| Default file | `/etc/redpanda/redpanda.license` | Auto-applied if present and none of the above are set (`defaultLicenseFilepath` in `service.go`). |

The `--redpanda-license` flag is also wired into `rpk connect dry-run`
(`dry_run.go` calls `applyLicenseFlag`), so you can validate an enterprise
pipeline offline before deploying.

```bash
# Inline string via env var
export REDPANDA_LICENSE="$(cat redpanda.license)"
rpk connect run mssql-cdc.yaml

# Or explicit flag
rpk connect run --redpanda-license "$(cat redpanda.license)" mssql-cdc.yaml

# Or rely on the default path /etc/redpanda/redpanda.license (no flag needed)
rpk connect run mssql-cdc.yaml
```

> The license that authorizes the **Connect connector** is separate from the
> license on the **Redpanda cluster** you write into. Destination-side features
> (Iceberg, Schema ID Validation, Tiered Storage) require a valid license on the
> *cluster*, applied with `rpk cluster license set` and checked with
> `rpk cluster license info`.

---

## 2. Iceberg Topics — land CDC change events directly in a lakehouse

**Enterprise license required (cluster-side).** Iceberg Topics let the Redpanda
topics your CDC pipeline writes to also materialize as Apache Iceberg v2 tables
in object storage, so SQL Server change data becomes queryable from Snowflake,
Databricks, Spark, Flink, ClickHouse, etc. without a separate ETL hop. This is
the natural lakehouse sink for `microsoft_sql_server_cdc` output.

Source: `docs/modules/manage/pages/iceberg/about-iceberg-topics.adoc`,
`docs/modules/reference/partials/properties/topic-properties.adoc`.

### Prerequisites

- Enterprise license on the cluster (`rpk cluster license info`).
- **Tiered Storage enabled** for the topics (Iceberg writes Parquet to the same
  object storage). See section 4.

### Cluster property

| Property | Default | Description |
|---|---|---|
| `iceberg_enabled` | `false` | Master switch. Set `true` to allow any topic to enable Iceberg. Restart required when changed on a running cluster. |
| `iceberg_default_catalog_namespace` | `redpanda` | Namespace for Iceberg tables in a REST catalog. Set per cluster to avoid table-name collisions when multiple clusters share a catalog (e.g. AWS Glue). Cannot be changed after enabling. |
| `iceberg_delete` | `true` | Cluster default for the per-topic `redpanda.iceberg.delete`. |
| `iceberg_invalid_record_action` | `dlq_table` | Cluster default for `redpanda.iceberg.invalid.record.action`. |
| `iceberg_default_partition_spec` | `(hour(redpanda.timestamp))` | Cluster default for `redpanda.iceberg.partition.spec`. |

```bash
rpk cluster config set iceberg_enabled true
# Optional custom namespace (default "redpanda"):
# rpk cluster config set iceberg_default_catalog_namespace '["sqlserver_cdc"]'
```

### Per-topic Iceberg properties

Set these on the destination topic (the topic your CDC output writes to).

| Topic property | Type | Default | Description |
|---|---|---|---|
| `redpanda.iceberg.mode` | string (enum) | `null` / `disabled` | Enables Iceberg for the topic. Modes: `key_value`, `value_schema_id_prefix`, `value_schema_latest`, `disabled`. |
| `redpanda.iceberg.delete` | boolean | `true` | Whether the Iceberg table is deleted when the topic is deleted. Set `false` to keep the table. |
| `redpanda.iceberg.invalid.record.action` | string (enum) | `dlq_table` | What to do with records that fail Iceberg translation: `drop` or `dlq_table` (writes to `<topic-name>~dlq`). |
| `redpanda.iceberg.partition.spec` | string | `(hour(redpanda.timestamp))` | Iceberg partitioning spec, e.g. `(hour(redpanda.timestamp))` or a field-based spec like `(database_schema)`. |
| `redpanda.iceberg.target.lag.ms` | integer (ms) | `null` | How often Redpanda commits topic data into the Iceberg table (freshness target). |

#### Iceberg modes — which to pick for CDC

| Mode | Resulting table | Use for CDC when |
|---|---|---|
| `key_value` | Two columns: record metadata (incl. key) + a binary value column | You want the raw JSON change-event payload landed without a structured schema. |
| `value_schema_id_prefix` | Columns match the registered schema; producers must use the Schema Registry wire format (schema ID prefix in the payload) | Your CDC output writes schema-encoded records (e.g. via a `schema_registry_encode` processor). |
| `value_schema_latest` | Columns match the latest registered subject schema | You manage the schema in the registry and produce plain encoded values. |
| `disabled` | (none) | Iceberg off for this topic (default). |

Because `microsoft_sql_server_cdc` emits a JSON body and rich metadata
(`table`, `database_schema`, `operation`, `lsn`), a common pattern is:
- Route per-table to its own topic (see `pipeline-and-output.md`), then
- Enable `redpanda.iceberg.mode=key_value` for a quick raw landing, or
- Encode records against a Schema Registry subject and use
  `value_schema_id_prefix` for a fully columnar Iceberg table per source table.

```bash
# Per-destination-topic, raw landing of CDC JSON
rpk topic alter-config sqlserver.dbo.orders \
  --set redpanda.iceberg.mode=key_value \
  --set redpanda.iceberg.target.lag.ms=60000 \
  --set redpanda.iceberg.invalid.record.action=dlq_table

# Partition the Iceberg table by ingestion hour (default) or a custom spec
rpk topic alter-config sqlserver.dbo.orders \
  --set "redpanda.iceberg.partition.spec=(hour(redpanda.timestamp))"
```

Schema evolution: when the registered schema changes, Redpanda automatically
evolves the Iceberg table (field reordering, type promotion) per the Iceberg
spec — useful when a SQL Server table gains a column and you re-enable the
capture instance.

---

## 3. Server-side Schema ID Validation — enforce schema integrity on destination topics

**Enterprise license required.** If your CDC pipeline encodes records with a
Schema Registry SerDes wire format before producing (so downstream/Iceberg can
read them as structured data), server-side Schema ID Validation makes the broker
reject records whose schema ID is not registered, rather than letting a bad
producer corrupt the topic.

Source: `docs/modules/manage/pages/schema-reg/schema-id-validation.adoc`,
`docs/modules/reference/partials/properties/topic-properties.adoc`.

### Cluster property

| Property | Values | Default | Description |
|---|---|---|---|
| `enable_schema_id_validation` | `none`, `redpanda`, `compat` | `none` | `none` = disabled; `redpanda` = enabled, accept only `redpanda.*` topic props; `compat` = enabled, accept both `redpanda.*` and `confluent.*` props. |

```bash
rpk cluster config set enable_schema_id_validation redpanda
```

### Per-topic properties

| Redpanda property | Confluent equivalent | Type | Default | Description |
|---|---|---|---|---|
| `redpanda.key.schema.id.validation` | `confluent.key.schema.validation` | boolean | `false` | Validate the key's schema ID. |
| `redpanda.key.subject.name.strategy` | `confluent.key.subject.name.strategy` | string | `TopicNameStrategy` | Subject name strategy for keys. |
| `redpanda.value.schema.id.validation` | `confluent.value.schema.validation` | boolean | `false` | Validate the value's schema ID. |
| `redpanda.value.subject.name.strategy` | `confluent.value.subject.name.strategy` | string | `TopicNameStrategy` | Subject name strategy for values. |

Subject name strategies: `TopicNameStrategy`, `RecordNameStrategy`,
`TopicRecordNameStrategy`. When using `confluent.*`, strategy values must be
prefixed with `io.confluent.kafka.serializers.subject.` (e.g.
`io.confluent.kafka.serializers.subject.TopicNameStrategy`).

```bash
rpk topic alter-config sqlserver.dbo.orders \
  --set redpanda.value.schema.id.validation=true \
  --set redpanda.value.subject.name.strategy=TopicNameStrategy
```

> Validation only checks that the encoded schema ID is registered — it does not
> verify the payload conforms to that schema. For CDC, pair this with a
> `schema_registry_encode` processor in the Connect pipeline so the produced
> records carry a valid wire-format header.

---

## 4. Tiered Storage / Cloud Topics — long-term retention of CDC topics

**Enterprise license required.** CDC topics often need long retention (replay,
audit, lakehouse backfill). Tiered Storage offloads topic log segments to object
storage; it is also a **prerequisite for Iceberg Topics** (section 2).

Source: `docs/modules/reference/partials/properties/topic-properties.adoc`
(category-tiered-storage), `docs/modules/manage/pages/tiered-storage.adoc`.

### Cluster property

| Property | Default | Description |
|---|---|---|
| `cloud_storage_enabled` | `false` | Master switch for Tiered Storage. Disabling it is the documented way to turn off the enterprise feature. |

### Per-topic Tiered Storage properties

| Topic property | Type | Description |
|---|---|---|
| `redpanda.remote.write` | boolean | Upload this topic's segments to object storage. |
| `redpanda.remote.read` | boolean | Allow fetching this topic's data from object storage. |
| `redpanda.remote.delete` | boolean | Delete objects in storage when the topic/segments are deleted. |
| `initial.retention.local.target.bytes` | integer (bytes) | Local data to transfer on cluster resize (`null` = all; `0` = none; positive = cap). Cluster default: `initial_retention_local_target_bytes_default`. |

```bash
rpk cluster config set cloud_storage_enabled true
rpk topic alter-config sqlserver.dbo.orders \
  --set redpanda.remote.write=true \
  --set redpanda.remote.read=true
```

### Cloud Topics (object-storage-native topics)

**Enterprise license required.** A newer topic type that uses object storage as
the *primary* backing store (local disk is only a write buffer).

| Topic property | Type | Default | Description |
|---|---|---|---|
| `redpanda.cloud_topic.enabled` | string | `null` | Enable Cloud Topic storage mode for the topic. |
| `redpanda.storage.mode` | string | — | More flexible alternative: `local`, `tiered`, `cloud`, `unset`. |

```bash
rpk topic create sqlserver.dbo.orders \
  --topic-config redpanda.cloud_topic.enabled=true
```

> Without a valid license, new Cloud Topics cannot be created and existing ones
> cannot be modified (including partition changes).

---

## License-expiration behavior (destination cluster)

| Feature | Behavior when the cluster license expires |
|---|---|
| Connect enterprise connector (`microsoft_sql_server_cdc`) | Enterprise connectors are blocked. |
| Iceberg Topics | Topics cannot be created/modified with `redpanda.iceberg.mode`. |
| Server-side Schema ID Validation | Topics with schema-validation settings cannot be created/modified; `enable_schema_id_validation` cannot be re-enabled. |
| Tiered Storage | Topics cannot be created/modified to enable Tiered Storage; cannot add partitions to Tiered-Storage topics. |
| Cloud Topics | New Cloud Topics cannot be created; existing ones cannot be modified. |

To check and (if needed) disable enterprise features on the cluster:

```bash
rpk cluster license info                          # shows "license violation" status
rpk cluster config set iceberg_enabled false      # disable Iceberg
rpk cluster config set enable_schema_id_validation none
rpk cluster config set cloud_storage_enabled false # disable Tiered Storage
```

Source: `docs/modules/get-started/pages/licensing/overview.adoc`,
`docs/modules/get-started/pages/licensing/disable-enterprise-features.adoc`.
