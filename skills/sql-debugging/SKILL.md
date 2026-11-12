---
name: sql-debugging
description: >-
  Diagnoses Redpanda SQL problems on Redpanda Cloud from the SQL endpoint, and looks up the
  system tables, error causes, and recovery steps in the Redpanda docs. Use when a Redpanda
  SQL query is slow, stuck, or canceled for memory, when SHOW NODES reports a degradation
  error, when a topic-backed table returns decode errors or fewer rows than the topic holds,
  or when a query over an Iceberg-enabled topic returns stale history or fails to plan. For
  writing queries, see `/redpanda:sql`. For enabling, scaling, or disabling the SQL engine,
  see `/redpanda:sql-admin-api`. For catalogs and table mappings, see
  `/redpanda:sql-federated-queries`.
---

# Redpanda SQL: Debugging

Redpanda SQL is the analytical SQL engine on Redpanda Cloud. Users diagnose it through SQL on
the cluster's SQL endpoint and through the Cloud Console; node logs, engine configuration,
and engine metrics are collected by Redpanda Support. This skill keeps only the
product-specific procedure below. Look up everything else in the docs (last section).

## How to work

**When a topic-backed table returns fewer rows than the topic holds, or decode errors, read
the table's mapping before guessing.** Query `system.kafka_sources` for the table and check
its `error_handling_policy`, schema subject, and Protobuf message name. A table mapped with
`DROP_RECORD` skips every record that fails to decode, with no error. To see those records,
map the same topic again with `error_handling_policy = 'FILL_NULL'` and select the rows whose
`redpanda_raw` is not null; the `redpanda` column gives each one's partition and offset.

**Before deleting an Iceberg-enabled topic, keep its Iceberg table if anyone still needs the
history.** By default, deleting a topic also deletes its Iceberg table. If the user wants the
history kept, set `redpanda.iceberg.delete=false` on the topic first, then delete it. If you
can't tell whether the history is still needed, ask before deleting.

## Use the docs for everything else

Look up the runtime system tables (`system.nodes`, `system.queries`, `system.execs`), who can
read them, error messages and their recovery steps, `CREATE TABLE` mapping options, `EXPLAIN`,
and Iceberg topic properties in the Redpanda docs instead of from memory. Follow
`/redpanda:redpanda-docs`, and pass `platform: "cloud"` to `ask_redpanda_question`: Redpanda
SQL runs in Redpanda Cloud. Use `get_config_property` for one cluster or topic property.
Start from:

- Troubleshoot Redpanda SQL (degraded nodes, query out-of-memory errors):
  https://docs.redpanda.com/cloud-data-platform/sql/troubleshoot/
- System virtual tables:
  https://docs.redpanda.com/cloud-data-platform/reference/sql/system-virtual-tables/
- CREATE TABLE (topic mapping options):
  https://docs.redpanda.com/cloud-data-platform/reference/sql/sql-statements/create-table/
- Query Iceberg-enabled topics:
  https://docs.redpanda.com/cloud-data-platform/sql/query-data/query-iceberg-topics/

When a problem needs node-level diagnostics, the user opens a case with
[Redpanda Support](https://support.redpanda.com/hc/en-us/requests/new) and includes the
cluster ID, the time window, the exact error text, and any query IDs.

If the Docs MCP server refuses for quota and you can't fetch the page, tell the user to sign in
through `/mcp` rather than answering from memory.
