# Oxla: File-Based External Data & System Tables

Oxla supports reading and writing parquet and ORC files from object storage
(S3, GCS, Azure Blob Storage) and local paths via `COPY FROM` / `COPY TO`.
Four system virtual tables expose the metadata of all registered external
connections.

Sources grounded in: `oxla/src/filesystem/path/protocol.h`,
`oxla/src/filesystem/proto/credentials.proto`,
`oxla/src/filesystem/providers/s3/proto/credentials.proto`,
`oxla/src/filesystem/providers/gcs/proto/credentials.proto`,
`oxla/src/filesystem/providers/azure/proto/credentials.proto`,
`oxla/src/sqlparser/sql/connection_option_names.h` (storage namespace),
`oxla/src/metastore/system_kafka_connections.cpp`,
`oxla/src/metastore/system_kafka_sources.cpp`,
`oxla/src/metastore/system_iceberg_catalogs.cpp`,
`oxla/src/metastore/system_iceberg_tables.cpp`,
`oxla/tests/UT/query_planner/cases/copy_from/` and `copy_to/`.

---

## COPY FROM / COPY TO

`COPY FROM` loads data from an external file into a native Oxla table.
`COPY TO` exports a native table to an external file.

### Syntax

```sql
-- Load from a file
COPY <table_name> FROM '<path>' ( FORMAT <format> );

-- Load from STDIN
COPY <table_name> FROM STDIN ( FORMAT <format> );

-- Export to a file
COPY <table_name> TO '<path>' ( FORMAT <format> );

-- Export a query result to a file
COPY ( SELECT ... ) TO '<path>' ( FORMAT <format> );

-- Export to STDOUT (e.g., for CSV streaming)
COPY <table_name> TO STDOUT ( FORMAT CSV );
```

### Supported formats

| Format | COPY FROM | COPY TO | Notes |
|--------|-----------|---------|-------|
| `PARQUET` | Yes | Yes | Case-insensitive. File extension typically `.parquet`. |
| `ORC` | Yes | Yes | Case-insensitive. File extension typically `.orc`. |
| `CSV` | Yes | Yes | Standard CSV. STDIN/STDOUT supported. |

Grounded in test cases:
- `copy_to/predefined_copy_parquet/query.sql`: `COPY tb TO 'my_file.parquet' (FORMAT parquet);`
- `copy_to/predefined_copy_orc_tbl/query.sql`: `COPY tb TO 'my_file.orc' (FORMAT ORC);`
- `copy_from/`: `COPY tb from 'my_file.orc' (FORMAT ORC);` and `COPY tb from 'my_file.parquet' (FORMAT PARQUET);`

### Path formats and protocols

The path string determines the storage provider
(grounded in `oxla/src/filesystem/path/protocol.h`):

| Protocol prefix | Provider | Example |
|-----------------|----------|---------|
| `s3://` | Amazon S3 (or S3-compatible) | `'s3://my-bucket/data/file.parquet'` |
| `gs://` | Google Cloud Storage | `'gs://my-bucket/data/file.parquet'` |
| `az://` | Azure Blob Storage (short form) | `'az://my-container@my-account.blob.core.windows.net/file.parquet'` |
| `wasbs://` | Azure Blob Storage (long form) | `'wasbs://my-container@my-account.blob.core.windows.net/file.parquet'` |
| `local://` or no prefix | Local filesystem | `'local:///tmp/file.parquet'` or `'/tmp/file.parquet'` |

Both `az://` and `wasbs://` are accepted for Azure paths (grounded in
`oxla/src/filesystem/path/protocol.cpp`).

### Examples

```sql
-- Load parquet from S3
COPY orders FROM 's3://my-bucket/data/orders.parquet' (FORMAT parquet);

-- Load ORC from GCS
COPY events FROM 'gs://my-bucket/data/events.orc' (FORMAT ORC);

-- Load from Azure Blob Storage
COPY metrics FROM 'wasbs://container@myaccount.blob.core.windows.net/metrics.parquet'
(FORMAT parquet);

-- Export to S3
COPY orders TO 's3://my-bucket/exports/orders.parquet' (FORMAT parquet);

-- Export query result to ORC
COPY (SELECT order_id, amount FROM orders WHERE amount > 1000)
TO 's3://my-bucket/exports/large_orders.orc' (FORMAT ORC);

-- Load multi-node ORC (3-node cluster; distributed read)
COPY orders FROM 's3://my-bucket/data/orders.orc' (FORMAT ORC);

-- Load from STDIN
COPY orders FROM STDIN (FORMAT CSV);

-- Stream CSV to STDOUT
COPY orders TO STDOUT (FORMAT CSV);
```

