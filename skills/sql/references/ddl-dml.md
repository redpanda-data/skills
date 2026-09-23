# DDL and DML

All statements grounded in `tests/UT/query_planner/cases/` and the SQL parser.

---

## CREATE TABLE

```sql
-- Basic table
CREATE TABLE orders (
    order_id   INT,
    customer   VARCHAR,
    region     VARCHAR,
    amount     DOUBLE,
    order_date DATE
);

-- With more types
CREATE TABLE events (
    id          LONG,
    name        TEXT,
    score       FLOAT,
    is_active   BOOL,
    payload     JSON,
    tags        INT[],
    created_at  TIMESTAMP,
    updated_at  TIMESTAMPTZ,
    duration    INTERVAL,
    price       NUMERIC(18, 4)
);

-- Nullable vs NOT NULL
CREATE TABLE products (
    sku       VARCHAR      NOT NULL,
    price     DOUBLE,
    stock     INT
);
```

## DROP TABLE

```sql
DROP TABLE orders;
DROP TABLE IF EXISTS orders;
```

## CREATE TABLE AS SELECT (CTAS)

Materialize a query result as a new table. Grounded in `create_statement` (bison_parser.y):

```sql
CREATE TABLE orders_2024 AS
    SELECT * FROM orders WHERE order_date >= DATE '2024-01-01';

CREATE TABLE IF NOT EXISTS orders_backup AS SELECT * FROM orders;

-- Reshape: drop a column by selecting only the ones you want
CREATE TABLE orders_slim AS
    SELECT order_id, customer, amount FROM orders;
```

## TRUNCATE

Remove all rows from a table without dropping it:

```sql
TRUNCATE TABLE orders;
TRUNCATE orders;         -- TABLE keyword is optional
```

## ALTER TABLE

There are three `ALTER TABLE` forms: `ADD COLUMN` on a native table, the
Kafka-catalog rebind, and an ownership reassignment.

### ADD COLUMN

```sql
ALTER TABLE orders ADD COLUMN discount BIGINT;
ALTER TABLE orders ADD discount BIGINT;                       -- COLUMN keyword is optional
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount BIGINT;  -- idempotent
ALTER TABLE IF EXISTS orders ADD COLUMN discount BIGINT;      -- missing table is a no-op
ALTER TABLE analytics.orders ADD COLUMN discount BIGINT;      -- schema-qualified
```

Full form:

```
ALTER TABLE [IF EXISTS] [<schema>.]<table> ADD [COLUMN] [IF NOT EXISTS] <column> <type> [NULL]
```

`IF EXISTS` refers to the **table**; `IF NOT EXISTS` refers to the **column**.

Semantics:

- The added column is **always nullable**, and rows written before the `ALTER`
  read back as `NULL` — not as an empty value. For an added array column the
  pre-existing rows are `NULL`, not `{}`.
- It is a **metadata-only** operation: no existing data file is read, rewritten,
  or migrated, so the statement does not scale with table size.
- The column is appended **last** in column order, which is what
  `information_schema.columns.ordinal_position`, `pg_attribute.attnum`,
  `system.columns`, and `DESCRIBE TABLE` report.
- The column type may be **any type `CREATE TABLE` accepts** — a type `CREATE
  TABLE` refuses is refused here too, so the addable and creatable type sets
  cannot diverge. This includes arrays, `UUID`, geospatial types, and
  user-defined composite types.
- An `INSERT` that names the original columns keeps working and leaves the added
  column `NULL`, so a client whose statements predate the `ALTER` needs no change.
  For a scalar column type, an `UPDATE` can then set the new column on pre-existing
  rows, and `DELETE` can filter on it (`WHERE <new_column> IS NULL` matches exactly
  those rows).
- **Adding an array column makes the table read-only for `UPDATE` and `DELETE`.**
  Both are refused with `UPDATE on a table with array column is not supported` /
  `DELETE on a table with array column is not supported`. This is the general rule
  for any table with an array column — one created with the column behaves the
  same — so it is not caused by `ADD COLUMN`, but a migration that adds
  `tags TEXT[]` to a table that is later updated or purged row by row will hit it.
  Adding a `DECIMAL`/`NUMERIC` or user-defined composite column currently also
  breaks `UPDATE` on that table (`DELETE` still works); that failure surfaces as
  an internal planner error whose text varies by build. If the table must stay
  mutable, do not add a column of these types to it.
- The caller must **own the table** (otherwise
  `permission denied: must be owner of table <table>`).

Not supported — each is an error, not a silent no-op:

| Attempt | Result |
|---|---|
| `ADD COLUMN c INT NOT NULL` | `ADD COLUMN with NOT NULL is not supported; existing rows have no value for the new column` |
| `ADD COLUMN c INT DEFAULT 5` | `DEFAULT is not supported in ALTER TABLE ... ADD COLUMN` |
| Several columns in one statement (`ADD COLUMN a INT, ADD COLUMN b INT`) | syntax error — add one column per statement |
| `DROP COLUMN` / `RENAME COLUMN` | syntax error — no such production |
| `PRIMARY KEY` / `UNIQUE` column constraints | syntax error |
| `ADD COLUMN c INT[][]` | `Multi-dimensional arrays are not supported` |
| An external table (`ALTER TABLE cat=>t ADD COLUMN ...`) | `catalog=>table_name syntax is not supported in ALTER TABLE ... ADD COLUMN` |
| A view | `cannot alter relation "<view>": it is not a table` — `IF EXISTS` does **not** mask this, because a view is the wrong kind of relation rather than an absent one |
| A `pg_catalog` table | `permission denied for table <table>` |
| A column name already on the table | `column "<name>" of relation "<table>" already exists` |
| An unknown type | `type "<name>" does not exist` |

`ADD COLUMN` applies to **native tables only** — a Kafka/Redpanda topic table or
an Iceberg table is refused by the same check as a view, since neither is a
native user table. Their columns follow the registered schema; re-bind them with
the `WITH (...)` form below instead.

