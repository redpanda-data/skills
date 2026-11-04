Source: cloud-docs `modules/sql/pages/query-data/query-iceberg-topics.adoc`, `modules/manage/pages/iceberg/{about-iceberg-topics,iceberg-troubleshooting}.adoc` (single-sourced, Cloud rendering), `modules/reference/pages/properties/{cluster-properties,topic-properties}.adoc` (Cloud-tagged entries), `modules/manage/pages/monitor-cloud.adoc`, `modules/reference/pages/sql/system-virtual-tables.adoc` (verified 2026-10-18). File-by-file mapping in [SOURCES.md](SOURCES.md).

# Debugging Queries over Iceberg-enabled Topics

On a Redpanda Cloud BYOC cluster (AWS or GCP) with an Iceberg REST catalog
configured, a table mapped from an Iceberg-enabled topic returns both the live
records still in the topic and the Iceberg-committed history that has aged out of
topic retention, in one result with no overlap. When that history is stale, rows are
missing, or the query fails to plan, the cause is usually one of three things: the
cluster's Iceberg configuration, the topic's `redpanda.iceberg.*` properties, or
drift between the topic's schema and the Iceberg table.

---

## How the pieces connect

When Redpanda SQL is enabled on a BYOC cluster with the Iceberg REST catalog
configured, Redpanda Cloud creates the storage connection and Iceberg catalog for
you and links `default_redpanda_catalog` to that Iceberg catalog. You map the topic
once with `CREATE TABLE default_redpanda_catalog=><table> WITH (topic = ...,
schema_subject = ...)`; Redpanda SQL plans the union of live and Iceberg data
internally.

```sql
-- Is the Redpanda catalog linked to an Iceberg catalog?
DESCRIBE REDPANDA CATALOG default_redpanda_catalog;

-- Same, as a table (iceberg_catalog is NULL if there is no link,
-- or if you lack CONNECT/USAGE on the linked catalog's database and schema)
SELECT name, iceberg_catalog FROM system.kafka_connections;

SHOW ICEBERG CATALOGS;
```

Requirements to check first:

- **REST catalog.** The cluster property `iceberg_catalog_type` must be `rest`. The
  `object_storage` catalog type does not support Iceberg queries from Redpanda SQL.
  `iceberg_rest_catalog_endpoint` must be set at the same time.
- **Iceberg enabled.** The cluster property `iceberg_enabled` must be `true`, and the
  topic must set `redpanda.iceberg.mode` to a mode other than `disabled`.
- **Schema.** The topic needs a Protobuf, Avro, or JSON schema registered in Schema
  Registry.
- **No backfill.** Enabling Iceberg on an existing topic does not backfill the
  Iceberg table with earlier topic data. Records that aged out of retention before
  Iceberg was enabled are not in the history.

---

## Planning errors from Redpanda SQL

| Error or symptom | Cause | Fix |
|---|---|---|
| `Schema not found for Iceberg table '<table>'` | The Iceberg table or topic schema changed shape and the SQL schema view is out of date. | `REFRESH <catalog>=><table>`. It updates the schema view only, not data; you do not run it between writes. |
| `Kafka schema must be a name-superset of Iceberg schema` | The Iceberg table has a column the topic schema no longer has (a field was removed from the value subject). Iceberg tables only widen. | Re-add the column to the topic's Schema Registry subject so the topic schema covers every Iceberg column. |
| Same superset error on a topic whose mode nests value fields (`value:layout=nested`) | Redpanda SQL exposes value fields as top-level columns, so the Iceberg `value` struct has no counterpart. | Not supported. Use a flat value layout for topics queried from SQL. |
| Type mismatch at planning time on `(redpanda).key` or headers | The table's `key_decode_mode` / `header_value_type` does not match how the topic's `redpanda.iceberg.mode` encodes keys and headers. | Match them (table below), then drop and recreate the table. Both options are fixed for the table's lifetime. |
| `CREATE TABLE` or `REFRESH` fails on a nested collection | A `list` whose element is a `list` or a `map` is not supported in the Iceberg schema. | Change the schema; lists of primitives and lists of structs work. |
| `NULL` in a column on older rows | The column was added to the topic schema after those rows were committed to Iceberg. | Expected. |
| Arithmetic or aggregate on a `numeric` column fails | Iceberg `decimal(p, s)` maps to `numeric(p, s)`, and some `numeric` operations are not supported yet. | Cast or avoid those operations. |
| UUID column needs text functions | UUID columns read as `uuid`. | Cast explicitly: `id::text`. |

Key and header options to match the topic's Iceberg mode:

| Topic `redpanda.iceberg.mode` | `CREATE TABLE` options |
|---|---|
| `value_schema_id_prefix` | Omit the key options; the key stays `bytea`. |
| `key:mode=schema_id_prefix;value:mode=schema_id_prefix` | `key_decode_mode = 'schema_id_prefix'` |
| `key:mode=string;value:mode=schema_id_prefix` | `key_decode_mode = 'string'` |
| `headers:value_type=string;value:mode=schema_id_prefix` | `header_value_type = 'string'` |

---

## Stale history and missing rows

| Symptom | Likely cause | Where to look |
|---|---|---|
| Newest records appear live but not yet in history | Redpanda commits topic data to Iceberg on a lag target. | Topic `redpanda.iceberg.target.lag.ms` (cluster default: `iceberg_target_lag_ms`). Redpanda commits within the target subject to resource availability. |
| History never appears for a topic | `iceberg_enabled` is not `true`, `redpanda.iceberg.mode` is `disabled`, or `iceberg_catalog_type` is not `rest`. | Cluster and topic configuration. |
| Records present in the topic are missing from history | Records failed translation and went to the DLQ table, or were dropped. | `redpanda.iceberg.invalid.record.action` (`dlq_table` or `drop`; cluster default `iceberg_invalid_record_action`) and the DLQ table. |
| History disappeared after a topic was deleted | `redpanda.iceberg.delete` (cluster default `iceberg_delete`) deletes the Iceberg table with the topic. | Set `redpanda.iceberg.delete=false` before deleting a topic whose history you need. |
| Catalog commits failing | REST catalog connectivity or permissions. | `iceberg_rest_catalog_*` settings and the `redpanda_iceberg_rest_client_num_commit_table_update_requests_failed` metric. |

