# Oxla Lakehouse & Streaming Integration (Iceberg, Redpanda/Kafka, Storage Connections)

Oxla's analytical-database differentiators are its native object-storage backing, its **Apache Iceberg REST catalog** integration (lakehouse interoperability), and its **transparent Redpanda/Kafka** integration (query streaming topics as SQL tables). Unlike a Kafka broker's enterprise features, these are **not gated by a separate license key** — they are configured through SQL DDL (connection objects) and cluster config. The relevant licensing note: Oxla runs as a single binary; the streaming/lakehouse surfaces below are configured with SQL `CREATE` statements whose options are parsed in `src/catalog/`.

All connection DDL options are verified against:
- `src/sqlparser/sql/connection_option_names.h` (the authoritative option-key constants)
- `src/sqlparser/bison_parser/bison_parser.y` (the DDL grammar)
- `src/catalog/iceberg_catalog_parser.cpp`, `src/catalog/kafka/conversions.cpp`, `src/catalog/storage_parser.cpp`

Credentials inside these connection objects are encrypted at rest (see [auth-and-security.md](auth-and-security.md), `OXLA_ENCRYPTION_KEY`). Sensitive option values are redacted from query logs and error messages (`k_*_sensitive_keys` in `connection_option_names.h`).

---

## 1. Storage Connections (object-storage backends)

A **storage connection** is a named, reusable object that holds the credentials and endpoint for an object store. Iceberg catalogs reference a storage connection by name. This is Oxla's analog of Tiered Storage / object-storage-native data: the object store is a first-class backing target.

### DDL syntax

```sql
CREATE STORAGE [IF NOT EXISTS] [schema.]connection_name
  TYPE = { S3 | GCS | ABS }
  WITH ( option = 'value', ... );

ALTER STORAGE [IF EXISTS] [schema.]connection_name
  TYPE = { S3 | GCS | ABS }
  WITH ( option = 'value', ... );
```

`TYPE` must be one of `s3`, `gcs`, or `abs` (Azure Blob Storage). Any other value is rejected at parse time (`src/sqlparser/bison_parser/bison_parser.y` `storage_type` rule).

### Per-type options (from `src/catalog/storage_parser.cpp`)

The parser validates that only the supported option keys for each type are present; unknown keys produce `Unsupported <type> storage connection option: '<key>'`.

**S3** (`k_supported_s3_options`) — expected URL scheme `s3://`:

| Option | Required | Notes |
|--------|----------|-------|
| `url` | yes | `s3://bucket/prefix` |
| `region` | — | AWS region |
| `access_key_id` | — | static key; sensitive (redacted) |
| `secret_access_key` | — | static secret; sensitive (redacted) |
| `session_token` | — | STS session token; sensitive (redacted) |
| `endpoint` | — | custom S3-compatible endpoint (e.g. MinIO) |
| `path_style` | — | `true`/`false`/`1`/`0`; path-style addressing |
| `use_http` | — | `true`/`false`/`1`/`0`; plaintext HTTP instead of HTTPS |

When `access_key_id`/`secret_access_key` are omitted, the AWS default credential chain is used (env → shared config → STS web identity → IMDSv2/ECS).

**GCS** (`k_supported_gcs_options`) — expected URL scheme `gs://`:

| Option | Required | Notes |
|--------|----------|-------|
| `url` | yes | `gs://bucket/prefix` |
| `service_account_key` | yes | service-account JSON key; sensitive (redacted) |
| `endpoint` | — | custom endpoint |

**ABS / Azure Blob** (`k_supported_azure_options`) — expected URL scheme `wasbs://`:

| Option | Required | Notes |
|--------|----------|-------|
| `url` | yes | `wasbs://container/prefix` |
| `account_name` | yes | Azure Storage Account name |
| `tenant_id` | — | Azure AD tenant ID |
| `client_id` | — | Azure AD app (client) ID |
| `client_secret` | — | Azure AD app secret; sensitive (redacted) |
| `endpoint` | — | custom endpoint |

