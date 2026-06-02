# Produce Data

Producers are client applications that write records to Redpanda topics. They communicate via the Kafka `Produce` API (protocol versions 0–7 are supported by Redpanda). Each record has a key and a value (both optional). When the key is blank, the producer distributes records in a **round-robin** fashion across partitions. When a key is provided, the **producer client** (not the broker) hashes the key using the **murmur2** algorithm (matching the Java DefaultPartitioner) and modulates by partition count to select a partition deterministically — the same key always lands on the same partition. Partition selection happens client-side before the record is sent to the broker.

## Producer Acknowledgment (`acks`)

The `acks` property controls durability:

| `acks` | Behavior | Durability |
|---|---|---|
| `0` | No acknowledgment. Fire-and-forget. | Lowest — data loss on broker crash |
| `1` | Leader acknowledges after local write, before replication | Medium — data loss if leader crashes before replication |
| `all` (or `-1`) | Leader waits for majority quorum **and fsyncs** before acking | Highest |

**Redpanda difference from Kafka**: With `acks=all`, Redpanda fsyncs every message to disk before sending the acknowledgment. In Apache Kafka, `acks=all` acknowledges after all ISR replicas receive the write but without requiring an fsync. Redpanda's default is more durable.

With `write.caching` enabled at the topic level (or `write_caching_default=true` at the cluster level), Redpanda relaxes the fsync requirement: it acknowledges after a majority of brokers receive the write, then fsyncs asynchronously according to `flush.ms` and `flush.bytes`. This trades a small durability window for lower latency.

## Idempotent Producers

**Idempotence** prevents duplicate messages caused by producer retries. Set `enable.idempotence=true` in the producer config.

How it works:
1. The broker assigns each producer a **producer ID (PID)** via the `InitProducerId` Kafka API.
2. Each record batch includes the PID and a monotonically increasing **sequence number**.
3. If the broker receives a duplicate (same PID + sequence number), it rejects the duplicate and returns a success to the client as if the original had just been accepted.

Requirements for full idempotence:
- `enable.idempotence=true`
- `acks=all`
- `max.in.flight.requests.per.connection <= 5` (with idempotence, up to 5 in-flight requests preserve ordering)

Idempotence is scoped to a **session**: from producer creation until the connection closes. If the producer reconnects, a new PID is assigned and the session starts fresh.

> Note: Manually retrying at the application level (sending a new `send()` call after an error) assigns a new sequence number and can produce duplicates. Use the client's built-in `retries` setting instead.

The `enable_idempotence` cluster property (default `true`) can be set to `false` to disable idempotence broker-side, but this is not recommended.

> Client support: idempotence defaults to `true` in the Java client (3.0+) and librdkafka-based clients (confluent-kafka-python, etc.). **kafka-python-ng does not implement idempotent producers at all** — do not pass `enable_idempotence` to that library.

## Compression

Set `compression.type` in the producer config. Compression applies to full batches. Larger batches compress more efficiently.

Producer-side `compression.type` accepts:

| Algorithm | Notes |
|---|---|
| `none` | Default; no compression |
| `gzip` | Good ratio, higher CPU |
| `snappy` | Fast, moderate ratio |
| `lz4` | Very fast; good balance |
| `zstd` | Best ratio; recommended for archival or cost-sensitive workloads |

> Note: The **topic-level** `compression.type` config has a different set of valid values: `producer` (default — honor whatever the producer sends), `uncompressed`, `gzip`, `snappy`, `lz4`, `zstd`. The `producer` and `uncompressed` values are topic-level only and are not valid producer client settings.

```java
props.put("compression.type", "zstd");
```

## Batching

Batching reduces network round trips and disk I/O by grouping multiple records into one request.

| Property | Default | Effect |
|---|---|---|
| `batch.size` | 16384 bytes | Max batch size in bytes. Larger values increase throughput but use more memory. |
| `linger.ms` | 0 ms | How long to wait for more records before sending. `0` = send immediately. Increase to 5–100 ms to fill batches under moderate load. |
| `buffer.memory` | 33554432 bytes (32 MiB) | Total producer memory for all buffered records. |
| `max.block.ms` | 60000 ms | How long `send()` blocks when the buffer is full before throwing an exception. |
| `max.request.size` | 1048576 bytes (1 MiB) | Max size of one produce request. Must be <= `message.max.bytes` on the broker. |