---

## CREATE STORAGE (Configuring Object Store Credentials)

Before `COPY FROM/TO` can access a remote path, a storage connection must be
created with the credentials for that provider. Option names are grounded in
`hsql::option_names::storage`.

```sql
CREATE STORAGE [IF NOT EXISTS] [<schema>.]<connection_name>
TYPE = <type>
WITH ( <option> = <value> [, ...] );
```

### S3 storage options

`TYPE = S3` is a dedicated clause in the `CREATE STORAGE` statement (before
`WITH`), not a key inside `WITH(...)`. The following options go inside `WITH`:

| Option | Description |
|--------|-------------|
| `region` | AWS region (e.g., `'us-east-1'`) |
| `access_key_id` | AWS access key ID (stored encrypted) |
| `secret_access_key` | AWS secret access key (stored encrypted) |
| `endpoint` | Custom endpoint URL for S3-compatible services (e.g., MinIO) |
| `path_style` | `'true'` to force path-style addressing (required for most S3-compatible services) |
| `use_http` | `'true'` to use HTTP instead of HTTPS |
| `session_token` | AWS STS session token for temporary credentials |

These map directly to the proto fields in
`oxla/src/filesystem/providers/s3/proto/credentials.proto` (fields:
`region`, `access_key_id`, `secret_key`, `endpoint`, `path_style`, `use_http`,
`session_token`).

```sql
-- S3 with static credentials
CREATE STORAGE my_s3
TYPE = S3
WITH (
  region            = 'us-east-1',
  access_key_id     = 'AKIAIOSFODNN7EXAMPLE',
  secret_access_key = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
);

-- S3-compatible (MinIO) with path-style addressing
CREATE STORAGE minio
TYPE = S3
WITH (
  region     = 'us-east-1',
  endpoint   = 'http://minio.example.com:9000',
  path_style = 'true',
  use_http   = 'true',
  access_key_id     = 'minioadmin',
  secret_access_key = 'minioadmin'
);
```

### GCS storage options

Option names grounded in `oxla/src/sqlparser/sql/connection_option_names.h`
(storage namespace); proto field definitions in
`oxla/src/filesystem/providers/gcs/proto/credentials.proto`.

| SQL option name | Proto field | Description |
|-----------------|-------------|-------------|
| `service_account_key` | `credentials` (string) | Application Default Credentials (ADC) JSON string. The SQL option key is `service_account_key`; it maps to the proto field named `credentials`. |
| `endpoint` | `endpoint` (string) | Optional: override default GCS endpoint |

```sql
CREATE STORAGE my_gcs
TYPE = GCS
WITH (
  service_account_key = '{"type":"service_account","project_id":"my-project",...}'
);
```

### Azure storage options

Option names grounded in `oxla/src/filesystem/providers/azure/proto/credentials.proto`:

| Option | Description |
|--------|-------------|
| `tenant_id` | Azure AD tenant ID |
| `client_id` | Azure AD client/app ID |
| `client_secret` | Azure AD client secret (stored encrypted) |
| `account_name` | Storage account name (required) |
| `endpoint` | Optional: custom blob endpoint (for Azure Stack or emulators) |

The valid TYPE identifier for Azure is `ABS` (Azure Blob Storage). The grammar
also accepts `S3` and `GCS`; `ABS` maps internally to the azure provider.
`TYPE = AZURE` is **not** a valid identifier and will produce a parse error.

```sql
CREATE STORAGE my_azure
TYPE = ABS
WITH (
  tenant_id     = '00000000-0000-0000-0000-000000000000',
  client_id     = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
  client_secret = 'my-secret',
  account_name  = 'mystorageaccount'
);
```

---

## Inline COPY Credentials

As an alternative to `CREATE STORAGE`, credentials can be supplied inline on
each `COPY` statement via dedicated credential options. These are grounded in
the COPY grammar's `import_option` production
(`oxla/src/sqlparser/bison_parser/bison_parser.y`).

