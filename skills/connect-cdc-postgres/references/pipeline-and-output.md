# Pipeline, Message Shape & Output Patterns

This reference covers: the complete message and metadata shape emitted by `postgres_cdc`, full pipeline examples (including per-table routing), snapshot-then-stream lifecycle, and checkpoint/restart semantics. Grounded in `internal/impl/postgresql/input_pg_stream.go`, `pglogicalstream/stream_message.go`, and `pglogicalstream/logical_stream.go`.

## Message Shape

Each message emitted by `postgres_cdc` is a JSON object. The structure depends on the `operation` type.

### DML Operations: `insert`, `update`, `delete`

The message body is the row data as a JSON object, keyed by column name:

```json
{
  "id": 42,
  "customer_id": 7,
  "amount": 99.99,
  "status": "pending",
  "created_at": "2024-11-15T10:30:00Z"
}
```

For `delete` events (when `REPLICA IDENTITY` is not `FULL`), only the primary key columns are present in the body. Set `REPLICA IDENTITY FULL` to get all column values on delete.

For `update` events, the body contains the **new** row values. Unchanged TOAST columns will be absent (or replaced by `unchanged_toast_value` if configured).

### Transaction Markers: `begin`, `commit`

When `include_transaction_markers: true`, begin and commit messages have a `null` body:

```
null
```

### Snapshot Reads: `read`

The message body is the full row data, same shape as `insert`.

## Metadata Fields

Every message has these metadata fields accessible in Bloblang via `metadata("key")` or `meta("key")`:

| Metadata key | Type | Description |
|---|---|---|
| `table` | string | Unquoted table name (e.g. `orders`) |
| `operation` | string | One of: `read`, `insert`, `update`, `delete`, `begin`, `commit` |
| `lsn` | string | WAL log sequence number (e.g. `0/16E4D40`). **Absent** (not set) for snapshot `read` messages |
| `commit_ts_ms` | string | Transaction commit timestamp as Unix milliseconds. Set on `insert`, `update`, and `delete` messages. **Not set** for snapshot `read` messages (since 4.98.0) |
| `before` | immutable object | Pre-change state of the row, in Benthos common schema format. Set on `update` and `delete` messages. For updates, availability depends on the table's `REPLICA IDENTITY`: with the default identity only key columns are present; with `REPLICA IDENTITY FULL` all columns are present (since 4.99.0) |
| `schema` | immutable object | Column schema in Benthos common format, compatible with `parquet_encode`. Set on `read`, `insert`, `update`, and `delete` messages (all data-bearing messages; not set on `begin`/`commit`) |

The `schema` metadata is set as an immutable value (not serialized to JSON). Access it with schema-aware processors like `parquet_encode: { schema_metadata: schema }`.

## Operation Types (Source)

From `pglogicalstream/stream_message.go`:

```go
ReadOpType   OpType = "read"    // snapshot phase
InsertOpType OpType = "insert"  // WAL INSERT
UpdateOpType OpType = "update"  // WAL UPDATE
DeleteOpType OpType = "delete"  // WAL DELETE
BeginOpType  OpType = "begin"   // transaction start (only if include_transaction_markers=true)
CommitOpType OpType = "commit"  // transaction end (only if include_transaction_markers=true)
```

## Minimal Pipeline: Single Table to Redpanda

> **Output choice**: When writing to Redpanda, the native `redpanda` output is the idiomatic choice — it handles seed broker discovery and authentication more ergonomically. `kafka_franz` is fully valid for both Redpanda and generic Kafka targets. The examples below use `kafka_franz` for generality; substitute `redpanda:` with the same `seed_brokers`/`topic`/`key` fields for the native output.

```yaml
input:
  postgres_cdc:
    dsn: postgres://cdc_user:secret@localhost:5432/mydb?sslmode=disable
    schema: public
    tables:
      - orders
    slot_name: orders_cdc_slot
    stream_snapshot: false   # only live changes

output:
  kafka_franz:
    seed_brokers:
      - localhost:9092
    topic: pg.orders.cdc
    key: ${! json("id").string() }
```

## Full Pipeline: Multi-Table with Per-Table Topic Routing

```yaml
input:
  label: "pg_cdc"
  postgres_cdc:
    dsn: postgres://cdc_user:secret@localhost:5432/mydb?sslmode=disable
    schema: public
    tables:
      - orders
      - customers
      - products
    slot_name: multi_table_slot
    stream_snapshot: true
    snapshot_batch_size: 5000
    max_parallel_snapshot_tables: 3
    checkpoint_limit: 2048
    heartbeat_interval: 30m
    batching:
      count: 100
      period: 1s

pipeline:
  processors:
    # Enrich each message with routing metadata and a standardized envelope
    - mapping: |
        let tbl = metadata("table")
        let op  = metadata("operation")
        let lsn = metadata("lsn")

        # Route to a topic per table
        meta topic = "pg.cdc." + $tbl

        # Set message key to the record's primary key (adjust field name as needed)
        meta msg_key = this.id.string()

        # Optionally wrap in an envelope
        root = {
          "source": "postgresql",
          "table": $tbl,
          "operation": $op,
          "lsn": $lsn,
          "payload": this
        }

output:
  kafka_franz:
    seed_brokers:
      - localhost:9092
    topic: ${! metadata("topic") }
    key: ${! metadata("msg_key") }
    compression: lz4
    max_message_bytes: 1048576
```

