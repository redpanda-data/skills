# TigerBeetle CDC: Pipelines, Message Shape, and Output Patterns

---

## Message shape

Every message produced by `tigerbeetle_cdc` is a JSON object containing the event timestamp, the event type, the ledger, and full snapshots of the **transfer** and both the **debit and credit accounts** at the time of the event. Unlike row-based CDC connectors there are no insert/update/delete diff semantics — every event type is a transfer lifecycle event, and each event carries complete state (no `before`/`after` images to reconcile).

Number encoding: 128-bit and 64-bit unsigned fields (`id`, `amount`, `pending_id`, `user_data_128`, `user_data_64`, `debits_*`, `credits_*`, `timestamp`) are serialized as base-10 **strings** to avoid JSON precision loss; 32-bit and 16-bit fields (`user_data_32`, `timeout`, `code`, `flags`, `ledger`) are JSON numbers.

```json
{
  "timestamp": "1745328372758695656",
  "type": "single_phase",
  "ledger": 2,
  "transfer": {
    "id": "9082709",
    "amount": "3794",
    "pending_id": "0",
    "user_data_128": "79248595801719937611592367840129079151",
    "user_data_64": "13615171707598273871",
    "user_data_32": 3229992513,
    "timeout": 0,
    "code": 20295,
    "flags": 0,
    "timestamp": "1745328372758695656"
  },
  "debit_account": {
    "id": "3750",
    "debits_pending": "0",
    "debits_posted": "8463768",
    "credits_pending": "0",
    "credits_posted": "8861179",
    "user_data_128": "118966247877720884212341541320399553321",
    "user_data_64": "526432537153007844",
    "user_data_32": 4157247332,
    "code": 1,
    "flags": 0,
    "timestamp": "1745328270103398016"
  },
  "credit_account": {
    "id": "6765",
    "debits_pending": "0",
    "debits_posted": "8669204",
    "credits_pending": "0",
    "credits_posted": "8637251",
    "user_data_128": "43670023860556310170878798978091998141",
    "user_data_64": "12485093662256535374",
    "user_data_32": 1924162092,
    "code": 1,
    "flags": 0,
    "timestamp": "1745328270103401031"
  }
}
```

The top-level `timestamp` (and the metadata `timestamp`) is the unique event timestamp with nanosecond resolution. `transfer.timestamp` and each account's `timestamp` are the TigerBeetle timestamps of those objects (they generally differ from the event timestamp, as in the sample above).

### Event types

The top-level `type` field (and the `event_type` metadata) is one of:

| Event type | Meaning |
|---|---|
| `single_phase` | A transfer settled immediately (single-phase) |
| `two_phase_pending` | A two-phase transfer was created and is pending |
| `two_phase_posted` | A pending two-phase transfer was posted (settled) |
| `two_phase_voided` | A pending two-phase transfer was voided |
| `two_phase_expired` | A pending two-phase transfer expired without being posted |

Settled money movement = `single_phase` + `two_phase_posted`. The other two-phase states reserve or release funds without final settlement.

---

## Metadata fields

Every message carries all of these keys (unlike some CDC inputs, none are conditionally absent). All values are set as strings:

| Metadata key | Value |
|---|---|
| `event_type` | `single_phase`, `two_phase_pending`, `two_phase_posted`, `two_phase_voided`, `two_phase_expired` |
| `ledger` | Ledger code |
| `transfer_code` | Transfer code |
| `debit_account_code` | Debit account code |
| `credit_account_code` | Credit account code |
| `timestamp` | Event timestamp, nanosecond resolution (unique per event) |
| `timestamp_ms` | Event timestamp, millisecond resolution |

Access in Bloblang with `meta("event_type")`, etc. Because metadata values are strings, compare against string literals (`meta("ledger") == "2"`) or coerce with `.number()`.

---

## Basic capture pipeline

Capture all events, hoist key metadata into the payload, and print:

```yaml
input:
  tigerbeetle_cdc:
    cluster_id: ${TB_CLUSTER_ID}
    addresses:
      - ${TB_REPLICA_1}
      - ${TB_REPLICA_2}
      - ${TB_REPLICA_3}
    progress_cache: redis_cache

pipeline:
  processors:
    - mapping: |
        root.event_type = meta("event_type")
        root.ledger = meta("ledger")
        root.transfer_code = meta("transfer_code")
        root.timestamp_ms = meta("timestamp_ms")
        root.transfer = this.transfer
        root.debit_account = this.debit_account
        root.credit_account = this.credit_account

output:
  stdout:
    codec: lines

cache_resources:
  - label: redis_cache
    redis:
      url: ${REDIS_URL}
```

---

## Filter to settled transfers only

Keep `single_phase` and `two_phase_posted`; drop pending, voided, and expired events; flatten to the key transfer fields:

```yaml
pipeline:
  processors:
    - mapping: |
        root = if meta("event_type") != "single_phase" && meta("event_type") != "two_phase_posted" {
          deleted()
        }
    - mapping: |
        root.event_type = meta("event_type")
        root.ledger = meta("ledger")
        root.transfer_id = this.transfer.id
        root.amount = this.transfer.amount
        root.debit_account_id = this.debit_account.id
        root.credit_account_id = this.credit_account.id
        root.timestamp_ms = meta("timestamp_ms")
```

---

## Route to Redpanda, one topic per ledger

