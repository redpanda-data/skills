---
name: streaming
description: >-
  Teaches how to use the Redpanda broker through its Kafka-compatible API.
  Covers producing data, consuming data, consumer groups, idempotent producers,
  exactly-once semantics, transactions, topic creation and configuration, Kafka
  client compatibility, and tiered storage. Use when: producing to or consuming
  from Redpanda; creating or configuring topics via the Kafka API; working with
  consumer groups, offsets, or __consumer_offsets; enabling exactly-once
  semantics or transactions; choosing a Kafka client library (Java, Go
  franz-go, librdkafka, kafka-python-ng, Rust, Node.js KafkaJS); understanding
  Kafka protocol compatibility; enabling tiered/shadow storage on a topic;
  troubleshooting idempotent producers, acks, compression, or batching;
  configuring follower fetching or rack awareness; understanding how Redpanda
  differs from Apache Kafka (no ZooKeeper, no JVM, thread-per-core, Raft).
  Also covers Redpanda enterprise differentiators at the topic/broker level
  (license required): Iceberg Topics (redpanda.iceberg.mode/delete/partition.spec/
  target.lag.ms/invalid.record.action), Cloud Topics (object-storage-native,
  cloud_topics_enabled, redpanda.storage.mode=cloud), Continuous Data Balancing
  (partition_autobalancing_mode=continuous, core_balancing_continuous), Shadowing /
  Shadow Links for cross-cluster disaster recovery (rpk shadow create/status/failover),
  Remote Read Replicas, Leader Pinning, and server-side Schema ID Validation. Use
  when enabling or troubleshooting any of these enterprise features on a topic.
---

# Redpanda Streaming

Redpanda is a Kafka-compatible streaming platform built from scratch in C++ using a thread-per-core architecture (Seastar). It implements the Kafka wire protocol, so any Kafka client that supports Kafka 0.11 or later works against Redpanda without code changes. This skill covers what a developer does via the Kafka API: producing, consuming, managing topics, running transactions, and using tiered storage.

This skill is about the **Kafka API surface** (port 9092 by default). For the Admin HTTP API see the `streaming-admin-api` skill. For rpk CLI reference see the `rpk` skill.

## Quickstart

### 1. Connect with rpk

```bash
# Local / self-managed — no auth
rpk topic list --brokers localhost:9092

# With SASL/SCRAM (common for Redpanda Cloud or secured self-managed)
rpk topic list \
  --brokers seed-abc123.cloud.redpanda.com:9092 \
  -X tls.enabled=true \
  -X sasl.mechanism=SCRAM-SHA-256 \
  -X user=myuser \
  -X pass=mypassword
```

rpk uses franz-go internally; its -X configuration keys are rpk-specific (`brokers`, `tls.enabled`, `tls.ca`, `sasl.mechanism`, `user`, `pass`) and do not map 1:1 to franz-go option names.

### 2. Create a topic

```bash
# 6 partitions, replication factor 3 (recommended for production)
rpk topic create orders -p 6 -r 3 --brokers localhost:9092

# With tiered storage enabled (v26.1+ recommended way)
rpk topic create orders -p 6 -r 3 \
  -c redpanda.storage.mode=tiered \
  --brokers localhost:9092
```

### 3. Produce records

```bash
# Each line of stdin becomes one record
echo -e 'order-1\norder-2\norder-3' | rpk topic produce orders \
  --brokers localhost:9092

# Key:value format
echo 'key-1:{"id":1,"item":"book"}' | rpk topic produce orders \
  --brokers localhost:9092 \
  --format '%k:%v\n'
```

### 4. Consume records

```bash
# Read from the beginning, exit after printing all current records
rpk topic consume orders --from-beginning --brokers localhost:9092

# Follow in real time (Ctrl-C to stop)
rpk topic consume orders --brokers localhost:9092
```

### Minimal franz-go snippet (Go)

