# Topic Management via the Kafka API

Topic management uses the standard Kafka wire protocol. The Kafka APIs Redpanda implements for topics include:

- `CreateTopics` (versions 0–7)
- `DeleteTopics`
- `CreatePartitions`
- `AlterConfigs` (versions 0–2)
- `IncrementalAlterConfigs` (versions 0–1)
- `DescribeConfigs` (versions 0–4)
- `DescribeLogDirs`
- `AlterPartitionReassignments`, `ListPartitionReassignments`

rpk wraps these APIs. All `rpk topic` commands use the Kafka API on port 9092 (unless overridden). This page focuses on what a developer does via the Kafka API; for Admin HTTP API operations see the `streaming-admin-api` skill.

## Creating Topics

```bash
# Simplest: default partitions and replication
rpk topic create my-topic --brokers localhost:9092

# 6 partitions, replication factor 3 (recommended for production)
rpk topic create my-topic -p 6 -r 3 --brokers localhost:9092

# With topic-level configs set at creation time
rpk topic create events \
  -p 12 -r 3 \
  -c retention.ms=86400000 \
  -c compression.type=lz4 \
  -c cleanup.policy=compact \
  --brokers localhost:9092
```

Default values (self-managed):
- Partitions: 1 (cluster default; configurable via `default_topic_partitions`)
- Replication factor: 1 (cluster default; configurable via `default_topic_replications`)

Default values (Redpanda Cloud):
- Partitions: 1
- Replication factor: 3

The replication factor must be an **odd number**. Redpanda recommends 3. The cluster-level property `minimum_topic_replications` enforces a minimum RF on all new topics.

## Choosing Partition Count

Partitions are the unit of parallelism. As a general rule:
- Select a number of partitions that matches the maximum number of consumers in any consumer group that will consume the data.
- More partitions = more throughput potential and more memory/file-handle overhead per broker.
- You can add partitions later, but you cannot remove them, and adding partitions changes key-to-partition routing for keyed records.

## Describing Topics and Their Configs

```bash
# Full topic description (summary + configs)
rpk topic describe my-topic --brokers localhost:9092

# Configs only
rpk topic describe my-topic -c --brokers localhost:9092
```

Example output from `rpk topic describe` (self-managed defaults):

```
SUMMARY
=======
NAME        my-topic
PARTITIONS  1
REPLICAS    1

CONFIGS
=======
KEY                           VALUE        SOURCE
cleanup.policy                delete       DYNAMIC_TOPIC_CONFIG
compression.type              producer     DEFAULT_CONFIG
max.message.bytes             1048576      DEFAULT_CONFIG
message.timestamp.type        CreateTime   DEFAULT_CONFIG
redpanda.remote.delete        true         DEFAULT_CONFIG
redpanda.remote.read          false        DEFAULT_CONFIG
redpanda.remote.write         false        DEFAULT_CONFIG
redpanda.storage.mode         unset        DEFAULT_CONFIG
retention.bytes               -1           DEFAULT_CONFIG
retention.local.target.bytes  -1           DEFAULT_CONFIG
retention.local.target.ms     86400000     DEFAULT_CONFIG
retention.ms                  604800000    DEFAULT_CONFIG
segment.bytes                 1073741824   DEFAULT_CONFIG
```

## Altering Topic Configurations

```bash
# Set one or more configs
rpk topic alter-config my-topic \
  --set retention.ms=172800000 \
  --brokers localhost:9092

# Set multiple at once
rpk topic alter-config my-topic \
  --set retention.ms=172800000 \
  --set retention.bytes=10737418240 \
  --set compression.type=zstd \
  --brokers localhost:9092

# Remove a config override (reverts to cluster default)
rpk topic alter-config my-topic \
  --delete cleanup.policy \
  --brokers localhost:9092
```

## Adding Partitions

You can increase partition count but never decrease it.

```bash
# Add 4 more partitions (note: this is the NUMBER TO ADD, not the total)
rpk topic add-partitions my-topic --num 4 --brokers localhost:9092
```

After adding partitions, existing keyed records remain on their original partitions. New records with keys will be distributed across all (old + new) partitions.

## Changing the Replication Factor (Self-Managed)

```bash
rpk topic alter-config my-topic \
  --set replication.factor=3 \
  --brokers localhost:9092
```

The replication factor cannot exceed the number of available brokers.

## Key Per-Topic Configuration Properties

### Retention

| Property | Default | Notes |
|---|---|---|
| `retention.ms` | 604800000 (7 days) | Time-based retention. `-1` = retain indefinitely |
| `retention.bytes` | -1 | Size-based retention per partition. `-1` = unlimited |
| `segment.bytes` | 1073741824 (1 GiB) | Size of each log segment file on disk |
| `segment.ms` | (varies) | Max age of an open log segment before it is rolled |