### Dead-letter queue

In the `value_schema_id_prefix` and `value_schema_latest` modes, a record that cannot
be translated is written to a DLQ Iceberg table named after the topic plus the
`iceberg_dlq_table_suffix` cluster property (`<topic-name>~dlq` in the published
examples). Causes:

- The embedded schema ID is not found in Schema Registry.
- A schema data type cannot be translated to an Iceberg type.
- In `value_schema_id_prefix` mode, the producer did not use the Schema Registry
  wire format (magic byte plus schema ID).

The DLQ table uses the `key_value` layout: one column for record metadata including
the key, one binary column for the value. Query it with an Iceberg-compatible engine
against your REST catalog. Topic property misconfiguration (for example, overriding
`value_schema_latest` without the fully qualified Protobuf message name) does not
send records to the DLQ; translation pauses until the configuration is fixed.

### Redpanda Iceberg metrics

These are Redpanda broker metrics, available from the cluster's OpenMetrics endpoint
(*Prometheus* tab of the *How to connect* panel on the cluster overview):

- `redpanda_iceberg_translation_dlq_files_created`: DLQ Parquet files created. A
  non-zero, increasing value means records are failing translation.
- `redpanda_iceberg_translation_invalid_records`: invalid records encountered,
  labeled by cause.
- `redpanda_iceberg_rest_client_num_commit_table_update_requests_failed`: failed
  table commits to the REST catalog; persistent failures indicate connectivity or
  permission problems.

---

## Properties a BYOC user can set

Defaults are shown in the Cloud Console; read them there rather than assuming them.
Set cluster properties with `rpk cluster config set` (after `rpk profile create
--from-cloud <cluster-id>`) or the Cloud API `PATCH /v1/clusters/{id}` with
`cluster_configuration.custom_properties`. Set topic properties with `rpk topic
alter-config <topic> --set <property>=<value>` or in the Cloud Console.

### Topic properties

| Property | Purpose |
|---|---|
| `redpanda.iceberg.mode` | Enables Iceberg for the topic and controls translation: `disabled`, `key_value`, `value_schema_id_prefix`, `value_schema_latest`, or the section-based syntax (`key:...;value:...;headers:...`). |
| `redpanda.iceberg.target.lag.ms` | How often new topic data is committed to the Iceberg table, in milliseconds. |
| `redpanda.iceberg.invalid.record.action` | `dlq_table` or `drop` for records that fail translation. |
| `redpanda.iceberg.delete` | Whether the Iceberg table is deleted when the topic is deleted. |
| `redpanda.iceberg.partition.spec` | Iceberg partition spec for the table. |

### Cluster properties (BYOC)

| Property | Purpose |
|---|---|
| `iceberg_enabled` | Enables Iceberg translation on the cluster. Requires a restart. |
| `iceberg_catalog_type` | `rest` or `object_storage`. Must be `rest` for Redpanda SQL. Requires a restart. |
| `iceberg_default_catalog_namespace` | Namespace for created tables (`redpanda` unless set). Clusters sharing a catalog need distinct namespaces. Cannot be changed after Iceberg is enabled. |
| `iceberg_target_lag_ms` | Cluster default for `redpanda.iceberg.target.lag.ms`. |
| `iceberg_invalid_record_action` | Cluster default for `redpanda.iceberg.invalid.record.action`. |
| `iceberg_delete` | Cluster default for `redpanda.iceberg.delete`. |
| `iceberg_default_partition_spec` | Cluster default for `redpanda.iceberg.partition.spec`. |
| `iceberg_dlq_table_suffix` | Suffix for DLQ table names. Do not change it after DLQ tables exist. |
| `iceberg_rest_catalog_endpoint` | REST catalog URL. Set together with `iceberg_catalog_type=rest`. |
| `iceberg_rest_catalog_authentication_mode` | `none`, `bearer`, `oauth2`, `aws_sigv4`, or `gcp`. |
| `iceberg_rest_catalog_oauth2_server_uri`, `iceberg_rest_catalog_client_id`, `iceberg_rest_catalog_client_secret`, `iceberg_rest_catalog_oauth2_scope` | `oauth2` mode credentials. |
| `iceberg_rest_catalog_token` | `bearer` mode token (used as is; not refreshed). |
| `iceberg_rest_catalog_warehouse` | Catalog warehouse name. |
| `iceberg_rest_catalog_trust`, `iceberg_rest_catalog_crl` | Trusted certificate chain and revocation list contents for the REST catalog. |
| `iceberg_rest_catalog_request_timeout_ms` | REST catalog request timeout. |

Full descriptions: [Cluster properties](https://docs.redpanda.com/cloud-data-platform/reference/properties/cluster-properties/)
and [Topic properties](https://docs.redpanda.com/cloud-data-platform/reference/properties/topic-properties/).
REST catalog provider setup: [Integrate with REST catalogs](https://docs.redpanda.com/cloud-data-platform/manage/iceberg/rest-catalog/).

---

## Cross-references

- Mapping options (`key_decode_mode`, `header_value_type`, ...) and catalog metadata
  tables: `/redpanda:sql-federated-queries`.
- Topic mapping and deserialization errors on the live side:
  [troubleshooting.md](troubleshooting.md) Playbook 5.
