---
name: rpk-transform
description: >-
  Builds, deploys, and manages Redpanda Data Transforms — WebAssembly (Wasm)
  functions that run inside the broker to transform records in-flight from an
  input topic to one or more output topics. Covers the full lifecycle: enabling
  the feature, initializing a project, writing transform logic in Go (TinyGo),
  Rust, JavaScript, or TypeScript, building the Wasm binary, deploying with
  rpk transform deploy, listing and inspecting running transforms, viewing
  logs, pausing/resuming, and deleting transforms.
  Use when: writing or deploying a Redpanda data transform, in-broker Wasm
  transform, wiring an input topic to an output topic, filtering or
  transforming Kafka records inside the broker, using rpk transform init /
  build / deploy / list / logs / pause / resume / delete, enabling
  data_transforms_enabled cluster config, using the Go transform SDK,
  Rust transform SDK, or JavaScript/TypeScript transform SDK, from-offset
  reprocessing, or setting environment variables on a transform.
  Also covers wiring transform output topics to Redpanda Enterprise features
  (require an Enterprise license): Iceberg Topics (redpanda.iceberg.mode for
  lakehouse output), Tiered Storage (redpanda.remote.read/write), server-side
  Schema ID Validation (enable_schema_id_validation,
  redpanda.value.schema.id.validation), Leadership Pinning
  (redpanda.leaders.preference controls where transform processors run), and
  RBAC / Audit Logging for transform topics. Includes Redpanda Cloud
  applicability: transforms on BYOC and Dedicated clusters (not Serverless)
  and how enabling differs on Cloud.
---

# rpk transform: Data Transforms (Wasm)

Redpanda Data Transforms let you run WebAssembly functions directly inside the broker to filter, scrub, transcode, or route records from an input topic to one or more output topics — with no separate stream-processing infrastructure. The Wasm VM runs on the same CPU core (shard) as the partition leader; JIT compilation gives near-native performance. Transforms have at-least-once delivery semantics.

Supported languages: **TinyGo (no goroutines)**, **TinyGo (with goroutines)**, **Rust**, **JavaScript**, **TypeScript**.

Key constraints: no external network or disk access from inside the transform, up to 8 output topics, single-record transforms only (for joins/aggregations use Redpanda Connect).

## Quickstart

```bash
# 0 — enable data transforms on the cluster (required once, triggers rolling restart)
rpk cluster config set data_transforms_enabled true

# 1 — create the input and output topics first
rpk topic create input-topic output-topic --partitions 3

# 2 — scaffold a Go transform project
rpk transform init my-transform --language=tinygo-no-goroutines --name=my-transform
cd my-transform

# 3 — (optional) edit transform.go — default pass-through template works out of the box

# 4 — build the Wasm binary
# TinyGo buildpack is fetched automatically; Rust/JS deps require --install-deps at init or manual install
rpk transform build

# 5 — deploy: reads transform.yaml; prompts for topics if not set there
rpk transform deploy --input-topic input-topic --output-topic output-topic

# or deploy the .wasm file directly without transform.yaml in cwd
rpk transform deploy \
  --file my-transform.wasm \
  --name my-transform \
  --input-topic input-topic \
  --output-topic output-topic

# 6 — verify the deploy
rpk transform list

# 7 — produce a test record and watch the output topic
echo '{"hello":"world"}' | rpk topic produce input-topic
rpk topic consume output-topic --num 1

# 8 — view transform logs (stdout/stderr captured to _redpanda.transform_logs)
rpk transform logs my-transform --since=-1h
rpk transform logs my-transform --follow

# 9 — pause / resume without deleting
rpk transform pause  my-transform
rpk transform resume my-transform

# 10 — delete the transform
rpk transform delete my-transform
```

The `rpk transform` command group is also available as `rpk wasm` (alias for backward compatibility).

## Enabling Transforms

Data transforms are disabled by default. Before deploying any transform:

```bash
rpk cluster config set data_transforms_enabled true
```

This triggers a rolling restart and may take several minutes.

## Redpanda Cloud Applicability

