# Iceberg Topics (Enterprise)

**Requires an Enterprise license.** When the license expires, topics cannot be created or modified with the `redpanda.iceberg.mode` property (existing tables keep working). Iceberg also requires **Tiered Storage** to be enabled on the topics for which you generate Iceberg tables. On Redpanda Cloud, Iceberg is supported only on BYOC/BYOVPC clusters running v25.1+.

## What It Does

The Apache Iceberg integration writes a topic's records into the open Iceberg table format (Parquet data files + JSON manifests) in object storage, in addition to the Tiered Storage log segments. This makes streaming data directly queryable by data-lakehouse engines (Snowflake, Databricks, ClickHouse, Redshift, Spark, Flink) without separate ETL. Redpanda supports Iceberg **table format version 2**.

## Enabling the Integration

Two levels of configuration are required: a cluster property to turn the feature on, and a per-topic property to choose the mode.

### 1. Cluster property: `iceberg_enabled`

```bash
rpk cluster config set iceberg_enabled true
# Changing this on a running cluster requires a cluster restart.
```

Related cluster properties (defaults for the per-topic properties below):

| Cluster property | Purpose |
|---|---|
| `iceberg_enabled` | Master switch for the Iceberg integration. Default `false`. |
| `iceberg_default_catalog_namespace` | Namespace Redpanda creates tables in. Default `redpanda`. Set this when multiple clusters write to one catalog (e.g. AWS Glue) to avoid table-name collisions. **Cannot be changed after enabling Iceberg topics.** Set as a list, e.g. `'["my-namespace"]'`. |
| `iceberg_delete` | Cluster default for the `redpanda.iceberg.delete` topic property. Default `true`. |
| `iceberg_invalid_record_action` | Cluster default for `redpanda.iceberg.invalid.record.action`. |
| `iceberg_default_partition_spec` | Cluster default for `redpanda.iceberg.partition.spec`. Default `(hour(redpanda.timestamp))`. |
| `iceberg_target_lag_ms` | Cluster default for `redpanda.iceberg.target.lag.ms`. Default `1 minute` (60000 ms). |

### 2. Per-topic property: `redpanda.iceberg.mode`

```bash
rpk topic alter-config my-topic --set redpanda.iceberg.mode=value_schema_id_prefix
```

## Nested Topic Properties

All keys below are set with `rpk topic create -c <key>=<value>` or `rpk topic alter-config <topic> --set <key>=<value>`.

### `redpanda.iceberg.mode`

Enables the integration for a topic and chooses the table layout. Type `string`. Default `null` (disabled).

| Mode | Behavior |
|---|---|
| `key_value` | Two-column table: one column for record metadata (including key), one binary column for the value. No schema required. |
| `value_schema_id_prefix` | Table structure matches the topic's registered schema, one column per field. Requires a registered schema; producers must write with the Schema Registry wire format (magic byte + schema ID prefix). |
| `value_schema_latest` | Table structure matches the latest schema registered for the subject in the Schema Registry. |
| `disabled` (default) | No Iceberg table is written for this topic. |

For `value_schema_id_prefix` / `value_schema_latest`, register a schema first:

```bash
rpk registry schema create my-topic-value --schema ./schema.avsc --type avro
```

### `redpanda.iceberg.delete`

Type `boolean`. Default `true` (inherited from `iceberg_delete`). When `true`, deleting the Redpanda topic also deletes its Iceberg table. Set to `false` to keep the Iceberg table after topic deletion. The DLQ table (`<topic-name>~dlq`) follows the same rule.

### `redpanda.iceberg.invalid.record.action`

Type `string` (enum). Accepted values: `drop`, `dlq_table`. Default `dlq_table`. Controls what happens to records that cannot be translated to the table schema (e.g., records that fail schema validation):
- `drop`: discard invalid records.
- `dlq_table`: write invalid records to a dead-letter-queue table named `<topic-name>~dlq`.

### `redpanda.iceberg.partition.spec`

Type `string`. Default `(hour(redpanda.timestamp))` (inherited from `iceberg_default_partition_spec`). The Iceberg partitioning specification for the table. Uses Iceberg partition transforms over columns, including the synthetic `redpanda.timestamp` column. Example custom spec:

```bash
rpk topic alter-config my-topic \
  --set "redpanda.iceberg.partition.spec=(day(redpanda.timestamp), user_id)"
```

### `redpanda.iceberg.target.lag.ms`

Type `integer` (milliseconds). Default `60000` (1 minute, inherited from `iceberg_target_lag_ms`). Controls how often the Iceberg table is refreshed with new topic data. Redpanda attempts to commit all produced data within this lag target, subject to resource availability. Lower values = fresher table, more frequent commits (more small files); higher values = fewer, larger commits.

```bash
rpk topic alter-config my-topic --set redpanda.iceberg.target.lag.ms=300000
```

## Catalog Integration

Iceberg supports two catalog types (configured via cluster properties under `iceberg_catalog_*`):
- **Object-storage catalog**: catalog files live in the same bucket/container as the data files.
- **REST catalog**: Redpanda updates an externally managed Iceberg REST catalog endpoint (e.g., AWS Glue, Databricks Unity, GCP BigLake, Snowflake).

See the manage/iceberg docs for catalog-specific setup (`use-iceberg-catalogs`, `iceberg-topics-aws-glue`, etc.).

## Schema Evolution

Redpanda follows the Iceberg schema-evolution spec: reordering fields and promoting field types are permitted. When you update a subject's schema in the Schema Registry, Redpanda automatically evolves the Iceberg table schema (e.g., adding a new nullable column). JSON schemas are supported in v25.2+.

## Data Retention

- Kafka consumers read the topic per its normal retention policy (`retention.ms` / Tiered Storage).
- Data written to Iceberg remains queryable as a table **indefinitely** unless you delete the topic (with `redpanda.iceberg.delete=true`), delete rows via a query engine, or disable the integration and remove the Parquet files.

## Limitations

- Cannot append topic data to a pre-existing Iceberg table that Redpanda did not create.
- Enabling Iceberg on an existing topic does **not** backfill the table with prior topic data.
- Data layer currently supports the Parquet file format only.
