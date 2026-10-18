---
name: sql-federated-queries
description: >-
  Query Redpanda topics as SQL tables through Redpanda catalogs in Redpanda
  SQL on Redpanda Cloud BYOC, including the Iceberg history of Iceberg-enabled
  topics in the same query. Use when mapping a topic with CREATE TABLE
  default_redpanda_catalog=>name, choosing schema subject, error handling,
  struct mapping, or key and header decoding options, reading the redpanda
  metadata column, querying nested fields, querying live and Iceberg records
  together through a catalog linked with USING CATALOG, running REFRESH after a
  schema change, or inspecting catalogs with SHOW, DESCRIBE, and the
  catalog-metadata system tables. For SQL syntax, functions, data types, and
  GRANT syntax, see `/redpanda:sql`. For enabling, scaling, users, roles, and
  the access model, see `/redpanda:sql-admin-api`. For failing or slow
  queries, see `/redpanda:sql-debugging`.
---

# Redpanda SQL: Query Topics Through Catalogs

Redpanda SQL is the managed analytical SQL engine on Redpanda Cloud BYOC
(including BYOVPC) clusters. It reads Redpanda topics in place: each topic is
mapped to a SQL table through a **Redpanda catalog**, and its columns come from
the topic's schema in Schema Registry (Avro, Protobuf, or JSON). For
Iceberg-enabled topics, a Redpanda catalog that is linked to an **Iceberg
catalog** returns live records and the Iceberg-committed history in one result.

**Redpanda SQL is read-only.** `INSERT`, `UPDATE`, `DELETE`, and `COPY FROM` are
not available. Data enters through Redpanda topics; `CREATE TABLE` only maps a
topic to a table through a catalog and never creates a standalone table with a
user-defined schema.

Connect with `psql` or any PostgreSQL client using the connection details on
the **SQL** tab of the cluster's *How to connect* panel in the Cloud Console
(see `/redpanda:sql` for connection and authentication).

---

## What Redpanda Cloud sets up for you

When Redpanda SQL is enabled on a cluster:

- A Redpanda catalog named **`default_redpanda_catalog`** (in schema `public`)
  is created and points at the cluster. Map topics through it; you normally do
  not need `CREATE REDPANDA CATALOG`.
- If the cluster has an Iceberg REST catalog configured
  (`iceberg_catalog_type = rest`), Redpanda Cloud also creates a storage
  connection and an Iceberg catalog that match the cluster's REST catalog
  configuration, and links `default_redpanda_catalog` to that Iceberg catalog
  (`USING CATALOG`, with `pandaproxy_url` set).

You don't run `CREATE STORAGE`, `CREATE ICEBERG CATALOG`, or `ALTER REDPANDA
CATALOG ... USING CATALOG` yourself for this workflow. Leave these managed
objects as Redpanda Cloud configured them. To see what was created, run:

```sql
DESCRIBE REDPANDA CATALOG default_redpanda_catalog;   -- tables and topic mappings
SELECT name, iceberg_catalog FROM system.kafka_connections;   -- linked Iceberg catalog
SHOW ICEBERG CATALOGS;
```

Do not hardcode the managed Iceberg catalog or storage names; read them from
`system.kafka_connections.iceberg_catalog`, `SHOW ICEBERG CATALOGS`, or
`SHOW CATALOGS`.

---

## Quickstart

```sql
-- 1. Map a topic (its value schema must be registered in Schema Registry).
CREATE TABLE default_redpanda_catalog=>orders WITH (
  topic          = 'orders',
  schema_subject = 'orders-value'      -- optional; default is '<topic>-value'
);

-- 2. Query it like any table.
SELECT * FROM default_redpanda_catalog=>orders LIMIT 10;

SELECT customer_id, SUM(amount) AS total
FROM   default_redpanda_catalog=>orders
WHERE  status = 'completed'
GROUP  BY customer_id
ORDER  BY total DESC
LIMIT  10;

-- 3. Record metadata lives in the auto-added `redpanda` struct column.
SELECT (redpanda).partition, (redpanda)."offset", (redpanda).timestamp, order_id
FROM   default_redpanda_catalog=>orders
WHERE  (redpanda).timestamp >= now() - INTERVAL '1 hour';

