Source: cloud-docs `modules/sql/pages/query-data/{query-iceberg-topics,redpanda-catalogs}.adoc`, `modules/reference/partials/sql-managed-catalog-note.adoc`, `modules/reference/pages/sql/sql-statements/{create,alter,drop}-iceberg-catalog.adoc`, `{create,alter,drop}-storage.adoc`, `{create,alter}-redpanda-catalog.adoc`, `create-table.adoc`, `describe.adoc`, `modules/reference/pages/sql/sql-data-types/{map,uuid,numeric-type/numeric}.adoc`; verified 2026-10-18. File-by-file mapping in [SOURCES.md](SOURCES.md).

# Query Iceberg-enabled Topics

With Iceberg Topics, a topic's records are also committed to an Apache Iceberg
table and persist after they age out of topic retention. Redpanda SQL queries
both through one table: a **Redpanda catalog linked to an Iceberg catalog**
(`USING CATALOG`) returns live topic records and Iceberg-committed history in
a single result, with no overlap. You don't write a `UNION ALL`.

This is the only supported way to read Iceberg data in Redpanda SQL. An Iceberg
catalog is used through a linked Redpanda catalog; querying an Iceberg
catalog's own tables standalone is not supported.

## Prerequisites

- A Redpanda BYOC cluster with Redpanda SQL enabled. Check the supported cloud
  providers on the
  [Query Iceberg-enabled Topics](https://docs.redpanda.com/cloud-data-platform/sql/query-data/query-iceberg-topics/)
  page.
- An external Iceberg REST catalog that you provide, with the cluster property
  `iceberg_catalog_type = rest`. The `object_storage` catalog type does not
  support Iceberg queries from Redpanda SQL.
- An Iceberg-enabled topic with a Protobuf, Avro, or JSON schema registered in
  Schema Registry. Cluster and topic settings:
  [redpanda-iceberg-source-config.md](redpanda-iceberg-source-config.md).

## What Redpanda Cloud configures

When Redpanda SQL is enabled on a BYOC cluster with an Iceberg REST catalog
configured, Redpanda Cloud runs the equivalent of these statements for you,
with options taken from the cluster's REST catalog configuration (endpoint,
credentials, region):

```sql
-- 1. Storage connection with the REST catalog's object-storage credentials
--    (TYPE = S3 on AWS; TYPE = GCS on GCP)
CREATE STORAGE <storage> TYPE = S3 WITH (
  endpoint = '<rest-catalog-storage-endpoint>',
  access_key_id = '<access-key-id>',
  secret_access_key = '<secret-access-key>',
  region = '<region>',
  path_style = 'true'
);

-- 2. Iceberg catalog pointing at the REST catalog
CREATE ICEBERG CATALOG <iceberg_catalog> STORAGE <storage> WITH (
  uri = '<rest-catalog-uri>',
  warehouse = '<warehouse>',
  auth_type = '<auth-type>'
);

-- 3. Link the default Redpanda catalog (pandaproxy_url is required when linked)
ALTER REDPANDA CATALOG default_redpanda_catalog
USING CATALOG <iceberg_catalog> WITH (pandaproxy_url = '<pandaproxy-url>');
```

You don't run these yourself, and you should not alter or drop the managed
storage connection, Iceberg catalog, or link. Inspect them instead:

```sql
DESCRIBE REDPANDA CATALOG default_redpanda_catalog;
SELECT name, iceberg_catalog FROM system.kafka_connections;
SHOW ICEBERG CATALOGS;
DESCRIBE ICEBERG CATALOG <iceberg_catalog>;   -- REST endpoint, warehouse, auth type
```

---

## Map and query

```sql
CREATE TABLE default_redpanda_catalog=>orders WITH (
  topic = 'orders',
  schema_subject = 'orders-value'
);

SELECT * FROM default_redpanda_catalog=>orders LIMIT 10;
```

