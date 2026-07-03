# Connect and Data Types

## Connection

Oxla listens on the PostgreSQL wire protocol. The default port is **5432**
(configured via `network.postgresql.port` in `default_config.yml`).

### Default credentials

From `config/Release/default_config.yml`:

```yaml
access_control:
  mode: default
  initial_password: oxla
```

The default user is `oxla` and the default password is `oxla`.

### psql

```bash
# Interactive session
psql -h localhost -p 5432 -U oxla oxla

# One-liner with password in env var
PGPASSWORD=oxla psql -h localhost -p 5432 -U oxla oxla

# Non-interactive single command
PGPASSWORD=oxla psql -h localhost -p 5432 -U oxla oxla -c "SELECT 1;"
```

### Python (psycopg2)

```python
import psycopg2

conn = psycopg2.connect(
    host="localhost",
    port=5432,
    user="oxla",
    password="oxla",
    dbname="oxla"
)
cur = conn.cursor()
cur.execute("SELECT COUNT(*) FROM my_table")
row = cur.fetchone()
print(row)
cur.close()
conn.close()
```

### Python (asyncpg)

```python
import asyncpg
import asyncio

async def main():
    conn = await asyncpg.connect(
        host="localhost", port=5432,
        user="oxla", password="oxla", database="oxla"
    )
    row = await conn.fetchrow("SELECT COUNT(*) AS n FROM my_table")
    print(row["n"])
    await conn.close()

asyncio.run(main())
```

### Go (pgx)

```go
import (
    "context"
    "github.com/jackc/pgx/v5"
)

conn, err := pgx.Connect(context.Background(),
    "postgres://oxla:oxla@localhost:5432/oxla")
if err != nil {
    panic(err)
}
defer conn.Close(context.Background())

var count int64
conn.QueryRow(context.Background(),
    "SELECT COUNT(*) FROM my_table").Scan(&count)
```

### JDBC

```java
// Maven: org.postgresql:postgresql
String url = "jdbc:postgresql://localhost:5432/oxla";
Properties props = new Properties();
props.setProperty("user", "oxla");
props.setProperty("password", "oxla");
Connection conn = DriverManager.getConnection(url, props);
```

### Connection string format

```
postgres://oxla:oxla@<host>:5432/oxla
```

## SSL / TLS

SSL is controlled by `ssl.mode` in the config. Default is `"off"`.

Supported modes:
- `off` — no SSL
- `optional` — both SSL and plain-text connections accepted
- `require` — only SSL connections allowed

To require SSL:

```yaml
ssl:
  mode: "require"
  ca_crt_file: "/path/to/ca.crt"
  cert_file: "/path/to/server.crt"
  key_file: "/path/to/server.key"
  min_protocol_version: 1.2
  max_protocol_version: 1.3
```

Override with env var:

```bash
OXLA__SSL__MODE=require
```

## Overriding the port

```bash
# Via config file
network:
  postgresql:
    port: 5433

# Via environment variable (OXLA__ prefix, __ as path separator)
docker run -e OXLA__NETWORK__POSTGRESQL__PORT=5433 ...
```

## OIDC Authentication

Oxla supports OIDC-based authentication (disabled by default):

```yaml
oidc:
  enabled: false
  issuer_url: ""
  audience: ""
  oidc_principal_mapping: "$.sub"
  disable_password_auth: false
  require_tls: true
  protected_users:
    - "oxla"
```

When OIDC is enabled, clients pass a JWT as the password. The `protected_users`
list specifies users that always use password auth (not OIDC).

---

## Supported Data Types

Grounded in `src/sqlparser/sql/ColumnType.h` (`enum class DataType`).

### Integer types

| Type | Alias | Width | `pg_typeof` |
|------|-------|-------|-------------|
| `INT` / `INTEGER` | — | 32-bit signed integer | `i32` |
| `LONG` | `BIGINT` | 64-bit signed integer | `i64` |
| `INT16` | — | 128-bit (16-byte) wide signed integer | `i128` |
| `INT32` | — | 256-bit (32-byte) wide signed integer | `i256` |

`INT16` and `INT32` are **Oxla-native wide-integer types** — the number is the
byte width, not the bit width, so `INT16` is a 128-bit integer and `INT32` is a
256-bit integer (distinct `DataType::INT16` / `DataType::INT32` keywords in the
grammar, not aliases of `INT`). `pg_typeof()` reports them as `i128` / `i256`.
Do not confuse `INT32` with `INT`/`INTEGER` (the 32-bit type).