-- 4. Nested fields (default struct_mapping_policy = 'COMPOUND').
SELECT order_id, (customer).name, (customer).region
FROM   default_redpanda_catalog=>orders
WHERE  (customer).region = 'EMEA';
```

If the topic is Iceberg-enabled and `default_redpanda_catalog` is linked to an
Iceberg catalog, the same `SELECT` returns live records plus Iceberg-committed
history with no overlap. Redpanda SQL plans the union; you don't write
`UNION ALL`. See [iceberg.md](references/iceberg.md).

---

## Catalog model

| Object | What it is | Statements |
|--------|------------|------------|
| Storage connection | Named object-storage credentials (`TYPE = S3 \| GCS`) that back an Iceberg catalog | `CREATE` / `ALTER` / `DROP STORAGE`, `DESCRIBE STORAGE` |
| Redpanda catalog | Connection to a Redpanda cluster (brokers + Schema Registry, optional HTTP Proxy) | `CREATE` / `ALTER` / `DROP REDPANDA CATALOG`, `DESCRIBE REDPANDA CATALOG` |
| Iceberg catalog | Connection to an Iceberg REST catalog; used only when linked to a Redpanda catalog | `CREATE` / `ALTER` / `DROP ICEBERG CATALOG`, `DESCRIBE ICEBERG CATALOG` |
| Table | A topic mapped as `catalog_name=>table_name` | `CREATE` / `ALTER` / `DROP TABLE`, `DESCRIBE TABLE`, `REFRESH` |

Catalogs live in a schema (`public` by default; qualify as `schema.catalog_name`
to use another). Querying an Iceberg catalog's tables on their own (outside a
linked Redpanda catalog) is not supported.

---

## Map a topic: `CREATE TABLE ... WITH (...)`

```sql
CREATE TABLE [IF NOT EXISTS] catalog_name=>table_name
WITH (option = 'value' [, ...]);
```

| Option | Default | Values / notes |
|--------|---------|----------------|
| `topic` | (required) | Redpanda topic to map |
| `schema_subject` | `<topic>-value` | Schema Registry subject for the value schema |
| `schema_lookup_policy` | `LATEST` | `LATEST` is the only supported value |
| `error_handling_policy` | `FAIL` | `FAIL` (raise an error), `FILL_NULL` (failed fields become NULL; raw bytes kept in `redpanda_raw`), `DROP_RECORD` (skip the record) |
| `struct_mapping_policy` | `COMPOUND` | `COMPOUND` (nested structures become typed fields, `(col).field`) or `JSON` (nested structures become JSON; required for recursive schemas) |
| `output_schema_message_full_name` | first message in the schema | Fully qualified Protobuf message for the value |
| `confluent_wire_protocol` | `'true'` | `'true'` / `'false'`: whether values carry the Schema Registry wire-format prefix. Only valid with `schema_lookup_policy = 'LATEST'` |
| `key_decode_mode` | `binary` | `binary`, `string`, `schema_latest`, `schema_id_prefix`. Fixed for the table's lifetime |
| `key_schema_subject` | `<topic>-key` | Subject for the key schema |
| `key_schema_message_full_name` | first message in the schema | Fully qualified Protobuf message for the key |
| `key_confluent_wire_protocol` | `'false'` | Only valid with `key_decode_mode = 'schema_latest'` |
| `header_value_type` | `binary` | `binary` (`bytea`) or `string` (`text`). Fixed for the table's lifetime |

Full option semantics, examples, and decoding behavior:
[redpanda-catalogs.md](references/redpanda-catalogs.md).

### Auto-added columns

Every mapped table gets two reserved struct columns (a topic schema cannot use
these names):

- `redpanda`: `partition` (int), `offset` (bigint), `timestamp` (timestamptz,
  nullable), `headers` (array of `{key text, value bytea}`), `key` (bytea by
  default), `timestamp_type` (int: `0` CreateTime, `1` LogAppendTime).
- `redpanda_raw`: `key` and `value` bytea, populated only when
  `error_handling_policy = 'FILL_NULL'` and a record fails to decode.

### Change or remove a mapping

```sql
ALTER TABLE default_redpanda_catalog=>orders WITH (error_handling_policy = 'FILL_NULL');
DROP TABLE IF EXISTS default_redpanda_catalog=>orders;   -- the topic is not deleted
```

`ALTER TABLE` cannot change `key_decode_mode` or `header_value_type`; drop and
recreate the table instead.

### After a schema change: `REFRESH`

After any shape change to a topic's schema or its Iceberg table, run
`REFRESH default_redpanda_catalog=>orders;` to update the schema view used for
planning. Without it, a linked query fails with
`Schema not found for Iceberg table '<table>'`. `REFRESH` updates only the
schema view, not data.

---

## Inspect catalogs and tables

```sql
SHOW CATALOGS;                         -- also: SHOW REDPANDA CATALOGS, SHOW ICEBERG CATALOGS
SHOW REDPANDA TABLES default_redpanda_catalog;
SHOW TABLES FROM default_redpanda_catalog;   -- unqualified SHOW TABLES is an error
DESCRIBE TABLE default_redpanda_catalog=>orders;   -- columns, including decoded key type
DESCRIBE REDPANDA CATALOG default_redpanda_catalog;

