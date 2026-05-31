# microsoft_sql_server_cdc: Pipeline, Output & Operations

Full runnable pipelines, the message metadata shape, routing patterns,
snapshot-then-stream lifecycle, checkpointing semantics, and restart behaviour.

---

## Minimal Pipeline (streaming only, no snapshot)

Streams all future changes from two tables to a single Redpanda topic. No
initial snapshot — starts from the current high-water LSN.

```yaml
input:
  microsoft_sql_server_cdc:
    connection_string: "sqlserver://connect_user:secret@sqlserver-host/MyDatabase?database=MyDatabase"
    stream_snapshot: false
    include:
      - "dbo\\.orders"
      - "dbo\\.customers"
    checkpoint_cache_table_name: rpcn.CdcCheckpointCache
    checkpoint_limit: 1024
    stream_backoff_interval: 5s

output:
  kafka_franz:
    seed_brokers:
      - localhost:9092
    topic: sqlserver-cdc
    compression: snappy
```

---

## Full Pipeline (snapshot + stream, per-table routing)

Snapshots all existing rows, then streams ongoing changes. Routes each table
to its own Kafka topic. Uses a batching policy for throughput.

```yaml
input:
  microsoft_sql_server_cdc:
    connection_string: "${MSSQL_DSN}"
    stream_snapshot: true
    max_parallel_snapshot_tables: 2
    snapshot_max_batch_size: 2000
    include:
      - "dbo\\.orders"
      - "dbo\\.order_items"
      - "dbo\\.customers"
    exclude:
      - "dbo\\..*_archive"
    checkpoint_cache_table_name: rpcn.CdcCheckpointCache
    checkpoint_limit: 2048
    stream_backoff_interval: 5s
    auto_replay_nacks: true
    batching:
      count: 200
      period: 500ms

output:
  kafka_franz:
    seed_brokers:
      - localhost:9092
    topic: '${! "sqlserver." + meta("database_schema") + "." + meta("table") }'
    key: '${! json("id") }'
    compression: snappy
    metadata:
      include_prefixes:
        - table        # forward specific metadata keys as Kafka headers
        - operation
        - database_schema
        # Avoid: - ""  (empty prefix matches ALL keys, including the heavy `schema` object)
```

---

## Pipeline with External Redis Checkpoint Cache

Useful when the Connect user does not have DDL rights on the source database,
or when you prefer a dedicated cache tier.

```yaml
cache_resources:
  - label: redis_cache
    redis:
      url: redis://redis-host:6379
      prefix: mssql_cdc_

input:
  microsoft_sql_server_cdc:
    connection_string: "${MSSQL_DSN}"
    stream_snapshot: true
    include:
      - "dbo\\..*"
    checkpoint_cache: redis_cache
    checkpoint_cache_key: mydb_pipeline_v1
    checkpoint_limit: 1024
    stream_backoff_interval: 10s

output:
  kafka_franz:
    seed_brokers:
      - localhost:9092
    topic: '${! meta("table") }'
```

---

## Pipeline Targeting Redpanda Cloud

```yaml
input:
  microsoft_sql_server_cdc:
    connection_string: "${MSSQL_DSN}"
    stream_snapshot: true
    include:
      - "dbo\\.orders"
    checkpoint_cache_table_name: rpcn.CdcCheckpointCache
    checkpoint_limit: 1024

output:
  kafka_franz:
    seed_brokers:
      - seed-abc123.cloud.redpanda.com:9092
    tls:
      enabled: true
    sasl:
      - mechanism: SCRAM-SHA-256
        username: "${REDPANDA_USER}"
        password: "${REDPANDA_PASSWORD}"
    topic: sqlserver-orders-cdc
    compression: snappy
```

---

## Message Metadata

Every message emitted by `microsoft_sql_server_cdc` carries these metadata
fields (accessible via `meta("field_name")` in Bloblang or Connect expressions):

| Metadata key | Type | Present on | Description |
|---|---|---|---|
| `database_schema` | string | all messages | SQL Server schema of the source table (e.g. `dbo`) |
| `schema` | object | all messages | Table schema in Benthos common schema format — compatible with the `parquet_encode` processor |
| `table` | string | all messages | Table name without schema (e.g. `orders`) |
| `operation` | string | all messages | `read`, `insert`, `update_before`, `update_after`, or `delete` |
| `lsn` | bytes | streamed changes only | Raw varbinary(10) LSN bytes (set via `string(m.LSN)`) — binary, not a printable hex string. **Absent on snapshot `read` rows** (LSN is nil during snapshot). |

The `0x…` hex form you may see in logs (e.g. `0x0000005a00000fc80001`) is produced by `LSN.String()` for logging only; it is never written to the message metadata. To expose a readable LSN in a Bloblang mapping use `.encode("hex")`:

```yaml
pipeline:
  processors:
    - mutation: |
        root = this
        root._lsn_hex = meta("lsn").encode("hex")
```

### Operation Types

The `operation` metadata value maps directly to SQL Server CDC operation codes:

| `operation` value | SQL Server op code | Meaning |
|---|---|---|
| `read` | 0 (synthetic) | Row read during the initial snapshot phase |
| `delete` | 1 | Row was deleted |
| `insert` | 2 | Row was inserted |
| `update_before` | 3 | Row state **before** an update |
| `update_after` | 4 | Row state **after** an update |

Every `UPDATE` in SQL Server produces **two** CDC change table entries: first
the before image (operation 3), then the after image (operation 4). Both share
the same `__$start_lsn` but have different `__$command_id` values. The
connector emits them as two consecutive messages, both with the same `lsn`
metadata value, ordered by command_id.

### Filtering Updates to Keep Only the After Image

```yaml
pipeline:
  processors:
    - mutation: |
        root = if meta("operation") == "update_before" { deleted() }
```

### Enriching Messages with Table Routing Metadata

Note: `lsn` is absent on snapshot rows (`operation: read`). Hex-encode it before embedding in the body if you need a printable representation:

```yaml
pipeline:
  processors:
    - mutation: |
        root = this
        root._meta = {
          "table":     meta("table"),
          "schema":    meta("database_schema"),
          "operation": meta("operation"),
          "lsn_hex":   meta("lsn").encode("hex"),  # only present on non-read rows
        }
```

---

## Message Body Shape

The message body is a JSON object containing only the user-defined columns of
the changed row. SQL Server's internal system columns (`__$start_lsn`,
`__$operation`, `__$seqval`, `__$update_mask`, `__$command_id`, `__$end_lsn`)
are stripped.

Example for a row in `dbo.orders` (with `operation: insert`):

```json
{
  "id": 1042,
  "customer_id": 7,
  "status": "pending",
  "amount": "149.990",
  "created_at": "2024-03-15T10:30:00Z",
  "notes": null
}
```

For `update_before` and `update_after`, the body contains the full row image
(all captured columns). For `delete`, the body contains the row as it was
before deletion.

### Decimal/Money Column Representation

`DECIMAL` and `NUMERIC` columns are emitted as canonical decimal strings with
the column's precision and scale, e.g. `"149.990"` for `DECIMAL(10,3)`.

`MONEY` and `SMALLMONEY` are also emitted as canonical decimal strings (e.g.
`"149.9900"`). This avoids float precision loss.

### Binary Column Representation

`BINARY`, `VARBINARY`, `VARBINARY(MAX)`, and `IMAGE` columns are emitted as
`[]byte`. In JSON output these appear as base64-encoded strings.

> Path nuance: the snapshot mapper only treats `BINARY`/`VARBINARY`/`VARBINARY(MAX)`/`IMAGE`
> as binary. `TIMESTAMP` (the SQL Server binary row-version counter, not a
> datetime) and `ROWVERSION` fall through to `string` on the **snapshot** path,
> while on the **stream** path they arrive as the driver-native `[]byte`. See
> the Column Type Mapping tables in SKILL.md for the full per-path breakdown.

---

## Snapshot-then-Stream Lifecycle

### First Run (no checkpoint)

1. The connector connects and calls `sys.fn_cdc_get_max_lsn()` to capture
   the current high-water LSN.
2. It opens `SNAPSHOT` isolation transactions (one per parallel worker) and
   pages through each table using keyset pagination ordered by primary key.
3. Each page (up to `snapshot_max_batch_size` rows) is published with
   `operation: read`.
4. After all tables complete, the captured max LSN is stored as the checkpoint.
5. Streaming begins from that LSN, reading `cdc.<schema>_<tablename>_CT`
   tables via `sys.fn_cdc_get_max_lsn()` as the upper bound per poll cycle.

The snapshot transaction uses `sql.LevelSnapshot` isolation, which requires
`ALLOW_SNAPSHOT_ISOLATION ON` for the database:
```sql
ALTER DATABASE MyDatabase SET ALLOW_SNAPSHOT_ISOLATION ON;
```

### Restart (checkpoint exists)

When a checkpoint LSN is found in the cache at startup, the snapshot phase is
**skipped entirely**. Streaming resumes from the checkpoint LSN. Any messages
that were in-flight when the pipeline stopped (up to `checkpoint_limit`) will
be re-delivered.

### Multi-Table LSN Ordering

When streaming, the connector queries all included change tables simultaneously
and merges the results using a min-heap ordered by `__$start_lsn` ASC,
`__$command_id` ASC, `__$operation` ASC. This ensures globally ordered delivery
across tables within the same transaction.

