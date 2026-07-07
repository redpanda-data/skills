# Redpanda Connect: Component Model & Discovery

Redpanda Connect has hundreds of built-in components. This reference explains the component model, lists the most commonly used members of each type, and shows how to discover and read any component's full config schema.

## Component Types

| Type | Role |
|---|---|
| **input** | Read data from a source (Kafka, HTTP, file, database, cloud queue, …) |
| **processor** | Transform, filter, or enrich messages |
| **output** | Write data to a sink (Kafka, HTTP, file, database, cloud storage, …) |
| **cache** | Key-value store used by processors (dedupe, cache, etc.) |
| **rate_limit** | Throttle output rate |
| **buffer** | Decouple input from output with a durable or in-memory queue |
| **metrics** | Export telemetry (Prometheus, statsd, JSON API) |
| **tracer** | Distributed tracing (OpenTelemetry, Jaeger, GCP Cloud Trace) |
| **scanner** | Parse streamed bytes into structured records (csv, lines, json, avro, parquet, …) |

## Discovering Components

```bash
# List all available components of a type
rpk connect list inputs
rpk connect list outputs
rpk connect list processors
rpk connect list caches
rpk connect list rate-limits
rpk connect list buffers
rpk connect list scanners
rpk connect list metrics

# Print the full YAML config template for a component (shows all fields + defaults)
rpk connect create redpanda              # redpanda input template
rpk connect create //redpanda           # redpanda output template (empty input/processors)
rpk connect create stdin/mapping/stdout # pipeline with mapping processor
rpk connect create /mapping/            # mapping processor template only
```

Online docs: https://docs.redpanda.com/redpanda-connect

## Inputs

### `redpanda` (stable)

Kafka-compatible input using the Franz Kafka client. Preferred for Redpanda clusters.

```yaml
input:
  redpanda:
    seed_brokers: ["localhost:9092"]   # or omit to use global redpanda block
    topics: ["events", "orders"]
    regexp_topics_include: ["logs_.*"] # mutually exclusive with topics
    regexp_topics_exclude: ["logs_archive_.*"]
    consumer_group: my-group
    start_offset: earliest             # earliest | latest | committed
    transaction_isolation_level: read_uncommitted  # read_uncommitted | read_committed
    commit_period: 5s
    auto_replay_nacks: true
    tls:
      enabled: false
    sasl:
      - mechanism: SCRAM-SHA-512
        username: user
        password: pass
```

Metadata added to each message: `kafka_key`, `kafka_topic`, `kafka_partition`, `kafka_offset`, `kafka_lag`, `kafka_timestamp_ms`, `kafka_timestamp_unix`, `kafka_tombstone_message`, plus all record headers.

### `generate` (stable)

Generates messages from a Bloblang mapping on a schedule. Useful for testing, periodic polling, and cron-style pipelines.

```yaml
input:
  generate:
    mapping: 'root = {"id": uuid_v4(), "ts": now()}'
    interval: 1s    # duration or cron expr: '@every 5m', '0 */5 * * * *'
    count: 0        # 0 = unlimited
    batch_size: 1
```

### `http_server` (stable)

Receives messages POSTed over HTTP(S).

```yaml
input:
  http_server:
    address: ""          # listen address (e.g. 0.0.0.0:4195); empty uses global HTTP server
    path: /post
    allowed_verbs: [POST]
    timeout: 5s
    rate_limit: ""       # label of a rate_limit resource
```

### `http_client` (stable)

Polls an HTTP endpoint and emits the response as messages.

```yaml
input:
  http_client:
    url: https://api.example.com/events
    verb: GET
    rate_limit: ""
    payload: ""
```

### `file` (stable)

Reads from one or more files.

```yaml
input:
  file:
    paths: ["/data/*.jsonl"]
    scanner:
      lines: {}
    delete_on_finish: false
```

### `aws_s3` (stable)

Reads objects from an S3 bucket.

```yaml
input:
  aws_s3:
    bucket: my-bucket
    prefix: events/
    region: us-east-1
    scanner:
      lines: {}
```

### `aws_sqs` (stable)

Reads messages from an SQS queue.

```yaml
input:
  aws_sqs:
    url: https://sqs.us-east-1.amazonaws.com/123456789/my-queue
    region: us-east-1
```

### `aws_kinesis` (stable)

Reads records from Kinesis data streams.

```yaml
input:
  aws_kinesis:
    streams: ["my-stream"]
    region: us-east-1
    dynamodb:
      table: kinesis_checkpoints
      create: true
```

### `gcp_pubsub` (stable)

Subscribes to a GCP Pub/Sub subscription.

```yaml
input:
  gcp_pubsub:
    project: my-project
    subscription: my-subscription
```

### `gcp_cloud_storage` (stable)

Reads objects from a GCS bucket.

```yaml
input:
  gcp_cloud_storage:
    bucket: my-bucket
    prefix: ""
```

