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
| `INT` / `INTEGER` | — | 32-bit signed integer | `integer` |
| `LONG` | `BIGINT` | 64-bit signed integer | `bigint` |
| `INT16` | — | 128-bit (16-byte) wide signed integer | `int16` |
| `INT32` | — | 256-bit (32-byte) wide signed integer | `int32` |

`INT16` and `INT32` are **Oxla-native wide-integer types** — the number is the
byte width, not the bit width, so `INT16` is a 128-bit integer and `INT32` is a
256-bit integer (distinct `DataType::INT16` / `DataType::INT32` keywords in the
grammar, not aliases of `INT`). `pg_typeof()` reports them by their user-facing
names `int16` / `int32` — the same spelling you use in DDL and `CAST` (earlier
builds reported the internal names `i128` / `i256`). Do not confuse `INT32` with
`INT`/`INTEGER` (the 32-bit type).

```sql
CREATE TABLE example (
    normal_id INT,      -- 32-bit  (i32)
    big_id    LONG,     -- 64-bit  (i64)
    huge_id   INT16,    -- 128-bit (pg_typeof: int16)
    vast_id   INT32     -- 256-bit (pg_typeof: int32)
);

-- The wide types report their user-facing names via pg_typeof:
SELECT pg_typeof(CAST(1 AS int16));   -- int16
SELECT pg_typeof(CAST(1 AS int32));   -- int32
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

### UUID

`UUID` is a native, PostgreSQL-compatible type for RFC-4122 UUIDs. It is stored
as a 128-bit value and reports its user-facing name via `pg_typeof` as `uuid`.
It has a PostgreSQL OID and binary wire representation, so standard drivers
(psycopg2, JDBC, pgx, …) map it to their native UUID type.

```sql
CREATE TABLE sessions (
    id        UUID NOT NULL,
    parent_id UUID,          -- nullable
    trace_ids UUID[]         -- arrays of UUID are supported
);
```

Write a UUID with the typed-literal form `UUID '...'`, or as a bare string that
is coerced to `UUID` on insert:

```sql
INSERT INTO sessions VALUES
    (UUID 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', NULL, ARRAY[UUID '...']),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', NULL, NULL);   -- bare string coerced

