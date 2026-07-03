# Pipelines, Message Shape & Operational Behavior

This reference covers full pipeline examples, the message and metadata format emitted by `oracledb_cdc`, LOB handling, snapshot-then-stream behavior, checkpointing, and restart/resume semantics. All behavioral details are grounded in `input_oracledb_cdc.go`, `logminer/logminer.go`, and `replication/snapshot.go`.

---

## Message Body Shape

The connector emits each row change as a JSON object. The body contains the row's column values keyed by column name (uppercase, matching Oracle's identifier casing).

### INSERT example

```json
{
  "ORDER_ID": 12345,
  "CUSTOMER_ID": 67890,
  "AMOUNT": "99.50",
  "STATUS": "PENDING",
  "CREATED_AT": "2025-01-15T10:30:00Z"
}
```

### UPDATE example

UPDATE events contain the full row (all columns), not just changed columns, when ALL COLUMNS supplemental logging is enabled.

```json
{
  "ORDER_ID": 12345,
  "CUSTOMER_ID": 67890,
  "AMOUNT": "99.50",
  "STATUS": "SHIPPED",
  "CREATED_AT": "2025-01-15T10:30:00Z"
}
```

### DELETE example

DELETE events include the row values from the redo log (the pre-image of the deleted row, when ALL COLUMNS supplemental logging is enabled).

```json
{
  "ORDER_ID": 12345
}
```

### Type mapping summary

| Oracle Type | JSON wire format |
|---|---|
| `NUMBER(p≤18, s=0)` | JSON number (e.g. `42`) |
| `NUMBER(p>18)` or with scale | JSON string preserving precision (e.g. `"99999999999999999999"`, `"123.456"`) |
| `BINARY_FLOAT`, `BINARY_DOUBLE` | JSON number (e.g. `1.5`) |
| `DATE`, `TIMESTAMP` | ISO-8601 string (e.g. `"2025-01-15T10:30:00Z"`) |
| `CHAR`, `VARCHAR2`, `NCHAR`, `NVARCHAR2` | JSON string |
| `CLOB`, `NCLOB`, `LONG` | JSON string (when `lob_enabled: true`) |
| `BLOB`, `RAW`, `LONG RAW` | base64-encoded JSON string (when `lob_enabled: true`) |
| `JSON` column | JSON string (streaming) or native JSON (snapshot) |

See `TYPES.md` in the source for the complete type-coercion specification.

---

## Metadata Fields

Access metadata in Bloblang with `meta("field_name")`.

| Metadata Key | Type | Present | Description |
|---|---|---|---|
| `database_schema` | string | Always | Oracle schema (owner) of the source table |
| `table_name` | string | Always | Name of the source table |
| `operation` | string | Always | `read`, `insert`, `update`, or `delete` |
| `scn` | string | CDC + snapshot | Oracle System Change Number for this event. On snapshot (`read`) messages this is Oracle's current SCN captured (from `V$DATABASE`) at the start of the snapshot, so every snapshot row carries the same value (since 4.98.0; before that snapshot rows had no `scn`). |
| `checkpoint_scn` | string | CDC events with a checkpoint SCN | The SCN used as the checkpoint low-watermark for this event. Present on CDC events where a commit-level checkpoint SCN is available; used internally by the batcher to advance the checkpoint. Absent on snapshot (`read`) messages. |
| `transaction_id` | string | CDC only | Transaction ID in `USN.SLOT.SEQ` format; absent on snapshot (`read`) messages |
| `source_ts_ms` | string | CDC only | Milliseconds since Unix epoch when Oracle wrote the change to redo log; absent on snapshot messages |
| `commit_ts_ms` | string | CDC + snapshot | Milliseconds since Unix epoch at transaction commit (from `V$LOGMNR_CONTENTS.TIMESTAMP` on the COMMIT redo record). On snapshot (`read`) messages this is Oracle's `SYSTIMESTAMP` captured when the snapshot SCN was taken, so every snapshot row carries the same value (since 4.99.0). |
| `schema` | string | When schema resolution succeeds | Serialised table schema (fingerprinted `schema.Common`) for use with `schema_registry_encode`. Present whenever schema lookup succeeds; absent if schema resolution fails (a warning is logged). |

