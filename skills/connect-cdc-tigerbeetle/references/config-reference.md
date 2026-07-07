# tigerbeetle_cdc: Complete Config Reference

Source: `connect/internal/impl/tigerbeetle/input_tigerbeetle.go`
Docs: `rp-connect-docs/modules/components/pages/inputs/tigerbeetle_cdc.adoc` (fields of record: the auto-generated partial `modules/components/partials/fields/inputs/tigerbeetle_cdc.adoc`)
Version introduced: **4.65.0** (per docs page)
Status: **beta** per the docs page (`:status: beta`); the source config spec registers `Stable()` — see the TODO in [SOURCES.md](SOURCES.md).
Support tier: **`certified`** in `connect/internal/plugins/info.csv` — the only CDC input not marked `enterprise` there. The source file carries an Apache-2.0 header and contains no enterprise license check; no Enterprise license is required to run it.
Cloud: `info.csv` marks it `cloud: n` ("not yet certified for cloud") — not available as a Redpanda Cloud managed pipeline.
Build: cgo-only (`//go:build cgo`) — absent from `rpk connect` and the standard Docker image.

The field list below is transcribed from the auto-generated partial and cross-checked against the Go source. If this page drifts, the generated partial wins. On a cgo-enabled binary, `redpanda-connect create tigerbeetle_cdc` prints the live spec.

---

## Full config with all defaults

```yaml
input:
  tigerbeetle_cdc:
    # --- Cluster connection (required) ---
    cluster_id: ""                  # required: 128-bit cluster ID as a decimal string
    addresses: []                   # required: one address per replica, in replica order

    # --- Progress tracking (required) ---
    progress_cache: ""              # required: label of a cache resource

    # --- Pacing (optional) ---
    rate_limit: ""                  # label of a rate_limit resource; "" = no limit
    event_count_max: 2730           # max events fetched per request (> 0)
    idle_interval_ms: 1000          # wait (ms) before re-querying when no events (> 0)
    timeout_seconds: 15             # per-query timeout in seconds (> 0)

    # --- Start position (optional) ---
    timestamp_initial: ""           # TigerBeetle nanosecond timestamp; "" = from the beginning

    # --- Delivery (optional) ---
    auto_replay_nacks: true         # replay nacked messages indefinitely
```

---

## Field-by-field reference

### `cluster_id`

| Attribute | Value |
|---|---|
| Type | `string` |
| Required | Yes |

The TigerBeetle unique 128-bit cluster ID, written as a base-10 integer string. Small integers are valid (`"1"` represents the 128-bit value 1). Lint rule: must match `^[0-9]+$`.

The cluster ID is also used to namespace the progress-cache key: `timestamp_last_<cluster_id>`. Two pipelines reading different clusters can therefore share one cache.

---

### `addresses`

| Attribute | Value |
|---|---|
| Type | `array` of strings |
| Required | Yes (at least one entry) |

IP addresses (`host:port`) of **all** the TigerBeetle replicas in the cluster. The order of addresses must correspond to the order of replicas. A standard cluster has three replicas.

```yaml
addresses:
  - "192.168.1.10:3000"
  - "192.168.1.11:3000"
  - "192.168.1.12:3000"
```

---

### `progress_cache`

| Attribute | Value |
|---|---|
| Type | `string` |
| Required | Yes (must name an existing cache resource) |

