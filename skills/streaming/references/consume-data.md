# Consume Data

## How Consumers Work

Consumers subscribe to one or more topics and receive records by polling the broker. Every record in a partition has an **offset** — a monotonically increasing sequence number starting at 0. Consumers track their position by **committing offsets**: telling the broker which offsets they have processed. If a consumer restarts, it resumes from the last committed offset.

Redpanda implements the full Kafka consumer group protocol:
- `JoinGroup`, `SyncGroup`, `Heartbeat`, `LeaveGroup` for group coordination
- `OffsetCommit`, `OffsetFetch`, `OffsetDelete` for offset management
- `FindCoordinator` to locate the group coordinator broker
- `Fetch` (protocol versions 4–13) for reading records

## Consumer Groups

A **consumer group** (`group.id`) lets multiple consumer instances share the work of consuming a topic. Partitions are divided among the active consumers in the group. For example, a topic with 12 partitions and 3 consumers in the same group means each consumer owns 4 partitions.

When the group membership changes (consumer joins or leaves), a **rebalance** occurs: the group coordinator triggers a new `JoinGroup` / `SyncGroup` cycle and redistributes partitions. During a rebalance, consumption pauses briefly.

Best practices:
- Use a **unique `group.id`** per application. Reusing a group ID across different applications forces all their offset commits into the same `__consumer_offsets` partition, eliminating parallelism benefits.
- A topic can be consumed by multiple independent consumer groups simultaneously; each group tracks its own offsets independently.

## `__consumer_offsets`

Redpanda stores committed offsets in the internal topic `__consumer_offsets`. This is a **compacted** topic; only the most recent committed offset per `(group, topic, partition)` tuple is retained.

When a consumer calls `commitSync()` or `commitAsync()`:
1. The client sends an `OffsetCommitRequest` to the **group coordinator** broker.
2. The coordinator appends the commit to `__consumer_offsets`.
3. All replicas of the offsets topic must receive the commit; only then does the coordinator send a success response.
4. The coordinator caches offsets in memory for fast `OffsetFetchRequest` responses.

If offset replication fails within the configured timeout, the commit fails and the consumer should retry after backing off.

## Key Consumer Configuration Properties

| Property | Default | Notes |
|---|---|---|
| `group.id` | (none) | Required for consumer groups |
| `auto.offset.reset` | `latest` | `earliest`: read from start of log; `latest`: read only new records |
| `enable.auto.commit` | `true` | Auto-commits at `auto.commit.interval.ms` |
| `auto.commit.interval.ms` | 5000 ms | Interval for auto-commit when `enable.auto.commit=true` |
| `session.timeout.ms` | 45000 ms | Max time between heartbeats before the group coordinator considers the consumer dead |
| `heartbeat.interval.ms` | 3000 ms | Frequency of heartbeat to the coordinator |
| `max.poll.interval.ms` | 300000 ms (5 min) | Max time between polls before the consumer is considered stuck |
| `fetch.min.bytes` | 1 | Min data the broker returns per fetch (0 = return immediately) |
| `fetch.max.wait.ms` | 500 ms | Max time the broker waits for `fetch.min.bytes` to be available |
| `max.partition.fetch.bytes` | 1048576 (1 MiB) | Max data per partition per fetch |
| `isolation.level` | `read_uncommitted` | Set `read_committed` to only see committed transactional records |
| `client.rack` | (none) | Set to your AZ/rack ID to enable follower fetching |

## Offset Commit Strategies

### Automatic Offset Commit (default)

The client library commits offsets in the background every `auto.commit.interval.ms` milliseconds when `enable.auto.commit=true`. Simple, but the consumer may re-process a small window of records after a restart (at-least-once delivery).

```java
props.put("enable.auto.commit", "true");
props.put("auto.commit.interval.ms", "1000");
```

### Manual Synchronous Commit

Blocks until the broker confirms the commit. Safer for applications that need to align commits with external state (e.g., writing to a database). Retries automatically on transient errors.

```java
props.put("enable.auto.commit", "false");
// ...
consumer.subscribe(Arrays.asList("orders"));
while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
    for (ConsumerRecord<String, String> record : records) {
        process(record);
    }
    consumer.commitSync(); // blocks
}
```

### Manual Asynchronous Commit

Does not block; registers a callback. Higher throughput but no automatic retry on failure.

```java
consumer.commitAsync((offsets, exception) -> {
    if (exception != null) {
        log.error("Commit failed: {}", exception.getMessage());
    }
});
```

### External Offset Management

For stream-processing frameworks (Spark, Flink) that manage their own offsets:
1. Set `enable.auto.commit=false`.
2. Use `assign()` instead of `subscribe()` to assign partitions directly.
3. Store offsets in your external system (e.g., a database).
4. On restart, call `seek(TopicPartition, long)` to restore position.

## Avoiding Over-Committing

Each commit writes a message to `__consumer_offsets`. At very high commit rates this becomes a bottleneck for both client and broker. Monitor commit latency; if it degrades, reduce commit frequency.