---

## Checkpointing Semantics

The LSN checkpoint is the "commit mark" — it represents the highest LSN for
which all messages have been fully acknowledged by the output.

- An LSN is not committed to the checkpoint cache until **every** message at
  or below that LSN has been acked.
- `checkpoint_limit` controls how many messages can be in-flight simultaneously.
- If the pipeline is killed with N messages in-flight, those N messages will
  be re-delivered on restart (at-least-once delivery).
- The checkpoint is updated after each successfully acked batch.

### Example: checkpoint_limit tuning

For a write-heavy table with bursts of 10k rows/second and an output with
500ms p99 latency, set `checkpoint_limit` to at least `500 * 10 = 5000` to
avoid backpressure from the checkpoint window becoming the bottleneck.

---

## CDC Change Table Poll Cycle

Each poll cycle:

1. Fetch `sys.fn_cdc_get_max_lsn()` — this is the upper bound for this cycle.
2. For each included table, open a query:
   ```sql
   SELECT * FROM cdc.dbo_orders_CT WITH (NOLOCK)
   WHERE (__$start_lsn > ? OR ? IS NULL)
     AND (__$start_lsn <= ? OR ? IS NULL)
   ORDER BY __$start_lsn ASC, __$command_id ASC, __$operation ASC
   ```
3. Merge results from all tables by LSN using the min-heap.
4. Publish each row as a message.
5. After all rows are exhausted, if no new LSN was seen, wait
   `stream_backoff_interval` before the next cycle.

The `WITH (NOLOCK)` hint allows reads of uncommitted data in the change table,
matching Debezium's approach for SQL Server CDC.

---

## Operational Notes

### CDC Change Table Growth

If `stream_backoff_interval` is very short (sub-second) on a high-traffic
server, the connector can create significant read load. For batch/ETL
workloads, set `stream_backoff_interval: 30s` or higher.

Monitor change table growth (illustrative — verify `cdc.change_tables` column names for your SQL Server version; `source_object_id` is the standard column name for the source table's object_id in most versions):
```sql
-- Approximate row count per capture instance
SELECT
  ct.capture_instance,
  SUM(p.rows) AS row_count
FROM cdc.change_tables ct
JOIN sys.partitions p
  ON ct.object_id = p.object_id   -- ct.object_id is the change table itself
  AND p.index_id IN (0, 1)
GROUP BY ct.capture_instance;
```

### LSN Gaps

If the pipeline is offline for longer than the CDC retention window (default
3 days), changes in the gap are permanently lost. When the pipeline reconnects,
it resumes from the checkpoint LSN. If that LSN is older than the retention
window, `fn_cdc_get_min_lsn()` will return a higher LSN, and the connector
will silently skip the gap.

To detect this condition, compare the checkpoint LSN against the minimum
available LSN (substitute your capture instance name for `'dbo_orders'`):

```sql
-- Illustrative diagnostic query; verify fn_cdc_get_min_lsn accepts your capture instance name
SELECT
  sys.fn_cdc_map_lsn_to_time(sys.fn_cdc_get_min_lsn('dbo_orders')) AS min_available,
  sys.fn_cdc_map_lsn_to_time(sys.fn_cdc_get_max_lsn())              AS current_max;
```

### Handling Schema Changes

SQL Server CDC capture instances track the schema at the time `sp_cdc_enable_table`
was called. If a column is added to the source table, the change table does not
automatically gain that column — you must disable and re-enable the capture
instance.

After a schema change:
1. `EXEC sys.sp_cdc_disable_table @source_schema = N'dbo', @source_name = N'orders', @capture_instance = N'all'`
2. `EXEC sys.sp_cdc_enable_table @source_schema = N'dbo', @source_name = N'orders', @role_name = NULL`
3. Restart the Connect pipeline. If no snapshot is needed, the pipeline
   resumes streaming from the checkpoint LSN (new columns will have NULL for
   rows captured before the schema change).

### Running Multiple CDC Pipelines on the Same Database

When running multiple `microsoft_sql_server_cdc` inputs against the same
database:

- If using the built-in SQL Server cache, use distinct `checkpoint_cache_table_name`
  values or distinct schemas for each pipeline.
- If using an external Connect cache, set unique `checkpoint_cache_key` values
  for each pipeline.
- Each pipeline should have non-overlapping `include` patterns to avoid
  duplicate processing.

### Lint and Validate Before Deployment

```bash
rpk connect lint mssql-cdc.yaml
rpk connect dry-run mssql-cdc.yaml
```

`dry-run` is a subcommand (not a flag on `run`). It connects to sources and
sinks, verifies tables, and validates the config without processing messages.
Use it to catch permission errors or missing capture instances before
production deployment.