- **Availability**: the Redpanda Cloud docs state data transforms are supported on **BYOC and Dedicated** clusters running Redpanda 24.3+. **Serverless** is not listed as supported — do not advise deploying transforms to a Serverless cluster.
- **Enabling**: the command is the same — `rpk cluster config set data_transforms_enabled true` — but on Cloud it goes through the Cloud control plane, not the broker Admin API. Run `rpk cloud login` and select the target cluster first. Self-service cluster properties on Cloud require rpk 25.1.2+ and Redpanda 25.1.2+, and are available only on BYOC/Dedicated clusters on **AWS and GCP** — not on Azure clusters and not on Serverless. Properties that require a restart (this one does) trigger a long-running Cloud operation that can take several minutes; `rpk cluster config set` returns the operation ID.
- **Managed tuning**: only a curated subset of `data_transforms_*` cluster properties is settable in Cloud (at verification time: `data_transforms_enabled`, `data_transforms_binary_max_size`, `data_transforms_per_core_memory_reservation`, `data_transforms_per_function_memory_limit`, `data_transforms_logging_line_max_bytes`). The rest (for example `data_transforms_commit_interval_ms`, `data_transforms_runtime_limit_ms`) are managed by Redpanda; setting an unsupported property returns `REASON_INVALID_INPUT`. Check the Redpanda Cloud "Cluster Configuration Properties" reference page for the current list.
- The lifecycle commands (`rpk transform init/build/deploy/list/logs/delete`) work against a Cloud cluster once your rpk profile points at it; the Cloud UI can also view logs and delete transforms.
- **TODO (unverified)**: the Cloud rpk reference does not document `rpk transform pause`/`resume` (the self-managed reference does). Whether pause/resume work on Cloud clusters is unconfirmed in the docs — verify on a live cluster before advising.
- **TODO (unverified)**: the docs do not state how to enable transforms on Azure BYOC/Dedicated clusters, where self-service cluster properties are unavailable (possibly via Redpanda Support).

## Project Layout

`rpk transform init` creates `transform.yaml` (with only `name` and `language`) plus language-specific scaffolding. The files generated per language are:

- **TinyGo**: `transform.yaml`, `transform.go`, `go.mod`, `README.md`. `go.sum` appears only after dependency install (`go mod tidy`, triggered by `--install-deps` or the post-init prompt).
- **Rust**: `transform.yaml`, `Cargo.toml`, `README.md`, `src/main.rs`, `.cargo/config.toml`.
- **JavaScript**: `transform.yaml`, `package.json`, `README.md`, `esbuild.js`, `src/index.js`.
- **TypeScript**: same as JavaScript plus `tsconfig.json` and `src/index.ts`.

```
my-transform/           # TinyGo example
├── transform.yaml      # name + language (init writes these two fields only)
├── transform.go        # boilerplate with OnRecordWritten callback
├── go.mod
└── README.md
```

### transform.yaml

`rpk transform init` writes only `name` and `language`. The other fields are added by the user and all are overridable by CLI flags at deploy time. `--from-offset` is a CLI-only deploy flag and is **not** a `transform.yaml` field.

```yaml
name: my-transform
language: tinygo-no-goroutines   # or tinygo-with-goroutines, rust, javascript, typescript
description: "Optional description"
input-topic: input-topic
output-topics:
  - output-topic
env:
  MY_VAR: "some-value"           # max 128 vars, keys must not start with REDPANDA_
compression: none                # none | gzip | snappy | lz4 | zstd
```

## Supported Languages

| Flag value | Description |
|---|---|
| `tinygo-no-goroutines` | Higher throughput; no goroutine support |
| `tinygo-with-goroutines` | Goroutines via asyncify scheduler (~10x slower) |
| `rust` | Full Rust with `redpanda-transform-sdk` crate |
| `javascript` | JS via `@redpanda-data/transform-sdk` npm package |
| `typescript` | TypeScript, compiled via esbuild |

## Command Reference

### rpk transform init

```
rpk transform init [DIRECTORY] [flags]

Flags:
  -l, --language string    Language (tinygo-no-goroutines, tinygo-with-goroutines, rust, javascript, typescript)
      --name string        Transform name
      --install-deps       Install language dependencies (rustup target add, cargo add, npm install, go mod tidy); default: interactive prompt
```

Initializes project files in the current directory (or the named subdirectory). Creates `transform.yaml` and boilerplate source.

### rpk transform build

```
rpk transform build [-- <extra-toolchain-args>]
```

Reads `transform.yaml` in the current directory, installs the appropriate buildpack, and produces `<name>.wasm`. For TinyGo: uses `-opt=2 -llvm-features=+simd128 -no-debug` by default. For Rust: runs `cargo build --release`; the `wasm32-wasip1` target is supplied by the generated `.cargo/config.toml` (not passed on the command line by rpk). For JS/TS: `npm run build` then bundles via esbuild and wasm-merge.

