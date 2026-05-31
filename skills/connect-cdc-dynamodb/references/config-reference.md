# aws_dynamodb_cdc: Complete Config Reference

Source: `connect/internal/impl/aws/dynamodb/input_cdc.go`  
Docs: `connect/docs/modules/components/pages/inputs/aws_dynamodb_cdc.adoc`  
Version introduced: **4.79.0**  
Status: Stable — source distributed under Redpanda Community License; no runtime Enterprise license enforced.

---

## Full config with all defaults

```yaml
input:
  aws_dynamodb_cdc:
    # --- Table selection ---
    tables: []                           # required unless table_discovery_mode: tag
    table_discovery_mode: single         # single | tag | includelist
    table_tag_filter: ""                 # required when table_discovery_mode: tag
    table_discovery_interval: 5m        # set 0 to disable periodic rescan

    # --- Checkpointing ---
    checkpoint_table: redpanda_dynamodb_checkpoints
    checkpoint_limit: 1000

    # --- Stream polling ---
    batch_size: 1000                     # max records per GetRecords call (AWS max: 1000)
    poll_interval: 1s                    # wait between polls when no records available
    start_from: trim_horizon             # trim_horizon | latest
    max_tracked_shards: 10000
    throttle_backoff: 100ms

    # --- Snapshot ---
    snapshot_mode: none                  # none | snapshot_only | snapshot_and_cdc
    snapshot_segments: 1                 # parallel Scan segments (1-10)
    snapshot_batch_size: 100             # records per Scan request (max 1000)
    snapshot_throttle: 100ms            # min time between Scan requests per segment
    snapshot_deduplicate: true           # buffer CDC events during snapshot to suppress duplicates
    snapshot_buffer_size: 100000         # max buffered CDC keys (~100 bytes each)

    # --- AWS session (all optional) ---
    region: ""
    endpoint: ""                         # custom endpoint, e.g. for DynamoDB Local
    tcp:
      connect_timeout: 0s               # 0 = no timeout
      keep_alive:
        idle: 15s
        interval: 15s
        count: 9
      tcp_user_timeout: 0s             # Linux-only; 0 = disabled
    credentials:
      profile: ""                        # ~/.aws/credentials profile name
      id: ""                             # access key ID
      secret: ""                         # secret access key (sensitive)
      token: ""                          # session token (short-lived credentials)
      from_ec2_role: false               # use EC2 instance profile
      role: ""                           # IAM role ARN to assume
      role_external_id: ""              # external ID for role assumption
```

---

## Field-by-field reference

### `tables`

| Attribute | Value |
|---|---|
| Type | `array` of strings |
| Default | `[]` |
| Required | Yes, unless `table_discovery_mode: tag` |

Names of the DynamoDB tables to stream from.

- In `single` mode: provide exactly one table.
- In `includelist` mode: provide one or more tables.
- In `tag` mode: this field is ignored; tables are discovered by tag.

```yaml
tables: [orders]
# or
tables:
  - orders
  - customers
  - products
```

---

### `table_discovery_mode`

| Attribute | Value |
|---|---|
| Type | `string` enum |
| Default | `"single"` |
| Options | `single`, `tag`, `includelist` |
| Advanced | yes |

Controls how the connector determines which tables to stream.

- `single` — stream from the single table in `tables` (default).
- `includelist` — stream from all tables listed in `tables` simultaneously.
- `tag` — auto-discover tables by their DynamoDB resource tags. Uses `table_tag_filter` to match. Ignores `tables`.

**Note:** Snapshot modes (`snapshot_only`, `snapshot_and_cdc`) are supported only when the effective configuration is single-table at config-validation time: discovery mode `single`, or `includelist` with exactly one table. `tag` discovery mode always rejects `snapshot_mode` other than `none` at startup — it is treated as multi-table regardless of how many tables the tag filter matches at runtime.

---

### `table_tag_filter`

| Attribute | Value |
|---|---|
| Type | `string` |
| Default | `""` |
| Required | Yes when `table_discovery_mode: tag` |
| Advanced | yes |

Tag filter expression for `tag` discovery mode. Format:

```
"key1:value1,value2;key2:value3"
```

- Values separated by `,` are OR'd within a key.
- Keys separated by `;` are AND'd across all keys.
- A table matches when it has at least one matching value for **every** key in the filter.

