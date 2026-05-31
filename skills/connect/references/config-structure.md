# Redpanda Connect: Config Structure & Running Pipelines

Redpanda Connect uses a single YAML file to declare an entire streaming pipeline. The file is divided into named top-level sections — the engine reads them in order to configure every aspect of the pipeline before starting.

## Top-Level Keys

```yaml
# ── Required ──────────────────────────────────────────────
input:
  <component_type>:
    <field>: <value>

output:
  <component_type>:
    <field>: <value>

# ── Optional: processing ──────────────────────────────────
pipeline:
  threads: 1              # number of parallel processor threads (default 1)
  processors:
    - mapping: "root = this"
    - <processor_type>:
        <field>: <value>

# ── Optional: observability ───────────────────────────────
logger:
  level: INFO             # OFF FATAL ERROR WARN INFO DEBUG TRACE ALL NONE
  format: logfmt          # logfmt | json
  add_timestamp: true
  static_fields:
    '@service': redpanda-connect
  file:
    path: ""              # write logs to a file (empty = stdout)
    rotate: false
    rotate_max_age_days: 0

metrics:
  prometheus: {}          # or: statsd / json_api / none
  mapping: ""             # optional Bloblang filter/rename on metric names

tracer:
  none: {}                # or: open_telemetry_collector / jaeger / gcp_cloudtrace

# ── Optional: buffering ───────────────────────────────────
buffer:
  none: {}                # or: memory / sqlite / system_window

# ── Optional: named resources ─────────────────────────────
cache_resources:
  - label: my_cache
    memory:
      default_ttl: 60s

rate_limit_resources:
  - label: my_rate_limit
    local:
      count: 100
      interval: 1s

input_resources:
  - label: my_input
    redpanda:
      seed_brokers: ["localhost:9092"]
      topics: ["source-topic"]

output_resources:
  - label: my_output
    redpanda:
      seed_brokers: ["localhost:9092"]
      topic: sink-topic

processor_resources:
  - label: my_processor
    mapping: "root = this"

# ── Global Redpanda connection block ─────────────────────
# Shared by redpanda input/output when seed_brokers is omitted.
redpanda:
  seed_brokers:                 # required if used
    - "127.0.0.1:9092"
  client_id: redpanda-connect
  tls:
    enabled: false
    skip_cert_verify: false
    enable_renegotiation: false
    root_cas: ""
    root_cas_file: ""
    client_certs: []
  sasl: []                      # see sasl section below
  pipeline_id: ""
  logs_topic: ""                # emit Connect logs to this topic
  logs_level: info
  status_topic: ""
  # … plus all producer tuning fields (acks, compression, max_message_bytes, etc.)
```

## The `redpanda` Global Block

The `redpanda` top-level block lets you configure TLS, SASL, and broker addresses once, shared by any `redpanda` input or output that omits its own `seed_brokers`. This keeps credentials in one place.

```yaml
redpanda:
  seed_brokers: ["seed-abc.cloud.redpanda.com:9092"]
  tls:
    enabled: true
  sasl:
    - mechanism: SCRAM-SHA-512
      username: myuser
      password: ${REDPANDA_PASSWORD}   # env-var interpolation

input:
  redpanda:
    # seed_brokers omitted — uses global redpanda block
    topics: ["events"]
    consumer_group: my-group

output:
  redpanda:
    topic: processed-events
    key: ${! json("id") }
```

## Environment Variable Interpolation

Reference any environment variable with `${VAR_NAME}` in string fields. Provide a default with `${VAR_NAME:default_value}`. Use Bloblang expressions with `${! bloblang_expr }`.

```yaml
output:
  redpanda:
    topic: ${TOPIC_NAME:events}
    key: ${! json("user_id") }
```

## Running a Pipeline

### rpk connect (recommended)

```bash
# Run a config file
rpk connect run my-pipeline.yaml

# Override specific fields with -s (dot-path notation)
rpk connect run -s input.redpanda.seed_brokers='["broker:9092"]' my-pipeline.yaml

# Load environment variables from a .env file (-e is the alias)
rpk connect run --env-file .env my-pipeline.yaml
rpk connect run -e staging.env my-pipeline.yaml

# Set the binary name (for logging)
rpk connect run my-pipeline.yaml
```