franz-go is what rpk uses internally and is the recommended Go client.

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
        // For SASL/SCRAM: add kgo.SASL(scram.Auth{...}.AsMechanism())
    )
    if err != nil {
        panic(err)
    }
    defer cl.Close()

    ctx := context.Background()

    // Produce
    record := &kgo.Record{Topic: "orders", Value: []byte(`{"id":1}`)}
    if err := cl.ProduceSync(ctx, record).FirstErr(); err != nil {
        panic(err)
    }
    fmt.Println("produced offset:", record.Offset)

    // Consume from beginning
    cl2, _ := kgo.NewClient(
        kgo.SeedBrokers("localhost:9092"),
        kgo.ConsumeTopics("orders"),
        kgo.ConsumeResetOffset(kgo.NewOffset().AtStart()),
    )
    defer cl2.Close()

    fetches := cl2.PollFetches(ctx)
    fetches.EachRecord(func(r *kgo.Record) {
        fmt.Printf("offset=%d key=%s value=%s\n", r.Offset, r.Key, r.Value)
    })
}
```

## Core Concepts

- **Topics and partitions**: A topic is divided into partitions. Each partition is an ordered, append-only log. Parallelism scales with partition count.
- **Replication via Raft**: Redpanda uses Raft (not ISR+ZooKeeper) for replication. One replica is the leader; followers stay in sync. `acks=all` waits for the majority quorum and fsyncs before acknowledging.
- **Offsets**: Each record within a partition gets a monotonically increasing offset, starting at 0. Offsets are immutable once assigned.
- **Controller**: One broker is the Raft controller. It manages partition leadership, topic creation/deletion, and configuration changes.
- **Default Kafka port**: 9092.

See [Core Concepts](references/core-concepts.md) for details on how Redpanda differs from Apache Kafka.

## Producing Data

Key producer properties (standard Kafka config keys):

| Property | Recommended | Notes |
|---|---|---|
| `acks` | `all` | Waits for majority quorum + fsync on Redpanda |
| `enable.idempotence` | `true` | Default `true` in Java client (3.0+) and librdkafka-based clients; **not supported** in kafka-python-ng; requires `acks=all` |
| `compression.type` | `zstd` | Options: `none`, `gzip`, `snappy`, `lz4`, `zstd` |
| `batch.size` | `16384` (default) | Bytes; increase for throughput |
| `linger.ms` | `0` (default) | Increase to fill batches, costs latency |
| `max.in.flight.requests.per.connection` | `5` | With idempotence, up to 5 in-flight preserve order |

With keyless produce, the producer distributes records round-robin across partitions. With a key, the **producer** (client-side) hashes the key using the **murmur2** algorithm (matching the Java DefaultPartitioner) and modulates by partition count to select a partition deterministically — the broker does not re-partition records.

```bash
# Produce via rpk (defaults to acks=all, --acks flag accepts -1=all/0=none/1=leader; default compression is snappy)
echo 'hello' | rpk topic produce my-topic --brokers localhost:9092
```

See [Produce Data](references/produce-data.md) for full producer configuration, batching, compression, and client snippets.

## Consuming Data

Consumers join a **consumer group** (`group.id`) to share partition assignment. Redpanda tracks committed offsets in the internal `__consumer_offsets` topic.

```bash
# Consume as group "my-app", resume from last committed offset
rpk topic consume orders --group my-app --brokers localhost:9092

# Consume from the beginning without a group
rpk topic consume orders --from-beginning --brokers localhost:9092
```

Key properties:

| Property | Notes |
|---|---|
| `group.id` | Consumer group identifier; must be unique per application |
| `auto.offset.reset` | `earliest` or `latest` (default `latest`) |
| `enable.auto.commit` | Default `true`; set `false` for manual control |
| `isolation.level` | Set `read_committed` when consuming from transactional topics |
| `client.rack` | Set to AZ/rack for follower fetching (lower cross-AZ cost) |

See [Consume Data](references/consume-data.md) for consumer groups, rebalancing, offset commit strategies, and follower fetching.

## Transactions and Exactly-Once Semantics

Redpanda supports Kafka-compatible transactions. Set `transactional.id` in the producer config; then call `initTransactions()`, `beginTransaction()`, produce/sendOffsets, `commitTransaction()` (or `abortTransaction()`). The broker implements `InitProducerId`, `AddPartitionsToTxn`, `TxnOffsetCommit`, and `EndTxn` Kafka APIs.

```java
props.put("transactional.id", "my-app-txn-1");
props.put("enable.idempotence", "true");
props.put("acks", "all");
Producer<String,String> p = new KafkaProducer<>(props);
p.initTransactions();
p.beginTransaction();
p.send(new ProducerRecord<>("topic-out", key, value));
p.commitTransaction();
```

Consumers reading transactional topics must set `isolation.level=read_committed` to see only committed data.

See [Transactions](references/transactions.md) for the full flow, exactly-once stream processing pattern, and tuning.

## Topic Management via Kafka API

```bash
# Create
rpk topic create events -p 12 -r 3

