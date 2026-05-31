# Logging, Metrics, and Tracing

Observability configuration for Redpanda Connect pipelines. All content is
grounded in the following source files:
- `connect/docs/modules/components/pages/logger/about.adoc`
- `connect/docs/modules/components/pages/metrics/prometheus.adoc`
- `connect/docs/modules/components/pages/metrics/statsd.adoc`
- `connect/docs/modules/components/pages/metrics/json_api.adoc`
- `connect/docs/modules/components/pages/metrics/logger.adoc`
- `connect/docs/modules/components/pages/tracers/open_telemetry_collector.adoc`
- `connect/docs/modules/components/pages/http/about.adoc`

---

## Logger

Logs go to **stdout** (or **stderr** when the output component is stdout).
The logger is configured under the top-level `logger:` key.

### Full schema (all fields with defaults)

```yaml
logger:
  level: INFO              # log level threshold
  format: logfmt           # logfmt or json
  add_timestamp: true      # include timestamp field
  level_name: level        # JSON key name for level (when format: json)
  timestamp_name: time     # JSON key name for timestamp (when format: json)
  message_name: msg        # JSON key name for message (when format: json)
  static_fields:
    '@service': redpanda-connect   # key/value pairs added to every log line
  file:
    path: ""               # write to this file path (disabled when empty)
    rotate: false          # rotate log files automatically
    rotate_max_age_days: 0 # delete rotated logs older than N days (0 = never)
```

### Log levels

The available options (grounded in `docs/modules/components/pages/logger/about.adoc`)
are: `OFF`, `FATAL`, `ERROR`, `WARN`, `INFO`, `DEBUG`, `TRACE`, `ALL`, `NONE`.

Ordered from most to least verbose (per-level descriptions are guidance
based on typical Connect behavior, not definitions in the source):

| Level | Typical usage |
|-------|---------------|
| `ALL` / `TRACE` | Very fine-grained; metric path renaming, Bloblang execution detail |
| `DEBUG` | Per-message events, connection attempts, retry details |
| `INFO` | **(default)** Component starts/stops, connection established |
| `WARN` | Recoverable issues; reconnecting, retry exhausted but continuing |
| `ERROR` | Non-fatal errors; message processing failed, output rejected |
| `FATAL` | Unrecoverable error; process will exit |
| `OFF` / `NONE` | Disable all logging |

### Overriding level on the CLI

```bash
rpk connect run --log.level DEBUG ./pipeline.yaml
rpk connect run --log.level TRACE ./pipeline.yaml
```

### Logfmt vs JSON

**logfmt** (default, human-readable):
```
time=2026-05-30T10:00:00Z level=info msg="Starting component" label=my_kafka
```

**json** (structured, suitable for log aggregation pipelines):
```json
{"time":"2026-05-30T10:00:00Z","level":"info","msg":"Starting component","label":"my_kafka","@service":"redpanda-connect"}
```

```yaml
logger:
  format: json
  level_name: severity     # rename to match your log aggregator's schema
  timestamp_name: timestamp
  message_name: message
```

### Writing logs to a file

```yaml
logger:
  level: INFO
  format: json
  file:
    path: /var/log/connect/pipeline.log
    rotate: true
    rotate_max_age_days: 7
```

Note: `file` is marked Experimental in the logger docs.

### Shipping logs to a Redpanda topic

The `redpanda:` top-level section sends logs to a Kafka topic. This is
separate from the `logger:` section. Grounded in
`docs/modules/components/pages/redpanda/about.adoc`:

```yaml
redpanda:
  seed_brokers:
    - localhost:9092
  logs_topic: __redpanda.connect.logs
  logs_level: info        # debug | info | warn | error
  status_topic: __redpanda.connect.status
  pipeline_id: my-pipeline
```

---

## Metrics

The `metrics:` section configures where Connect sends its internal metrics.
All backends accept an optional `mapping:` Bloblang expression that can filter
or rename metric paths before they are exported.

### Prometheus (recommended for production)

Hosts `/metrics` and `/stats` on the Connect HTTP server (default port 4195).
Grounded in `docs/modules/components/pages/metrics/prometheus.adoc`.

```yaml
metrics:
  prometheus:
    use_histogram_timing: false     # true = histograms; false = summaries
    histogram_buckets: []           # custom histogram buckets in seconds
    summary_quantiles_objectives:
      - quantile: 0.5
        error: 0.05
      - quantile: 0.9
        error: 0.01
      - quantile: 0.99
        error: 0.001
    add_process_metrics: false      # export CPU/memory process metrics
    add_go_metrics: false           # export Go GC runtime metrics
    push_url: ""                    # optional Prometheus Pushgateway URL
    push_interval: ""               # e.g. "30s"; triggers periodic push
    push_job_name: benthos_push
    push_basic_auth:
      username: ""
      password: ""
    file_output_path: ""            # write metrics to file on shutdown
  mapping: ""
```