The table gets the same `redpanda` and `redpanda_raw` metadata columns as any
topic table (see [redpanda-catalogs.md](redpanda-catalogs.md#auto-added-columns)).
Use `struct_mapping_policy = 'COMPOUND'` (the default) so nested fields stay
typed across live and Iceberg records; `JSON` does not align cleanly because
Iceberg always exposes nested structures as typed columns.

Iceberg-committed data persists independently of topic retention, so queries
keep returning records past the retention window, provided they were
committed to Iceberg first.

### REFRESH after a shape change

After any shape change to the Iceberg table or the topic's schema, run:

```sql
REFRESH default_redpanda_catalog=>orders;
```

Without it, the next query fails at planning time with
`Schema not found for Iceberg table '<table>'`. `REFRESH` updates only the
schema view used for planning, not data; you don't run it between writes.

---

## Match the key and header options to the topic's Iceberg mode

For an Iceberg-enabled topic, the table's key and header options must match how
the topic's `redpanda.iceberg.mode` encodes keys and headers into the Iceberg
table:

| Topic `redpanda.iceberg.mode` | `CREATE TABLE` options |
|-------------------------------|------------------------|
| `value_schema_id_prefix` | Omit the key options (the key stays `bytea`) |
| `key:mode=schema_id_prefix;value:mode=schema_id_prefix` | `key_decode_mode = 'schema_id_prefix'` |
| `key:mode=string;value:mode=schema_id_prefix` | `key_decode_mode = 'string'` |
| `headers:value_type=string;value:mode=schema_id_prefix` | `header_value_type = 'string'` |

A mismatch fails at planning time with a type mismatch rather than returning
wrong data. A topic whose mode nests value fields under a `value` struct
(`value:layout=nested`) is not supported: it fails with
`Kafka schema must be a name-superset of Iceberg schema`.

```sql
CREATE TABLE default_redpanda_catalog=>orders_keyed WITH (
  topic = 'orders',
  schema_subject = 'orders-value',
  key_decode_mode = 'schema_id_prefix',
  header_value_type = 'string'
);

SELECT ((redpanda).key).customer_id, (redpanda).headers
FROM   default_redpanda_catalog=>orders_keyed;
```

`key_decode_mode` and `header_value_type` are fixed for the table's lifetime;
drop and recreate the table to change them.

---

## Schema differences between topic and Iceberg table

Redpanda writes the Iceberg table forward-only: it adds columns when the topic
schema widens but never drops them when it narrows. Redpanda SQL treats the
topic's Schema Registry subject as canonical:

- Column order, count, and types come from the topic schema.
- A column the topic schema has but the Iceberg table lacks returns `NULL` on
  Iceberg-side rows (common right after adding a field).
- A column the Iceberg table has but the topic schema lacks fails the query at
  planning time with `Kafka schema must be a name-superset of Iceberg schema`.
  Fix it by re-adding the field to the topic's subject so the topic schema
  covers every Iceberg column.

## Iceberg type limitations

These apply only to columns read from the Iceberg schema, not to live-record
columns:

- Iceberg `decimal(p, s)` becomes `numeric(p, s)`; some `numeric` operations
  (arithmetic, aggregates) are not supported yet.
- A `list` whose element is a `list` or a `map` is not supported: `CREATE
  TABLE` or `REFRESH` fails. Lists of primitives, and lists of structs without
  unsupported types, work.
- `map` columns are read from both live records and Iceberg history.
- UUID columns read as `uuid`; cast with `id::text` before using string
  functions.

---

## Iceberg catalog statements

On Redpanda Cloud the Iceberg catalog for this workflow is created and managed
for you. The syntax is documented so you can understand what is configured.
Every form requires an existing storage connection.

```sql
CREATE ICEBERG CATALOG [IF NOT EXISTS] catalog_name STORAGE storage_name
  WITH (option = 'value' [, ...]);

ALTER ICEBERG CATALOG [IF EXISTS] catalog_name STORAGE storage_name  -- STORAGE is required
  WITH (option = 'value' [, ...]);

DROP ICEBERG CATALOG [IF EXISTS] catalog_name;   -- fails while a Redpanda catalog is linked to it
```

| Option | Required | Description |
|--------|----------|-------------|
| `uri` | Yes | REST catalog endpoint URI |
| `warehouse` | No | Warehouse identifier or location |
| `auth_type` | No | `oauth2`, `basic`, `aws_sigv4`, or `gcp`. Omit for no authentication. Auth-specific options without `auth_type` are rejected |
| `oauth2_client_id`, `oauth2_client_secret` | With `oauth2` | OAuth2 client credentials |
| `oauth2_scope` | No | OAuth2 scope to request |
| `oauth2_token_endpoint_url` | No | Override the catalog's default token endpoint |
| `oauth2_token_refresh_margin_seconds` | No | Seconds before expiry to refresh (0 to 2147483647) |
| `username`, `password` | With `basic` | Basic-auth credentials |
| `aws_region` | With `aws_sigv4` | Region for SigV4 signing |
| `aws_access_key_id`, `aws_secret_access_key` | No | Set together or omit both to use the AWS default credential chain |
| `gcp_project_id` | With `gcp` | Project that BigLake requests are billed to; authenticates with Application Default Credentials |
| `ssl_verify` | No | `'true'` (default) or `'false'` |
| `ssl_ca_info`, `ssl_ca_path`, `ssl_crl_file` | No | CA file, CA directory, and CRL file paths |
| `flat_namespaces` | No | `'true'` / `'false'`: whether the backend is flat. Auto-derived `true` for SigV4 Glue and S3 Tables, `false` otherwise |
| `allowed_namespaces` | No | Comma-separated dotted namespace paths that scope discovery (for example `'analytics, logs.audit'`). Empty or overlapping entries are rejected; on flat backends entries must be single-segment |

## Storage connection statements

```sql
CREATE STORAGE [IF NOT EXISTS] storage_name TYPE = S3 | GCS [WITH (option = 'value' [, ...])];
ALTER STORAGE [IF EXISTS] storage_name TYPE = S3 | GCS [WITH (option = 'value' [, ...])];  -- TYPE is required
DROP STORAGE [IF EXISTS] storage_name;
DESCRIBE STORAGE storage_name;
```

S3 options: `region` and/or `endpoint` (at least one), `access_key_id` and
`secret_access_key` (set together, or omit both for the AWS default credential
chain), `session_token`, `url` (`s3://<bucket>/<path>`), `path_style`
(default `false`), `use_http` (default `false`).

GCS options: `url` (`gs://<bucket>/<path>`), `service_account_key` (key JSON;
omit to use Application Default Credentials), `endpoint`.

A non-superuser needs `CREATE` on the schema to create a storage connection.
