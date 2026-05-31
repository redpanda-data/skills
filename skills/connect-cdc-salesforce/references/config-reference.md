# salesforce_cdc Config Reference

Every field in the `salesforce_cdc` input, grounded in:
- `internal/impl/salesforce/input_salesforce_cdc.go` — main input config spec
- `internal/impl/salesforce/config.go` — shared auth, checkpoint, gRPC, HTTP field definitions
- `internal/impl/salesforce/salesforcegrpc/client.go` — gRPC Pub/Sub endpoint constant

The component is registered as `"salesforce_cdc"` in `init()` and gated by `license.CheckRunningEnterprise`.

---

## Authentication Fields

These four fields are shared by all Salesforce inputs and are defined by `authFieldSpecs()` in `config.go`.

### `org_url`

**Type**: `string` | **Required**: yes

Salesforce instance base URL — protocol included, no trailing slash. Used as the base URL for both the OAuth token endpoint and REST queries.

- Production: `https://{my-domain}.my.salesforce.com`
- Sandbox: `https://{my-domain}.sandbox.my.salesforce.com`
- Legacy instance URLs (`https://na123.salesforce.com`) still work but My Domain URLs are strongly recommended.

```yaml
org_url: https://acme.my.salesforce.com
# Sandbox:
org_url: https://acme--staging.sandbox.my.salesforce.com
```

### `client_id`

**Type**: `string` | **Required**: yes

Consumer Key of the Salesforce Connected App authorized for the OAuth Client Credentials flow. Find it under Setup → App Manager → [your app] → Manage Consumer Details.

```yaml
client_id: ${SALESFORCE_CLIENT_ID}
```

### `client_secret`

**Type**: `string` | **Required**: yes | **Secret**

Consumer Secret of the Salesforce Connected App, paired with `client_id`. Use environment variable interpolation — do not inline the secret in config files.

```yaml
client_secret: ${SALESFORCE_CLIENT_SECRET}
```

### `api_version`

**Type**: `string` | **Default**: `"v65.0"`

Salesforce REST API version to target, prefixed with `v`. Affects endpoint paths (`/services/data/{api_version}/...`). Must be supported by your org — check Setup → Company Information.

```yaml
api_version: v65.0   # default
api_version: v62.0   # older version
```

---

## Topic Fields

### `topics`

**Type**: `array` (list of strings) | **Required**: yes (at least one entry)

Pub/Sub topics to subscribe to. Each entry maps to one independent gRPC subscription with its own replay cursor. Duplicate entries are rejected.

Accepted forms (resolved by `parseCDCTopic` in `input_salesforce_cdc.go`):

| Input form | Resolves to | Kind |
|---|---|---|
| `Account` | `/data/AccountChangeEvent` | CDC per-sObject |
| `/data/AccountChangeEvent` | `/data/AccountChangeEvent` | CDC per-sObject |
| `/data/ChangeEvents` | `/data/ChangeEvents` | CDC firehose |
| `/event/Order__e` | `/event/Order__e` | Platform Event |
| `/event/LoginEventStream` | `/event/LoginEventStream` | Standard Platform Event |

A bare sObject name (no `/`) is shorthand for `/data/<sObject>ChangeEvent`. Slashes in an entry must use the `/data/` or `/event/` prefix — any other prefix is rejected.

```yaml
topics:
  - Account
  - Contact
  - Opportunity

# CDC firehose (all CDC-enabled sObjects in one subscription):
topics:
  - /data/ChangeEvents

# Mixed CDC + Platform Event:
topics:
  - Account
  - /event/Order_Created__e

# Platform Events only:
topics:
  - /event/Order__e
  - /event/LoginEventStream
```

**Constraints**:
- The firehose (`/data/ChangeEvents`) should not be mixed with per-sObject CDC channels (`/data/AccountChangeEvent`, etc.) — the firehose already covers all of them.
- Platform Event topics (`/event/...`) are never snapshotted — they have no REST equivalent.
- Each CDC topic (`/data/...`) requires Change Data Capture to be enabled for the corresponding sObject in Salesforce Setup.

---

## Snapshot Fields

