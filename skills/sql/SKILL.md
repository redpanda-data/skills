---
name: sql
description: >-
  Write and run SQL against Oxla, a PostgreSQL-wire-compatible distributed
  columnar analytical database. Covers connecting via psql or any PostgreSQL
  driver (port 5432, password "oxla" by default), the full supported data-type
  set (INT/LONG/INT16/INT32/FLOAT/DOUBLE/CHAR/VARCHAR/STRING/TEXT/DATE/TIME/
  TIMESTAMP/TIMESTAMPTZ/INTERVAL/BOOL/JSON/JSONB/BYTEA/NUMERIC/ARRAY/GEOMETRY/
  GEOGRAPHY/POINT), DDL (CREATE/DROP TABLE, CREATE TABLE AS SELECT, CREATE/DROP
  VIEW, CREATE/DROP SCHEMA, TRUNCATE, CREATE ROLE/GRANT/REVOKE), DML
  (SELECT/INSERT/UPDATE/DELETE, SELECT INTO table or file), data loading
  (COPY FROM/TO with CSV/Parquet/ORC formats, S3 credentials), aggregate and
  window functions (SUM/AVG/COUNT/MIN/MAX/percentile_disc/percentile_cont/mode,
  ROW_NUMBER/RANK/DENSE_RANK/LAG/LEAD/FIRST_VALUE/LAST_VALUE/NTH_VALUE/NTILE/
  CUME_DIST), CTEs (WITH), UNION/INTERSECT/EXCEPT (with optional ALL),
  PREPARE/EXECUTE, and analytic query patterns (GROUP BY, ORDER BY,
  LIMIT/OFFSET, multi-table joins, star-schema aggregations). Also covers Oxla's
  external-source integration — the key Oxla + Redpanda enterprise
  differentiator — for querying Redpanda/Kafka topics and Apache Iceberg tables
  directly with SQL: CREATE REDPANDA/KAFKA CATALOG, CREATE ICEBERG CATALOG,
  CREATE STORAGE (s3/gcs/abs), CREATE TABLE catalog=>topic WITH
  (topic/schema_lookup_policy/error_handling_policy/struct_mapping_policy/
  confluent_wire_protocol), ALTER TABLE IF EXISTS catalog=>table WITH (...)
  rebind, REFRESH, GRANT ON EXTERNAL SOURCE, and the related Redpanda Enterprise
  Iceberg-topic properties (redpanda.iceberg.mode/delete/partition.spec/
  target.lag.ms/invalid.record.action). Use when: writing
  SQL for Oxla, connecting to Oxla with psql or a JDBC/Python/Go PostgreSQL
  driver, creating tables and loading data with COPY, running analytical queries
  with joins/aggregations/window functions/CTEs, attaching or querying Redpanda
  topics or Iceberg/lakehouse tables from Oxla, mapping PostgreSQL SQL features
  to what Oxla supports, or debugging SQL that works in PostgreSQL but needs
  adjustment for Oxla's columnar execution model.
---

# Redpanda SQL (Oxla)

Oxla is a distributed columnar analytical database that speaks the PostgreSQL wire protocol (port 5432). Any `psql` client, JDBC driver, `psycopg2`, or `pgx` application connects to it without modification. Oxla is purpose-built for analytical (OLAP) workloads — large scans, aggregations, multi-table joins, and window functions over wide tables — and differs from standard PostgreSQL in execution architecture (columnar, distributed, parallel) and in which DDL/DML features it supports.

Key differences from PostgreSQL to keep in mind:
- There is no `EXPLAIN <query>` SQL statement. Query-plan output is controlled by the config flags `feature_flags.print_query_plan` and `feature_flags.pipeline_visualization`, not by an EXPLAIN command.
- `COPY FROM/TO` uses explicit `FORMAT` option names (`CSV`, `PARQUET`, `ORC`).
- `SELECT INTO` supports two forms: `SELECT ... INTO new_table FROM ...` (creates a new table) and `SELECT ... INTO 'path' (options) FROM ...` (writes to a file). The parenthesized option list selects the file form.
- `CREATE TABLE [IF NOT EXISTS] t AS SELECT ...` (CTAS) is supported and is the idiomatic way to materialize or reshape a table.
- `GENERATE_SERIES(start, stop[, step])` is supported as a table-valued function.

## Quickstart

```bash
# Connect with psql (default password: oxla)
psql -h localhost -p 5432 -U oxla oxla
```