Creates topics like `transfers.1`, `transfers.2`; keys messages by transfer ID so all events for a transfer land in one partition:

```yaml
input:
  tigerbeetle_cdc:
    cluster_id: ${TB_CLUSTER_ID}
    addresses:
      - ${TB_REPLICA_1}
      - ${TB_REPLICA_2}
      - ${TB_REPLICA_3}
    progress_cache: redis_cache

pipeline:
  processors:
    - mapping: |
        meta topic = "transfers." + meta("ledger")

output:
  redpanda:
    seed_brokers:
      - ${REDPANDA_BROKERS}
    topic: ${! meta("topic") }
    key: ${! json("transfer.id") }
    batching:
      count: 100
      period: 1s

cache_resources:
  - label: redis_cache
    redis:
      url: ${REDIS_URL}
```

---

## Route by event type (settlement model)

```yaml
output:
  switch:
    cases:
      - check: meta("event_type") == "single_phase"
        output:
          redpanda:
            seed_brokers:
              - ${REDPANDA_BROKERS}
            topic: tigerbeetle.single_phase
      - check: meta("event_type") == "two_phase_posted"
        output:
          redpanda:
            seed_brokers:
              - ${REDPANDA_BROKERS}
            topic: tigerbeetle.two_phase
      - output:
          drop: {}
```

Unsettled two-phase events (`two_phase_pending`, `two_phase_voided`, `two_phase_expired`) fall through to `drop`.

---

## Archive to S3 (time-partitioned NDJSON)

```yaml
pipeline:
  processors:
    - mapping: |
        root.event_type = meta("event_type")
        root.ledger = meta("ledger")
        root.transfer = this.transfer
        root.debit_account = this.debit_account
        root.credit_account = this.credit_account
        root.timestamp_ms = meta("timestamp_ms")

output:
  aws_s3:
    bucket: ${S3_BUCKET}
    path: >-
      cdc/ledger/${! meta("ledger") }/${! timestamp_unix().format_timestamp("2006/01/02/15") }/${! uuid_v4() }.ndjson
    batching:
      count: 1000
      period: 5m
      processors:
        - archive:
            format: lines
```

Files are organized by ledger and year/month/day/hour, with UUID names to prevent collisions.

---

## Resume from a specific timestamp

By default the input streams **all** events available in the cluster. To start from a point in time, set `timestamp_initial` to a TigerBeetle nanosecond timestamp:

```yaml
input:
  tigerbeetle_cdc:
    cluster_id: ${TB_CLUSTER_ID}
    addresses:
      - ${TB_REPLICA_1}
      - ${TB_REPLICA_2}
      - ${TB_REPLICA_3}
    progress_cache: redis_cache
    timestamp_initial: "1745328372758695656"   # inclusive

cache_resources:
  - label: redis_cache
    redis:
      url: ${REDIS_URL}
```

`timestamp_initial` is ignored if `progress_cache` already contains a more recent acknowledged timestamp — it never rewinds a checkpointed pipeline. To rewind, delete the cache key `timestamp_last_<cluster_id>` first.

---

## Throttling requests with a rate limit

`rate_limit` throttles **requests** to TigerBeetle (each request fetches up to `event_count_max` events):

```yaml
input:
  tigerbeetle_cdc:
    cluster_id: ${TB_CLUSTER_ID}
    addresses: ["${TB_REPLICA_1}"]
    progress_cache: redis_cache
    rate_limit: tb_limit
    event_count_max: 1000

rate_limit_resources:
  - label: tb_limit
    local:
      count: 10
      interval: 1s
```

---

## Ordering, acknowledgment, and restart behavior

From source:

1. The producer queries TigerBeetle for up to `event_count_max` events after the last checkpointed timestamp (each query bounded by `timeout_seconds`).
2. If no events are returned, it idles `idle_interval_ms` and retries.
3. Returned events are serialized into one message batch. **Only one batch is in flight at a time** — the next query's results wait until the current batch is acknowledged by the output.
4. On acknowledgment, the batch's last event timestamp is written to `progress_cache` (`timestamp_last_<cluster_id>`).

Consequences:

- **Strict ordering** into the pipeline: events are delivered in ascending timestamp order (the connector queries by ascending timestamp and the event timestamp is unique per event). Preserve ordering downstream by keying appropriately (e.g., one partition, or per-transfer keys when per-key ordering suffices).
- **Restart:** replays any events delivered after the last acknowledged batch (at-least-once). Deduplicate on the `timestamp` metadata field if downstream requires exactly-once effects.
- **Backpressure:** with `auto_replay_nacks: true` (default), persistent output rejection blocks progress and the checkpoint does not advance.

---

## Connecting to Redpanda Cloud

```yaml
output:
  redpanda:
    seed_brokers: ["${REDPANDA_BROKERS}"]
    tls:
      enabled: true
    sasl:
      - mechanism: SCRAM-SHA-256
        username: ${REDPANDA_USER}
        password: ${REDPANDA_PASSWORD}
    topic: tigerbeetle-cdc
```

Note the pipeline itself must run on a cgo-enabled **self-hosted** Connect binary: `tigerbeetle_cdc` is not available in the standard builds, and `internal/plugins/info.csv` marks it `cloud: n` ("not yet certified for cloud"), so it cannot run as a Redpanda Cloud managed pipeline. Writing **to** a Cloud cluster from a self-hosted pipeline, as above, works normally.
