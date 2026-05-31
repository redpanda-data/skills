---
name: sql-federated-queries
description: >-
  Query external data from Oxla — Kafka topics via catalogs, Apache Iceberg
  tables, and S3/GCS/Azure parquet/ORC files — alongside native Oxla tables.
  Use when: querying Kafka topics with CREATE KAFKA CATALOG or CREATE REDPANDA
  CATALOG; reading Apache Iceberg tables using the catalog=>path.table syntax;
  loading or exporting parquet/ORC files from S3/GCS/Azure (COPY FROM/TO);
  joining external data with native tables; or inspecting external metadata via
  system.kafka_connections, system.kafka_sources, system.iceberg_catalogs, and
  system.iceberg_tables. Also covers the Redpanda Enterprise features that
  produce the data Oxla reads — Iceberg Topics (redpanda.iceberg.mode and the
  redpanda.iceberg.* topic properties; iceberg_enabled and iceberg_rest_catalog_*
  cluster properties), Tiered Storage (cloud_storage_enabled), and Server-Side
  Schema ID Validation (enable_schema_id_validation, redpanda.value.schema.id.validation)
  — all of which require a Redpanda Enterprise license. Trigger phrases: "query Kafka
  topic from Oxla", "CREATE KAFKA CATALOG", "CREATE ICEBERG CATALOG", "federated
  query Oxla", "read parquet from S3 in Oxla", "iceberg catalog arrow operator",
  "catalog=>table syntax", "REFRESH kafka source", "ALTER KAFKA TABLE", "external
  schema Oxla", "redpanda.iceberg.mode", "enable Iceberg topic for Oxla",
  "iceberg_rest_catalog_endpoint", "schema ID validation".
---

# Redpanda SQL: Federated & External Queries

Oxla can query external data — Kafka/Redpanda topics, Apache Iceberg tables, and
object-store files — without ETL, joining them directly with native columnar tables
using standard SQL. External sources are accessed through named catalog objects
that Oxla stores in its own metastore. Schemas are decoded automatically from
Avro, Protobuf, or JSON via the Schema Registry and can evolve transparently.

Connect to Oxla via the PostgreSQL wire protocol. The port is configurable via
`network.postgresql.port` (conventional default: 5432):

```bash
psql -h <oxla-host> -p <port> -U <user>
```

---

## Quickstart

### 1. Kafka Catalog — query a Redpanda/Kafka topic

```sql
-- Step 1: Create the catalog (connection to the broker + schema registry).
-- Required options: initial_brokers, schema_registry_url
CREATE KAFKA CATALOG my_kafka
WITH (
  initial_brokers     = 'localhost:9092',
  schema_registry_url = 'http://localhost:8081'
);

-- Step 2: Register the topic as a table inside the catalog.
-- Required option: topic
CREATE TABLE my_kafka=>orders
WITH (topic = 'orders-topic');

-- Step 3: Refresh the schema (pulls Avro/Protobuf/JSON schema from registry).
REFRESH my_kafka=>orders;

-- Step 4: Query it like any table.
SELECT order_id, customer_id, amount
FROM   my_kafka=>orders
WHERE  amount > 100;

-- Filter on Kafka metadata (partition, offset, timestamp).
SELECT order_id, (redpanda).partition, (redpanda)."offset"
FROM   my_kafka=>orders
WHERE  (redpanda).timestamp > TIMESTAMP '2024-06-01 00:00:00';
```

### 2. Iceberg Catalog — query Apache Iceberg tables

```sql
-- Step 0: Create a storage connection (required before any ICEBERG CATALOG).
CREATE STORAGE my_s3
TYPE = S3
WITH (region = 'us-east-1', access_key_id = '...', secret_access_key = '...');

-- Step 1: Create an Iceberg REST catalog (STORAGE clause is mandatory).
CREATE ICEBERG CATALOG my_ice
STORAGE public.my_s3
WITH (
  uri      = 'https://iceberg.example.com',
  auth_type = 'oauth2',
  oauth2_client_id     = 'my-client-id',
  oauth2_client_secret = 'my-client-secret'
);

-- Step 2: Query an Iceberg table using the catalog=>namespace.table syntax.
SELECT customer_id, total
FROM   my_ice=>sales.orders
WHERE  order_date >= DATE '2024-01-01';

-- Step 3: Inspect what tables are known.
SELECT * FROM system.iceberg_tables WHERE catalog_name = 'my_ice';
```

