# Pipeline and Output: mysql_cdc

Full runnable pipeline examples, message/metadata shape, per-table routing, snapshot + stream behavior, and restart/checkpoint semantics.

---

## Minimal pipeline (streaming only, no snapshot)

```yaml
# minimal-cdc.yaml
cache_resources:
  - label: binlog_cache
    file:
      directory: /var/lib/connect/checkpoints

input:
  label: mysql_source
  mysql_cdc:
    flavor: mysql
    dsn: cdc_user:password@tcp(localhost:3306)/mydb
    tables:
      - orders
    stream_snapshot: false        # start from current binlog position only
    checkpoint_cache: binlog_cache

output:
  label: redpanda_out
  kafka_franz:
    seed_brokers:
      - localhost:9092
    topic: cdc.orders
    compression: snappy
```

---

## Full pipeline with snapshot, batching, and per-table routing

```yaml
# full-cdc-pipeline.yaml

cache_resources:
  - label: binlog_cache
    redis:
      url: redis://localhost:6379

input:
  label: mysql_source
  mysql_cdc:
    flavor: mysql
    dsn: cdc_user:StrongPassword123!@tcp(localhost:3306)/mydb
    tables:
      - orders
      - customers
      - products
    stream_snapshot: true                   # bulk-read existing rows first
    snapshot_max_batch_size: 1000           # rows per snapshot query
    max_parallel_snapshot_tables: 2         # snapshot 2 tables concurrently
    checkpoint_cache: binlog_cache          # REQUIRED
    checkpoint_key: mysql_binlog_position   # unique key per pipeline
    checkpoint_limit: 1024                  # messages in flight
    max_reconnect_attempts: 10
    batching:
      count: 100
      period: 1s

pipeline:
  processors:
    - mapping: |
        # Derive target topic from table name
        meta topic = "cdc." + meta("table")

        # Optionally enrich each event with a timestamp field
        root = this
        root.captured_at = now()

output:
  label: redpanda_out
  kafka_franz:
    seed_brokers:
      - redpanda-broker-1:9092
      - redpanda-broker-2:9092
    topic: ${! meta("topic") }
    key: ${! json("id") }
    compression: snappy
    max_in_flight: 64
```

---

## Message and metadata shape

Every message emitted by `mysql_cdc` has:

### Body

