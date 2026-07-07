# Deploy and Operate Data Transforms

This reference covers deploying transforms to a cluster, listing and inspecting running transforms, viewing logs, pausing/resuming, deleting, and the cluster configuration properties that govern the Wasm engine.

## Enabling Data Transforms

Data transforms are disabled by default. Enable them once per cluster:

```bash
rpk cluster config set data_transforms_enabled true
```

This requires a rolling restart; it may take several minutes. After the restart, deploy any number of transforms.

> **Redpanda Cloud:** transforms are supported on BYOC and Dedicated clusters (Redpanda 24.3+); Serverless is not listed as supported. The same `rpk cluster config set` command enables the feature on Cloud, routed through the Cloud control plane (`rpk cloud login` first; rpk and Redpanda 25.1.2+; BYOC/Dedicated on AWS/GCP only — cluster properties are unavailable on Azure clusters and on Serverless). See "Redpanda Cloud Applicability" in SKILL.md.

## rpk transform deploy

```
rpk transform deploy [flags]
```

### Flags

| Flag | Type | Description |
|---|---|---|
| `-i, --input-topic` | string | Input topic |
| `-o, --output-topic` | strings | Output topic — repeatable, up to 8 |
| `--name` | string | Transform name (overrides `transform.yaml`) |
| `--file` | string | Path or URL (`https://…` or `http://…`) to the `.wasm` binary; prefer `https://` for security |
| `--var` | `KEY=VALUE` | Environment variable — repeatable |
| `--compression` | string | `none` \| `gzip` \| `snappy` \| `lz4` \| `zstd` (default: `none`) |
| `--from-offset` | string | Starting offset expression (first deploy only) |

### Behavior

When run from a directory containing `transform.yaml`, the command:

1. Reads `transform.yaml` for name, description, input-topic, output-topics, env, and compression.
2. Looks for `<name>.wasm` in the current directory.
3. CLI flags override file values; `--var` is merged (CLI takes precedence per key).

To deploy without a `transform.yaml` or from a different directory, provide all required flags explicitly:

```bash
rpk transform deploy \
  --file /path/to/my-transform.wasm \
  --name my-transform \
  --input-topic raw-events \
  --output-topic clean-events \
  --output-topic rejected-events
```

To deploy a transform hosted on a network (both `https://` and `http://` URLs are accepted; use `https://` and a trusted source — the fetched binary executes inside the broker):

```bash
rpk transform deploy --file https://my-site/my-transform.wasm \
  --name my-transform \
  --input-topic input --output-topic output
```

### Environment Variables at Deploy Time

```bash
rpk transform deploy --var FOO=BAR --var FIZZ=BUZZ
```

CLI `--var` entries are merged with `env:` in `transform.yaml`; CLI entries win on conflict.

### Output Compression

```bash
rpk transform deploy --compression zstd
```

Available types: `none`, `gzip`, `snappy`, `lz4`, `zstd`. Default is `none`. Enabling compression may increase CPU usage.

### --from-offset: Reprocessing

A new deploy of a transform name starts at the **latest** offset (new records only). Use `--from-offset` to override this for the **first** deploy of a given transform name.

Syntax:

| Expression | Meaning |
|---|---|
| `+N` | N records from the start of each input partition |
| `-N` | N records before the end of each input partition |
| `@T` | Records with committed timestamp >= T (Unix time, milliseconds) |

```bash
# Start from the very beginning of every partition
rpk transform deploy --from-offset +0

# Start 500 records before current end of each partition
rpk transform deploy --from-offset -500

# Start from a specific point in time
rpk transform deploy --from-offset @1617181723000
```

**Important**: `--from-offset` is only honored on the first deploy of a given name. On subsequent redeploys, processing resumes from the last committed offset. To reprocess with an existing transform name, delete it first:

```bash
rpk transform delete my-transform --no-confirm
rpk transform deploy --from-offset +0 --input-topic input --output-topic output
```

### Input and Output Topics Must Exist

Input and output topics must already exist before deploying. If they don't, the deploy fails with an error from the broker. Create topics first:

```bash
rpk topic create input-topic output-topic --partitions 3 --replicas 3
rpk transform deploy
```

## rpk transform list

```
rpk transform list [flags]    (alias: ls)
```

| Flag | Description |
|---|---|
| `-d, --detailed` | Print per-partition processor info (partition, node, status, lag) |
| `--format` | `json` \| `yaml` \| `text` \| `wide` \| `help` (default: `text`) |