### `stream_snapshot`

**Type**: `bool` | **Default**: `true`

When `true`, the connector paginates a full REST snapshot of every CDC sObject in `topics` before opening any streaming subscriptions. Snapshot rows carry `operation: read` metadata and no `replay_id`.

When `false`, skip the snapshot and start streaming immediately from the configured `replay_preset`.

Platform Event topics (`/event/...`) are always skipped — they have no REST equivalent.

```yaml
stream_snapshot: true   # default — back-fill existing records
stream_snapshot: false  # streaming-only, no historical data
```

### `snapshot_max_batch_size`

**Type**: `int` | **Default**: `2000`

Page size for the REST snapshot query — records per `/query` response. Salesforce REST API enforces a range of 200–2000.

- Larger pages reduce HTTP round trips but increase peak memory per fetch.
- Smaller pages reduce memory pressure but increase API call quota consumption.

```yaml
snapshot_max_batch_size: 2000   # default (maximum)
snapshot_max_batch_size: 500    # more conservative
```

### `max_parallel_snapshot_objects`

**Type**: `int` | **Default**: `1`

Number of sObjects snapshotted concurrently during the REST snapshot phase. Each in-flight snapshot consumes one HTTP connection and one Salesforce API call per page.

Default `1` serializes the work (safe for API quota). Raise when snapshotting many sObjects and your Salesforce API limits allow it.

```yaml
max_parallel_snapshot_objects: 1    # default (serial)
max_parallel_snapshot_objects: 3    # parallel (use with care for API quota)
```

---

## Streaming Fields

### `replay_preset`

**Type**: `string enum` | **Default**: `"latest"` | **Values**: `latest`, `earliest`

Initial replay position used per topic **only on first run** — when no checkpoint exists in the cache. Ignored once a topic's replay ID has been written to the cache by a successful ack.

- `latest`: Start from new events only; changes between the prior run and now are skipped.
- `earliest`: Replay from the start of the retention window (24h standard, 72h with Salesforce Enhanced Event Retention). Use after outages to recover missed events.

```yaml
replay_preset: latest    # default — new events only
replay_preset: earliest  # replay from retention start
```

### `stream_batch_size`

**Type**: `int` | **Default**: `100`

Number of events requested per gRPC `Fetch` call, per topic. Each topic's subscription requests this many events at a time from the Salesforce Pub/Sub API.

- Higher values improve throughput under sustained load.
- Lower values give steadier per-event latency.

```yaml
stream_batch_size: 100    # default
stream_batch_size: 500    # higher throughput
```

---

## Checkpoint Fields

### `checkpoint_cache`

**Type**: `string` | **Required**: yes

Name of the cache resource used to persist snapshot cursor and per-topic replay IDs across restarts. The cache must be declared under the top-level `cache_resources` block.

Choose a **durable** cache for production (Redis, PostgreSQL, DynamoDB). An in-memory cache loses all checkpoints on restart, causing the pipeline to re-snapshot from scratch and resubscribe from `replay_preset`.

```yaml
checkpoint_cache: persistent_cache
```

```yaml
# Corresponding cache_resources block:
cache_resources:
  - label: persistent_cache
    redis:
      url: redis://localhost:6379
```

### `checkpoint_cache_key`

**Type**: `string` | **Default**: `"salesforce_cdc"`

Key inside the checkpoint cache where this input's state is stored. The state document is a JSON object containing `snapshot_complete`, `rest_cursor`, and per-topic `topics` replay IDs.

Change this when running multiple `salesforce_cdc` inputs against the same cache resource to avoid state collisions.

```yaml
checkpoint_cache_key: salesforce_cdc          # default
checkpoint_cache_key: sf_cdc_pipeline_2       # when running multiple inputs
```

### `checkpoint_limit`

**Type**: `int` | **Default**: `1024`

Maximum number of unacknowledged batches in-flight (per topic) before that topic pauses reading. Prevents unbounded memory growth when downstream components stall.

- Higher values increase throughput in steady state.
- Lower values bound memory under backpressure.

```yaml
checkpoint_limit: 1024    # default
checkpoint_limit: 256     # tighter backpressure
```

