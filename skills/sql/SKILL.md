---
name: sql
description: >-
  Writes and runs read-only Redpanda SQL queries on Redpanda Cloud, covering how
  to connect to the SQL endpoint and the query language itself. Use when a user
  wants to connect to Redpanda SQL with psql, a PostgreSQL driver, or SQL Studio
  using an OIDC bearer token or a SCRAM password; write analytical queries with
  joins, aggregates, window functions, and CTEs over topic-backed tables; save a
  query as a view with CREATE VIEW or remove one with DROP VIEW; export
  results with COPY TO; grant access with GRANT and REVOKE; inspect metadata
  through information_schema or pg_catalog; or check how Redpanda SQL differs
  from PostgreSQL. For enabling SQL, the SQL Manage and SQL Access
  roles, and the access model, see `/redpanda:sql-admin-api`. For catalogs,
  mapping topics with CREATE TABLE, and Iceberg-enabled topics, see
  `/redpanda:sql-federated-queries`. For errors, slow queries, and degraded
  nodes, see `/redpanda:sql-debugging`.
---

# Redpanda SQL

Redpanda SQL is the analytical (OLAP) SQL engine that runs on Redpanda Cloud BYOC
clusters. It speaks the PostgreSQL wire protocol, so `psql` and standard
PostgreSQL drivers connect to it, and Cloud Console includes a built-in editor,
SQL Studio. It queries Redpanda topics in place: a topic is mapped to a SQL table
through a catalog, and a query against that table reads the live topic and, for an
Iceberg-enabled topic, its Iceberg history in one result.

Ground rules for an agent helping a user:

- **Redpanda SQL is read-only.** `INSERT`, `UPDATE`, `DELETE`, and bulk import
  (`COPY FROM`) are not available. Data arrives by producing to Redpanda topics;
  SQL reads it through catalog mappings. Do not suggest loading data with SQL.
- **`CREATE TABLE` maps a topic; it does not create a standalone table** with
  user-defined columns. Mapping topics, catalogs, and Iceberg belong to
  `/redpanda:sql-federated-queries`. `CREATE VIEW` saves a query over those
  tables; a view stores no data.
- **Tables are referenced as `catalog=>table`.** When SQL is enabled, a catalog
  named `default_redpanda_catalog` points at the cluster, so most queries read
  `FROM default_redpanda_catalog=>orders`.
