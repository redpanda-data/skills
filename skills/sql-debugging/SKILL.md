---
name: sql-debugging
description: >-
  Diagnose Redpanda SQL problems on Redpanda Cloud from the SQL endpoint, using the
  superuser system virtual tables and SHOW statements for nodes, running queries, and
  execution tasks, plus the published recovery steps for degraded nodes, query
  out-of-memory errors, topic-mapping and deserialization failures, and stale or
  failing Iceberg-enabled topic queries. Use when a Redpanda SQL query is slow, stuck,
  or canceled for memory, when SHOW NODES reports a degradation error, when a mapped
  topic returns errors or missing rows, or when a query that spans live and Iceberg
  history fails to plan. For writing queries, see `/redpanda:sql`. For enabling,
  scaling, or disabling the SQL engine, see `/redpanda:sql-admin-api`. For catalogs,
  table mappings, and catalog metadata tables, see `/redpanda:sql-federated-queries`.
---

# Redpanda SQL: Debugging

Redpanda SQL is a managed analytical engine on Redpanda Cloud BYOC clusters that
speaks the PostgreSQL wire protocol. Everything a user can inspect is reachable
through SQL on the cluster's SQL endpoint (psql, a driver, or SQL Studio in the
Cloud Console) and through the Cloud Console. Node-level diagnostics (logs, engine
configuration, metrics, crash reports) are collected by Redpanda Support, not by
users.

## Who can see what

| Surface | Who |
|---|---|
| *Redpanda SQL* card on the cluster overview (status, active sessions, queries per minute, node count) | Anyone who can open the cluster in the Cloud Console |
| `system.nodes` / `SHOW NODES`, `system.queries` / `SHOW QUERIES`, `system.execs` / `SHOW EXECS` | Superuser only: a user whose role has the *SQL: Manage* permission |
| Catalog and table metadata (`system.catalogs`, `system.kafka_sources`, `SHOW REDPANDA TABLES`, ...) | Filtered by the caller's grants (`USAGE` on the schema, plus per-relation grants) |
| Grants (`information_schema.role_external_relation_grants`, `information_schema.role_table_grants`) | Filtered by the caller's grants |

A *SQL: Access* user who cannot see runtime tables is not hitting a bug. Ask a
*SQL: Manage* user to run the diagnostics.

## Quickstart

```bash
# Connection details are on the SQL tab of the cluster's "How to connect" panel.
rpk cloud login
PGPASSWORD=$(rpk cloud auth token) \
  psql "host=<sql-host> port=<sql-port> dbname=oxla user=ignored options='auth_method=bearer' sslmode=require"
```

```sql
-- Node health (SQL: Manage)
SHOW NODES;

-- Running queries, oldest first (SQL: Manage)
SELECT qid, state, created, accepted, scheduled, executed
FROM system.queries
WHERE finished IS NULL
ORDER BY created;

-- Memory per running query (SQL: Manage)
SELECT qid, SUM(memory) AS memory_bytes
FROM system.execs
GROUP BY qid
ORDER BY memory_bytes DESC;
```

## Triage

