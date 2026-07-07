---
name: connect
description: >-
  Teaches how to build streaming data pipelines with Redpanda Connect (formerly
  Benthos) — declarative YAML config, the input/pipeline/output model, Bloblang
  mapping language, error handling, and canonical pipeline patterns. Use when:
  building or running a Redpanda Connect pipeline; wiring an input to an output
  with processors; writing Bloblang mappings or mutations; choosing connectors
  (kafka, redpanda, http_server, file, generate, sql_*, aws_*, gcp_*); running
  pipelines with rpk connect run or redpanda-connect; configuring buffers,
  caches, metrics, rate limits, or the global redpanda block; writing
  config.yaml for redpanda-connect; asking what Connect components exist and
  how to discover them; error handling with fallback outputs or catch processors;
  batching records before writing; understanding the difference between mapping
  and mutation processors; choosing between the bloblang and mapping processor
  names; connecting to Kafka or Redpanda with SASL/TLS from Connect; migrating
  Kafka clusters to Redpanda with the redpanda_migrator input/output pair
  (topics, schemas, ACLs, consumer group offsets); running many isolated
  pipelines in one process with streams mode (rpk connect streams, the /streams
  REST API); the community tigerbeetle_cdc input; enterprise
  vs community components or license setup; dry-run and lint commands; enterprise
  features and their config keys — enterprise connectors and CDC inputs
  (postgres_cdc, mysql_cdc, mongodb_cdc, oracledb_cdc with its logminer block,
  microsoft_sql_server_cdc, gcp_spanner_cdc, aws_dynamodb_cdc, salesforce_cdc),
  AI/ML processors (openai_*, aws_bedrock_*, cohere_*, gcp_vertex_ai_*, ollama_*),
  allow/deny lists (connector_list.yaml), secrets management (--secrets URNs:
  env/redis/aws/gcp/az/none), FIPS compliance, and the Redpanda Connect
  configuration service (logs_topic/status_topic); supplying a Redpanda Enterprise
  license (--redpanda-license, REDPANDA_LICENSE, /etc/redpanda/redpanda.license).
---

# Redpanda Connect

Redpanda Connect (formerly Benthos) is a declarative stream processor: you write a YAML config that specifies an `input`, an optional `pipeline` of processors, and an `output`. Connect reads from the input, runs each record through the processors, and writes to the output — with at-least-once delivery guarantees. It ships as the `redpanda-connect` binary and is also accessible via `rpk connect`.

The component library is large (hundreds of inputs, processors, outputs, caches, buffers, rate limits). This skill teaches the config model, how to run pipelines, how to discover components, Bloblang for transformations, error handling, and several canonical patterns. For CDC-specific pipelines see the `connect-cdc-*` skills; for debugging see `connect-debugging`.

## Quickstart

### 1. Minimal kafka-to-kafka pipeline with a Bloblang transform

```yaml
# my-pipeline.yaml
input:
  redpanda:
    seed_brokers: ["localhost:9092"]
    topics: ["raw-events"]
    consumer_group: connect-demo
    start_offset: earliest

pipeline:
  processors:
    - mapping: |
        root = this
        root.processed_at = now()
        root.event_type = this.type.uppercase()

output:
  redpanda:
    seed_brokers: ["localhost:9092"]
    topic: processed-events
    key: ${! json("id") }
```

Run it:

```bash
# With rpk (recommended)
rpk connect run my-pipeline.yaml

# Or directly with the binary
redpanda-connect run my-pipeline.yaml

# Override a field on the command line (-s flag)
rpk connect run -s input.redpanda.seed_brokers='["broker:9092"]' my-pipeline.yaml

# Load env vars from a .env file
rpk connect run --env-file .env my-pipeline.yaml
```

### 2. Discover available components

```bash
# List all inputs, processors, outputs, etc.
rpk connect list inputs
rpk connect list outputs
rpk connect list processors
rpk connect list caches

# Get the full config schema for a specific component
rpk connect create redpanda          # shows full redpanda input YAML with defaults
rpk connect create //redpanda        # redpanda output template (empty input/processors)
rpk connect create stdin/mapping/stdout  # pipeline with stdin input, mapping processor, stdout output
```

### 3. Lint before deploying

```bash
rpk connect lint my-pipeline.yaml
rpk connect lint --deprecated --labels my-pipeline.yaml
```

### 4. Dry-run (test connections without processing data)

```bash
rpk connect dry-run my-pipeline.yaml
rpk connect dry-run --verbose my-pipeline.yaml
```

## Config Structure

A Connect config has the following top-level keys:

