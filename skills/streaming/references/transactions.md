# Transactions and Exactly-Once Semantics

## Idempotence vs Transactions

**Idempotent producers** (`enable.idempotence=true`) prevent duplicate records within a single topic-partition due to producer retries. The broker uses a producer ID (PID) + sequence number to detect and reject duplicates. Idempotence is scoped to a single producer session.

**Transactions** extend this guarantee across multiple topic-partitions and across producer + consumer in a single atomic unit. With transactions:
- Either **all** records in the transaction are committed, or **none** are.
- Consumer offsets can be committed atomically along with produced records (read-process-write pattern).
- Consumers can filter out aborted transactions using `isolation.level=read_committed`.

Together, idempotent producers + transactions provide **exactly-once semantics (EOS)**.

## Enabling Transactions

The cluster property `enable_transactions` defaults to `true`. The cluster property `enable_idempotence` also defaults to `true`. No broker-side change is needed for a standard Redpanda deployment.

The producer must set:
- `transactional.id`: a stable, unique string identifying this producer across sessions. This lets Redpanda detect and roll back any incomplete transaction from a previous session of the same logical producer before starting a new one.
- `enable.idempotence=true` (required when using transactions)
- `acks=all` (required when using transactions)

## Transaction Kafka API Flow

Redpanda implements these Kafka API handlers for transactions:

| API | Handler version range | Purpose |
|---|---|---|
| `InitProducerId` | 0–3 | Assigns a PID (producer ID) and epoch to the producer; fences any prior session with the same `transactional.id` |
| `AddPartitionsToTxn` | 0–3 | Registers which topic-partitions are part of the current transaction |
| `AddOffsetsToTxn` | 0–1 | Registers consumer group offsets to be committed atomically |
| `TxnOffsetCommit` | 0–3 | Commits consumer group offsets within the transaction scope |
| `EndTxn` | 0–3 | Commits or aborts the transaction |

The client library wraps these in the producer's `initTransactions()` / `beginTransaction()` / `commitTransaction()` / `abortTransaction()` calls.

## Producer API Sequence (Java)

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("acks", "all");
props.put("enable.idempotence", "true");
props.put("transactional.id", "my-app-txn-001"); // stable, unique per producer instance
props.put("key.serializer",
    "org.apache.kafka.common.serialization.StringSerializer");
props.put("value.serializer",
    "org.apache.kafka.common.serialization.StringSerializer");

KafkaProducer<String, String> producer = new KafkaProducer<>(props);

// Call once at startup; fences prior sessions with same transactional.id
producer.initTransactions();

producer.beginTransaction();
try {
    producer.send(new ProducerRecord<>("ledger-a", "account-1", "-100"));
    producer.send(new ProducerRecord<>("ledger-b", "account-2", "+100"));
    producer.commitTransaction();
} catch (ProducerFencedException | OutOfOrderSequenceException e) {
    // Fatal: another producer with the same transactional.id has taken over
    producer.close();
} catch (KafkaException e) {
    producer.abortTransaction();
}
```

### Outcome Guarantees

- If `commitTransaction()` returns without error: all records are durably committed.
- If `commitTransaction()` times out: the transaction status is unknown. Redpanda guarantees **no partial result**: either the transaction is fully committed or fully rolled back. The client should treat the status as unknown and consult application-level idempotency (e.g., a unique transaction ID in the record value) to decide whether to retry.
- If `abortTransaction()` is called: all records in the transaction are rolled back.

## Exactly-Once Stream Processing (Read-Process-Write)

The most important EOS pattern: consume from one topic, transform, and produce to another topic, committing the consumed offset atomically with the produced output.

```java
Properties pprops = new Properties();
pprops.put("bootstrap.servers", "localhost:9092");
pprops.put("acks", "all");
pprops.put("enable.idempotence", "true");
pprops.put("transactional.id", "stream-processor-1");
pprops.put("key.serializer", "...StringSerializer");
pprops.put("value.serializer", "...StringSerializer");

Properties cprops = new Properties();
cprops.put("bootstrap.servers", "localhost:9092");
cprops.put("group.id", "stream-processor-group");
cprops.put("enable.auto.commit", "false");         // MUST be false
cprops.put("auto.offset.reset", "earliest");
cprops.put("isolation.level", "read_committed");   // MUST for EOS
cprops.put("key.deserializer", "...StringDeserializer");
cprops.put("value.deserializer", "...StringDeserializer");

KafkaProducer<String,String> producer = new KafkaProducer<>(pprops);
KafkaConsumer<String,String> consumer = new KafkaConsumer<>(cprops);
producer.initTransactions();
consumer.subscribe(Collections.singleton("source-topic"));

