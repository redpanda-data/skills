# Oxla System Catalog Tables

Oxla exposes diagnostic state through virtual tables in the `system` schema (schema name `system`, registered via `src/metastore/metastore.cpp` `createSystemTables()`). These tables are **populated at query runtime** by distributed processors on each node — there is no materialized cache. Access follows Oxla's access-control model: superusers see everything; regular users see rows scoped to resources they have grants on.

Connect with any PostgreSQL client:

```bash
psql -h <host> -p 5432 -U oxla
```

---

## nodes

Shows the state of every cluster node as seen from the querying node. Data is generated at runtime via `NodeState` processors on each node.

**Table name:** `system.nodes`

Sources: `src/metastore/system_nodes.cpp` (registration), `src/processors/consts/show_shapes.cpp` → `nodeStateOutputSchema()` (column schema)

| Column | Type | Nullable | Description |
|---|---|---|---|
| `name` | TEXT | NO | Unique node name (matches `network.host_name` in config) |
| `election_state` | TEXT | NO | Raft election state (e.g. `Leader`, `Follower`, `Candidate`) |
| `followers_count` | INT | NO | Number of follower nodes known to this node |
| `connected_nodes_count` | INT | NO | Number of inter-node connections currently established |
| `degradation_error` | TEXT | YES | Non-NULL when the node is degraded; contains the error description |

### Example queries

```sql
-- Full cluster overview
SELECT name, election_state, followers_count, connected_nodes_count, degradation_error
FROM system.nodes;

-- Find the leader
SELECT name FROM system.nodes WHERE election_state = 'Leader';

-- Flag degraded nodes
SELECT name, degradation_error
FROM system.nodes
WHERE degradation_error IS NOT NULL;

-- Count connected nodes (useful for quorum checks)
SELECT connected_nodes_count FROM system.nodes LIMIT 1;
```

---

## queries

Shows active and recently completed queries across the cluster. Data is generated at runtime via `NodeQueries` processors on each node.

**Table name:** `system.queries`

Sources: `src/metastore/system_queries.cpp` (registration), `src/processors/consts/show_shapes.cpp` → `nodeQueriesOutputSchema()` (column schema)

| Column | Type | Nullable | Description |
|---|---|---|---|
| `qid` | TEXT | NO | Query ID (unique cluster-wide string) |
| `requester` | TEXT | NO | Node that submitted the query |
| `scheduler` | TEXT | NO | Node that accepted/scheduled the query |
| `workers` | BIGINT | NO | Number of worker threads allocated |
| `state` | TEXT | NO | Current query state: `created`, `scheduling`, `scheduled`, `executing`, `cancelling`, `cleanup`, `ready`, `finished` |
| `created` | TIMESTAMP | NO | Timestamp when query was received |
| `accepted` | TIMESTAMP | YES | Timestamp when query was admitted (column name; not a state value) |
| `scheduled` | TIMESTAMP | YES | Timestamp when query was scheduled |
| `executed` | TIMESTAMP | YES | Timestamp when execution started (column name; not a state value) |
| `finished` | TIMESTAMP | YES | Timestamp when query completed (NULL = still running) |

**`state` value domain** (from `src/scheduler/states/context.cpp` and `src/executor/executor.cpp`): `created`, `scheduling`, `scheduled`, `executing`, `cancelling`, `cleanup`, `ready`, `finished`. Note that `accepted` and `executed` are **timestamp column names**, not state values.

### Example queries