For large-scale applications with many consumers, tune `heartbeat.interval.ms` and `session.timeout.ms` together. For example, 3,200 consumers at 500 ms heartbeat intervals generate 6,400 heartbeats/second. Increasing both to 3 s / 45 s (the defaults) is usually fine.

## `auto.offset.reset` Behavior

| Value | Behavior |
|---|---|
| `latest` (default) | Start reading from the high-watermark (newest records only) |
| `earliest` | Start reading from offset 0 (all available records) |
| `none` | Throw an exception if no committed offset exists for the group |

## Follower Fetching (Rack Awareness)

By default, consumers fetch from the **partition leader**. In multi-AZ or multi-region clusters, leaders may be in a different AZ than the consumer, incurring cross-AZ bandwidth charges and higher latency.

**Follower fetching** (KIP-392) lets Redpanda route fetch requests to the closest replica. The first fetch goes to the leader; the leader checks if a follower with a matching `rack` ID exists. If so, subsequent fetches are redirected to that follower.

To enable:

1. Self-managed: set `enable_rack_awareness=true` in cluster config and set `rack=<az-id>` on each broker.
2. Cloud: rack awareness is pre-enabled in multi-AZ clusters.
3. Consumer: set `client.rack=<az-id>` in the consumer config.

```java
props.put("client.rack", "us-east-1a");
```

> Note: `client.rack` is a Kafka client library configuration (Java, franz-go via `kgo.Rack()`, librdkafka via `client.rack`, etc.) and is **not** settable through rpk's `-X` flags. There is no rpk equivalent for this setting.

## Fetch Sessions

Redpanda supports Kafka's **fetch sessions** protocol (introduced in Kafka 1.0 via KIP-227). Fetch sessions allow the broker to cache the partition metadata for a long-running consumer connection so that incremental fetch requests do not need to re-send the full partition list on every poll. This reduces CPU and network overhead for consumers with many partitions. Fetch sessions are managed transparently by the client library and broker — no user configuration required.

Supported fetch protocol versions: 4–13 (as seen in the handler source: `single_stage_handler<fetch_api, 4, 13>`).

## rpk Examples

```bash
# Consume all records from beginning, print and exit
rpk topic consume orders --from-beginning --brokers localhost:9092

# Consume as part of a consumer group (resume from last committed offset)
rpk topic consume orders --group my-app --brokers localhost:9092

# Consume from a specific offset on partition 0
rpk topic consume orders --offset 0:42 --brokers localhost:9092

# Follow indefinitely with SASL/SCRAM
rpk topic consume orders --group my-app \
  --brokers seed.cloud.redpanda.com:9092 \
  -X tls.enabled=true \
  -X sasl.mechanism=SCRAM-SHA-256 \
  -X user=myuser \
  -X pass=mypassword
```

## Java Consumer Example

```java
import org.apache.kafka.clients.consumer.*;
import java.time.Duration;
import java.util.*;

Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("group.id", "my-app");
props.put("key.deserializer",
    "org.apache.kafka.common.serialization.StringDeserializer");
props.put("value.deserializer",
    "org.apache.kafka.common.serialization.StringDeserializer");
props.put("auto.offset.reset", "earliest");
props.put("enable.auto.commit", "false");
// For transactional topics: props.put("isolation.level", "read_committed");

try (KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props)) {
    consumer.subscribe(List.of("orders"));
    while (true) {
        ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(500));
        for (ConsumerRecord<String, String> r : records) {
            System.out.printf("partition=%d offset=%d key=%s value=%s%n",
                r.partition(), r.offset(), r.key(), r.value());
        }
        if (!records.isEmpty()) {
            consumer.commitSync();
        }
    }
}
```

## franz-go Consumer Example (Go)

```go
package main

import (
    "context"
    "fmt"
    "github.com/twmb/franz-go/pkg/kgo"
)

func main() {
    cl, err := kgo.NewClient(
        kgo.SeedBrokers("localhost:9092"),
        kgo.ConsumerGroup("my-app"),
        kgo.ConsumeTopics("orders"),
        kgo.ConsumeResetOffset(kgo.NewOffset().AtStart()),
    )
    if err != nil {
        panic(err)
    }
    defer cl.Close()

    ctx := context.Background()
    for {
        fetches := cl.PollFetches(ctx)
        if errs := fetches.Errors(); len(errs) > 0 {
            panic(fmt.Sprint(errs))
        }
        fetches.EachRecord(func(r *kgo.Record) {
            fmt.Printf("partition=%d offset=%d key=%s value=%s\n",
                r.Partition, r.Offset, r.Key, r.Value)
        })
        // Commit after processing
        cl.CommitUncommittedOffsets(ctx)
    }
}
```

## Python Consumer Example

```python
from kafka import KafkaConsumer

consumer = KafkaConsumer(
    'orders',
    bootstrap_servers=['localhost:9092'],
    group_id='my-app',
    auto_offset_reset='earliest',
    enable_auto_commit=False,
    key_deserializer=lambda k: k.decode('utf-8') if k else None,
    value_deserializer=lambda v: v.decode('utf-8'),
)

for msg in consumer:
    print(f"partition={msg.partition} offset={msg.offset} "
          f"key={msg.key} value={msg.value}")
    consumer.commit()
```