Scrape it:
```bash
curl -s http://localhost:4195/metrics
curl -s http://localhost:4195/stats   # alias
```

**Push Gateway** (for short-lived pipelines):
```yaml
metrics:
  prometheus:
    push_url: http://pushgateway:9091
    push_interval: 30s
    push_job_name: my-pipeline
```

### StatsD

Grounded in `docs/modules/components/pages/metrics/statsd.adoc`.

```yaml
metrics:
  statsd:
    address: "localhost:8125"   # required
    flush_period: 100ms
    tag_format: none            # none | datadog | influxdb
    tags:
      environment: production
      pipeline: my-pipeline
  mapping: ""
```

### json_api (debugging)

Serves metrics as a JSON object at `/metrics` and `/stats`. Human-readable;
parse with `jq`. Grounded in `docs/modules/components/pages/metrics/json_api.adoc`.

```yaml
metrics:
  json_api: {}
  mapping: ""
```

```bash
# View a specific metric
curl -s http://localhost:4195/metrics | jq '.input_received'

# View all metrics containing "error"
curl -s http://localhost:4195/metrics | jq 'to_entries | map(select(.key | contains("error")))'
```

### logger metrics (no HTTP server required)

Prints each metric as a log line on shutdown and optionally on a periodic
interval. Grounded in `docs/modules/components/pages/metrics/logger.adoc`.

```yaml
metrics:
  logger:
    push_interval: "60s"   # optional: print metrics every 60s
    flush_metrics: false   # reset counters after each print
  mapping: ""
```

### none (disable metrics)

```yaml
metrics:
  none: {}
```

### Metrics mapping

The `mapping:` field accepts a Bloblang expression. The root input is the
metric name as a string. Return the new name, or `deleted()` to drop the
metric.

```yaml
# Keep only the three most important metrics
metrics:
  prometheus: {}
  mapping: |
    if ![
      "input_received",
      "input_latency",
      "output_sent",
    ].contains(this) { deleted() }
```

```yaml
# Prefix all metrics with the pipeline name
metrics:
  prometheus: {}
  mapping: |
    root = "my_pipeline_" + this
```

### Key built-in metric names

