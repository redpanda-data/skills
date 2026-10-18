Source: cloud-docs `modules/reference/pages/sql/sql-statements/{create,alter,drop}-redpanda-catalog.adoc`, `{create,alter,drop}-table.adoc`, `modules/sql/pages/query-data/{redpanda-catalogs,query-streaming-topics,query-nested-fields}.adoc`, `modules/reference/partials/sql-managed-catalog-note.adoc`, `modules/reference/pages/sql/sql-data-types/{row,map,uuid,bytea,numeric-type/numeric}.adoc`; verified 2026-10-18. File-by-file mapping in [SOURCES.md](SOURCES.md).

# Redpanda Catalogs and Topic Tables

A Redpanda catalog is a named connection to a Redpanda cluster (brokers plus
Schema Registry, and optionally the HTTP Proxy). Topics are mapped into it as
tables addressed with `catalog_name=>table_name`. On Redpanda Cloud,
`default_redpanda_catalog` is created for you when Redpanda SQL is enabled, and
its connection to the cluster (including the internal credential it uses) is
provisioned automatically. Map topics through it.

Redpanda SQL is read-only: no `INSERT`, `UPDATE`, `DELETE`, or `COPY FROM`.

---

## CREATE REDPANDA CATALOG

You rarely need this on Redpanda Cloud; `default_redpanda_catalog` already
exists. The syntax is documented so you can understand and inspect what is
configured.

```sql
CREATE REDPANDA CATALOG [IF NOT EXISTS] catalog_name
  [USING CATALOG [schema.]iceberg_catalog_name]
  WITH (option = 'value' [, ...]);
```

- `USING CATALOG` links the catalog to an existing Iceberg catalog, so queries
  return live topic records plus Iceberg-committed records in one result. It
  comes **before** `WITH` on `CREATE`.
- Catalogs are created in the current schema (`public` by default); qualify as
  `schema.catalog_name` for another schema. A non-superuser needs `CREATE` on
  the schema.

| Option | Required | Description |
|--------|----------|-------------|
| `initial_brokers` | Yes | Bootstrap broker address(es) |
| `schema_registry_url` | Yes | Schema Registry URL; use `https://` for TLS |
| `sasl_mechanism` | No | `SCRAM-SHA-256` or `SCRAM-SHA-512` only |
| `sasl_user` | No | SASL username; also the basic-auth username for Schema Registry and the HTTP Proxy |
| `sasl_password` | No | SASL password; also the basic-auth password for Schema Registry and the HTTP Proxy |
| `truststore` | No | PEM CA certificate used to verify brokers, Schema Registry, and the HTTP Proxy |
| `key_store_key` | No | PEM client private key for mTLS to brokers; set with `key_store_cert` |
| `key_store_cert` | No | PEM client certificate for mTLS to brokers; set with `key_store_key` |
| `pandaproxy_url` | Conditional | HTTP Proxy base URL. **Required when the catalog has `USING CATALOG`**; used to fetch Iceberg translation state |

```sql
CREATE REDPANDA CATALOG production_redpanda_secure
WITH (
  initial_brokers     = 'broker1:9092',
  schema_registry_url = 'https://schema-registry:8081',
  sasl_mechanism      = 'SCRAM-SHA-256',
  sasl_user           = '<user>',
  sasl_password       = '<password>',
  truststore          = '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----'
);

CREATE REDPANDA CATALOG redpanda_with_iceberg
  USING CATALOG lakehouse_catalog
  WITH (
    initial_brokers     = 'broker1:9092',
    schema_registry_url = 'http://schema-registry:8081',
    pandaproxy_url      = 'http://redpanda:8082'
  );
```

## ALTER REDPANDA CATALOG

```sql
ALTER REDPANDA CATALOG [IF EXISTS] catalog_name
WITH (option = 'value' [, ...]);

ALTER REDPANDA CATALOG [IF EXISTS] catalog_name
USING CATALOG [schema.]iceberg_catalog_name
[WITH (option = 'value' [, ...])];

ALTER REDPANDA CATALOG [IF EXISTS] catalog_name
USING CATALOG NULL                       -- detach the Iceberg link
[WITH (option = 'value' [, ...])];
```

On the `ALTER` forms, `WITH` comes **after** `USING CATALOG`. Relink to a
different Iceberg catalog by running `USING CATALOG <other>` again.

