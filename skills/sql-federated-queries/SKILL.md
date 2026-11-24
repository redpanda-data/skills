---
name: sql-federated-queries
description: >-
  Query Redpanda topics as SQL tables through Redpanda catalogs in Redpanda
  SQL on Redpanda Cloud BYOC, including the Iceberg history of Iceberg-enabled
  topics in the same query. Use when mapping a topic with CREATE TABLE
  default_redpanda_catalog=>name, choosing schema subject, error handling,
  struct mapping, or key and header decoding options, reading the redpanda
  metadata column, querying nested fields, querying live and Iceberg records
  together through a catalog linked with USING CATALOG, running REFRESH after a
  schema change, fixing Iceberg queries after a REST catalog secret rotates, or
  inspecting catalogs with SHOW, DESCRIBE, and the catalog-metadata system
  tables. For SQL syntax, functions, data types, and GRANT syntax, see
  `/redpanda:sql`. For enabling, scaling, users, roles, and the access model,
  see `/redpanda:sql-admin-api`. For failing or slow queries, see
  `/redpanda:sql-debugging`.
---

# Redpanda SQL: Query Topics Through Catalogs

Redpanda SQL reads Redpanda topics in place. Each topic is mapped to a table through a Redpanda
catalog, and on a BYOC cluster with an Iceberg REST catalog, the same table also returns the
topic's Iceberg history. Connection details come from the **SQL** tab of the cluster's
**How to connect** panel; see `/redpanda:sql`.

## How to work

This skill has no product-specific procedure of its own. Its evals showed that an agent with the
Redpanda docs maps topics, chooses decoding options, queries Iceberg history, and fixes a rotated
catalog secret correctly without extra guidance. Look everything up in the docs.

## Use the docs for everything else

Look up the managed catalogs that Redpanda Cloud creates, `CREATE TABLE` options and their
defaults, the `redpanda` and `redpanda_raw` columns, nested fields, `REFRESH`, Iceberg mode
matching and type limits, the catalog-metadata system tables, and the Iceberg Topics cluster and
topic properties in the Redpanda docs, following `/redpanda:redpanda-docs`. Pass
`platform: "cloud"` to `ask_redpanda_question`: Redpanda SQL runs in Redpanda Cloud. Start from:

- Redpanda catalogs: https://docs.redpanda.com/cloud-data-platform/sql/query-data/redpanda-catalogs/
- Query streaming topics:
  https://docs.redpanda.com/cloud-data-platform/sql/query-data/query-streaming-topics/
- Query Iceberg-enabled topics:
  https://docs.redpanda.com/cloud-data-platform/sql/query-data/query-iceberg-topics/
- Query nested fields: https://docs.redpanda.com/cloud-data-platform/sql/query-data/query-nested-fields/
- `CREATE TABLE`: https://docs.redpanda.com/cloud-data-platform/reference/sql/sql-statements/create-table/
- `REFRESH`: https://docs.redpanda.com/cloud-data-platform/reference/sql/sql-statements/refresh/
- System tables: https://docs.redpanda.com/cloud-data-platform/reference/sql/system-virtual-tables/
- Iceberg REST catalogs: https://docs.redpanda.com/cloud-data-platform/manage/iceberg/rest-catalog/

If the Docs MCP server refuses for quota and you can't fetch the page, tell the user to sign in
through `/mcp` rather than answering from memory.
