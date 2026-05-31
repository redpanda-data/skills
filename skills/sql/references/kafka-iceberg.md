# Redpanda/Kafka Catalogs, Iceberg Catalogs, and Object Storage

Oxla can attach **external sources** — Redpanda/Kafka topics and Apache Iceberg
tables — and query them with plain SQL through the PostgreSQL wire protocol. This
is the central Oxla + Redpanda **enterprise differentiator** for this skill: it
lets analysts run OLAP queries directly against streaming data in Redpanda and
against Iceberg lakehouse tables, without a separate ingestion pipeline.

This integration pairs with the corresponding Redpanda Enterprise features
(licensed in Redpanda itself):

- **Iceberg Topics** (`redpanda.iceberg.mode`) — Redpanda materializes topic data
  as Iceberg tables in object storage. Oxla then attaches that Iceberg catalog and
  queries it. See the Iceberg property reference below.
- **Tiered Storage / Cloud Topics** — the object-storage backing that Iceberg
  Topics and remote reads depend on.

> **License note.** On the **Redpanda** side, Iceberg Topics, Tiered Storage, and
> Cloud Topics each require a Redpanda **Enterprise license** (they enter a
> restricted state on license expiration). The Oxla-side `CREATE REDPANDA CATALOG`
> / `CREATE ICEBERG CATALOG` / `CREATE STORAGE` / `CREATE TABLE ... WITH (...)`
> statements documented here are the SQL surface that consumes those Redpanda
> enterprise features.

All grammar grounded in `src/sqlparser/bison_parser/bison_parser.y`; all option
keys grounded in `src/sqlparser/sql/connection_option_names.h`,
`src/catalog/kafka/conversions.cpp`, and `src/catalog/iceberg_catalog_parser.cpp`.

---

## The `catalog=>table` external-source syntax

External (Kafka/Iceberg) tables are referenced with a `=>` separator between the
catalog name and the source/table name. Statements that require this form raise a
parse error if it is missing (`"Expected catalog=>table_name syntax"`).

```sql
-- Query a Redpanda topic bound through a catalog, just like a table
SELECT region, COUNT(*) FROM my_catalog=>orders_topic GROUP BY region;

-- Namespaced form: schema.catalog => schema.table
SELECT * FROM ns.my_conn=>ns2.my_table;
```

---

## Object storage connections (`CREATE STORAGE`)

A storage connection holds credentials/endpoint for an object store. It is the
prerequisite for an Iceberg catalog (the `STORAGE` clause references it).

`storage_type` must be one of **`s3`**, **`gcs`**, or **`abs`** (Azure Blob
Storage); any other value is a parse error.

```sql
CREATE STORAGE my_s3 TYPE = S3 WITH (
    region            = 'us-west-2',
    access_key_id     = 'AKID...',
    secret_access_key = 'secret...',
    endpoint          = 'https://s3.us-west-2.amazonaws.com'
);

CREATE STORAGE IF NOT EXISTS my_gcs TYPE = GCS WITH (
    service_account_key = '{ ... json ... }'
);

ALTER STORAGE my_s3 TYPE = S3 WITH (region = 'eu-central-1');
ALTER STORAGE IF EXISTS my_s3 TYPE = S3 WITH (path_style = 'true');

DESCRIBE STORAGE my_s3;
DROP STORAGE my_s3;
DROP STORAGE IF EXISTS my_s3;
```

### Storage connection option keys

Grounded in `connection_option_names.h` (`namespace storage`). Sensitive keys are
redacted from logs/errors (marked **secret**).

| Key | Applies to | Notes |
|-----|-----------|-------|
| `type` | all | set via `TYPE = s3/gcs/abs` |
| `endpoint` | s3, gcs, azure | custom endpoint URL |
| `url` | all | connection URL |
| `region` | s3 | AWS region |
| `access_key_id` | s3 | **secret** |
| `secret_access_key` | s3 | **secret** |
| `session_token` | s3 | **secret** (temporary creds) |
| `path_style` | s3 | force path-style addressing |
| `use_http` | s3 | use plain HTTP instead of HTTPS |
| `service_account_key` | gcs | **secret** |
| `account_name` | azure | storage account name |
| `tenant_id` | azure | AAD tenant |
| `client_id` | azure | AAD app client id |
| `client_secret` | azure | **secret** |

---

## Iceberg catalogs (`CREATE ICEBERG CATALOG`)

Attach an Apache Iceberg catalog (e.g., a Redpanda Iceberg Topics catalog, AWS
Glue/S3 Tables, Polaris, or any REST catalog). The `STORAGE` clause binds the
object-storage connection created above.