Examples:

```yaml
table_tag_filter: "stream-enabled:true"
# Matches: tables tagged stream-enabled=true

table_tag_filter: "environment:prod,staging;team:data,analytics"
# Matches: (environment=prod OR environment=staging) AND (team=data OR team=analytics)
```

---

### `table_discovery_interval`

| Attribute | Value |
|---|---|
| Type | `string` (duration) |
| Default | `"5m"` |
| Advanced | yes |

How often to rescan for new tables when using `tag` or `includelist` mode. Set to `0` to disable periodic rescanning (tables are only discovered at startup). Newly discovered tables get their own shard coordinator.

---

### `checkpoint_table`

| Attribute | Value |
|---|---|
| Type | `string` |
| Default | `"redpanda_dynamodb_checkpoints"` |

Name of the DynamoDB table used to persist shard sequence-number checkpoints. The connector creates this table automatically if it does not exist, using pay-per-request billing with this schema:

```
Partition key: StreamArn (String)
Sort key:      ShardID   (String)
Attribute:     SequenceNumber (String)
```

Snapshot progress is also stored in this table using `ShardID` values like `snapshot#segment#0`, `snapshot#complete`.

---

### `checkpoint_limit`

| Attribute | Value |
|---|---|
| Type | `int` |
| Default | `1000` |
| Advanced | yes |

Maximum number of unacknowledged messages before the connector forces a checkpoint write. Lower values reduce re-processing on restart at the cost of more DynamoDB writes to the checkpoint table.

---

### `batch_size`

| Attribute | Value |
|---|---|
| Type | `int` |
| Default | `1000` |
| Advanced | yes |

Maximum number of records to retrieve from a shard in a single `GetRecords` API call. The AWS GetRecords API returns at most 1000 records per call. This field has no Connect-enforced LintRule or runtime range check; behavior for values outside 1–1000 is governed solely by the AWS API. (Compare with `snapshot_segments`, `snapshot_batch_size`, and `snapshot_throttle`, which do carry LintRule validations.) Lower values reduce memory usage per batch but require more API calls.

---

### `poll_interval`

| Attribute | Value |
|---|---|
| Type | `string` (duration) |
| Default | `"1s"` |
| Advanced | yes |

Time to wait between polling attempts when a `GetRecords` call returns zero records. Higher values reduce API call costs at the expense of latency.

---

### `start_from`

| Attribute | Value |
|---|---|
| Type | `string` enum |
| Default | `"trim_horizon"` |
| Options | `trim_horizon`, `latest` |

Where to begin reading on a shard that has no existing checkpoint.

- `trim_horizon` — start from the oldest available record in the stream (up to 24 hours back).
- `latest` — start from records written after the connector starts; existing stream data is skipped.

Once a checkpoint exists (from a previous run), `start_from` is ignored for that shard — reading resumes from the checkpointed sequence number.

---

### `max_tracked_shards`

| Attribute | Value |
|---|---|
| Type | `int` |
| Default | `10000` |
| Advanced | yes |

Upper bound on the number of shards tracked simultaneously. Prevents unbounded memory growth for very large tables. Typical DynamoDB tables have far fewer shards; increase only if needed.

---

### `throttle_backoff`

| Attribute | Value |
|---|---|
| Type | `string` (duration) |
| Default | `"100ms"` |
| Advanced | yes |

Pause duration applied per shard reader when too many messages are in-flight (backpressure from the output). Separate from the exponential backoff used for AWS throttling errors (initial: 200ms, max: 2s).

---

### `snapshot_mode`

| Attribute | Value |
|---|---|
| Type | `string` enum |
| Default | `"none"` |
| Options | `none`, `snapshot_only`, `snapshot_and_cdc` |

Controls whether and how a full-table Scan is performed before (or instead of) CDC streaming.

| Mode | Behavior |
|---|---|
| `none` | No snapshot. Stream from `start_from` position only. |
| `snapshot_only` | Scan the full table once via DynamoDB Scan API, emit all records as `READ` events, then stop. |
| `snapshot_and_cdc` | Start CDC shard readers first (to capture changes during the scan), then Scan the full table, then continue streaming. |

**Not supported with multi-table mode.** Setting `snapshot_mode` to anything other than `none` with `tag` discovery or an `includelist` of more than one table is a configuration error.

---

