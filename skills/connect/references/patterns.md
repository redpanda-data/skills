# Redpanda Connect: Canonical Pipeline Patterns

Ready-to-run YAML examples for the most common Connect use cases. Each example is self-contained; adapt broker addresses, topic names, and credentials for your environment.

## Pattern 1: Kafka → Kafka with Bloblang Transform

Read from a Redpanda/Kafka topic, apply a mapping, write to another topic.

```yaml
# kafka-to-kafka.yaml
input:
  redpanda:
    seed_brokers: ["localhost:9092"]
    topics: ["raw-events"]
    consumer_group: transform-pipeline
    start_offset: earliest
    auto_replay_nacks: true

pipeline:
  threads: 4   # parallel processors (one per CPU is a reasonable start)
  processors:
    - mapping: |
        root = this
        root.pipeline_id = uuid_v4()
        root.processed_at = now()
        # Uppercase the event type
        root.event_type = this.type.uppercase()
        # Cents conversion
        root.amount_cents = (this.amount_usd * 100).round().int()
        # Drop fields not needed downstream
        root.internal = deleted()

output:
  redpanda:
    seed_brokers: ["localhost:9092"]
    topic: processed-events
    key: ${! json("user_id") }
    acks: all
    compression: snappy
    max_in_flight: 256
```

Run:

```bash
rpk connect run kafka-to-kafka.yaml
```

---

## Pattern 2: Kafka → Kafka with Topic Routing (switch output)

Route messages to different topics based on their content.

```yaml
# topic-router.yaml
input:
  redpanda:
    seed_brokers: ["localhost:9092"]
    topics: ["all-events"]
    consumer_group: event-router

pipeline:
  processors:
    - mapping: |
        root = this
        root.received_at = now()

output:
  switch:
    cases:
      - check: this.type == "purchase"
        output:
          redpanda:
            seed_brokers: ["localhost:9092"]
            topic: purchases
            key: ${! json("order_id") }
      - check: this.type == "refund"
        output:
          redpanda:
            seed_brokers: ["localhost:9092"]
            topic: refunds
            key: ${! json("order_id") }
      - check: this.type.has_prefix("error_")
        output:
          redpanda:
            seed_brokers: ["localhost:9092"]
            topic: errors
      # Default case: everything else
      - output:
          redpanda:
            seed_brokers: ["localhost:9092"]
            topic: unclassified-events
```

---

## Pattern 3: HTTP Server → Kafka (Webhook Ingest)

Accept HTTP POST requests and publish each payload as a Kafka message.

```yaml
# webhook-ingest.yaml
input:
  http_server:
    address: "0.0.0.0:4195"
    path: /ingest
    allowed_verbs: [POST]
    timeout: 5s

pipeline:
  processors:
    - mapping: |
        root = this
        root.ingested_at = now()
        root.source = "webhook"

output:
  redpanda:
    seed_brokers: ["localhost:9092"]
    topic: webhook-events
    key: ${! json("id") }
    acks: all
```

Test with curl:

```bash
curl -X POST http://localhost:4195/ingest \
  -H "Content-Type: application/json" \
  -d '{"id": "evt-001", "type": "signup", "user": "alice"}'
```

---

## Pattern 4: Kafka → HTTP API (Fan-out with Retry)

Read from Kafka and POST each message to an API with retry and DLQ.

```yaml
# kafka-to-api.yaml
input:
  redpanda:
    seed_brokers: ["localhost:9092"]
    topics: ["outbound-events"]
    consumer_group: api-forwarder

pipeline:
  processors:
    - mapping: |
        root = this

output:
  fallback:
    # Primary: POST to the API
    - retry:
        max_retries: 3
        backoff:
          initial_interval: 1s
          max_interval: 10s
        output:
          http_client:
            url: https://api.example.com/events
            verb: POST
            headers:
              Content-Type: application/json
              Authorization: "Bearer ${API_TOKEN}"
            max_in_flight: 32
            timeout: 10s
    # Dead-letter queue: all retries exhausted
    - redpanda:
        seed_brokers: ["localhost:9092"]
        topic: outbound-events-dlq
        key: ${! json("id") }
```

---

## Pattern 5: Batched Write to S3

Read from Kafka, accumulate records into batches, and write JSON lines files to S3.

```yaml
# kafka-to-s3.yaml
input:
  redpanda:
    seed_brokers: ["localhost:9092"]
    topics: ["events"]
    consumer_group: s3-archiver

pipeline:
  processors:
    - mapping: 'root = this'

output:
  aws_s3:
    bucket: my-archive-bucket
    path: events/${! now().ts_format("2006/01/02/15", "UTC") }/${! uuid_v4() }.jsonl
    region: us-east-1
    batching:
      count: 1000       # flush after 1000 messages
      period: 60s       # or after 60 seconds
      processors:
        - archive:
            format: lines   # join records with newlines for JSONL
```

---

## Pattern 6: Fallback / Dead-Letter Queue

Attempt primary output; on failure route to DLQ. Disable `auto_replay_nacks` so the fallback receives failed messages.

```yaml
# dlq-pipeline.yaml
input:
  redpanda:
    seed_brokers: ["localhost:9092"]
    topics: ["source-events"]
    consumer_group: dlq-demo
    auto_replay_nacks: false  # important when using explicit fallback

output:
  fallback:
    - redpanda:
        seed_brokers: ["localhost:9092"]
        topic: destination-events
        key: ${! json("id") }
    # Fallback: write to DLQ with error annotation
    - retry:
        output:
          redpanda:
            seed_brokers: ["localhost:9092"]
            topic: destination-events-dlq
```

