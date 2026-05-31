# Pipeline and Output: mongodb_cdc

Full pipeline YAML examples, message/metadata shape, per-collection routing,
cache resource options, and restart/resume semantics.

---

## Message Shape

Each document emitted by `mongodb_cdc` is a JSON-serialised BSON document
(the format is controlled by `json_marshal_mode`). The message body and
metadata depend on the event type and `document_mode`.

### Message body

In `update_lookup` mode (default) with `json_marshal_mode: canonical`:

```json
{
  "_id":         { "$oid": "664a1b2c3d4e5f6a7b8c9d0e" },
  "customer_id": "cust-42",
  "amount":      "99.95",
  "status":      "paid",
  "created_at":  { "$date": "2024-05-20T10:30:00Z" }
}
```

**Decimal128 note**: `Decimal128` values are always emitted as a plain decimal
string (e.g. `"99.95"`) regardless of `json_marshal_mode`. The `{"$numberDecimal": "..."}`
ExtJSON wrapper is never produced. Other BSON types — `ObjectId`, `Date`,
`Binary`, etc. — are wrapped in canonical mode and flattened in relaxed mode.

In `relaxed` `json_marshal_mode`:

```json
{
  "_id":         "664a1b2c3d4e5f6a7b8c9d0e",
  "customer_id": "cust-42",
  "amount":      "99.95",
  "status":      "paid",
  "created_at":  "2024-05-20T10:30:00.000Z"
}
```

For `delete` in `update_lookup` mode (no pre-images configured), only `_id`
is populated:

```json
{ "_id": { "$oid": "664a1b2c3d4e5f6a7b8c9d0e" } }
```

For `partial_update` mode on an update event:

```json
{
  "_id": { "$oid": "664a1b2c3d4e5f6a7b8c9d0e" },
  "operations": [
    { "path": ["status"],      "type": "set",   "value": "shipped" },
    { "path": ["internal_id"], "type": "unset",  "value": null },
    { "path": ["tags"],        "type": "truncatedArray", "value": 2 }
  ]
}
```

### Message metadata

| Key | Type | Value |
|---|---|---|
| `operation` | string | `"read"` (snapshot), `"insert"`, `"update"`, `"replace"`, `"delete"` |
| `collection` | string | Collection name, e.g. `"orders"` |
| `operation_time` | string | BSON timestamp JSON: `{"$timestamp":{"t":1716201000,"i":1}}` |
| `schema` | immutable any | Benthos common schema (may be absent for some delete events) |

---

## Minimal Pipeline (no snapshot, single collection)

```yaml
# mongodb-cdc-minimal.yaml
cache_resources:
  - label: mongo_checkpoint
    memory:
      compaction_interval: "" # empty string disables compaction/expiry

input:
  mongodb_cdc:
    url:              "mongodb://localhost:27017/?replicaSet=rs0"
    database:         mydb
    collections:
      - orders
    checkpoint_cache: mongo_checkpoint

output:
  kafka_franz:
    seed_brokers: ["localhost:9092"]
    topic:        "mongo.orders"
    # In canonical json_marshal_mode (default), _id for ObjectId documents is
    # {"$oid":"<hex>"}. Extract the hex string; fall back for other id types.
    key:          ${! this._id."$oid" | this._id.string() | "" }
```

---

## Production Pipeline (snapshot + stream, multi-collection, Redis checkpoint)

```yaml
# mongodb-cdc-production.yaml
cache_resources:
  - label: mongo_checkpoint
    redis:
      url: redis://redis:6379

input:
  label: "mongo_cdc"
  mongodb_cdc:
    url:      "mongodb+srv://cdc_user:${MONGO_PASSWORD}@cluster0.abc123.mongodb.net/"
    database: mydb
    username: cdc_user
    password: "${MONGO_PASSWORD}"
    collections:
      - orders
      - customers
      - inventory
    checkpoint_cache:    mongo_checkpoint
    checkpoint_key:      mydb_cdc_checkpoint
    checkpoint_interval: 5s
    checkpoint_limit:    1000
    stream_snapshot:     true
    snapshot_parallelism: 4
    snapshot_auto_bucket_sharding: true   # required for Atlas
    read_batch_size:     1000
    read_max_wait:       1s
    document_mode:       update_lookup

pipeline:
  processors:
    - mapping: |
        # Set per-collection topic routing
        meta topic = "mongo.cdc." + meta("collection")
        # Use _id as the Kafka message key for ordering within a partition.
        # In canonical json_marshal_mode (default), ObjectId _id is an object
        # {"$oid":"<hex>"}. Extract the hex string for a clean key.
        let id = this._id
        meta msg_key = match {
          $id.type() == "string" => $id,
          _ => $id."$oid" | $id.string() | ""
        }
        # Pass the operation type as a header
        meta op = meta("operation")

output:
  redpanda:
    seed_brokers: ["redpanda:9092"]
    topic:        ${! meta("topic") }
    key:          ${! meta("msg_key") }
    max_in_flight: 256
    metadata:
      include_patterns:
        - ".*"        # include all metadata as Kafka headers
      # Note: mongodb_cdc emits keys without a common prefix (operation,
      # collection, operation_time). Use include_patterns: [".*"] rather
      # than include_prefixes: [""] — the latter relies on undocumented
      # empty-prefix matching behavior.
```

---

## Per-Collection Routing to Separate Topics

Use a `switch` output to route each collection to its own topic without
Bloblang meta tricks:

```yaml
output:
  switch:
    cases:
      - check: meta("collection") == "orders"
        output:
          redpanda:
            seed_brokers: ["redpanda:9092"]
            topic: mongo.orders
            key:   ${! this._id."$oid" | this._id.string() | "" }

      - check: meta("collection") == "customers"
        output:
          redpanda:
            seed_brokers: ["redpanda:9092"]
            topic: mongo.customers
            key:   ${! this._id."$oid" | this._id.string() | "" }

      - check: "true"
        output:
          redpanda:
            seed_brokers: ["redpanda:9092"]
            topic: mongo.cdc.other
            key:   ${! this._id."$oid" | this._id.string() | "" }
```

---

## Filtering Events by Operation Type

To skip snapshot (`"read"`) events and only forward live changes:

```yaml
pipeline:
  processors:
    - mapping: |
        root = if meta("operation") == "read" { deleted() } else { this }
```

To forward only inserts and replaces (ignore updates and deletes):

```yaml
pipeline:
  processors:
    - mapping: |
        let op = meta("operation")
        root = match $op {
          "insert"  => this,
          "replace" => this,
          _         => deleted()
        }
```

---

## Adding a Dead-Letter Output

Wrap with a `fallback` output to capture failed messages:

```yaml
output:
  fallback:
    - redpanda:
        seed_brokers: ["redpanda:9092"]
        topic: mongo.cdc.orders

    - redpanda:
        seed_brokers: ["redpanda:9092"]
        topic: mongo.cdc.dead_letter
```

---

## Resume Token and Restart Semantics

### First run (no cached token, `stream_snapshot: false`)

1. Connector connects and runs `{hello: 1}` to get `lastWrite.majorityOpTime.ts`.
2. Opens change stream starting at the next oplog timestamp after the current
   tip.
3. Only events that arrive **after startup** are emitted.

### First run (no cached token, `stream_snapshot: true`)

1. Connector records the current oplog tip.
2. For each collection, reads all existing documents (operation = `"read"`),
   respecting `snapshot_parallelism`.
3. Opens change stream starting just after the recorded tip. Events that
   arrived during snapshot are emitted from the live stream.

### Subsequent runs (token in cache)

1. Connector loads the resume token from the cache.
2. Opens change stream with `ResumeAfter: <token>`.
3. MongoDB delivers all events since that token (bounded by oplog retention).
4. No snapshot is performed.

### Unclean shutdown

If the process is killed before the checkpoint flusher runs, the resume token
may be up to `checkpoint_interval` (default 5s) behind the last acknowledged
message. On restart, the connector replays those messages. Downstream must be
idempotent or at-least-once tolerant.

### Expired resume token

If the oplog has been trimmed past the stored token, MongoDB returns an error
when `ResumeAfter` is applied. The connector surfaces this as an error and
stops. Recovery steps:

```bash
# 1. Delete the stale token from Redis
redis-cli DEL mydb_cdc_checkpoint

# 2. Restart the pipeline with stream_snapshot=true in the config
rpk connect run mongodb-cdc-production.yaml
```

---

## Cache Resource Options

### Memory (development only — resets on restart)

```yaml
cache_resources:
  - label: mongo_checkpoint
    memory:
      compaction_interval: "" # empty string disables expiry/compaction
```

### Redis (recommended for production)

```yaml
cache_resources:
  - label: mongo_checkpoint
    redis:
      url: redis://redis:6379
      default_ttl: ""        # no expiry — token must survive indefinitely
```

### MongoDB (use the same cluster or a separate one)

```yaml
cache_resources:
  - label: mongo_checkpoint
    mongodb:
      url:        "mongodb://localhost:27017/?replicaSet=rs0"
      database:   cdc_meta
      collection: checkpoints
      key_field:  key
      value_field: token
```

---

## Example: Sink to Iceberg via Redpanda Pipelines

This shows the CDC stream flowing into a Redpanda topic that a separate
Iceberg-sink pipeline consumes. The `mongodb_cdc` pipeline itself just needs
to produce to Redpanda:

```yaml
# Stage 1: mongodb_cdc → Redpanda topic
output:
  redpanda:
    seed_brokers: ["redpanda:9092"]
    topic: mongo.cdc.raw
    key:   ${! this._id."$oid" | this._id.string() | "" }
    metadata:
      include_patterns: [".*"]
```

A second Connect pipeline reads `mongo.cdc.raw` and writes to Iceberg.

---

## Example: Using `pre_and_post_images` Mode

Capture the full document before and after every write. Requires MongoDB 6+
and `changeStreamPreAndPostImages` enabled on each collection (see
[Setup MongoDB](setup-mongodb.md)):

```yaml
input:
  mongodb_cdc:
    url:           "mongodb://localhost:27017/?replicaSet=rs0"
    database:      mydb
    collections:   [orders]
    checkpoint_cache: mongo_checkpoint
    document_mode: pre_and_post_images

pipeline:
  processors:
    - mapping: |
        # Emit a diff-style message with before and after
        let op = meta("operation")
        root = {
          "op":     $op,
          "before": this.fullDocumentBeforeChange | null,
          "after":  this.fullDocument | this,
          "coll":   meta("collection"),
          "ts":     meta("operation_time")
        }
```

**Note**: For update and delete events in `pre_and_post_images` mode, the
message body is the raw change event document from MongoDB (with
`fullDocumentBeforeChange` and `fullDocument` fields). The mapping above
restructures it into a diff envelope.
