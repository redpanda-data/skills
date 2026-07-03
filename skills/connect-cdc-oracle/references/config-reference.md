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

### `snapshot_mode`

**Type:** `string` (enum) | **Required:** no | **Default:** `none` | **Since:** 4.99.0

Controls whether and how an initial snapshot of existing rows is taken before streaming begins. This enum field replaces the deprecated boolean `stream_snapshot`. One of:

- `none` (default) — skip snapshotting; start streaming from the current SCN. Equivalent to the legacy `stream_snapshot: false`.
- `snapshot_only` — perform a full snapshot, persist the SCN checkpoint, then **stop without streaming**. Use for a one-time backfill of existing rows. When the snapshot completes the input signals end-of-input and the pipeline shuts down.
- `snapshot_and_stream` — perform a full snapshot, then transition to LogMiner streaming. Equivalent to the legacy `stream_snapshot: true`.

Snapshot rows are emitted with `operation = read`. The SCN captured at the start of the snapshot is stored in the checkpoint; LogMiner streaming (in `snapshot_and_stream`) resumes from that SCN when the snapshot is complete.

> **Prerequisite:** Every snapshotted table must have a **primary key**. The connector uses primary-key cursor pagination to batch snapshot reads. A table without a primary key causes the connector to fail at snapshot prepare with `"can't find a primary key for table '%s', does it exist and have one set?"`. `snapshot_mode: none` has no primary-key requirement.

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

Maximum number of rows per batch during snapshotting. Each batch is paged using a cursor on the table's primary key; the cursor state is held in memory during the snapshot.

```yaml
snapshot_max_batch_size: 5000
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

The SCN range per mining cycle. Each cycle queries `V$LOGMNR_CONTENTS` for changes between `current_scn` and `current_scn + scn_window_size`. Must be greater than 0.

- **Smaller values** (e.g., 1000–5000): lower memory per cycle, higher query frequency, better for low-throughput tables.
- **Larger values** (e.g., 50000–100000): fewer queries, higher throughput, higher memory per cycle.

```yaml
logminer:
  scn_window_size: 50000
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
