Source: cloud-docs `modules/reference/pages/sql/sql-statements/{index,select,create-view,drop-view,copy-to,set-show,describe,show-catalogs,show-tables,show-nodes,show-queries,show-execs,grant,revoke,create-user,alter-user,drop-user}.adoc`, `modules/reference/pages/sql/sql-clauses/**`, `modules/reference/pages/sql/sql-operators/index.adoc`, `modules/reference/pages/sql/{transactions,schema,comment-support,information-schema,system-virtual-tables}.adoc`, `modules/reference/pages/sql/system-catalogs/index.adoc`, `modules/reference/pages/sql/system-catalogs/catalogs/{pg_views,pg_class}.adoc`, `modules/sql/pages/query-data/tables-and-views.adoc`, `modules/sql/pages/manage/manage-access.adoc` (verified 2026-10-21). File-by-file mapping in [SOURCES.md](SOURCES.md).

# Statements and Clauses

Redpanda SQL is read-only. The published statement set is:

| Area | Statements | Covered in |
|---|---|---|
| Query | `SELECT` | this file |
| Views | `CREATE VIEW`, `DROP VIEW` | this file |
| Export | `COPY TO` | this file |
| Session | `SET`, `SHOW <option>` | this file |
| Metadata | `DESCRIBE`, `SHOW CATALOGS`, `SHOW TABLES` | this file |
| Cluster runtime (superuser) | `SHOW NODES`, `SHOW QUERIES`, `SHOW EXECS` | this file; troubleshooting in `/redpanda:sql-debugging` |
| Access | `GRANT`, `REVOKE`, `CREATE`/`ALTER`/`DROP USER` | this file; access model in `/redpanda:sql-admin-api` |
| Catalogs and topic mappings | `CREATE`/`ALTER`/`DROP REDPANDA CATALOG`, `CREATE`/`ALTER`/`DROP ICEBERG CATALOG`, `CREATE`/`ALTER`/`DROP STORAGE`, `CREATE`/`ALTER`/`DROP TABLE` (`catalog=>table`), `REFRESH` | `/redpanda:sql-federated-queries` |

`INSERT`, `UPDATE`, `DELETE`, and `COPY FROM` are not available, and `CREATE
TABLE` only maps a topic through a catalog. `CREATE VIEW` saves a `SELECT` query
over those tables and is read-only too. Anything outside this set (for example
indexes, materialized views, `SELECT INTO`, `CREATE TABLE AS`, or `PREPARE`) is
not part of the published surface; tell the user so instead of improvising.

---

## SELECT

```sql
SELECT * FROM default_redpanda_catalog=>student_data;
SELECT id, name FROM default_redpanda_catalog=>student_data WHERE domicile = 'Sydney';
SELECT DISTINCT domicile FROM default_redpanda_catalog=>student_data;
```

- Keywords are case-insensitive.
- `DISTINCT` deduplicates on the combination of all listed columns.
  `SELECT DISTINCT ON (...)` is **not** supported.
- A query may combine `FROM`, `JOIN`, `WHERE`, `GROUP BY`, `HAVING`, window
  functions, `ORDER BY`, `LIMIT`/`OFFSET`, `WITH`, and set operations as below.

### FROM and subqueries

```sql
-- Subquery in FROM (alias it)
SELECT x.customer, x.total
FROM (SELECT customer, SUM(amount) AS total
      FROM default_redpanda_catalog=>orders
      GROUP BY customer) AS x
WHERE x.total > 50000;

-- Comma join with a WHERE condition
SELECT o.order_id, c.region
FROM default_redpanda_catalog=>orders AS o, default_redpanda_catalog=>customers AS c
WHERE o.customer = c.customer;
```

### JOIN