To optimize for **throughput**: increase `batch.size` and `linger.ms`, enable compression.
To optimize for **latency**: keep `linger.ms=0` and `batch.size` small.

## `max.in.flight.requests.per.connection`

Controls how many unacknowledged requests can be outstanding at once. Default is 5.

- Set to `1` to guarantee ordering without idempotence (but kills throughput).
- With `enable.idempotence=true`, up to `5` in-flight requests preserve message ordering even with retries, because the broker uses the PID + sequence number to re-order.

## `retries`

Number of times the producer retries a failed send. Default is 0 in many client libraries (meaning no automatic retry). With idempotent producers, you should set `retries` to a large value (e.g. `Integer.MAX_VALUE`) and rely on the PID + sequence number to prevent duplicates.

## Error Handling

| Error | Retryable | Action |
|---|---|---|
| `LEADER_NOT_AVAILABLE` | Yes | Broker is still starting; retry with backoff |
| `NOT_LEADER_FOR_PARTITION` | Yes | Client has stale metadata; refresh and retry |
| `DUPLICATE_SEQUENCE_NUMBER` | N/A | Broker rejected a duplicate; treat as success |
| `OUT_OF_ORDER_SEQUENCE_NUMBER` | No | Producer state is corrupted; recreate producer |
| `RECORD_TOO_LARGE` | No | Record exceeds `max.message.bytes`; fix at source |
| `TOPIC_AUTHORIZATION_FAILED` | No | ACL issue; check credentials |

## Producer Tuning by Goal

Use this section to quickly select the right knob for your objective. Each setting maps to the relevant section above for full context.

### Quick-Reference Table

| Setting | Java default | Latency rec | Throughput rec | Resilience rec |
|---|---|---|---|---|
| `batch.size` | 16384 bytes | ≤16 KiB (default) | 256 KiB – 1 MiB | Default or larger to reduce request count |
| `linger.ms` | 0 ms | 0 | 5–100 ms | 0 (send promptly, rely on `acks`) |
| `compression.type` | `none` | `none` or `zstd` | `zstd` | `zstd` |
| `buffer.memory` (Java) | 33554432 bytes (32 MiB) | Default | 128–512 MiB | Default or larger to absorb bursts |
| `max.in.flight.requests.per.connection` | 5 | 1–5 | 5 (max with idempotence) | 5 with `enable.idempotence=true` |
| `acks` | `all` (idempotence on) / `1` (off) | `1` or `0` for lowest latency | `1` for highest throughput | `all` |

### Setting Details