---

## Full Pipeline: Snapshot + Stream to Redpanda

```yaml
# oracle-to-redpanda.yaml
input:
  oracledb_cdc:
    connection_string: oracle://rpcn:SecurePassword1@oracle-host:1521/ORCL
    snapshot_mode: snapshot_and_stream   # snapshot existing rows, then stream
    max_parallel_snapshot_tables: 2
    snapshot_max_batch_size: 1000
    include:
      - ^MYSCHEMA\.ORDERS$
      - ^MYSCHEMA\.PRODUCTS$
    logminer:
      scn_window_size: 20000
      backoff_interval: 5s
      mining_interval: 300ms
      strategy: online_catalog
      max_transaction_events: 0
      lob_enabled: true
    checkpoint_limit: 1024

output:
  kafka_franz:
    seed_brokers:
      - redpanda-broker:9092
    topic: oracle-cdc-events
```

---

## Per-Table Topic Routing

Route each table's changes to a dedicated Redpanda topic using a Bloblang processor that reads the `table_name` metadata:

```yaml
input:
  oracledb_cdc:
    connection_string: oracle://rpcn:SecurePassword1@oracle-host:1521/ORCL
    include:
      - ^MYSCHEMA\.ORDERS$
      - ^MYSCHEMA\.PRODUCTS$
      - ^MYSCHEMA\.CUSTOMERS$
    logminer:
      scn_window_size: 20000
      backoff_interval: 5s
      mining_interval: 300ms
      strategy: online_catalog
      lob_enabled: true

pipeline:
  processors:
    - mapping: |
        # Build a lowercase topic name from SCHEMA.TABLE -> schema.table
        let schema = meta("database_schema").lowercase()
        let table  = meta("table_name").lowercase()
        meta topic = $schema + "." + $table

        # Optionally add operation type to the payload envelope:
        root.operation  = meta("operation")
        root.scn        = meta("scn")
        root.table      = meta("table_name")
        root.payload    = this

output:
  kafka_franz:
    seed_brokers:
      - redpanda-broker:9092
    topic: ${! meta("topic") }
```

---

## With External Redis Checkpoint Cache

Using an external Redis cache persists the SCN checkpoint independently of the Oracle database, and avoids requiring `CREATE TABLE` / `CREATE PROCEDURE` privileges on the Connect user:

```yaml
cache_resources:
  - label: redis_scn
    redis:
      url: redis://redis-host:6379
      prefix: oracle-cdc

input:
  oracledb_cdc:
    connection_string: oracle://rpcn:SecurePassword1@oracle-host:1521/ORCL
    include:
      - ^MYSCHEMA\.ORDERS$
    logminer:
      scn_window_size: 20000
      backoff_interval: 5s
      mining_interval: 300ms
      strategy: online_catalog
      lob_enabled: true
    checkpoint_cache: redis_scn
    checkpoint_cache_key: oracle-prod-orders-scn
    checkpoint_limit: 1024

output:
  kafka_franz:
    seed_brokers:
      - redpanda-broker:9092
    topic: oracle-cdc-orders
```

---

## With External Transaction Cache (Large Transactions)

For databases with large or long-running transactions, offload the in-flight transaction buffer to Redis. Redis is the recommended backend; S3/DynamoDB are too slow:

```yaml
cache_resources:
  - label: redis_txn
    redis:
      url: redis://redis-host:6379

  - label: redis_scn
    redis:
      url: redis://redis-host:6379

input:
  oracledb_cdc:
    connection_string: oracle://rpcn:SecurePassword1@oracle-host:1521/ORCL
    include:
      - ^MYSCHEMA\.ORDERS$
    logminer:
      scn_window_size: 20000
      backoff_interval: 5s
      mining_interval: 300ms
      strategy: online_catalog
      lob_enabled: true
      transaction_cache: redis_txn
      transaction_cache_key: oracle-prod-orders-txn
    checkpoint_cache: redis_scn
    checkpoint_cache_key: oracle-prod-orders-scn
    checkpoint_limit: 1024

output:
  kafka_franz:
    seed_brokers:
      - redpanda-broker:9092
    topic: oracle-cdc-orders
```