Standard Connect pipeline metric names (these appear in the cloudwatch
component's example mapping and the Connect Grafana dashboard resources):

| Metric | Description |
|--------|-------------|
| `input_received` | Count of messages received from the input |
| `input_latency` | Latency of input reads |
| `output_sent` | Count of messages successfully sent by the output |
| `output_batch_sent` | Count of batches sent by the output |

For full metric enumeration, use the `json_api` backend and inspect all keys,
or set `add_process_metrics: true` with Prometheus to see process-level
CPU/memory metrics.

---

## OpenTelemetry Tracing

Send distributed traces to an OpenTelemetry collector. Grounded in
`docs/modules/components/pages/tracers/open_telemetry_collector.adoc`.

```yaml
tracer:
  open_telemetry_collector:
    service: redpanda-connect      # service name in traces (default: benthos)
    grpc:
      - address: "localhost:4317"  # gRPC collector endpoint
        secure: false
    http:
      - address: "localhost:4318"  # HTTP collector endpoint
        secure: false
    tags:
      environment: production
      pipeline: my-pipeline
    sampling:
      enabled: false
      ratio: 0.85    # sample 85% of traces (requires version 4.25.0+)
```

You can send to multiple collectors in the same tracer config — list multiple
entries in `grpc:` or `http:`.

**Sampling** is recommended for high-volume pipelines to reduce overhead:
```yaml
    sampling:
      enabled: true
      ratio: 0.01    # 1% sampling for a 10k msg/s pipeline
```

Other tracer backends available: `jaeger`, `gcp_cloudtrace`, `redpanda`, `none`.

---

## HTTP Server and Health Endpoints

The built-in HTTP server (default `0.0.0.0:4195`) is configured under `http:`.
Grounded in `docs/modules/components/pages/http/about.adoc`.

### Full schema (all fields with defaults)

```yaml
http:
  enabled: true
  address: 0.0.0.0:4195
  root_path: /benthos        # endpoints are also reachable at /benthos/<path>
  debug_endpoints: false     # set true to expose /debug/pprof/* endpoints
  cert_file: ""              # path to TLS cert (enables HTTPS when set)
  key_file: ""               # path to TLS key
  cors:
    enabled: false
    allowed_origins: []      # e.g. ["https://my-dashboard.example.com"] or ["*"]
  basic_auth:
    enabled: false
    realm: restricted
    username: ""
    password_hash: ""        # base64-encoded hash of the password
    algorithm: sha256        # md5 | sha256 | bcrypt | scrypt
    salt: ""                 # base64-encoded salt (for scrypt)
```

### Standard endpoints

| Endpoint | Purpose |
|----------|---------|
| `/ping` | Liveness: always returns 200 while the process is running |
| `/ready` | Readiness: 200 when input AND output are connected; 503 otherwise |
| `/metrics`, `/stats` | Metrics (when prometheus or json_api is configured) |
| `/version` | Service version info |
| `/endpoints` | JSON list of all registered HTTP endpoints |

### Debug endpoints (enable with `debug_endpoints: true`)

```
/debug/config/json     loaded config as JSON
/debug/config/yaml     loaded config as YAML
/debug/pprof/profile   CPU profile (duration via ?seconds=N, default 1s)
/debug/pprof/heap      heap memory profile
/debug/pprof/goroutine goroutine dump
/debug/pprof/block     blocking profile
/debug/pprof/mutex     mutex contention profile
/debug/pprof/symbol    function name lookup
/debug/pprof/trace     execution trace
/debug/stack           current stack trace snapshot
```

```bash
# Enable debug endpoints
# In config:
# http:
#   debug_endpoints: true

# Capture a 30-second CPU profile
curl -s "http://localhost:4195/debug/pprof/profile?seconds=30" -o cpu.prof
go tool pprof -http=:8080 cpu.prof

# Take a heap snapshot
curl -s "http://localhost:4195/debug/pprof/heap" -o heap.prof
go tool pprof -http=:8080 heap.prof

# View goroutine dump
curl -s "http://localhost:4195/debug/pprof/goroutine?debug=2"
```

### HTTPS

Provide both `cert_file` and `key_file` to switch to HTTPS:

```yaml
http:
  address: 0.0.0.0:4443
  cert_file: /etc/ssl/connect.crt
  key_file: /etc/ssl/connect.key
```

### Basic auth

Hash a password for basic auth using Connect itself. Use `printf` (not `echo`)
to avoid hashing a trailing newline (note: the source example uses `echo`
without `-n`; the `printf` form is more correct and produces a different hash):

```bash
# Generate a sha256 hash of your password (no trailing newline):
printf 'mypassword' | rpk connect blobl 'root = content().hash("sha256").encode("base64")'
```

Replace `mypassword` with your actual password. For reference, the sha256
(no newline) of the literal string `password` is:
`XohImNooBHFR0OVvjcYpJ3NgPQ1qq73WKhHvch0VQtg=`

```yaml
http:
  basic_auth:
    enabled: true
    username: admin
    password_hash: "XohImNooBHFR0OVvjcYpJ3NgPQ1qq73WKhHvch0VQtg="  # printf 'password' | sha256 | base64
    algorithm: sha256
```

### Kubernetes probes

```yaml
# kubernetes deployment spec
livenessProbe:
  httpGet:
    path: /ping
    port: 4195
  initialDelaySeconds: 10
  periodSeconds: 5

readinessProbe:
  httpGet:
    path: /ready
    port: 4195
  initialDelaySeconds: 5
  periodSeconds: 5
  failureThreshold: 30    # allow ~150s for connections to establish
```

---

## Full Observability Config Example

```yaml
http:
  address: 0.0.0.0:4195
  debug_endpoints: true   # remove in production

logger:
  level: INFO
  format: json
  static_fields:
    '@service': redpanda-connect
    pipeline: orders-processor
    environment: production

metrics:
  prometheus:
    add_process_metrics: true
  mapping: |
    if ![
      "input_received",
      "input_latency",
      "output_sent",
    ].contains(this) { deleted() }

tracer:
  open_telemetry_collector:
    service: orders-processor
    grpc:
      - address: "otel-collector:4317"
        secure: false
    sampling:
      enabled: true
      ratio: 0.1

input:
  kafka_franz:
    seed_brokers: ["broker:9092"]
    topics: ["orders"]
    consumer_group: orders-group

pipeline:
  processors:
    - mapping: |
        root = this

output:
  kafka_franz:
    seed_brokers: ["broker:9092"]
    topic: orders-processed
```