# Describe configs
rpk topic describe events -c

# Set retention to 2 days / 10 GiB per partition
rpk topic alter-config events \
  --set retention.ms=172800000 \
  --set retention.bytes=10737418240

# Change cleanup policy to compact
rpk topic alter-config events --set cleanup.policy=compact

# Delete a topic
rpk topic delete events
```

See [Topic Management](references/topic-management.md) for per-topic configs, compaction, write caching, and storage mode.

## Kafka Client Compatibility

Redpanda is compatible with Kafka clients version **0.11 or later**. Kafka 4.x Java client is validated with ducktape and chaos test suites. franz-go, librdkafka, kafka-python-ng, kafka-rust, KafkaJS, and confluent-kafka-javascript are all validated.

Note: Redpanda does **not** implement KIP-890 (Transactions V2 server-side defense); Kafka 4.x clients automatically fall back to the original transaction protocol.

See [Clients and Compatibility](references/clients-and-compatibility.md) for connection snippets per language, SASL/SCRAM setup, and known limitations.

## Tiered Storage

Tiered Storage (shadow indexing) archives log segments to object storage (S3, GCS, or Azure Blob), reducing local disk requirements. Requires an enterprise license.

```bash
# Enable on a new topic (v26.1+ recommended)
rpk topic create archive-topic -p 6 -r 3 \
  -c redpanda.storage.mode=tiered

# Enable on an existing topic
rpk topic alter-config archive-topic --set redpanda.storage.mode=tiered

# Set local retention to 1 day, total retention to 30 days
rpk topic alter-config archive-topic \
  --set retention.local.target.ms=86400000 \
  --set retention.ms=2592000000