---

## CDB/PDB Pipeline

Monitoring a pluggable database inside a CDB:

```yaml
input:
  oracledb_cdc:
    # Must connect to CDB root service, not a PDB-local service
    connection_string: oracle://C##RPCN:SecurePassword1@oracle-host:1521/CDB_ROOT_SVC
    pdb_name: MYPDB
    snapshot_mode: none
    include:
      - ^APPSCHEMA\.ORDERS$
    logminer:
      scn_window_size: 20000
      backoff_interval: 5s
      mining_interval: 300ms
      strategy: online_catalog
      lob_enabled: true
    # Checkpoint table auto-derived to C##RPCN.CDC_CHECKPOINT_MYPDB in CDB mode

output:
  kafka_franz:
    seed_brokers:
      - redpanda-broker:9092
    topic: mypdb-cdc-orders
```

---

## Snapshot-Then-Stream Behavior

Snapshot behaviour is controlled by `snapshot_mode` (since 4.99.0), an enum with three values: `none` (default, no snapshot), `snapshot_only` (snapshot then stop), and `snapshot_and_stream` (snapshot then stream). The legacy boolean `stream_snapshot` is deprecated but still honoured as an alias when `snapshot_mode` is not set (`true` → `snapshot_and_stream`, `false` → `none`). The two flows below describe `none` and `snapshot_and_stream`; `snapshot_only` follows the `snapshot_and_stream` steps but stops after step 5 (the SCN checkpoint is persisted and the input ends) instead of starting LogMiner streaming.

### When `snapshot_mode: none` (default, formerly `stream_snapshot: false`)

1. The connector reads the current database SCN from `V$DATABASE`.
2. LogMiner streaming starts from that SCN — no historical rows are delivered.
3. The starting SCN is written to the checkpoint.

### When `snapshot_mode: snapshot_and_stream` (first run, formerly `stream_snapshot: true`)

> **Prerequisite:** Every table included in the snapshot must have a **primary key**. The connector paginates snapshot rows using a primary-key cursor; if a table lacks a primary key, the connector fails at snapshot prepare with `"can't find a primary key for table '%s', does it exist and have one set?"`. `snapshot_mode: none` does not have this requirement.

1. The current SCN is captured from `V$DATABASE` before the snapshot begins.
2. A consistent read-only transaction (`SET TRANSACTION READ ONLY`) is opened per table.
3. Tables are scanned in batches of `snapshot_max_batch_size` rows using primary-key-based cursor pagination. Up to `max_parallel_snapshot_tables` tables are scanned concurrently.
4. Snapshot rows are emitted with `operation = read`.
5. After all tables complete, the pre-snapshot SCN is written to the checkpoint.
6. LogMiner streaming starts from the pre-snapshot SCN — changes that occurred during the snapshot are replayed from the redo log.

### On restart with a stored SCN

Regardless of `snapshot_mode`, if a checkpoint SCN is found, **snapshotting is skipped**. The connector resumes LogMiner streaming from the stored SCN. This prevents re-delivery of the initial snapshot.

---

## Checkpointing and At-Least-Once Delivery

The connector maintains an SCN checkpoint — the highest SCN for which all messages have been acknowledged by the output. This is the recovery point if the connector restarts.

### How it works

- Each message carries an SCN. The checkpoint advances only when all messages at or below that SCN have been acknowledged.
- The `checkpoint_limit` controls the maximum number of unacknowledged in-flight messages. Increasing it improves throughput (the output can work on more messages concurrently) but also increases the window of potential re-delivery on restart.
- SCN checkpointing is "low watermark" — open uncommitted transactions hold the checkpoint back to their start SCN, preventing the checkpoint from advancing past data that has not yet been committed to the pipeline.

### Delivery guarantee

`oracledb_cdc` provides **at-least-once** delivery. On restart from a checkpoint SCN, events between the checkpoint and the current SCN are re-read from LogMiner. Some events may be delivered twice if the connector stops between processing a message and advancing the checkpoint.