---

## gRPC Tuning Fields (Advanced)

These fields are nested under the `grpc` key. All are optional and have sensible defaults. Defined in `config.go` via `grpcFieldSpec()`.

The Pub/Sub API endpoint is hardcoded to `api.pubsub.salesforce.com:443` (TLS 1.2+). It cannot be overridden.

### `grpc.reconnect_base_delay`

**Type**: `duration` | **Default**: `"500ms"`

Base delay for gRPC reconnection backoff when the Pub/Sub stream drops.

### `grpc.reconnect_max_delay`

**Type**: `duration` | **Default**: `"30s"`

Maximum delay for gRPC reconnection backoff.

### `grpc.reconnect_max_attempts`

**Type**: `int` | **Default**: `0`

Maximum number of gRPC reconnection attempts. `0` means unlimited.

### `grpc.shutdown_timeout`

**Type**: `duration` | **Default**: `"10s"`

Timeout for graceful gRPC client shutdown on pipeline close.

### `grpc.buffer_size`

**Type**: `int` | **Default**: `1000`

Size of the internal gRPC event receive buffer (per subscription). Larger buffers smooth over receive bursts but use more memory.

```yaml
grpc:
  reconnect_base_delay: 500ms   # default
  reconnect_max_delay: 30s      # default
  reconnect_max_attempts: 0     # default (unlimited)
  shutdown_timeout: 10s         # default
  buffer_size: 1000             # default
```

---

## HTTP Tuning Fields (Advanced)

Advanced HTTP client configuration for Salesforce REST calls (OAuth token endpoint and snapshot queries). Nested under the `http` key. Configured via `httpclient.Fields()`.

Most users do not need to change these. The base URL is always `org_url`.

```yaml
http:
  # Standard httpclient fields — timeout, TLS, retries, etc.
  # See Redpanda Connect httpclient documentation for the full list.
```

---

## Batching Fields

### `batching`

**Type**: `object` | **Optional**

Batch policy applied to emitted messages. The schema default for `batching.count` is `0` (count-based batching disabled). The connector falls back to an effective count of `1` **only when no batch policy is configured at all** (i.e. the entire `batching` block is omitted and `IsNoop()` returns true — see input_salesforce_cdc.go:431). If you set only `batching.period` or `batching.byte_size`, count stays `0`. Tune for throughput.

```yaml
batching:
  count: 100       # flush after 100 messages
  period: 1s       # or after 1 second, whichever comes first
  byte_size: 0     # or after N bytes (0 = disabled)
  check: ""        # or when this Bloblang expression returns true
```

### `auto_replay_nacks`

**Type**: `bool` | **Default**: `true` (via `AutoRetryNacksBatchedToggled`)

When `true`, messages rejected (nacked) at the output are automatically replayed. When `false`, rejected messages are dropped. Enabled by `service.AutoRetryNacksBatchedToggled` in the input constructor.

---

## Complete Config Example (All Fields)

```yaml
input:
  label: "sf_cdc_full"
  salesforce_cdc:
    # Authentication
    org_url: https://acme.my.salesforce.com
    client_id: ${SALESFORCE_CLIENT_ID}
    client_secret: ${SALESFORCE_CLIENT_SECRET}
    api_version: v65.0

    # Topics
    topics:
      - Account
      - Contact
      - /event/Order__e

    # Snapshot
    stream_snapshot: true
    snapshot_max_batch_size: 2000
    max_parallel_snapshot_objects: 1

    # Streaming
    replay_preset: latest
    stream_batch_size: 100

    # Checkpoint
    checkpoint_cache: persistent_cache
    checkpoint_cache_key: salesforce_cdc
    checkpoint_limit: 1024

    # gRPC tuning (advanced)
    grpc:
      reconnect_base_delay: 500ms
      reconnect_max_delay: 30s
      reconnect_max_attempts: 0
      shutdown_timeout: 10s
      buffer_size: 1000

    # Batching
    auto_replay_nacks: true
    batching:
      count: 100
      period: 1s

cache_resources:
  - label: persistent_cache
    redis:
      url: redis://localhost:6379
```