### 3. File-based — COPY FROM parquet on S3

```sql
-- Load a parquet file from S3 into a native table.
COPY my_table FROM 's3://my-bucket/data/file.parquet' (FORMAT parquet);

-- Export a native table to parquet on S3.
COPY my_table TO 's3://my-bucket/exports/file.parquet' (FORMAT parquet);

-- Load ORC.
COPY my_table FROM 's3://my-bucket/data/file.orc' (FORMAT ORC);
```

---

## Kafka Catalogs

Kafka catalogs connect Oxla to a Kafka or Redpanda cluster. Both `CREATE KAFKA CATALOG`
and `CREATE REDPANDA CATALOG` are accepted (synonyms).

### Connection options (`CREATE KAFKA CATALOG ... WITH (...)`)

| Option | Required | Description |
|--------|----------|-------------|
| `initial_brokers` | Yes | Bootstrap broker list (e.g. `'broker1:9092,broker2:9092'`) |
| `schema_registry_url` | Yes | Schema Registry URL (`http://` or `https://`) |
| `pandaproxy_url` | No | Panda Proxy URL for transparent Iceberg queries |
| `sasl_mechanism` | No | `'SCRAM-SHA-256'` or `'SCRAM-SHA-512'` |
| `sasl_user` | No | SASL username |
| `sasl_password` | No | SASL password (stored encrypted) |
| `truststore` | No | PEM CA bundle for TLS verification |
| `key_store_key` | No | PEM private key for mTLS |
| `key_store_cert` | No | PEM certificate for mTLS |
| `connection_timeout` | No | Timeout in milliseconds (integer) |
| `rd_kafka_debug` | No | librdkafka debug contexts (e.g. `'all'`) |

### Table options (`CREATE TABLE catalog=>name WITH (...)`)

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `topic` | Yes | — | Kafka topic name |
| `schema_subject` | No | `<topic>-value` | Schema Registry subject name |
| `schema_lookup_policy` | No | `LATEST` | `LATEST` (pin to latest schema) or `SCHEMA_ID` (per-record schema ID) |
| `error_handling_policy` | No | `FAIL` | `FAIL`, `FILL_NULL`, or `DROP_RECORD` on decode errors |
| `struct_mapping_policy` | No | `COMPOUND` | `COMPOUND` (nested struct) or `JSON` (collapse nested to SQL JSON) |
| `output_schema_message_full_name` | No | — | Protobuf message full name (e.g. `com.example.Order`) |
| `confluent_wire_protocol` | No | `true` | `true` or `false`; only for `LATEST` policy |

### Querying

Use the `catalog=>table` syntax in any SELECT:

```sql
-- Simple select
SELECT * FROM my_kafka=>orders;

-- Join with a native table
SELECT o.order_id, c.name, o.amount
FROM   my_kafka=>orders o
JOIN   customers c ON o.customer_id = c.id;

-- Access Kafka metadata via the `redpanda` struct column
SELECT (redpanda).partition,
       (redpanda)."offset",
       (redpanda).timestamp,
       order_id
FROM   my_kafka=>orders;
```

### Altering and refreshing

```sql
-- Change table options after creation
ALTER TABLE my_kafka=>orders
WITH (error_handling_policy = 'FILL_NULL');

-- Change catalog-level options
ALTER KAFKA CATALOG my_kafka
WITH (connection_timeout = 30000);

-- Relink a Kafka catalog to a different Iceberg catalog (for transparent queries)
ALTER KAFKA CATALOG my_kafka USING CATALOG my_ice;

-- Detach the Iceberg link
ALTER KAFKA CATALOG my_kafka USING CATALOG NULL;

-- Refresh schema from Schema Registry
REFRESH my_kafka=>orders;
```

---

## Iceberg Catalogs

Oxla connects to Apache Iceberg REST catalogs (e.g., Polaris, AWS Glue, Tabular).

### Connection options (`CREATE ICEBERG CATALOG ... WITH (...)`)