A JSON object (or structured Go value) with one key per column in the source table. Column values are typed per the [type mapping](config-reference.md#type-mapping).

Example for a row `{id: 42, amount: 99.95, status: "shipped", created_at: "2024-01-15T10:30:00Z"}`:

```json
{
  "id": 42,
  "amount": 99.95,
  "status": "shipped",
  "created_at": "2024-01-15T10:30:00Z"
}
```

For `UPDATE` events, the connector emits the **new row values only** (not the before-image). The underlying go-mysql canal event contains both old and new rows; the connector selects only the new row at index 1 of the rows array.

For `DELETE` events, the body contains the row values at the time of deletion.

### Metadata fields

| Key | Present | Value |
|---|---|---|
| `operation` | Always | `read` (snapshot), `insert`, `update`, or `delete` |
| `table` | Always | Source table name (e.g. `orders`) |
| `binlog_position` | CDC events only | Binlog filename + offset in `filename@XXXXXXXX` hex format (e.g. `mysql-bin.000003@00A3F2B1`) |
| `schema` | Always (when schema is cached) | Table schema in Benthos common schema format — compatible with `parquet_encode` processor |

`binlog_position` is **not set** on snapshot (`read`) messages. This is intentional — snapshot rows have no binlog position.

Access metadata in Bloblang:
```yaml
- mapping: |
    let op    = meta("operation")
    let tbl   = meta("table")
    let binpos = meta("binlog_position")  # empty string for snapshot rows
```

---

## Per-table routing to different topics

Use a `mapping` processor to route each table's events to a dedicated Redpanda topic:

```yaml
pipeline:
  processors:
    - mapping: |
        meta topic = match meta("table") {
          "orders"    => "cdc.orders"
          "customers" => "cdc.customers"
          _           => "cdc.other"
        }

output:
  kafka_franz:
    seed_brokers:
      - localhost:9092
    topic: ${! meta("topic") }
```

Or using string concatenation (simpler for uniform topic naming):

```yaml
pipeline:
  processors:
    - mapping: |
        meta topic = "cdc." + meta("table")
```

---

## Filtering by operation type

Drop delete events before writing to Redpanda:

```yaml
pipeline:
  processors:
    - mapping: |
        root = if meta("operation") == "delete" { deleted() }
```

Process snapshot (read) and CDC events differently:

```yaml
pipeline:
  processors:
    - branch:
        request_map: |
          root = if meta("operation") == "read" { this } else { deleted() }
        processors:
          - mapping: |
              root = this
              root._source = "snapshot"
        result_map: root = this
    - mapping: |
        # For CDC events, add operation metadata to the body
        root = if meta("operation") != "read" {
          this.merge({"_op": meta("operation"), "_table": meta("table")})
        }
```

---

## Snapshot + stream behavior

### First run (no checkpoint in cache)

1. `stream_snapshot: true`: The connector opens a database connection and issues a table-scoped lock — `FLUSH TABLES <tables> WITH READ LOCK` — covering only the configured tables.
2. It establishes up to `min(max_parallel_snapshot_tables, number_of_tables)` consistent-snapshot transactions.
3. Reads the current binlog position (`SHOW BINARY LOG STATUS` on MySQL 8.4+, `SHOW MASTER STATUS` on earlier versions) and releases the lock.
4. Snapshots each table using keyset pagination (sorted by primary key, `snapshot_max_batch_size` rows per batch). These emit `operation: read` messages.
5. After all tables are fully snapshotted, the connector writes the snapshot's start binlog position to the checkpoint cache.
6. Switches to binlog streaming from that position.

`stream_snapshot: false`: Skips steps 1–5 entirely. Reads current binlog position and starts streaming immediately.

### Subsequent runs (checkpoint found in cache)

The connector reads the `binlog_position` key from `checkpoint_cache`. If found:
- **Skips the snapshot entirely** (even if `stream_snapshot: true`).
- Starts binlog streaming from the saved position.

### Cache cleared / binlog position expired

If the cache is cleared or the saved binlog position no longer exists on the MySQL server (binlog rotated away):
- `stream_snapshot: true` — performs a fresh snapshot and restarts from the new snapshot position.
- `stream_snapshot: false` — starts from the current live binlog position (gap in CDC coverage).

Ensure `binlog_expire_logs_seconds` (MySQL 8.0+; `expire_logs_days` was deprecated in 8.0 and removed in 8.4) or `expire_logs_days` (MySQL 5.7 / MariaDB) is set long enough that the pipeline can recover within the retention window (minimum 3 days recommended; 7 days is safe).

---

## Checkpoint semantics (at-least-once delivery)

The checkpoint cache is updated **after** the output acknowledges delivery, not when a message is read from the binlog. The `checkpoint_limit` controls how many messages can be in-flight simultaneously.

Checkpoints only advance at **transaction boundaries** (XID events). The connector always resumes at the start of a complete transaction, so it never misses a `TABLE_MAP_EVENT` that is required to decode row events.

On restart with a valid checkpoint:
- Messages between the checkpointed position and the actual delivery position may be **re-delivered** (at-least-once, not exactly-once).
- Downstream deduplication (e.g. using Redpanda's idempotent producer or a unique key in the output topic) is required for exactly-once semantics.

---

## Connecting to Redpanda Cloud (Serverless or BYOC)

```yaml
output:
  kafka_franz:
    seed_brokers:
      - seed-abc123.cloud.redpanda.com:9092
    tls:
      enabled: true
    sasl:
      - mechanism: SCRAM-SHA-256
        username: myuser
        password: ${REDPANDA_PASSWORD}
    topic: ${! meta("topic") }
    compression: snappy
```

---

## With TLS to MySQL (RDS / Cloud SQL)

```yaml
input:
  mysql_cdc:
    flavor: mysql
    dsn: cdc_user:password@tcp(mydb.rds.amazonaws.com:3306)/mydb
    tables: [orders]
    stream_snapshot: false
    checkpoint_cache: binlog_cache
    tls:
      skip_cert_verify: false
      root_cas_file: /etc/ssl/certs/rds-combined-ca-bundle.pem
```

---

## Dead-letter queue for output failures

Wrap the primary output in a `fallback` to catch persistent failures:

```yaml
output:
  fallback:
    - kafka_franz:
        seed_brokers:
          - localhost:9092
        topic: ${! meta("topic") }
    - kafka_franz:
        seed_brokers:
          - localhost:9092
        topic: cdc.dlq
        processors:
          - mapping: |
              root = {
                "original": this,
                "table": meta("table"),
                "operation": meta("operation"),
                "binlog_position": meta("binlog_position"),
                "error": error()
              }
```

---

## Writing to multiple outputs (fan-out)

```yaml
output:
  broker:
    outputs:
      - kafka_franz:
          seed_brokers: [localhost:9092]
          topic: ${! meta("topic") }
      - http_client:
          url: https://webhook.example.com/cdc
          verb: POST
```

---

## Operational checklist

- **Binlog retention**: ensure `binlog_expire_logs_seconds` >= 604800 (MySQL 8.0+) or `expire_logs_days` >= 7 (MySQL 5.7 / MariaDB). `expire_logs_days` was deprecated in MySQL 8.0 and removed in MySQL 8.4. If the pipeline is down longer than the retention window, the checkpoint position will be invalid.
- **Cache durability**: use `file` or `redis` cache backends; `memory` does not survive restarts and will trigger a full snapshot on every restart when `stream_snapshot: true`.
- **`checkpoint_limit`**: the default of `1024` is suitable for most workloads. Increase if output throughput requires more parallelism.
- **`max_reconnect_attempts`**: default `10` is fine for static passwords. For IAM auth, set to `3` or lower.
- **Multiple pipelines, same cache**: use distinct `checkpoint_key` values per pipeline to avoid key collisions.
- **Schema changes (DDL)**: the connector handles DDL changes at runtime — `OnTableChanged` invalidates the schema cache so the new schema is re-fetched on the next row event. No manual intervention is needed for `ALTER TABLE` on tracked tables.