On Redpanda Cloud, `default_redpanda_catalog` and its Iceberg link are managed
for you: do not alter, relink, detach, or drop them.

## DROP REDPANDA CATALOG

```sql
DROP TABLE production_redpanda=>user_events;      -- drop every table first
DROP REDPANDA CATALOG [IF EXISTS] production_redpanda;
```

---

## CREATE TABLE (map a topic)

```sql
CREATE TABLE [IF NOT EXISTS] catalog_name=>table_name
WITH (option = 'value' [, ...]);
```

The catalog must be a Redpanda catalog. Columns come from the topic's
registered schema: each top-level field becomes a column. The topic must have
a schema in Schema Registry (Avro, Protobuf, or JSON).

### Value options

| Option | Default | Notes |
|--------|---------|-------|
| `topic` | (required) | Topic to map |
| `schema_subject` | `<topic>-value` | Value subject (TopicNameStrategy default) |
| `schema_lookup_policy` | `LATEST` | `LATEST` is the only supported value |
| `error_handling_policy` | `FAIL` | `FAIL`: raise an error. `FILL_NULL`: failed fields become NULL and the raw bytes go to `redpanda_raw`. `DROP_RECORD`: skip the record |
| `struct_mapping_policy` | `COMPOUND` | `COMPOUND`: nested structures become user-defined types queried as `(col).field`; no cyclic types. `JSON`: nested structures become JSON values; required for recursive schemas |
| `output_schema_message_full_name` | first declared message | Fully qualified Protobuf message. Set it when records use a message other than the first declared one, or decoding fails with a message-type mismatch |
| `confluent_wire_protocol` | `'true'` | `'true'`: values carry the Schema Registry wire-format prefix (magic byte + 4-byte schema ID). `'false'`: raw Protobuf/Avro. Only valid with `schema_lookup_policy = 'LATEST'` |

### Key and header options

| Option | Default | Notes |
|--------|---------|-------|
| `key_decode_mode` | `binary` | `binary`: raw `bytea`. `string`: UTF-8 text (invalid bytes become `U+FFFD`). `schema_latest`: decode with the latest key schema. `schema_id_prefix`: decode with the schema ID in each key's wire-format header. Applies to live and Iceberg-committed records |
| `key_schema_subject` | `<topic>-key` | Key subject; override when the producer does not use TopicNameStrategy |
| `key_schema_message_full_name` | first declared message | Protobuf message for the key |
| `key_confluent_wire_protocol` | `'false'` | Only valid with `key_decode_mode = 'schema_latest'` (`schema_id_prefix` always needs the prefix) |
| `header_value_type` | `binary` | `binary` (`bytea`) or `string` (`text`, invalid bytes become `U+FFFD`). Header keys are always `text` |

`key_decode_mode` and `header_value_type` are **fixed for the table's
lifetime**; `ALTER TABLE` rejects a change. Drop and recreate the table to
change them. The key schema options take effect only with a schema key mode.

### Examples

```sql
-- Multi-message Protobuf schema
CREATE TABLE default_redpanda_catalog=>orders WITH (
  topic = 'orders',
  schema_subject = 'orders-value',
  output_schema_message_full_name = 'com.example.orders.Order'
);

-- Skip records that fail to deserialize
CREATE TABLE IF NOT EXISTS default_redpanda_catalog=>sensor_readings WITH (
  topic = 'sensor-data',
  schema_subject = 'sensor-data-value',
  error_handling_policy = 'DROP_RECORD'
);

-- Decode keys by embedded schema ID and header values as text
CREATE TABLE default_redpanda_catalog=>orders_keyed WITH (
  topic = 'orders',
  schema_subject = 'orders-value',
  key_decode_mode = 'schema_id_prefix',
  header_value_type = 'string'
);

SELECT ((redpanda).key).customer_id, (redpanda).headers
FROM   default_redpanda_catalog=>orders_keyed;
```

## ALTER TABLE and DROP TABLE

```sql
ALTER TABLE [IF EXISTS] catalog_name=>table_name WITH (option = 'value' [, ...]);
DROP TABLE [IF EXISTS] catalog_name=>table_name;   -- the topic itself is not deleted
```

```sql
ALTER TABLE default_redpanda_catalog=>sensor_readings
WITH (error_handling_policy = 'FILL_NULL');
```

## REFRESH

