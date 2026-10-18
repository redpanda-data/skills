Source: cloud-docs `modules/sql/pages/connect-to-sql/authenticate.adoc`, `modules/sql/pages/connect-to-sql/language-clients/{psycopg2,java-jdbc,php-pdo,dotnet-dapper}.adoc`, `modules/sql/pages/get-started/sql-quickstart.adoc`, `modules/sql/pages/query-data/sql-editor.adoc`, `modules/reference/pages/sql/sql-data-types/**`, `modules/sql/pages/get-started/redpanda-sql-vs-postgresql.adoc` (verified 2026-10-18). File-by-file mapping in [SOURCES.md](SOURCES.md).

# Connect and Data Types

## Connection parameters

Redpanda SQL is reached only through the cluster's SQL endpoint on Redpanda Cloud
BYOC. Read the host and port from the **SQL** tab of the cluster's **How to
connect** panel in the Cloud Console and copy the connection string shown there;
do not guess them.

| Parameter | Value |
|---|---|
| Host | the SQL endpoint from the **SQL** tab |
| Port | from the **SQL** tab (the published quickstart's string uses `5432`) |
| Database | `oxla` (the single database Redpanda SQL exposes) |
| TLS | required: `sslmode=require`; plain-text connections are rejected |
| Auth | selected by the `options` connection parameter (below) |

Prerequisite: the user or service account has a Redpanda Cloud role with the
*SQL: Access* or *SQL: Manage* data-plane permission. Assigning it provisions the
matching user in the SQL engine. Role assignment and enabling SQL are covered by
`/redpanda:sql-admin-api`.

## Authentication modes

| Mode | `options` | `user` | Password field | Use for |
|---|---|---|---|---|
| Bearer token | `auth_method=bearer` | ignored | JWT from `rpk cloud auth token` | people who signed in with `rpk cloud login` |
| Client credentials | `auth_method=client_secret` | service account client ID | service account client secret | scheduled jobs, BI tools, service-to-service |
| SCRAM password | omit | account or service-account email | password set with `ALTER USER` | legacy clients that cannot do OIDC |

```bash
# Bearer token
rpk cloud login
PGPASSWORD=$(rpk cloud auth token) \
  psql "host=<sql-host> port=<sql-port> dbname=oxla user=ignored options='auth_method=bearer' sslmode=require"

# Client credentials (Redpanda SQL exchanges them for a token)
PGPASSWORD="$CLIENT_SECRET" \
  psql "host=<sql-host> port=<sql-port> dbname=oxla user=<client-id> options='auth_method=client_secret' sslmode=require"

# SCRAM (no options parameter)
PGPASSWORD='shared_secret' \
  psql "host=<sql-host> port=<sql-port> dbname=oxla user=service-account@example.com sslmode=require"
```

Rules:

- With a bearer token, `user=` is ignored and `current_user` is the principal from
  the token.
- A token sent **without** `options='auth_method=bearer'` is treated as a SCRAM
  password and the login fails.
- Tokens are short-lived and validated only at connect time. An open session keeps
  running after expiry; reconnect with a fresh `rpk cloud auth token`.
- SCRAM setup: assign the service account *SQL: Access* (or *SQL: Manage*), then a
  *SQL: Manage* user sets a password, because the auto-provisioned password is not
  exposed:

  ```sql
  ALTER USER "service-account@example.com" WITH PASSWORD 'shared_secret';
  ```

  The password survives cluster operations. If the account loses its SQL role in
  Redpanda Cloud, `CONNECT` is revoked and the client can no longer sign in.

## Language clients

Any PostgreSQL driver can connect. Pass host, port, database `oxla`, user,
password, TLS, and (for OIDC) the `options` value through the driver's own
connection settings. Redpanda SQL is read-only, so drivers are for `SELECT` and
the other published statements; driver features for writes, transactions, and
server-side prepared statements do not apply.

### Python (psycopg2)

```python
import os
import psycopg2

# export BEARER_TOKEN=$(rpk cloud auth token)
conn = psycopg2.connect(
    host="<sql-host>",
    port=<sql-port>,
    dbname="oxla",
    user="ignored",
    password=os.environ["BEARER_TOKEN"],
    options="auth_method=bearer",
    sslmode="require",
)
cur = conn.cursor()
cur.execute("SELECT status, COUNT(*) FROM default_redpanda_catalog=>orders GROUP BY status")
for row in cur.fetchall():
    print(row)
cur.close()
conn.close()
```

- Supported: `connect()`, cursors, `execute`, `executemany`, `fetchone` /
  `fetchmany` / `fetchall`, `description`, `rowcount`, `server_version`,
  `protocol_version`, encoding and status calls, and normal exception handling.
- Limited: `isolation_level` and `copy_to`; `commit()`/`rollback()` exist but
  transactions give no guarantees. `copy_from` does not apply, because `COPY
  FROM` is not available.
- Not supported: async connections (`poll`, `cancel`, `isexecuting`),
  `batch_execute`; server-side cursors, notifications, prepared statements, and
  pipeline mode may not work. Do not share connections or cursors across threads.

### Java / Kotlin (JDBC)

Use the PostgreSQL JDBC driver with a `jdbc:postgresql://<host>:<port>/oxla` URL
and pass the user and password (plus TLS and the `options` value) as connection
properties.

```kotlin
DriverManager.getConnection("jdbc:postgresql://$address:$port/$databaseName", user, password)
```

Not supported: `Connection.createArrayOf`, `getTransactionIsolation`,
`setTransactionIsolation`, `setSavepoint`, `prepareStatement` with an int array;
`ResultSet.refreshRow`, `moveToCurrentRow`; `Statement.RETURN_GENERATED_KEYS`,
`executeUpdate` with auto-generated keys, `execute` with an int array, `cancel`;
`PreparedStatement.setDate`, `setObject`, and `setString` of a `PGInterval`.

### PHP (PDO)

```php
$conn = new PDO(
    "pgsql:host=<sql-host>;port=<sql-port>;dbname=oxla;sslmode=require",
    "<username>",
    "<password>",
    [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => true,   // required, or queries fail with "prepared statement" errors
    ]);
```

For full endpoint verification, append `sslmode=verify-full;sslrootcert=<path>` to
the DSN. Not supported: large objects (`pgsqlLOBCreate`/`pgsqlLOBOpen`),
`pgsqlGetPid`, the `pgsqlCopy*` helpers, `pgsqlGetNotify` (LISTEN/NOTIFY),
`lastInsertId`, and the transaction methods; `rowCount` may be wrong.

### C# (Dapper with Npgsql)

```csharp
var dataSource = NpgsqlDataSource.Create(connectionString);   // Npgsql connection string: host, port, Database=oxla, credentials, SSL
var connection = dataSource.OpenConnection();
var rows = connection.Query<Order>("SELECT order_id, customer FROM default_redpanda_catalog=>orders");
```

Parameterized queries work, but Redpanda SQL does not support prepared statements:
bound values are converted back into query text, so there is no security or
performance gain. Not supported: `BeginTransaction`, `CommandType.StoredProcedure`,
and function in/out parameters.

---

## Data types

Topic-backed tables get their column types from the topic's registered schema
(Avro, Protobuf, or JSON). The types below are what queries see and what casts
target. Cast with `CAST(expr AS type)` or `expr::type`. Explicit casts can lose
precision or clip out-of-range values, and overflow in arithmetic or aggregates is
undefined; widen to `bigint` (or `int16`) where sums can grow.

| Type | Aliases | Notes |
|---|---|---|
| `int` | `integer` | 32-bit signed |
| `bigint` | `long` | 64-bit signed |
| `int16`, `int32` | — | 128-bit and 256-bit signed; for casts only |
| `real` | `float4` | 32-bit IEEE 754 |
| `double precision` | `double`, `float`, `float8` | 64-bit IEEE 754 |
| `numeric(p, s)` | `decimal(p, s)` | exact; precision 1–76 |
| `text` | — | UTF-8 |
| `bytea` | — | raw bytes |
| `bool` | `boolean` | `TRUE` / `FALSE` |
| `date`, `time` | — | `YYYY-MM-DD`; `HH:MM:SS[.SSSSSS]` |
| `timestamp` | timestamp without time zone | microsecond precision |
| `timestamp with time zone` | — | see time zones below |
| `interval` | — | span of time |
| `json` | — | JSON document |
| `uuid` | — | 128-bit identifier |
| arrays | `type[]`, `type ARRAY` | single-dimensional |
| `row` | — | composite (struct) |
| `map` | — | key-value pairs |
| `geometry`, `geography` | — | `POINT` values only |

### Numeric

- `float` means `double precision`, as in PostgreSQL. Use `real` for 32-bit.
- Scientific notation works: `SELECT 1.1e+3, 1e-20;`.
- `numeric`: `NUMERIC(p)` has scale 0; bare `NUMERIC` is `NUMERIC(18, 0)`; scale
  cannot be negative and the value cannot be NaN or infinite. Values come from
  Avro `decimal` fields (precision above 76 and Avro `big-decimal` are not
  supported), from Iceberg `decimal(p, s)` columns, or from casts.
- `numeric` works in comparisons, `GROUP BY`, `ORDER BY`, window partitions,
  `JOIN` conditions, and `COALESCE` (same scale). It does **not** yet support
  `+ - * /`, `sum`/`avg`/`min`/`max`, or `to_char`. Cast to `double precision` to
  calculate; the result is not exact:

  ```sql
  SELECT order_id, amount
  FROM default_redpanda_catalog=>orders
  WHERE amount > '100.00'::NUMERIC(10, 2)
  ORDER BY amount DESC;

  SELECT avg(amount::DOUBLE PRECISION) FROM default_redpanda_catalog=>orders;
  ```

- A number literal with a decimal point (`12.50`) is read as floating point, about
  15 significant digits. Cast a **string** literal (`'12.50'::NUMERIC(5, 2)`) to
  keep every digit.
- `int16`/`int32`: the number is the size in bytes. They cannot be stored in a
  table in a Redpanda or Iceberg catalog; use them in casts. The sum of `int16`
  values is `int32`:

  ```sql
  SELECT sum(views::INT16) AS total_views FROM default_redpanda_catalog=>page_events;
  ```

### Text and bytea

- `text` is UTF-8; `length()` counts characters, not bytes.
- `bytea` literals: `'\xDEADBEEF'::bytea` (hex) or `'\336\255'::bytea` (escape).
  Supported operations are only `=` / `<>`, casting from a string literal,
  `length()` and `octet_length()` (byte counts), and `encode(data, 'hex' |
  'base64' | 'escape')` / `decode(text, format)`. Binary schema fields (Protobuf
  `bytes`, Avro `bytes`/`fixed`, Iceberg binary/fixed) and record metadata such as
  `redpanda.key` arrive as `bytea`.

### Date, time, timestamp, interval

```sql
SELECT DATE '2024-03-15', TIME '10:14:25', TIMESTAMP '2024-03-15 10:14:25.123456';
SELECT INTERVAL '5 years 4 months 2 weeks 3 days 5 hours 10 minutes 25 seconds';
SELECT INTERVAL '10 yr 8 months 6 d 5 hrs 10 min 20 s';
SELECT INTERVAL '1-2 3 DAYS 04:05:06.070809';
SELECT INTERVAL '2-4 5 DAYS 04:05:06.070809' YEAR TO MONTH;
```

- Interval units: millennium, century, decade, year (`y`, `yr`, `yrs`), month,
  week, day (`d`), hour (`h`, `hr`, `hrs`), minute (`min`, `mins`, `m`), second
  (`s`, `sec`, `secs`), millisecond (`ms`), microsecond. Field qualifiers: `YEAR`,
  `MONTH`, `DAY`, `HOUR`, `MINUTE`, `SECOND`, and the `X TO Y` ranges.
- Interval arithmetic assumes 1 month = 30 days and 1 day = 24 hours, so adding
  `30 days` is not always the same as adding `1 month`.
- Arithmetic: `date ± integer`, `date ± interval`, `date - date`, `date + time`,
  `time ± interval`, `time - time`, `timestamp ± interval`,
  `timestamp - timestamp` (an interval), `interval ± interval`,
  `interval * integer`, `interval * double precision`, `interval / number`.
- Time zones: `timestamp with time zone` values are rendered in UTC; the
  session display time zone is fixed to UTC. `ts AT TIME ZONE 'zone'` on a `timestamp`
  interprets it in that zone and returns a `timestamp with time zone`:

  ```sql
  SELECT visit_ts, visit_ts AT TIME ZONE 'MST' AS visit_mst
  FROM default_redpanda_catalog=>visits;
  ```

### JSON

```sql
SELECT payload -> 'items'          AS items_json,   -- json
       payload ->> 'customer'      AS customer,     -- text
       json_extract_path_text(payload, 'customer') AS customer_too
FROM default_redpanda_catalog=>orders_json;
```

JSON equality is key-order-sensitive: `'{"a":1,"b":"c"}'::json =
'{"b":"c","a":1}'::json` is false. Nested topic records mapped with
`struct_mapping_policy = 'JSON'` arrive as `json` columns. JSON functions are in
[functions-and-analytics.md](functions-and-analytics.md#json-functions).

### UUID

UUID columns come from Avro fields with the `uuid` logical type (Protobuf and JSON
have none) and from Iceberg history. Output is always the canonical
36-character `8-4-4-4-12` form. There are no implicit casts, so cast explicitly:

```sql
SELECT id::text FROM default_redpanda_catalog=>events;
SELECT * FROM default_redpanda_catalog=>events
WHERE id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid;      -- or: id = uuid '...'
SELECT gen_random_uuid(), uuidv4();
```

Text input accepts any PostgreSQL form (upper or lower case, hyphens anywhere
between groups of four or omitted, braces). `id::bytea` gives the 16-byte value,
and a 16-byte `bytea` casts to `uuid`. Invalid text fails with `invalid input
syntax for type uuid`.

### Arrays

```sql
SELECT ARRAY[1, 2, 3], '{a,b,c}'::text[];
SELECT tags[1] AS first_tag, tags[1:2], tags[2:], tags[:]   -- 1-based; slices
FROM default_redpanda_catalog=>events;
SELECT * FROM default_redpanda_catalog=>events WHERE 'urgent' = ANY(tags);
```

- Single-dimensional only. An index past the end returns `NULL`.
- An array column cannot be the key of `ORDER BY`, `GROUP BY`, or `JOIN`
  (`could not identify an ordering operator for type text[]`); ordering by another
  column of the same table is fine.
- Array columns cannot be exported with `COPY TO`. A variable-size value is
  limited to 32 MB.
- `||` appends elements to an array; `= ANY(array)` and `= ALL(array)` test
  membership.

### Row (composite)

```sql
SELECT ROW(1, 'hello', 3.14), (1, 2, 3);           -- explicit and implicit tuples
SELECT (ROW(1, 'hello')).f1;                       -- anonymous fields are f1, f2, ...
SELECT (customer).region, (customer).id            -- named fields of a struct column
FROM default_redpanda_catalog=>orders;
SELECT (customer).* FROM default_redpanda_catalog=>orders;   -- expand all fields
```

- Struct columns come from nested schema records under the default
  `struct_mapping_policy = 'COMPOUND'`. Parentheses around the column are required
  for field access.
- Comparison (`=`, `<>`, `<`, `<=`, `>`, `>=`) is lexicographic; rows can be used
  in `GROUP BY`, `ORDER BY`, and `JOIN` (`ON (a.x, a.y) = (b.x, b.y)`), and cast
  to `text`.
- `r IS NULL` is true when every field is null; `r IS NOT NULL` is true only when
  every field is non-null, so a mixed row is neither. The checks do not recurse
  into nested rows.

### Map

```sql
SELECT attributes['color'] FROM default_redpanda_catalog=>products;   -- map column
SELECT (map('a', 1, 'b', 2))['a'];        -- inline map: parenthesize before subscripting
SELECT pg_typeof(map('a', 1));            -- map(text,integer)
```

- Map columns come from Avro or Protobuf map fields under the default `COMPOUND`
  policy (`JSON` stores them as `json`), and from Iceberg history.
- A missing key, a `NULL` lookup key, and a key whose value is `NULL` all return
  `NULL`. Duplicate keys are kept in order and the **last** pair wins.
- On the wire and in `psql`, a whole map shows as an array of `(key, value)` pairs:
  `{"(a,1)","(b,2)"}`.
- `map(...)` takes literal arguments only, in an even count; keys must be scalar
  (no `row`, array, map, or decimal keys) and values cannot be decimal.
- Not supported: slicing (`['a':'b']`), `GROUP BY` / `ORDER BY` / `DISTINCT` on a
  map, casting a map to `text`, and subscripting a map whose key type is a `row`.
- An Iceberg `list` of `list` or `list` of `map` fails at `CREATE TABLE` or
  `REFRESH` (`Multi-dimensional arrays are not supported`, `Arrays of maps are not
  supported`).

### Geometry and geography

Both store `POINT` values only (no polygons or lines).

```sql
SELECT ST_ASTEXT(GEOMETRY 'POINT(1.5 2.5)'),
       ST_DISTANCE(GEOMETRY 'POINT(0 0)', GEOMETRY 'POINT(3 4)');        -- Euclidean: 5

SELECT ST_DISTANCE(GEOGRAPHY 'POINT(-73.9857 40.7484)',
                   GEOGRAPHY 'POINT(-0.1278 51.5074)');                  -- meters (WGS84)
```

| | `geometry` | `geography` |
|---|---|---|
| Coordinates | planar (x y) | longitude latitude, SRID 4326 |
| SRID | accepted, ignored | must be 4326 |
| `st_distance` | Euclidean | meters; optional third argument `use_spheroid` (`false` = faster spherical) |
| Input | WKT, EWKT, EWKB hex | WKT, EWKT, EWKB hex |

Functions: `st_astext(g[, max_digits])`, `st_asewkt(g[, max_digits])`,
`st_distance`. Casts: to/from `text`, `geometry` ↔ `geography`, and `geometry` ↔
`point` (`geography` ↔ `point` is not supported).