```yaml
# Minimum required keys
input:   { ... }
output:  { ... }

# Optional pipeline of processors
pipeline:
  threads: 1            # parallelism (default 1)
  processors:
    - mapping: "..."

# Optional extras
logger:  { ... }
metrics: { ... }
tracer:  { ... }
buffer:  { ... }

# Named resources — referenced by name from inputs/outputs/processors
cache_resources:      []
rate_limit_resources: []
input_resources:      []
output_resources:     []
processor_resources:  []

# Global Redpanda connection block (shared by redpanda input/output)
redpanda:
  seed_brokers: []
  tls:    { ... }
  sasl:   []
```

Config files are read from well-known paths if no file is given: `redpanda-connect.yaml`, `/redpanda-connect.yaml`, `/etc/redpanda-connect/config.yaml`, `/etc/redpanda-connect.yaml`, `connect.yaml`, `/connect.yaml`, `/etc/connect/config.yaml`, `/etc/connect.yaml`.

## Bloblang Basics

Bloblang is Connect's built-in mapping language used in `mapping`, `mutation`, and `bloblang` processors, and in interpolation strings (`${! ... }`).

```yaml
pipeline:
  processors:
    - mapping: |
        # root = output document, this = input document
        root = this
        root.id = uuid_v4()
        root.ts = now()
        # Delete a field
        root.internal = deleted()
        # Conditional
        root.tier = if this.score > 100 { "premium" } else { "standard" }
        # Array filter
        root.active_users = this.users.filter(u -> u.active == true)
        # Coalesce / fallback
        root.name = this.display_name | this.username | "unknown"
        # Access Kafka metadata
        root.source_topic = meta("kafka_topic")
```

The `mutation` processor mutates messages in-place (more efficient when the output shape is similar to the input). The `mapping` processor creates a fresh output document (safer when the shape changes dramatically). The older name `bloblang` is equivalent to `mapping` and will eventually be deprecated.

## Error Handling

```yaml
# Dead-letter queue using fallback output
output:
  fallback:
    - redpanda:
        seed_brokers: ["localhost:9092"]
        topic: orders
    - retry:
        output:
          redpanda:
            seed_brokers: ["localhost:9092"]
            topic: orders-dlq

# Catch processor errors
pipeline:
  processors:
    - try:
        - mapping: 'root = this.merge({"parsed": this.body.parse_json()})'
    - catch:
        - mapping: 'root.error = error(); root.original = content().string()'
```

## Key Component Groups

| Group | Notable members |
|---|---|
| **Inputs** | `redpanda`, `generate`, `http_server`, `http_client`, `file`, `aws_s3`, `aws_sqs`, `aws_kinesis`, `gcp_pubsub`, `gcp_cloud_storage`, `azure_blob_storage`, `kafka` (community), `sql_select`, `mongodb`, `redis_*`, `nats*`, `amqp_*` |
| **Processors** | `mapping`/`mutation`/`bloblang`, `branch`, `catch`, `try`, `for_each`, `dedupe`, `batch`, `compress`, `decompress`, `schema_registry_decode`, `schema_registry_encode`, `protobuf`, `sql_*`, `cache`, `rate_limit`, `archive`, `split`, `parallel` |
| **Outputs** | `redpanda`, `http_client`, `file`, `broker`, `fallback`, `switch`, `drop`, `cache`, `aws_s3`, `aws_sqs`, `aws_kinesis_firehose`, `gcp_pubsub`, `gcp_bigquery`, `azure_blob_storage`, `opensearch`, `elasticsearch_v8`, `sql_insert` |
| **Caches** | `memory`, `redis`, `ristretto`, `ttlru`, `lru`, `sql`, `aws_dynamodb`, `memcached`, `file` |
| **Buffers** | `memory`, `sqlite`, `system_window`, `none` |
| **Rate Limits** | `local`, `redis` |

Enterprise-only components (require a Redpanda license) include the CDC inputs (`postgres_cdc`, `mysql_cdc`, `mongodb_cdc`, `microsoft_sql_server_cdc`, `oracledb_cdc`, `gcp_spanner_cdc`, `aws_dynamodb_cdc`, `salesforce_cdc`) plus the Snowflake, BigQuery write, Iceberg, Splunk, OpenTelemetry, Slack, Google Drive, and Salesforce families — the complete tiered list is in [Connector Catalog](references/connector-catalog.md). AI/ML processors are certified tier (no license required). Provide a license via `--redpanda-license` flag, `REDPANDA_LICENSE` env var, `REDPANDA_LICENSE_FILEPATH`, or the file `/etc/redpanda/redpanda.license`. One CDC input is *not* enterprise: `tigerbeetle_cdc` is a certified community component (no license needed), but it requires a CGO-enabled Connect build — the `rpk connect` managed plugin and the standard Docker image don't include it.