- **Stay within the published surface.** Only the statements, functions, and types
  in the [Redpanda SQL reference](https://docs.redpanda.com/cloud-data-platform/reference/sql/)
  are supported for users. If a PostgreSQL feature is not listed there, say so
  rather than assuming it works.
- Never invent the host, port, or credentials: they come from the Cloud Console.

## Connect

Connection details are on the **SQL** tab of the **How to connect** panel for the
cluster in the Cloud Console. Every connection uses TLS (`sslmode=require`); the
SQL endpoint rejects plain-text connections. The database is `oxla`.

```bash
# Bearer token (a human user): log in once, then mint a short-lived token
rpk cloud login
PGPASSWORD=$(rpk cloud auth token) \
  psql "host=<sql-host> port=<sql-port> dbname=oxla user=ignored options='auth_method=bearer' sslmode=require"
```

Copy the exact string from the **SQL** tab; the published quickstart's string uses
port `5432`.

| Mode | `options` value | `user` | Password field |
|---|---|---|---|
| Bearer token | `auth_method=bearer` | ignored (identity comes from the token) | a token from `rpk cloud auth token` |
| Client credentials | `auth_method=client_secret` | the service account's client ID | the client secret |
| SCRAM password | omit `options` | the account or service account email | a password set with `ALTER USER` |

- A token in the password field **without** `options='auth_method=bearer'` is
  treated as a SCRAM password, and the connection fails.
- A token is checked once at connect time. When it expires, open sessions keep
  running but new connections need a fresh token.
- SCRAM is for clients that cannot do OIDC. A *SQL: Manage* user sets a known
  password first: `ALTER USER "svc@example.com" WITH PASSWORD '...';`.
- To query in the browser with no client or credentials, use **SQL Studio** (the
  **SQL** item in the cluster's left navigation).

Driver examples (psycopg2, JDBC, PHP PDO, C# Dapper/Npgsql) and each driver's
unsupported features are in [references/connect-and-types.md](references/connect-and-types.md).
Who may connect is governed by the Cloud RBAC roles *SQL: Manage* (SQL superuser)
and *SQL: Access* (regular user); for enabling SQL and the access model, see
`/redpanda:sql-admin-api`.

## SQL Studio

SQL Studio is the Cloud Console editor. It uses the Console session, so it needs
no separate credentials, only the *SQL: Access* or *SQL: Manage* role (and, for
*SQL: Access*, a `GRANT SELECT` on each table).

- Browse catalogs, namespaces, tables, and column types in the catalog panel; a
  table backed by an Iceberg-enabled topic carries an **Iceberg** badge.
- Run the active tab with **Run** (Cmd/Ctrl+Enter) or only the selected text with
  **Run selection**. Multiple tabs, **Format**, and a per-browser **History** are
  available.
- Results show row count and elapsed time; a **Truncated** badge means the
  server's row limit was hit. Export the result as CSV or JSON. A **Bridge
  query** chip means the result spans live records and Iceberg history.
- *SQL: Manage* users get an **Add a topic** wizard that runs the `CREATE TABLE`
  mapping for `default_redpanda_catalog`.
- **Statement limits:** SQL Studio is for read queries. The Console blocks some
  statements in the editor; for `GRANT`/`REVOKE` and other statements the engine
  supports, connect with `psql` or a driver. The engine and the user's grants
  remain the authority over what can run.

## Quickstart query

```sql
-- Topics already mapped as tables
SHOW REDPANDA TABLES default_redpanda_catalog;
DESCRIBE TABLE default_redpanda_catalog=>orders;

-- Sample, filter, aggregate
SELECT * FROM default_redpanda_catalog=>orders LIMIT 10;

SELECT status, COUNT(*) AS total_orders
FROM default_redpanda_catalog=>orders
GROUP BY status;

SELECT order_id, customer, product, amount
FROM default_redpanda_catalog=>orders
WHERE amount > 10000
ORDER BY amount DESC
LIMIT 20;
```

If the topic is not mapped yet, a *SQL: Manage* user maps it (see
`/redpanda:sql-federated-queries`), for example
`CREATE TABLE default_redpanda_catalog=>orders WITH (topic = 'orders');`.

## Query patterns

Full clause and statement reference: [references/statements.md](references/statements.md).

```sql
-- CTE (non-materialized: each use is inlined and optimized separately)
WITH completed AS (
    SELECT customer, amount
    FROM default_redpanda_catalog=>orders
    WHERE status = 'completed'
)
SELECT customer, SUM(amount) AS revenue
FROM completed
GROUP BY customer
HAVING SUM(amount) > 10000
ORDER BY revenue DESC;

-- Joins: JOIN ... ON, JOIN ... USING, LEFT / RIGHT / FULL OUTER, CROSS JOIN
SELECT o.order_id, c.region
FROM default_redpanda_catalog=>orders AS o
LEFT JOIN default_redpanda_catalog=>customers AS c ON o.customer = c.customer;

-- Window functions with a named window and a frame (ROWS or RANGE)
SELECT order_id, customer, amount,
       ROW_NUMBER() OVER w AS rn,
       SUM(amount) OVER (PARTITION BY customer ORDER BY order_id
                         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_total
FROM default_redpanda_catalog=>orders
WINDOW w AS (PARTITION BY customer ORDER BY amount DESC);

-- Set operations: UNION, INTERSECT, EXCEPT, each with an optional ALL
SELECT customer FROM default_redpanda_catalog=>orders
EXCEPT
SELECT customer FROM default_redpanda_catalog=>refunds;

-- Nested fields: (column).field for a struct column, column['key'] for a map,
-- column[n] (1-based) for an array, -> / ->> for JSON
SELECT (customer_info).region, attributes['color'], tags[1], payload ->> 'sku'
FROM default_redpanda_catalog=>events;
```

`SELECT DISTINCT ON (...)` is not supported; use `SELECT DISTINCT` or a
`ROW_NUMBER()` filter. The `GROUPS` frame mode and frame exclusion are not
supported.

## Views

A view is a named `SELECT` query that you query like a table. Redpanda SQL stores
the query, not its results, so a view always reads current data.

```sql
CREATE VIEW large_orders AS
SELECT order_id, customer, amount
FROM default_redpanda_catalog=>orders
WHERE amount > 100;

SELECT customer, SUM(amount) AS total FROM large_orders GROUP BY customer;

GRANT SELECT ON TABLE large_orders TO "alice@example.com";
DROP VIEW large_orders;
```

- A view lives in a **SQL schema** (`public` by default), not in a catalog: query
  it as `large_orders` or `public.large_orders`, never `catalog=>large_orders`.
- A view runs its query with its **owner's** privileges, so `SELECT` on the view
  alone lets a role read what the view returns, with no grant on the tables
  behind it. That makes a view a way to narrow what a role sees — and a way to
  leak data if granted too widely. Grant with `ON TABLE` and the view name; there
  is no `ON VIEW` form.
- List the columns in the query rather than using `SELECT *`: the column shape is
  fixed at creation, so a `SELECT *` view stops working once a table it reads
  gains a column.
- `CREATE OR REPLACE VIEW`, `ALTER VIEW`, and materialized views are not
  supported; drop the view and create it again instead.
- Views do not show up in `information_schema.tables` or in `psql`'s `\d` and
  `\dv`. List them with `SELECT viewname, definition FROM pg_views;`.

Dependencies, permissions, and the full behavior:
[references/statements.md](references/statements.md#views).

## Functions

Full reference: [references/functions-and-analytics.md](references/functions-and-analytics.md).

```sql
-- Aggregates, statistics, ordered-set aggregates
SELECT COUNT(DISTINCT customer), AVG(amount), STDDEV(amount),
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount) AS median,
       MODE() WITHIN GROUP (ORDER BY product)                AS top_product
FROM default_redpanda_catalog=>orders;

-- FOR_MAX: the value of one column at the row where another is largest
SELECT customer, FOR_MAX(amount, order_id) AS biggest_order
FROM default_redpanda_catalog=>orders
GROUP BY customer;

-- Time bucketing
SELECT TIMESTAMP_TRUNC(created_at, HOUR) AS hr, COUNT(*)
FROM default_redpanda_catalog=>events
GROUP BY TIMESTAMP_TRUNC(created_at, HOUR)
ORDER BY hr;

-- Strings, conditionals, nulls
SELECT UPPER(customer), STARTS_WITH(product, 'key'),
       IF(amount > 10000, 'large', 'small'),
       COALESCE(status, 'unknown')
FROM default_redpanda_catalog=>orders;
```

## Data types

Full reference: [references/connect-and-types.md](references/connect-and-types.md#data-types).

Published types: `int` (alias `integer`), `bigint` (alias `long`), `real` (alias
`float4`), `double precision` (aliases `double`, `float`, `float8`),
`numeric(p, s)` / `decimal`, `int16` and `int32` (wide integers, casts only),
`text`, `bool`, `bytea`, `date`, `time`, `timestamp`, `timestamp with time zone`,
`interval`, `json`, `uuid`, arrays, `row`, `map`, `geometry`, `geography`.

Points that trip up PostgreSQL users:

- `float` is `double precision`, as in PostgreSQL; use `real` for 32-bit.
- `numeric` supports comparison, grouping, ordering, and joins, but **not**
  arithmetic or `sum`/`avg`/`min`/`max` yet. Cast to `double precision` to
  calculate (the result is not exact).
- `int16`/`int32` are 128-bit and 256-bit integers for casts, for example
  `SUM(views::INT16)` to avoid `bigint` overflow; they cannot be table columns.
- Topic columns arrive typed from the topic's registered schema; `CAST(x AS type)`
  and `x::type` both work.

## Export results

`COPY TO` writes CSV only, from a table or a query:

```bash
psql "<connection string>" \
  -c "COPY (SELECT * FROM default_redpanda_catalog=>orders WHERE status = 'pending') TO STDOUT WITH (FORMAT CSV, HEADER ON)" \
  > pending_orders.csv
```

`TO STDOUT` returns the data to the client. A quoted file path is written on the
SQL engine's side, so use `STDOUT` or an `s3://` / `gs://` destination with
`AWS_CRED(...)` / `GCS_CRED(...)`. Array columns cannot be exported. SQL Studio
can also download a result as CSV or JSON. Details:
[references/statements.md](references/statements.md#copy-to).

## Access statements

Only a superuser (*SQL: Manage*) can grant and revoke. The user identifier is the
Redpanda Cloud account or service-account email, double-quoted.

```sql
-- One topic, a trailing-wildcard pattern, or every topic in the catalog
GRANT SELECT ON EXTERNAL SOURCE default_redpanda_catalog => 'orders'   TO "alice@example.com";
GRANT SELECT ON EXTERNAL SOURCE default_redpanda_catalog => 'orders_*' TO "alice@example.com";
GRANT SELECT ON EXTERNAL SOURCE default_redpanda_catalog               TO "alice@example.com";

-- Schema visibility (needed to see catalogs in SHOW CATALOGS / system.catalogs)
GRANT USAGE ON SCHEMA public TO "alice@example.com";

REVOKE SELECT ON EXTERNAL SOURCE default_redpanda_catalog => 'orders' FROM "alice@example.com";

-- Inspect what is granted
SELECT grantee, source_name, relation_pattern, privilege_type
FROM information_schema.role_external_relation_grants;
```

Users are provisioned from Redpanda Cloud IAM when a role with *SQL: Access* or
*SQL: Manage* is assigned; `CREATE USER`, `DROP USER`, and `ALTER USER ...
SUPERUSER` exist but the Cloud operator reconciles them back to IAM, so manage
users in Redpanda Cloud. `ALTER USER ... WITH PASSWORD` (for SCRAM) persists.
Full syntax and behavior: [references/statements.md](references/statements.md#access-control).

## Inspect metadata and the session

```sql
SHOW CATALOGS;                                   -- also SHOW REDPANDA CATALOGS / SHOW ICEBERG CATALOGS
SHOW REDPANDA TABLES default_redpanda_catalog;   -- unqualified SHOW TABLES is an error
DESCRIBE REDPANDA CATALOG default_redpanda_catalog;
SELECT * FROM information_schema.columns WHERE table_name = 'orders';
SELECT current_user, current_database(), current_schema(), version();
SHOW timezone;
SET timezone TO 'UTC';
```

`SHOW NODES`, `SHOW QUERIES`, `SHOW EXECS` and their `system.*` tables are
superuser-only; for using them to troubleshoot, see `/redpanda:sql-debugging`.

## Differences from PostgreSQL

- Read-only: no `INSERT`/`UPDATE`/`DELETE`/`COPY FROM`, no upserts, no
  standalone tables, no PostgreSQL extensions (pgvector, PostGIS, pg_cron).
- Transaction syntax (`BEGIN`, `COMMIT`, `END TRANSACTION`, `ROLLBACK`) is
  accepted for tool compatibility, but statements run immediately and `ROLLBACK`
  undoes nothing.
- Views exist but are read-only and frozen in shape: no `CREATE OR REPLACE
  VIEW`, no `ALTER VIEW`, no materialized views, and they are absent from
  `information_schema.tables` and `psql`'s `\d`.
- Prepared statements give no benefit: bound parameters are turned back into
  query text. PHP PDO needs `PDO::ATTR_EMULATE_PREPARES => true`.
- JSON `=` is key-order-sensitive. Unnamed result columns are named generically
  (`f`, `f_1`, ...) rather than after the function; alias them with `AS`.
- Some math edge cases differ: `LN(0)` returns Infinity and `LOG10(-1)` returns
  NaN instead of raising an error.
- `pg_catalog` tables exist for tool compatibility and mostly hold placeholder
  data; use `information_schema`, `DESCRIBE`, and `SHOW` for real metadata.

See [Redpanda SQL vs PostgreSQL](https://docs.redpanda.com/cloud-data-platform/sql/get-started/redpanda-sql-vs-postgresql/).

## Catalogs, topic mappings, and Iceberg

Defining catalogs (`CREATE REDPANDA CATALOG`, `CREATE STORAGE`), mapping topics
(`CREATE TABLE catalog=>table WITH (topic = ...)`, `ALTER TABLE`, `DROP TABLE`),
decode options such as `struct_mapping_policy` and `confluent_wire_protocol`, and
querying Iceberg-enabled topics are covered by `/redpanda:sql-federated-queries`.
In Redpanda Cloud, the storage connection and Iceberg catalog for Iceberg-enabled
topics are configured automatically when SQL is enabled on a cluster with an
Iceberg REST catalog.

## Reference Directory

- [connect-and-types.md](references/connect-and-types.md): connecting from psql
  and each published language client (psycopg2, JDBC, PHP PDO, C# Dapper/Npgsql)
  with the three authentication modes and each driver's unsupported features, and
  the published data types with their aliases, casts, and limitations (numeric,
  wide integers, text, bytea, date/time and interval, JSON, UUID, arrays, row,
  map, geometry and geography).
- [statements.md](references/statements.md): the published statement set and
  clauses: `SELECT` (WHERE, GROUP BY, HAVING, ORDER BY, LIMIT/FETCH, OFFSET,
  joins, subqueries, WITH, set operations, DISTINCT), operators, `CREATE VIEW`
  and `DROP VIEW` with the owner-privilege model, `COPY TO`,
  `SET`/`SHOW` options, `DESCRIBE` and `SHOW` statements, transactions, SQL
  schemas, comments, `GRANT`/`REVOKE` and `CREATE`/`ALTER`/`DROP USER` with their
  Cloud behavior, `information_schema`, system virtual tables, and `pg_catalog`.
- [functions-and-analytics.md](references/functions-and-analytics.md): the
  published functions: aggregates and statistics, ordered-set aggregates,
  `FOR_MIN`/`FOR_MAX`, window functions and frames, string and regex, math and
  trigonometric, timestamp and interval, JSON, UUID, `generate_series`,
  conditional and system-information functions, plus analytical query patterns.
- [SOURCES.md](references/SOURCES.md): the published documentation pages each
  file derives from.
