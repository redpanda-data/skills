# Kafka Client Metadata and Connection Settings

Redpanda implements the Kafka protocol, so clients rely on the standard Kafka metadata subsystem to discover which brokers own which partitions and to reconnect after failures. Most Kafka defaults were tuned for clusters where leadership rarely moves. Redpanda's enterprise features — Continuous Data Balancing, Shadow Links failover, Cloud Topics, and Leader Pinning — can change partition ownership or cluster topology more frequently, making these settings worth tuning explicitly.

This reference covers the settings that govern three things:
1. **Metadata refresh** — how quickly clients detect that a partition leader changed
2. **Connection resilience** — how quickly clients reconnect and backoff after a disconnect
3. **Producer blocking and delivery timeouts** — how long a producer waits when metadata is unavailable or a send is retried

## Metadata Refresh

When a partition leadership changes, a client holding stale metadata sends requests to the old leader and receives Kafka error code 6 (`NOT_LEADER_OR_FOLLOWER`, renamed from `NOT_LEADER_FOR_PARTITION` in Kafka 2.6). The client then refreshes metadata and retries. Two settings control how fast this recovery happens and how often proactive refreshes occur.

### Periodic Refresh Interval

| Client | Config key | Default | Notes |
|---|---|---|---|
| Java | `metadata.max.age.ms` | 300000 ms (5 min) | Forces full refresh even if no error detected |
| librdkafka | `topic.metadata.refresh.interval.ms` | 300000 ms (5 min) | Periodic proactive refresh interval |
| librdkafka | `metadata.max.age.ms` | 900000 ms (15 min) | Metadata cache max age = 3 × the interval above; separate from refresh interval |
| franz-go | `kgo.MetadataMaxAge(d)` | 5 min | Direct equivalent of Java `metadata.max.age.ms` |
| KafkaJS | `metadataMaxAge` | 300000 ms (5 min) | Per producer/consumer option, not top-level client |

**Latency goal**: Reduce to 60 000 ms so clients detect stale leadership within one minute without waiting for an error to trigger the fast path.

**Throughput goal**: Keep at the default (300 000 ms). Metadata refreshes use small network bursts; the default is already efficient.

**Resilience goal**: Reduce to 30 000 ms when Continuous Data Balancing (`partition_autobalancing_mode=continuous`) is active — partitions move without advance notice, and a 30 s ceiling limits how long a client can produce to a dethroned leader before refreshing.

```java
// Java — reduce for Continuous Balancing clusters
props.put("metadata.max.age.ms", "30000");
```

```c
/* librdkafka */
rd_kafka_conf_set(conf, "topic.metadata.refresh.interval.ms", "30000", NULL, 0);
```

```go
// franz-go
cl, _ := kgo.NewClient(
    kgo.SeedBrokers("localhost:9092"),
    kgo.MetadataMaxAge(30 * time.Second),
)
```

```javascript
// KafkaJS (set per producer/consumer)
const producer = kafka.producer({ metadataMaxAge: 30000 });
```

### Fast Refresh After Error (librdkafka only)

`topic.metadata.refresh.fast.interval.ms` — initial retry interval after a metadata error or `NOT_LEADER_OR_FOLLOWER` is received, growing exponentially up to the setting's configured maximum (60 000 ms). This ceiling is independent of `retry.backoff.max.ms`.

| Default | Range |
|---|---|
| 100 ms | 1–60 000 ms |

This is the *initial* interval of an exponential backoff sequence, not a fixed fast-refresh rate. The client doubles the interval on successive failures until it reaches 60 000 ms. Keep at 100 ms (default) for most use cases; the default is already optimized for fast recovery.

```c
/* librdkafka — usually leave at default; reduce only if recovery latency is measured to be a problem */
rd_kafka_conf_set(conf, "topic.metadata.refresh.fast.interval.ms", "100", NULL, 0);
```

### Sparse Refresh (librdkafka only)

