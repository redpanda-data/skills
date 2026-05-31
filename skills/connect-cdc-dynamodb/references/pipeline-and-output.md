# DynamoDB CDC: Pipelines, Message Shape, and Output Patterns

---

## Message shape

Every message produced by `aws_dynamodb_cdc` is a structured JSON object. The exact fields present depend on the stream view type enabled on the source table.

### CDC event (INSERT / MODIFY / REMOVE)

The `keys`, `newImage`, `oldImage`, and `sizeBytes` fields inside `dynamodb` are only present when the corresponding field is non-nil in the stream record. For INSERT there is no prior state so `oldImage` is absent (not null); for REMOVE there is no new state so `newImage` is absent.

INSERT example:

```json
{
  "tableName": "orders",
  "eventID": "shardId-00000001234567890123-abcdef12",
  "eventName": "INSERT",
  "eventVersion": "1.1",
  "eventSource": "aws:dynamodb",
  "awsRegion": "us-east-1",
  "dynamodb": {
    "sequenceNumber": "000000000000000000001",
    "streamViewType": "NEW_AND_OLD_IMAGES",
    "keys": {
      "orderId": "ORD-001"
    },
    "newImage": {
      "orderId": "ORD-001",
      "customerId": "CUST-42",
      "status": "pending",
      "total": 99.99
    },
    "sizeBytes": 128
  }
}
```

MODIFY example (both images present):

```json
{
  "tableName": "orders",
  "eventName": "MODIFY",
  "dynamodb": {
    "keys": { "orderId": "ORD-001" },
    "newImage": { "orderId": "ORD-001", "status": "shipped", "total": 99.99 },
    "oldImage": { "orderId": "ORD-001", "status": "pending", "total": 99.99 }
  }
}
```

REMOVE example (`newImage` absent, not null):

```json
{
  "tableName": "orders",
  "eventName": "REMOVE",
  "dynamodb": {
    "keys": { "orderId": "ORD-001" },
    "oldImage": { "orderId": "ORD-001", "status": "cancelled", "total": 99.99 }
  }
}
```

### Snapshot record (READ)

Snapshot records are emitted when `snapshot_mode` is `snapshot_only` or `snapshot_and_cdc`. They always use `eventName: READ` and only include `newImage`:

```json
{
  "tableName": "orders",
  "eventName": "READ",
  "dynamodb": {
    "newImage": {
      "orderId": "ORD-001",
      "customerId": "CUST-42",
      "status": "delivered",
      "total": 99.99
    }
  }
}
```

### DynamoDB attribute type mapping

DynamoDB attributes are converted from their wire types to native Go/JSON types:

| DynamoDB type | JSON representation |
|---|---|
| `S` (String) | `"string value"` |
| `N` (Number) | `"123.45"` (string — DynamoDB stores numbers as strings) |
| `BOOL` | `true` / `false` |
| `NULL` | `null` |
| `B` (Binary) | base64-encoded string |
| `SS` (String Set) | `["a", "b"]` |
| `NS` (Number Set) | `["1", "2"]` |
| `BS` (Binary Set) | `["base64...", ...]` |
| `L` (List) | `[...]` |
| `M` (Map) | `{...}` |

---

## Metadata fields

Metadata fields differ between CDC records and snapshot records:

| Metadata key | CDC records | Snapshot records |
|---|---|---|
| `dynamodb_event_name` | `INSERT`, `MODIFY`, or `REMOVE` | `READ` |
| `dynamodb_table` | Table name | Table name |
| `dynamodb_shard_id` | Shard ID string | _not present_ |
| `dynamodb_sequence_number` | Stream sequence number | _not present_ |
| `dynamodb_snapshot_segment` | _not present_ | Segment index string (e.g. `"0"`) |

`dynamodb_shard_id` and `dynamodb_sequence_number` are absent on snapshot records — they are not set to empty strings. Bloblang's `meta("dynamodb_shard_id")` will return a missing-key error on a snapshot record; use `exists(meta("dynamodb_shard_id"))` or event-name filtering to guard.

Access metadata in Bloblang with `meta("dynamodb_event_name")`.

---

## Complete single-table pipeline (snapshot + CDC)

```yaml
# single-table-pipeline.yaml
# Snapshot all existing items, then stream ongoing changes to Redpanda
input:
  aws_dynamodb_cdc:
    tables: [orders]
    start_from: trim_horizon
    snapshot_mode: snapshot_and_cdc
    snapshot_segments: 4           # 4 parallel Scan segments
    snapshot_throttle: 100ms       # 10 Scan requests/sec per segment
    snapshot_deduplicate: true     # suppress items seen in both snapshot and CDC
    snapshot_buffer_size: 100000
    checkpoint_table: redpanda_dynamodb_checkpoints
    region: us-east-1

pipeline:
  processors:
    - mapping: |
        # Preserve the full event; add a top-level op field for easier routing
        root = this
        root.op = meta("dynamodb_event_name")

output:
  kafka_franz:
    seed_brokers: ["redpanda:9092"]
    topic: orders-cdc
    sasl:
      - mechanism: SCRAM-SHA-256
        username: ${KAFKA_USER}
        password: ${KAFKA_PASSWORD}
```

---

## Multi-table pipeline (includelist)

```yaml
# multi-table-pipeline.yaml
# Stream from three tables simultaneously; route each to its own topic
input:
  aws_dynamodb_cdc:
    table_discovery_mode: includelist
    tables:
      - orders
      - customers
      - products
    start_from: trim_horizon
    checkpoint_table: redpanda_dynamodb_checkpoints
    region: us-east-1

output:
  switch:
    cases:
      - check: 'meta("dynamodb_table") == "orders"'
        output:
          kafka_franz:
            seed_brokers: ["redpanda:9092"]
            topic: orders-cdc
      - check: 'meta("dynamodb_table") == "customers"'
        output:
          kafka_franz:
            seed_brokers: ["redpanda:9092"]
            topic: customers-cdc
      - check: 'meta("dynamodb_table") == "products"'
        output:
          kafka_franz:
            seed_brokers: ["redpanda:9092"]
            topic: products-cdc
```