| Option | Required | Description |
|--------|----------|-------------|
| `uri` | Yes | REST catalog endpoint URL |
| `warehouse` | No | Warehouse path or identifier |
| `auth_type` | No | `'oauth2'`, `'basic'`, or `'aws_sigv4'` |
| `oauth2_client_id` | OAuth2 | OAuth2 client ID |
| `oauth2_client_secret` | OAuth2 | OAuth2 client secret (stored encrypted) |
| `oauth2_scope` | No | OAuth2 scope (default: `PRINCIPAL_ROLE:ALL`) |
| `oauth2_token_endpoint_url` | No | Token endpoint URL (auto-discovered from /config if omitted) |
| `oauth2_token_refresh_margin_seconds` | No | Seconds before expiry to refresh token |
| `username` | Basic | HTTP basic auth username |
| `password` | Basic | HTTP basic auth password (stored encrypted) |
| `aws_region` | SigV4 | AWS region (e.g., `'us-east-1'`) |
| `aws_access_key_id` | SigV4 | AWS access key (omit to use instance IAM role) |
| `aws_secret_access_key` | SigV4 | AWS secret key |
| `aws_service_name` | No | SigV4 service name (default: `'glue'`) |
| `ssl_verify` | No | TLS verification: `'true'` or `'false'` |
| `ssl_ca_info` | No | Path to CA bundle |
| `ssl_ca_path` | No | Path to directory of CA certs |
| `ssl_crl_file` | No | Path to CRL file |

### Querying

```sql
-- Single-level namespace
SELECT id, name FROM my_ice=>ns.table1;

-- Multi-level namespace
SELECT age, name FROM my_ice=>my.path.table1;

-- Partition filter (pushes predicate to Iceberg scan plan)
SELECT id FROM my_ice=>my.path.partitioned_table
WHERE id = 1;

-- Range filter on a partition column
SELECT id, name FROM my_ice=>my.path.range_table
WHERE id < 3;

-- Date/timestamp partition filters
SELECT id FROM my_ice=>my.path.partitioned_table
WHERE val_date = DATE '2024-01-02';

SELECT id FROM my_ice=>my.path.partitioned_table
WHERE val_ts = TIMESTAMP '2024-01-03 12:00:00';
```

---

## File-Based External Data (COPY FROM/TO)

Oxla supports `COPY FROM` and `COPY TO` with parquet and ORC on S3, GCS, and Azure.

```sql
-- Load parquet
COPY my_table FROM 's3://bucket/path/file.parquet' (FORMAT parquet);

-- Load ORC
COPY my_table FROM 's3://bucket/path/file.orc' (FORMAT ORC);

-- Export parquet
COPY my_table TO 's3://bucket/path/out.parquet' (FORMAT parquet);

-- Export ORC
COPY my_table TO 's3://bucket/path/out.orc' (FORMAT ORC);

-- Load from STDIN (CSV)
COPY my_table FROM STDIN (FORMAT CSV);
```

Storage credentials can be configured either via `CREATE STORAGE` (persistent
named connection; see the sql-admin-api skill) or inline per-statement using
`AWS_CRED(...)`, `GCS_CRED(...)`, or `AZURE_CRED(...)` options on the `COPY`
statement (see [files-and-system-tables.md](references/files-and-system-tables.md)).
Path protocols: `s3://`, `gs://`, `az://` or `wasbs://` (Azure), `local://`.

---

## System Tables for External Metadata

These virtual tables live in the `system` schema and are accessible in every database.

```sql
-- Kafka catalog connections
SELECT * FROM system.kafka_connections;
-- Columns: database_name, namespace_name, name, options, iceberg_catalog (nullable)

-- Kafka topic sources
SELECT * FROM system.kafka_sources;
-- Columns: database_name, namespace_name, name, connection_name, topic_name,
--          subject_name, lookup_policy, error_handling_policy, struct_mapping_policy,
--          output_schema_full_message_name

-- Iceberg catalogs
SELECT * FROM system.iceberg_catalogs;
-- Columns: name, uri, warehouse, auth_type, namespace_name, database_name

-- Iceberg tables (REFRESHed into local catalog)
SELECT * FROM system.iceberg_tables;
-- Columns: database_name, namespace_name, catalog_name, name, oid

-- Examples
SELECT name, topic_name, lookup_policy
FROM   system.kafka_sources
WHERE  connection_name = 'my_kafka';

SELECT name, uri, auth_type
FROM   system.iceberg_catalogs;
```

