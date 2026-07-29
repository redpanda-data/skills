# Oxla: Apache Iceberg Queries

Oxla connects to Apache Iceberg REST catalogs (e.g., Apache Polaris, AWS Glue
Data Catalog, Tabular) and can query Iceberg tables using the `catalog=>path.table`
syntax. Partition pruning and predicate pushdown are applied automatically.

Sources grounded in: `oxla/src/sqlparser/sql/CreateCatalogStatement.h`,
`oxla/src/sqlparser/sql/connection_option_names.h`,
`oxla/src/catalog/iceberg_catalog_parser.cpp`,
`oxla/src/iceberg_client/rest_catalog_config.h`,
`oxla/src/iceberg_client/apache_iceberg_client/apache_iceberg_client.h`,
`oxla/tests/MT/query_planner/cases/predefined_iceberg_*/`. Table/namespace DDL
grounded in `oxla/src/sqlparser/bison_parser/bison_parser.y`,
`oxla/src/sqlparser/sql/{CreateStatement.h,DropStatement.h,PartitionTerm.h}`,
`oxla/src/external_schema/iceberg/iceberg_schema_builder.cpp`, and
`oxla/tests/blackbox/pit/iceberg/test_iceberg_ddl.py`.

---

## CREATE ICEBERG CATALOG

```sql
CREATE ICEBERG CATALOG [IF NOT EXISTS] [<schema>.]<catalog_name>
  STORAGE <storage_schema>.<storage_name>
  WITH ( <option> = <value> [, ...] );
```

The `STORAGE` clause is **required** and names a previously created storage
connection (created via `CREATE STORAGE`) for object-store credentials.
`WITH (...)` carries catalog-level options.

### Options reference

All option names are grounded in `hsql::option_names::iceberg`
(`oxla/src/sqlparser/sql/connection_option_names.h`).

**Required:**

| Option | Description |
|--------|-------------|
| `uri` | REST catalog endpoint URL (e.g., `'https://catalog.example.com'`) |

**General:**

| Option | Description |
|--------|-------------|
| `warehouse` | Warehouse path or identifier (catalog-specific) |
| `auth_type` | Authentication mode: `'oauth2'`, `'basic'`, or `'aws_sigv4'`. Omit for unauthenticated. |

**OAuth2 options** (when `auth_type = 'oauth2'`):