while (true) {
    ConsumerRecords<String,String> records = consumer.poll(Duration.ofSeconds(1));
    for (ConsumerRecord<String,String> record : records) {
        String transformed = record.value().toUpperCase();

        producer.beginTransaction();
        try {
            producer.send(new ProducerRecord<>("target-topic", record.key(), transformed));

            // Commit the source offset atomically with the produced record
            Map<TopicPartition, OffsetAndMetadata> offsets = new HashMap<>();
            offsets.put(
                new TopicPartition(record.topic(), record.partition()),
                new OffsetAndMetadata(record.offset() + 1)
            );
            producer.sendOffsetsToTransaction(offsets, consumer.groupMetadata());
            producer.commitTransaction();
        } catch (Exception e) {
            producer.abortTransaction();
            // reinitialize consumer and producer on fatal errors
        }
    }
}
```

Key points in this pattern:
- `enable.auto.commit=false`: the consumer never commits independently; the producer commits its offsets inside the transaction.
- `isolation.level=read_committed` on the consumer: it won't see records from in-flight or aborted transactions.
- `sendOffsetsToTransaction(offsets, consumer.groupMetadata())`: sends an `AddOffsetsToTxn` + `TxnOffsetCommit` atomically.

## Exactly-Once Configuration Requirements

Redpanda's defaults already satisfy EOS requirements:

| Cluster property | Required value | Default |
|---|---|---|
| `enable_idempotence` | `true` | `true` |
| `enable_transactions` | `true` | `true` |
| `transaction_coordinator_delete_retention_ms` | >= `transactional_id_expiration_ms` | Check cluster config |

## Consumers and `isolation.level`

| `isolation.level` | Behavior |
|---|---|
| `read_uncommitted` (default) | Consumers see all records including those from in-progress or aborted transactions |
| `read_committed` | Consumers only see records from committed transactions; aborted records are filtered; the consumer's high-watermark is the **Last Stable Offset (LSO)** — it cannot advance past any open transaction |

Important consequence of `read_committed`: a large open transaction with a long `transaction.timeout.ms` can hold back the LSO and block consumers from seeing subsequent committed records. Keep `transaction.timeout.ms` as small as your processing time allows.

## Transactions with Compacted Topics

Transactions work on topics with `cleanup.policy=compact`. During compaction, aborted transaction data is removed from the log. The resulting compacted segment contains only committed data batches, which may produce gaps in offsets (harmless). Topics with `cleanup.policy=compact,delete` also apply retention-based deletion to committed segments.

## KIP-890 / Transactions V2 Note

Redpanda does **not** implement KIP-890 (Transactions V2 server-side defense). Kafka 4.x clients detect that Transactions V2 is unsupported and automatically fall back to the original transaction protocol (per-transaction epoch bumping is part of V2 and does not apply). This is transparent to the application.

## Tuning Transactional Workloads

### Producer ID Limits

For production environments with many producers or transactions:

- `max_concurrent_producer_ids`: Limits the number of concurrent producer IDs per shard. Start with 1000–5000 per shard and adjust. Applications with many partitions per producer may need 10,000+.
- `transactional_id_expiration_ms`: Time before an inactive transactional ID expires. Set to your longest expected transaction time plus a safety buffer (e.g., if transactions run for 30 minutes, use 2–4 hours). Shorter values free memory faster.

Reuse producer instances when possible — avoid creating a new producer per transaction, as this causes producer ID churn. Avoid random `transactional.id` values (as some Flink configs do); use stable IDs that can be resumed across restarts.

Metrics to monitor (self-managed clusters):
- `vectorized_cluster_producer_state_manager_evicted_producers`: Number of evicted producers (should be 0 in steady state).
- `vectorized_cluster_producer_state_manager_producer_manager_total_active_producers`: Current active producers per shard.

### Transaction Coordinator Limits

- `max_transactions_per_coordinator`: Maximum concurrent transactions per coordinator. Total cluster limit = `max_transactions_per_coordinator * transaction_coordinator_partitions` (default 50 partitions).
- If clients create a new `transactional.id` per transaction and don't reuse IDs, the total accumulates and bloats memory.
- Transactional metadata is stored in the internal topic `kafka_internal/tx`. Tune `transaction_coordinator_delete_retention_ms` to manage its disk usage.

### Avoid Long Transactions

Long-running transactions holding open `read_committed` consumers block the LSO from advancing. Set `transaction.timeout.ms` on the client to as small a value as your processing allows.