```sql
-- 1. Create a table
CREATE TABLE orders (
    order_id   INT,
    customer   VARCHAR,
    region     VARCHAR,
    amount     DOUBLE,
    order_date DATE
);

-- 2. Insert a few rows (native VALUES form)
INSERT INTO orders VALUES
    (1, 'Acme',   'EMEA', 1250.50, DATE '2024-01-15'),
    (2, 'Globex', 'APAC', 3400.00, DATE '2024-01-16'),
    (3, 'Acme',   'EMEA',  980.00, DATE '2024-02-01');

-- INSERT … SELECT is the form used for transformed or bulk loads:
INSERT INTO orders SELECT order_id, customer, region, amount * 1.1, order_date
FROM orders_staging;

-- 3. COPY from a Parquet file (local or S3)
-- Local file:
COPY orders FROM 'orders.parquet' (FORMAT PARQUET);

-- 4. Run a GROUP BY aggregation
SELECT region,
       COUNT(*)        AS order_count,
       SUM(amount)     AS total_revenue,
       AVG(amount)     AS avg_order
FROM orders
GROUP BY region
ORDER BY total_revenue DESC;

-- 5. Window function: running total per region
SELECT order_date,
       region,
       amount,
       SUM(amount) OVER (PARTITION BY region ORDER BY order_date
                         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_total
FROM orders
ORDER BY region, order_date;

-- 6. CTE (WITH)
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

## Connecting

See [references/connect-and-types.md](references/connect-and-types.md) for full driver connection strings, SSL config, and the default `initial_password`.

Default connection parameters (from `config/Release/default_config.yml`):

| Parameter | Default |
|-----------|---------|
| Host | localhost |
| Port | 5432 |
| User | oxla |
| Password | oxla |
| Database | oxla |

```bash
# psql one-liner
PGPASSWORD=oxla psql -h localhost -p 5432 -U oxla oxla

# Python (psycopg2)
conn = psycopg2.connect(host="localhost", port=5432, user="oxla", password="oxla", dbname="oxla")

# Go (pgx)
conn, _ := pgx.Connect(ctx, "postgres://oxla:oxla@localhost:5432/oxla")
```

## Supported Data Types

Full type reference: [references/connect-and-types.md](references/connect-and-types.md).

Types grounded in `src/sqlparser/sql/ColumnType.h` (the `enum class DataType` listing):

| Oxla Type | Notes |
|-----------|-------|
| `INT` / `INTEGER` | 32-bit integer (`i32`) |
| `LONG` / `BIGINT` | 64-bit integer (`i64`) |
| `INT16` | 128-bit (16-byte) wide integer (`i128`); Oxla-native, **not** 16-bit |
| `INT32` | 256-bit (32-byte) wide integer (`i256`); Oxla-native, **not** an alias of `INT` |
| `FLOAT` | 32-bit float |
| `DOUBLE` | 64-bit float |
| `NUMERIC(p,s)` / `DECIMAL(p,s)` | Fixed-precision |
| `CHAR(n)` / `VARCHAR(n)` / `TEXT` | String types |
| `DATE` | Calendar date |
| `TIME` / `TIMETZ` | Time of day |
| `TIMESTAMP` / `TIMESTAMPTZ` | Date+time |
| `INTERVAL` | Duration |
| `BOOL` | Boolean |
| `JSON` / `JSONB` | JSON document |
| `BYTEA` | Binary data |
| `ARRAY` | Arrays (`INT[]`, `FLOAT[]`, etc.) |
| `GEOMETRY` / `GEOGRAPHY` / `POINT` | Geospatial |

## DDL and DML

Full reference: [references/ddl-dml.md](references/ddl-dml.md).

```sql
-- CREATE TABLE
CREATE TABLE sales (
    id         INT,
    product    VARCHAR,
    qty        INT,
    price      DOUBLE,
    sold_at    TIMESTAMP
);

-- CREATE TABLE AS SELECT (CTAS — materialize / reshape a table)
CREATE TABLE sales_2024 AS
    SELECT * FROM sales WHERE sold_at >= TIMESTAMP '2024-01-01 00:00:00';

-- CREATE TABLE IF NOT EXISTS AS SELECT
CREATE TABLE IF NOT EXISTS sales_backup AS SELECT * FROM sales;

-- DROP TABLE
DROP TABLE sales;
DROP TABLE IF EXISTS sales;

