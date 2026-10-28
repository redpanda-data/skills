Source: cloud-docs `modules/sql/pages/troubleshoot/{degraded-state-handling,query-out-of-memory}.adoc`, `modules/sql/pages/connect-to-sql/authenticate.adoc`, `modules/sql/pages/get-started/{sql-quickstart,deploy-sql-cluster}.adoc`, `modules/sql/pages/manage/manage-access.adoc`, `modules/sql/pages/query-data/query-streaming-topics.adoc`, `modules/reference/pages/sql/sql-statements/{create-table,set-show,show-tables,grant,revoke}.adoc`, `modules/reference/pages/sql/system-virtual-tables.adoc`, `modules/reference/pages/sql/sql-statements/explain.adoc`; docs `modules/reference/partials/rpk-sql/rpk-sql-debug-bundle.adoc` (verified 2026-10-27). File-by-file mapping in [SOURCES.md](SOURCES.md).

# Redpanda SQL Troubleshooting Playbooks

All steps run from a SQL client connected to the cluster's SQL endpoint, or from the
Cloud Console. Steps marked *(SQL: Manage)* read superuser-only system tables.

---

## Playbook 1: Cannot connect

1. **Use the connection string from the Cloud Console.** It is on the *SQL* tab of
   the cluster's *How to connect* panel. Use a recent `psql` and `rpk`; the
   [quickstart](https://docs.redpanda.com/cloud-data-platform/sql/get-started/sql-quickstart/)
   gives the minimum versions.

   ```bash
   rpk cloud login
   PGPASSWORD=$(rpk cloud auth token) \
     psql "host=<sql-host> port=<sql-port> dbname=oxla user=ignored options='auth_method=bearer' sslmode=require"
   ```

2. **Bearer token rejected.** A bearer token in the password field without
   `options='auth_method=bearer'` is treated as a SCRAM password and the connection
   fails. Add the option.
3. **Worked earlier, fails now.** OIDC bearer tokens are short-lived. The token is
   validated once at connection time; existing sessions continue after it expires,
   but new connections need a fresh token. Run `rpk cloud auth token` again.
4. **No SQL user.** Redpanda Cloud provisions the SQL user when the user's role has
   the *SQL: Access* or *SQL: Manage* data-plane permission (*Organization IAM >
   Roles*, *Data Plane* tab). No `CREATE USER` is needed for Cloud users.
5. **Engine not ready.** On the cluster overview, the *Redpanda SQL* card shows the
   engine status and a *Nodes* indicator. Until all nodes show as ready, the engine
   is still provisioning.
6. **Every connection returns a degradation error.** The leader node is degraded;
   go to Playbook 4.

Reference: [Authenticate to Redpanda SQL](https://docs.redpanda.com/cloud-data-platform/sql/connect-to-sql/authenticate/).

---

## Playbook 2: A query is slow or appears stuck

### Step 1: Find the query and its phase *(SQL: Manage)*

```sql
SELECT qid, requester, scheduler, state, workers,
       created, accepted, scheduled, executed
FROM system.queries
WHERE finished IS NULL
ORDER BY created;
```

- `accepted` still `NULL` long after `created`: the query has not yet been accepted
  for execution. Look at what else is running (Step 2), and reduce concurrency.
- `executed` set and `finished` still `NULL`: the query is executing. Check its memory and
  task spread (Step 2), then its shape (Step 3).

### Step 2: Look at execution tasks *(SQL: Manage)*

```sql
-- Tasks for one query
SELECT node, data_task_id, state, memory
FROM system.execs
WHERE qid = '<qid>'
ORDER BY memory DESC;

-- Everything running, largest memory first
SELECT qid, SUM(memory) AS memory_bytes, COUNT(*) AS tasks
FROM system.execs
GROUP BY qid
ORDER BY memory_bytes DESC;
```

A query with memory climbing toward the node's capacity is a candidate for an
out-of-memory cancellation (Playbook 3). Many concurrent queries each holding
memory slow everyone down.

### Step 3: Separate planning time from execution time

If `accepted` is set but `executed` stays `NULL`, or a query is slow before any
rows come back, time the planner:

```sql
EXPLAIN TIMING SELECT ...;   -- plans the query without running it

-- or, to rank the stages
SELECT measurement, elapsed
FROM explain('SELECT ...', 'timing')
ORDER BY elapsed DESC
LIMIT 5;
```

`measurement` is the planning stage and `attribution` says whether the time went
into planner work, a call to an external service (Schema Registry or the Iceberg
REST catalog), or waiting. A stage that waits on an external service points at
that service, not the query. `EXPLAIN CONFIG` lists the planner options in effect
for the session. Both forms are diagnostics, not a PostgreSQL query plan, and
their output can change between releases. Syntax: `/redpanda:sql`.

### Step 4: Reduce the work the query does

- Narrow the scan with tighter `WHERE` filters.
- Reduce the number of joins, or pre-filter each side before joining.
- Break a large aggregation into smaller ones.

### Step 5: Session settings

Only the options on the published
[SET and SHOW](https://docs.redpanda.com/cloud-data-platform/reference/sql/sql-statements/set-show/)
page are supported. Two are relevant to debugging:

```sql
-- Trade floating-point precision for speed in math functions (session only)
SET oxla.enable_fast_math = ON;
SHOW oxla.enable_fast_math;

-- Which message levels the server sends to this client
SET client_min_messages TO 'NOTICE';
SHOW client_min_messages;
```

`client_min_messages` accepts `DEBUG5`, `DEBUG4`, `DEBUG3`, `DEBUG2`, `DEBUG1`,
`LOG`, `NOTICE`, `WARNING`, and `ERROR`.

### Step 6: Scale or escalate

If the workload legitimately needs more capacity, scale the SQL engine
(`/redpanda:sql-admin-api`). If a single query stays stuck with no progress, note its
`qid` and contact Redpanda Support (Playbook 7).

---

## Playbook 3: Query out of memory

### `ERROR: Query Out of Memory!`

The engine canceled the query to free its memory so other queries can continue. This
is expected protection, not a cluster failure.

Why it happens: filters and projections stream with roughly constant memory, but
hash tables for `JOIN` and `GROUP BY`, heaps for `ORDER BY` and top-K, and network
buffers between nodes are held in memory. All of it, plus the final result set, must
fit in the aggregate memory across SQL nodes. The engine does not spill to disk. All
concurrently running queries share that memory, so a query can fail because of
other load.

Recovery, in order:

1. **Retry.** The cancellation freed the memory, and other queries may have
   finished.
2. **Reduce concurrency.** Run fewer queries in parallel.
3. **Simplify the query.** Tighter `WHERE` filters, fewer joins, smaller
   aggregations. Joins, sorts, and distinct aggregations drive memory the most.
4. **Scale the SQL engine** for more aggregate memory: `/redpanda:sql-admin-api`.

To see which queries hold memory right now *(SQL: Manage)*:

```sql
SELECT e.qid, SUM(e.memory) AS memory_bytes, MIN(q.created) AS created
FROM system.execs e
JOIN system.queries q ON q.qid = e.qid
GROUP BY e.qid
ORDER BY memory_bytes DESC;
```

### `cancelled due to OOM prevention`

A separate node-level safeguard canceled running queries on a node to keep the
engine operational. It is rare and almost always indicates a memory-accounting
problem or an unexpected workload pattern. Contact
[Redpanda Support](https://support.redpanda.com/hc/en-us/requests/new) with the time
of the error, the affected `qid` values, and the query text (Playbook 7).

Reference: [Troubleshoot query out-of-memory errors](https://docs.redpanda.com/cloud-data-platform/sql/troubleshoot/query-out-of-memory/).

---

## Playbook 4: Degraded node or cluster

A degraded node cannot run most queries and returns a degradation error. Terms:

- **Liveness:** the node accepts client connections (returning an error still
  counts).
- **Readiness:** the cluster can run queries. This requires a non-degraded leader.

| Effect | Details |
|---|---|
| Connections | If the leader is degraded, all connection attempts return the degradation error. |
| Queries | A degraded node answers with the degradation error. If the leader is degraded, most queries are not processed. |
| Planning | Permanently degraded nodes are excluded from query planning; temporarily degraded nodes are expected to recover. |

### Steps

1. If you can connect, run `SHOW NODES` *(SQL: Manage)* and read
   `degradation_error` per node. `SHOW NODES` needs a ready cluster and a
   non-degraded scheduling node.
2. Check the *Redpanda SQL* card on the cluster overview in the Cloud Console for
   engine status and node readiness.
3. **Temporary degradation** (for example, a node that has not finished
   initializing) clears on its own. Re-check after a few minutes.
4. **Permanent degradation** is an unrecoverable node error that requires a node
   restart. Users cannot restart SQL nodes. Contact Redpanda Support with the
   `degradation_error` text and the time it started.

Reference: [Degraded state handling](https://docs.redpanda.com/cloud-data-platform/sql/troubleshoot/degraded-state-handling/).

---

## Playbook 5: Topic mapping and deserialization errors

A topic is queryable after it is mapped with `CREATE TABLE <catalog>=><table> WITH
(...)`. Redpanda SQL reads the column definitions from the topic's Schema Registry
subject (Protobuf, JSON, or Avro). Full options: `/redpanda:sql-federated-queries`
and [CREATE TABLE](https://docs.redpanda.com/cloud-data-platform/reference/sql/sql-statements/create-table/).

### Step 1: Check what the table is mapped to

```sql
SHOW REDPANDA TABLES;
DESCRIBE TABLE default_redpanda_catalog=><table>;

-- Topic, subject, and policies for each mapping (filtered by your grants)
SELECT name, topic_name, subject_name, lookup_policy,
       error_handling_policy, struct_mapping_policy,
       output_schema_full_message_name
FROM system.kafka_sources
WHERE connection_name = 'default_redpanda_catalog';
```

### Step 2: Match the symptom

| Symptom | Cause and fix |
|---|---|
| Topic has no schema, or columns are wrong | The topic needs a schema registered in Schema Registry. `schema_subject` defaults to `<topic>-value`; set it if the producer uses a different subject. |
| Message-type mismatch error on a Protobuf topic | The schema defines more than one message and the first one is not the record type. Set `output_schema_message_full_name` (and `key_schema_message_full_name` for keys). |
| Records fail to decode although the schema is right | Possible wire-format mismatch. `confluent_wire_protocol` defaults to `'true'` (magic byte plus schema ID before the payload). For raw Protobuf or Avro values, map with `confluent_wire_protocol = 'false'`. |
| Query errors on a bad record | `error_handling_policy` defaults to `FAIL`. Use `FILL_NULL` to keep the row (raw bytes land in `redpanda_raw`) or `DROP_RECORD` to skip it. |
| Rows missing compared with the topic | The table uses `DROP_RECORD`, so undecodable records are skipped. Remap with `FILL_NULL` to see them. |
| `CREATE TABLE` fails on a recursive schema | `COMPOUND` struct mapping (default) does not support cyclic types. Use `struct_mapping_policy = 'JSON'`. |
| Schema rejected | `redpanda` and `redpanda_raw` are reserved column names; type names starting with `__redpanda_` and a top-level JSON property `__json_root` are rejected. |
| Need to change key or header decoding | `key_decode_mode` and `header_value_type` are fixed for the table's lifetime. Drop and recreate the table. |

### Step 3: Inspect failed records with `FILL_NULL`

```sql
CREATE TABLE IF NOT EXISTS default_redpanda_catalog=>orders_debug WITH (
  topic = 'orders',
  schema_subject = 'orders-value',
  error_handling_policy = 'FILL_NULL'
);

-- Rows that failed to decode keep their raw payload
SELECT redpanda, redpanda_raw
FROM default_redpanda_catalog=>orders_debug
WHERE redpanda_raw IS NOT NULL
LIMIT 20;
```

The `redpanda` column carries `partition`, `offset`, `timestamp`, `headers`, `key`,
and `timestamp_type` for every row, which locates the bad record in the topic.

---

## Playbook 6: Access and grant problems

Kafka ACLs do not gate query-time access: every query reaches topics under one
internal credential. Access is enforced inside Redpanda SQL by `GRANT` and `REVOKE`.

| Symptom | Fix (run as *SQL: Manage*) |
|---|---|
| A *SQL: Access* user cannot read any topic | By default they own nothing. `GRANT SELECT ON EXTERNAL SOURCE default_redpanda_catalog => '<topic>' TO "<email>";` |
| Catalog not visible in `SHOW CATALOGS` or `system.catalogs` | The user needs `USAGE` on the schema: `GRANT USAGE ON SCHEMA public TO "<email>";` |
| A non-superuser cannot create a Redpanda catalog or storage | `GRANT CREATE ON SCHEMA public TO "<email>";` |
| `GRANT ALL PRIVILEGES` on a catalog did not give more access | Only `SELECT` has effect on a Redpanda catalog. |
| `REVOKE ... => 'pattern'` errors | The pattern matches no existing grant. The catalog-level form without a pattern is idempotent. |
| Runtime tables (`system.nodes`, ...) are not visible | They are superuser-only. Use a *SQL: Manage* user. |

The user identifier is the email on the user's Redpanda Cloud account. Wildcards are
allowed only at the end of a pattern (`'orders_*'`). To see current grants:

```sql
SELECT * FROM information_schema.role_external_relation_grants;
SELECT * FROM information_schema.role_table_grants;   -- catalog-level grants appear with table_name = catalog name
```

Reference: [Manage access to Redpanda SQL](https://docs.redpanda.com/cloud-data-platform/sql/manage/manage-access/).

---

## Playbook 7: Escalate to Redpanda Support

Users cannot reach SQL node logs, engine configuration, or engine metrics. Redpanda
Support collects them with `rpk sql debug bundle`, run from inside the SQL pods. The
bundle contains each node's configuration, logs, crash reports, resource usage,
metrics samples, and the cluster topology, plus active and recent queries (SQL text
masked by default). Collecting it does not change the cluster. Users do not run it.

Include in the case:

- Cluster ID and the time window (with time zone) of the problem.
- The exact error text returned to the client.
- `qid` values from `system.queries`, and the query text if you can share it.
- `SHOW NODES` output, if you have *SQL: Manage*.
- What you already tried (retry, reduced concurrency, scaling).

Open a case at [Redpanda Support](https://support.redpanda.com/hc/en-us/requests/new).

---

## Quick checklist

```sql
-- 1. Node health (SQL: Manage)
SHOW NODES;

-- 2. Oldest running queries (SQL: Manage)
SELECT qid, state, created
FROM system.queries
WHERE finished IS NULL
ORDER BY created
LIMIT 10;

-- 3. Memory by query (SQL: Manage)
SELECT qid, SUM(memory) AS memory_bytes
FROM system.execs
GROUP BY qid
ORDER BY memory_bytes DESC;

-- 4. Mappings and their error handling (any user, filtered by grants)
SELECT name, topic_name, error_handling_policy FROM system.kafka_sources;
```

For writing queries see `/redpanda:sql`; for enabling and scaling the engine see
`/redpanda:sql-admin-api`.
