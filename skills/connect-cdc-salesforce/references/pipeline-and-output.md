# salesforce_cdc Pipeline Patterns, Message Shape, and Restart Semantics

Complete runnable pipelines, the full message/metadata shape, per-object topic routing with Bloblang, snapshot+stream lifecycle details, and checkpoint/restart behavior.

Grounded in:
- `internal/impl/salesforce/input_salesforce_cdc.go` — `eventToMessage()`, `salesforceCDCInputConfigSpec()` examples, lifecycle
- `internal/impl/salesforce/salesforcegrpc/types.go` — `PubSubEvent` fields
- `internal/impl/salesforce/input_salesforce_cdc_integration_test.go` — integration test patterns

---

## Message Shape

Every `salesforce_cdc` message has a **JSON payload** (from `json.Marshal(ev.RawPayload)`) and metadata fields attached via `MetaSet`.

### Payload

The payload is the full decoded Avro event from the Pub/Sub API, marshalled to JSON.

**Snapshot row** (from REST query, `operation: read`):

```json
{
  "Id": "001Dp000008KFIXIA4",
  "Name": "Acme Corp",
  "BillingCity": "San Francisco",
  "BillingCountry": "US",
  "CreatedDate": "2024-01-15T10:30:00.000+0000",
  "LastModifiedDate": "2024-06-01T08:15:00.000+0000"
}
```

**CDC streaming event** (from Pub/Sub gRPC, e.g. `operation: create`):

```json
{
  "ChangeEventHeader": {
    "entityName": "Account",
    "recordIds": ["001Dp000008KFIXIA4"],
    "changeType": "CREATE",
    "changeOrigin": "com/salesforce/api/rest/65.0",
    "transactionKey": "000abc123",
    "sequenceNumber": 1,
    "commitTimestamp": 1717228500000,
    "commitNumber": 12345678,
    "commitUser": "005Dp000003xYZEIA2",
    "nulledFields": [],
    "diffFields": [],
    "changedFields": ["Name", "BillingCity"]
  },
  "Name": "Acme Corp",
  "BillingCity": "San Francisco",
  "BillingCountry": null
}
```

For `UPDATE` events, only the changed fields are included in the payload (plus the `ChangeEventHeader`). Unchanged fields are absent (not null). This is standard Salesforce CDC behavior.

**Platform Event payload**:

```json
{
  "CreatedDate": 1717228500000,
  "CreatedById": "005Dp000003xYZEIA2",
  "Message__c": "order-12345-placed",
  "OrderId__c": "801Dp000000ABCDIA4"
}
```

Custom fields use their Salesforce API names (`__c` suffix). Salesforce Avro encoding may wrap union fields as `{"string": "value"}` — handle both shapes in Bloblang if needed.

### Metadata Fields

Set by `eventToMessage()` in `input_salesforce_cdc.go`:

| Metadata key | Set via | Condition | Value |
|---|---|---|---|
| `topic` | `setMetaIfNonEmpty` | **Streaming events only** (set in `eventToMessage`, input_salesforce_cdc.go:932) | Full Pub/Sub topic path, e.g. `/data/AccountChangeEvent` |
| `replay_id` | `msg.MetaSet` | Streaming events only (when `len(ev.ReplayID) > 0`) | Hex-encoded replay ID bytes, e.g. `"0a1b2c3d..."` |
| `operation` | `setMetaIfNonEmpty` / `msg.MetaSet` | Streaming CDC events (from `ev.ChangeType`) + snapshot rows (hardcoded `"read"` at line 671) | `"read"`, `"create"`, `"update"`, `"delete"`, `"undelete"` |
| `sobject` | `msg.MetaSet` | Streaming CDC events (`ev.EntityName`) and snapshot rows (`slot.SObjectName` in `GetNextBatchParallel`) | sObject API name, e.g. `"Account"` |
| `record_ids` | `msg.MetaSet` | Streaming CDC events only (when `len(ev.RecordIDs) > 0`) | Comma-separated record IDs, e.g. `"001Dp000008KFIXIA4"` |
| `event_uuid` | `setMetaIfNonEmpty` | Standard Platform Events only (from `ev.EventUUID`) | Salesforce `EventUuid` (canonical dedup key) |