### redpanda-connect binary

```bash
redpanda-connect run my-pipeline.yaml
redpanda-connect run --env-file .env my-pipeline.yaml

# Enterprise: supply license inline
redpanda-connect run --redpanda-license "YOUR_LICENSE_KEY" my-pipeline.yaml
# Or via environment variable
REDPANDA_LICENSE="YOUR_LICENSE_KEY" redpanda-connect run my-pipeline.yaml
# Or via file (default path checked automatically)
# /etc/redpanda/redpanda.license
```

### Docker

```bash
docker run --rm \
  -v $(pwd)/my-pipeline.yaml:/my-pipeline.yaml \
  -e REDPANDA_PASSWORD=secret \
  docker.redpanda.com/redpandadata/connect:latest \
  run /my-pipeline.yaml
```

### Default Config File Search Paths

If no config file is provided on the command line, Connect searches these paths in order:

1. `redpanda-connect.yaml`
2. `/redpanda-connect.yaml`
3. `/etc/redpanda-connect/config.yaml`
4. `/etc/redpanda-connect.yaml`
5. `connect.yaml`
6. `/connect.yaml`
7. `/etc/connect/config.yaml`
8. `/etc/connect.yaml`
9. `/benthos.yaml` (legacy compat)
10. `/etc/benthos/config.yaml` (legacy compat)
11. `/etc/benthos.yaml` (legacy compat)

## Lint & Validate Before Deploying

```bash
# Lint: check YAML structure, unknown fields, type errors
rpk connect lint my-pipeline.yaml

# Also flag deprecated fields
rpk connect lint --deprecated my-pipeline.yaml

# Also flag components missing labels
rpk connect lint --labels my-pipeline.yaml

# Don't error on env vars that have no default and aren't set
rpk connect lint --skip-env-var-check my-pipeline.yaml

# Dry-run: parse + test connections without processing data
# Exits 1 if any connection error is detected
rpk connect dry-run my-pipeline.yaml
rpk connect dry-run --verbose my-pipeline.yaml

# Dry-run against a whole directory of resource configs
rpk connect dry-run ./pipeline-dir/
```

## Named Resources and Labels

Labels appear in logs and metrics. Named resources allow inputs/outputs/caches to be defined once and referenced by name:

```yaml
cache_resources:
  - label: dedup_cache
    redis:
      url: redis://localhost:6379

pipeline:
  processors:
    - dedupe:
        cache: dedup_cache   # references label above
        key: ${! json("id") }

rate_limit_resources:
  - label: api_limit
    local:
      count: 10
      interval: 1s

output:
  http_client:
    url: https://api.example.com/events
    rate_limit: api_limit    # references label above
```

## Logger Configuration

```yaml
logger:
  level: DEBUG          # OFF FATAL ERROR WARN INFO DEBUG TRACE ALL NONE
  format: json          # logfmt (default) | json
  add_timestamp: true
  static_fields:
    '@service': redpanda-connect
    environment: production
  file:
    path: /var/log/connect.log
    rotate: true
    rotate_max_age_days: 7
```

## Metrics Configuration

```yaml
# Prometheus (scrape at /metrics and /stats)
metrics:
  prometheus:
    use_histogram_timing: false
    add_process_metrics: false
    add_go_metrics: false
    # Push to Prometheus Pushgateway
    push_url: "http://pushgateway:9091"
    push_interval: 30s
    push_job_name: my-pipeline

# Statsd
metrics:
  statsd:
    address: localhost:8125
    tag_format: datadog

# JSON API (GET /stats returns JSON)
metrics:
  json_api: {}

# Disable metrics entirely
metrics:
  none: {}
```

## Buffers

Buffers add a layer between input and processors/output, useful for absorbing bursts or enabling windowed aggregation:

```yaml
# In-memory buffer (not durable — data lost on crash)
buffer:
  memory:
    limit: 524288000   # 500MB

# SQLite buffer (durable, survives restarts)
buffer:
  sqlite:
    path: /var/lib/connect/buffer.db

# System window (aggregate by time window)
buffer:
  system_window:
    timestamp_mapping: 'root = this.event_time'
    size: 1h
    slide: 15m
```