Pass extra flags after `--` to forward to the underlying toolchain:

```bash
# Add TinyGo debug symbols
rpk transform build -- -no-debug=false
```

### rpk transform deploy

```
rpk transform deploy [flags]

Flags:
  -i, --input-topic string     Input topic
  -o, --output-topic strings   Output topic(s) — repeatable, up to 8
      --name string            Transform name (overrides transform.yaml)
      --file string            Path or URL to .wasm file (skips transform.yaml lookup)
      --var KEY=VALUE          Environment variable — repeatable
      --compression string     Output batch compression: none|gzip|snappy|lz4|zstd (default: none)
      --from-offset string     Starting offset: @<unix_ms>, +<n>, -<n>
```

When run in the same directory as `transform.yaml`, reads config from that file; CLI flags take precedence. When `--file` is provided, both `https://` and `http://` URLs are accepted — the binary is fetched over the network and deployed into the broker; prefer `https://` and a trusted source.

#### Reprocessing with --from-offset

The `--from-offset` flag is only honored on the **first** deploy of a transform name. To reprocess existing records with an existing transform, delete it first, then redeploy with the flag.

```bash
# Start from offset 0 of each partition
rpk transform deploy --from-offset +0

# Start 100 records before the end of each partition
rpk transform deploy --from-offset -100

# Start from a Unix millisecond timestamp
rpk transform deploy --from-offset @1617181723000
```

### rpk transform list

```
rpk transform list [flags]   (alias: ls)

Flags:
  -d, --detailed   Print per-partition processor status (partition, node, status, lag)
      --format     json|yaml|text|wide|help (default: text)
```

Shows all deployed transforms: name, input topic, output topic(s), running processors (e.g. `3 / 3`), and total lag.

### rpk transform logs

```
rpk transform logs NAME [flags]   (alias: log)

Flags:
  -f, --follow         Stream new logs continuously
      --since string   Start time (now, -1h, 2024-03-12, 2024-03-12T12:00:00Z, Unix ms/s)
      --until string   End time (same formats)
      --head int       First N log entries
      --tail int       Last N log entries (mutually exclusive with --follow)
      --format string  text|wide|json (default: text)
```

Reads from the internal `_redpanda.transform_logs` topic. STDOUT from the transform emits at INFO level; STDERR emits at WARN level. `--format=wide` includes timestamp and level prefix. `--format=json` emits OpenTelemetry LogRecord JSON.

```bash
# Last hour of logs
rpk transform logs my-transform --since=-1h

# Logs between two timestamps
rpk transform logs my-transform \
  --since=2024-03-12T12:00:00Z \
  --until=2024-03-12T13:00:00Z

# Stream in real time with wide format
rpk transform logs my-transform --follow --format=wide
```

### rpk transform pause / resume

```
rpk transform pause NAME
rpk transform resume NAME
```

Pause suspends execution without deleting the transform. Processors show as `inactive` in `rpk transform list`. Resume restarts them from the last committed offset.

### rpk transform delete

```
rpk transform delete NAME [--no-confirm]
```

Permanently removes a transform and its committed offset state. Prompts for confirmation unless `--no-confirm` is set. After deletion, a re-deploy with `--from-offset` will reprocess from the specified position.

## Built-In Environment Variables

Redpanda injects these automatically into every transform at runtime:

| Variable | Value |
|---|---|
| `REDPANDA_INPUT_TOPIC` | The configured input topic |
| `REDPANDA_OUTPUT_TOPIC_0` | First output topic |
| `REDPANDA_OUTPUT_TOPIC_N` | Nth output topic (0-indexed) |

Custom variables must not start with `REDPANDA_`, must be < 128 bytes per key, ≤ 128 variables total, combined values < 2000 bytes.

## Cluster Configuration Properties

| Property | Purpose |
|---|---|
| `data_transforms_enabled` | Enable/disable transforms (default: false) |
| `data_transforms_per_core_memory_reservation` | Total Wasm memory per core |
| `data_transforms_per_function_memory_limit` | Memory ceiling per function |
| `data_transforms_binary_max_size` | Max deployable Wasm binary size |
| `data_transforms_commit_interval_ms` | Offset commit interval |
| `data_transforms_runtime_limit_ms` | Max time per record transform |
| `data_transforms_logging_line_max_bytes` | Max log line length |

