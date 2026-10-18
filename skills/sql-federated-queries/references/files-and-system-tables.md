Source: cloud-docs `modules/reference/pages/sql/system-virtual-tables.adoc` (catalog-metadata tables), `modules/reference/pages/sql/sql-statements/{show-catalogs,show-tables,describe,copy-to}.adoc`, `modules/sql/pages/manage/manage-access.adoc`; verified 2026-10-18. File-by-file mapping in [SOURCES.md](SOURCES.md).

# Catalog Metadata Tables and Exports

This file covers how to inspect catalogs and mapped tables (`SHOW`,
`DESCRIBE`, and the catalog-metadata tables in the `system` schema) and how to
export query results with `COPY TO`.

Redpanda SQL is read-only: there is no `COPY FROM` and no loading of files into
tables. Data reaches Redpanda SQL only through Redpanda topics mapped through
catalogs.

The runtime tables `system.nodes`, `system.queries`, and `system.execs` are
superuser-only diagnostics; see `/redpanda:sql-debugging`.

---

## Visibility

Catalog-metadata tables, `SHOW CATALOGS`, and `SHOW ... TABLES` filter rows by
the caller's grants: you see only objects in schemas where you have `USAGE`
(granted with `GRANT USAGE ON SCHEMA public TO "<user>";`, see
`/redpanda:sql-admin-api`). All of these tables support `WHERE`, `ORDER BY`,
and `LIMIT`.

| Table | Equivalent statement |
|-------|----------------------|
| `system.catalogs` | `SHOW CATALOGS` |
| `system.iceberg_catalogs` | `SHOW ICEBERG CATALOGS` |
| `system.iceberg_tables` | `SHOW ICEBERG TABLES` |
| `system.kafka_connections` | `SHOW REDPANDA CATALOGS` (`SHOW KAFKA CATALOGS`) |
| `system.kafka_sources` | `SHOW REDPANDA TABLES` (`SHOW KAFKA TABLES`) |

---

## `system.catalogs`

All Redpanda and Iceberg catalogs visible to the caller.

| Column | Type | Description |
|--------|------|-------------|
| `name` | text | Catalog name |
| `namespace_name` | text | Schema containing the catalog |
| `type` | text | `REDPANDA` or `ICEBERG` |

```sql
SELECT * FROM system.catalogs;
```

## `system.kafka_connections`

Redpanda catalog connections, including any linked Iceberg catalog.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `database_name` | text | No | Database containing the connection |
| `namespace_name` | text | No | Schema containing the connection |
| `name` | text | No | Catalog name |
| `options` | text | No | Connection options as comma-separated `key: value` pairs (brokers, timeouts, Schema Registry endpoint, client settings; HTTP Proxy options when configured) |
| `iceberg_catalog` | text | Yes | Linked Iceberg catalog as `schema.name`; `NULL` if not linked, or if the caller lacks `CONNECT` on its database and `USAGE` on its schema |

```sql
SELECT name, iceberg_catalog FROM system.kafka_connections;
```

## `system.kafka_sources`

One row per `CREATE TABLE catalog=>name WITH (...)` mapping.

| Column | Type | Description |
|--------|------|-------------|
| `database_name` | text | Database containing the table |
| `namespace_name` | text | Schema containing the table |
| `name` | text | Table name |
| `connection_name` | text | Redpanda catalog the table belongs to |
| `topic_name` | text | Source topic |
| `subject_name` | text | Schema Registry subject; empty if not configured |
| `lookup_policy` | text | Schema lookup policy |
| `error_handling_policy` | text | Deserialization error-handling policy |
| `struct_mapping_policy` | text | Nested-struct mapping policy |
| `output_schema_full_message_name` | text | Protobuf message name; empty if not configured |

```sql
SELECT name, topic_name, subject_name
FROM   system.kafka_sources
WHERE  connection_name = 'default_redpanda_catalog';
```

## `system.iceberg_catalogs`