## Enterprise Features

Redpanda Connect's enterprise (RCL-licensed) features in this domain:

- **Enterprise connectors** — the CDC inputs above plus the Snowflake, BigQuery write, Iceberg, Splunk, OTLP, Slack, Google Drive, and Salesforce families (full list: [Connector Catalog](references/connector-catalog.md)). **Require a license**; blocked after the 30-day trial expires. Each CDC input has nested config (e.g. `oracledb_cdc.logminer{}`, `checkpoint_cache`, `stream_snapshot`). AI/ML processors (`openai_*`, `aws_bedrock_*`, `cohere_*`, `gcp_vertex_ai_*`, `ollama_*`) are certified tier — no license.
- **Allow or deny lists** — restrict which components a pipeline may use via `/etc/redpanda/connector_list.yaml` (`allow:` or `deny:` arrays, mutually exclusive).
- **Secrets management** — resolve secrets from remote systems with the `--secrets` flag (URN schemes `env:`, `redis://`, `aws://`, `gcp://`, `az://`, `none:`).
- **FIPS compliance** — run a FIPS-compliant build of `rpk`/Connect.
- **Configuration service** — the global `redpanda` block can ship Connect's own logs and status events to a Redpanda topic (`logs_topic`, `status_topic`, `pipeline_id`).

Allow/deny lists, secrets management, FIPS, and the configuration service are enterprise features but are **not disabled when a license expires** — only the enterprise connectors are hard-gated. See [Enterprise Features](references/enterprise.md) for every config key.

## Reference Directory

- [Config Structure](references/config-structure.md): Complete pipeline YAML structure, the `redpanda` global block, running pipelines (`rpk connect run`, Docker, `-s` overrides, `--env-file`), and default config file paths.
- [Components](references/components.md): The component model — inputs, processors, outputs, caches, buffers, rate limits — the most-used ones, how to discover and read a component's config schema, enterprise vs community licensing.
- [Bloblang](references/bloblang.md): Bloblang mapping language essentials: `root`/`this`/`meta`, assignment, deletion, variables, conditionals, array methods, functions, `mapping` vs `mutation` vs `bloblang` processor names, and practical transform examples.
- [Patterns](references/patterns.md): Canonical pipelines: kafka→kafka with transform, http_server→kafka ingest, batching, fallback/dead-letter outputs, retries, and windowed aggregation. Runnable YAML.
- [Connector Catalog](references/connector-catalog.md): The tiered component catalog — every enterprise family at the current stable release (Snowflake, BigQuery write, Iceberg, Splunk, OTLP, Slack, Google Drive, Salesforce, CDC), the certified AI/ML + vector-store processors, notable certified families (MQTT, NATS, AMQP, Azure storage, aws_lambda, redpanda_data_transform), tier-vs-license-gate caveats, and live-discovery commands.
- [Migration](references/migration.md): Kafka→Redpanda migration with the unified `redpanda_migrator` input/output pair (Connect 4.67.5+): what it migrates (topic data, topic configs, schemas, ACLs, consumer group offsets), unified vs the removed legacy bundle components, the end-to-end workflow (ACLs → run → monitor lag → verify → cut over), label pairing, sync schedules and guarantees, when to use it vs a plain kafka→redpanda pipeline.
- [Streams Mode](references/streams-mode.md): Running many isolated streams in one Connect process (`rpk connect streams`): per-stream config file layout, the `-o/--observability` and `-r/--resources` flags, shared resources, stream-prefixed HTTP endpoints, the `stream` metrics label, and the full `/streams` REST API (create/read/update/patch/delete streams, `/resources/{type}/{id}`, `?chilled=true`).
- [Enterprise Features](references/enterprise.md): Enterprise (license-gated) Connect features and their exact config keys — supplying a license (`--redpanda-license`, `REDPANDA_LICENSE`, `/etc/redpanda/redpanda.license`); all CDC inputs with nested blocks (`postgres_cdc`, `mysql_cdc`, `mongodb_cdc`, `oracledb_cdc` `logminer{}`, `microsoft_sql_server_cdc`, `gcp_spanner_cdc`, `aws_dynamodb_cdc`, `salesforce_cdc`); AI/ML processors; allow/deny lists (`connector_list.yaml`); secrets management (`--secrets` URNs); FIPS compliance; and the configuration service (`logs_topic`/`status_topic`). Notes which features require a license vs which survive expiry.