```sql
CREATE TABLE example (
    normal_id INT,      -- 32-bit  (i32)
    big_id    LONG,     -- 64-bit  (i64)
    huge_id   INT16,    -- 128-bit (i128)
    vast_id   INT32     -- 256-bit (i256)
);

-- The wide types report their internal names via pg_typeof:
SELECT pg_typeof(CAST(1 AS int16));   -- i128
SELECT pg_typeof(CAST(1 AS int32));   -- i256
```

### Floating-point types

| Type | Width |
|------|-------|
| `FLOAT` | 32-bit IEEE 754 |
| `DOUBLE` | 64-bit IEEE 754 |

```sql
CREATE TABLE metrics (
    ratio  FLOAT,
    value  DOUBLE
);
```

### Fixed-precision numeric

| Type | Syntax |
|------|--------|
| `NUMERIC` / `DECIMAL` | `NUMERIC(precision, scale)` |

```sql
CREATE TABLE pricing (
    price NUMERIC(18, 4)
);

-- Cast examples (from test cases)
SELECT f0::decimal(8, 2)  FROM tb1;
SELECT d0::decimal(15, 5) FROM tb1;
SELECT t0::decimal(10, 0) FROM tb1;
SELECT d0::int, d0::bigint FROM tb1;
```

### String types

Oxla's bison grammar maps several keywords to the `STRING` internal type.
Only the parameterized forms carry a length:

| Type | Internal representation | Notes |
|------|------------------------|-------|
| `STRING` | `DataType::STRING` | Oxla-native keyword, unbounded |
| `TEXT` | `DataType::STRING` | Alias for STRING |
| `CHAR` (no length) | `DataType::STRING` | Bare CHAR collapses to STRING |
| `VARCHAR` (no length) | `DataType::STRING` | Bare VARCHAR collapses to STRING |
| `CHAR(n)` | `DataType::CHAR` | Fixed-length, carries `n` |
| `VARCHAR(n)` | `DataType::VARCHAR` | Variable-length up to `n`, carries `n` |

If you use `pg_typeof()` on a column declared as `TEXT`, `STRING`, or bare
`VARCHAR`/`CHAR`, it will report the underlying STRING type.

```sql
CREATE TABLE users (
    code  CHAR(3),         -- DataType::CHAR, length 3
    name  VARCHAR(255),    -- DataType::VARCHAR, length 255
    notes TEXT,            -- DataType::STRING
    tag   STRING           -- DataType::STRING (Oxla-native)
);
```

### Date and time types

| Type | Notes |
|------|-------|
| `DATE` | Calendar date (year-month-day) |
| `TIME` | Time of day without timezone |
| `TIMETZ` | Time of day with timezone |
| `TIMESTAMP` | Date + time without timezone |
| `TIMESTAMPTZ` | Date + time with timezone |
| `INTERVAL` | Duration / elapsed time |

```sql
CREATE TABLE events (
    event_date DATE,
    start_time TIME,
    created_at TIMESTAMP,
    updated_at TIMESTAMPTZ,
    duration   INTERVAL
);

-- Literals (from test cases)
SELECT DATE '2001-02-16';
SELECT TIMESTAMP '2022-1-3 14:17:34';
SELECT INTERVAL '13 month';
SELECT INTERVAL '73 day';
SELECT '1 day 1 month'::INTERVAL;
SELECT '533 minute'::INTERVAL;
```

### Boolean

```sql
CREATE TABLE flags (
    is_active BOOL
);

SELECT * FROM flags WHERE is_active;
SELECT * FROM flags WHERE is_active IS TRUE;
SELECT * FROM flags WHERE is_active IS NOT NULL;
```

### JSON types

| Type | Notes |
|------|-------|
| `JSON` | JSON document stored as text |
| `JSONB` | Binary JSON |

JSON extraction operators (from test cases):

```sql
-- Extract as JSON
SELECT col->>'key'  FROM tb1;  -- operator_json_extract_as_text
-- Extract nested
SELECT col->'key'   FROM tb1;  -- operator_json_extract_as_json
```

### Binary

```sql
CREATE TABLE blobs (
    data BYTEA
);
```

### Array types

Arrays are supported via the `ARRAY` data type. The element type is specified
inline (e.g., `INT[]`, `FLOAT[]`). Grounded in `feature_flags.array_support: true`.