-- NOTE: Oxla does NOT support ALTER TABLE ... ADD/DROP/RENAME COLUMN.
-- The only ALTER TABLE form re-binds an external Redpanda/Kafka catalog table.
-- Use IF EXISTS and the catalog=>table_name external-source form (both required):
--   ALTER TABLE IF EXISTS my_catalog=>my_table WITH (schema_lookup_policy='LATEST')
-- To change a table's schema, use CREATE TABLE AS SELECT to recreate it.

-- NOTE: GRANT ... ON ALL TABLES IN SCHEMA is NOT valid in Oxla (parser rejects
-- the literal 'tables'). Valid targets: ON table, ON TABLE table, ON SCHEMA name,
-- ON DATABASE name, ON EXTERNAL SOURCE catalog. See references/ddl-dml.md.

-- TRUNCATE
TRUNCATE TABLE sales;

-- CREATE / DROP VIEW
CREATE VIEW emea_orders AS
    SELECT * FROM orders WHERE region = 'EMEA';
DROP VIEW emea_orders;

-- INSERT — native VALUES form (literal rows)
INSERT INTO sales VALUES (1, 'Widget', 10, 9.99, TIMESTAMP '2024-01-15 12:00:00');

-- INSERT … SELECT (for transformed or bulk loads)
INSERT INTO dest SELECT col1, col2 FROM source WHERE condition;

-- UPDATE / DELETE
UPDATE orders SET amount = 0 WHERE order_id = 1;
DELETE FROM orders WHERE order_date < DATE '2020-01-01';

-- Transactions
BEGIN;
INSERT INTO orders VALUES (99, 'Test', 'EMEA', 1.0, CURRENT_DATE);
ROLLBACK;

-- PREPARE / EXECUTE
PREPARE get_region(VARCHAR) AS
  SELECT * FROM orders WHERE region = $1;
EXECUTE get_region('EMEA');
```

## Data Loading

Full reference: [references/data-loading.md](references/data-loading.md).

```sql
-- COPY FROM CSV via STDIN
COPY orders FROM STDIN (FORMAT CSV);

-- COPY FROM Parquet file
COPY orders FROM 'orders.parquet' (FORMAT PARQUET);

-- COPY FROM ORC file
COPY orders FROM 'orders.orc' (FORMAT ORC);

-- COPY TO CSV
COPY orders TO 'export.csv' (NULL '', DELIMITER ',', HEADER ON);

-- COPY TO Parquet
COPY orders TO 'export.parquet' (FORMAT parquet);

-- SELECT INTO file form (parenthesized options → writes to file, not table)
SELECT id, amount
INTO 's3://bucket/prefix/out.csv'
     (NULL '', DELIMITER ',', HEADER ON,
      aws_cred(aws_region 'eu-central-1',
               aws_key_id 'AKID...',
               aws_private_key 'secret...',
               endpoint 'https://s3.amazonaws.com'))
FROM orders
WHERE sold_at >= TIMESTAMP '2024-01-01 00:00:00';
```

## Redpanda/Kafka and Iceberg External Sources (enterprise differentiator)

Full reference: [references/kafka-iceberg.md](references/kafka-iceberg.md).

Oxla can attach Redpanda/Kafka topics and Apache Iceberg tables as external
sources and query them with plain SQL — the central Oxla + Redpanda enterprise
differentiator. The Redpanda-side features it consumes (Iceberg Topics, Tiered
Storage, Cloud Topics) each require a **Redpanda Enterprise license**.

External tables use the `catalog=>table_name` reference syntax.

```sql
-- 1. Object-storage connection (s3 / gcs / abs)
CREATE STORAGE my_s3 TYPE = S3 WITH (
    region = 'us-west-2', access_key_id = 'AKID...', secret_access_key = 'secret...');

-- 2. Iceberg catalog (e.g. Redpanda Iceberg Topics, Glue, Polaris)
CREATE ICEBERG CATALOG my_iceberg STORAGE my_s3 WITH (
    uri = 'https://rest-catalog', warehouse = 's3://wh/', auth_type = 'oauth2',
    oauth2_client_id = 'id', oauth2_client_secret = 'secret');

-- 3. Redpanda/Kafka catalog (initial_brokers + schema_registry_url required)
CREATE REDPANDA CATALOG my_rp WITH (
    initial_brokers = 'localhost:9092', schema_registry_url = 'http://localhost:8081');