> Note: a storage **connection** (named SQL object) is distinct from the cluster-level `storage.oxla_home` backing store described in [configuration.md](configuration.md). The `oxla_home` URI is where Oxla stores its own data; a `CREATE STORAGE` connection is referenced by Iceberg catalogs for reading/writing external lakehouse data.

---

## 2. Iceberg REST Catalogs (lakehouse interoperability)

Oxla integrates with **Apache Iceberg via the Iceberg REST catalog protocol** (Polaris, AWS Glue/S3 Tables, Nessie, and other REST-compatible catalogs). This is the direct analog of Redpanda's Iceberg Topics differentiator: it exposes table data in the open Iceberg format for query engines across the lakehouse.

The cluster gate `feature_flags.allow_iceberg_queries` (default `false`) controls whether direct `SELECT` from an Iceberg catalog is permitted. Transparent Kafka+Iceberg queries are unaffected by this flag (see source comment in `default_config.yml`). Enable with:

```bash
OXLA__FEATURE_FLAGS__ALLOW_ICEBERG_QUERIES=true
```

### DDL syntax (`create_catalog_statement` in the grammar)

```sql
CREATE ICEBERG CATALOG [IF NOT EXISTS] [schema.]catalog_name
  STORAGE [schema.]storage_connection_name
  WITH ( option = 'value', ... );

ALTER ICEBERG CATALOG [IF EXISTS] [schema.]catalog_name
  STORAGE [schema.]storage_connection_name
  WITH ( option = 'value', ... );
```

The `STORAGE` clause links the catalog to a `CREATE STORAGE` connection (section 1) for the underlying data files.

### Catalog options (from `iceberg_catalog_parser.cpp` + `connection_option_names.h` `iceberg` namespace)

| Option | Required | Notes |
|--------|----------|-------|
| `uri` | yes | REST catalog base URI (validated as required) |
| `warehouse` | — | warehouse identifier/location |
| `auth_type` | — | `oauth2` \| `basic` \| `aws_sigv4` (selects which auth sub-options apply) |

**`auth_type = 'oauth2'`** (OAuth2 client-credentials; for Polaris, Okta, Azure AD):