---

## Redpanda Enterprise Source Config (producing the data Oxla reads)

The Iceberg tables, Tiered Storage segments, and validated schemas that Oxla
queries are produced on the Redpanda side by **Enterprise Edition** features
(valid license required). When Oxla reads an Iceberg table or runs a transparent
Kafka-Iceberg query, the Redpanda cluster must first be configured to write it.

| Oxla read path | Redpanda enterprise feature | Key config |
|----------------|-----------------------------|------------|
| `CREATE ICEBERG CATALOG`, `cat=>ns.table` | Iceberg Topics | `iceberg_enabled=true`; topic `redpanda.iceberg.mode` |
| Transparent Kafka-Iceberg (`USING CATALOG`) | Iceberg Topics + catalog backing | `iceberg_catalog_type`, `iceberg_rest_catalog_endpoint` |
| Long-retention / object-store reads | Tiered Storage | `cloud_storage_enabled=true` |
| Avro/Protobuf/JSON decoding via registry | Server-Side Schema ID Validation | `enable_schema_id_validation=true`; topic `redpanda.value.schema.id.validation` |

```bash
# Redpanda side (Enterprise): produce an Iceberg table Oxla can read.
rpk cluster config set cloud_storage_enabled true        # Tiered Storage (prereq)
rpk cluster config set iceberg_enabled true              # Iceberg Topics
rpk cluster config set iceberg_catalog_type rest
rpk cluster config set iceberg_rest_catalog_endpoint http://catalog:8181
rpk topic alter-config clicks --set redpanda.iceberg.mode=value_schema_id_prefix
```

The `redpanda.iceberg.*` topic properties (`mode`, `delete`,
`invalid.record.action`, `partition.spec`, `target.lag.ms`), the
`iceberg_rest_catalog_*` cluster properties, and the schema-validation knobs are
documented in
[redpanda-iceberg-source-config.md](references/redpanda-iceberg-source-config.md).
Point Oxla's `CREATE ICEBERG CATALOG` `uri` / `auth_type` at the same REST
catalog Redpanda writes to (`iceberg_rest_catalog_endpoint` /
`iceberg_rest_catalog_authentication_mode`).

---

## Reference Directory

- [kafka-catalogs.md](references/kafka-catalogs.md): Complete reference for `CREATE KAFKA CATALOG`, `CREATE TABLE catalog=>name`, `ALTER KAFKA CATALOG/TABLE`, `REFRESH`, all options, schema decoding (Avro/Protobuf/JSON), the `redpanda` metadata struct, and transparent Kafka-Iceberg queries.
- [iceberg.md](references/iceberg.md): Querying Apache Iceberg REST catalogs — `CREATE ICEBERG CATALOG`, the `catalog=>path.table` syntax, partition pruning and range/date/timestamp filters, all auth modes (OAuth2/Basic/SigV4), and multi-file partition scans.
- [files-and-system-tables.md](references/files-and-system-tables.md): `COPY FROM/TO` with parquet and ORC on S3/GCS/Azure, storage path protocols (`s3://`, `gs://`, `az://`/`wasbs://`, `local://`), `CREATE STORAGE` credential configuration, inline per-statement `AWS_CRED`/`GCS_CRED`/`AZURE_CRED` credentials, and the four external-metadata system tables with their column schemas and example queries.
- [redpanda-iceberg-source-config.md](references/redpanda-iceberg-source-config.md): The Redpanda **Enterprise** features that produce the data Oxla reads — Iceberg Topics (`iceberg_enabled`, the `redpanda.iceberg.mode`/`delete`/`invalid.record.action`/`partition.spec`/`target.lag.ms` topic properties, the four Iceberg modes, DLQ tables), the REST and `object_storage` catalog backing (`iceberg_catalog_type`, all `iceberg_rest_catalog_*` properties) and how to align them with Oxla's `CREATE ICEBERG CATALOG`, Tiered Storage as a prerequisite (`cloud_storage_enabled`), and Server-Side Schema ID Validation (`enable_schema_id_validation`, `redpanda.key/value.schema.id.validation`, subject-name strategies). Notes license requirements and expiration behavior.