The `fallback_error` metadata field is set on messages that reach the fallback, containing the error string from the failed output.

---

## Pattern 7: Fan-out to Multiple Sinks

Write every message to Kafka AND to S3 simultaneously.

```yaml
# fan-out.yaml
input:
  redpanda:
    seed_brokers: ["localhost:9092"]
    topics: ["events"]
    consumer_group: fan-out-demo

output:
  broker:
    pattern: fan_out
    outputs:
      - redpanda:
          seed_brokers: ["localhost:9092"]
          topic: events-copy
      - aws_s3:
          bucket: events-backup
          path: raw/${! now().ts_format("2006/01/02", "UTC") }/${! uuid_v4() }.json
          region: us-east-1
```

---

## Pattern 8: Periodic SQL Poll → Kafka

Read rows from a database table every 5 minutes and publish to Kafka. Uses `generate` to drive the poll cycle.

```yaml
# sql-poll.yaml
input:
  generate:
    interval: '@every 5m'
    mapping: 'root = {}'
  processors:
    - sql_select:
        driver: postgres
        dsn: postgres://user:pass@localhost:5432/mydb?sslmode=disable
        table: orders
        columns: ["id", "status", "amount", "created_at"]
        where: "processed = false AND created_at > now() - interval '5 minutes'"
    - for_each:
        - mapping: |
            root = this
            root.exported_at = now()

output:
  redpanda:
    seed_brokers: ["localhost:9092"]
    topic: db-orders
    key: ${! json("id") }
```

---

## Pattern 9: Deduplication with Redis

Drop duplicate messages using a Redis cache within a 24-hour window.

```yaml
# dedup.yaml
cache_resources:
  - label: dedup_cache
    redis:
      url: redis://localhost:6379
      prefix: connect:dedup:
      default_ttl: 86400s   # 24 hours

input:
  redpanda:
    seed_brokers: ["localhost:9092"]
    topics: ["events-with-dupes"]
    consumer_group: dedup-pipeline

pipeline:
  processors:
    - dedupe:
        cache: dedup_cache
        key: ${! json("event_id") }
        drop_on_err: true

output:
  redpanda:
    seed_brokers: ["localhost:9092"]
    topic: deduped-events
```

---

## Pattern 10: Rate-Limited HTTP Egress

Read from Kafka and forward to an API, capped at 100 requests/second.

```yaml
# rate-limited-egress.yaml
rate_limit_resources:
  - label: api_ratelimit
    local:
      count: 100
      interval: 1s

input:
  redpanda:
    seed_brokers: ["localhost:9092"]
    topics: ["api-queue"]
    consumer_group: rate-limited-demo

output:
  http_client:
    url: https://api.example.com/push
    verb: POST
    rate_limit: api_ratelimit
    max_in_flight: 16
```

---

## Pattern 11: Schema Registry Encode → Kafka

Encode outbound messages as Avro before writing to Kafka.

```yaml
# avro-encode.yaml
input:
  redpanda:
    seed_brokers: ["localhost:9092"]
    topics: ["raw-json-events"]
    consumer_group: avro-encoder

pipeline:
  processors:
    - mapping: |
        root = this
    - schema_registry_encode:
        url: http://localhost:8081
        subject: processed-events-value
        avro_raw_json: false   # expect JSON structured per Avro schema

output:
  redpanda:
    seed_brokers: ["localhost:9092"]
    topic: processed-events
    key: ${! json("id") }
```

---

## Pattern 12: Windowed Aggregation with system_window Buffer

Aggregate events into 1-minute tumbling windows, then publish a summary.

```yaml
# windowed-aggregation.yaml
input:
  redpanda:
    seed_brokers: ["localhost:9092"]
    topics: ["click-events"]
    consumer_group: window-agg

buffer:
  system_window:
    timestamp_mapping: 'root = this.event_time'
    size: 1m
    slide: 1m   # tumbling window (slide == size)

pipeline:
  processors:
    - archive:
        format: json_array   # collect all window messages into a JSON array
    - mapping: |
        let events = this
        root.window_start = $events.0.event_time
        root.count = $events.length()
        root.unique_users = $events.map_each(e -> e.user_id).unique().length()
        root.total_revenue = $events.map_each(e -> e.amount).fold(0, i -> i.tally + i.value)

output:
  redpanda:
    seed_brokers: ["localhost:9092"]
    topic: click-summaries
```

---

## Pattern 13: Using the Global `redpanda` Block (TLS + SASL once)

Configure TLS and SASL credentials once and share across all inputs/outputs.

```yaml
# global-block.yaml
redpanda:
  seed_brokers: ["seed-abc123.cloud.redpanda.com:9092"]
  tls:
    enabled: true
  sasl:
    - mechanism: SCRAM-SHA-512
      username: ${REDPANDA_USERNAME}
      password: ${REDPANDA_PASSWORD}

input:
  redpanda:
    # seed_brokers omitted — uses global redpanda block
    topics: ["source"]
    consumer_group: my-group

output:
  redpanda:
    # seed_brokers omitted — uses global redpanda block
    topic: sink
    key: ${! json("id") }
```

Run with env vars:

```bash
REDPANDA_USERNAME=myuser REDPANDA_PASSWORD=secret rpk connect run global-block.yaml
# or
rpk connect run --env-file .env global-block.yaml
```
