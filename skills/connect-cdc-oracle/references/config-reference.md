# oracledb_cdc Config Reference

Every field in the `oracledb_cdc` input, grounded in `input_oracledb_cdc.go` and `logminer/config.go`. Available since Connect version **4.83.0**.

## Top-level Fields

### `connection_string`

**Type:** `string` | **Required:** yes

The Oracle JDBC-style URL used by the `go-ora` driver. Additional connection options can be passed as URL query parameters.

```yaml
# Standard service connection
connection_string: oracle://username:password@host:1521/service_name

# With Oracle Wallet path and SSL via query params
connection_string: oracle://user:password@host:1522/service?WALLET=/opt/oracle/wallet&SSL=true
```

The connector uses the `go-ora/v2` driver. The URL scheme must be `oracle://`.

---

### `wallet_path`

**Type:** `string` | **Required:** no | **Default:** none

Path to the Oracle Wallet directory. When set, SSL is enabled automatically. The directory must contain either:

- `cwallet.sso` — auto-login wallet, no password required
- `ewallet.p12` — PKCS#12 wallet, requires `wallet_password`

```yaml
wallet_path: /opt/oracle/wallet
```

---

### `wallet_password`

**Type:** `string` (secret) | **Required:** no | **Default:** none

Password for `ewallet.p12`. Only required when the wallet directory contains `ewallet.p12` rather than `cwallet.sso`. Mark this field as a secret in your config management system.

```yaml
wallet_password: "${ORACLE_WALLET_PASSWORD}"
```

---

### `prefetch_rows`

**Type:** `int` | **Required:** no | **Default:** `500`

The number of rows the Oracle driver fetches per network round trip, applied to
**both** snapshot and streaming reads. Higher values mean fewer round trips but
more memory per fetch — and that cost is paid once per table snapshotted in
parallel, so weigh it against `max_parallel_snapshot_tables`.

Raise it when large committed transactions arrive late while the database,
network, and connector all look idle: without this field the driver sizes each
fetch to roughly 128 KiB from the declared maximum width of the selected
columns, and LogMiner's wide redo-SQL columns reduce that to a handful of rows
per round trip.

```yaml
prefetch_rows: 5000
```

A `PREFETCH_ROWS` query parameter on `connection_string` **takes precedence**
over this field and is matched case-insensitively (`PREFETCH_ROWS`,
`prefetch_rows`, and `Prefetch_Rows` all win), in which case this field is
ignored and the connector logs that it is using the connection-string value.
Values of `0` or below are rejected by both the lint rule
(`prefetch_rows must be greater than 0`) and startup validation.

---

### `snapshot_mode`

**Type:** `string` (enum) | **Required:** no | **Default:** `none` | **Since:** 4.99.0

Controls whether and how an initial snapshot of existing rows is taken before streaming begins. This enum field replaces the deprecated boolean `stream_snapshot`. One of:

- `none` (default) — skip snapshotting; start streaming from the current SCN. Equivalent to the legacy `stream_snapshot: false`.
- `snapshot_only` — perform a full snapshot, persist the SCN checkpoint, then **stop without streaming**. Use for a one-time backfill of existing rows. When the snapshot completes the input signals end-of-input and the pipeline shuts down.
- `snapshot_and_stream` — perform a full snapshot, then transition to LogMiner streaming. Equivalent to the legacy `stream_snapshot: true`.

Snapshot rows are emitted with `operation = read`. The SCN captured at the start of the snapshot is stored in the checkpoint; LogMiner streaming (in `snapshot_and_stream`) resumes from that SCN when the snapshot is complete.

> **Prerequisite:** Only tables that have a `snapshot_filters` entry need a **primary key** — those are paged with a primary-key cursor, and one without a key fails when its own snapshot starts with `"can't find a primary key for table '%s', does it exist and have one set?"`. Tables with no filter are read through a single unordered full-table cursor and need no primary key. `snapshot_mode: none` snapshots nothing, so neither case applies.
>
> Changed in 4.107.0 — before that release *every* snapshotted table was paged by primary key, so all of them required one.