A view stored as `SELECT *` over the altered table currently becomes invalid,
because its stored column list no longer matches what its body produces
(`view "<v>" is invalid: its definition no longer produces the columns stored at
creation`). PostgreSQL, by contrast, freezes the `*` expansion at creation and
keeps the view working, so re-check this behavior after an upgrade. Recreate the
view to pick up the new column, or name the columns explicitly at creation so the
added column does not affect it — see [CREATE / DROP VIEW](#create--drop-view).

### Re-bind an external catalog table / reassign ownership

The rebind form re-binds an external Redpanda/Kafka catalog table. Use the
`IF EXISTS` form — it is the canonical Kafka-catalog rebind syntax and the table
name **must** use the `catalog=>table_name` external-source form (the parser
raises `YYERROR` "Expected catalog=>table_name syntax" otherwise):

```sql
ALTER TABLE IF EXISTS my_catalog=>my_table WITH (schema_lookup_policy = 'LATEST');
```

The ownership form reassigns ownership; sibling forms exist for other resource
kinds (schemas, views, types, storages, catalogs):

```sql
ALTER TABLE orders OWNER TO analytics_role;
```

See [kafka-iceberg.md](kafka-iceberg.md) for the full Redpanda/Kafka and Iceberg
catalog integration (an Oxla + Redpanda Enterprise differentiator), including all
connection-option keys.

For a column change `ADD COLUMN` cannot express — dropping or renaming a column,
changing a column's type, or adding a column with a backfilled value — recreate
the table with `CREATE TABLE AS SELECT`:

```sql
-- Add a column with a computed value for existing rows
CREATE TABLE orders_new AS
    SELECT *, amount * 0.1 AS discount FROM orders;
```

## CREATE / DROP VIEW

Views are **non-materialized**: the `SELECT` text is stored in the catalog and
inlined in place of the view reference on every use (the same rewrite applied to
CTEs). Nothing is stored as data, so a view always reads the current base data.

```sql
CREATE VIEW emea_orders AS
    SELECT * FROM orders WHERE region = 'EMEA';

CREATE VIEW regional_summary AS
    SELECT region, COUNT(*) AS cnt, SUM(amount) AS total
    FROM orders
    GROUP BY region;

DROP VIEW emea_orders;
DROP VIEW IF EXISTS emea_orders;
```

The stored body may be any `SELECT`, including `ORDER BY`/`LIMIT`, a `WITH`
clause, a set operation, aggregates, and joins — the whole body text is stored
verbatim, so `LIMIT 2` in the definition still limits the view:

```sql
CREATE VIEW top_two AS SELECT order_id FROM orders ORDER BY amount DESC LIMIT 2;

-- Views nest: a view body may reference another view.
CREATE VIEW filtered AS SELECT id, name FROM orders WHERE region = 'EMEA';
CREATE VIEW filtered_one AS SELECT id FROM filtered WHERE id = 3;
```

Semantics to know:

- **Late binding.** The body is re-resolved from its stored text on every use, so
  the view picks up new rows, and `SELECT *` reflects the base table's current
  columns.
- **The column shape is pinned.** The columns the body resolved to at `CREATE` are
  stored as the view's contract. If a later re-resolve does not produce exactly
  those columns, the query fails with `view "<name>" is invalid: its definition no
  longer produces the columns stored at creation (<detail>); drop and recreate the
  view` (SQLSTATE `55000`, `object_not_in_prerequisite_state`). The detail says
  what moved: `expected N columns, got M`, `column i is named "x", expected "y"`,
  or `column "x" changed type`. A view whose body is a set operation stores no
  columns and carries no contract.
- **Privileges are invoker-based**, unlike PostgreSQL (which runs a body as the
  view's owner). The body is inlined before privilege checks, so the caller needs
  `SELECT` on the view *and* on every relation the body reads — otherwise
  `permission denied for table <base_table>`. `ALTER TABLE <view> OWNER TO <role>`
  reassigns a view's owner (a view is a relation for that statement).
- **Dependencies are RESTRICT.** Dropping a table or view another view reads is
  refused with `dependent objects still exist` (SQLSTATE `2BP01`); drop the
  dependent view first.
- **A CTE shadows a same-named view** — CTE substitution runs before view
  inlining. Qualify the name (`public.my_view`) to reach the view past a
  same-named CTE. A caller's CTE never leaks into a view body, and a body's own
  CTE may reuse the view's name.
- **Not supported:** an explicit column-alias list. `CREATE VIEW v (x, y) AS
  SELECT ...` is rejected with `column alias list in CREATE VIEW is not yet
  supported` (`FeatureNotSupported`); alias the columns inside the body instead
  (`SELECT id AS x, name AS y`). A body that is not a `SELECT` is rejected too
  (`view definition must be a SELECT query`). There is no `CREATE OR REPLACE
  VIEW` (the parser has no `OR REPLACE` production) and no materialized views
  (no `MATERIALIZED` keyword in the grammar) — drop and recreate instead.
- **Introspection.** A view shows up in `pg_class` with `relkind = 'v'`, its
  columns in `pg_attribute`, and its stored definition in
  `pg_catalog.pg_views` (`schemaname`, `viewname`, `viewowner`, `definition`).
  Unlike PostgreSQL, `definition` is the body text as written, not a reprint from
  the parse tree.

---

## EXPLAIN

`EXPLAIN` returns its explanation **as a relation** (a normal result set), not as
PostgreSQL's plan text. It is sugar over the `explain()` table function: the
statement rewrites itself into `SELECT * FROM explain(<query>, <mode>)`, so both
spellings return identical rows.

```sql
-- What EXPLAIN can do: a help table of the modes, their syntax and an example
EXPLAIN;

-- The operations the engine will run for a query
EXPLAIN PHYSICAL SELECT region, SUM(amount) FROM orders GROUP BY region;

-- How long each planning stage took
EXPLAIN TIMING SELECT * FROM orders WHERE region = 'EMEA';

-- The query-planner options of the current session, with their values
EXPLAIN CONFIG;
```

| Mode | Statement | Needs a query | Returns |
|------|-----------|---------------|---------|
| `help` | `EXPLAIN` | no | the modes, their syntax, and a runnable example of each |
| `physical_plan` | `EXPLAIN PHYSICAL <query>` | yes | one row per operator output: operator topology, expressions, physical column ids |
| `timing` | `EXPLAIN TIMING <query>` | yes | the planning-stage breakdown |
| `config` | `EXPLAIN CONFIG` | no | every query-planner option, its value in this session, and what it does |

The variant keyword is case-insensitive (`EXPLAIN physical …` works). Only a
`SELECT` query can be explained: the grammar is `EXPLAIN [<variant>] [<select>]`,
so an `INSERT`/`UPDATE`/DDL statement after `EXPLAIN` is either a syntax error or
read as a variant name and answered with the help table — never explained. There
is no `EXPLAIN ANALYZE` (no mode executes the query) and no parenthesized
PostgreSQL option list (`EXPLAIN (FORMAT JSON) …`).

**Misuse renders the help table instead of an error** — the way `--help` answers
an unknown flag. An unrecognized variant, a query-dependent mode with no query,
or a standalone mode handed a query all fall back to `help`.

**`EXPLAIN PHYSICAL` requires the pipeline planner.** It walks the planner's IR,
which only the pipeline planner builds:

```sql
SHOW oxla.query_planner.pipeline;          -- check the session's current value
SET oxla.query_planner.pipeline = on;      -- required before EXPLAIN PHYSICAL
```

Without it the statement fails with `explain() mode 'physical_plan' requires
oxla.query_planner.pipeline = on` (`FeatureNotSupported`). `help`, `config`, and
`timing` work under either planner.

### The `explain()` table function

Because the explanation is a relation, `explain()` can be filtered, ordered, and
joined like any table. The statement form always orders `physical_plan` by
`row_num`; through the function you choose:

```sql
-- Same rows as EXPLAIN PHYSICAL, ordered explicitly
SELECT operation, value FROM explain('SELECT 1', 'physical_plan') ORDER BY row_num;

-- Standalone modes take one argument
SELECT * FROM explain('help');
SELECT * FROM explain('config');

-- Narrow a large plan: it filters and paginates like any relation
SELECT row_num, node, operation, value
FROM explain('SELECT * FROM orders WHERE region = ''EMEA''', 'physical_plan')
ORDER BY row_num
LIMIT 20;
```

Filter on `node`, `operation`, `pass`, or the id columns to narrow a plan to the
part you care about — read the actual values from a live run first, since the
rows are runtime output.

Argument rules (all arguments must be **string literals**, else
`explain() arguments must be string literals`):

- one argument — a standalone mode name (`'help'`, `'config'`)
- two arguments — the query text, then a query-dependent mode name
  (`'physical_plan'`, `'timing'`)
- three arguments — plus an options string, comma-separated `key=value` pairs.
  The only option is **`steps=n`**: stop planning once `n` passes have run, so
  raising it one pass at a time explains each planning step on its own.
  `SELECT * FROM explain('SELECT 1', 'physical_plan', 'steps=3')`. Options are
  available through the function only, not through the `EXPLAIN` statement.

Note that the mode name used by `explain()` (`physical_plan`) differs from the
statement's variant keyword (`PHYSICAL`); `timing`, `config`, and `help` are
spelled the same in both. A nested `explain()` is bounded by
`oxla.query_planner.max_self_invoke_depth`; exceeding it fails with
`explain() nested deeper than oxla.query_planner.max_self_invoke_depth (<n>)`.

### Result columns per mode

Column names are stable; the rows are runtime output — read them from the live
server rather than assuming values.

| Mode | Columns |
|------|---------|
| `help` | `query`, `description` |
| `config` | `option`, `value` (nullable), `description` |
| `timing` | `measurement`, `attribution`, `invocations`, `elapsed` (`decimal(18,6)`, microseconds) |
| `physical_plan` | `row_num`, `node`, `physical_id`, `parent_id`, `child_id`, `operation`, `value`, `pass`, `logical_column` |

A plan that failed to build still explains itself: `physical_plan` renders the
partial plan with the failure attributed to the planning stage that produced it,
so `EXPLAIN PHYSICAL` over a query that will not plan is still informative.

`EXPLAIN CONFIG` is the live source of truth for the planner options — it lists
each `oxla.query_planner.*` option with its session value and description, so
read the options from it rather than from a pinned list. Individual options are
session-settable (`SET oxla.query_planner.optimization.<name> = off`), and
`oxla.query_planner.optimization.all` is a write-only shorthand that switches
every planner optimization at once.

## CREATE / DROP SCHEMA

```sql
CREATE SCHEMA analytics;

DROP SCHEMA analytics;
DROP SCHEMA analytics CASCADE;
DROP SCHEMA analytics RESTRICT;
```

---

## CREATE ROLE / GRANT / REVOKE

The `PASSWORD` clause is **mandatory** when creating a role; omitting it causes a parse error.

Supported role options (from `create_role_statement` in bison_parser.y):
- `LOGIN` — allows the role to log in
- `SUPERUSER` / `NOSUPERUSER`
- `PASSWORD 'value'` — required at creation

```sql
-- Create a role (PASSWORD is required)
CREATE ROLE analyst WITH PASSWORD 'secret';

-- Create a superuser role
CREATE ROLE admin_user WITH PASSWORD 'p@ss' SUPERUSER;

-- Alter an existing role's password
ALTER ROLE analyst WITH PASSWORD 'new_secret';

-- Drop a role
DROP ROLE analyst;

-- Grant privileges (supported: SELECT, INSERT, UPDATE, DELETE, CREATE, CONNECT, USAGE, ALL [PRIVILEGES])
GRANT SELECT ON orders TO analyst;          -- bare table name
GRANT SELECT ON TABLE orders TO analyst;    -- explicit TABLE keyword
GRANT INSERT, UPDATE ON TABLE orders TO analyst;
GRANT ALL PRIVILEGES ON TABLE orders TO analyst;  -- all privileges valid at this level
GRANT ALL ON TABLE orders TO analyst;             -- 'PRIVILEGES' is optional; bare 'ALL' is equivalent

-- Schema- and database-level grants
GRANT USAGE ON SCHEMA analytics TO analyst;
GRANT CONNECT ON DATABASE oxla TO analyst;

-- Revoke privileges
REVOKE SELECT ON TABLE orders FROM analyst;
REVOKE GRANT OPTION FOR SELECT ON TABLE orders FROM analyst;
REVOKE ALL ON TABLE orders FROM analyst;    -- bare 'ALL' is accepted here too
```

`ALL` (with or without the trailing `PRIVILEGES` keyword) expands to every
privilege defined at that level: `SELECT`/`INSERT`/`UPDATE`/`DELETE` for a
table, `CREATE`/`USAGE` for a schema, `CONNECT` for a database, and
`SELECT`/`INSERT` for an external source. Both `ALL` and `ALL PRIVILEGES`
produce the identical grant, matching PostgreSQL.

> The external-source level is the one that is easy to under-read: its `ALL`
> confers `INSERT` as well as `SELECT`, so `GRANT ALL ON EXTERNAL SOURCE <catalog> TO <role>`
> is not a read-only grant.
> Grant `SELECT` explicitly where read-only access is what you mean.

### Valid GRANT/REVOKE targets

Grounded in `privilege_statement` in bison_parser.y (lines ~2909-3094). The only
supported object levels are:

| Target form | Level |
|-------------|-------|
| `ON table_name` | table |
| `ON TABLE table_name` | table |
| `ON SCHEMA name` | schema |
| `ON DATABASE name` | database |
| `ON EXTERNAL SOURCE name[.obj] [EXTERNAL_ACCESS '...']` | external source (Kafka/Iceberg catalog) |

> **`ON ALL TABLES IN SCHEMA` is NOT valid in Oxla.** The grammar has an
> `ON ALL <object> IN SCHEMA <schema>` production, but it hard-errors with
> `YYERROR` ("syntax error at or near \"tables\"") whenever the object word is
> literally `tables` (case-insensitive, bison_parser.y line ~2953). So
> `GRANT SELECT ON ALL TABLES IN SCHEMA public TO analyst;` is rejected at parse
> time. Grant on each table individually, or grant at the `SCHEMA` level.

---

## SELECT

### Basic projection and filtering

```sql
-- Select all columns
SELECT * FROM orders;

-- Projection with aliases
SELECT order_id, amount * 1.1 AS amount_with_tax FROM orders;

-- WHERE conditions (from test cases)
SELECT i0 FROM tb1 WHERE b0;
SELECT i0, i1 FROM tb1 WHERE i0 > 10;
SELECT i0 FROM tb1 WHERE i0 IS NOT NULL;
SELECT i0 FROM tb1 WHERE i0 IS NULL;

-- Boolean operators
SELECT * FROM orders WHERE amount > 100 AND region = 'EMEA';
SELECT * FROM orders WHERE amount < 10 OR region = 'APAC';
SELECT * FROM orders WHERE NOT (region = 'EMEA');

-- BETWEEN
SELECT * FROM orders WHERE amount BETWEEN 100 AND 500;

-- LIKE / NOT LIKE
SELECT * FROM orders WHERE customer LIKE 'Acm%';
SELECT * FROM orders WHERE customer NOT LIKE '%test%';

-- REGEXP match
SELECT * FROM orders WHERE region ~ '^E';

-- IN
SELECT * FROM orders WHERE region IN ('EMEA', 'APAC');

-- IS TRUE / IS FALSE
SELECT i0 FROM tb1 WHERE b0 IS TRUE;
SELECT i0 FROM tb1 WHERE b0 IS NOT FALSE;
```

### GROUP BY

```sql
-- Simple aggregation
SELECT region, COUNT(*) AS cnt, SUM(amount) AS total
FROM orders
GROUP BY region;

-- GROUP BY column position
SELECT i0 + 5 AS x, COUNT(*) FROM tb1 GROUP BY 1;

-- Multiple GROUP BY columns
SELECT region, EXTRACT(YEAR FROM order_date) AS yr,
       SUM(amount) AS revenue
FROM orders
GROUP BY region, yr;

-- GROUP BY with computed expression
SELECT TIMESTAMP_TRUNC(created_at, HOUR) AS hr,
       COUNT(*) AS events
FROM events
GROUP BY TIMESTAMP_TRUNC(created_at, HOUR);
```

### ORDER BY

```sql
-- ASC / DESC
SELECT order_id, amount FROM orders ORDER BY amount DESC;
SELECT i0, f0 FROM tb1 ORDER BY i0 ASC NULLS LAST, f0 DESC;

-- Multi-column with expression
SELECT i0, i1, s0 FROM tb1 ORDER BY i1 + i3 DESC LIMIT 100;
```

### LIMIT / OFFSET

```sql
SELECT i0 FROM tb1 LIMIT 10;
SELECT i0 FROM tb1 ORDER BY i0 LIMIT 20 OFFSET 50;
SELECT i0 FROM tb1 LIMIT NULL;   -- no limit
SELECT i0 FROM tb1 OFFSET 50;
```

### SELECT DISTINCT

```sql
SELECT DISTINCT region FROM orders;
SELECT DISTINCT INTERVAL '0';
```

### Subqueries

```sql
-- Scalar subquery
SELECT a FROM (SELECT 10 AS a, 11 AS b);

-- Subquery in FROM
SELECT tl.i0, tr.s0
FROM (SELECT i0, s0 FROM tb1 ORDER BY s1) AS subq
ORDER BY i0 DESC;

-- Correlated subquery in JOIN
SELECT tl.i0, tl.s0, tr.l1, tr.l0
FROM (SELECT i0, i1, s0 FROM tb1) AS tl
JOIN tb1 AS tr
  ON tl.i0 = tr.l0 / 10
  AND tl.s0 = tr.s1
  AND tl.i1 = tr.i1;
```

### JOINs

```sql
-- INNER JOIN
SELECT tb1.i0, tb2.i0 FROM tb1 JOIN tb2 ON tb1.i0 = tb2.i0;

-- Multi-condition inner join
SELECT tb1.i0, tb2.i0
FROM tb1 JOIN tb2 ON tb1.i0 = tb2.i0 AND tb1.f0 = tb2.f0;

-- Three-table join
SELECT * FROM tb1
JOIN tb2 ON tb1.i0 = tb2.i0
JOIN tb3 ON tb1.i0 = tb3.i0;

-- LEFT / RIGHT / FULL OUTER JOIN
SELECT tb1.i0, tb1.f0, tb2.i0, tb2.f1
FROM tb1 LEFT JOIN tb2 ON tb1.i0 = tb2.i0;

SELECT tb1.i0, tb1.f0, tb2.i0, tb2.f1
FROM tb1 RIGHT JOIN tb2 ON tb1.i0 = tb2.i0;

SELECT tb1.i0, tb2.i0
FROM tb1 FULL JOIN tb2 ON tb1.i0 = tb2.i0;

-- CROSS JOIN
SELECT *
FROM (SELECT i0 FROM tb1 ORDER BY i0 ASC LIMIT 1)
CROSS JOIN
     (SELECT i1 FROM tb1 ORDER BY i1 DESC LIMIT 1);

-- Self-join
SELECT tl.i0, tr.s0
FROM tb1 AS tl
JOIN tb1 AS tr ON tl.i0 = tr.i1 AND tl.s0 = tr.s0;

-- Join with subquery that has TOP-K
SELECT tr.l0
FROM (SELECT i0 FROM tb1 ORDER BY i0 LIMIT 100) AS tl
JOIN tb1 AS tr ON tl.i0 = tr.l0 / 10;
```

### Set Operations (UNION / INTERSECT / EXCEPT)

All three accept an optional `ALL` qualifier. Without `ALL`, duplicates are eliminated (distinct semantics). Grounded in bison_parser.y lines 1927-1947 and `EXCEPT ALL` test cases.

```sql
-- UNION ALL (keeps duplicates)
SELECT i0 FROM tb1 UNION ALL SELECT i1 FROM tb1;
SELECT i0 FROM tb1 UNION ALL SELECT f0 FROM tb1;   -- implicit cast

-- UNION (distinct)
SELECT i0 FROM tb1 UNION SELECT i1 FROM tb1;

-- INTERSECT ALL
SELECT i0 FROM tb1 INTERSECT ALL SELECT i0 FROM tb1;

-- INTERSECT (distinct)
SELECT i0 FROM tb1 INTERSECT SELECT i0 FROM tb2;

-- EXCEPT: rows in left result not in right
SELECT i0 FROM tb1 EXCEPT SELECT i0 FROM tb2;

-- EXCEPT ALL (multiset subtraction)
SELECT i0 FROM tb1 EXCEPT ALL SELECT i0 FROM tb2;
```

### AT TIME ZONE

```sql
SELECT t0 AT TIME ZONE s0 FROM tb1;
SELECT TIMESTAMP '2024-01-01 12:00:00' AT TIME ZONE 'UTC';
```

---

## INSERT

Oxla supports both `INSERT INTO ... VALUES (...)` (native literal rows) and
`INSERT INTO ... SELECT ...` (for transformed or bulk loads). They are independent
forms — VALUES is not "via SELECT". Multi-row VALUES is supported.

```sql
-- VALUES form: single or multi-row literal insert
INSERT INTO orders VALUES (1, 'Acme', 'EMEA', 1250.50, DATE '2024-01-15');
INSERT INTO orders VALUES
    (2, 'Globex', 'APAC', 3400.00, DATE '2024-01-16'),
    (3, 'Acme',   'EMEA',  980.00, DATE '2024-02-01');

-- SELECT-based insert (primary form for analytical loads)
INSERT INTO dest SELECT i0, i1, b0 FROM source WHERE b0;

-- Insert with join
INSERT INTO tb
SELECT t1.i0, t1.i1, t1.b0
FROM source AS t1 JOIN source AS t2 ON t1.i0 = t2.i0;

-- Insert with GROUP BY aggregation
INSERT INTO temp_
SELECT scent_id, COUNT(scent_id)
FROM oils
GROUP BY scent_id;

-- Insert with array literal
INSERT INTO tb1 SELECT ARRAY[1, 2, 3], 4, 5;

-- SSB-style star-schema insert
INSERT INTO temp_
SELECT SUM(LO_EXTENDEDPRICE * LO_DISCOUNT) AS revenue
FROM lineorder
WHERE LO_ORDERDATE >= DATE '1993-01-01'
  AND LO_ORDERDATE <= DATE '1993-12-31'
  AND LO_DISCOUNT >= 1
  AND LO_DISCOUNT <= 3
  AND LO_QUANTITY < 25;

-- Multi-join analytical insert
INSERT INTO temp_
SELECT SUM(LO_REVENUE) AS revenue,
       EXTRACT(YEAR FROM LO_ORDERDATE) AS y,
       P_BRAND AS brand
FROM lineorder
JOIN (SELECT P_BRAND, P_PARTKEY FROM part
      WHERE P_CATEGORY = 'MFGR#12') AS part
  ON LO_PARTKEY = P_PARTKEY
JOIN (SELECT S_REGION, S_SUPPKEY FROM supplier
      WHERE S_REGION = 'AMERICA') AS supplier
  ON LO_SUPPKEY = S_SUPPKEY
GROUP BY EXTRACT(YEAR FROM LO_ORDERDATE), P_BRAND
ORDER BY EXTRACT(YEAR FROM LO_ORDERDATE), P_BRAND;
```

---

## UPDATE

```sql
-- Set column to NULL
UPDATE tb SET i0 = NULL;

-- Conditional update
UPDATE tb SET i0 = NULL WHERE i0 IS NOT NULL;

-- Update with constant where false (no-op)
UPDATE tb SET i0 = 10 WHERE false;
```

---

## DELETE

```sql
-- Delete all rows
DELETE FROM tb;

-- Conditional delete
DELETE FROM tb WHERE b0;

-- Delete with a WHERE condition
DELETE FROM orders WHERE order_date < DATE '2020-01-01';
```

---

## CTEs (WITH)

```sql
-- Basic CTE
WITH tw AS (
    SELECT i0, i1
    FROM tb1
    WHERE i0 > 10
)
SELECT *
FROM tw
WHERE tw.i1 < tw.i0;

-- CTE in JOIN
WITH tw AS (SELECT * FROM tb1)
SELECT * FROM tb2 LEFT JOIN tw ON tb2.i0 = tw.i0;

-- CTE feeding INSERT
WITH a AS (SELECT i0, i1, b0 FROM tb WHERE b0)
INSERT INTO tb SELECT * FROM a;

-- CTE feeding UPDATE
WITH a AS (SELECT NULL)
UPDATE tb SET i0 = NULL;

-- CTE feeding DELETE
WITH a AS (SELECT i1 FROM tb)
DELETE FROM tb WHERE b0;

-- Star-schema CTE
WITH monthly AS (
    SELECT EXTRACT(YEAR FROM order_date)  AS yr,
           EXTRACT(MONTH FROM order_date) AS mo,
           SUM(amount)                    AS revenue
    FROM orders
    GROUP BY yr, mo
)
SELECT * FROM monthly
ORDER BY yr, mo;
```

---

## SELECT INTO

`SELECT INTO` in Oxla supports **two forms**, determined by the INTO target:

1. **Table destination** — `SELECT ... INTO new_table FROM ...` creates a new table (like PostgreSQL's `SELECT INTO`).
2. **File destination** — `SELECT ... INTO 'path' (options) FROM ...` exports to a file (S3, local, etc.). The **parenthesized option list** is what selects the file form.

Both are grounded in `opt_into_clause` in bison_parser.y (`kIntoClauseTable` and `kIntoClauseFile`).

```sql
-- Table destination: create new_table from a query result
SELECT i0, i1
INTO new_table
FROM tb
WHERE b0;

-- File destination: export to local CSV (parenthesized options → file form)
SELECT i0, i1
INTO 'my_file.csv'
     (NULL '', DELIMITER ',', HEADER ON)
FROM tb
WHERE b0;

-- Export to S3 with AWS credentials
SELECT i0, amount
INTO 's3://my-bucket/prefix/output.csv'
     (NULL '',
      DELIMITER ',',
      HEADER ON,
      aws_cred(aws_region 'eu-central-1',
               aws_key_id 'AKID...',
               aws_private_key 'secret...',
               endpoint 'https://s3.amazonaws.com'))
FROM orders
WHERE sold_at >= TIMESTAMP '2024-01-01 00:00:00';

-- Duplicate column source (from test case)
SELECT i0, i0
INTO 'my_file.csv'
     (NULL '', DELIMITER ',', HEADER ON)
FROM tb
WHERE b0;
```

For materializing query results as a permanent table, prefer `CREATE TABLE AS SELECT` (CTAS) — it is the idiomatic form and explicitly names the table.

---

## PREPARE / EXECUTE

```sql
PREPARE get_by_region(VARCHAR) AS
    SELECT * FROM orders WHERE region = $1;

EXECUTE get_by_region('EMEA');
```

---

## Transactions

```sql
BEGIN;
INSERT INTO orders VALUES (99, 'Test', 'EMEA', 1.0, CURRENT_DATE);
-- Commit or rollback
COMMIT;

BEGIN;
UPDATE orders SET amount = 0 WHERE order_id = 99;
ROLLBACK;
```

---

## CASE / IF

```sql
-- CASE WHEN (from test case)
SELECT CASE WHEN i0 = 0 THEN a0 ELSE ARRAY[1,2] END
FROM tb1;

-- IF(condition, true_val, false_val) -- Oxla-specific
SELECT IF(b1, i1, l1), IF(b0, i0, i1)
FROM tb1;
```

---

## GENERATE_SERIES

```sql
SELECT * FROM generate_series(1, 10);
SELECT * FROM generate_series(0, 100, 10);
SELECT * FROM generate_series(10, 1, -1);    -- negative step
SELECT gs FROM generate_series(1, 5) AS gs;  -- aliased column
SELECT * FROM generate_series(1, 100) WHERE generate_series > 50;
```

---

## System queries and pg_catalog compatibility

```sql
-- pg_typeof (from test cases)
SELECT PG_TYPEOF(a0) FROM tb1;

-- pg_get_expr (compatibility function)
SELECT pg_get_expr('pg_node_tree', 1, false);

-- has_schema_privilege
SELECT has_schema_privilege('user', 'schema', 'create');
SELECT has_schema_privilege('schema', 'create');  -- current_user form

-- ANY operator
SELECT i0 FROM tb1 WHERE i0 = ANY(ARRAY[1,2,3]);
```

---

## Operators reference

From `tests/UT/query_planner/cases/select/operators/`:

| Operator | Example |
|----------|---------|
| `+`, `-`, `*`, `/`, `%` | `SELECT i0 + i1 FROM tb1` |
| `=`, `!=`, `<`, `>`, `<=`, `>=` | `SELECT i0 = i1 FROM tb1` |
| `AND`, `OR`, `NOT` | `WHERE a AND b OR NOT c` |
| `IS NULL` / `IS NOT NULL` | `WHERE i0 IS NOT NULL` |
| `IS TRUE` / `IS FALSE` / `IS NOT TRUE` / `IS NOT FALSE` | `WHERE b0 IS TRUE` |
| `LIKE` / `NOT LIKE` | `WHERE s0 LIKE '%abc%'` |
| `->>` (JSON extract as text) | `SELECT col->>'key'` |
| `->` (JSON extract as JSON) | `SELECT col->'key'` |
| `BETWEEN` | `WHERE amount BETWEEN 100 AND 500` |
| `~` (REGEXP) | `WHERE region ~ '^E'` |
| Unary `-` | `SELECT -i0` |
| `AT TIME ZONE` | `SELECT ts AT TIME ZONE 'UTC'` |
| `-` (timestamp subtract) | `SELECT t1 - t0 FROM tb1` |
| `+`, `-` (interval arithmetic) | `SELECT iv0 + iv1` |