### `sql_select` (stable)

Runs a SQL SELECT periodically.

```yaml
input:
  sql_select:
    driver: postgres
    dsn: postgres://user:pass@localhost:5432/db?sslmode=disable
    table: events
    columns: ["*"]
    where: "processed = false"
```

### Broker (fan-in) Input

Combine multiple inputs using the `broker` pattern:

```yaml
input:
  broker:
    inputs:
      - redpanda:
          seed_brokers: ["broker1:9092"]
          topics: ["topic-a"]
      - aws_sqs:
          url: https://sqs.us-east-1.amazonaws.com/123/my-queue
```

## Processors

### `mapping` (stable, preferred) / `bloblang` (stable, legacy name)

Apply a Bloblang mapping to create a new output document.

```yaml
pipeline:
  processors:
    - mapping: |
        root = this
        root.id = uuid_v4()
        root.processed_at = now()
        root.amount_cents = (this.amount * 100).round()
```

### `mutation` (stable)

Apply a Bloblang mapping that mutates the message in-place. More efficient than `mapping` when you only change a few fields.

```yaml
pipeline:
  processors:
    - mutation: |
        root.ts = now()
        root.internal_field = deleted()
```

### `branch` (stable)

Fork a message to a sub-pipeline, then merge the result back.

```yaml
pipeline:
  processors:
    - branch:
        request_map: |
          root = {"text": this.body}
        processors:
          - http_client:
              url: https://api.example.com/analyze
              verb: POST
        result_map: |
          root.sentiment = this.score
```

### `try` / `catch` (stable)

Handle processor errors:

```yaml
pipeline:
  processors:
    - try:
        - mapping: 'root = this.body.parse_json()'
    - catch:
        - mapping: |
            root.parse_error = error()
            root.raw = content().string()
```

### `for_each` (stable)

Apply processors to each element of an array:

```yaml
pipeline:
  processors:
    - for_each:
        - mapping: 'root.value = this.value * 2'
```

### `dedupe` (stable)

Drop duplicate messages using a cache:

```yaml
pipeline:
  processors:
    - dedupe:
        cache: dedup_cache
        key: ${! json("id") }
        drop_on_err: true

cache_resources:
  - label: dedup_cache
    redis:
      url: redis://localhost:6379
      default_ttl: 24h
```

### `schema_registry_encode` / `schema_registry_decode`

Encode/decode Avro or Protobuf with a Schema Registry:

```yaml
pipeline:
  processors:
    - schema_registry_encode:
        url: http://localhost:8081
        subject: my-topic-value
        avro_raw_json: false
```

### `cache` (stable)

Read or write to a named cache resource:

```yaml
pipeline:
  processors:
    - cache:
        resource: my_cache
        operator: set
        key: ${! json("id") }
        value: ${! content() }
```

### `sql_insert` / `sql_raw` (stable)

Write to or query a SQL database:

```yaml
pipeline:
  processors:
    - sql_insert:
        driver: postgres
        dsn: postgres://user:pass@localhost:5432/db
        table: events
        columns: [id, payload, created_at]
        args_mapping: 'root = [this.id, this.payload, now()]'
```

### `compress` / `decompress` (stable)

```yaml
pipeline:
  processors:
    - compress:
        algorithm: gzip   # gzip | pgzip | zlib | flate | snappy | lz4
```

### `rate_limit` (stable)

Throttle processing:

```yaml
pipeline:
  processors:
    - rate_limit:
        resource: api_limit

rate_limit_resources:
  - label: api_limit
    local:
      count: 100
      interval: 1s
```

## Outputs

### `redpanda` (stable)

Kafka-compatible output using Franz. Preferred for Redpanda clusters.

```yaml
output:
  redpanda:
    seed_brokers: ["localhost:9092"]
    topic: output-events            # supports Bloblang: ${! meta("kafka_topic") }
    key: ${! json("id") }
    max_in_flight: 256
    batching:
      count: 0
      byte_size: 0
      period: ""
    tls:
      enabled: false
    sasl:
      - mechanism: SCRAM-SHA-512
        username: user
        password: pass
    acks: all                       # all | leader | none
    compression: snappy             # lz4 | snappy | gzip | none | zstd
    idempotent_write: true
    max_message_bytes: 1MiB
```

### `http_client` (stable)

POST messages to an HTTP endpoint.

```yaml
output:
  http_client:
    url: https://api.example.com/ingest
    verb: POST
    headers:
      Content-Type: application/json
    rate_limit: ""
    max_in_flight: 64
    batching:
      count: 100
      period: 1s
```

### `file` (stable)

Write messages to files.

```yaml
output:
  file:
    path: /data/output-${! count("files") }.jsonl
    codec: lines
```

### `broker` (fan-out) output

Write to multiple outputs simultaneously (fan_out) or round-robin:

```yaml
output:
  broker:
    pattern: fan_out   # fan_out | round_robin | greedy | fan_out_sequential
    outputs:
      - redpanda:
          seed_brokers: ["localhost:9092"]
          topic: main-topic
      - aws_s3:
          bucket: backup-bucket
          path: events/${! now().ts_format("2006/01/02/15", "UTC") }/${! uuid_v4() }.json
```

### `fallback` output

Try outputs in sequence; use the next if the previous fails:

```yaml
output:
  fallback:
    - redpanda:
        seed_brokers: ["localhost:9092"]
        topic: events
    - retry:
        output:
          redpanda:
            seed_brokers: ["localhost:9092"]
            topic: events-dlq
```

### `switch` output

Route messages to different outputs based on a condition:

```yaml
output:
  switch:
    cases:
      - check: this.type == "order"
        output:
          redpanda:
            seed_brokers: ["localhost:9092"]
            topic: orders
      - check: this.type == "payment"
        output:
          redpanda:
            seed_brokers: ["localhost:9092"]
            topic: payments
      - output:
          redpanda:
            seed_brokers: ["localhost:9092"]
            topic: unknown-events
```

### `drop` (stable)

Silently discard all messages (useful in development or with switch):

```yaml
output:
  drop: {}
```

### `cache` output

Write messages into a named cache:

```yaml
output:
  cache:
    target: my_cache
    key: ${! json("id") }
```

## Caches

Used by `dedupe`, `cache` processor, `cache` output, and CDC inputs for checkpoints.

```yaml
cache_resources:
  # In-memory (not persistent)
  - label: mem_cache
    memory:
      default_ttl: 300s
      compaction_interval: 60s

  # Redis
  - label: redis_cache
    redis:
      url: redis://localhost:6379
      prefix: connect:
      default_ttl: 3600s

  # LRU (in-memory with eviction; no TTL field — eviction is by capacity)
  - label: lru_cache
    lru:
      cap: 1000

  # Ristretto (high-performance in-memory)
  - label: ristretto_cache
    ristretto:
      default_ttl: 300s

  # SQL
  - label: sql_cache
    sql:
      driver: postgres
      dsn: postgres://user:pass@localhost/db
      table: cache_table
      key_column: cache_key
      value_column: cache_value
      ttl_column: expiry

  # File
  - label: file_cache
    file:
      directory: /var/lib/connect/cache
```

## Enterprise vs Community Components

Community (open-source) components are available without a license. Enterprise components require a Redpanda license.

**Enterprise-only inputs (require license):**
- `postgres_cdc`, `mysql_cdc`, `mongodb_cdc`, `microsoft_sql_server_cdc`, `oracledb_cdc`, `gcp_spanner_cdc`, `aws_dynamodb_cdc`, `salesforce_cdc`

Note: `tigerbeetle_cdc` is also a CDC input but is **not** enterprise — it is a certified community component (Apache-licensed, no license check in its implementation). It requires a CGO-enabled Connect build; the `rpk connect` managed plugin and the standard Docker image do not include it.

**AI/ML processors (certified — no license gate, despite earlier versions of this file calling them enterprise):**
`openai_chat_completion`, `openai_embeddings`, `openai_image_generation`, `openai_speech`, `openai_transcription`, `openai_translation`, `aws_bedrock_chat`, `aws_bedrock_embeddings`, `cohere_chat`, `cohere_embeddings`, `cohere_rerank`, `gcp_vertex_ai_chat`, `gcp_vertex_ai_embeddings`, `ollama_chat`, `ollama_embeddings`, `ollama_moderation` — all marked `certified` in the component catalog at v4.99.0, Apache-2.0 source, no runtime license check.

The complete enterprise-tier list (Snowflake, BigQuery write, Iceberg, Splunk, OTLP, Slack, Google Drive, Salesforce families plus the CDC inputs) with tier caveats is in [Connector Catalog](connector-catalog.md). For the nested config of the CDC inputs, plus allow/deny lists, secrets management, FIPS, and the configuration service, see [Enterprise Features](enterprise.md).

**License supply:**
```bash
# CLI flag
redpanda-connect run --redpanda-license "YOUR_LICENSE" config.yaml

# Environment variable
export REDPANDA_LICENSE="YOUR_LICENSE"

# File (auto-detected)
# /etc/redpanda/redpanda.license

# REDPANDA_LICENSE_FILEPATH env var
export REDPANDA_LICENSE_FILEPATH=/path/to/license.txt
```

Precedence: `--redpanda-license` flag overrides `REDPANDA_LICENSE` / `REDPANDA_LICENSE_FILEPATH` env vars; the default file `/etc/redpanda/redpanda.license` is applied automatically if present. Enterprise connectors are blocked after the 30-day trial expires without a valid license.

License errors appear at startup with a message along the lines of: `this feature requires a valid Redpanda Enterprise Edition license that includes the Connect product. For more information check out: https://docs.redpanda.com/redpanda-connect/get-started/licensing/`.