### `snapshot_segments`

| Attribute | Value |
|---|---|
| Type | `int` |
| Default | `1` |
| Valid range | 1–10 |
| Advanced | yes |

Number of parallel Scan segments. DynamoDB's parallel scan divides the table into `N` equal segments scanned concurrently. Higher values reduce snapshot duration but consume more read capacity units (RCUs). Start with `1`; increase for large tables with adequate provisioned throughput.

---

### `snapshot_batch_size`

| Attribute | Value |
|---|---|
| Type | `int` |
| Default | `100` |
| Valid range | 1–1000 |
| Advanced | yes |

Maximum items per `Scan` API call during snapshot. Lower values improve backpressure control and reduce per-call RCU consumption; higher values reduce API call overhead. AWS returns at most 1 MB of data per Scan call regardless.

---

### `snapshot_throttle`

| Attribute | Value |
|---|---|
| Type | `string` (duration) |
| Default | `"100ms"` |
| Minimum | must be `> 0` |
| Advanced | yes |

Minimum time between Scan requests per segment. Increase to limit RCU consumption and avoid throttling on provisioned-capacity tables. With `snapshot_segments: 4` and `snapshot_throttle: 200ms`, the connector issues roughly 5 Scan requests/second total (4 segments × 1/0.2s).

---

### `snapshot_deduplicate`

| Attribute | Value |
|---|---|
| Type | `bool` |
| Default | `true` |
| Advanced | yes |

When `true`, the connector records the RFC3339Nano timestamp of each item seen during the snapshot (using the snapshot start time). CDC events for the same item key are dropped if their `ApproximateCreationDateTime` timestamp is at or before the snapshot's recorded timestamp for that item. This prevents a single item from appearing in both the snapshot output and the CDC stream with conflicting values. The comparison is timestamp-based, not DynamoDB stream sequence number-based.

If the deduplication buffer (sized by `snapshot_buffer_size`) overflows, deduplication is disabled and duplicates may occur. The metric `dynamodb_cdc_snapshot_buffer_overflow` is incremented when this happens.

---

### `snapshot_buffer_size`

| Attribute | Value |
|---|---|
| Type | `int` |
| Default | `100000` |
| Advanced | yes |

Maximum number of item keys to hold in the deduplication buffer (approximately 100 bytes per entry). For a buffer of 100,000 entries: ~10 MB. Increase for large tables with high CDC volume during the snapshot window. If the buffer is exceeded, deduplication is disabled silently (the `dynamodb_cdc_snapshot_buffer_overflow` counter increments once).

---

## AWS Session Fields

All AWS fields are optional. When omitted the connector uses the standard AWS credential chain: environment variables, `~/.aws/credentials` profile, EC2/ECS instance metadata.

### `region`

AWS region string (e.g., `us-east-1`, `eu-west-1`). Optional; falls back to `AWS_DEFAULT_REGION` environment variable.

### `endpoint`

Custom endpoint URL. Use `http://localhost:8000` to target DynamoDB Local.

### `credentials.profile`

Profile name from `~/.aws/credentials`.

### `credentials.id` / `credentials.secret` / `credentials.token`

Static access key ID, secret, and optional session token. Prefer IAM roles over static credentials in production.

### `credentials.from_ec2_role`

Set `true` to use the EC2 instance profile IAM role. Available from Connect v4.2.0.

### `credentials.role` / `credentials.role_external_id`

ARN of a role to assume and optional external ID. Used for cross-account access.

---

## Metrics emitted

| Metric name | Type | Description |
|---|---|---|
| `dynamodb_cdc_shards_tracked` | gauge | Total shards being tracked |
| `dynamodb_cdc_shards_active` | gauge | Shards currently being read |
| `dynamodb_cdc_snapshot_state` | gauge | 0=not_started, 1=in_progress, 2=complete, 3=failed |
| `dynamodb_cdc_snapshot_records_read` | counter | Items read during snapshot |
| `dynamodb_cdc_snapshot_segments_active` | gauge | Active parallel scan segments |
| `dynamodb_cdc_snapshot_buffer_overflow` | counter | Times dedup buffer exceeded limit |
| `dynamodb_cdc_snapshot_segment_duration` | timer | Duration per completed scan segment |
| `dynamodb_cdc_checkpoint_failures` | counter | Failed checkpoint writes |