```sql
CREATE ICEBERG CATALOG my_iceberg STORAGE my_s3 WITH (
    uri       = 'https://rest-catalog.example.com',
    warehouse = 's3://my-warehouse/',
    auth_type = 'oauth2',
    oauth2_client_id     = 'client-id',
    oauth2_client_secret = 'client-secret',
    oauth2_scope         = 'PRINCIPAL_ROLE:ALL'
);

ALTER ICEBERG CATALOG my_iceberg STORAGE my_s3 WITH (warehouse = 's3://new/');

DESCRIBE ICEBERG CATALOG my_iceberg;
SHOW ICEBERG CATALOGS;
SHOW ICEBERG TABLES;
DROP ICEBERG CATALOG my_iceberg;
DROP ICEBERG CATALOG IF EXISTS my_iceberg;
```

### Iceberg catalog option keys

Grounded in `connection_option_names.h` (`namespace iceberg`) and
`iceberg_catalog_parser.cpp`.

| Key | Notes |
|-----|-------|
| `uri` | REST catalog endpoint |
| `warehouse` | warehouse location/identifier |
| `auth_type` | one of `oauth2`, `basic`, `aws_sigv4` (validated; others rejected) |
| `oauth2_client_id` | OAuth2 client id (`auth_type = 'oauth2'`) |
| `oauth2_client_secret` | **secret** |
| `oauth2_scope` | OAuth2 scope |
| `oauth2_token_endpoint_url` | external token endpoint (e.g. Okta) |
| `oauth2_token_refresh_margin_seconds` | refresh lead time |
| `username` | basic auth (`auth_type = 'basic'`) |
| `password` | **secret** (basic auth) |
| `aws_region` | SigV4 region (`auth_type = 'aws_sigv4'`) |
| `aws_access_key_id` | **secret** (SigV4) |
| `aws_secret_access_key` | **secret** (SigV4) |
| `aws_service_name` | SigV4 service segment (defaults to `glue`) |
| `ssl_verify` | TLS verification toggle |
| `ssl_ca_info` / `ssl_ca_path` / `ssl_crl_file` | TLS trust material |

> Setting an auth-specific option (e.g. `oauth2_client_id`) without `auth_type`
> raises `"auth option '...' provided without 'auth_type'"`.

---

## Redpanda/Kafka catalogs (`CREATE REDPANDA CATALOG`)

A Redpanda/Kafka catalog points Oxla at a Redpanda/Kafka cluster (brokers + Schema
Registry). `REDPANDA` and `KAFKA` are interchangeable keywords. Optionally bind it
to an Iceberg catalog with `USING CATALOG` so topic data lands as Iceberg tables.

```sql
-- Basic Redpanda catalog
CREATE REDPANDA CATALOG my_rp WITH (
    initial_brokers     = 'broker1:9092,broker2:9092',
    schema_registry_url = 'http://localhost:8081',
    sasl_mechanism      = 'SCRAM-SHA-256',
    sasl_user           = 'app',
    sasl_password       = 'secret'
);

-- KAFKA is an alias for REDPANDA
CREATE KAFKA CATALOG my_k WITH (initial_brokers = 'localhost:9092',
                                schema_registry_url = 'http://localhost:8081');

-- Bind to an Iceberg catalog at creation
CREATE REDPANDA CATALOG my_rp USING CATALOG my_iceberg WITH (
    initial_brokers     = 'localhost:9092',
    schema_registry_url = 'http://localhost:8081'
);
```

### Catalog-level Kafka connection option keys

Grounded in `connection_option_names.h` (`namespace kafka`) and the
`KafkaConnectionOptions::k_option_definitions` list. `initial_brokers` and
`schema_registry_url` are **required**.

| Key | Required | Type | Notes |
|-----|----------|------|-------|
| `initial_brokers` | yes | string | bootstrap brokers, `host:port,...` |
| `schema_registry_url` | yes | string | Schema Registry URL |
| `truststore` | no | string | CA truststore |
| `key_store_key` | no | string | **secret** (client key, mTLS) |
| `key_store_cert` | no | string | client cert (mTLS) |
| `sasl_mechanism` | no | string | e.g. `PLAIN`, `SCRAM-SHA-256`, `SCRAM-SHA-512` |
| `sasl_user` | no | string | SASL username |
| `sasl_password` | no | string | **secret** |
| `pandaproxy_url` | no | string | Pandaproxy (REST proxy) URL |
| `connection_timeout` | no | int64 | connection timeout |
| `rd_kafka_debug` | no | string | librdkafka debug contexts |