| Symptom | First move |
|---|---|
| Cannot connect with a bearer token | Include `options='auth_method=bearer'`. Without it, the token is treated as a SCRAM password and the connection fails. |
| Connection worked earlier, now fails | The OIDC token expired. Run `rpk cloud auth token` again and reconnect. Open sessions continue; only new connections need a fresh token. |
| Every query returns a degradation error | `SHOW NODES` and read `degradation_error`. See [Degraded nodes](#degraded-nodes). |
| `ERROR: Query Out of Memory!` | Retry, then reduce concurrency or simplify the query. See [Query out of memory](#query-out-of-memory). |
| `cancelled due to OOM prevention` | Contact Redpanda Support with the time of the error. |
| Query slow or appears stuck | `system.queries` (which phase it is in), then `system.execs` (memory per task), then `EXPLAIN TIMING <query>` to see where planning time goes. See [troubleshooting.md](references/troubleshooting.md) Playbook 2. |
| Mapped topic returns decode errors or missing rows | Check the table's `error_handling_policy`, schema subject, and Protobuf message name. See [troubleshooting.md](references/troubleshooting.md) Playbook 5. |
| Access error, or a catalog or table is invisible | Grants: `SELECT` on the external source plus `USAGE` on the schema. See [troubleshooting.md](references/troubleshooting.md) Playbook 6. |
| `Schema not found for Iceberg table '<table>'` | Run `REFRESH <catalog>=><table>`. |
| `Kafka schema must be a name-superset of Iceberg schema` | A column was removed from the topic's value subject; re-add it. See [redpanda-iceberg-source.md](references/redpanda-iceberg-source.md). |
| Iceberg history lags live data, or rows are missing from history | Topic `redpanda.iceberg.target.lag.ms`, the DLQ table, and `redpanda.iceberg.invalid.record.action`. See [redpanda-iceberg-source.md](references/redpanda-iceberg-source.md). |

## Runtime system tables

`system.nodes`, `system.queries`, and `system.execs` expose cluster runtime state
and are visible only to a superuser. Each has a `SHOW` equivalent; the table form
supports `WHERE`, `ORDER BY`, and `LIMIT`.

| Table | Statement | Columns |
|---|---|---|
| `system.nodes` | `SHOW NODES` | `name`, `election_state`, `followers_count`, `connected_nodes_count`, `degradation_error` |
| `system.queries` | `SHOW QUERIES` | `qid`, `requester`, `scheduler`, `workers`, `state`, `created`, `accepted`, `scheduled`, `executed`, `finished` |
| `system.execs` | `SHOW EXECS` | `node`, `qid`, `data_task_id`, `state`, `memory`, `privileged` |

Join `system.execs.qid` to `system.queries.qid` to attribute execution tasks to a
query. Rows are runtime state: read them live rather than assuming a fixed set of
`state` values. Full column descriptions and example queries are in
[system-tables.md](references/system-tables.md).

## Degraded nodes

A degraded node cannot run most queries and returns a degradation error instead.
If the leader is degraded, the whole cluster is degraded: connections fail with
the degradation error and most queries are not processed.

- Degradation is either *temporary* (for example, the node has not finished
  initializing; it is expected to recover) or *permanent* (an unrecoverable error;
  the node needs a restart, which users cannot perform).
- `SHOW NODES` needs a ready cluster and a non-degraded scheduling node. A healthy
  leader reports every connected node, including degraded ones.

What a user does: run `SHOW NODES`, wait a few minutes and re-check if the error
looks like initialization, check the *Redpanda SQL* card in the Cloud Console, and
contact Redpanda Support with the `degradation_error` text if it persists.

## Query out of memory

`ERROR: Query Out of Memory!` means the engine canceled one query to free memory.
It is a protection mechanism, not a cluster failure. The engine does not spill to
disk, so joins, `GROUP BY` hash tables, sorts, and distinct aggregations must fit in
the aggregate memory across SQL nodes, shared with every other running query.

1. Retry. Other queries may have finished.
2. Reduce concurrency: run fewer queries in parallel.
3. Simplify the query: tighter `WHERE` filters, fewer joins, smaller aggregations.
4. Scale the SQL engine for more aggregate memory: `/redpanda:sql-admin-api`.

`cancelled due to OOM prevention` is different: a node-level safeguard canceled
running queries. It is rare and usually indicates a memory-accounting problem.
Contact [Redpanda Support](https://support.redpanda.com/hc/en-us/requests/new)
with the time of the error and the affected query IDs.

## Ingestion from topics

Each Redpanda topic is mapped to a SQL table with `CREATE TABLE
<catalog>=><table> WITH (topic = '...', ...)` and reads fields from the topic's
Schema Registry subject. Most mapping problems are one of: the wrong subject, a
multi-message Protobuf schema without `output_schema_message_full_name`, a
wire-format mismatch (`confluent_wire_protocol`), or records that fail to
deserialize under the default `error_handling_policy = 'FAIL'`. Kafka ACLs do not
gate query access; `GRANT` and `REVOKE` in Redpanda SQL do. See
[troubleshooting.md](references/troubleshooting.md) Playbooks 5 and 6.

## Iceberg-enabled topics

When the cluster's Iceberg REST catalog is configured, `default_redpanda_catalog`
is linked to an Iceberg catalog, and one query returns both live topic records and
Iceberg-committed history. Stale history, missing rows, and planning errors usually
trace to the topic's `redpanda.iceberg.*` properties or to schema drift between
the topic subject and the Iceberg table. See
[redpanda-iceberg-source.md](references/redpanda-iceberg-source.md).

## Escalation

Redpanda Support collects node-level diagnostics with `rpk sql debug bundle`, which
they run from inside the SQL pods. The bundle holds each node's configuration, logs,
crash reports, resource usage, metrics samples, and the cluster topology, plus
active and recent queries with SQL text masked by default. Users do not run it.
When opening a case, provide the cluster ID, the time window, the exact error text,
any `qid` values, and the `SHOW NODES` output if you have *SQL: Manage*.

## Reference Directory

- [system-tables.md](references/system-tables.md): Columns and example queries for `system.nodes`, `system.queries`, and `system.execs` and their `SHOW` equivalents, with the superuser visibility rule.
- [troubleshooting.md](references/troubleshooting.md): Playbooks for connection and authentication failures, slow or stuck queries (including `EXPLAIN TIMING` for planning time), query out-of-memory errors, degraded nodes, topic mapping and deserialization errors, and access and grant problems.
- [redpanda-iceberg-source.md](references/redpanda-iceberg-source.md): Debugging queries over Iceberg-enabled topics on BYOC: the REST catalog requirement, `REFRESH`, schema-superset and key-mode errors, the Cloud-settable `iceberg_*` cluster and `redpanda.iceberg.*` topic properties, the DLQ table, and the Redpanda Iceberg metrics in the Cloud metrics export.