```sql
-- All active (not yet finished) queries, oldest first
SELECT qid, requester, state, created,
       EXTRACT(EPOCH FROM (NOW() - created)) AS age_seconds
FROM system.queries
WHERE finished IS NULL
ORDER BY created ASC;

-- Queries that took more than 10 seconds end-to-end
SELECT qid, requester,
       EXTRACT(EPOCH FROM (finished - created)) AS total_seconds
FROM system.queries
WHERE finished IS NOT NULL
  AND EXTRACT(EPOCH FROM (finished - created)) > 10
ORDER BY total_seconds DESC;

-- Queries stuck in scheduling state
SELECT qid, requester, state, created
FROM system.queries
WHERE finished IS NULL AND state = 'scheduling';

-- Time breakdown per query phase (latency profiling)
SELECT qid,
       EXTRACT(EPOCH FROM (accepted  - created))   AS admission_wait_s,
       EXTRACT(EPOCH FROM (scheduled - accepted))  AS schedule_wait_s,
       EXTRACT(EPOCH FROM (executed  - scheduled)) AS plan_wait_s,
       EXTRACT(EPOCH FROM (finished  - executed))  AS execute_s
FROM system.queries
WHERE finished IS NOT NULL
ORDER BY execute_s DESC NULLS LAST;
```

---

## transactions

Shows active catalog transactions. Requires the distributed catalog to be enabled (`distributed_catalog.*` in config). Data is read directly from the catalog head file via the filesystem layer.

**Table name:** `system.transactions`

Source: `src/metastore/system_transactions.cpp`

| Column | Type | Nullable | Description |
|---|---|---|---|
| `transaction_id` | BIGINT | NO | Unique transaction ID |
| `snapshot_id` | BIGINT | NO | Snapshot ID for this transaction |
| `owner node name` | TEXT | NO | Node that owns the transaction (note: column name has spaces) |
| `owner name` | TEXT | NO | Name of the owner (typically the query initiator) |

### Example queries

```sql
-- All active catalog transactions
SELECT * FROM system.transactions;

-- Count active transactions
SELECT COUNT(*) AS active_tx_count FROM system.transactions;
```

> If distributed catalog is not enabled, querying this table returns an error: `"Failed to find catalog metadata. Is distributed catalog enabled?"`

---

## storage_connections

Shows storage connections (external storage backends configured for the cluster). The virtual table is registered under the `system` schema as `storage_connections` (class `StorageConnections` in `src/metastore/system_storage.cpp`).

**Table name:** `system.storage_connections`

Source: `src/metastore/system_storage.cpp`

| Column | Type | Nullable | Description |
|---|---|---|---|
| `name` | TEXT | NO | Connection name |
| `type` | TEXT | NO | Storage type (e.g. `s3`, `gcs`, `azure`) |
| `schema_name` | TEXT | NO | Oxla schema (namespace) this connection belongs to |
| `database_name` | TEXT | NO | Oxla database this connection belongs to |
| `parameters` | JSON | NO | Provider-specific parameters (url, region, endpoint, account_name, path_style, etc.) |

The `parameters` column contains a JSON object whose keys depend on the storage provider. The `url` key is emitted first when a URL is configured and is present for all provider types:
- **All types**: `url` (when configured)
- **S3**: `region`, `endpoint`, `path_style`, `use_http`
- **GCS**: `endpoint`
- **Azure**: `account_name`, `tenant_id`, `client_id`, `endpoint`

### Example queries

```sql
-- List all storage connections
SELECT name, type, schema_name, database_name FROM system.storage_connections;

-- Inspect S3 connection parameters
SELECT name, parameters FROM system.storage_connections WHERE type = 's3';
```

---

## execs

Shows per-node execution fragments for queries. Data is generated at runtime via `NodeExecs` processors.

**Table name:** `system.execs`

Sources: `src/metastore/system_execs.cpp` (registration), `src/processors/consts/show_shapes.cpp` → `nodeExecsOutputSchema()` (column schema)

| Column | Type | Nullable | Description |
|---|---|---|---|
| `node` | TEXT | NO | Node running this fragment |
| `qid` | TEXT | NO | Query ID this fragment belongs to |
| `data_task_id` | BIGINT | YES | ID of the data task (NULL for in-memory fragments) |
| `state` | TEXT | NO | Execution fragment state |
| `memory` | BIGINT | NO | Memory currently used by this fragment in bytes |
| `privileged` | BOOLEAN | NO | Whether this fragment is running in privileged mode |

### Example queries