Default (summary) output columns: `NAME`, `INPUT-TOPIC`, `OUTPUT-TOPIC`, `RUNNING`, `LAG`.

`RUNNING` shows `running_processors / total_processors` (e.g. `3 / 3`). `LAG` is the sum of pending records across all partitions.

`--detailed` output per transform:

```
my-transform, raw-events → clean-events
  PARTITION  NODE  STATUS   LAG
  0          1     running  0
  1          0     running  0
  2          2     running  0
```

Processor `STATUS` values: `running`, `inactive` (paused), `errored`.

```bash
# Watch transforms in JSON
watch rpk transform list --format json
```

## rpk transform logs

```
rpk transform logs NAME [flags]    (alias: log)
```

Transform stdout and stderr are written to the internal topic `_redpanda.transform_logs`. This command reads and displays them.

| Flag | Description |
|---|---|
| `-f, --follow` | Stream new logs in real time |
| `--since` | Start time (see formats below) |
| `--until` | End time (same formats) |
| `--head N` | First N log entries |
| `--tail N` | Last N log entries (mutually exclusive with `--follow`) |
| `--format` | `text` \| `wide` \| `json` (default: `text`) |

### Time Formats for --since / --until

| Format | Example | Meaning |
|---|---|---|
| `now` | `--since=now` | Current time |
| 13-digit integer | `1617181723000` | Unix millisecond |
| 10-digit integer | `1617181723` | Unix second |
| `YYYY-MM-DD` | `2024-03-12` | Start of day UTC |
| `YYYY-MM-DDTHH:MM:SSZ` | `2024-03-12T12:00:00Z` | RFC3339 UTC |
| `-dur` | `-1h`, `-30m`, `-5s` | Relative past |
| `dur` | `10s` | Relative future |

### Log Levels

- `INFO`: record came from the transform's **stdout**
- `WARN`: record came from the transform's **stderr**

### Format Modes

- `text` (default): prints the log body line by line.
- `wide`: `<date> <LEVEL> <message>` — includes timestamp and level prefix.
- `json`: emits the raw OpenTelemetry LogRecord JSON.

### Examples

```bash
# Logs from the last hour
rpk transform logs my-transform --since=-1h

# Logs prior to 30 minutes ago
rpk transform logs my-transform --until=-30m

# Logs between noon and 1pm on a specific date
rpk transform logs my-transform \
  --since=2024-03-12T12:00:00Z \
  --until=2024-03-12T13:00:00Z

# Follow new logs with timestamp/level prefix
rpk transform logs my-transform --follow --format=wide

# Last 20 log entries
rpk transform logs my-transform --tail 20
```

## rpk transform pause

```
rpk transform pause NAME
```

Suspends execution of all processors for the named transform without deleting it. Processors show as `inactive` in `rpk transform list`. Each processor commits its offset before pausing; on resume it picks up from the last committed offset.

## rpk transform resume

```
rpk transform resume NAME
```

Restarts all processors for a paused transform. Each partition processor resumes from its last committed offset.

## rpk transform delete

```
rpk transform delete NAME [--no-confirm]
```

Permanently removes the transform and its committed offset state. By default, prompts for confirmation.

After deletion, the transform name is free to be redeployed with a different `--from-offset`.

## Updating an Existing Transform

To update a deployed transform in-place (no reprocessing):

1. Edit the source code.
2. `rpk transform build`
3. `rpk transform deploy` (same name)

On redeploy with the same name, Redpanda replaces the Wasm binary and resumes processing from the last committed offset. Deploy-time flags (`--var`, `--compression`) must be re-provided each time or they revert to defaults/`transform.yaml` values.

## Cluster Configuration Properties

Set with `rpk cluster config set <property> <value>`.

| Property | Default | Description |
|---|---|---|
| `data_transforms_enabled` | `false` | Enable/disable the feature (rolling restart required) |
| `data_transforms_per_core_memory_reservation` | (varies) | Total Wasm memory reserved per CPU core |
| `data_transforms_per_function_memory_limit` | (varies) | Memory ceiling for a single function instance |
| `data_transforms_binary_max_size` | (varies) | Maximum .wasm binary size that can be deployed |
| `data_transforms_commit_interval_ms` | (varies) | Interval at which transforms commit their progress |
| `data_transforms_runtime_limit_ms` | (varies) | Max CPU time allowed per record transform |
| `data_transforms_logging_buffer_capacity_bytes` | (varies) | Log buffer capacity before flush |
| `data_transforms_logging_flush_interval_ms` | (varies) | Interval between log flushes to the logs topic |
| `data_transforms_logging_line_max_bytes` | (varies) | Maximum log line length (truncated if exceeded) |