**Notes**:
- `operation` is set to `strings.ToLower(ev.ChangeType)`. Salesforce CDC ChangeType values are `CREATE`, `UPDATE`, `DELETE`, `UNDELETE` (also gap types like `GAP_CREATE` under high load — lowercase as `gap_create`).
- `replay_id` and `topic` are only set on streaming events — **snapshot rows (`operation: read`) carry only `sobject` and `operation`**. They have no `topic`, `replay_id`, `record_ids`, or `event_uuid`.
- `event_uuid` is populated only for standard Platform Events (e.g. `LoginEventStream`). Custom Platform Events (`__e`) do not include `EventUuid` in their Avro payload.

Access metadata in Bloblang:
```
metadata("topic")       # "/data/AccountChangeEvent"
metadata("operation")   # "create"
metadata("sobject")     # "Account"
metadata("record_ids")  # "001Dp000008KFIXIA4"
metadata("replay_id")   # "0a1b2c3d..."
metadata("event_uuid")  # "" for custom Platform Events
```

---

## Pipeline 1: Snapshot + CDC for Core Objects

Snapshots existing records then streams live changes for Account, Contact, Opportunity into per-object Redpanda topics.

```yaml
# sf-cdc-core-objects.yaml
input:
  label: "sf_cdc_core"
  salesforce_cdc:
    org_url: ${SALESFORCE_ORG_URL}
    client_id: ${SALESFORCE_CLIENT_ID}
    client_secret: ${SALESFORCE_CLIENT_SECRET}
    topics:
      - Account
      - Contact
      - Opportunity
    stream_snapshot: true
    snapshot_max_batch_size: 2000
    max_parallel_snapshot_objects: 1
    replay_preset: latest
    checkpoint_cache: sf_cache
    checkpoint_cache_key: salesforce_cdc
    checkpoint_limit: 1024
    stream_batch_size: 100
    batching:
      count: 100
      period: 1s

pipeline:
  processors:
    # Route to per-sObject topic; include operation for downstream consumers
    - mapping: |
        # Route snapshot rows and CDC events to the same topic per sObject
        let sobject = metadata("sobject").lowercase()
        let op = metadata("operation")
        meta kafka_topic = "sf.cdc." + $sobject
        # Add routing metadata for downstream consumers
        meta sf_operation = $op
        meta sf_sobject = metadata("sobject")

output:
  kafka_franz:
    seed_brokers:
      - localhost:9092
    topic: ${! metadata("kafka_topic") }
    key: ${! this.Id.or(this.ChangeEventHeader.recordIds.index(0).or("")) }

cache_resources:
  - label: sf_cache
    redis:
      url: redis://localhost:6379
```

---

## Pipeline 2: CDC Firehose (All CDC-Enabled Objects)

Subscribe to every CDC-enabled sObject via the firehose — no historical snapshot. Useful when you enable CDC for many objects and want a single subscription.

```yaml
# sf-cdc-firehose.yaml
input:
  label: "sf_firehose"
  salesforce_cdc:
    org_url: ${SALESFORCE_ORG_URL}
    client_id: ${SALESFORCE_CLIENT_ID}
    client_secret: ${SALESFORCE_CLIENT_SECRET}
    topics:
      - /data/ChangeEvents        # CDC firehose — all CDC-enabled objects
    stream_snapshot: false        # no REST snapshot (firehose can cover many objects)
    replay_preset: latest
    checkpoint_cache: sf_cache
    stream_batch_size: 500

pipeline:
  processors:
    - mapping: |
        meta kafka_topic = "sf.cdc." + metadata("sobject").lowercase()

output:
  kafka_franz:
    seed_brokers:
      - localhost:9092
    topic: ${! metadata("kafka_topic") }

cache_resources:
  - label: sf_cache
    redis:
      url: redis://localhost:6379
```

**Note**: Combining `/data/ChangeEvents` (firehose) with per-sObject CDC channels in the same `topics` list is redundant — the firehose already covers all of them. Use one or the other.

---

## Pipeline 3: Mixed CDC + Platform Events

Combine Account CDC events with a custom Platform Event in a single pipeline.