Set any property with `rpk cluster config set <property> <value>`.

## Monitoring Metrics

All transform metrics carry a `function_name` label. Note: `transform_name` is the log-record attribute key in `_redpanda.transform_logs` JSON, not a Prometheus label — use `function_name` in PromQL. `redpanda_transform_state` also carries a `state` label (`running`|`inactive`|`errored`).

| Metric | What it measures |
|---|---|
| `redpanda_transform_execution_latency_sec` | Transform execution latency histogram |
| `redpanda_transform_execution_errors` | Count of execution errors |
| `redpanda_transform_failures` | Count of transform function failures |
| `redpanda_transform_state` | Count of processors in each state; `state` label = `running`\|`inactive`\|`errored` |
| `redpanda_transform_processor_lag` | Records pending processing |
| `redpanda_transform_read_bytes` | Bytes read from input topic |
| `redpanda_transform_write_bytes` | Bytes written to output topic(s) |
| `redpanda_wasm_engine_cpu_seconds_total` | Wasm engine CPU time |
| `redpanda_wasm_engine_memory_usage` | Current Wasm memory usage |
| `redpanda_wasm_engine_max_memory` | Configured Wasm memory limit |
| `redpanda_wasm_binary_executable_memory_usage` | JIT-compiled binary memory |

## Enterprise Features for Transform Topics

The transform feature itself is free (BSL) — `data_transforms_enabled` needs no license. But the input/output topics a transform reads and writes commonly use Redpanda **Enterprise** features (all require a valid Enterprise license; check with `rpk cluster license info`):

| Feature | Key config | Relevance to transforms |
|---|---|---|
| **Iceberg Topics** | `iceberg_enabled` (cluster); topic `redpanda.iceberg.mode` (`disabled`\|`key_value`\|`value_schema_id_prefix`\|`value_schema_latest`), `redpanda.iceberg.delete`, `redpanda.iceberg.invalid.record.action` (`drop`\|`dlq_table`), `redpanda.iceberg.partition.spec`, `redpanda.iceberg.target.lag.ms` | Route transformed (SR-wire-format) records into an Iceberg output topic so cleaned data lands directly in lakehouse tables — no separate ETL. Requires Tiered Storage on the topic. |
| **Tiered Storage** | `cloud_storage_enabled` (cluster); topic `redpanda.remote.read` / `redpanda.remote.write` / `redpanda.remote.delete` | Long-term object-storage backing for transform input/output topics; prerequisite for Iceberg. |
| **Server-side Schema ID Validation** | `enable_schema_id_validation` = `none`\|`redpanda`\|`compat` (cluster); topic `redpanda.{key,value}.schema.id.validation`, `redpanda.{key,value}.subject.name.strategy` | Broker drops transform output records whose encoded schema ID is unregistered. |
| **Leadership Pinning** | `default_leaders_preference` (cluster); topic `redpanda.leaders.preference` = `none`\|`racks:…`\|`ordered_racks:…` | Transform processors run on the input partition leader; pins which AZs/racks they execute in. |
| **RBAC / Audit Logging** | `rpk security role …`; `audit_enabled` | Role-based control over who deploys/manages transforms and reads/writes their topics; audit of admin operations. |

See [enterprise-output-topics.md](references/enterprise-output-topics.md) for the full nested config keys, modes, defaults, and license-expiration behavior.

## Reference Directory

- [develop-and-build.md](references/develop-and-build.md): Project init, language templates, SDK API patterns (Go/Rust/JS), error handling, multi-topic routing, and Schema Registry integration inside a transform.
- [deploy-and-operate.md](references/deploy-and-operate.md): Full deploy flags, reprocessing with --from-offset, sharing Wasm binaries via URL, list/logs/pause/resume/delete, cluster config properties, and monitoring metrics.
- [enterprise-output-topics.md](references/enterprise-output-topics.md): Enterprise features for a transform's input/output topics (all require an Enterprise license) — Iceberg Topics (`redpanda.iceberg.*` modes/keys), Tiered Storage (`redpanda.remote.*`), server-side Schema ID Validation (`enable_schema_id_validation`, `redpanda.{key,value}.schema.id.validation`), Leadership Pinning (`redpanda.leaders.preference`), and RBAC / Audit Logging, with cluster vs. topic keys and license-expiration behavior.