With Tiered Storage enabled, `retention.ms` and `retention.bytes` govern total retention (local + object storage). See `retention.local.target.ms` and `retention.local.target.bytes` for local-only controls.

### Cleanup Policy

| `cleanup.policy` value | Behavior |
|---|---|
| `delete` (default) | Segments are deleted when they exceed `retention.ms` or `retention.bytes` |
| `compact` | Log compaction: only the latest value for each key is retained |
| `compact,delete` | Compaction plus retention-based deletion |

```bash
# Switch to compacted topic
rpk topic alter-config my-topic --set cleanup.policy=compact

# Enable both compaction and deletion
rpk topic alter-config my-topic --set "cleanup.policy=compact,delete"
```

### Compression

```bash
# Per-topic compression (overrides producer-side compression.type)
rpk topic alter-config my-topic --set compression.type=lz4
```

Topic-level `compression.type` values: `producer` (default — use whatever the producer sends), `uncompressed`, `gzip`, `snappy`, `lz4`, `zstd`.

> Note: The **producer-side** `compression.type` config uses a different (smaller) set of values: `none` (default), `gzip`, `snappy`, `lz4`, `zstd`. The `producer` and `uncompressed` values are only valid at the topic level.

### Max Message Size

```bash
# Allow records up to 10 MiB (default is 1 MiB)
rpk topic alter-config my-topic --set max.message.bytes=10485760
```

### Write Caching

Write caching is a relaxed mode of `acks=all` that acknowledges a message when a majority of brokers receive it, without waiting for fsync. Provides lower latency at the cost of a small durability window on simultaneous multi-broker failure.

```bash
# Enable write caching for a topic
rpk topic alter-config my-topic --set write.caching=true

# Disable (default)
rpk topic alter-config my-topic --set write.caching=false
```

With `write.caching=true`, fsync occurs according to `flush.ms` and `flush.bytes`, whichever is reached first.

Note: Write caching does **not** apply to transactions or consumer offset commits — those are always fsynced before ack regardless of this setting.

### Message Timestamp Type

| `message.timestamp.type` | Behavior |
|---|---|
| `CreateTime` (default) | Timestamp set by the producer at send time |
| `LogAppendTime` | Timestamp set by the broker (server clock) when the record is appended |

### Storage Mode (v26.1+)

The `redpanda.storage.mode` topic property (introduced in v26.1) is the recommended way to control how a topic stores data:

| Value | Behavior |
|---|---|
| `unset` (default) | Legacy behavior; tiered storage controlled by `redpanda.remote.read`/`write` |
| `local` | Local disk only; object storage upload disabled |
| `tiered` | Local disk + object storage (Tiered Storage enabled) |
| `cloud` | Cloud Topics architecture — object storage as primary, local disk as write buffer only |
| `tiered_cloud` | Internal combined mode (local + tiered cloud); present in source (`model/metadata.h`) but is not a user-settable value via topic config |

```bash
# Create a tiered topic
rpk topic create archive-topic -p 6 -r 3 \
  -c redpanda.storage.mode=tiered \
  --brokers localhost:9092

# Convert an existing local topic to tiered
rpk topic alter-config archive-topic \
  --set redpanda.storage.mode=tiered \
  --brokers localhost:9092
```

Once a topic is created as `cloud`, it cannot be converted to `local` or `tiered`. Similarly, you cannot convert any topic to `cloud` after creation.

## Deleting Topics

```bash
# Delete one topic
rpk topic delete my-topic --brokers localhost:9092

# Delete multiple topics
rpk topic delete topic1 topic2 --brokers localhost:9092

# Delete topics matching regex
rpk topic delete -r '^test-.*' '.*-staging$' --brokers localhost:9092
```

When a topic is deleted, its underlying data on local disk is deleted. With Tiered Storage enabled and `redpanda.remote.delete=true` (the default), the topic's objects in object storage are also deleted.

## Deleting Records Within a Topic

To delete records up to a specific offset without deleting the entire topic:

```bash
# Delete records in partition 0 up to (not including) offset 1000
rpk topic trim-prefix my-topic \
  --offset 0:1000 \
  --brokers localhost:9092
```

This uses the Kafka `DeleteRecords` API.

## Leader Pinning (Multi-AZ)

For multi-AZ clusters, you can pin partition leaders to a preferred AZ to reduce cross-AZ latency and networking costs:

```bash
# Pin leaders to us-east-1a
rpk topic alter-config my-topic \
  --set "redpanda.leaders.preference=racks:us-east-1a" \
  --brokers localhost:9092

# Ordered failover: prefer us-east-1a, fall back to us-east-1b
rpk topic alter-config my-topic \
  --set "redpanda.leaders.preference=ordered_racks:us-east-1a,us-east-1b" \
  --brokers localhost:9092
```

`ordered_racks` is supported in Redpanda v26.1 and later.