```yaml
# sf-mixed-pipeline.yaml
input:
  label: "sf_mixed"
  salesforce_cdc:
    org_url: ${SALESFORCE_ORG_URL}
    client_id: ${SALESFORCE_CLIENT_ID}
    client_secret: ${SALESFORCE_CLIENT_SECRET}
    topics:
      - Account                       # CDC: /data/AccountChangeEvent
      - /event/Order_Created__e       # Platform Event
    stream_snapshot: true             # snapshots Account; skips Order_Created__e
    replay_preset: latest
    checkpoint_cache: sf_cache
    batching:
      count: 50
      period: 500ms

pipeline:
  processors:
    - mapping: |
        let topic = metadata("topic")
        # Route Platform Events to one topic, CDC events to per-sObject topics
        meta kafka_topic = if $topic.has_prefix("/event/") {
          "sf.events." + $topic.trim_prefix("/event/").lowercase()
        } else {
          "sf.cdc." + metadata("sobject").lowercase()
        }

output:
  kafka_franz:
    seed_brokers:
      - localhost:9092
    topic: ${! metadata("kafka_topic") }

cache_resources:
  - label: sf_cache
    redis:
      url: redis://localhost:6379
```

---

## Pipeline 4: Platform Events Only

Stream custom and standard Platform Events with no CDC or snapshot.

```yaml
# sf-platform-events.yaml
input:
  label: "sf_platform_events"
  salesforce_cdc:
    org_url: ${SALESFORCE_ORG_URL}
    client_id: ${SALESFORCE_CLIENT_ID}
    client_secret: ${SALESFORCE_CLIENT_SECRET}
    topics:
      - /event/Order__e
      - /event/LoginEventStream
    stream_snapshot: false           # always skipped for Platform Events
    replay_preset: latest
    checkpoint_cache: sf_cache
    checkpoint_cache_key: sf_platform_events_state
    stream_batch_size: 200

pipeline:
  processors:
    - mapping: |
        meta kafka_topic = "sf.events." + metadata("topic").trim_prefix("/event/").lowercase()

output:
  kafka_franz:
    seed_brokers:
      - localhost:9092
    topic: ${! metadata("kafka_topic") }
    key: ${! metadata("event_uuid").or("") }   # event_uuid for standard events (dedup key)

cache_resources:
  - label: sf_cache
    redis:
      url: redis://localhost:6379
```

---

## Snapshot + Stream Lifecycle (Detailed)

The connector runs two phases sequentially: **snapshot** then **streaming**. The transition is managed by `snapshot_complete` in the persisted checkpoint.

### Phase 1: REST Snapshot

Controlled by `runSnapshotIfNeeded` and `runSnapshot`:

1. Load checkpoint from cache (`loadState`). If `snapshot_complete: true`, skip to Phase 2.
2. Determine the sObjects to snapshot:
   - Per-sObject CDC topics: snapshot the listed sObjects.
   - Firehose (`/data/ChangeEvents`): snapshot all queryable sObjects (no filter).
   - Platform Event topics: always skipped.
3. Paginate each sObject via REST Query API (`/services/data/{api_version}/query`):
   - Each page is a batch of up to `snapshot_max_batch_size` records.
   - Pages are fetched in parallel up to `max_parallel_snapshot_objects`.
   - Each page is flushed through the `batching` policy and emitted with `operation: read`.
4. Acking a batch advances the `rest_cursor` in the cache. On restart, the cursor resumes from the last acked page — no full re-snapshot.
5. When all pages are done, `snapshot_complete: true` is written and Phase 2 begins.

### Phase 2: gRPC Streaming

Controlled by `runTopic` per topic (all topics run concurrently via goroutines):

1. Load the per-topic `replay_id` from cache. If present, use it to resume. If absent, use `replay_preset`.
2. Open a gRPC `Subscribe` stream on the shared `Client` connection.
3. Wait for the stream to settle (5-second settle delay after subscribe acknowledgment).
4. Pump events from the stream buffer, batch them via the `batching` policy, and emit.
5. On ack, write the latest `replay_id` for this topic to the cache.
6. On gRPC disconnect, reconnect with exponential backoff (`reconnect_base_delay` to `reconnect_max_delay`).

### Restart Behavior

| Scenario | Behavior |
|---|---|
| Restart during snapshot | Resumes from `rest_cursor` in cache — partial pages already acked are skipped |
| Restart after snapshot complete | Skips snapshot; opens all topic subscriptions from their cached `replay_id` |
| `replay_id` stale (older than retention) | Clears stale ID; reconnects from `replay_preset` |
| Cache key missing (first run) | Full snapshot (if enabled), then stream from `replay_preset` |
| In-memory cache on restart | Full re-snapshot and stream from `replay_preset` (no persistent state) |