`topic.metadata.refresh.sparse` — when `true`, metadata requests fetch only topics being actively produced/consumed rather than all known topics. Default: `true`.

Leave at `true` unless you need full cluster topology visibility (e.g., for monitoring). Setting it to `false` generates larger metadata responses and higher broker CPU.

### Topic Creation Propagation (librdkafka only)

`topic.metadata.propagation.max.ms` — how long librdkafka tolerates a newly created topic appearing non-existent in metadata (the topic was created but metadata has not propagated to all brokers yet). Default: 30 000 ms.

This setting is scoped to **new topic creation** only. If producers start immediately after `rpk topic create`, they may receive `ERR__UNKNOWN_TOPIC` during propagation; librdkafka queues messages and retries for up to this timeout before failing them. The default is generous; reduce only if you want faster fail-fast behavior on topic creation races.

### franz-go MetadataMinAge

`kgo.MetadataMinAge(d)` — minimum time between metadata refreshes. Acts as a rate limiter: if a metadata error is detected and the last refresh was within this window, the client waits before re-fetching. Default: **5 s**.

```go
// franz-go — tighten for faster error recovery
cl, _ := kgo.NewClient(
    kgo.SeedBrokers("localhost:9092"),
    kgo.MetadataMaxAge(30 * time.Second),
    kgo.MetadataMinAge(2 * time.Second),   // floor on refresh rate; default is 5s
)
```

---

## Connection Resilience

### Idle Connection Timeout

| Client | Config key | Default | Behavior |
|---|---|---|---|
| Java | `connections.max.idle.ms` | 540 000 ms (9 min) | Closes broker connections idle longer than this |
| librdkafka | `connections.max.idle.ms` | 0 (disabled) | 0 = never close idle connections |
| franz-go | `kgo.ConnIdleTimeout(d)` | 20 s | Idle connections are not reused after this; eviction occurs between 20 s and 40 s (uniform jitter). Note: franz-go marks connections ineligible for reuse rather than actively closing them — the OS reclaims the socket when both sides are idle. |

Keeping idle connections alive avoids the TLS handshake and SASL re-auth overhead on reconnect. However, very long idle timeouts can exhaust broker-side socket limits in large clusters.

**Resilience recommendation**: Set to 60 000 ms in Java (shorter than the 9-minute default) to match TCP keepalive intervals and avoid state buildup. In librdkafka, leave at 0 (broker manages idle timeouts). In franz-go, 30 s default is already conservative.

```java
// Java — reduce from 9 min
props.put("connections.max.idle.ms", "60000");
```

```go
// franz-go
cl, _ := kgo.NewClient(
    kgo.SeedBrokers("localhost:9092"),
    kgo.ConnIdleTimeout(60 * time.Second),
)
```

### TCP Keepalive

`socket.keepalive.enable` — enables TCP `SO_KEEPALIVE`. Available in **librdkafka only** (not in the Java Kafka client, which relies on OS defaults or JVM networking configuration). Default: `false`.

Set to `true` for connections traversing NATs, load balancers, or cloud network infrastructure (e.g., Redpanda Cloud, AWS, GCP). Without keepalive, idle connections can be silently dropped by intermediate devices, leaving the client unaware until the next send times out.

```c
/* librdkafka */
rd_kafka_conf_set(conf, "socket.keepalive.enable", "true", NULL, 0);
```

Java users should configure keepalive at the JVM or OS level (e.g., `-Djava.net.preferIPv4Stack=true` plus OS-level `tcp_keepalive_*` sysctl tuning) since the Java Kafka client does not expose this toggle.

### Reconnect Backoff

| Client | `reconnect.backoff.ms` default | `reconnect.backoff.max.ms` default |
|---|---|---|
| Java | 50 ms | 1 000 ms |
| librdkafka | 100 ms | 10 000 ms |

Clients use exponential backoff between reconnect attempts, growing from `reconnect.backoff.ms` up to `reconnect.backoff.max.ms`. The gap between these two defaults matters: librdkafka will backoff up to 10 s by default, which can slow recovery after a rolling restart.

