# Pipeline, Message Shape & Output Patterns

This reference covers full runnable pipeline examples, the message payload and
metadata emitted by `gcp_spanner_cdc`, per-table routing, snapshot behavior,
and restart/resume semantics.

---

## Message Payload Shape

Each message emitted by `gcp_spanner_cdc` represents one **Mod** — a single row
mutation within a Spanner `DataChangeRecord`. One DataChangeRecord can contain
multiple Mods (one per row modified in the same transaction for the same table
and ModType).

### Payload (JSON body)

The message body is a JSON-serialized `Mod` struct:

```json
{
  "keys": {
    "SingerId": "1"
  },
  "new_values": {
    "FirstName": "Alice",
    "LastName":  "Smith"
  },
  "old_values": {}
}
```

| Field | Description |
|-------|-------------|
| `keys` | Primary key column(s) and values for the modified row |
| `new_values` | Column values after the mutation (populated for INSERT/UPDATE) |
| `old_values` | Column values before the mutation; populated by default (Spanner's default capture type is `OLD_AND_NEW_VALUES`) — empty only when the stream was created with `NEW_VALUES` or `NEW_ROW` |

For DELETE events, `new_values` is empty and `keys` identifies the deleted row.

### Message Metadata

All metadata is set on each message and accessible via `meta("field_name")` in
Bloblang or via the output's metadata configuration.

| Metadata Key | Type | Description |
|-------------|------|-------------|
| `table_name` | string | The Spanner table where the change occurred |
| `mod_type` | string | `INSERT`, `UPDATE`, or `DELETE` |
| `commit_timestamp` | time.Time | Spanner commit timestamp of the transaction; format to a string (e.g. `.string()` or `.ts_format(...)`) before writing to a Kafka header |
| `record_sequence` | string | Ordering sequence within the transaction/partition |
| `server_transaction_id` | string | Identifies all records from the same Spanner transaction (across partitions) |
| `is_last_record_in_transaction_in_partition` | bool | `true` if this is the last record for this transaction in this partition |
| `value_capture_type` | string | e.g. `NEW_VALUES` or `OLD_AND_NEW_VALUES` |
| `number_of_records_in_transaction` | int64 | Total DataChangeRecords in this transaction |
| `number_of_partitions_in_transaction` | int64 | Partitions touched by this transaction |
| `transaction_tag` | string | Application-defined tag set on the Spanner transaction (empty if none was set) |
| `is_system_transaction` | bool | `true` for Spanner internal DDL/metadata transactions |

---

## Minimal Pipeline

```yaml
# minimal.yaml — stream all changes, write to a single topic
input:
  gcp_spanner_cdc:
    project_id: "my-project"
    instance_id: "my-instance"
    database_id: "my-database"
    stream_id: "AllChanges"

output:
  kafka_franz:
    seed_brokers:
      - "localhost:9092"
    topic: "spanner-changes"
```

---

## Full Production Pipeline

```yaml
# spanner-cdc-production.yaml
input:
  label: "spanner_cdc"
  gcp_spanner_cdc:
    credentials_json: "${SPANNER_CDC_CREDENTIALS}"
    project_id: "${SPANNER_PROJECT}"
    instance_id: "${SPANNER_INSTANCE}"
    database_id: "${SPANNER_DATABASE}"
    stream_id: "OrderChanges"
    heartbeat_interval: 10s
    allowed_mod_types:
      - INSERT
      - UPDATE
      - DELETE
    batching:
      count: 100
      period: 1s

pipeline:
  processors:
    - mapping: |
        # Enrich with a structured envelope
        root.source = "spanner"
        root.table  = meta("table_name")
        root.op     = meta("mod_type")
        root.ts     = meta("commit_timestamp")
        root.txn_id = meta("server_transaction_id")
        root.data   = this

output:
  kafka_franz:
    seed_brokers:
      - "redpanda-broker-0:9092"
      - "redpanda-broker-1:9092"
    topic: 'spanner.cdc.${! meta("table_name") }'
    compression: snappy
    metadata:
      include_patterns:
        - "table_name"
        - "mod_type"
        - "commit_timestamp"
        - "server_transaction_id"
```

---

## Per-Table Routing to Separate Topics

Route each table's events to a dedicated Kafka topic using a `switch` output:

```yaml
input:
  gcp_spanner_cdc:
    project_id: "my-project"
    instance_id: "my-instance"
    database_id: "my-database"
    stream_id: "AllChanges"

output:
  switch:
    cases:
      - check: 'meta("table_name") == "orders"'
        output:
          kafka_franz:
            seed_brokers: ["localhost:9092"]
            topic: "spanner.orders"
      - check: 'meta("table_name") == "customers"'
        output:
          kafka_franz:
            seed_brokers: ["localhost:9092"]
            topic: "spanner.customers"
      - output:
          # Catch-all for unexpected tables
          kafka_franz:
            seed_brokers: ["localhost:9092"]
            topic: "spanner.other"
```

Alternatively, use a dynamic topic expression (simpler when all tables go to a
`spanner.<tablename>` pattern):

```yaml
output:
  kafka_franz:
    seed_brokers: ["localhost:9092"]
    topic: 'spanner.${! meta("table_name") }'
```

---

## Filtering Operations with Bloblang

Filter to only INSERT events using the `allowed_mod_types` config field:

```yaml
input:
  gcp_spanner_cdc:
    # ... connection fields ...
    stream_id: "AllChanges"
    allowed_mod_types:
      - INSERT
```

Or filter in the pipeline processors (more flexible for conditional logic):

```yaml
pipeline:
  processors:
    - mapping: |
        # Drop DELETE events, pass through INSERT and UPDATE
        root = if meta("mod_type") == "DELETE" {
          deleted()
        } else {
          this
        }
```

---

## Bounded Replay (Historical Window)

To replay a specific time window — for example, to backfill a downstream system:

```yaml
input:
  gcp_spanner_cdc:
    project_id: "my-project"
    instance_id: "my-instance"
    database_id: "my-database"
    stream_id: "AllChanges"
    start_timestamp: "2025-01-15T00:00:00Z"
    end_timestamp: "2025-01-16T00:00:00Z"   # exclusive
```

The connector will stop automatically when it reaches `end_timestamp`. The
timestamps must fall within the change stream's retention window.

---

## Restart and Resume Behavior

The connector uses the Spanner metadata table to persist its progress. On
restart:

1. **Interrupted partitions** (those in SCHEDULED or RUNNING state) are detected
   and immediately resumed from their last `Watermark` timestamp.
2. **New partitions** that appeared while the connector was down are detected via
   the partition discovery loop.
3. If a partition's watermark is older than the change stream retention period,
   Spanner will return an error. In this case:
   - Delete the metadata table row for the affected partition, or
   - Drop and recreate the metadata table, and set `start_timestamp` to a
     recent timestamp within the retention window.

The metadata table rows for FINISHED partitions are automatically deleted after
1 day (via Spanner's row deletion policy), so the table remains compact.

---

## Throughput Tuning with Batching

Without batching (`count: 1`, the implicit default), each Mod generates a
separate Kafka produce call. For high-throughput Spanner workloads, enable
batching:

```yaml
batching:
  count: 500          # Flush after 500 messages
  period: 500ms       # Or after 500ms, whichever comes first
  byte_size: 1000000  # Or after ~1 MB
```

The connector uses a per-partition batcher, so messages from different partitions
are never mixed in the same batch.

---

## Land CDC into an Iceberg Topic (Enterprise)

To make Spanner change history queryable as an Apache Iceberg table in object
storage, write CDC events to a Redpanda topic that has Iceberg enabled. This is
a broker-side Redpanda **Enterprise** feature and requires Tiered Storage on the
topic. See [Enterprise Features](enterprise-features.md) for the full key list.

```bash
# Cluster prerequisites (one time)
rpk cluster config set cloud_storage_enabled true   # Tiered Storage master switch
rpk cluster config set iceberg_enabled true          # restart required

# Create the CDC destination topic with Iceberg + Tiered Storage
rpk topic create spanner.cdc.orders
rpk topic alter-config spanner.cdc.orders \
  --set redpanda.remote.write=true \
  --set redpanda.remote.read=true \
  --set redpanda.iceberg.mode=key_value \
  --set redpanda.iceberg.target.lag.ms=30000
```

```yaml
# Connect pipeline writes CDC events; Redpanda materializes the Iceberg table.
input:
  gcp_spanner_cdc:
    project_id: "my-project"
    instance_id: "my-instance"
    database_id: "my-database"
    stream_id: "OrderChanges"

output:
  kafka_franz:
    seed_brokers: ["redpanda-broker-0:9092"]
    topic: "spanner.cdc.orders"
    compression: snappy
```

For a structured Iceberg table (one column per field rather than a single binary
value column), register a schema for the topic and produce in the Schema
Registry wire format, then use `redpanda.iceberg.mode=value_schema_id_prefix` or
`value_schema_latest`.

---

## Dead-Letter Output Pattern

If the primary output fails, route failed messages to a dead-letter topic:

```yaml
output:
  fallback:
    - kafka_franz:
        seed_brokers: ["localhost:9092"]
        topic: 'spanner.cdc.${! meta("table_name") }'
    - kafka_franz:
        seed_brokers: ["localhost:9092"]
        topic: "spanner.cdc.dead-letter"
```

---

## Metrics Exposed

The connector emits the following metrics (tagged with `stream=<stream_id>`),
accessible via the Connect `/metrics` endpoint when Prometheus is configured:

| Metric | Description |
|--------|-------------|
| `spanner_cdc_partition_record_created_count` | Total partitions discovered |
| `spanner_cdc_partition_record_running_count` | Total partitions started |
| `spanner_cdc_partition_record_finished_count` | Total partitions completed |
| `spanner_cdc_partition_record_split_count` | Partition splits detected |
| `spanner_cdc_partition_record_merge_count` | Partition merges detected |
| `spanner_cdc_partition_created_to_scheduled_ns` | Latency: created → scheduled |
| `spanner_cdc_partition_scheduled_to_running_ns` | Latency: scheduled → running |
| `spanner_cdc_query_count` | Total Spanner queries issued |
| `spanner_cdc_data_change_record_count` | Total DataChangeRecords processed |
| `spanner_cdc_data_change_record_committed_to_emitted_ns` | End-to-end latency from Spanner commit to message emit |
| `spanner_cdc_heartbeat_record_count` | Total heartbeat records received |

Enable Prometheus metrics in the pipeline:

```yaml
metrics:
  prometheus: {}
http:
  enabled: true
  address: "0.0.0.0:4195"
```

Then scrape `/metrics` at `http://localhost:4195/metrics`.

---

## Enterprise License

The `gcp_spanner_cdc` input is gated by a Redpanda Enterprise license check
(`license.CheckRunningEnterprise`). Without a valid Enterprise license, the
connector fails at startup with a license error. Configure your license via the
Redpanda Connect Enterprise distribution or by setting the license in the
pipeline config.