Label of a [cache resource](https://docs.redpanda.com/redpanda-connect/components/caches/about) used to track progress by storing the last acknowledged timestamp. This allows Redpanda Connect to resume from the latest delivered event upon restart.

Config validation fails at startup if no `cache_resources` entry with this label exists. Mechanics (from source):

- Key: `timestamp_last_<cluster_id>`; value: the last acknowledged event timestamp as an 8-byte little-endian unsigned integer.
- Written by the batch ack function — progress only advances when the output acknowledges the batch.
- On restart: if the key exists, streaming resumes from the next event; if not, streaming starts from the beginning (or `timestamp_initial`).

Use a persistent cache (`redis`, `aws_dynamodb`, `sql`) in production. An in-memory cache re-streams everything on every restart.

---

### `rate_limit`

| Attribute | Value |
|---|---|
| Type | `string` |
| Default | `""` (no limit) |

Label of an optional [rate limit resource](https://docs.redpanda.com/redpanda-connect/components/rate_limits/about/) to throttle the number of **requests** made to TigerBeetle (not events — one request fetches up to `event_count_max` events). If set, the resource must exist or config validation fails.

---

### `event_count_max`

| Attribute | Value |
|---|---|
| Type | `int` |
| Default | `2730` |
| Constraint | must be greater than zero (lint + runtime check) |

The maximum number of events fetched from TigerBeetle per **request**.

---

### `idle_interval_ms`

| Attribute | Value |
|---|---|
| Type | `int` (milliseconds) |
| Default | `1000` |
| Constraint | must be greater than zero (lint + runtime check) |

The time interval in milliseconds to wait before querying again when the last request returned no events. When a request does return events, the connector does not idle — per the source, it waits for the consumer to begin flushing the current results before issuing a new query, avoiding unnecessary idle time for high-frequency, low-volume workloads.

---

### `timestamp_initial`

| Attribute | Value |
|---|---|
| Type | `string` |
| Default | `""` |
| Constraint | when non-empty, must match `^[0-9]+$` (a valid integer) |

The initial timestamp to start extracting events from, **inclusive**. This is a TigerBeetle timestamp with nanosecond precision. If not defined, all CDC events available in the TigerBeetle cluster are included.

Ignored if a more recent timestamp has already been acknowledged: the connector takes `max(cached_timestamp, timestamp_initial - 1)` as its resume point, so a stale `timestamp_initial` never rewinds a checkpointed pipeline. To force a rewind, delete the cache key `timestamp_last_<cluster_id>`.

---

### `timeout_seconds`

| Attribute | Value |
|---|---|
| Type | `int` (seconds) |
| Default | `15` |
| Constraint | must be greater than zero (lint + runtime check) |

The timeout in seconds for querying the TigerBeetle cluster. Each change-event request is bounded by this timeout; on expiry the client connection is closed and the read fails with a timeout error.

> Note: this field is present in the auto-generated fields partial and the Go source but missing from the hand-listed Fields section of the docs page — see the TODO in [SOURCES.md](SOURCES.md).

---

### `auto_replay_nacks`

| Attribute | Value |
|---|---|
| Type | `bool` |
| Default | `true` |

Whether messages rejected (nacked) at the output level are automatically replayed indefinitely. If the cause of rejection persists this results in backpressure. If set to `false`, nacked messages are deleted. Disabling auto replays can improve memory efficiency of high-throughput streams. (This is the standard Connect auto-retry-nacks toggle.)

---

## Validation summary

Config-time (lint) and startup checks, from source:

| Check | Failure |
|---|---|
| `cluster_id` not a base-10 integer string | lint error / startup error |
| `addresses` empty | lint error / startup error |
| `progress_cache` label not found in `cache_resources` | startup error |
| `rate_limit` set but label not found in `rate_limit_resources` | startup error |
| `event_count_max <= 0`, `idle_interval_ms <= 0`, `timeout_seconds <= 0` | lint error / startup error |
| `timestamp_initial` non-empty and not an integer string | lint error / startup error |

## Metrics

The connector defines no custom metrics in source (unlike `aws_dynamodb_cdc`); only the standard Connect input metrics apply.

## Guarantees

At-least-once delivery with strict ordering: a single batch is in flight at a time, and the next batch is only dispatched after the current one is acknowledged. During crash recovery, unacknowledged messages may be replayed. Consumers must perform idempotency checks; the nanosecond `timestamp` metadata field is unique per event.