```sql
SELECT o.order_id, c.region
FROM default_redpanda_catalog=>orders AS o
JOIN default_redpanda_catalog=>customers AS c ON o.customer = c.customer;

SELECT order_id, region
FROM default_redpanda_catalog=>orders
JOIN default_redpanda_catalog=>customers USING (customer);

-- LEFT JOIN, RIGHT JOIN, and OUTER JOIN (FULL OUTER JOIN) use the same ON form
SELECT o.order_id, r.refund_id
FROM default_redpanda_catalog=>orders AS o
LEFT JOIN default_redpanda_catalog=>refunds AS r ON o.order_id = r.order_id;
```

`LEFT JOIN` keeps every left row, `RIGHT JOIN` every right row, and `OUTER JOIN`
(`FULL OUTER JOIN`) every row from both sides, with `NULL` where there is no match.
Multi-column keys can be compared as tuples: `ON (a.x, a.y) = (b.x, b.y)`. Array
columns cannot be join keys.

### WHERE

Conditions use the comparison, logical, null-test, pattern, and array operators
(see [Operators](#operators)):

```sql
SELECT empname, empdept FROM default_redpanda_catalog=>salary WHERE empdept = 'Marketing';
SELECT * FROM default_redpanda_catalog=>salary WHERE empname LIKE 'Br%';        -- '%string' to match the end
SELECT * FROM default_redpanda_catalog=>salary WHERE empdept = ANY(ARRAY['HR', 'Finance']);
SELECT * FROM default_redpanda_catalog=>salary WHERE bonus IS NOT NULL AND salary >= 3000;
```

### GROUP BY and HAVING

```sql
SELECT subject, AVG(score_val) AS avg_score
FROM default_redpanda_catalog=>score
GROUP BY subject
HAVING AVG(score_val) > 80;

-- Conditional aggregation with CASE
SELECT subject, SUM(CASE WHEN score_stat = 'PASSED' THEN 1 ELSE 0 END) AS passed_count
FROM default_redpanda_catalog=>score
GROUP BY subject
HAVING SUM(CASE WHEN score_stat = 'PASSED' THEN 1 ELSE 0 END) > 2;
```

`WHERE` filters rows before grouping; `HAVING` filters groups and can use
aggregates. Arrays and maps cannot be grouping keys; `row` values can.

### ORDER BY

```sql
ORDER BY sort_expression [ASC | DESC] [NULLS FIRST | NULLS LAST] [, ...]
```

Default is `ASC`. Nulls sort last for `ASC` and first for `DESC` unless
`NULLS FIRST`/`NULLS LAST` says otherwise. Array and map values cannot be sort
keys; a `row` sorts lexicographically by its fields.

### LIMIT, FETCH, OFFSET

```sql
SELECT * FROM default_redpanda_catalog=>comporders ORDER BY total DESC LIMIT 10;
SELECT * FROM default_redpanda_catalog=>comporders ORDER BY total DESC FETCH NEXT 10 ROWS ONLY;
SELECT * FROM default_redpanda_catalog=>salaryemp ORDER BY emp_sal LIMIT 5 OFFSET 3;
```

`LIMIT NULL` is the same as no limit; `LIMIT 0` returns no rows.

### WITH (common table expressions)

```sql
WITH a AS (SELECT 77), b AS (SELECT * FROM a) SELECT * FROM b;
```

CTEs are **non-materialized**: each reference is replaced by its body early in
planning, and each use is optimized separately for how the outer query uses it. A
later CTE may refer to an earlier one. A body is a `SELECT`. The same CTE can be
referenced more than once (`FROM b CROSS JOIN b AS b1`).

### Set operations

```sql
SELECT emp_name FROM default_redpanda_catalog=>employees
UNION                     -- or UNION ALL to keep duplicates
SELECT contractor_name FROM default_redpanda_catalog=>contractors;

SELECT customer_name FROM default_redpanda_catalog=>customers_old
INTERSECT                 -- or INTERSECT ALL
SELECT customer_name FROM default_redpanda_catalog=>customers_new;

SELECT vhc_name FROM default_redpanda_catalog=>vehicles_2021
EXCEPT                    -- or EXCEPT ALL
SELECT vhc_name FROM default_redpanda_catalog=>vehicles_2022;
```

Without `ALL`, duplicates are removed.

### Window clauses

`OVER (...)` is required for a window function; `WINDOW name AS (...)` defines
named windows. Frames support `ROWS` and `RANGE`; `GROUPS` and frame exclusion are
not supported. Full rules and functions:
[functions-and-analytics.md](functions-and-analytics.md#window-functions).

### Comments

`-- single line` (to the end of the line) and `/* block */` (anywhere in the
statement) are both supported.

---

## Operators

| Kind | Operators |
|---|---|
| Comparison | `=`, `<>` / `!=`, `<`, `<=`, `>`, `>=` |
| Logical | `AND`, `OR`, `NOT` |
| Null and boolean tests | `IS [NOT] NULL`, `IS [NOT] DISTINCT FROM`, `IS [NOT] TRUE`, `IS [NOT] FALSE` |
| Arithmetic | `+`, `-` (also unary), `*`, `/`, `%` |
| Math | `@` (absolute value), `^` (power), `\|/` (square root), `\|\|/` (cube root) |
| Bitwise | `&`, `\|`, `#` (XOR), `~` (NOT), `<<`, `>>` |
| String and pattern | `\|\|` (concatenate strings or append to an array), `LIKE` / `~~`, `!~~` (NOT LIKE), `~~*` (ILIKE), `!~~*` (NOT ILIKE), `~`, `~*`, `!~`, `!~*` (POSIX regex, `*` = case-insensitive) |
| JSON | `->` (field or element as `json`), `->>` (as `text`) |
| Array | `= ANY(array)`, `= ALL(array)` |
| Time zone | `AT TIME ZONE 'zone'` |

`IS DISTINCT FROM` treats `NULL` as a comparable value: `NULL IS DISTINCT FROM
NULL` is false. Date, time, timestamp, and interval arithmetic is listed in
[connect-and-types.md](connect-and-types.md#date-time-timestamp-interval).

---

## Views

A view is a named `SELECT` query that you reference like a table. Redpanda SQL
stores the query, not its results, so every query of a view reads current data. A
view is read-only, like the rest of the engine.

```sql
CREATE VIEW [IF NOT EXISTS] [schema_name.]view_name AS select_statement;
DROP VIEW [IF EXISTS] [schema_name.]view_name;
```

```sql
CREATE VIEW large_orders AS
SELECT order_id, customer, amount
FROM default_redpanda_catalog=>orders
WHERE amount > 100;

SELECT customer, count(*) AS order_count
FROM large_orders
GROUP BY customer;
```

- **A view lives in a SQL schema, not in a catalog.** It is created in the current
  schema (`public` by default) unless you qualify it. A `catalog=>` name fails
  with `views on external catalogs are not supported`. Query a view as
  `large_orders` or `public.large_orders`, never with a catalog prefix.
- The defining query can read topic-backed tables in a Redpanda catalog and other
  views, and can use joins, `WITH`, `UNION`, `ORDER BY`, and `LIMIT`.
- Views and tables share one namespace in a schema. `IF NOT EXISTS` makes the
  statement do nothing when that name is taken, but the query is still validated.
- Unqualified names in the query resolve against the search path in effect when
  the view was created. A common table expression with a view's name hides the
  view in that query; qualify the view with its schema to reach it.
- **The column shape is frozen at creation.** Redpanda SQL stores the view's
  column names and types, and every later query must produce the same ones. If a
  table the view reads gains a column, a `SELECT *` view stops working and queries
  fail with an error ending `drop and recreate the view`. List the columns in the
  query instead of using `SELECT *`.
- **Views are tracked as dependencies; catalog tables are not.** `DROP VIEW` fails
  while another view reads it (`cannot drop view <view-name> because other objects
  depend on it.`); drop the dependent view first. There is no `CASCADE` or
  `RESTRICT`. A catalog table can be dropped while a view reads it, and queries of
  the view then fail.
- Each `DROP VIEW` removes one view and only its definition; the tables it reads
  are untouched. Only the owner or a superuser can drop a view, otherwise
  `permission denied: must be owner of table <view-name>`.
- Not supported: `CREATE OR REPLACE VIEW`, `ALTER VIEW`, a column name list
  (`CREATE VIEW v (a, b) AS ...` — use column aliases in the query instead),
  temporary views, recursive views, `WITH CHECK OPTION`, and materialized views.
- Views are **not** listed by `information_schema.tables` or by the `psql`
  commands `\d` and `\dv`. List them from [`pg_views`](#pg_catalog) instead.

### View permissions

A view is a privilege boundary: Redpanda SQL runs the stored query with the
privileges of the view's owner.

- Creating one needs `CREATE` on the schema and `SELECT` on every table and view
  the query reads. You become the owner.
- Querying one needs only `SELECT` on the view itself, not on the tables behind
  it. Grant it with `GRANT SELECT ON TABLE view_name TO role_name` — use `TABLE`
  even for a view; there is no `ON VIEW` form.
- **So any role you grant `SELECT` on a view can read everything that view
  returns.** Grant it only to users who may see that data. This is how a view
  narrows what a role sees: grant `SELECT` on a view that projects or filters a
  table, and no grant on the table itself.
- If the owner loses access to a table the view reads, queries of the view fail
  for every user.
- Transfer ownership with `ALTER TABLE view_name OWNER TO role_name` (again
  `TABLE`, even for a view).

---

## COPY TO

```sql
COPY { table_name [ ( column_name [, ...] ) ] | ( query ) }
TO { 'file_path' | STDOUT }
[ WITH ( option [, ...] ) ];
```

| Option | Values | Default |
|---|---|---|
| `FORMAT` | `CSV` only | CSV |
| `DELIMITER` | a single character, for example `';'` or `'\|'` | `,` |
| `HEADER` | `ON`/`TRUE`/`1`, `OFF`/`FALSE`/`0` | `OFF` |
| `NULL` | string written for `NULL` values | empty string |
| `AWS_CRED(...)` / `GCS_CRED(...)` | object-storage credentials | — |

```sql
-- To the client
COPY (SELECT * FROM default_redpanda_catalog=>book_inventory) TO STDOUT;
COPY (SELECT * FROM default_redpanda_catalog=>customer) TO STDOUT WITH (DELIMITER ';', HEADER ON, NULL 'unknown');

-- To Amazon S3
COPY (SELECT * FROM default_redpanda_catalog=>film) TO 's3://<bucket-name>/<file-name>'
WITH (AWS_CRED(AWS_REGION 'us-west-1', AWS_KEY_ID '<aws-key-id>', AWS_PRIVATE_KEY '<access-key>',
               ENDPOINT 's3.us-west-1.amazonaws.com'),
      FORMAT CSV, HEADER ON);

-- To Google Cloud Storage with a service account key
COPY (SELECT * FROM default_redpanda_catalog=>film) TO 'gs://<bucket-name>/<file-name>'
WITH (GCS_CRED('<credentials-json-contents>'));

-- On a GCP cluster GCS_CRED is optional: Application Default Credentials are used
COPY (SELECT * FROM default_redpanda_catalog=>film) TO 'gs://<bucket-name>/<file-name>';
```

- `TO STDOUT` sends rows to the client; capture them with `psql -c "COPY (...) TO
  STDOUT WITH (FORMAT CSV, HEADER ON)" > out.csv`. A quoted path that is not an
  object-storage URL is a **server-side** file on the SQL engine, which Cloud users
  cannot retrieve, so prefer `STDOUT` or a bucket.
- The destination file is overwritten if it exists.
- `GCS_CRED` cannot override the endpoint. To reach GCS through its S3-compatible
  XML API (HMAC keys), use `AWS_CRED` with `ENDPOINT 'https://storage.googleapis.com'`.
- Array columns cannot be exported.
- SQL Studio can download a result as CSV or JSON without `COPY TO`.

---

## SET and SHOW

```sql
SET <option> TO <value>;      -- '=' also works; boolean options take ON / OFF
SHOW <option>;
```

| Option | Meaning |
|---|---|
| `timezone` | time zone used by date and time functions |
| `search_path` | namespaces searched for unqualified names (default `public`) |
| `extra_float_digits` | extra digits shown for floating-point values |
| `client_min_messages` | minimum message level sent to the client (`DEBUG5`–`DEBUG1`, `LOG`, `NOTICE`, `WARNING`, `ERROR`) |
| `application_name` | client application name |
| `oxla.enable_fast_math` | faster, less precise math functions (`ON`/`OFF`) |

```sql
SET client_min_messages TO 'WARNING';
SET oxla.enable_fast_math = ON;
SHOW timezone;
```

---

## DESCRIBE

```sql
DESCRIBE TABLE default_redpanda_catalog=>transactions;   -- columns: database_name, table_name, name, type, nullable
DESCRIBE REDPANDA CATALOG default_redpanda_catalog;      -- table_name, topic_name mappings
DESCRIBE ICEBERG CATALOG lakehouse_catalog;              -- REST endpoint, warehouse, auth type
DESCRIBE STORAGE archive_storage;                        -- name, type, schema_name, parameters
DESCRIBE DATABASE;                                       -- list tables
```

Requires `USAGE` on the schema that holds the object.

## SHOW CATALOGS and SHOW TABLES

```sql
SHOW CATALOGS;                    -- Redpanda and Iceberg catalogs
SHOW REDPANDA CATALOGS;           -- SHOW KAFKA CATALOGS is a synonym
SHOW ICEBERG CATALOGS;

SHOW TABLES FROM default_redpanda_catalog;
SHOW REDPANDA TABLES [catalog_name | schema.catalog_name];   -- SHOW KAFKA TABLES is a synonym
SHOW ICEBERG TABLES [catalog_name | schema.catalog_name];
```

The unqualified `SHOW TABLES` is an error. All variants list only objects in
schemas where the caller has `USAGE`. For filtering and sorting, query the
equivalent [system virtual tables](#system-virtual-tables).

## SHOW NODES, SHOW QUERIES, SHOW EXECS

Superuser only. Each equals `SELECT * FROM system.nodes` / `system.queries` /
`system.execs`, so query the table to filter or sort. `SHOW NODES` columns:
`name`, `election_state`, `followers_count`, `connected_nodes_count`,
`degradation_error`. Interpreting them is covered by `/redpanda:sql-debugging`.

---

## Transactions

`BEGIN` / `BEGIN TRANSACTION`, `COMMIT` / `END TRANSACTION`, and `ROLLBACK` are
accepted so that tools which issue them keep working. Statements run immediately,
there are no transactional guarantees, and `ROLLBACK` ends the transaction without
undoing anything. A transaction can hold several `SELECT` statements or a single
other statement.

## SQL schemas

A SQL schema is a PostgreSQL-style namespace, not a Schema Registry schema.
Catalogs and storage definitions live in a schema (`public` by default); topic
tables are scoped to catalogs. Built-in schemas: `public`, `pg_catalog` (on the
search path implicitly), and `information_schema`.

```sql
CREATE SCHEMA [IF NOT EXISTS] schema_name;
DROP SCHEMA [IF EXISTS] schema_name;   -- must be empty
DROP SCHEMA schema_name CASCADE;       -- drops the schema and its objects
```

Schemas are mainly used to organize user-defined types and to scope catalogs.

---

## Access control

Redpanda SQL is deny-all by default. The Redpanda Cloud role *SQL: Manage* makes a
user an SQL superuser (reads everything, creates catalogs and tables, grants
access); *SQL: Access* lets a user connect but read nothing until granted. Queries
reach topics through one internal credential of `default_redpanda_catalog`, so
Kafka ACLs do not gate SQL reads: `GRANT`/`REVOKE` are the boundary. Role
assignment and the full model: `/redpanda:sql-admin-api`.

### Privilege levels

| Level | Object | Privileges | `ALL [PRIVILEGES]` means |
|---|---|---|---|
| External source | a Redpanda catalog or a storage definition | `SELECT` | `SELECT` only |
| Table | a view (the only relation of this level a user can create) | `SELECT`, `INSERT`, `UPDATE`, `DELETE` | all four, of which only `SELECT` acts |
| Schema | a SQL schema | `USAGE`, `CREATE` | both |
| Database | `oxla` | `CONNECT` | `CONNECT` |

Topic-backed tables are reached through their catalog, so for topics the
external-source level is the one that matters. At the table level only `SELECT`
does anything on a view: `INSERT`, `UPDATE`, and `DELETE` can be granted but have
no effect, because a view is read-only, and a write to one fails with
`relation "<view-name>" does not exist`. `USAGE` on a schema
is needed to see its catalogs (`SHOW CATALOGS`, `system.catalogs`) and to
reference objects in it by name; `CREATE` on a schema lets a non-superuser run
`CREATE REDPANDA CATALOG` or `CREATE STORAGE` there.

### GRANT

Only a superuser can grant. User names are emails, double-quoted.

```sql
GRANT { SELECT | ALL [PRIVILEGES] } ON EXTERNAL SOURCE catalog_name TO role_name;
GRANT { SELECT | ALL [PRIVILEGES] } ON EXTERNAL SOURCE catalog_name => 'pattern' TO role_name;
GRANT { privilege [, ...] | ALL [PRIVILEGES] } ON TABLE view_name TO role_name;
GRANT { privilege [, ...] | ALL [PRIVILEGES] } ON SCHEMA schema_name TO role_name;
GRANT CONNECT ON DATABASE oxla TO role_name;
```

```sql
GRANT SELECT ON EXTERNAL SOURCE default_redpanda_catalog => 'orders'   TO "alice@example.com";
GRANT SELECT ON EXTERNAL SOURCE default_redpanda_catalog => 'orders_*' TO "alice@example.com";
GRANT SELECT ON EXTERNAL SOURCE default_redpanda_catalog               TO "alice@example.com";
GRANT SELECT ON TABLE large_orders TO "alice@example.com";   -- a view; there is no ON VIEW
GRANT USAGE  ON SCHEMA public TO "alice@example.com";
```

- `pattern` is a string literal; `*` is allowed only at the end. It is stored
  verbatim.
- The catalog-level form covers every relation reachable through the source.
- `ON TABLE` takes a view name; see [View permissions](#view-permissions) for what
  granting `SELECT` on a view exposes. `REVOKE` takes the same form with `FROM`.
- `CONNECT` is managed by the Cloud operator from the *SQL: Access* / *SQL: Manage*
  role; a manual `GRANT CONNECT` may be reverted.

### REVOKE

Same forms with `FROM`:

```sql
REVOKE SELECT ON EXTERNAL SOURCE default_redpanda_catalog => 'orders'   FROM "alice@example.com";
REVOKE SELECT ON EXTERNAL SOURCE default_redpanda_catalog => 'orders_*' FROM "alice@example.com";
REVOKE SELECT ON EXTERNAL SOURCE default_redpanda_catalog               FROM "alice@example.com";
REVOKE USAGE  ON SCHEMA public FROM "alice@example.com";
```

- A non-wildcard pattern that matches no stored grant is an **error**; look up the
  exact stored pattern first.
- The catalog-level form (no pattern) is idempotent and safe in cleanup scripts.
- A wildcard grant cannot be partially revoked: revoke it in full, then grant the
  narrower patterns you want.

### Inspect grants

```sql
-- Per-pattern external-source grants (pattern other than '*')
SELECT grantee, source_name, relation_pattern, privilege_type
FROM information_schema.role_external_relation_grants;

-- Catalog-level grants appear here, with table_name = the catalog name
SELECT * FROM information_schema.role_table_grants;
SELECT * FROM information_schema.role_usage_grants;

SELECT has_schema_privilege('alice@example.com', 'public', 'usage');
SELECT has_database_privilege('alice@example.com', 'oxla', 'connect');
```

A regular user sees rows where it is the grantee; a superuser sees grants for every
non-superuser.

### CREATE, ALTER, DROP USER

```sql
CREATE { USER | ROLE } user_name [WITH] PASSWORD 'password' [SUPERUSER | NOSUPERUSER];
ALTER  { USER | ROLE } user_name [WITH] [PASSWORD 'password'] [SUPERUSER | NOSUPERUSER];
DROP   { USER | ROLE } [IF EXISTS] user_name;
```

- `ROLE` is a synonym for `USER`; errors call users "roles".
- `CREATE USER` needs a non-empty password and superuser rights. `ALTER USER`
  accepts `CURRENT_USER` / `CURRENT_ROLE`; a non-superuser may change their own
  password but not their superuser status. `DROP USER` fails while the user owns
  objects or holds grants; revoke and reassign first. A user cannot drop themselves,
  and the protected system superuser cannot be dropped or demoted.
- **On Redpanda Cloud, users come from Cloud IAM.** Assigning *SQL: Access* or
  *SQL: Manage* provisions the user. The operator revokes `CONNECT` for users not in
  IAM, reverts `SUPERUSER` changes that disagree with the role, and can re-provision
  a dropped user that still exists in IAM. Manage users and superuser status in
  Redpanda Cloud. `ALTER USER ... WITH PASSWORD` (for SCRAM clients) persists.

---

## Metadata views

### information_schema

| View | Contents |
|---|---|
| `information_schema.tables`, `information_schema.columns` | tables and columns visible to the current role. Views are **not** listed; use `pg_views` |
| `information_schema.role_table_grants` | grants on tables and table-like objects, including catalog-level external-source grants (`table_name` = the catalog name) |
| `information_schema.role_usage_grants` | `USAGE` grants |
| `information_schema.role_external_relation_grants` | per-pattern external-source grants (Redpanda SQL extension) |
| `information_schema.table_constraints`, `key_column_usage`, `referential_constraints` | constraints |
| `information_schema.character_sets` | character sets |

### System virtual tables

| Table | Same as | Visible to |
|---|---|---|
| `system.catalogs` | `SHOW CATALOGS` | rows filtered by the caller's grants |
| `system.kafka_connections` | `SHOW REDPANDA CATALOGS` | filtered by grants |
| `system.kafka_sources` | `SHOW REDPANDA TABLES` | filtered by grants |
| `system.iceberg_catalogs` | `SHOW ICEBERG CATALOGS` | filtered by grants |
| `system.iceberg_tables` | `SHOW ICEBERG TABLES` | filtered by grants |
| `system.nodes`, `system.queries`, `system.execs` | `SHOW NODES` / `QUERIES` / `EXECS` | superuser only |

```sql
SELECT name, topic_name, subject_name FROM system.kafka_sources
WHERE connection_name = 'default_redpanda_catalog';
```

Column meanings for the catalog tables are covered by
`/redpanda:sql-federated-queries`; the runtime tables by `/redpanda:sql-debugging`.

### pg_catalog

`pg_attrdef`, `pg_attribute`, `pg_authid`, `pg_class`, `pg_constraint`,
`pg_database`, `pg_depend`, `pg_description`, `pg_index`, `pg_language`,
`pg_namespace`, `pg_proc`, `pg_roles`, `pg_settings`, `pg_shadow` (superuser),
`pg_statio_user_tables`, `pg_type`, `pg_user`, `pg_views`. They exist so
PostgreSQL tools and drivers can introspect, and mostly hold placeholder data;
they are unrelated to Redpanda catalogs. Prefer `information_schema`, `DESCRIBE`,
`SHOW`, and `system.*` for real metadata.

`pg_views` is the exception that carries real data: one row per view you hold a
privilege on, in a schema you hold a privilege on, with the columns `schemaname`,
`viewname`, `viewowner` (always empty), and `definition` (the query text exactly
as written at `CREATE VIEW`, line breaks included). It is the documented way to
list views.

```sql
SELECT viewname, definition FROM pg_views WHERE schemaname = 'public';
```

In `pg_class`, a view has `relkind` `v`.