**`batch.size`** — maximum byte size of a single record batch per partition. Larger batches improve throughput and compression ratio but increase per-partition memory usage. See [Batching](#batching) above.

- Java: `batch.size` (bytes; default 16384)
- librdkafka: `queue.buffering.max.kbytes` (kilobytes; default 1048576 KB ≈ 1 GiB — effectively unbounded; pair with `queue.buffering.max.ms` to control actual batch fill)
- franz-go: `kgo.ProducerBatchMaxBytes(n int32)` (default ~1 MiB / 1000012 bytes)

**`linger.ms`** — how long to wait for additional records before sending a batch. `0` means send immediately. Increasing this fills batches more efficiently at the cost of added send latency. See [Batching](#batching) above.

- Java: `linger.ms` (default 0 ms)
- librdkafka: `queue.buffering.max.ms` (default **5 ms** — differs from Java's default of 0)
- franz-go: `kgo.ProducerLinger(d time.Duration)` (default 0)

**`compression.type`** — compression algorithm applied to full batches. Larger batches compress more efficiently. `zstd` is the recommended default: best compression ratio of any supported algorithm, moderate CPU cost, and beneficial for all workloads including latency-sensitive ones once batches are non-trivially sized. See [Compression](#compression) above.

- Java: `compression.type` (`none` | `gzip` | `snappy` | `lz4` | `zstd`; default `none`)
- librdkafka: `compression.codec` (same values; default `none`)
- franz-go: `kgo.ProducerBatchCompression(kgo.ZstdCodec())` (default: no compression / `kgo.NoCodec()`)

**`buffer.memory` / `queue.buffering.max.messages`** — total producer memory budget. When the buffer is full, `send()` blocks for up to `max.block.ms` before throwing. For high-throughput producers, increase this to absorb load spikes without back-pressure.

- Java: `buffer.memory` (bytes; default 33554432 = 32 MiB)
- librdkafka: `queue.buffering.max.messages` (message count; default 100000) **and** `queue.buffering.max.kbytes` (kilobytes; default 1048576 KB ≈ 1 GiB). The more restrictive of the two limits applies.
- franz-go: `kgo.MaxBufferedRecords(n int)` and `kgo.MaxBufferedBytes(n int64)` (no hard defaults — grows as needed up to available memory)

**`max.in.flight.requests.per.connection`** — number of unacknowledged requests outstanding at once. See [`max.in.flight.requests.per.connection`](#maxinflightrequestsperconnection) above.

- Java: default 5. With `enable.idempotence=true`, the max safe value is 5 — the broker uses PID + sequence number to reorder any out-of-order arrivals.
- librdkafka: `max.in.flight.requests.per.connection` (default 1000000 — effectively unlimited; **must** be set to ≤ 5 when idempotence is enabled)
- franz-go: idempotence and pipelining are managed internally; franz-go enforces safe in-flight limits automatically when idempotence is active.

**`acks`** — how many acknowledgments to require before considering a record sent. See [Producer Acknowledgment (`acks`)](#producer-acknowledgment-acks) above.

- `acks=0`: no ack, fire-and-forget — lowest latency, highest throughput, no durability guarantee.
- `acks=1`: leader local write only — medium durability. Data loss if the leader crashes before replication completes.
- `acks=all` (or `-1`): full quorum — highest durability. Redpanda also fsyncs before acking (unlike Apache Kafka). With `write.caching=true`, fsync is async and tail latency improves significantly (see Enterprise callouts below).

### Recommended Throughput Config (Per Client)

**Java**

```java
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
props.put(ProducerConfig.COMPRESSION_TYPE_CONFIG, "zstd");
props.put(ProducerConfig.LINGER_MS_CONFIG, 20);
props.put(ProducerConfig.BATCH_SIZE_CONFIG, 262144);           // 256 KiB
props.put(ProducerConfig.BUFFER_MEMORY_CONFIG, 134217728L);    // 128 MiB
props.put(ProducerConfig.MAX_IN_FLIGHT_REQUESTS_PER_CONNECTION, 5);
props.put(ProducerConfig.RETRIES_CONFIG, Integer.MAX_VALUE);
```

**librdkafka (confluent-kafka-python)**

```python
conf = {
    'bootstrap.servers': 'localhost:9092',
    'acks': 'all',
    'enable.idempotence': True,
    'compression.codec': 'zstd',
    'queue.buffering.max.ms': 20,           # linger equivalent
    'queue.buffering.max.kbytes': 262144,   # 256 MiB budget (unit: kbytes)
    'queue.buffering.max.messages': 500000,
    'max.in.flight.requests.per.connection': 5,
    'message.send.max.retries': 2147483647,
}
```

**franz-go (Go)**

```go
cl, err := kgo.NewClient(
    kgo.SeedBrokers("localhost:9092"),
    kgo.RecordPartitioner(kgo.StickyKeyPartitioner(nil)),
    kgo.ProducerBatchCompression(kgo.ZstdCodec()),
    kgo.ProducerLinger(20*time.Millisecond),
    kgo.ProducerBatchMaxBytes(262144),   // 256 KiB
    kgo.MaxBufferedRecords(500000),
    kgo.MaxBufferedBytes(134217728),     // 128 MiB
    // franz-go enforces idempotent-safe in-flight limits automatically
)
```

### Enterprise Feature Callouts

| Feature | Interaction | Recommended producer adjustments |
|---|---|---|
| **Cloud Topics** (~1–2 s write latency) | Each produce request crosses a WAN round trip. Small batches waste bandwidth and stall throughput while waiting for acks. | Raise `linger.ms` to **20–50 ms** so batches accumulate before crossing the WAN. Raise `batch.size` to **256 KiB–1 MiB** and `buffer.memory` to ≥128 MiB. Use `zstd` compression to reduce bytes on the wire. |
| **Tiered Storage with `write.caching=true`** | When the topic-level `write.caching` property is `true` (or the cluster-wide `write_caching_default` is `true`), Redpanda acknowledges `acks=all` after a majority of brokers receive the write but **before** fsync. Fsync is deferred until `flush.ms` / `flush.bytes` thresholds are met. | Use `acks=all` for full durability semantics with dramatically lower tail latency — no fsync stall on the critical path. No producer-side config change required; the latency improvement is automatic once `write.caching` is enabled on the topic or cluster. |

## Broker Timestamps

When a producer sends a message, the timestamp set by the producer (`CreateTime`) may not match the broker's wall clock. Redpanda records its own `broker_timestamp` on each message for use in retention policy calculations. This ensures that segments are not deleted prematurely due to clock skew from producers.

Clock synchronization is the server owner's responsibility; Redpanda does not monitor it. If you use `LogAppendTime`, server clocks affect the time your application sees.

## rpk Examples

```bash
# Produce from stdin, one line = one record
echo 'hello world' | rpk topic produce my-topic --brokers localhost:9092

# Produce key:value pairs
printf 'k1:v1\nk2:v2\n' | rpk topic produce my-topic \
  --format '%k:%v\n' \
  --brokers localhost:9092

# Read from a file
cat records.txt | rpk topic produce my-topic --brokers localhost:9092
```

## Java (Apache Kafka Client) Example

```java
import org.apache.kafka.clients.producer.*;
import java.util.Properties;

Properties props = new Properties();
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
props.put(ProducerConfig.COMPRESSION_TYPE_CONFIG, "zstd");
props.put(ProducerConfig.LINGER_MS_CONFIG, 5);
props.put(ProducerConfig.BATCH_SIZE_CONFIG, 65536);
props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG,
    "org.apache.kafka.common.serialization.StringSerializer");
props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG,
    "org.apache.kafka.common.serialization.StringSerializer");

try (KafkaProducer<String, String> producer = new KafkaProducer<>(props)) {
    ProducerRecord<String, String> record =
        new ProducerRecord<>("my-topic", "order-key", "{\"id\":42}");

    // Async with callback
    producer.send(record, (metadata, ex) -> {
        if (ex != null) {
            ex.printStackTrace();
        } else {
            System.out.printf("topic=%s partition=%d offset=%d%n",
                metadata.topic(), metadata.partition(), metadata.offset());
        }
    });
    producer.flush();
}
```

## franz-go (Go) Example

```go
package main

import (
    "context"
    "fmt"
    "time"
    "github.com/twmb/franz-go/pkg/kgo"
)

func main() {
    cl, err := kgo.NewClient(
        kgo.SeedBrokers("localhost:9092"),
        kgo.RecordPartitioner(kgo.StickyKeyPartitioner(nil)), // murmur2 compatible
        kgo.ProducerBatchCompression(kgo.ZstdCodec()),
        kgo.ProducerLinger(5 * time.Millisecond),
    )
    if err != nil {
        panic(err)
    }
    defer cl.Close()

    ctx := context.Background()

    // Synchronous produce
    results := cl.ProduceSync(ctx,
        &kgo.Record{
            Topic: "my-topic",
            Key:   []byte("order-key"),
            Value: []byte(`{"id":42}`),
        },
    )
    if err := results.FirstErr(); err != nil {
        panic(err)
    }
    r := results[0].Record
    fmt.Printf("partition=%d offset=%d\n", r.Partition, r.Offset)
}
```

## kafka-python-ng (Python) Example

> Note: kafka-python-ng does **not** implement idempotent producers. Passing `enable_idempotence=True` raises a `TypeError` at runtime. If you need idempotent producers, use `confluent-kafka-python` (librdkafka-based) instead.

```python
from kafka import KafkaProducer
import json

# kafka-python-ng does not support idempotence; omit enable_idempotence
producer = KafkaProducer(
    bootstrap_servers=['localhost:9092'],
    acks='all',
    compression_type='zstd',
    value_serializer=lambda v: json.dumps(v).encode('utf-8'),
    key_serializer=lambda k: k.encode('utf-8') if k else None,
)

future = producer.send('my-topic', key='order-key', value={'id': 42})
record_metadata = future.get(timeout=10)
print(f"partition={record_metadata.partition} offset={record_metadata.offset}")
producer.close()
```