On restart with a stored checkpoint SCN, snapshotting is **not** re-run regardless of `snapshot_mode`. The connector always resumes from the cached SCN.

```yaml
snapshot_mode: snapshot_and_stream
```

---

### `stream_snapshot` (deprecated)

**Type:** `bool` | **Required:** no | **Default:** `false` | **Deprecated:** since 4.99.0 — use `snapshot_mode`

Deprecated in 4.99.0 in favour of `snapshot_mode`. Retained as a backward-compatible alias: when `snapshot_mode` is **not** set, `stream_snapshot: true` maps to `snapshot_mode: snapshot_and_stream` and `stream_snapshot: false` maps to `snapshot_mode: none`. If `snapshot_mode` is set, it takes precedence and `stream_snapshot` is ignored.

```yaml
stream_snapshot: true    # equivalent to snapshot_mode: snapshot_and_stream
```

---

### `max_parallel_snapshot_tables`

**Type:** `int` | **Required:** no | **Default:** `1`

Number of tables to snapshot in parallel. Increase to speed up the snapshot phase when many tables are included, at the cost of additional Oracle connections.

```yaml
max_parallel_snapshot_tables: 4
```

---

### `snapshot_max_batch_size`

**Type:** `int` | **Required:** no | **Default:** `1000`

What this bounds depends on whether the table has a `snapshot_filters` entry:

- **With a filter** — rows fetched per query. The table is paged with a primary-key cursor (`ORDER BY` the full key, `FETCH FIRST n ROWS ONLY`), and the cursor state is held in memory during the snapshot. Raising it means fewer, larger round trips.
- **Without a filter** (the default for every table) — the table is read through a single unordered cursor, so this value only paces how often the snapshot checks whether it has been cancelled. It bounds no fetch and does not change snapshot throughput.

```yaml
snapshot_max_batch_size: 5000
```

---

### `snapshot_filters`

**Type:** `object` (map of `SCHEMA.TABLE` → SQL `SELECT`) | **Required:** no | **Default:** none

Overrides the default snapshot query on a per-table basis — use it to snapshot a subset of rows or columns rather than the whole table.

**Hard requirement:** each query must project **every** column of the table's primary key — all of them for a composite key — even if it otherwise selects a subset of columns. Snapshotting pages through rows by filtering and sorting on the full primary key against the query's own result set, so a missing key column fails the snapshot part-way through, *after* the first batch has already been read.

```yaml
snapshot_filters:
  TESTDB.PRODUCTS: SELECT * FROM TESTDB.PRODUCTS WHERE ID > 1000
  TESTDB.USERS: SELECT * FROM TESTDB.USERS
```

---

### `include`

**Type:** `array[string]` | **Required:** yes

Regular expression patterns for tables to include, in `SCHEMA.TABLE` format. Case-sensitive (Oracle stores identifiers in uppercase by default).

```yaml
include:
  - ^MYSCHEMA\.ORDERS$
  - ^MYSCHEMA\.PRODUCTS$
  - ^ANALYTICS\..*     # all tables in ANALYTICS schema
```

The connector matches the concatenated `OWNER.TABLE_NAME` string (e.g. `MYSCHEMA.ORDERS`) using Go's `regexp.MatchString`, which is an **unanchored substring match**. A pattern like `MYSCHEMA\.ORDERS` also matches `MYSCHEMA.ORDERS_2024`, `XMYSCHEMA.ORDERSY`, etc.

> **Warning:** Always anchor patterns with `^` and `$` to match a specific table exactly, e.g. `^MYSCHEMA\.ORDERS$`. Unanchored patterns over-match and will capture unintended tables.

---

### `exclude`

**Type:** `array[string]` | **Required:** no | **Default:** none