---

## Tag-discovery pipeline (dynamic tables)

```yaml
# tag-discovery-pipeline.yaml
# Auto-discover any table tagged stream-enabled:true and route to <table>-cdc topic
input:
  aws_dynamodb_cdc:
    table_discovery_mode: tag
    table_tag_filter: "stream-enabled:true"
    table_discovery_interval: 5m    # rescan for new tagged tables every 5 min
    start_from: trim_horizon
    checkpoint_table: redpanda_dynamodb_checkpoints
    region: us-east-1

output:
  kafka_franz:
    seed_brokers: ["redpanda:9092"]
    topic: '${! meta("dynamodb_table") }-cdc'
```

---

## CDC-only pipeline (no snapshot)

```yaml
# cdc-only-pipeline.yaml
# Stream only new changes from now
input:
  aws_dynamodb_cdc:
    tables: [inventory]
    start_from: latest              # skip history; start from new writes
    snapshot_mode: none
    checkpoint_table: redpanda_dynamodb_checkpoints
    region: us-east-1

output:
  kafka_franz:
    seed_brokers: ["redpanda:9092"]
    topic: inventory-cdc
```

---

## Filtering by event type

Use a Bloblang `mapping` processor or a `switch` output to filter or transform by event type:

```yaml
pipeline:
  processors:
    - mapping: |
        # Only forward INSERT and MODIFY; drop REMOVE events
        root = if meta("dynamodb_event_name") == "REMOVE" {
          deleted()
        } else {
          this
        }
```

```yaml
# Or use switch output to route deletes to a separate topic
output:
  switch:
    cases:
      - check: 'meta("dynamodb_event_name") == "REMOVE"'
        output:
          kafka_franz:
            seed_brokers: ["redpanda:9092"]
            topic: orders-deletes
      - output:
          kafka_franz:
            seed_brokers: ["redpanda:9092"]
            topic: orders-cdc
```

---

## Extracting the new item value

```yaml
pipeline:
  processors:
    - mapping: |
        # For INSERT/MODIFY, emit only the new item; for REMOVE, emit the old item
        root = if meta("dynamodb_event_name") == "REMOVE" {
          this.dynamodb.oldImage
        } else {
          this.dynamodb.newImage
        }
        root.eventName = this.eventName
        root.tableName = this.tableName
```

---

## Snapshot-only pipeline (one-shot bulk export)

```yaml
# bulk-export.yaml
# Scan the full table once, write to Redpanda, then exit
input:
  aws_dynamodb_cdc:
    tables: [products]
    snapshot_mode: snapshot_only
    snapshot_segments: 8
    snapshot_throttle: 50ms        # aggressive — adjust for your RCU budget
    snapshot_batch_size: 500
    checkpoint_table: redpanda_dynamodb_checkpoints
    region: us-east-1

output:
  kafka_franz:
    seed_brokers: ["redpanda:9092"]
    topic: products-snapshot
```

The connector exits cleanly after the Scan completes.

---

## Snapshot and CDC: ordering and deduplication behaviour

In `snapshot_and_cdc` mode the connector follows this sequence:

1. **Start CDC shard readers** (`TRIM_HORIZON` or `LATEST` depending on `start_from`). This ensures changes written _during_ the snapshot are captured.
2. **Begin Scan** across `snapshot_segments` parallel segments.
3. **Emit snapshot records** with `eventName: READ` as segments complete.
4. **After snapshot completes**, continue streaming from CDC shard readers indefinitely.

An item modified during the snapshot may appear in both the snapshot output and the CDC stream. With `snapshot_deduplicate: true` (default):
- The connector records the RFC3339Nano snapshot-start timestamp for each item key seen during the snapshot.
- CDC events for the same item key are dropped if their `ApproximateCreationDateTime` timestamp is at or before the snapshot's recorded timestamp for that item. This comparison is timestamp-based, not DynamoDB stream sequence number-based.
- If `snapshot_buffer_size` is exceeded, deduplication is disabled and the `dynamodb_cdc_snapshot_buffer_overflow` metric is incremented. Duplicates may occur but no data is lost.

If the connector restarts after a completed snapshot:
- In `snapshot_and_cdc` mode: the checkpoint table records the snapshot as complete; CDC resumes from checkpointed shard positions. If shard positions are stale (>24 hours), a new snapshot is triggered automatically.
- In `snapshot_only` mode: the connector detects the completed snapshot and exits immediately.

---

## Using EC2 instance profile (no static credentials)

```yaml
input:
  aws_dynamodb_cdc:
    tables: [orders]
    region: us-east-1
    credentials:
      from_ec2_role: true
```

---

## Using an IAM role (cross-account)

```yaml
input:
  aws_dynamodb_cdc:
    tables: [orders]
    region: us-east-1
    credentials:
      role: "arn:aws:iam::123456789012:role/redpanda-dynamodb-reader"
      role_external_id: "my-external-id"  # optional
```

---

## Connecting to Redpanda Cloud (serverless)

```yaml
input:
  aws_dynamodb_cdc:
    tables: [orders]
    region: us-east-1

output:
  kafka_franz:
    seed_brokers: ["${REDPANDA_BROKERS}"]
    tls:
      enabled: true
    sasl:
      - mechanism: SCRAM-SHA-256
        username: ${REDPANDA_USER}
        password: ${REDPANDA_PASSWORD}
    topic: orders-cdc
```