```sql
CREATE TABLE vectors (
    ids    INT[],
    scores FLOAT[]
);

-- Array literal
INSERT INTO vectors SELECT ARRAY[1, 2, 3], ARRAY[0.1, 0.2, 0.3];

-- Array indexing (1-based)
SELECT (ARRAY[1, 2, 3])[2];

-- Array slice
SELECT (ARRAY[1, 2, 3])[0:2];

-- Array functions
SELECT ARRAY_APPEND(ids, 4)     FROM vectors;
SELECT ARRAY_PREPEND(0, ids)    FROM vectors;
SELECT ARRAY_UPPER(ids, 1)      FROM vectors;

-- pg_typeof
SELECT PG_TYPEOF(ids) FROM vectors;
```

### Geospatial types

| Type | Notes |
|------|-------|
| `GEOMETRY` | Generic geometry |
| `GEOGRAPHY` | Geography with coordinate system |
| `POINT` | Point geometry |

```sql
CREATE TABLE locations (
    geom     GEOMETRY,
    geo_area GEOGRAPHY,
    pt       POINT
);

-- Geospatial functions (from test cases)
SELECT ST_ASEWKT(CAST(point0 AS GEOMETRY)) FROM locations;
SELECT ST_DISTANCE(geography0, GEOGRAPHY 'POINT(60.1699 24.9384)') FROM locations;
SELECT ST_DISTANCE(geography0, geography1) FROM locations;
```

### Composite / ROW types

```sql
-- ROW literals (from test cases)
SELECT ROW(1, 2.5, 'hello');
SELECT ROW(1, ARRAY[10, 20]);
SELECT ROW(i0, a0) FROM tb1;

-- Composite comparisons
SELECT ROW(1, 'foo') = ROW(1, 'bar');
SELECT ROW(1, 'foo') < ROW(2, 'bar');
SELECT ROW(ROW(1, 2), 'foo') = ROW(ROW(3, 4), 'bar');
```

---

## Type Casting

Use `::type` syntax or `CAST(expr AS type)`:

```sql
SELECT i0::bigint FROM tb1;
SELECT f0::decimal(8,2) FROM tb1;
SELECT d0::int FROM tb1;
SELECT t0::decimal(10,0) FROM tb1;
SELECT CAST(point0 AS GEOMETRY) FROM locations;
SELECT CAST(s0 AS INT) FROM tb1;
```

### Casting to/from the wide-integer types (`INT16`/`INT32`)

Casts between the builtin integer/float/text types and the wide-integer types
`INT16` (i128) and `INT32` (i256) are supported in both directions, including
`i128 ↔ i256`:

```sql
SELECT CAST(12345 AS int16);                 -- integer  -> i128
SELECT CAST(9223372036854775807 AS int32);   -- bigint   -> i256
SELECT CAST(42.7 AS int16);                   -- float    -> i128 (rounds: 43)
SELECT CAST(CAST(5 AS int16) AS int32);       -- i128     -> i256
SELECT CAST(CAST(5 AS int16) AS bigint);      -- i128     -> bigint
SELECT CAST('170141183460469231731687303715884105727' AS int16);  -- text -> i128
```

- Widening (e.g. `int -> int16`, `int16 -> int32`) is **implicit**; narrowing
  and float↔wide casts are **explicit** (require `CAST`/`::`).
- Narrowing that overflows the target raises an out-of-range error; non-finite
  or over-range floats are rejected.
- `bool ↔ INT16`/`INT32` is not allowed, matching the rest of the cast table.

---

## What PostgreSQL features are NOT in Oxla

- No `SERIAL` / `SEQUENCE` auto-increment columns (not found in test cases).
- No `EXPLAIN <query>` SQL statement. Query-plan output is controlled by config flags `feature_flags.print_query_plan` and `feature_flags.pipeline_visualization`, not by an EXPLAIN command.
- No `FOREIGN KEY` constraints.
- No `ALTER TABLE ... ADD/DROP/RENAME COLUMN`. The only `ALTER TABLE` form re-binds an external Redpanda/Kafka catalog table via `ALTER TABLE IF EXISTS catalog=>table_name WITH (...)` (use `IF EXISTS` and the `catalog=>table_name` external-source form). See [kafka-iceberg.md](kafka-iceberg.md). To change schema, use `CREATE TABLE AS SELECT`.
- `SELECT INTO` supports both a table destination (`SELECT ... INTO new_table FROM ...`) and a file destination (`SELECT ... INTO 'path' (options) FROM ...`). See ddl-dml.md.