## Filtering: Only Emit Inserts and Updates

```yaml
pipeline:
  processors:
    - mapping: |
        # Drop deletes and transaction markers
        root = if ["insert", "update", "read"].contains(metadata("operation")) {
          this
        } else {
          deleted()
        }
```

## Routing to Separate Outputs per Operation

```yaml
output:
  switch:
    cases:
      - check: metadata("operation") == "delete"
        output:
          kafka_franz:
            seed_brokers: [localhost:9092]
            topic: pg.cdc.${! metadata("table") }.deletes
            key: ${! json("id").string() }

      - output:
          kafka_franz:
            seed_brokers: [localhost:9092]
            topic: pg.cdc.${! metadata("table") }
            key: ${! json("id").string() }
```

## Writing to Parquet via Redpanda Connect

The `schema` metadata is in Benthos common schema format, compatible with `parquet_encode`:

```yaml
pipeline:
  processors:
    - parquet_encode:
        schema_metadata: schema      # references the 'schema' metadata key set by postgres_cdc
        default_compression: snappy
```

## Snapshot-Then-Stream Lifecycle

The snapshot-then-stream behavior when `stream_snapshot: true`:

```
Start
  |
  +--> Create temporary replication slot (EXPORT_SNAPSHOT)
  |      slot name: <slot_name>_tmp
  |
  +--> Open N reader transactions pinned to the exported snapshot
  |      (N = max_parallel_snapshot_tables)
  |
  +--> For each table (in parallel up to N):
  |      Query rows in primary-key order, snapshot_batch_size rows per query
  |      Emit StreamMessage{Operation: "read", LSN: nil, ...}
  |
  +--> All tables fully scanned
  |
  +--> Copy temporary slot -> permanent slot (pg_copy_logical_replication_slot)
  |      preserves the LSN from snapshot time
  |
  +--> Drop temporary slot (<slot_name>_tmp)
  |
  +--> Start logical replication from the copied slot's LSN
       Emit StreamMessage{Operation: "insert"|"update"|"delete", LSN: "0/...", ...}
```

On **restart** (slot already exists): the connector reads `pg_replication_slots.confirmed_flush_lsn` for the existing slot and resumes streaming from that point. Snapshot is skipped.

## Checkpointing and At-Least-Once Delivery

The connector uses `github.com/Jeffail/checkpoint` to track which LSNs have been acknowledged downstream:

- Each batch of messages is tracked with its LSN.
- The LSN is acknowledged to PostgreSQL (`pg_standby_status_update`) only after all messages up to that LSN have been confirmed delivered (acked) by the output.
- `checkpoint_limit` bounds the number of in-flight messages. Back-pressure applies when the limit is reached.
- Snapshot messages have `LSN: nil` — they are not individually acknowledged to PostgreSQL. The LSN is advanced after the snapshot completes and WAL streaming begins.

**Guarantee**: At-least-once. On restart the connector resumes from the last acknowledged LSN, re-delivering any messages that had not been acked.

## Operational Notes

### Replication Slot Bloat

If the pipeline stops or falls far behind, the replication slot prevents WAL reclamation. The slot holds all WAL from `confirmed_flush_lsn` forward. Monitor and alert:

```sql
SELECT
  slot_name,
  pg_size_pretty(
    pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)
  ) AS lag,
  active
FROM pg_replication_slots;
```

Consider setting `max_slot_wal_keep_size` in `postgresql.conf` to cap slot lag (PostgreSQL 13+):

```
max_slot_wal_keep_size = 10GB
```

If the slot's WAL is discarded due to this limit, the connector will fail and the slot must be dropped and recreated (with snapshot replay if needed).

### Heartbeats for Quiet Tables

The connector writes a logical message (`pg_logical_emit_message`) periodically with prefix `redpanda_connect_<slot_name>` to advance the acknowledged LSN even when no DML changes arrive on the subscribed tables. This prevents WAL accumulation caused by high-frequency activity on other tables that are not being replicated.

The heartbeat message is detected by the stream processor and treated as a suppressed commit message — it advances the LSN tracking but does not emit a visible message downstream.

### Transaction Ordering

Messages within a transaction are emitted in commit order. `include_transaction_markers: true` adds `begin`/`commit` messages with null payloads around each transaction's events, enabling downstream transactional fan-out.

### DDL Changes

The connector detects schema changes via `RelationMessage` from the WAL. When PostgreSQL sends a `RelationMessage` (which it does before the first DML after any DDL change), the schema cache is invalidated and the new schema is reflected in the `schema` metadata on subsequent DML messages. No pipeline restart is required for most DDL changes (adding columns, changing types).

### Adding Tables

Update the `tables` list in the config and restart the pipeline. The connector updates the publication to add the new tables. Existing data in newly added tables will not be snapshot unless `stream_snapshot: true` and the slot is dropped/recreated.