| Column | Type | Description |
|--------|------|-------------|
| `name` | text | Iceberg catalog name |
| `uri` | text | REST catalog endpoint URI |
| `warehouse` | text | Warehouse identifier or location |
| `auth_type` | text | `oauth2`, `basic`, `aws_sigv4`, `gcp`, or empty (no authentication) |
| `namespace_name` | text | Schema containing the catalog |
| `database_name` | text | Database containing the catalog |

```sql
SELECT name, uri, auth_type FROM system.iceberg_catalogs;
```

## `system.iceberg_tables`

Iceberg tables whose schema has been loaded into the local catalog (by
`REFRESH`, or automatically when the table is created). One row per root Iceberg table.

| Column | Type | Description |
|--------|------|-------------|
| `database_name` | text | Database containing the registration |
| `namespace_name` | text | Schema containing the registration |
| `catalog_name` | text | Iceberg catalog the table belongs to |
| `name` | text | Qualified Iceberg table path, for example `ns1.ns2.tbl` |
| `oid` | int | Object identifier of the table type; joinable with `pg_type.oid` |

Entries can be stale: a table dropped from the REST catalog stays listed until
its registration is dropped explicitly (the same holds for
`system.kafka_sources`).

```sql
SELECT catalog_name, name FROM system.iceberg_tables;
```

---

## SHOW and DESCRIBE

```sql
SHOW CATALOGS;
SHOW REDPANDA CATALOGS;            -- synonym: SHOW KAFKA CATALOGS
SHOW ICEBERG CATALOGS;

SHOW TABLES FROM default_redpanda_catalog;    -- catalog name required
SHOW REDPANDA TABLES [ [schema.]catalog_name ];   -- synonym: SHOW KAFKA TABLES
SHOW ICEBERG TABLES  [ [schema.]catalog_name ];

DESCRIBE TABLE default_redpanda_catalog=>orders;   -- columns and types
DESCRIBE REDPANDA CATALOG default_redpanda_catalog;  -- table and topic mappings
DESCRIBE ICEBERG CATALOG <iceberg_catalog>;   -- endpoint, warehouse, auth type, namespace scoping
DESCRIBE STORAGE <storage>;                   -- type, schema, parameters
```

The unqualified `SHOW TABLES` form is not supported and returns an error.
`DESCRIBE` requires `USAGE` on the schema that holds the object.

---

## Export results: COPY TO

`COPY TO` exports a query result as CSV to the client (`STDOUT`) or to cloud
storage. It does not import.

```sql
COPY { table_name [ ( column_name [, ...] ) ] | ( query ) }
TO { 'file_path' | STDOUT }
[ WITH ( option [, ...] ) ];
```

Options: `FORMAT` (only `CSV`), `DELIMITER` (single character, default `,`),
`HEADER` (`ON`/`TRUE`/`1` or `OFF`/`FALSE`/`0`, default `OFF`), `NULL`
(replacement string, default empty), and cloud credentials `AWS_CRED(...)` or
`GCS_CRED(...)`. An existing destination file is overwritten.

```sql
-- To the client
COPY (SELECT * FROM default_redpanda_catalog=>orders WHERE status = 'open') TO STDOUT;

-- To S3
COPY (SELECT * FROM default_redpanda_catalog=>orders) TO 's3://<bucket-name>/<file-name>'
WITH (AWS_CRED(AWS_REGION '<region>', AWS_KEY_ID '<aws-key-id>', AWS_PRIVATE_KEY '<access-key>',
               ENDPOINT '<s3-endpoint>'),
      FORMAT CSV, HEADER ON, NULL 'unknown');

-- To GCS with a service-account key (on a GCP cluster GCS_CRED can be omitted to use ADC)
COPY (SELECT * FROM default_redpanda_catalog=>orders) TO 'gs://<bucket-name>/<file-name>'
WITH (GCS_CRED('<credentials-json-contents>'));
```

`AWS_CRED` tokens: `AWS_REGION`, `AWS_KEY_ID`, `AWS_PRIVATE_KEY`, `ENDPOINT`.
`GCS_CRED` has no endpoint override; to reach GCS through its S3-compatible XML
API, use `AWS_CRED` with HMAC keys and `ENDPOINT 'https://storage.googleapis.com'`.