| Option | Required | Notes |
|--------|----------|-------|
| `oauth2_client_id` | yes | OAuth2 client ID |
| `oauth2_client_secret` | yes | OAuth2 client secret; sensitive (redacted) |
| `oauth2_scope` | — | default `PRINCIPAL_ROLE:ALL` (matches Redpanda's `iceberg_rest_catalog_oauth2_scope` default). Set to empty string to send no scope. |
| `oauth2_token_endpoint_url` | — | override token endpoint |
| `oauth2_token_refresh_margin_seconds` | — | int, 0 … INT32_MAX |

**`auth_type = 'basic'`**:

| Option | Required | Notes |
|--------|----------|-------|
| `username` | yes | |
| `password` | yes | sensitive (redacted) |

**`auth_type = 'aws_sigv4'`** (AWS SigV4 signing; for Glue/S3 Tables behind AWS):

| Option | Required | Notes |
|--------|----------|-------|
| `aws_region` | yes | |
| `aws_access_key_id` | — | sensitive (redacted); must be set together with secret or both omitted |
| `aws_secret_access_key` | — | sensitive (redacted) |
| `aws_service_name` | — | SigV4 service segment: `glue`, `s3tables`, `execute-api`, … (defaults to `glue`) |

When both AWS keys are omitted, the AWS default credential chain (IMDSv2/ECS instance role) is used.

**TLS options** (apply to the REST catalog HTTPS connection):

| Option | Notes |
|--------|-------|
| `ssl_verify` | `true` (default) / `false` — verify server certificate |
| `ssl_ca_info` | CA bundle file |
| `ssl_ca_path` | CA directory |
| `ssl_crl_file` | certificate revocation list file |

### AWS Glue example (from `ansible/templates/iceberg_glue.j2`)

The Ansible Glue template configures an equivalent integration via cluster properties (REST catalog type, `aws_sigv4` auth, region, warehouse base location, default namespace, commit interval), demonstrating the Glue REST + SigV4 pattern.

### Refresh external metadata

```sql
REFRESH catalog_name=>source_name;
REFRESH ns.catalog_name=>ns2.table_name;
```

---

## 3. Transparent Redpanda / Kafka Integration

Oxla can query **Redpanda/Kafka topics directly as SQL tables** ("transparent Kafka"), reading records via the schema registry. The DDL keyword `REDPANDA` and `KAFKA` are interchangeable (`redpanda_or_kafka` grammar rule). This is the streaming-platform connection surface.

### DDL syntax

```sql
-- Connection (catalog) holding broker + schema-registry config:
CREATE { REDPANDA | KAFKA } CATALOG [IF NOT EXISTS] [schema.]catalog_name
  [ USING CATALOG iceberg_catalog ]      -- optionally link an Iceberg catalog
  WITH ( option = 'value', ... );

ALTER { REDPANDA | KAFKA } CATALOG [IF EXISTS] [schema.]catalog_name
  WITH ( option = 'value', ... );
ALTER { REDPANDA | KAFKA } CATALOG name USING CATALOG iceberg_catalog [WITH (...)];
ALTER { REDPANDA | KAFKA } CATALOG name USING CATALOG NULL [WITH (...)];  -- detach Iceberg link

-- A table backed by a topic in that catalog:
CREATE TABLE [IF NOT EXISTS] catalog_name=>table_name
  WITH ( topic = 'my_topic', ... );

ALTER TABLE [IF EXISTS] catalog_name=>table_name
  WITH ( schema_lookup_policy = 'LATEST', error_handling_policy = 'FILL_NULL' );
```

The `catalog=>table_name` arrow syntax is required for Kafka tables; omitting it raises `Expected catalog=>table_name syntax`.

### Catalog (connection) options (`KafkaConnectionOptions::k_option_definitions`, `kafka` namespace)

| Option | Required | Type | Notes |
|--------|----------|------|-------|
| `initial_brokers` | yes | string | bootstrap broker list |
| `schema_registry_url` | yes | string | schema registry endpoint |
| `truststore` | — | string | TLS CA truststore |
| `key_store_key` | — | string | client key; sensitive (redacted) |
| `key_store_cert` | — | string | client cert |
| `sasl_mechanism` | — | string | SASL mechanism |
| `sasl_user` | — | string | SASL username |
| `sasl_password` | — | string | SASL password; sensitive (redacted) |
| `pandaproxy_url` | — | string | Redpanda HTTP Proxy (pandaproxy) URL |
| `connection_timeout` | — | int64 | connection timeout |
| `rd_kafka_debug` | — | string | librdkafka debug flags |

### Table (source) options (`KafkaSourceOptions::k_option_definitions`)

| Option | Required | Notes / valid values |
|--------|----------|----------------------|
| `topic` | yes | Kafka/Redpanda topic name |
| `schema_subject` | — | schema registry subject name |
| `output_schema_message_full_name` | — | fully-qualified output message name |
| `schema_lookup_policy` | — | `LATEST` (default) \| `SCHEMA_ID` |
| `error_handling_policy` | — | `FAIL` (default) \| `FILL_NULL` \| `DROP_RECORD` |
| `struct_mapping_policy` | — | `COMPOUND` (default) \| `JSON` (only these two supported in current version) |
| `confluent_wire_protocol` | — | `true` \| `false`; only valid when `schema_lookup_policy = 'LATEST'` |

### Lakehouse + streaming bridge

A Redpanda/Kafka catalog can be linked to an Iceberg catalog via `USING CATALOG iceberg_catalog`. This bridges streaming topics and the Iceberg lakehouse, mirroring the Redpanda Iceberg Topics value proposition (stream data landing in open table format). Detach with `USING CATALOG NULL`.

---

## System catalogs for introspection

Iceberg catalogs and tables are tracked in system metastore tables (`src/metastore/system_iceberg_catalogs.*`, `src/metastore/system_iceberg_tables.*`), queryable via SQL for operational visibility. See the `sql` skill for querying system tables.