```sql
-- Update connection options
ALTER REDPANDA CATALOG my_rp WITH (sasl_password = 'new-secret');

-- Attach / detach an Iceberg catalog binding
ALTER REDPANDA CATALOG my_rp USING CATALOG my_iceberg;
ALTER REDPANDA CATALOG my_rp USING CATALOG NULL;   -- detach

DESCRIBE REDPANDA CATALOG my_rp;
SHOW REDPANDA CATALOGS;
SHOW REDPANDA TABLES;
DROP REDPANDA CATALOG my_rp;
DROP REDPANDA CATALOG IF EXISTS my_rp;
```

---

## Binding a topic to a table (`CREATE TABLE ... WITH`)

Bind a specific Redpanda/Kafka topic to a queryable table using the
`catalog=>table_name` form. The `topic` option is **required**.

```sql
CREATE TABLE my_rp=>orders WITH (
    topic                = 'orders',
    schema_lookup_policy = 'LATEST',
    error_handling_policy = 'FILL_NULL',
    struct_mapping_policy = 'JSON'
);

CREATE TABLE IF NOT EXISTS my_rp=>events WITH (topic = 'events');
```

### Per-table (Kafka source) option keys

Grounded in `KafkaSourceOptions::k_option_definitions`
(`src/catalog/kafka/conversions.cpp`).

| Key | Required | Accepted values | Notes |
|-----|----------|-----------------|-------|
| `topic` | yes | string | Kafka/Redpanda topic name |
| `schema_subject` | no | string | Schema Registry subject override |
| `output_schema_message_full_name` | no | string | output message full name |
| `schema_lookup_policy` | no | `LATEST` (default), `SCHEMA_ID` | how to resolve schemas |
| `error_handling_policy` | no | `FAIL` (default), `FILL_NULL`, `DROP_RECORD` | bad-record behavior |
| `struct_mapping_policy` | no | `COMPOUND` (default), `JSON`, `FLATTEN`, `VARIANT` | only `JSON` and `COMPOUND` are accepted in the current version |
| `confluent_wire_protocol` | no | `true`, `false` | **only valid when `schema_lookup_policy = 'LATEST'`** |

### Re-bind / re-configure a topic table (`ALTER TABLE IF EXISTS ... WITH`)

This is the canonical Kafka-catalog rebind form. Use **`IF EXISTS`**, and the
table name **must** use the `catalog=>table_name` external-source form (the parser
raises `YYERROR` "Expected catalog=>table_name syntax" otherwise). This is the
only `ALTER TABLE` form Oxla supports — there is no `ADD/DROP/RENAME COLUMN`.

```sql
ALTER TABLE IF EXISTS my_rp=>orders WITH (
    schema_lookup_policy  = 'LATEST',
    error_handling_policy = 'DROP_RECORD'
);
```

### Drop a topic table

```sql
DROP TABLE my_rp=>orders;          -- DROP_KAFKA_TABLE (external source present)
DROP TABLE IF EXISTS my_rp=>orders;
```

---

## Refreshing external metadata (`REFRESH`)

Re-read source/topic metadata for an external table:

```sql
REFRESH my_rp=>orders;
REFRESH ns.my_conn=>ns2.my_table;   -- namespaced
```

---

## External-source privileges (`GRANT ... ON EXTERNAL SOURCE`)

Catalogs are governed with `ON EXTERNAL SOURCE` grants (grounded in
`privilege_statement`):

```sql
GRANT SELECT ON EXTERNAL SOURCE my_rp TO analyst;
GRANT SELECT ON EXTERNAL SOURCE my_rp.orders TO analyst;
GRANT USAGE  ON EXTERNAL SOURCE my_rp EXTERNAL_ACCESS 'read' TO analyst;
REVOKE SELECT ON EXTERNAL SOURCE my_rp FROM analyst;
```

---

## Related Redpanda Enterprise Iceberg-topic properties

When Redpanda is the producer of the Iceberg tables Oxla reads, these
**Redpanda topic-level** properties control materialization (require a Redpanda
**Enterprise license**; grounded in the Redpanda licensing/Iceberg docs):

| Redpanda property | Purpose |
|-------------------|---------|
| `redpanda.iceberg.mode` | enable/disable Iceberg materialization; values include `disabled`, `key_value`, `value_schema_id_prefix`, `value_schema_latest` |
| `redpanda.iceberg.delete` | whether the Iceberg table is dropped when the topic is deleted |
| `redpanda.iceberg.partition.spec` | Iceberg partition spec for the table |
| `redpanda.iceberg.target.lag.ms` | target lag for committing rows to the Iceberg table |
| `redpanda.iceberg.invalid.record.action` | `drop` or `dlq_table` handling for records that fail schema translation (default `dlq_table`) |

These are set on the Redpanda side (e.g. via `rpk topic create -c
redpanda.iceberg.mode=...`); Oxla consumes the resulting Iceberg catalog with
`CREATE ICEBERG CATALOG`.