---

## Checkpoint State Document

The connector writes a single JSON document to the cache at `checkpoint_cache_key`. Its shape (from `executorState`):

```json
{
  "snapshot_complete": false,
  "rest_cursor": {
    "slots": [
      {
        "sobject_index": 0,
        "sobject_name": "Account",
        "next_url": "/services/data/v65.0/query/01g...",
        "graphql_cursor": ""
      }
    ],
    "next_assign": 1
  },
  "topics": {
    "/data/AccountChangeEvent": "0a1b2c3d4e5f...",
    "/data/ContactChangeEvent": "deadbeef1234...",
    "/event/Order__e": "cafe9876abcd..."
  }
}
```

The real type is `salesforcehttp.Cursor` (client.go:260), serialized with a `slots` array of `ParallelSlot` objects and a `next_assign` integer — not a flat object. `rest_cursor` is tagged `omitzero` in `executorState` (input_salesforce_cdc.go:374) so it is absent from the JSON when no snapshot is in progress.

- `snapshot_complete`: `false` while snapshot is in progress; `true` when done
- `rest_cursor`: `Cursor` object with `slots` (array of per-parallel-worker pagination state) and `next_assign` (index of the next sObject to assign). Omitted (zero value) when `snapshot_complete: true`.
  - Each slot: `sobject_index` (position in the sObject list), `sobject_name`, `next_url` (REST pagination URL, empty when starting), `graphql_cursor` (GraphQL cursor, omitted if empty)
- `topics`: map of full topic path → hex-encoded `replay_id` (updated after each acked batch)

Each topic's `replay_id` is updated **independently** — a slow ack on one topic does not block others. The `checkpoint_limit` controls how many unacked batches per topic can be in-flight before backpressure is applied.

---

## Bloblang Routing Patterns

### Route by sObject (CDC events)

```bloblang
meta kafka_topic = "sf.cdc." + metadata("sobject").lowercase()
```

Produces: `sf.cdc.account`, `sf.cdc.contact`, `sf.cdc.opportunity`

### Route by operation (filter or branch)

```bloblang
# Only forward create/update — drop deletes
root = if ["create", "update"].contains(metadata("operation")) {
  this
} else {
  deleted()
}
```

### Route Platform Events vs CDC

```bloblang
let topic = metadata("topic")
meta kafka_topic = if $topic.has_prefix("/event/") {
  "sf.events." + $topic.trim_prefix("/event/").lowercase()
} else {
  "sf.cdc." + metadata("sobject").lowercase()
}
```

### Extract record ID as Kafka key

For CDC events, the record ID is in `record_ids` metadata (comma-separated) or in `ChangeEventHeader.recordIds`:

```bloblang
# From metadata (preferred — already parsed):
root = this
meta kafka_key = metadata("record_ids").split(",").index(0).or("")

# Alternatively, from the payload ChangeEventHeader:
meta kafka_key = this.ChangeEventHeader.recordIds.index(0).or(this.Id.or(""))
```

### Deduplicate Platform Events by EventUuid

```bloblang
# For standard Platform Events with event_uuid metadata:
# Set the Kafka key to event_uuid for idempotent/dedup producers.
# Note: custom __e Platform Events have an empty event_uuid (Salesforce does not
# include EventUuid in the Avro payload for custom events — integration_test.go:448-450).
# This dedup key only works reliably for standard Platform Events (e.g. LoginEventStream).
meta kafka_key = metadata("event_uuid").or("")
```

---

## Running the Pipeline

```bash
# With rpk
rpk connect run sf-cdc-core-objects.yaml

# With environment variable file
rpk connect run sf-cdc-core-objects.yaml --env-file .env

# Docker (pass env vars)
docker run --rm \
  --env-file .env \
  -v $(pwd)/sf-cdc-core-objects.yaml:/pipeline.yaml \
  docker.redpanda.com/redpandadata/connect:latest \
  run /pipeline.yaml

# Lint before running
rpk connect lint sf-cdc-core-objects.yaml
```

## Verifying the Pipeline

Check that messages are arriving in Redpanda:

```bash
# Consume CDC events from the Account topic
rpk topic consume sf.cdc.account --offset start -n 5

# Check group lag (if using a consumer group)
rpk group describe my-consumer-group

# Watch the pipeline logs (set DEBUG for verbose output)
# In YAML: logger.level: DEBUG
```
