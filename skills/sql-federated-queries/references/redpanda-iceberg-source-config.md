Source: cloud-docs `modules/manage/pages/iceberg/{about-iceberg-topics,use-iceberg-catalogs,specify-iceberg-schema}.adoc` and `rest-catalog/index.adoc`, `modules/manage/pages/schema-reg/schema-id-validation.adoc`, `modules/reference/pages/properties/{cluster-properties,topic-properties}.adoc` (Cloud views of the single-sourced docs pages and property partials), `modules/sql/pages/query-data/query-iceberg-topics.adoc`; verified 2026-10-18. File-by-file mapping in [SOURCES.md](SOURCES.md).

# Iceberg Topics Settings for Redpanda SQL (Redpanda Cloud BYOC)

Redpanda SQL reads the Iceberg history of a topic only if the cluster writes
that history. This file lists the Iceberg Topics settings a BYOC (or BYOVPC)
user sets so that Redpanda SQL can query live and Iceberg records together.
The Iceberg integration is available on BYOC and BYOVPC clusters only.

Defaults and editability for each property are shown in the Cloud Console and
on the Cloud
[cluster](https://docs.redpanda.com/cloud-data-platform/reference/properties/cluster-properties/)
and
[topic](https://docs.redpanda.com/cloud-data-platform/reference/properties/topic-properties/)
property references; check there instead of assuming a value.

## How to set properties

Cluster properties: `rpk` against the Cloud cluster, or the Control Plane API
(`PATCH /v1/clusters/{id}` with `cluster_configuration.custom_properties`,
which returns a long-running operation). Topic properties: `rpk topic`, the
Kafka API, or the Cloud Console.

```bash
rpk cloud login
rpk profile create --from-cloud <cluster-id>
rpk cluster config set iceberg_enabled true
```

---

## What Redpanda SQL requires

| Requirement | Setting |
|-------------|---------|
| Iceberg Topics on | Cluster `iceberg_enabled = true` |
| A REST catalog (the `object_storage` catalog type is not supported for SQL queries) | Cluster `iceberg_catalog_type = rest`, set together with `iceberg_rest_catalog_endpoint` |
| The topic writes an Iceberg table with typed columns | Topic `redpanda.iceberg.mode` (for example `value_schema_id_prefix`) plus a schema registered for the topic |
| Matching key/header decode in SQL | Topic mode sections must match the table's `key_decode_mode` / `header_value_type` (see [iceberg.md](iceberg.md#match-the-key-and-header-options-to-the-topics-iceberg-mode)) |

When Redpanda SQL is enabled on a cluster that already has the REST catalog
configured, Redpanda Cloud creates and links the SQL-side storage connection
and Iceberg catalog from this configuration.

---

## Cluster properties

### Iceberg integration

| Property | Notes |
|----------|-------|
| `iceberg_enabled` | Turns on topic-to-Iceberg translation for the cluster; each topic also needs `redpanda.iceberg.mode`. Requires a restart |
| `iceberg_catalog_type` | `rest` or `object_storage`. Use `rest` for Redpanda SQL. Requires a restart |
| `iceberg_default_catalog_namespace` | Namespace (array of strings, nested allowed) for Redpanda's Iceberg tables. Set before or together with `iceberg_enabled`, never change afterward. Clusters sharing one catalog (for example AWS Glue) each need a distinct namespace |
| `iceberg_default_partition_spec` | Default for `redpanda.iceberg.partition.spec` |
| `iceberg_delete` | Default for `redpanda.iceberg.delete` |
| `iceberg_invalid_record_action` | Default for `redpanda.iceberg.invalid.record.action`: `drop` or `dlq_table` |
| `iceberg_target_lag_ms` | Default for `redpanda.iceberg.target.lag.ms` (milliseconds) |
| `iceberg_dlq_table_suffix` | Suffix for dead-letter tables; pick one your catalog accepts (some don't allow `~`). Don't change after DLQ tables exist |
| `iceberg_topic_name_dot_replacement` | Replacement for dots in topic names when naming tables; must not contain dots. Don't change after creating dotted Iceberg topics |
| `iceberg_disable_snapshot_tagging` | Disables snapshot tags; not recommended (tags protect exactly-once delivery). Only for catalogs without tag support |

### REST catalog connection

| Property | Notes |
|----------|-------|
| `iceberg_rest_catalog_endpoint` | REST catalog URL; set at the same time as `iceberg_catalog_type = rest` |
| `iceberg_rest_catalog_authentication_mode` | `none`, `bearer`, `oauth2`, `aws_sigv4`, or `gcp`. `oauth2` is generally recommended; AWS Glue requires `aws_sigv4` |
| `iceberg_rest_catalog_oauth2_server_uri` | OAuth token endpoint (`oauth2`) |
| `iceberg_rest_catalog_client_id`, `iceberg_rest_catalog_client_secret` | OAuth client credentials (`oauth2`) |
| `iceberg_rest_catalog_oauth2_scope` | OAuth scope (`oauth2`) |
| `iceberg_rest_catalog_token` | Bearer token (`bearer`); used as-is with no refresh, so only for ad hoc or testing use |
| `iceberg_rest_catalog_aws_region`, `iceberg_rest_catalog_aws_access_key`, `iceberg_rest_catalog_aws_secret_key`, `iceberg_rest_catalog_credentials_source` | SigV4 settings (`aws_sigv4`); each falls back to the cluster's cloud-storage credentials when unset |
| `iceberg_rest_catalog_gcp_user_project` | GCP project billed for REST catalog requests |
| `iceberg_rest_catalog_warehouse` | Warehouse; Redpanda reads warehouse-specific config such as the prefix from the catalog |
| `iceberg_rest_catalog_base_location` | Base URI for tables; some catalogs (for example AWS Glue) require it. Don't change after enabling Iceberg |
| `iceberg_rest_catalog_trust`, `iceberg_rest_catalog_crl` | CA chain and CRL contents for catalogs with self-signed certificates |
| `iceberg_rest_catalog_request_timeout_ms` | REST request timeout (milliseconds) |

Per-provider steps (AWS Glue, Databricks Unity, GCP Lakehouse, Snowflake Open
Catalog):
[Integrate with REST Catalogs](https://docs.redpanda.com/cloud-data-platform/manage/iceberg/rest-catalog/).

### Secrets for catalog credentials

`iceberg_rest_catalog_client_secret`, `iceberg_rest_catalog_crl`,
`iceberg_rest_catalog_token`, and `iceberg_rest_catalog_trust` must be set from
secrets. On BYOVPC, secrets management must be enabled first, and egress to
the catalog endpoint must be allowed.

```bash
# Secret names: ^[A-Z][A-Z0-9_]*$
rpk security secret create --name ICEBERG_CLIENT_SECRET --value '<secret-value>' --scopes redpanda_cluster
rpk cluster config set iceberg_rest_catalog_client_secret '${secrets.ICEBERG_CLIENT_SECRET}'
```

Example REST configuration:

```yaml
iceberg_catalog_type: rest
iceberg_rest_catalog_endpoint: <catalog-endpoint>
iceberg_rest_catalog_authentication_mode: oauth2
iceberg_rest_catalog_oauth2_server_uri: <oauth-server-uri>
iceberg_rest_catalog_client_id: <client-id>
iceberg_rest_catalog_client_secret: ${secrets.ICEBERG_CLIENT_SECRET}
```

---

## Topic properties

| Property | Notes |
|----------|-------|
| `redpanda.iceberg.mode` | `disabled` (default), `key_value`, `value_schema_id_prefix`, `value_schema_latest`, or the section-based syntax below |
| `redpanda.iceberg.delete` | Whether the Iceberg table is deleted when the topic is deleted |
| `redpanda.iceberg.invalid.record.action` | `drop` or `dlq_table` (bad records go to a dead-letter table) |
| `redpanda.iceberg.partition.spec` | Iceberg partition spec expression, for example `(hour(redpanda.timestamp))` |
| `redpanda.iceberg.target.lag.ms` | How often the table is refreshed with new topic data (milliseconds) |
| `redpanda.schema.registry.context` | Schema Registry context used to resolve the topic's schemas |

```bash
rpk topic create orders --topic-config=redpanda.iceberg.mode=value_schema_id_prefix
rpk topic alter-config orders --set redpanda.iceberg.mode=value_schema_id_prefix
rpk registry schema create orders-value --schema orders.avsc --type avro
```

### Iceberg modes

| Mode | Table structure |
|------|-----------------|
| `key_value` | Record metadata (including the key) plus a binary `value` column; no schema required |
| `value_schema_id_prefix` | Columns from the record's schema; producers must use the Schema Registry wire format |
| `value_schema_latest` | Columns from the latest schema for the subject; producers must **not** use the wire-format prefix. Override with `value_schema_latest:subject=<subject>,protobuf_name=<full.Message.Name>` |
| `disabled` | No Iceberg table |

For Redpanda SQL, use a schema-backed mode so the Iceberg table has typed
columns that line up with the topic's schema.

### Key, value, and header translation

`redpanda.iceberg.mode` also accepts sections:
`<section>:<option>=<value>,...;<section>:<option>=<value>`, with sections
`key`, `value`, and `headers`.

- `key` / `value` options: `mode` (`binary` default, `schema_id_prefix`,
  `schema_latest`, `string`), `subject` and `protobuf_name` (with
  `schema_latest`), and `layout` (`flat` default or `nested`, value section
  only).
- `headers:value_type=string` stores header values as strings.

Redpanda SQL does not support `value:layout=nested`. Pair the topic mode with
the SQL table options, for example `key:mode=schema_id_prefix;value:mode=schema_id_prefix`
with `key_decode_mode = 'schema_id_prefix'` (full table in
[iceberg.md](iceberg.md#match-the-key-and-header-options-to-the-topics-iceberg-mode)).

### Retention and schema evolution

Iceberg data stays queryable after topic retention removes the records. The
table (and its dead-letter table, named with `iceberg_dlq_table_suffix`)
persists unless the topic is deleted with
`redpanda.iceberg.delete` true, data is deleted with a query engine, or the
integration is disabled and the Parquet files are removed. Enabling Iceberg on
an existing topic does not backfill. When the registered schema evolves,
Redpanda adds columns to the Iceberg table but does not drop them, which is why
Redpanda SQL requires the topic schema to remain a name-superset of the Iceberg
table (see [iceberg.md](iceberg.md#schema-differences-between-topic-and-iceberg-table)).

---

## Server-Side Schema ID Validation (optional)

Validation makes the broker drop records whose schema ID isn't registered
under the configured subject name strategy, so fewer undecodable records reach
Redpanda SQL's `error_handling_policy`. It checks only that the schema ID is
registered, not that the payload matches the schema.

- Cluster `enable_schema_id_validation`: `none` (disabled), `redpanda` (only
  `redpanda.*` topic properties accepted), or `compat` (both `redpanda.*` and
  `confluent.*` accepted). Validation decompresses batches on validated topics,
  which can raise CPU load.
- Topic `redpanda.key.schema.id.validation` / `redpanda.value.schema.id.validation`
  (`true` / `false`) and `redpanda.key.subject.name.strategy` /
  `redpanda.value.subject.name.strategy` (`TopicNameStrategy`,
  `RecordNameStrategy`, `TopicRecordNameStrategy`; `TopicNameStrategy` when
  unset). The `confluent.*` equivalents take strategy names prefixed with
  `io.confluent.kafka.serializers.subject.`.

```bash
rpk topic alter-config orders \
  --set redpanda.value.schema.id.validation=true \
  --set redpanda.value.subject.name.strategy=TopicNameStrategy
```

With `TopicNameStrategy` the value subject is `<topic>-value`, which is the
default `schema_subject` of a Redpanda SQL table. With another strategy, set
`schema_subject` on the SQL table to the subject the producers use.
