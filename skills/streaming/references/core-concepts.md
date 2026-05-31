# Core Concepts: Redpanda Broker and Kafka API

## Topics and Partitions

A **topic** is a named, durable stream of records. Topics are divided into one or more **partitions**. Each partition is an ordered, append-only log stored on disk. Records within a partition are assigned monotonically increasing **offsets**, starting from 0. Offsets are immutable once assigned.

Partitions are the unit of parallelism: producers write to partitions in parallel, and consumer group members each own a subset of partitions. As a general rule, choose a number of partitions that matches the maximum number of consumers in any consumer group you plan to run.

## Replication with Raft

Redpanda uses the **Raft consensus algorithm** for partition replication — not the ISR (In-Sync Replica) mechanism used by Apache Kafka.

Each partition has one **leader** and zero or more **followers**, collectively called the **replica set**. The leader processes all reads and writes. Followers replicate the leader's log.

Under `acks=all`, Redpanda waits for a **majority quorum** of the replica set to acknowledge the write and **fsync to disk** before returning success. This is stricter than Kafka's default behavior: in Kafka, `acks=all` (aka `acks=-1`) acknowledges after all ISR replicas receive the write but before fsync. In Redpanda, the fsync is part of the ack, making it more durable out of the box.

With `acks=1`, the leader acknowledges after its local write but before replication completes, trading durability for throughput. With `acks=0`, the producer fires-and-forgets.

The **replication factor** must be an odd number. Redpanda recommends a replication factor of 3 for most production use cases. The minimum required replication factor can be enforced cluster-wide with the `minimum_topic_replications` cluster property.

## Offsets

An **offset** is the unique sequence number assigned to each record within a partition when it is accepted and acknowledged by the partition leader. Offsets start at 0 and are immutable. Consumers use offsets to track their position in a partition and to resume after failures or restarts.

Offsets are stored in the internal topic `__consumer_offsets`. The group coordinator (a designated broker) receives `OffsetCommitRequest` calls from consumers, appends them to `__consumer_offsets` (a compacted topic), and serves `OffsetFetchRequest` lookups from an in-memory cache.

## The Controller

One broker in the Redpanda cluster is the **controller**. The controller runs its own Raft group and is responsible for:

- Topic creation, deletion, and configuration changes
- Partition leadership elections
- Broker membership and health
- Schema registry and other cluster-level metadata

When a leader fails, Raft elects a new leader from the follower set without requiring a ZooKeeper-style external coordinator.

## How Redpanda Differs from Apache Kafka

| Dimension | Apache Kafka | Redpanda |
|---|---|---|
| Language | Java (JVM) | C++ (no JVM) |
| Threading | Many threads per broker | Thread-per-core (Seastar) — one shard per CPU core, each running an event loop |
| Coordination | ZooKeeper (or KRaft in Kafka 3+) | Raft — built in, no external dependency |
| Deployment | Multi-jar, broker + ZooKeeper/KRaft | Single binary |
| Replication protocol | ISR with min-ISR | Raft quorum |
| acks=all durability | Acknowledged before fsync by default | Acknowledged **after** fsync by default |
| GC pauses | Present (JVM GC) | None (no GC) |

### Thread-Per-Core Architecture

Redpanda uses the [Seastar](https://seastar.io/) framework. Each CPU core runs a dedicated event loop (shard). Work is sharded across cores using message passing instead of shared-memory locks. This eliminates lock contention at high throughput and removes JVM garbage collection pauses. The result is more predictable tail latency under load compared to the JVM-based Kafka broker.

### No ZooKeeper

Redpanda uses Raft internally for all coordination tasks that Kafka historically delegated to ZooKeeper (and more recently to KRaft). There is no external ZooKeeper cluster to run or tune. The controller partition is itself a Raft group stored on the Redpanda brokers.

### Single Binary

All Redpanda functionality — broker, schema registry proxy, REST proxy (HTTP Proxy) — ships in a single `redpanda` binary. No separate processes are required beyond the binary itself.

## Kafka API Compatibility

Redpanda implements the Kafka binary protocol and is compatible with Kafka clients version **0.11 or later**. The following Kafka API handlers are implemented (non-exhaustive list from the handler source tree):

- `Produce` (versions 0–7)
- `Fetch` (versions 4–13)
- `ListOffsets` (versions 0–6)
- `Metadata` (versions 0+)
- `OffsetCommit`, `OffsetFetch` (versions 1–8), `OffsetDelete`
- `FindCoordinator` (versions 0–4)
- `JoinGroup`, `SyncGroup`, `Heartbeat`, `LeaveGroup`, `ListGroups`, `DescribeGroups`, `DeleteGroups`
- `CreateTopics` (versions 0–7), `DeleteTopics` (versions 0–6), `CreatePartitions`
- `AlterConfigs` (versions 0–2), `IncrementalAlterConfigs` (versions 0–1), `DescribeConfigs` (versions 0–4)
- `DescribeLogDirs`
- `InitProducerId` (versions 0–3)
- `AddPartitionsToTxn` (versions 0–3), `AddOffsetsToTxn` (versions 0–1), `EndTxn` (versions 0–3), `TxnOffsetCommit` (versions 0–3)
- `ListTransactions`, `DescribeTransactions`, `DescribeProducers`
- `SaslHandshake`, `SaslAuthenticate`
- `ApiVersions`
- `AlterPartitionReassignments`, `ListPartitionReassignments`
- `DescribeCluster`
- `CreateACLs`, `DeleteACLs`, `DescribeACLs`
- `AlterUserScramCredentials`, `DescribeUserScramCredentials`
- `AlterClientQuotas`, `DescribeClientQuotas`
- `DeleteRecords`
- `OffsetForLeaderEpoch` (versions 0–4)

The default Kafka port is **9092**.

## Brokers, Bootstrap, and Discovery

Clients connect to one or more **bootstrap brokers** (`--brokers` in rpk, `bootstrap.servers` in Kafka clients). The broker returns cluster metadata including the full broker list and partition leaders. Clients then connect directly to the appropriate leader for each partition.

In a multi-broker cluster, the bootstrap list need not include every broker — listing 2–3 ensures redundancy.
