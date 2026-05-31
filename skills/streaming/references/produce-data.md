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
props.put("compression.type", "lz4");
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
props.put(ProducerConfig.COMPRESSION_TYPE_CONFIG, "lz4");
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
        kgo.ProducerBatchCompression(kgo.Lz4Codec()),
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
    compression_type='lz4',
    value_serializer=lambda v: json.dumps(v).encode('utf-8'),
    key_serializer=lambda k: k.encode('utf-8') if k else None,
)

future = producer.send('my-topic', key='order-key', value={'id': 42})
record_metadata = future.get(timeout=10)
print(f"partition={record_metadata.partition} offset={record_metadata.offset}")
producer.close()
```