**Sizing guidance**: the maximum number of concurrently running transforms per core equals `data_transforms_per_core_memory_reservation / data_transforms_per_function_memory_limit`. If this limit is exceeded, new VMs cannot be allocated and processors enter an `errored` state.

> **Redpanda Cloud:** only a curated subset of these is settable in Cloud (at verification time: `data_transforms_enabled`, `data_transforms_binary_max_size`, `data_transforms_per_core_memory_reservation`, `data_transforms_per_function_memory_limit`, `data_transforms_logging_line_max_bytes`); the rest are managed by Redpanda, and setting an unsupported property returns `REASON_INVALID_INPUT`. Check the Cloud "Cluster Configuration Properties" reference page for the current list.

## Monitoring Metrics

Scraped from `/public_metrics` (Prometheus format). All transform metrics carry a `function_name` label identifying the transform. Note: `transform_name` is the log-record attribute key in `_redpanda.transform_logs` JSON — it is **not** a Prometheus metric label; use `function_name` in PromQL filters. `redpanda_transform_state` also carries a `state` label (values: `running`, `inactive`, `errored`).

| Metric | Type | Description |
|---|---|---|
| `redpanda_transform_execution_latency_sec` | histogram | Latency of transform function executions |
| `redpanda_transform_execution_errors` | counter | Execution errors (non-fatal, logged and continued) |
| `redpanda_transform_failures` | counter | Fatal failures causing VM restart |
| `redpanda_transform_state` | gauge | Count of transform processors currently in each state; carries a `state` label = `running`\|`inactive`\|`errored` |
| `redpanda_transform_processor_lag` | gauge | Records pending per processor partition |
| `redpanda_transform_read_bytes` | counter | Bytes read from input topic |
| `redpanda_transform_write_bytes` | counter | Bytes written to output topic(s) |
| `redpanda_wasm_engine_cpu_seconds_total` | counter | Wasm engine total CPU time |
| `redpanda_wasm_engine_memory_usage` | gauge | Current Wasm engine memory usage |
| `redpanda_wasm_engine_max_memory` | gauge | Configured max Wasm engine memory |
| `redpanda_wasm_binary_executable_memory_usage` | gauge | Memory used by JIT-compiled transform binaries |

### Example PromQL queries

```promql
# Transforms with non-zero lag
redpanda_transform_processor_lag > 0

# Error rate per transform (filter by function_name label)
rate(redpanda_transform_execution_errors{function_name="my-transform"}[5m])

# Processors in the errored state across all transforms
redpanda_transform_state{state="errored"}

# Processors currently running for a specific transform
redpanda_transform_state{function_name="my-transform", state="running"}
```

## Troubleshooting

### "unable to find logs topic — is Redpanda on the right version with Data Transforms enabled?"

The `_redpanda.transform_logs` topic doesn't exist yet. Ensure `data_transforms_enabled` is `true` and that at least one transform has been deployed.

### Invalid WebAssembly error on deploy

```
Invalid WebAssembly - the binary is missing required transform functions.
```

The Wasm binary is missing the `OnRecordWritten` / `on_record_written` / `onRecordWritten` callback registration. Ensure your `main()` calls the registration function. Rebuild with `rpk transform build`.

### Invalid transform environment on deploy

One or more custom environment variables violate the constraints. Check:
- No key starts with `REDPANDA_`
- Each key < 128 bytes
- Total combined values < 2000 bytes
- All keys and values are UTF-8 with no control characters

### Processors stuck in errored state

Check:
1. `rpk transform logs <name> --tail 50` for error messages.
2. `redpanda_transform_failures` and `redpanda_transform_execution_errors` metrics.
3. Whether the transform is consuming too much memory (`redpanda_wasm_engine_memory_usage`). Increase `data_transforms_per_function_memory_limit` if needed.
4. If the input record causes a panic, the VM restarts and reprocesses — consider adding error handling to skip bad records.

### High lag

Check `redpanda_transform_processor_lag` per processor. If lag is growing:
- Look at `redpanda_transform_execution_latency_sec` — slow transform logic.
- Look at `redpanda_wasm_engine_cpu_seconds_total` — CPU throttling.
- Consider switching to `tinygo-no-goroutines` for lower overhead (if using goroutines).
- Increase the partition count on the input topic to create more parallel processors.