-- 4. Bind a topic to a queryable table (topic option required)
CREATE TABLE my_rp=>orders WITH (
    topic = 'orders', schema_lookup_policy = 'LATEST', struct_mapping_policy = 'JSON');

-- 5. Query it like any table
SELECT region, COUNT(*) FROM my_rp=>orders GROUP BY region;

-- Rebind/reconfigure (IF EXISTS + catalog=>table both required)
ALTER TABLE IF EXISTS my_rp=>orders WITH (error_handling_policy = 'DROP_RECORD');

-- Refresh external metadata; grant access
REFRESH my_rp=>orders;
GRANT SELECT ON EXTERNAL SOURCE my_rp TO analyst;
```

Related Redpanda Enterprise Iceberg-topic properties (set on the Redpanda side):
`redpanda.iceberg.mode` (`disabled`/`key_value`/`value_schema_id_prefix`/
`value_schema_latest`), `redpanda.iceberg.delete`, `redpanda.iceberg.partition.spec`,
`redpanda.iceberg.target.lag.ms`, `redpanda.iceberg.invalid.record.action`
(`drop` or `dlq_table`; default `dlq_table`).

## Functions and Analytics

Full reference: [references/functions-and-analytics.md](references/functions-and-analytics.md).

### Aggregate functions

```sql
SELECT COUNT(*), SUM(amount), AVG(amount), MIN(amount), MAX(amount)
FROM orders;

-- Ordered-set aggregates
SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY amount DESC) AS median FROM orders;
SELECT percentile_cont(ARRAY[0.25, 0.75]) WITHIN GROUP (ORDER BY amount) AS quartiles FROM orders;
SELECT mode() WITHIN GROUP (ORDER BY region) FROM orders;
```

### Window functions

```sql
-- Ranking
SELECT order_id, region, amount,
       RANK()       OVER (PARTITION BY region ORDER BY amount DESC) AS rnk,
       DENSE_RANK() OVER (PARTITION BY region ORDER BY amount DESC) AS dense_rnk,
       ROW_NUMBER() OVER (PARTITION BY region ORDER BY amount DESC) AS rn
FROM orders;

-- LAG / LEAD
SELECT order_date, amount,
       LAG(amount, 1) OVER (ORDER BY order_date)  AS prev_amount
FROM orders;

-- Named window
SELECT SUM(amount) OVER w, AVG(amount) OVER w
FROM orders
WINDOW w AS (PARTITION BY region ORDER BY order_date
             ROWS BETWEEN 2 PRECEDING AND CURRENT ROW);
```

### String functions

```sql
SELECT UPPER(customer), LOWER(region),
       CONCAT(customer, ' / ', region),
       LENGTH(customer),
       SUBSTR(customer, 1, 4),
       STARTS_WITH(customer, 'A'),
       ENDS_WITH(customer, 'e'),
       STRPOS(customer, 'me'),
       REPLACE(customer, 'Acme', 'ACME'),
       REGEXP_REPLACE(customer, 'G.*', 'Corp', 'i')
FROM orders;
```

### Math functions

```sql
SELECT ABS(-1.5), CEIL(1.2), FLOOR(1.9), ROUND(1.567),
       SQRT(16.0), EXP(1.0), LN(2.718), LOG10(100.0),
       SIN(3.14), COS(0.0), TAN(0.785),
       PI(), SIGN(-5);
```

### Date/time functions

```sql
SELECT EXTRACT(YEAR FROM order_date),
       EXTRACT(MONTH FROM order_date),
       EXTRACT(DAY FROM order_date),
       TIMESTAMP_TRUNC(sold_at, HOUR),
       MAKE_DATE(2024, 3, 15),
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP(3)
FROM orders;
```

## Joins

```sql
-- INNER JOIN
SELECT o.order_id, c.name
FROM orders o
JOIN customers c ON o.customer = c.name;

-- LEFT / RIGHT / FULL JOIN
SELECT o.order_id, p.product_name
FROM orders o
LEFT JOIN products p ON o.product = p.id;

-- FULL OUTER JOIN
SELECT o.order_id, r.label
FROM orders o
FULL JOIN regions r ON o.region = r.code;

-- CROSS JOIN
SELECT * FROM (SELECT amount FROM orders LIMIT 5)
CROSS JOIN (SELECT region FROM regions LIMIT 3);

