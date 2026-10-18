Source: cloud-docs `modules/reference/pages/sql/system-virtual-tables.adoc`, `modules/reference/pages/sql/sql-statements/{show-nodes,show-queries,show-execs}.adoc`, `modules/sql/pages/manage/manage-access.adoc`, `modules/reference/pages/sql/sql-data-types/time-type/time-operators.adoc` (`TIMESTAMP - TIMESTAMP`) (verified 2026-10-18). File-by-file mapping in [SOURCES.md](SOURCES.md).

# Runtime System Tables

Redpanda SQL exposes cluster runtime state in three virtual tables in the `system`
schema. Each is the SQL-queryable form of a `SHOW` statement, so you can filter,
sort, and limit with `WHERE`, `ORDER BY`, and `LIMIT`.

**Visibility:** `system.nodes`, `system.queries`, and `system.execs` (and `SHOW
NODES`, `SHOW QUERIES`, `SHOW EXECS`) are visible only to a superuser, which in
Redpanda Cloud is a user whose role has the *SQL: Manage* permission. A *SQL:
Access* user cannot read them.

Catalog and connection metadata tables (`system.catalogs`,
`system.iceberg_catalogs`, `system.iceberg_tables`, `system.kafka_connections`,
`system.kafka_sources`) are filtered by the caller's grants and documented in
`/redpanda:sql-federated-queries`.

Reference: [System virtual tables](https://docs.redpanda.com/cloud-data-platform/reference/sql/system-virtual-tables/).

---

## system.nodes (SHOW NODES)

Current state of each SQL node in the cluster. `SHOW NODES` is equivalent to
`SELECT * FROM system.nodes`.

| Column | Description |
|---|---|
| `name` | Name of the node. |
| `election_state` | Current state of the node, for example `LEADER`. Other nodes report a follower state such as `LEADER_FOLLOWER`. |
| `followers_count` | Number of nodes following the leader. Meaningful only on the leader. |
| `connected_nodes_count` | Total number of connected nodes, including the node itself. |
| `degradation_error` | Error message if the node is not working correctly; otherwise `NULL`. |

`SHOW NODES` requires a ready cluster and a non-degraded scheduling node. A healthy
leader reports every connected node, including degraded ones.

```sql
SHOW NODES;

-- Degraded nodes only
SELECT name, election_state, degradation_error
FROM system.nodes
WHERE degradation_error IS NOT NULL;

-- Which node is the leader, and how many nodes does it see?
SELECT name, followers_count, connected_nodes_count
FROM system.nodes
WHERE election_state = 'LEADER';
```

What to look for: one leader; `connected_nodes_count` equal to the node count on
every row; `degradation_error` `NULL` everywhere. Compare the node count with the
*Nodes* indicator on the *Redpanda SQL* card in the Cloud Console.

---

## system.queries (SHOW QUERIES)

Queries currently running on the cluster. `SHOW QUERIES` is equivalent to
`SELECT * FROM system.queries`.

| Column | Type | Nullable | Description |
|---|---|---|---|
| `qid` | `text` | No | Query identifier. |
| `requester` | `text` | No | Node that received the query from the client. |
| `scheduler` | `text` | No | Node scheduling the query's execution tasks. |
| `workers` | `bigint` | No | Number of worker tasks assigned to the query. |
| `state` | `text` | No | Current state of the query. |
| `created` | `timestamp` | No | Time the query was received. |
| `accepted` | `timestamp` | Yes | Time the query was accepted for execution. `NULL` until accepted. |
| `scheduled` | `timestamp` | Yes | Time the query's execution tasks were scheduled. `NULL` until scheduled. |
| `executed` | `timestamp` | Yes | Time execution started. `NULL` until execution starts. |
| `finished` | `timestamp` | Yes | Time execution finished. `NULL` while the query is still running. |

`accepted` and `executed` are timestamp columns, not `state` values. Read `state`
values from live rows rather than assuming a fixed list.

```sql
SHOW QUERIES;

-- Running queries, oldest first
SELECT qid, requester, state, workers, created
FROM system.queries
WHERE finished IS NULL
ORDER BY created;

-- Which phase is a query waiting in?
--   accepted IS NULL  -> waiting to be accepted for execution
--   scheduled IS NULL -> accepted, tasks not yet scheduled
--   executed IS NULL  -> scheduled, execution not yet started
-- TIMESTAMP - TIMESTAMP returns an interval (NULL while a phase is pending).
SELECT qid, state, created,
       accepted  - created   AS accept_wait,
       scheduled - accepted  AS schedule_wait,
       executed  - scheduled AS start_wait
FROM system.queries
WHERE finished IS NULL
ORDER BY created;
```

---

## system.execs (SHOW EXECS)

Execution tasks currently running across the cluster. Each query in
`system.queries` typically corresponds to one or more rows here. `SHOW EXECS` is
equivalent to `SELECT * FROM system.execs`.

| Column | Type | Nullable | Description |
|---|---|---|---|
| `node` | `text` | No | Node executing the task. |
| `qid` | `text` | No | Identifier of the parent query. Join with `system.queries.qid`. |
| `data_task_id` | `bigint` | Yes | Identifier of the data task within the query. |
| `state` | `text` | No | Current state of the execution task. |
| `memory` | `bigint` | No | Memory consumed by the task, in bytes. |
| `privileged` | `boolean` | No | `TRUE` if the task runs with privileged access. |

```sql
SHOW EXECS;

-- Largest tasks by memory
SELECT node, qid, state, memory
FROM system.execs
ORDER BY memory DESC;

-- Memory per query, with its age
SELECT e.qid, SUM(e.memory) AS memory_bytes, COUNT(*) AS tasks,
       MIN(q.created) AS created
FROM system.execs e
JOIN system.queries q ON q.qid = e.qid
GROUP BY e.qid
ORDER BY memory_bytes DESC;

-- Memory per node (is one node carrying the load?)
SELECT node, SUM(memory) AS memory_bytes, COUNT(*) AS tasks
FROM system.execs
GROUP BY node
ORDER BY memory_bytes DESC;
```

---

## Other user-level inspection commands

These are not superuser-only; results are filtered by the caller's grants.

```sql
SHOW REDPANDA CATALOGS;   -- Redpanda catalogs
SHOW ICEBERG CATALOGS;    -- Iceberg catalogs
SHOW REDPANDA TABLES;     -- tables mapped to Redpanda topics
DESCRIBE TABLE default_redpanda_catalog=>orders;   -- columns of a mapped table
```

The unqualified `SHOW TABLES` form is not supported and returns an error; use a
typed variant or `SHOW TABLES FROM <catalog>`. Catalog metadata tables and their
columns: `/redpanda:sql-federated-queries`.