SELECT name, topic_name, subject_name, error_handling_policy
FROM   system.kafka_sources
WHERE  connection_name = 'default_redpanda_catalog';
```

`SHOW KAFKA CATALOGS` / `SHOW KAFKA TABLES` are synonyms for the `REDPANDA`
forms. These statements and the catalog system tables only show objects in
schemas where you have `USAGE`. Column reference for `system.catalogs`,
`system.kafka_connections`, `system.kafka_sources`, `system.iceberg_catalogs`,
and `system.iceberg_tables`:
[files-and-system-tables.md](references/files-and-system-tables.md).

---

## Access

A *SQL: Manage* user can read every topic and create catalogs and tables. A
*SQL: Access* user can query a topic only after a *SQL: Manage* user grants it,
for example
`GRANT SELECT ON EXTERNAL SOURCE default_redpanda_catalog => 'orders' TO "alice@example.com";`.
Creating a catalog or storage connection as a non-superuser needs `CREATE` on
the schema. `GRANT` / `REVOKE` syntax: `/redpanda:sql`. Roles, the access
model, and authentication: `/redpanda:sql-admin-api`.

---

## Producing the data (Iceberg Topics)

The Iceberg history that a linked catalog reads is written by Redpanda's
Iceberg Topics on the cluster. Redpanda SQL's Iceberg queries require
`iceberg_catalog_type = rest` (the `object_storage` catalog type is not
supported for Redpanda SQL queries), `iceberg_enabled = true`, and a topic
`redpanda.iceberg.mode` with a registered schema. The topic's Iceberg mode also
decides which `key_decode_mode` / `header_value_type` the SQL table must use.
See [redpanda-iceberg-source-config.md](references/redpanda-iceberg-source-config.md).

---

## Reference Directory

- [redpanda-catalogs.md](references/redpanda-catalogs.md): `CREATE` / `ALTER` /
  `DROP REDPANDA CATALOG` and their options, `CREATE` / `ALTER` / `DROP TABLE`
  with every option, value decoding, key and header decoding, the `redpanda`
  and `redpanda_raw` columns, nested fields with `COMPOUND` versus `JSON`,
  recursive schemas, and type notes.
- [iceberg.md](references/iceberg.md): Querying Iceberg-enabled topics through
  a linked Redpanda catalog: what Redpanda Cloud configures, `REFRESH`, schema
  differences between topic and Iceberg table, key and header mode matching,
  Iceberg type limitations, and the `CREATE` / `ALTER` / `DROP ICEBERG
  CATALOG` and `CREATE` / `ALTER` / `DROP STORAGE` syntax and options.
- [files-and-system-tables.md](references/files-and-system-tables.md): The
  catalog-metadata system tables (`system.catalogs`, `system.kafka_connections`,
  `system.kafka_sources`, `system.iceberg_catalogs`, `system.iceberg_tables`),
  `SHOW` / `DESCRIBE` forms, and exporting query results with `COPY TO`.
- [redpanda-iceberg-source-config.md](references/redpanda-iceberg-source-config.md):
  The Iceberg Topics cluster and topic properties a BYOC user sets so Redpanda
  SQL can query Iceberg history, REST catalog connection and secrets, Iceberg
  modes and key/value/header translation, and Server-Side Schema ID Validation.