### AWS_CRED

```sql
COPY my_table FROM 's3://my-bucket/data/file.parquet' (
  FORMAT parquet,
  AWS_CRED(
    AWS_REGION       'us-east-1',
    AWS_KEY_ID       'AKIAIOSFODNN7EXAMPLE',
    AWS_PRIVATE_KEY  'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
    -- Optional:
    -- AWS_SESSION_TOKEN 'my-session-token',
    -- ENDPOINT          'https://custom.endpoint.example.com'
  )
);
```

Tokens accepted inside `AWS_CRED(...)`:

| Token | Required | Description |
|-------|----------|-------------|
| `AWS_REGION` | Yes | AWS region string (e.g. `'us-east-1'`) |
| `AWS_KEY_ID` | Yes | AWS access key ID |
| `AWS_PRIVATE_KEY` | Yes | AWS secret access key |
| `AWS_SESSION_TOKEN` | No | STS session token for temporary credentials |
| `ENDPOINT` | No | Custom S3-compatible endpoint URL |

### GCS_CRED

```sql
COPY my_table FROM 'gs://my-bucket/data/file.parquet' (
  FORMAT parquet,
  GCS_CRED('{"type":"service_account","project_id":"my-project",...}')
);
```

`GCS_CRED` takes a single string argument: the Application Default Credentials
(ADC) JSON content.

### AZURE_CRED

```sql
COPY my_table FROM 'wasbs://container@account.blob.core.windows.net/file.parquet' (
  FORMAT parquet,
  AZURE_CRED(
    TENANT_ID     '00000000-0000-0000-0000-000000000000',
    CLIENT_ID     'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    CLIENT_SECRET 'my-client-secret'
  )
);
```

Tokens accepted inside `AZURE_CRED(...)`:

| Token | Required | Description |
|-------|----------|-------------|
| `TENANT_ID` | Yes | Azure AD tenant ID |
| `CLIENT_ID` | Yes | Azure AD application (client) ID |
| `CLIENT_SECRET` | Yes | Azure AD client secret |

Inline credentials are per-statement; they are not persisted. Storage credentials
can alternatively be configured via `CREATE STORAGE` (see above), which avoids
repeating credentials in every query.

---

## System Tables for External Metadata

These four virtual tables in the `system` schema provide metadata about all
registered external connections. They are grounded in the `oxla/src/metastore/`
source files and are created at startup by `createSystemTables` in `metastore.cpp`.

### `system.kafka_connections`

One row per registered Kafka/Redpanda catalog connection.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `database_name` | TEXT | No | Oxla database containing this connection |
| `namespace_name` | TEXT | No | Oxla schema (namespace) containing this connection |
| `name` | TEXT | No | Catalog name |
| `options` | TEXT | No | Formatted connection options (bootstrap_brokers, schema_registry_hostname/port/use_ssl, pandaproxy settings, librdkafka_configs) |
| `iceberg_catalog` | TEXT | Yes | Linked Iceberg catalog in `namespace.name` format; NULL if no link or caller lacks privileges to see it |

```sql
-- List all Kafka connections
SELECT name, namespace_name, iceberg_catalog
FROM   system.kafka_connections;

-- Find connections linked to a specific Iceberg catalog
SELECT name
FROM   system.kafka_connections
WHERE  iceberg_catalog = 'public.my_ice';
```

### `system.kafka_sources`

One row per registered Kafka topic source (i.e., each `CREATE TABLE catalog=>name`).

| Column | Type | Description |
|--------|------|-------------|
| `database_name` | TEXT | Oxla database |
| `namespace_name` | TEXT | Oxla schema |
| `name` | TEXT | Source name (table name within the catalog) |
| `connection_name` | TEXT | Name of the parent Kafka connection |
| `topic_name` | TEXT | Kafka topic being consumed |
| `subject_name` | TEXT | Schema Registry subject name (empty string if using the default `<topic>-value`) |
| `lookup_policy` | TEXT | `RECORD_SCHEMA_ID` or `LATEST_SCHEMA` |
| `error_handling_policy` | TEXT | `FAIL`, `FILL_NULL`, or `DROP_RECORD` |
| `struct_mapping_policy` | TEXT | `COMPOUND`, `JSON`, `FLATTEN`, or `VARIANT` |
| `output_schema_full_message_name` | TEXT | Protobuf full message name (empty if not set) |