-- Multi-table (star-schema style)
SELECT d.year, p.category, SUM(f.revenue) AS total
FROM fact_sales f
JOIN dim_date    d ON f.date_key = d.date_key
JOIN dim_product p ON f.product_key = p.product_key
GROUP BY d.year, p.category
ORDER BY d.year, total DESC;
```

## Set Operations

UNION, INTERSECT, and EXCEPT each accept an optional `ALL` qualifier. Without `ALL`, duplicates are eliminated (distinct semantics).

```sql
-- UNION ALL (keeps duplicates)
SELECT region FROM orders WHERE amount > 1000
UNION ALL
SELECT region FROM returns;

-- UNION (distinct)
SELECT region FROM orders
UNION
SELECT region FROM returns;

-- INTERSECT ALL
SELECT region FROM orders
INTERSECT ALL
SELECT region FROM targets;

-- EXCEPT [ALL] — rows in left but not right
SELECT region FROM orders
EXCEPT
SELECT region FROM blacklist;

SELECT i0 FROM tb1
EXCEPT ALL
SELECT i0 FROM tb2;
```

## GENERATE_SERIES

```sql
SELECT * FROM generate_series(1, 10);
SELECT * FROM generate_series(0, 100, 10);
SELECT gs FROM generate_series(1, 5) AS gs;
SELECT * FROM generate_series(10, 1, -1);
```

## Reference Directory

- [connect-and-types.md](references/connect-and-types.md): PostgreSQL wire protocol connection (port 5432, psql/JDBC/psycopg2/pgx), authentication (`initial_password`), SSL config, and the full supported data-type list grounded in `ColumnType.h`.
- [ddl-dml.md](references/ddl-dml.md): CREATE/DROP TABLE, CREATE TABLE AS SELECT (CTAS), CREATE/DROP VIEW, CREATE/DROP SCHEMA, TRUNCATE, CREATE ROLE, GRANT/REVOKE (valid targets: ON table / ON TABLE / ON SCHEMA / ON DATABASE / ON EXTERNAL SOURCE — `ON ALL TABLES IN SCHEMA` is rejected by the parser), the `ALTER TABLE IF EXISTS catalog=>table WITH (...)` Kafka-catalog rebind, SELECT/INSERT VALUES/INSERT SELECT/UPDATE/DELETE, SELECT INTO (table or file destination), PREPARE/EXECUTE, and transactions — all grounded in `query_planner` test cases and `bison_parser.y`.
- [kafka-iceberg.md](references/kafka-iceberg.md): Oxla + Redpanda enterprise differentiator — querying Redpanda/Kafka topics and Apache Iceberg tables via SQL. CREATE/ALTER/DROP STORAGE (s3/gcs/abs), CREATE/ALTER/DROP ICEBERG CATALOG (uri/warehouse/auth_type oauth2|basic|aws_sigv4 + nested keys), CREATE/ALTER/DROP REDPANDA|KAFKA CATALOG (initial_brokers/schema_registry_url required, sasl_*, truststore, key_store_*, USING CATALOG bind/detach), CREATE TABLE / ALTER TABLE IF EXISTS catalog=>topic WITH (topic/schema_lookup_policy/error_handling_policy/struct_mapping_policy/confluent_wire_protocol), REFRESH, DESCRIBE/SHOW, GRANT ON EXTERNAL SOURCE, and the Redpanda Enterprise Iceberg-topic properties (redpanda.iceberg.mode/delete/partition.spec/target.lag.ms/invalid.record.action). Notes Redpanda Enterprise license requirements. Grounded in `bison_parser.y`, `connection_option_names.h`, `kafka/conversions.cpp`, `iceberg_catalog_parser.cpp`.
- [data-loading.md](references/data-loading.md): COPY FROM / COPY TO with CSV/Parquet/ORC formats, STDIN/STDOUT, S3 credentials via `aws_cred(...)`, and bulk-loading patterns for analytical ingestion.
- [functions-and-analytics.md](references/functions-and-analytics.md): Complete function reference — aggregates (SUM/AVG/COUNT/percentile_disc/percentile_cont/mode/CORR), string (CONCAT/SUBSTR/REPLACE/REGEXP_REPLACE/STARTS_WITH/ENDS_WITH/STRPOS/LENGTH/UPPER/LOWER), math (ABS/CEIL/FLOOR/ROUND/SQRT/EXP/LN/LOG10/trig), date-time (EXTRACT/TIMESTAMP_TRUNC/MAKE_DATE/MAKE_TIMESTAMP/CURRENT_TIMESTAMP), window functions, CTEs, CASE/IF, and ARRAY functions — all grounded in test cases.
