---
name: sql
description: >-
  Writes and runs read-only Redpanda SQL queries on Redpanda Cloud and manages
  which SQL users can read which topics. Use when a user wants to connect to
  Redpanda SQL with psql, a PostgreSQL driver, or SQL Studio, query
  topic-backed tables, export results with COPY TO, grant or revoke access to
  topics, fix a user who lost SQL access, or check how Redpanda SQL differs
  from PostgreSQL. For enabling SQL, the SQL Manage and SQL Access roles, and
  the access model, see `/redpanda:sql-admin-api`. For catalogs, mapping
  topics with CREATE TABLE, and Iceberg-enabled topics, see
  `/redpanda:sql-federated-queries`. For errors, slow queries, and degraded
  nodes, see `/redpanda:sql-debugging`.
---

# Redpanda SQL

Redpanda SQL is the analytical SQL engine on Redpanda Cloud. It speaks the PostgreSQL wire
protocol and is read-only: topics are mapped to tables through a catalog, and data arrives by
producing to topics, never by `INSERT` or `COPY FROM`. Host, port, and credentials come from the
**SQL** tab of the cluster's **How to connect** panel; never invent them.

## How to work

**Find the table in its catalog before writing a query.** A topic-backed table is referenced as
`catalog=>table`, almost always `default_redpanda_catalog=>orders`. A bare `orders` or
`catalog.orders` fails, and the unqualified `SHOW TABLES` is an error. Start with:

```sql
SHOW REDPANDA TABLES default_redpanda_catalog;
DESCRIBE TABLE default_redpanda_catalog=>orders;
```

If the topic is not listed, it is not mapped yet; a *SQL: Manage* user maps it
(`/redpanda:sql-federated-queries`). Do not try to create a table with columns or load rows.

**Fix login access in Redpanda Cloud IAM, not with SQL.** When a user cannot connect, check
`SELECT has_database_privilege('<email>', current_database(), 'CONNECT');`. If it is false,
the user has no role with *SQL: Access* or *SQL: Manage*: tell the user to assign one under
**Organization IAM > Roles**. Do not run `GRANT CONNECT`, `CREATE USER`, `DROP USER`, or
`ALTER USER ... SUPERUSER` for an email-named user. The Cloud user sync owns `CONNECT` and
superuser for those users and revokes a manual grant on its next pass.

**Read the stored grants before any REVOKE.** `REVOKE` must name a stored pattern exactly. A
pattern that matches no stored grant is an error, so a wildcard grant cannot be narrowed by
revoking one topic under it. Look first:

```sql
SELECT grantee, source_name, relation_pattern, privilege_type
FROM information_schema.role_external_relation_grants WHERE grantee = '<email>';
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants WHERE grantee = '<email>';
```

A catalog-wide grant (no pattern) shows up only in `role_table_grants`, with `table_name` set to
the catalog name. To remove one topic from a wildcard grant, revoke the wildcard as stored, list
the topics it covered with `SHOW REDPANDA TABLES`, and grant the ones that should stay. Before
you do, tell the user what changes and get their confirmation: per-topic grants cover only the
topics that exist now, so topics created later that match the wildcard are no longer readable,
and the user has no access to any covered topic between the `REVOKE` and the `GRANT`s. Run them
together. Revoking the catalog-wide grant also removes every per-topic grant on that catalog.

## Use the docs for everything else

Look up connection strings and authentication modes, driver settings, statement and function
syntax, data types, `COPY TO` options, and PostgreSQL differences in the Redpanda docs,
following `/redpanda:redpanda-docs`. Pass `platform: "cloud"` to `ask_redpanda_question`:
Redpanda SQL runs in Redpanda Cloud. Start from:

- SQL reference: https://docs.redpanda.com/cloud-data-platform/reference/sql/
- Manage access: https://docs.redpanda.com/cloud-data-platform/sql/manage/manage-access/
- Redpanda SQL vs PostgreSQL:
  https://docs.redpanda.com/cloud-data-platform/sql/get-started/redpanda-sql-vs-postgresql/

Only statements, functions, and types in the published reference are supported. If a
PostgreSQL feature is not listed there, say so rather than assume it works.