```sql
-- All running fragments with memory usage
SELECT node, qid, state, memory, privileged
FROM system.execs
ORDER BY memory DESC;

-- Fragments for a specific query
SELECT node, data_task_id, state, memory
FROM system.execs
WHERE qid = '<your-qid-here>';

-- Total memory used by all running fragments
SELECT SUM(memory) AS total_fragment_memory_bytes FROM system.execs;
```

---

## catalogs

Shows external catalogs registered in the cluster (Iceberg and Kafka/Redpanda connections).

**Table name:** `system.catalogs`

Source: `src/metastore/system_catalogs.cpp`

| Column | Type | Description |
|---|---|---|
| `name` | TEXT | Catalog name |
| `namespace_name` | TEXT | Schema (namespace) this catalog lives in |
| `type` | TEXT | `iceberg` or `redpanda` (Kafka connection) |

```sql
SELECT * FROM system.catalogs;
```

---

## databases, tables, columns

These tables enumerate the user-visible Oxla schema objects.

**databases** (`system.databases`): one column — `name TEXT`.

**tables** (`system.tables`): `database_name TEXT`, `namespace_name TEXT`, `name TEXT`.

**columns** (`system.columns`): `database_name TEXT`, `namespace_name TEXT`, `table_name TEXT`, `name TEXT`, `type TEXT`, `nullable BOOLEAN`.

> **Note:** Querying `system.tables` and `system.columns` may be disabled depending on the `allow_table_operations` feature flag. If disabled, you will see the error: `"Querying system.tables is disabled."` Check `default_config.yml` (under `config/Release/`) for the `allow_table_operations` setting.

```sql
-- All tables accessible to the current user
SELECT database_name, namespace_name, name
FROM system.tables
ORDER BY database_name, namespace_name, name;

-- Column schema for a specific table
SELECT name, type, nullable
FROM system.columns
WHERE database_name = 'default' AND table_name = 'my_table';
```

---

## information_schema views

Oxla implements several standard SQL `information_schema` views for compatibility with PostgreSQL tooling.

| View | Columns (subset) |
|---|---|
| `information_schema.tables` | `table_catalog`, `table_schema`, `table_name`, `table_type`, `is_insertable_into` |
| `information_schema.columns` | Standard column metadata |
| `information_schema.role_table_grants` | Grant information per table per role |
| `information_schema.role_usage_grants` | Grant information for usage |

```sql
-- List all user tables via information_schema (compatible with pg tooling)
SELECT table_schema, table_name, table_type
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY table_schema, table_name;
```

---

## pg_catalog compatibility tables

Oxla also implements several standard `pg_catalog` tables for driver compatibility (representative subset — more tables exist):

- `pg_catalog.pg_class` — relations
- `pg_catalog.pg_attribute` — columns
- `pg_catalog.pg_type` — type catalog
- `pg_catalog.pg_namespace` — schema namespaces
- `pg_catalog.pg_authid` / `pg_user` / `pg_roles` — role/user catalog
- `pg_catalog.pg_settings` — configuration settings
- `pg_catalog.pg_proc` — stored procedures/functions catalog
- `pg_catalog.pg_database` — databases
- `pg_catalog.pg_index`, `pg_constraint`, `pg_depend`, `pg_description`, `pg_am`, `pg_enum`, `pg_range`, `pg_policy`, `pg_tablespace`, `pg_statio_user_tables`, and others

These allow standard PostgreSQL introspection tools (e.g., `\d`, `\dt` in psql) and JDBC/ODBC drivers to work correctly with Oxla.

---

## Access control notes

- **Superusers** see all rows in all tables.
- **Regular users** see only rows for resources they have grants on: if the user has `USAGE` on a schema, all tables in that schema are visible; otherwise, only tables on which the user has an explicit grant appear.
- This applies to `system.tables`, `system.columns`, `system.storage_connections`, `system.catalogs`, and `information_schema` views.
- `system.nodes`, `system.queries`, and `system.execs` show cluster-wide data (no per-table scoping).