| Option | Required | Description |
|--------|----------|-------------|
| `oauth2_client_id` | Yes | Client ID |
| `oauth2_client_secret` | Yes | Client secret (stored encrypted) |
| `oauth2_scope` | No | OAuth2 scope. Default: `'PRINCIPAL_ROLE:ALL'` (matches Redpanda's default). |
| `oauth2_token_endpoint_url` | No | Token endpoint URL. When omitted, Oxla discovers it from the catalog's `/config` endpoint (works with Polaris). Set explicitly for external IdPs (Okta, Azure AD). |
| `oauth2_token_refresh_margin_seconds` | No | Seconds before token expiry to trigger a refresh. Must be between 0 and INT32_MAX. |

**Basic auth options** (when `auth_type = 'basic'`):

| Option | Required | Description |
|--------|----------|-------------|
| `username` | Yes | HTTP basic auth username |
| `password` | Yes | HTTP basic auth password (stored encrypted) |

**AWS SigV4 options** (when `auth_type = 'aws_sigv4'`):

| Option | Required | Description |
|--------|----------|-------------|
| `aws_region` | Yes | AWS region (e.g., `'us-east-1'`) |
| `aws_access_key_id` | No* | AWS access key. Omit to use the default credential chain (env vars → shared config → STS web identity → IMDSv2/ECS). Both `aws_access_key_id` and `aws_secret_access_key` must either both be set or both be omitted. |
| `aws_secret_access_key` | No* | AWS secret access key |
| `aws_service_name` | No | SigV4 service segment. Default: `'glue'`. Use `'s3tables'` for S3 Tables REST catalog, `'execute-api'` for API Gateway-fronted catalogs. |

**TLS options:**

| Option | Default | Description |
|--------|---------|-------------|
| `ssl_verify` | `'true'` | TLS verification: `'true'` or `'false'` |
| `ssl_ca_info` | — | Path to CA bundle file (CURLOPT_CAINFO) |
| `ssl_ca_path` | — | Path to directory of CA certificates (CURLOPT_CAPATH) |
| `ssl_crl_file` | — | Path to PEM-formatted CRL file (CURLOPT_CRLFILE) |

### Examples

Each example assumes a storage connection named `my_s3` (or the provider-specific
name) already exists. Create it with `CREATE STORAGE` first (see the
`files-and-system-tables.md` reference or the sql-admin-api skill).

```sql
-- Unauthenticated local catalog (e.g., dev environment)
CREATE ICEBERG CATALOG local_cat
STORAGE public.my_local_storage
WITH (uri = 'http://localhost:8181');

-- Polaris with OAuth2 (token endpoint auto-discovered)
CREATE ICEBERG CATALOG polaris
STORAGE public.my_s3
WITH (
  uri                  = 'https://polaris.example.com/api/catalog',
  warehouse            = 'my-warehouse',
  auth_type            = 'oauth2',
  oauth2_client_id     = 'my-client-id',
  oauth2_client_secret = 'my-client-secret'
);

-- Polaris with explicit scope and token endpoint
CREATE ICEBERG CATALOG polaris_explicit
STORAGE public.my_s3
WITH (
  uri                         = 'https://polaris.example.com/api/catalog',
  auth_type                   = 'oauth2',
  oauth2_client_id            = 'client',
  oauth2_client_secret        = 'secret',
  oauth2_scope                = 'PRINCIPAL_ROLE:ALL',
  oauth2_token_endpoint_url   = 'https://polaris.example.com/oauth/tokens'
);

-- AWS Glue with static credentials
CREATE ICEBERG CATALOG glue
STORAGE public.my_s3
WITH (
  uri                    = 'https://glue.us-east-1.amazonaws.com/iceberg',
  auth_type              = 'aws_sigv4',
  aws_region             = 'us-east-1',
  aws_access_key_id      = 'AKIAIOSFODNN7EXAMPLE',
  aws_secret_access_key  = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
);

-- AWS Glue with EC2 instance-profile IAM role (no static keys)
CREATE ICEBERG CATALOG glue_iam
STORAGE public.my_s3
WITH (
  uri        = 'https://glue.us-east-1.amazonaws.com/iceberg',
  auth_type  = 'aws_sigv4',
  aws_region = 'us-east-1'
);

-- Basic auth catalog
CREATE ICEBERG CATALOG basic_cat
STORAGE public.my_s3
WITH (
  uri       = 'https://iceberg.example.com',
  auth_type = 'basic',
  username  = 'admin',
  password  = 'secret'
);

-- Catalog with TLS verification disabled (dev/self-signed)
CREATE ICEBERG CATALOG dev_ice
STORAGE public.my_s3
WITH (
  uri        = 'https://dev-catalog.internal',
  ssl_verify = 'false'
);
```

---

## Creating and dropping Iceberg tables and namespaces (DDL)

Beyond querying, Oxla can issue DDL **against an Iceberg REST catalog** through
SQL: create and drop namespaces, and create and drop tables (including their
partition spec). The catalog is addressed with the same `catalog=>path` operator
used for queries. These statements act on the external catalog directly — the
created table/namespace shows up for any Iceberg client, not just Oxla.

An Iceberg **table path always requires a namespace**: use
`catalog=>namespace.table`. A bare `catalog=>table` is a syntax error
(`iceberg table paths require a namespace; use "catalog=>namespace.table"`).

### Namespaces

```sql
-- Create a namespace (one or more dot-separated segments after =>)
CREATE NAMESPACE my_ice=>sales;
CREATE NAMESPACE IF NOT EXISTS my_ice=>sales;
CREATE NAMESPACE my_ice=>sales.eu WITH (key = 'value');   -- properties forwarded to the catalog

-- Drop a namespace. RESTRICT (the default) requires it to be empty.
DROP NAMESPACE my_ice=>sales;              -- RESTRICT (default)
DROP NAMESPACE my_ice=>sales RESTRICT;
DROP NAMESPACE IF EXISTS my_ice=>sales;
```

`CREATE NAMESPACE` without `IF NOT EXISTS` on an existing namespace fails
(duplicate schema); with `IF NOT EXISTS` it is a no-op. `DROP NAMESPACE ...
CASCADE` **parses but is rejected** (`DROP NAMESPACE CASCADE is not supported on
this catalog`) — drop the namespace's tables first, then drop it with the
default `RESTRICT` behavior.

### Tables

```sql
-- Create a table with an explicit column list (namespace required)
CREATE TABLE my_ice=>sales.orders (
    id      INT,
    amount  BIGINT NOT NULL,
    label   TEXT
);

CREATE TABLE IF NOT EXISTS my_ice=>sales.orders (id INT);

-- Partitioned table: PARTITION BY takes Iceberg partition transforms
CREATE TABLE my_ice=>sales.events (id INT, nm TEXT, d DATE)
PARTITION BY (day(d), bucket(8, id), truncate(4, nm));

-- Optional WITH (...) carries table properties forwarded to the catalog
CREATE TABLE my_ice=>sales.t (id INT) WITH (key = 'value');

-- Drop a table. Plain DROP removes only the catalog entry; PURGE also deletes
-- the table's data/metadata files from object storage.
DROP TABLE my_ice=>sales.orders;
DROP TABLE my_ice=>sales.orders PURGE;
DROP TABLE IF EXISTS my_ice=>sales.orders;
```

`CREATE TABLE ... AS SELECT` (CTAS) against an Iceberg catalog **parses but is
rejected** (`CREATE TABLE AS SELECT is not supported`). The options-only form
`CREATE TABLE cat=>tbl WITH (...)` (no column list) is the *Kafka* topic-binding
form; on an **Iceberg** catalog it is rejected (`... is an iceberg catalog;
creating a table on it requires a column definition list`).

### `PARTITION BY` transforms

`PARTITION BY (...)` accepts a comma-separated list of Iceberg partition
transforms over the table's columns. A column reference may be dot-separated to
descend into a struct field.

| Transform | Meaning |
|-----------|---------|
| `col` | identity — partition by the column value |
| `bucket(N, col)` | hash into `N` buckets |
| `truncate(W, col)` | truncate to width `W` |
| `year(col)` / `month(col)` / `day(col)` / `hour(col)` | date/time truncation |

`N` and `W` must be in `[1, 2147483647]` (Iceberg's signed 32-bit int range); an
out-of-range value is a parse error.

### SQL → Iceberg type mapping

Column types are translated to Iceberg types when the table is created (grounded
in `iceberg_schema_builder.cpp` and `test_iceberg_ddl.py`):

| SQL column type | Iceberg type |
|-----------------|--------------|
| `BOOL` | `boolean` |
| `INT` | `int` |
| `BIGINT` | `long` |
| `REAL` | `float` |
| `DOUBLE PRECISION` | `double` |
| `DATE` | `date` |
| `TIME` | `time` |
| `TIMESTAMP` | `timestamp` |
| `TIMESTAMPTZ` | `timestamptz` |
| `TEXT` | `string` |
| `BYTEA` | `binary` |
| `NUMERIC` (no params) | `decimal(18, 0)` |
| `NUMERIC(p, s)` | `decimal(p, s)` |
| `T[]` (array) | `list` of the element type |
| composite type (`CREATE TYPE ... AS (...)`) | `struct` of the fields |

- `NOT NULL` columns become **required** Iceberg fields; a plain or `NULL`
  column is optional. Array elements and composite/struct fields are always
  optional (SQL has no syntax for their nullability).
- Composite type names resolve through the session search path; qualify the name
  (`schema.type`) to reference a type in a schema off the search path.
- Types with no Iceberg equivalent are **rejected** with
  `column "<name>" has a type that cannot be represented in Iceberg`:
  `INTERVAL`, `JSON`, `JSONB`, `UUID`, `INT16`/`INT32` (the 128-/256-bit wide
  integers, wider than Iceberg's `long`), and the geo types `GEOMETRY`,
  `GEOGRAPHY`, `POINT`. The same applies when one of these is nested inside a
  composite or array; the error names the full column path (e.g. `c.span`,
  `c[]`).

### Authorization

Iceberg DDL is authorized against the **catalog's owner**: a role that can see a
catalog but does not own it cannot run `CREATE`/`DROP` against it (`permission
denied: must be owner of table <catalog>`). A schema-qualified reference
`schema.catalog=>...` additionally requires `USAGE` on that schema — denied
identically whether or not the catalog exists, so catalog names in a schema are
not discoverable without `USAGE`.

---

## Querying Iceberg Tables

Use the `catalog=>path.to.table` syntax. The path after `=>` is a dot-delimited
Iceberg namespace + table name (grounded in the test cases under
`oxla/tests/MT/query_planner/cases/predefined_iceberg_*/`).

```sql
-- Simple select — all columns
SELECT * FROM my_ice=>my.path.table1;

-- Project specific columns
SELECT age, name FROM test_iceberg_catalog=>my.path.table1;

-- Single-namespace table
SELECT id, name FROM my_ice=>ns.orders;
```

### Partition Pruning

Oxla pushes equality and range predicates on partition columns to the Iceberg
scan planner. The scan plan is computed by the Apache Iceberg C++ library via
`planScan`, which returns only the data files relevant to the filter.

```sql
-- Equality filter on an integer partition column
SELECT id FROM test_iceberg_catalog=>my.path.partitioned_table
WHERE id = 1;

-- Boolean partition column
SELECT id FROM test_iceberg_catalog=>my.path.partitioned_table
WHERE val_bool = false;

-- Date partition column
SELECT id FROM test_iceberg_catalog=>my.path.partitioned_table
WHERE val_date = DATE '2024-01-02';

-- Timestamp partition column (Iceberg days() transform)
SELECT id FROM test_iceberg_catalog=>my.path.partitioned_table
WHERE val_ts = TIMESTAMP '2024-01-03 12:00:00';

-- Range filter on integer partition
SELECT id, name FROM test_iceberg_catalog=>my.path.range_table
WHERE id < 3;

-- UNION ALL — each predicate prunes independently
SELECT id FROM test_iceberg_catalog=>my.path.partitioned_table WHERE id = 1
UNION ALL
SELECT id FROM test_iceberg_catalog=>my.path.partitioned_table WHERE val_bool = false;
```

### Multi-file Partitions

Tables with multiple data files per partition are supported transparently. Oxla
distributes file reads across nodes using a hash-based assignment.

```sql
SELECT id, name FROM test_iceberg_catalog=>my.path.multi_table
WHERE id = 1;
```

### Joins with Native Tables

```sql
-- Join an Iceberg table with a native Oxla table
SELECT o.order_id, c.name, o.total
FROM   my_ice=>sales.orders o
JOIN   customers c ON o.customer_id = c.id;
```

---

## Internal Client Details

The Iceberg client (`ApacheIcebergClient`) connects to the REST catalog and
provides:

- `listChildNamespaces` — browse catalog namespaces
- `listTables` — list tables in a namespace
- `getTableMetadata` — fetch full table metadata including schema, partitioning, and snapshots
- `getTableSchema` — fetch schema for a specific snapshot
- `planScan` — compute the set of data files to read given predicates

Note from the source: "Residual filters are not yet returned, so the consumer is
expected to handle all filtering during actual file scan." This means Oxla applies
the predicates again during the actual data read even after partition pruning.

---

## System Tables for Iceberg

Two system virtual tables expose Iceberg catalog metadata
(grounded in `oxla/src/metastore/system_iceberg_catalogs.cpp` and
`oxla/src/metastore/system_iceberg_tables.cpp`).

### `system.iceberg_catalogs`

Lists all Iceberg catalogs registered in the current database.

Columns:

| Column | Type | Description |
|--------|------|-------------|
| `name` | TEXT | Catalog name |
| `uri` | TEXT | REST catalog URI |
| `warehouse` | TEXT | Warehouse path (empty if not set) |
| `auth_type` | TEXT | Authentication type: `'oauth2'`, `'basic'`, `'aws_sigv4'`, or `''` |
| `namespace_name` | TEXT | Oxla schema (namespace) containing this catalog |
| `database_name` | TEXT | Oxla database containing this catalog |

```sql
-- List all Iceberg catalogs
SELECT * FROM system.iceberg_catalogs;

-- Find catalogs using OAuth2
SELECT name, uri FROM system.iceberg_catalogs WHERE auth_type = 'oauth2';
```

### `system.iceberg_tables`

Lists all Iceberg tables that have been REFRESHed into Oxla's local catalog.
One row per root Iceberg `UserType` (the 3-segment internal name with
`source == Iceberg`). Nested types and Kafka user types are excluded.

Note: Dropping an Iceberg table from the REST catalog leaves its `UserType`
in Oxla's catalog until explicitly dropped; the view continues to list it.

Columns:

| Column | Type | Description |
|--------|------|-------------|
| `database_name` | TEXT | Oxla database |
| `namespace_name` | TEXT | Oxla schema (namespace) |
| `catalog_name` | TEXT | Iceberg catalog name (owner segment of the internal name) |
| `name` | TEXT | Qualified Iceberg table path (e.g., `ns1.ns2.tbl`) |
| `oid` | INT | OID of the root UserType (joinable with `system.schema_types.oid` and `pg_type.oid`) |

```sql
-- List all known Iceberg tables
SELECT * FROM system.iceberg_tables;

-- Filter by catalog
SELECT catalog_name, name
FROM   system.iceberg_tables
WHERE  catalog_name = 'my_ice';

-- Find tables in a specific Oxla namespace
SELECT name, catalog_name
FROM   system.iceberg_tables
WHERE  namespace_name = 'public';
```

---

## Transparent Kafka-Iceberg Queries

When a Kafka catalog has an Iceberg catalog linked to it (via `USING CATALOG`),
Oxla can read Kafka topics through their Iceberg table representation. This is
called a "transparent" query.

The Kafka catalog connection must include a `pandaproxy_url` (the Panda Proxy
endpoint). The `using_catalog` and `using_catalog_schema` fields in the Kafka
catalog's internal proto control which Iceberg catalog and namespace to use for
schema lookup.

```sql
-- Kafka catalog with Iceberg link (full setup).
-- NOTE: USING CATALOG comes BEFORE the WITH clause on CREATE.
CREATE KAFKA CATALOG my_kafka
USING CATALOG my_iceberg_catalog
WITH (
  initial_brokers     = 'localhost:9092',
  schema_registry_url = 'http://localhost:8081',
  pandaproxy_url      = 'http://localhost:8082'
);

-- Query the Kafka topic; Oxla reads schema from Iceberg
SELECT age, name FROM my_kafka=>users;
```

In transparent mode, the topic's data columns are read from Iceberg data files.
The `redpanda` metadata struct is present and has the same fields as a direct
Kafka query: `partition` (INT), `offset` (BIGINT), `timestamp` (TIMESTAMPTZ),
`headers` (ARRAY of STRUCT), `key` (BYTEA), `timestamp_type` (INT).

Schema widening: if the Kafka Avro/Protobuf schema is a strict name-superset
of the Iceberg schema (additional fields in Kafka not present in Iceberg), Oxla
widens the column type to accommodate both. Arrays with widened struct elements
are also handled.
