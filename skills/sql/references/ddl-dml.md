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

Oxla does **not** support `ALTER TABLE ... ADD COLUMN`, `DROP COLUMN`, or `RENAME COLUMN`. The parser has no such production.

The only `ALTER TABLE` form re-binds an external Redpanda/Kafka catalog table.
Use the `IF EXISTS` form — it is the canonical Kafka-catalog rebind syntax and the
table name **must** use the `catalog=>table_name` external-source form (the parser
raises `YYERROR` "Expected catalog=>table_name syntax" otherwise):

```sql
ALTER TABLE IF EXISTS my_catalog=>my_table WITH (schema_lookup_policy = 'LATEST');
```

See [kafka-iceberg.md](kafka-iceberg.md) for the full Redpanda/Kafka and Iceberg
catalog integration (an Oxla + Redpanda Enterprise differentiator), including all
connection-option keys.

To change a table's column structure, recreate it with `CREATE TABLE AS SELECT`:

```sql
-- Add a computed column: create a new table with the extra column
CREATE TABLE orders_new AS
    SELECT *, amount * 0.1 AS discount FROM orders;
```

## CREATE / DROP VIEW

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

-- Grant privileges (supported: SELECT, INSERT, UPDATE, DELETE, CREATE, CONNECT, USAGE, ALL PRIVILEGES)
GRANT SELECT ON orders TO analyst;          -- bare table name
GRANT SELECT ON TABLE orders TO analyst;    -- explicit TABLE keyword
GRANT INSERT, UPDATE ON TABLE orders TO analyst;
GRANT ALL PRIVILEGES ON TABLE orders TO analyst;  -- 'ALL PRIVILEGES' required; bare 'ALL' is not valid

-- Schema- and database-level grants
GRANT USAGE ON SCHEMA analytics TO analyst;
GRANT CONNECT ON DATABASE oxla TO analyst;

-- Revoke privileges
REVOKE SELECT ON TABLE orders FROM analyst;
REVOKE GRANT OPTION FOR SELECT ON TABLE orders FROM analyst;
```

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