**Latency goal**: Keep defaults. The fast path (error → metadata refresh → retry) is governed by request-level settings more than reconnect backoff.

**Resilience goal for rapid rolling restarts**: Reduce `reconnect.backoff.max.ms` in librdkafka to 3 000–5 000 ms to reconnect faster after broker bounces.

```java
// Java — defaults are already well-tuned for most workloads
props.put("reconnect.backoff.ms", "50");
props.put("reconnect.backoff.max.ms", "1000");
```

```c
/* librdkafka — tighten max for faster recovery on rolling restarts */
rd_kafka_conf_set(conf, "reconnect.backoff.ms", "100", NULL, 0);
rd_kafka_conf_set(conf, "reconnect.backoff.max.ms", "5000", NULL, 0);
```

franz-go manages TCP reconnects internally and does not expose a direct `reconnect.backoff.ms` equivalent. `kgo.RetryBackoffFn` controls backoff between **request-level retries** (e.g., waiting before re-issuing a failed Produce or Metadata request) — not TCP reconnect timing.

```go
// franz-go — request-retry backoff (not TCP reconnect backoff)
import (
    "math"
    "time"
    "github.com/twmb/franz-go/pkg/kgo"
)

cl, _ := kgo.NewClient(
    kgo.SeedBrokers("localhost:9092"),
    kgo.RetryBackoffFn(func(attempt int) time.Duration {
        base := 250 * time.Millisecond
        cap := 5 * time.Second
        d := time.Duration(float64(base) * math.Pow(2, float64(attempt)))
        if d > cap {
            d = cap
        }
        return d
    }),
)
```

### Request Timeout

`request.timeout.ms` — maximum time the client waits for a response to a single Kafka API request.

| Client | Key | Default | Scope |
|---|---|---|---|
| Java | `request.timeout.ms` | 30 000 ms | All request types (Metadata, Produce, Fetch, etc.) |
| librdkafka | `request.timeout.ms` | 30 000 ms | **Producer ack timeout only** (topic-scoped); use `socket.timeout.ms` (default 60 000 ms) for the global socket-level timeout |
| librdkafka | `socket.timeout.ms` | 60 000 ms | Global per-socket request timeout covering all API types |

> Important: In librdkafka, `request.timeout.ms` is a **producer-only** property governing how long the broker has to ack a produce request. It does not govern Metadata or Fetch requests. For global timeouts in librdkafka, tune `socket.timeout.ms`.

The default 30 000 ms is safe even for Cloud Topics with ~1–2 s write latency. Do not lower `request.timeout.ms` below the maximum expected broker processing time for a single batch.

---

## Producer Blocking and Delivery Timeouts

### max.block.ms (Java only)

`max.block.ms` — how long `KafkaProducer.send()` blocks when the internal send buffer is exhausted or when topic metadata is not yet available. Also bounds `partitionsFor()`, `initTransactions()`, `sendOffsetsToTransaction()`, `commitTransaction()`, and `abortTransaction()`. Default: **60 000 ms**.

**Latency goal**: Reduce to 5 000 ms in low-latency pipelines so back-pressure surfaces quickly.

**Resilience goal**: Raise to 120 000–300 000 ms when Continuous Data Balancing is active or during Shadow Links failover, so producers don't throw `TimeoutException` during the metadata-refresh window.

```java
// Resilience — give more runway during failover
props.put("max.block.ms", "120000");
```

### Delivery Timeout

Total time from `send()` call until the record is acknowledged or permanently failed (includes retries and backoff).

| Client | Key | Default | Notes |
|---|---|---|---|
| Java | `delivery.timeout.ms` | 120 000 ms (2 min) | Enforced constraint: `>= linger.ms + request.timeout.ms`; recommended minimum adds `+ retry.backoff.ms` |
| librdkafka | `message.timeout.ms` | 300 000 ms (5 min) | `0` = infinite (no timeout); also aliased as `delivery.timeout.ms` |
| franz-go | `kgo.RecordDeliveryTimeout(d)` | 0 (no per-record timeout) | Falls back to `kgo.ProduceRequestTimeout` for the per-request bound |
| franz-go | `kgo.ProduceRequestTimeout(d)` | 10 s | Timeout field sent inside the ProduceRequest to the broker |