After a shape change to a topic's schema (or its Iceberg table), run
`REFRESH catalog_name=>table_name;` to update the schema view used for query
planning. It does not move data, and you don't run it between writes.
`REFRESH` rejects a schema whose declared type names start with `__redpanda_`,
and, for JSON schemas, a top-level property named `__json_root`.

---

## Auto-added columns

Every mapped table has two reserved struct columns. A topic schema cannot
define top-level fields named `redpanda` or `redpanda_raw`.

### `redpanda` (always present)

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `partition` | `int` | No | Partition the record was read from |
| `offset` | `bigint` | No | Offset within the partition |
| `timestamp` | `timestamp with time zone` | Yes | Record timestamp |
| `headers` | array of `{key text, value bytea}` | Yes | Record headers |
| `key` | `bytea` | Yes | Record key bytes |
| `timestamp_type` | `int` | Yes | `0` CreateTime, `1` LogAppendTime, `NULL` when unavailable |

With a schema key mode, `key` becomes a struct (`((redpanda).key).field`); with
`key_decode_mode = 'string'` it is `text`; with `header_value_type = 'string'`
each header `value` is `text`. A `NULL` key stays `NULL`; a key that fails to
decode follows `error_handling_policy`. `DESCRIBE TABLE catalog=>table` shows
the decoded key type. Key and value can use different schemas and formats, and
their field names can overlap.

```sql
SELECT order_id, (redpanda).partition, (redpanda)."offset", (redpanda).timestamp
FROM   default_redpanda_catalog=>orders
WHERE  (redpanda).partition = 0
ORDER  BY (redpanda)."offset" DESC
LIMIT  20;
```

Quote `"offset"` when you reference the field, because `OFFSET` is a SQL
keyword.

### `redpanda_raw` (dead-letter pattern)

`key` and `value` (`bytea`), populated only when
`error_handling_policy = 'FILL_NULL'` and a record fails to decode; otherwise
`NULL`. Rows that fail value deserialization stay queryable with the malformed
payload preserved:

```sql
SELECT (redpanda)."offset", (redpanda_raw).value
FROM   default_redpanda_catalog=>orders
WHERE  (redpanda_raw).value IS NOT NULL;
```

---

## Nested fields: COMPOUND versus JSON

With the default `struct_mapping_policy = 'COMPOUND'`, each nested message
becomes a typed field you access with parentheses:

```sql
SELECT order_id, (customer).name, (customer).region, amount
FROM   default_redpanda_catalog=>orders
WHERE  (customer).region = 'EMEA';

SELECT order_id, (customer).* FROM default_redpanda_catalog=>orders LIMIT 10;

SELECT ((customer).address).zip_code FROM default_redpanda_catalog=>orders;
```

`COMPOUND` does not support recursive (cyclic) schemas. Mapping one fails at
table-creation time with:

```text
Cyclic reference at '<parent>.<field>' → '<type>'. Cyclic types are not supported in COMPOUND struct mapping policy; use struct_mapping_policy=JSON for recursive types.
```

Recreate the table with `struct_mapping_policy = 'JSON'` and query the fields
with JSON functions (see `/redpanda:sql`).

| Policy | Use when | Trade-offs |
|--------|----------|------------|
| `COMPOUND` (default) | Nested, non-recursive schemas; you want typed access in `WHERE`, `GROUP BY`, `ORDER BY` | **Required** for queries that span a topic and its linked Iceberg table, so nested fields stay typed on both sides |
| `JSON` | Recursive schemas, or you prefer JSON-function access | Fields are untyped until extracted; live-plus-Iceberg queries don't align cleanly |

---

## Type notes

Columns take their types from the schema. Notable mappings documented for
topic-backed tables:

- Avro `decimal` maps to `numeric` with the same precision and scale; precision
  above 76 and Avro `big-decimal` are not supported. Some `numeric` operations
  (arithmetic, aggregates) are not supported yet.
- An Avro `uuid` logical type (on `string` or `fixed`) maps to `uuid`. Cast to
  text (`id::text`) before using string functions.
- Protobuf and Avro binary fields, and raw keys and values, surface as `bytea`.
- Avro and Protobuf map fields surface as `map` columns under `COMPOUND` (as
  JSON under `JSON`), read with `col['key']`. Duplicate keys are preserved.

Data types, `row` field access, `map`, JSON functions, and casts:
`/redpanda:sql`.