SELECT id FROM sessions;
INSERT INTO archive SELECT * FROM sessions;                 -- INSERT ... SELECT
```

**Accepted input formats** (matching PostgreSQL): the canonical
`8-4-4-4-12` hex form, uppercase, wrapped in braces (`{...}`), with no hyphens,
or with hyphens on any 4-hex-digit boundary. Invalid input raises
`invalid input syntax for type uuid: "..."` (SQLSTATE `22P02`). UUIDs are always
**output** in canonical lowercase form.

**Casts.** `UUID` casts to and from the text types (`TEXT`, `VARCHAR`,
`VARCHAR(n)`, `CHAR(n)`) and to and from `BYTEA` (the RFC-4122 big-endian
16-byte serialization) in both directions; all of these casts are **explicit**
(`CAST`/`::`). There is no cast between `UUID` and the integer or wide-integer
(`INT16`/`INT32`) types.

```sql
SELECT CAST(UUID 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' AS TEXT);   -- uuid -> text
SELECT CAST('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' AS UUID);        -- text -> uuid
SELECT ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::VARCHAR(36))::uuid; -- via ::
SELECT CAST(UUID 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' AS BYTEA);  -- uuid -> bytea (16 bytes)
SELECT CAST(data AS UUID) FROM blobs;                               -- bytea column -> uuid
```

**`COPY` CSV.** A `UUID` column round-trips through `COPY ... TO` and
`COPY ... FROM` in `FORMAT CSV`: `COPY FROM` accepts every textual form a UUID
literal accepts (same parser as the cast from text), and `COPY TO` always writes
the canonical lowercase hyphenated form, whatever form was ingested. A malformed
value is an ordinary CSV parse error for that row — skip such rows with
`ON_ERROR IGNORE` (see [data-loading.md](data-loading.md)).

In the current engine, comparison, ordering, and grouping operators are not yet
defined on `UUID` (e.g. `WHERE id = ...`, `ORDER BY id`, `GROUP BY id`, and
joins on UUID columns): a `uuid`-vs-`uuid` or `uuid`-vs-integer comparison
raises `operator does not exist`. To filter or order by a UUID, cast it to text
first (`WHERE id::text = 'a0eebc99-...'`).

### OID

`OID` is the PostgreSQL object-identifier type, provided for compatibility with
tools and drivers (psql `\d`, pgx, ORMs, BI tools) that introspect the system
catalogs and key off type OID **26**. It is a 32-bit-backed scalar that reports
its user-facing name via `pg_typeof` as `oid`, is advertised by `pg_type`, and
is sent and received on the wire in both text and binary (4-byte big-endian)
formats, so binary-format bind parameters round-trip.

`oid` is a **non-reserved** datatype keyword: `x::oid`, `CAST(x AS oid)`, and
`col oid` in DDL all parse, while `oid` remains usable as an ordinary identifier
or column name (it is itself a `pg_catalog` column name).

```sql
CREATE TABLE catalog_ref (
    type_oid oid
);
```

**Text input** follows PostgreSQL's `oidin`: it accepts the signed-`int4` or
unsigned-`uint32` range and reinterprets a negative literal into the unsigned
space, so `'-1'::oid` = `4294967295` and `'-2147483648'::oid` = `2147483648`;
values outside `[INT32_MIN, UINT32_MAX]` are rejected. Output is always unsigned
decimal text.

**Equality, grouping, and joins.** `oid` is equality-comparable — `=`, `!=` /
`<>`, and `IS DISTINCT FROM` are defined — so `GROUP BY`, `SELECT DISTINCT`,
`UNION`, window `PARTITION BY`, and equi-joins all work on `oid` columns. An
integer literal can meet an `oid` in a predicate via an implicit `int4 → oid`,
so `WHERE type_oid = 26` works without an explicit cast.

**No ordering.** `oid` has no order: `ORDER BY`, window `ORDER BY`, `<`, `<=`,
`>`, `>=`, `min`, `max`, and `greatest`/`least` on an `oid` raise
`operator does not exist` rather than comparing incorrectly. (PostgreSQL orders
`oid`; this is a deliberate Oxla divergence.) To order by an `oid`, cast it to
`int4` first.

**Casts.** `int4 → oid` is **implicit**; `oid → int4`, `oid → text`, and
`text → oid` are **explicit** (`CAST`/`::`). There is no cast between `oid` and
the `bigint`, `boolean`, `numeric`, wide-integer (`INT16`/`INT32`), `bytea`, or
`uuid` types.

```sql
SELECT CAST(26 AS oid);           -- int4 -> oid (also implicit in predicates)
SELECT CAST(type_oid AS int) FROM catalog_ref;   -- oid -> int4 (explicit)
SELECT '2147483648'::oid;         -- text -> oid (unsigned range)
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

### Map values (`map(...)` and `m[key]`)

`map(...)` is an Oxla extension (not PostgreSQL) that builds a map value inline,
and `m[key]` looks a value up in it. There is **no `MAP` column type**: `MAP` is
not one of the declarable types in `ColumnType.h`, so there is no
`CREATE TABLE t (m MAP(...))` form. The constructor also takes **literals only**.
So the shape of the constructor is a *constant lookup table applied to a column* —
the map is constant, the subscript key is any expression. Map-typed **columns** do
exist, but only from an external schema (a Kafka source or an Iceberg table); see
[Map columns from an external schema](#map-columns-from-an-external-schema) below.

```sql
-- Constructor: alternating key, value, key, value, ...
SELECT map('a', 1, 'b', 2);           -- {"(a,1)","(b,2)"}  (see wire form below)

-- Lookup by key; the result type is the map's value type
SELECT (map('a', 1, 'b', 2))['a'];    -- 1
SELECT (map('a', 1, 'b', 2))['c'];    -- NULL (miss)
SELECT (map(1, 'x', 2, 'y'))[2];      -- 'y'

-- The useful form: constant code -> label map, keyed by a column
SELECT (map(1, 'new', 2, 'shipped', 3, 'closed'))[status_code] FROM orders;

-- The map's own type is visible through pg_typeof
SELECT pg_typeof(map('a', 1));        -- map(text,integer)
```

`map` is recognized by function name, not by a new reserved keyword, so an existing
identifier called `map` is unaffected. Only the plain call form is a constructor:
`map(DISTINCT ...)`, `map(...) OVER (...)`, and `map(...) WITHIN GROUP (...)` stay
on the ordinary function path, where they are rejected.

**Constructor rules:**

- Every argument must be a **literal**. A column reference or a volatile call is
  rejected: `SELECT map('a', random())` →
  `map() constructor for non-literals is not supported`. Only the subscript key may
  be a non-constant expression.
- The argument list must have an **even** number of elements
  (`map() requires an even number of arguments`).
- Keys may not be `NULL` (`map keys cannot be NULL`). Values may be.
- All keys are unified to one common key type, and all values to one common value
  type; each element is then resolved against that unified type.
- The key type must be a **primitive** type from the supported key set (below);
  `map(ROW(1, 2), 'x')` → `map key type must be a primitive type`.
- Neither keys nor values may carry decimal precision/scale — a
  `NUMERIC(p,s)`/`DECIMAL(p,s)` key or value is rejected
  (`map key type cannot have decimal precision/scale`, and the matching
  `map value type ...` message).
- Values are not restricted to primitives: a `ROW(...)` value works
  (`map('a', ROW(1, 2))`).
- `map()` with no arguments only works where the target map type is already known
  from context; on its own it fails with `cannot determine type of empty map`.

**Supported key types** (the `map_key` constraint, grounded in
`schema/constraints_instance.h`): `INT`, `BIGINT`, `INT16`, `INT32`, `FLOAT`,
`DOUBLE`, `BOOL`, `TEXT`, `BYTEA`, `TIMESTAMP`, `TIMESTAMPTZ`, `TIME`, `DATE`,
`UUID`, `OID`. Notably **not** supported as keys: `NUMERIC`/`DECIMAL`, `INTERVAL`,
`JSON`, the geospatial types, and any array/composite/map type. The same check is
re-applied to a map whose type came from an external schema, so a lookup on a map
with an unsupported key type is rejected when the query is planned.

**Lookup semantics:**

- Exactly one subscript. Maps do not support slicing — `(map('a', 1))['a':'b']` is
  rejected with `map does not support slicing`, unlike array slices.
- The lookup key is resolved to the map's key type, so a literal key is coerced
  like any other comparison operand.
- A missing key yields `NULL`, and a key stored with a `NULL` value yields `NULL`
  too — **a stored NULL is indistinguishable from a miss**.
- A `NULL` lookup key yields `NULL`.
- Duplicate keys are stored verbatim in argument order, and a lookup resolves to
  the **last** matching occurrence: `(map('a', 1, 'a', 2))['a']` → `2`.
- Map entries and keys are non-nullable by construction; only the value type
  participates in nullability.

**How a whole map reaches the client:** a map has no PostgreSQL wire type of its
own. It is physically an array of `{key, value}` pair composites, and that is what
it reports over the wire, so projecting a whole map (rather than an `m[key]` lookup)
arrives as an array of two-field records — `map('a', 1, 'b', 2)` renders as
`{"(a,1)","(b,2)"}`, and `map('a', ROW(1, 2))` as `{"(a,\"(1,2)\")"}`.

**What a map value does not support.** A map is neither an array nor a record, and
it carries no equality, ordering, or cast operators of its own, so the map value
itself cannot be grouped, sorted, deduplicated, concatenated, or cast — extract a
value with `m[key]` first:

| Expression | Error |
|---|---|
| `map('a', 1) \|\| 'x'::text` | `operator does not exist: map(text,integer) \|\| text` |
| `SELECT map('a', 1) GROUP BY 1` | `could not identify an equality operator for type map(text,integer)` |
| `SELECT map('a', 1) ORDER BY 1` | `could not identify an ordering operator for type map(text,integer)` |
| `SELECT DISTINCT map('a', 1)` | `could not identify an equality operator for type map(text,integer)` |
| `map('a', 1)::text` | `cannot cast type map(text,integer) to text` |

There is also no map-to-map cast and no map-to-array cast. An array of
`{key, value}` pairs can be coerced into a map type where a map is expected, since
that is the map's physical shape.

#### Map columns from an external schema

A column can hold a map when its type comes from an external schema rather than
from `CREATE TABLE`:

- a Kafka source whose **Avro** schema has a `map` field or whose **Protobuf**
  schema has a `map<K, V>` field, read under `struct_mapping_policy = 'COMPOUND'`
  (under `'JSON'` the same field collapses to a single `JSON` column);
- an **Iceberg** table with a `map` column.

Such a column behaves like any other map value: subscript it with `m[key]`, and the
lookup, miss-vs-stored-`NULL`, and last-duplicate-wins rules above all apply
unchanged. The key-type check is re-applied to the external type, so a map whose key
type is not in the supported key set is rejected when the query is planned. A lookup
result is a first-class value of the map's value type — descend into it (`(m['o']).a`
for a record value, `m['nums'][2]` for an array value) or use it in an expression.

```sql
-- Kafka source (COMPOUND policy) or Iceberg table with a map column
SELECT id, attrs['region'], attrs['missing'] FROM my_kafka=>events;
SELECT pg_typeof(attrs) FROM my_kafka=>events LIMIT 1;   -- e.g. map(text,bigint)
```

Because a whole map still has no wire type of its own, projecting the column itself
(`SELECT attrs`) returns the array-of-pairs text form; project `m[key]` lookups to
get typed values. Map columns cannot be created from SQL — there is no map column
type in `CREATE TABLE`, and `CREATE TABLE` against an Iceberg catalog has no map
type either. For how each format's map fields resolve, see
`/redpanda:sql-federated-queries`.

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
`INT16` (128-bit) and `INT32` (256-bit) are supported in both directions,
including `INT16 ↔ INT32`:

```sql
SELECT CAST(12345 AS int16);                 -- integer -> int16
SELECT CAST(9223372036854775807 AS int32);   -- bigint  -> int32
SELECT CAST(42.7 AS int16);                   -- float   -> int16 (rounds: 43)
SELECT CAST(CAST(5 AS int16) AS int32);       -- int16   -> int32
SELECT CAST(CAST(5 AS int16) AS bigint);      -- int16   -> bigint
SELECT CAST('170141183460469231731687303715884105727' AS int16);  -- text -> int16
```

- Widening (e.g. `int -> int16`, `int16 -> int32`) is **implicit**; narrowing
  and float↔wide casts are **explicit** (require `CAST`/`::`).
- Narrowing that overflows the target raises an out-of-range error; non-finite
  or over-range floats are rejected.
- `bool ↔ INT16`/`INT32` is not allowed, matching the rest of the cast table.

The six comparison operators (`=`, `!=`, `<`, `<=`, `>`, `>=`) work on the
wide-integer types, returning `boolean`. They cover same-width (`INT16`↔`INT16`,
`INT32`↔`INT32`), mixed-width (`INT16`↔`INT32`), and wide-vs-narrow (`INT16`/`INT32`
compared with `INT`/`BIGINT`) — the narrower operand is implicitly widened.

```sql
SELECT INT16 '1' < INT16 '2';     -- boolean
SELECT INT16 '1' = INT32 '2';     -- mixed width (INT16 vs INT32)
SELECT huge_id >= 5 FROM my_table;-- wide vs narrow integer
```

Arithmetic, unary-sign, and bitwise operators are also defined on the
wide-integer types — registered same-width (`INT16`⊕`INT16`, `INT32`⊕`INT32`),
with a narrower integer operand implicitly widened:

- Binary arithmetic: `+`, `-`, `*`, `/`, `%`.
- Unary `+` / `-`. Negating a type's most-negative value overflows and raises an
  out-of-range error (matching `INT`/`BIGINT`).
- Bitwise / shift: `&`, `|`, `#` (XOR), `~`, `<<`, `>>` (the shift amount is an
  ordinary `INTEGER`).

```sql
SELECT INT16 '10' + INT16 '5';    -- INT16
SELECT 1 + INT16 '1';             -- INT16 (INT literal widened to INT16)
SELECT -INT16 '5';                -- INT16
SELECT INT16 '12' % INT16 '5';    -- INT16
SELECT INT16 '6' << 2;            -- INT16
```

Integer literals that overflow `BIGINT` (64-bit) auto-promote to the narrowest
wide type that holds them — `INT16` through the 128-bit range, then `INT32`
through the 256-bit range; a literal beyond `INT32`'s range is rejected as out of
range:

```sql
SELECT pg_typeof(9223372036854775808);                      -- int16
SELECT pg_typeof(170141183460469231731687303715884105728);  -- int32
```

`ORDER BY` on a wide-integer column is supported, including the
`ORDER BY ... LIMIT` (top-k) form.

**Wide-integer bind parameters.** A wide-integer value can be sent as an
extended-protocol bind parameter, in either the text or the binary parameter format:
the value is its **decimal string** in both cases (the wide types are surfaced to
clients as domains over text, so there is no packed 16-/32-byte binary form). With a
standard driver, bind the parameter as a string and let the target column or cast
coerce it:

```java
// pgJDBC
PreparedStatement ps = conn.prepareStatement("SELECT CAST(? AS int16)");
ps.setString(1, "170141183460469231731687303715884105727");
```

```php
// PDO — turn emulated prepares off, or the driver interpolates client-side
$conn->setAttribute(PDO::ATTR_EMULATE_PREPARES, false);
$stmt = $conn->prepare('SELECT CAST(:wide AS int32)');
$stmt->bindValue('wide', '57896044618658097711785492504343953926634992332820282019728792003956564819967', PDO::PARAM_STR);
```

Malformed wide-integer text is reported as
`invalid input syntax for type int16: "..."` (or `int32`) with SQLSTATE `22P02`
(`invalid_text_representation`), matching the `uuid`, point, and decimal parsers; a
value that parses but exceeds the type's range is a separate out-of-range error
(SQLSTATE `22003`).

---

## What PostgreSQL features are NOT in Oxla

- No `SERIAL` / `SEQUENCE` auto-increment columns (not found in test cases).
- No `EXPLAIN <query>` SQL statement. Query-plan output is controlled by config flags `feature_flags.print_query_plan` and `feature_flags.pipeline_visualization`, not by an EXPLAIN command.
- No `FOREIGN KEY` constraints.
- No `ALTER TABLE ... ADD/DROP/RENAME COLUMN`. The only `ALTER TABLE` form re-binds an external Redpanda/Kafka catalog table via `ALTER TABLE IF EXISTS catalog=>table_name WITH (...)` (use `IF EXISTS` and the `catalog=>table_name` external-source form). See [kafka-iceberg.md](kafka-iceberg.md). To change schema, use `CREATE TABLE AS SELECT`.
- `SELECT INTO` supports both a table destination (`SELECT ... INTO new_table FROM ...`) and a file destination (`SELECT ... INTO 'path' (options) FROM ...`). See ddl-dml.md.