```

See [Tiered Storage](references/tiered-storage.md) for the full enable/configure workflow.

## Enterprise Features (License Required)

Several Redpanda differentiators are configured at the topic or cluster level through the Kafka/admin surface and require an **Enterprise license** (`rpk cluster license info` reports violations). See [Enterprise Features Index](references/enterprise-features.md) for the full list, enable/disable keys, and expiration behavior.

### Iceberg Topics

Stream topic data into Apache Iceberg tables in object storage (queryable by Snowflake, Databricks, Spark, etc.). Requires Tiered Storage. Enable the cluster switch, then set the per-topic mode:

```bash
rpk cluster config set iceberg_enabled true
rpk topic alter-config my-topic --set redpanda.iceberg.mode=value_schema_id_prefix
```

Nested topic keys: `redpanda.iceberg.mode` (`key_value`/`value_schema_id_prefix`/`value_schema_latest`/`disabled`), `redpanda.iceberg.delete`, `redpanda.iceberg.invalid.record.action` (`drop`/`dlq_table`), `redpanda.iceberg.partition.spec`, `redpanda.iceberg.target.lag.ms`. See [Iceberg Topics](references/iceberg-topics.md).

### Cloud Topics

Object-storage-native ("diskless") topics that use S3/ADLS/GCS as the primary store, eliminating most cross-AZ replication cost (latency 1-2s). Enable at the cluster level, then create with `redpanda.storage.mode=cloud` (create-only):

```bash
rpk cluster config set cloud_topics_enabled=true
rpk topic create -c redpanda.storage.mode=cloud my-cloud-topic
```

Underlying topic property: `redpanda.cloud_topic.enabled`. See [Cloud Topics](references/cloud-topics.md).

### Continuous Data Balancing

Self-healing cluster that continuously rebalances partitions on node/disk/rack pressure. Default for licensed clusters:

```bash
rpk cluster config set partition_autobalancing_mode continuous
```

Tuning: `partition_autobalancing_node_availability_timeout_sec` (900), `partition_autobalancing_max_disk_usage_percent` (80), `partition_autobalancing_node_autodecommission_timeout_sec`, plus intra-broker `core_balancing_continuous`. See [Continuous Data Balancing](references/continuous-balancing.md).

### Shadowing / Shadow Links (Cross-Cluster DR)

Asynchronous, offset-preserving byte-level replication between clusters for disaster recovery (active-passive). Enable on the shadow cluster, then use `rpk shadow`:

```bash
rpk cluster config set enable_shadow_linking true
rpk shadow create --config-file shadow-config.yaml
rpk shadow status <link-name>
rpk shadow failover <link-name> --all
```

Replicates topic data, configs, consumer offsets, ACLs, and Schema Registry. See [Shadow Linking](references/shadow-linking.md).

## Reference Directory

- [Core Concepts](references/core-concepts.md): Topics, partitions, Raft replication, offsets, the controller, and how Redpanda differs from Apache Kafka (thread-per-core, no ZooKeeper, no JVM, single binary).
- [Produce Data](references/produce-data.md): Idempotent producers, `acks`, compression, batching, `linger.ms`, keys and partitioning, error handling, and rpk + franz-go + Java snippets.
- [Consume Data](references/consume-data.md): Consumer groups, rebalancing, offset commit strategies, `__consumer_offsets`, `auto.offset.reset`, follower fetching with rack awareness, and fetch sessions.
- [Transactions](references/transactions.md): Idempotence vs transactions, exactly-once semantics, `transactional.id`, the full Kafka transaction API flow, read-process-write pattern, `isolation.level=read_committed`, and tuning.
- [Topic Management](references/topic-management.md): Creating and altering topics over the Kafka API — partitions, replication factor, `cleanup.policy`, `retention.ms`, `retention.bytes`, `segment.bytes`, `write.caching`, and storage mode.
- [Clients and Compatibility](references/clients-and-compatibility.md): Kafka protocol compatibility, validated clients per language, connection basics (bootstrap, SASL/SCRAM, TLS), and known compatibility notes.
- [Tiered Storage](references/tiered-storage.md): What tiered storage does, enabling it per-topic (`redpanda.storage.mode=tiered` or legacy `redpanda.remote.write/read`), local vs remote retention, reading historical data, and Remote Read Replicas. (Enterprise)
- [Enterprise Features Index](references/enterprise-features.md): All broker/topic-level enterprise differentiators with enable/disable config keys, license-expiration behavior, and pointers — Tiered Storage, Cloud Topics, Iceberg Topics, Continuous/Intra-Broker Balancing, Shadowing, Remote Read Replicas, Topic Recovery, Leader Pinning, Server-Side Schema ID Validation, Topic Deletion Control.
- [Iceberg Topics](references/iceberg-topics.md): Iceberg integration — `iceberg_enabled` cluster switch and nested topic keys `redpanda.iceberg.mode`/`delete`/`invalid.record.action`/`partition.spec`/`target.lag.ms`, catalog types, schema evolution, retention, limitations. (Enterprise)
- [Cloud Topics](references/cloud-topics.md): Object-storage-native topics — `cloud_topics_enabled`, `redpanda.storage.mode=cloud`, `redpanda.cloud_topic.enabled`, `default_redpanda_storage_mode`, latency/cost trade-offs, and limitations. (Enterprise)
- [Continuous Data Balancing](references/continuous-balancing.md): `partition_autobalancing_mode` modes, continuous-mode disk/availability/decommission thresholds, intra-broker `core_balancing_continuous`/`core_balancing_on_core_count_change`, and `rpk cluster partitions balancer-status`/`movement-cancel`. (Enterprise)
- [Shadow Linking](references/shadow-linking.md): Cross-cluster DR via Shadow Links — `enable_shadow_linking`, the `rpk shadow` workflow (create/list/describe/status/update/failover/delete), shadow-config.yaml nested sync options and filters, topic-property replication rules, and limitations. (Enterprise)
- [Kafka Client Metadata and Connection Settings](references/kafka-client-metadata.md): Per-client config keys for metadata refresh intervals (`metadata.max.age.ms`, `topic.metadata.refresh.interval.ms`, `kgo.MetadataMaxAge`), fast-refresh after leader errors, reconnect backoff, idle connection timeout, request timeouts, and producer delivery budgets (`delivery.timeout.ms`, `message.timeout.ms`) — with recommended values for latency, throughput, and resilience goals, and explicit callouts for Continuous Data Balancing, Shadow Linking failover, Cloud Topics, Leader Pinning, and Tiered Storage cold-read interactions.
- [TLS and Authentication](references/tls-and-auth.md): Client-side TLS certificate loading (truststore/keystore for Java, ssl.ca.location/ssl.certificate.location for librdkafka, kgo.DialTLSConfig for franz-go, ssl options for KafkaJS), mutual TLS (mTLS) configuration, Redpanda broker listener addresses (`kafka_api`, `kafka_api_tls`), and how Redpanda extracts the Kafka principal from client certificate DNs via `kafka_mtls_principal_mapping_rules`.