---

## LOB Handling

### When `lob_enabled: true` (default)

Oracle writes LOB changes to redo logs via three separate operation codes:
- `SELECT_LOB_LOCATOR` (code 9): identifies which LOB column and row is being updated
- `LOB_WRITE` (code 10): one or more fragments of LOB data
- `LOB_TRIM` (code 11): signals the end of the LOB write

The connector accumulates these fragments in memory (or in the transaction cache if configured) and assembles them into a single column value before emitting the INSERT or UPDATE event.

CLOB/NCLOB is emitted as a UTF-8 string. BLOB and RAW are emitted as base64-encoded strings.

### When `lob_enabled: false`

LOB columns are present in the message with an empty value. The `SELECT_LOB_LOCATOR`, `LOB_WRITE`, and `LOB_TRIM` redo records are ignored. Use this when LOB content is not needed, as it significantly reduces memory usage and processing overhead.

---

## Restart and Resume After Failures

### Normal restart (checkpoint stored)

1. Connector reads the checkpoint SCN from the cache (Redis, Oracle table, or memory).
2. LogMiner streaming resumes from the stored SCN.
3. No snapshot is re-run.

### Checkpoint lost (no SCN in cache)

The connector logs `"No SCN found in checkpoint cache"` and behaves as if it is a first run:
- If `snapshot_mode: snapshot_and_stream` (or the deprecated `stream_snapshot: true`): snapshots all tables and starts streaming from the pre-snapshot SCN.
- If `snapshot_mode: none` (default): starts from the current database SCN (all historical changes are missed).

### ORA-01291: missing logfile

Archived redo logs have been purged before the connector processed them. This typically happens when processing takes longer than Oracle's log retention period.

The connector logs a summary similar to the following (paraphrased — see `logminer/logminer.go` for the exact message):

- Increase Oracle's archived log retention using RMAN: `CONFIGURE RETENTION POLICY TO RECOVERY WINDOW OF 7 DAYS;`
- Reduce `logminer.scn_window_size` or `logminer.backoff_interval` to speed up processing.
- Increase `input batching.count` for better throughput.
- Use faster output (e.g. `drop: {}`) for benchmarking.
- Reset the checkpoint and restart from the current SCN (note: this results in data loss; a snapshot may be required).

To recover from data loss, clear the checkpoint (delete the Redis key or truncate `RPCN.CDC_CHECKPOINT_CACHE`) and set `snapshot_mode: snapshot_and_stream` to re-snapshot.

---

## Schema Evolution

### Adding columns

When a streaming event references a column name not in the cached schema, the connector automatically refreshes the schema from `ALL_TAB_COLUMNS`. New columns added via `ALTER TABLE ... ADD COLUMN` are captured without a restart.

### Dropping columns

Dropped columns stop appearing in events. The cached schema still holds the dropped column until the connector restarts, at which point the schema is rebuilt from `ALL_TAB_COLUMNS`.

### DDL changes (table rename, type change)

The `online_catalog` LogMiner strategy does not capture DDL in the redo log. DDL changes (other than column additions) require restarting the connector, and in some cases may require clearing the checkpoint and re-snapshotting.

---

## Throughput Tuning Checklist

| Knob | Tune when... | Direction |
|---|---|---|
| `logminer.scn_window_size` | High-volume database, large change backlog | Increase (50000–100000) |
| `logminer.backoff_interval` | Low-traffic tables, reducing Oracle load | Increase (10s–60s) |
| `logminer.mining_interval` | Near-real-time latency needed | Decrease (100ms) |
| `max_parallel_snapshot_tables` | Snapshot of many tables is slow | Increase (2–8) |
| `snapshot_max_batch_size` | Snapshot throughput limited | Increase (5000–10000) |
| `checkpoint_limit` | Output throughput limited | Increase (2048–4096) |
| `batching.count` / `batching.period` | Output batching too small | Increase |
| `logminer.transaction_cache` | Memory pressure from large transactions | Add Redis cache |
| `logminer.lob_enabled` | LOBs not needed, memory/CPU too high | Set to `false` |