**Resilience goal**: In Java, raise `delivery.timeout.ms` to 300 000 ms (matching librdkafka's default) when the cluster may be rebalancing. This gives the producer enough runway to survive a leader migration + metadata refresh + retry.

**Constraint reminder (Java)**: `delivery.timeout.ms` is validated at producer construction to be `>= linger.ms + request.timeout.ms`. With defaults (`linger.ms=0`, `request.timeout.ms=30000`), the enforced minimum is 30 000 ms, but set it to at least `linger.ms + retry.backoff.ms + request.timeout.ms` in practice.

```java
// Java — raise for resilience during balancing
props.put("delivery.timeout.ms", "300000");
props.put("request.timeout.ms", "30000");
props.put("linger.ms", "5");
// enforced: delivery.timeout >= linger.ms + request.timeout.ms → 300000 >= 30005 ✓
// recommended: delivery.timeout >= linger.ms + retry.backoff.ms + request.timeout.ms → 300000 >= 30105 ✓
```

```c
/* librdkafka — raise for resilience; 0 = infinite (avoid in production) */
rd_kafka_conf_set(conf, "message.timeout.ms", "300000", NULL, 0);
```

```go
// franz-go — set per-record delivery timeout
cl, _ := kgo.NewClient(
    kgo.SeedBrokers("localhost:9092"),
    kgo.RecordDeliveryTimeout(5 * time.Minute),
    kgo.ProduceRequestTimeout(30 * time.Second),
)
```

### Retry Backoff

| Client | `retry.backoff.ms` default | `retry.backoff.max.ms` default |
|---|---|---|
| Java (3.7+) | 100 ms | 1 000 ms |
| librdkafka | 100 ms | 1 000 ms |

Both Java (since Kafka 3.7, KIP-580) and librdkafka support `retry.backoff.max.ms` as the cap of an exponential backoff sequence starting from `retry.backoff.ms`. Older Java clients treated `retry.backoff.ms` as both floor and ceiling.

**Resilience goal**: Raise `retry.backoff.max.ms` to 5 000 ms when the cluster is under heavy rebalancing load so retries don't pile up.

```java
props.put("retry.backoff.ms", "100");
props.put("retry.backoff.max.ms", "5000");
```

```c
/* librdkafka */
rd_kafka_conf_set(conf, "retry.backoff.ms", "100", NULL, 0);
rd_kafka_conf_set(conf, "retry.backoff.max.ms", "5000", NULL, 0);
```

---

## Enterprise Feature Interactions

### Continuous Data Balancing

`partition_autobalancing_mode=continuous` (enterprise) moves partitions continuously in response to disk or CPU pressure without operator intervention. When a partition migrates, clients talking to the old leader receive error code 6 (`NOT_LEADER_OR_FOLLOWER`). The client must:

1. Invalidate the cached leader for that partition
2. Refresh metadata to discover the new leader
3. Retry the produce/fetch

Recommended client settings alongside this enterprise feature:

| Setting | Recommended value | Why |
|---|---|---|
| `metadata.max.age.ms` / `topic.metadata.refresh.interval.ms` | 30 000 ms | Proactive refresh ceiling limits stale-metadata window |
| `topic.metadata.refresh.fast.interval.ms` (librdkafka) | 100 ms (default) | Already optimized for fast error-triggered refresh |
| `kgo.MetadataMinAge` (franz-go) | 2 s | Reduces the rate-limiter floor for faster recovery |
| `delivery.timeout.ms` / `message.timeout.ms` | 300 000 ms | Give records enough runway to survive a leader transition |
| `max.block.ms` (Java) | 120 000 ms | Prevent spurious `TimeoutException` during metadata refresh |
| `reconnect.backoff.max.ms` (librdkafka) | 3 000–5 000 ms | Reconnect faster after the moved partition's old leader goes idle |

### Shadow Linking Failover

`enable_shadow_linking=true` (enterprise) replicates topics to a shadow cluster for disaster recovery. During `rpk shadow failover`, clients must reconnect to a **completely different bootstrap cluster**.

**Pre-configure multiple bootstrap addresses** from both the primary and shadow cluster. The Java client shuffles the bootstrap list before connecting, so order is not guaranteed — list addresses from both clusters so the client can reach the shadow cluster's brokers after failover regardless of which is tried first. Note: this pattern only makes sense when the primary cluster is unreachable; the client does not understand "primary vs shadow" and will use whichever cluster successfully returns metadata at bootstrap time.

```java
// Primary and shadow broker addresses both listed
props.put("bootstrap.servers",
    "primary-1:9092,primary-2:9092,shadow-1:9092,shadow-2:9092");
```

Additional settings for failover resilience:

| Setting | Recommended value | Why |
|---|---|---|
| `max.block.ms` | 120 000–300 000 ms | Prevents producer failure while the new cluster's metadata is fetched |
| `delivery.timeout.ms` | 300 000 ms | Gives records a budget that survives the reconnect + metadata window |
| `reconnect.backoff.max.ms` | 1 000 ms (Java), 5 000 ms (librdkafka) | Cap backoff so the client retries the shadow brokers quickly |
| `socket.keepalive.enable` (librdkafka) | `true` | Detects a dead primary connection sooner |

> Note: `reconnect.backoff.max.ms` defaults differ by client: Java defaults to 1 000 ms, librdkafka to 10 000 ms. The 10 s librdkafka default can add meaningful recovery latency; reduce it for failover scenarios.

### Cloud Topics

Cloud Topics (`redpanda.storage.mode=cloud`, enterprise) use object storage as the primary store and have higher write latency (~1–2 s vs ~5 ms for regular topics).

The default `request.timeout.ms = 30 000 ms` already provides 15–30× headroom over 1–2 s write latency. **Do not lower it.** The more relevant knob is `delivery.timeout.ms`, which must comfortably exceed the expected produce round-trip including retries:

| Setting | Recommendation |
|---|---|
| `request.timeout.ms` | Keep default (30 000 ms); do not lower |
| `delivery.timeout.ms` | Keep default or raise to 300 000 ms for retry headroom |
| `max.block.ms` | Keep default (60 000 ms) |
| `linger.ms` | Increase to 20–50 ms to batch more records per produce request; higher batch sizes amortize the 1–2 s round trip |

### Leader Pinning

`redpanda.leaders.preference=racks:<az>` (enterprise) pins partition leaders to a specific availability zone. If that AZ's brokers become unavailable, Redpanda temporarily moves leaders to surviving replicas. Client behavior during this event is identical to Continuous Data Balancing — clients receive `NOT_LEADER_OR_FOLLOWER` and must refresh metadata.

Apply the same metadata and delivery timeout settings as Continuous Data Balancing above. Once the pinned AZ recovers, Redpanda moves leaders back automatically; clients detect this via the next periodic or error-triggered metadata refresh.

### Tiered Storage (Cold Reads)

For topics with `redpanda.storage.mode=tiered`, fetching data beyond the local retention window reads from object storage. Object storage fetch latency (typically 50–500 ms for the first segment) can exceed the default `fetch.max.wait.ms` (500 ms) in the consumer, causing the broker to return a FetchResponse with whatever data is currently available rather than waiting for `fetch.min.bytes`.

| Consumer setting | Recommendation for cold-data workloads |
|---|---|
| `fetch.max.wait.ms` | Raise to 1 000–2 000 ms to allow the broker to populate the response from object storage |
| `request.timeout.ms` | Keep at 30 000 ms; cold-data reads complete well within this |