```sql
-- List all topic sources
SELECT * FROM system.kafka_sources;

-- Find sources for a specific connection
SELECT name, topic_name, lookup_policy, error_handling_policy
FROM   system.kafka_sources
WHERE  connection_name = 'my_kafka';

-- Find sources using per-record schema IDs
SELECT connection_name, name, topic_name
FROM   system.kafka_sources
WHERE  lookup_policy = 'RECORD_SCHEMA_ID';
```

### `system.iceberg_catalogs`

One row per registered Iceberg catalog connection.

| Column | Type | Description |
|--------|------|-------------|
| `name` | TEXT | Catalog name |
| `uri` | TEXT | REST catalog URI |
| `warehouse` | TEXT | Warehouse path (empty if not configured) |
| `auth_type` | TEXT | `'oauth2'`, `'basic'`, `'aws_sigv4'`, or `''` (unauthenticated) |
| `namespace_name` | TEXT | Oxla schema containing this catalog |
| `database_name` | TEXT | Oxla database containing this catalog |

The `auth_type` is derived from the proto's `auth_case()`:
`kOauth2` → `"oauth2"`, `kBasic` → `"basic"`, `kAwsSigv4` → `"aws_sigv4"`.

```sql
-- List all Iceberg catalogs
SELECT name, uri, auth_type FROM system.iceberg_catalogs;

-- Find AWS SigV4-authenticated catalogs
SELECT name, uri FROM system.iceberg_catalogs WHERE auth_type = 'aws_sigv4';
```

### `system.iceberg_tables`

One row per Iceberg table whose schema has been REFRESHed into Oxla's local
catalog. Only root-level Iceberg types (3-segment internal names) are listed;
nested types and Kafka sources are excluded.

| Column | Type | Description |
|--------|------|-------------|
| `database_name` | TEXT | Oxla database |
| `namespace_name` | TEXT | Oxla schema |
| `catalog_name` | TEXT | Iceberg catalog name |
| `name` | TEXT | Qualified Iceberg table path (e.g., `ns1.ns2.tbl`) |
| `oid` | INT | OID of the root UserType (joinable with `system.schema_types.oid` and `pg_type.oid`) |

Note: stale entries persist — dropping a table from the REST catalog does not
automatically remove it from `system.iceberg_tables`. The entry remains until
explicitly dropped in Oxla.

```sql
-- List all known Iceberg tables
SELECT * FROM system.iceberg_tables;

-- Filter by catalog
SELECT name FROM system.iceberg_tables WHERE catalog_name = 'my_ice';

-- Count tables per catalog
SELECT catalog_name, COUNT(*) AS table_count
FROM   system.iceberg_tables
GROUP BY catalog_name;

-- Join with system.iceberg_catalogs for the catalog URI
SELECT t.name, t.catalog_name, c.uri
FROM   system.iceberg_tables t
JOIN   system.iceberg_catalogs c ON t.catalog_name = c.name;
```

---

## Combining External Data with Native Tables

```sql
-- Load a parquet snapshot into a native table, then join with Kafka data
COPY orders_snapshot FROM 's3://my-bucket/snapshot/orders.parquet' (FORMAT parquet);

SELECT ks.order_id, ks.amount, snap.status
FROM   my_kafka=>orders ks
JOIN   orders_snapshot snap ON ks.order_id = snap.order_id
WHERE  snap.status = 'pending';
```

---

## Notes

- Storage credentials for `s3://`, `gs://`, and `wasbs://` paths can be
  supplied either via `CREATE STORAGE` (persistent, named connection) or inline
  per-statement using `AWS_CRED(...)`, `GCS_CRED(...)`, or `AZURE_CRED(...)`
  options on the `COPY` statement (see "Inline COPY Credentials" above).
- `FORMAT` values are case-insensitive (`parquet`, `PARQUET`, `Parquet` are all
  accepted).
- Multi-node Oxla clusters distribute parquet/ORC file reads using a hash-based
  assignment across nodes. Individual files are not split across nodes.
- The `mem://` protocol exists for internal/testing use; it is not intended for
  production data loading.