Regular expression patterns for tables to exclude. Applied after `include`. Uses the same unanchored `regexp.MatchString` as `include` — anchor patterns to avoid over-matching.

```yaml
exclude:
  - ^MYSCHEMA\.INTERNAL_.*
  - ^MYSCHEMA\.TMP_.*
```

---

### `checkpoint_cache`

**Type:** `string` | **Required:** no | **Default:** none (uses built-in Oracle table)

Name of a [cache resource](https://www.docs.redpanda.com/redpanda-connect/components/caches/about) for storing the SCN checkpoint. When not set, the connector automatically creates an Oracle table and stored procedure under the `RPCN` schema to store the checkpoint (see `checkpoint_cache_table_name`).

Recommended external cache backends: **Redis** or **Memcached** (low-latency, cheap per-operation). The built-in `memory:{}` cache works but provides no durability across process restarts.

```yaml
cache_resources:
  - label: my_redis
    redis:
      url: redis://redis-host:6379

input:
  oracledb_cdc:
    checkpoint_cache: my_redis
    checkpoint_cache_key: oracle-prod-scn
    # ... other fields
```

---

### `checkpoint_cache_table_name`

**Type:** `string` | **Required:** no | **Default:** `RPCN.CDC_CHECKPOINT_CACHE`

The Oracle table name used when `checkpoint_cache` is not set. The connector creates this table and a stored procedure under the `RPCN` schema automatically on first connect. The Connect user requires `CREATE TABLE` and `CREATE PROCEDURE` privileges, and the `RPCN` schema must exist.

When `pdb_name` is set and this field is at its default value, the table name is auto-derived per PDB to avoid SCN collisions (e.g., `RPCN.CDC_CHECKPOINT_MYPDB`). Set this field explicitly to opt out of auto-derivation.

In CDB mode the table is created under `C##RPCN` (the common-user prefix is added automatically).

```yaml
checkpoint_cache_table_name: RPCN.CHECKPOINT_CACHE
```

---

### `checkpoint_cache_key`

**Type:** `string` | **Required:** no | **Default:** `oracledb_cdc`

Key under which the SCN is stored in `checkpoint_cache`. Must be between 1 and 128 characters. Set an alternative key when multiple `oracledb_cdc` inputs share the same cache resource.

```yaml
checkpoint_cache_key: oracle-prod-orders-scn
```

---

### `checkpoint_limit`

**Type:** `int` | **Required:** no | **Default:** `1024`

Maximum number of messages that can be in-flight (processed but not yet acknowledged) at any time. Increasing this value improves throughput by allowing the output to work on a larger batch, but increases memory usage. A given SCN is not advanced in the checkpoint until all messages at or below that SCN have been acknowledged — this preserves at-least-once delivery.

```yaml
checkpoint_limit: 2048
```

---

### `pdb_name`

**Type:** `string` | **Required:** no | **Default:** none

Name of the pluggable database (PDB) to monitor when connecting to a CDB (Container Database) root. When set:

- LogMiner output is filtered to the named PDB via `SRC_CON_NAME = '<pdb_name>'`
- Catalog queries use `ALTER SESSION SET CONTAINER = <pdb_name>` to switch context
- The Connect user must have `GRANT SET CONTAINER TO <user> CONTAINER=ALL`
- Connect via the **CDB root service**, not a PDB-local service

The connector detects whether it is connected to `CDB$ROOT` at startup and returns an error if `pdb_name` is set but the connection is not at the root.

> **CDB limitation:** The connector's table discovery excludes any owner whose name matches `C##%`. Tables owned by common users (prefixed `C##`) are silently filtered out and cannot be captured. Monitored tables must reside in a local PDB schema (non-`C##` owner inside the target PDB).

```yaml
pdb_name: MYPDB
```

---

### `auto_replay_nacks`

**Type:** `bool` | **Required:** no | **Default:** `true`

When `true`, messages rejected (nacked) by the output are automatically retried indefinitely, creating backpressure if the rejection cause is persistent. When `false`, rejected messages are dropped. Setting to `false` improves memory efficiency for high-throughput streams.

---

### `batching`

**Type:** `object` | **Required:** no

Standard Connect batching policy controlling how messages are grouped before being sent to the output. Fields: `count` (int), `byte_size` (int), `period` (duration string), `check` (Bloblang), `processors` (array).

```yaml
batching:
  count: 100
  period: 1s
```

By default (all fields at zero/empty), messages are passed one-at-a-time (`count` defaults to `1` internally when no batch policy is configured).

---

## `logminer` Sub-block

All fields nested under `logminer:`.

### `logminer.scn_window_size`

**Type:** `int` | **Required:** no | **Default:** `20000`

The **starting** SCN range per mining cycle. Each cycle queries `V$LOGMNR_CONTENTS` for changes between `current_scn` and `current_scn + <window>`. Must be greater than 0.

- **Smaller values** (e.g., 1000–5000): lower memory per cycle, higher query frequency, better for low-throughput tables.
- **Larger values** (e.g., 50000–100000): fewer queries, higher throughput, higher memory per cycle.

The window is **adaptive**, not fixed: it grows by `scn_window_size` on each cycle that ends at the cap with a backlog still present, up to `max_scn_window_size`, and shrinks by the same step on each cycle that catches up to the database. So this field sets the steady-state window and the growth step, while `max_scn_window_size` bounds how large a backlog burst may go.

This field belongs to the default `scn_window` strategy. It has no effect — and is rejected at startup if set to anything other than its default — when `window_strategy` is `redo_volume`.

```yaml
logminer:
  scn_window_size: 50000
```

---

### `logminer.min_scn_window_size`

**Type:** `int` | **Required:** no | **Default:** `1000`

The minimum SCN gap required before a new LogMiner session is started. When the gap between the connector's position and the database's current SCN is smaller than this, the mining cycle is **skipped** and the connector backs off instead.

This exists because Oracle background activity advances the SCN without producing any relevant events; without a floor, a low-traffic database would drive constant LogMiner start/stop churn. Set to `0` to disable the floor.

```yaml
logminer:
  min_scn_window_size: 1000
```

---

### `logminer.max_scn_window_size`

**Type:** `int` | **Required:** no | **Default:** `100000`

Upper bound on the adaptive mining window described under `scn_window_size`. Raising it lets the connector burn through a large backlog in fewer, bigger cycles at the cost of memory per cycle; lowering it caps per-cycle memory.

```yaml
logminer:
  max_scn_window_size: 100000
```

Has no effect — and is rejected at startup if set to anything other than its default — when `window_strategy` is `redo_volume`.

---

### `logminer.window_strategy`

**Type:** `string` (enum) | **Required:** no | **Default:** `scn_window` | **Advanced**

Chooses how the range mined per cycle is sized. Added in 4.112.0.

| Value | How the cycle is sized | Tuned by |
|---|---|---|
| `scn_window` (default) | Grows and shrinks a fixed SCN increment based on backlog | `scn_window_size`, `min_scn_window_size`, `max_scn_window_size` |
| `redo_volume` | A bounded redo-volume budget per cycle, per redo thread, independent of raw SCN movement | `redo_volume_min`, `redo_volume_growth_max` |

Reach for `redo_volume` when the database's SCN can advance without matching real transaction volume — the classic case is a Multitenant Container Database (CDB) whose shared SCN is bumped by another Pluggable Database (PDB). Under `scn_window` the connector then burns cycles growing its window over mostly-empty ranges; `redo_volume` instead sizes each cycle by the redo it actually reads. On Real Application Clusters (RAC), the budget applies **per open redo thread**, so the volume mined per cycle scales with the number of open threads.

The two sets of tuning fields are mutually exclusive and validated at startup: setting `scn_window_size` or `max_scn_window_size` away from its default under `redo_volume`, or `redo_volume_min` / `redo_volume_growth_max` away from its default under `scn_window`, is rejected with a "has no effect" error. `min_scn_window_size` is the exception — that floor applies under both strategies.

```yaml
logminer:
  window_strategy: redo_volume
```

---

### `logminer.redo_volume_min`

**Type:** `int` | **Required:** no | **Default:** `2` | **Advanced**

The minimum redo volume mined per cycle per redo thread, in multiples of the online redo log size (read once at startup as `MAX(BYTES)` over `V$LOG`). Only applies when `window_strategy` is `redo_volume`; must be greater than 0.

Log files are added in sequence order until their total size reaches the budget, and the file that crosses the limit is kept — so one very large file is still selected. Increase it when redo logs are small and rotate frequently; decrease it when they are very large.

```yaml
logminer:
  window_strategy: redo_volume
  redo_volume_min: 4
```

---

### `logminer.redo_volume_growth_max`

**Type:** `int` | **Required:** no | **Default:** `4` | **Advanced**

The ceiling the per-thread redo-volume budget may grow to. The budget starts at `redo_volume_min` and grows automatically whenever something stops the mining window advancing — a long-running transaction holding it in place, or a redo log recycled mid-query — then returns to `redo_volume_min` after a cycle that reads everything available. Only applies when `window_strategy` is `redo_volume`.

Startup validation: it must be `>= redo_volume_min`, and at least `2`. A ceiling of `1` can never grow past a single reselected file, which stalls progress permanently, so it is rejected.

```yaml
logminer:
  window_strategy: redo_volume
  redo_volume_min: 2
  redo_volume_growth_max: 6
```

---

### `logminer.backoff_interval`

**Type:** `duration string` | **Required:** no | **Default:** `5s`

Sleep interval between mining attempts when the connector has caught up with the redo logs (i.e., the current database SCN equals the mined SCN). Increase for low-traffic tables to reduce Oracle load; decrease for near-real-time latency requirements.

```yaml
logminer:
  backoff_interval: 10s   # low-traffic tables
  # backoff_interval: 1s  # near-real-time
```

---

### `logminer.mining_interval`

**Type:** `duration string` | **Required:** no | **Default:** `300ms`

Sleep interval between successive mining cycles during normal operation (when not caught up). Controls polling frequency while processing a backlog.

```yaml
logminer:
  mining_interval: 100ms
```

---

### `logminer.strategy`

**Type:** `string` | **Required:** no | **Default:** `online_catalog`

LogMiner dictionary strategy. Currently `online_catalog` is the only supported value. It uses Oracle's live data dictionary (`DBMS_LOGMNR.DICT_FROM_ONLINE_CATALOG`) for best performance. This strategy cannot capture DDL changes — only DML (INSERT/UPDATE/DELETE).

The connector also always sets `DBMS_LOGMNR.NO_ROWID_IN_STMT` and `DBMS_LOGMNR.COMMITTED_DATA_ONLY` when starting the LogMiner session (`logminer/session.go`). The `COMMITTED_DATA_ONLY` flag is the mechanism that ensures only committed transactions are emitted and that open (uncommitted) transactions hold the checkpoint SCN back to their start SCN.

```yaml
logminer:
  strategy: online_catalog
```

---

### `logminer.max_session_age`

**Type:** `duration string` | **Required:** no | **Default:** `0s` (disabled)

Maximum duration a single LogMiner session may stay open before being forcibly ended and restarted, **even if no redo log switch has occurred**.

By default a session is only restarted on a detected log switch. On databases where switches are infrequent, a session can stay open a long time, and LogMiner has been observed to accumulate server-side PGA memory (particularly around online-catalog dictionary lookups) until Oracle kills the session with **ORA-04036**. Setting this forces a periodic restart independent of log switches.

```yaml
logminer:
  max_session_age: 20m
```

Reach for this when you see ORA-04036 on a database with rare log switches; leave it at `0s` otherwise.

---

### `logminer.max_transaction_events`

**Type:** `int` | **Required:** no | **Default:** `0` (no limit)

Maximum number of DML events buffered for a single uncommitted transaction. If a transaction exceeds this limit, its events are discarded and will not be emitted when the transaction commits. Set to `0` to disable the limit.

Use this to protect against very large transactions consuming all available memory (or transaction cache capacity).

```yaml
logminer:
  max_transaction_events: 10000   # discard transactions with >10000 events
```

---

### `logminer.lob_enabled`

**Type:** `bool` | **Required:** no | **Default:** `true`

When `true`, CLOB, BLOB, and NCLOB columns are included in both snapshot and streaming change events. Oracle uses separate redo log operation codes for LOB data (`SELECT_LOB_LOCATOR`, `LOB_WRITE`, `LOB_TRIM`); the connector assembles these fragments before emitting the event.

When `false`, LOB columns are present in the message but their values are empty. Disabling LOBs significantly reduces memory usage and processing overhead for databases with large LOB columns.

```yaml
logminer:
  lob_enabled: false   # skip LOB content for performance
```

---

### `logminer.transaction_cache`

**Type:** `string` | **Required:** no | **Default:** none (uses in-memory buffer)

Name of a cache resource for buffering in-flight (uncommitted) transactions. When not set, an in-memory map is used. Use an external cache (Redis, Memcached) to reduce connector memory usage for workloads with large or long-running transactions.

**Cache entry structure:** Each transaction occupies N+1 cache entries — one metadata key (transaction ID, start SCN, event count) plus one entry per DML event. A transaction with 1000 events uses 1001 cache entries.

**Recommended backends:** Redis or Memcached. High-latency or per-request-cost backends (S3, DynamoDB) are **not** recommended because LogMiner processes events on a single goroutine; per-call latency directly reduces throughput. Backend timeouts or errors cause the mining cycle to restart from an earlier checkpoint SCN, which can produce duplicate deliveries.

```yaml
cache_resources:
  - label: redis_txn_cache
    redis:
      url: redis://redis-host:6379

input:
  oracledb_cdc:
    logminer:
      transaction_cache: redis_txn_cache
      transaction_cache_key: oracle-prod-txn
```

---

### `logminer.transaction_cache_key`

**Type:** `string` | **Required:** no | **Default:** `oracledb_cdc`

Key prefix for storing transactions in `transaction_cache`. Set an alternative prefix when multiple `oracledb_cdc` inputs share the same cache, because Oracle transaction IDs (`USN.SLOT.SEQ`) are only unique within a single Oracle instance.

```yaml
logminer:
  transaction_cache_key: oracle-prod-orders
```

---

## Full Config with All Fields (showing defaults)

```yaml
input:
  label: ""
  oracledb_cdc:
    connection_string: oracle://username:password@host:port/service_name  # required
    wallet_path: /opt/oracle/wallet                                        # optional
    wallet_password: ""                                                    # optional
    prefetch_rows: 500
    snapshot_mode: none
    max_parallel_snapshot_tables: 1
    snapshot_max_batch_size: 1000
    logminer:
      scn_window_size: 20000
      backoff_interval: 5s
      mining_interval: 300ms
      strategy: online_catalog
      max_transaction_events: 0
      lob_enabled: true
      transaction_cache: ""        # optional; if empty: in-memory buffer
      transaction_cache_key: oracledb_cdc
    include: []                    # required; list of SCHEMA.TABLE regex patterns (anchor with ^...$ to match exactly)
    exclude: []                    # optional
    checkpoint_cache: ""           # optional; if empty: built-in Oracle table
    checkpoint_cache_table_name: RPCN.CDC_CHECKPOINT_CACHE
    checkpoint_cache_key: oracledb_cdc
    checkpoint_limit: 1024
    pdb_name: ""                   # optional; CDB/PDB use only
    auto_replay_nacks: true
    batching:
      count: 0
      byte_size: 0
      period: ""
      check: ""
```
