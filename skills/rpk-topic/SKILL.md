---
name: rpk-topic
description: >-
  Manage Redpanda topics and produce/consume records from the CLI using the
  `rpk topic` command group. Covers creating topics with custom partition
  counts, replication factors, and configs; listing and describing topics
  (summary, configs, partitions); altering topic configs (set/delete/append/
  subtract); adding partitions; trimming/deleting records; analyzing throughput
  and batch size; describing tiered-storage status; and deleting topics.
  Also covers `rpk topic produce` and `rpk topic consume` in depth including
  the --format percent-escape syntax, keys, headers, compression, acks,
  tombstones, schema-registry encoding/decoding, and all --offset forms.
  Also covers Redpanda enterprise topic properties (Enterprise license
  required): Tiered Storage (redpanda.remote.read/write/delete/recovery,
  redpanda.storage.mode, retention.local.target.*), Cloud Topics
  (redpanda.cloud_topic.enabled / redpanda.storage.mode=cloud), Iceberg Topics
  (redpanda.iceberg.mode/delete/partition.spec/target.lag.ms/
  invalid.record.action), Remote Read Replicas (redpanda.remote.readreplica),
  Leader Pinning (redpanda.leaders.preference), and server-side Schema ID
  Validation (redpanda.key/value.schema.id.validation, subject.name.strategy).
  Use when: creating or deleting Redpanda topics from the CLI, changing topic
  configs or retention policy, adding partitions to an existing topic,
  trimming old records with trim-prefix, producing keyed or JSON records to a
  topic, consuming records from specific offsets or consumer groups, using
  schema registry to encode/decode Avro/Protobuf/JSON records with rpk,
  analyzing topic throughput, describing tiered-storage cloud status, or
  enabling enterprise topic features (tiered storage, cloud topics, Iceberg,
  remote read replicas, leader pinning, schema ID validation). Includes
  Redpanda Cloud notes: auth via rpk cloud login profiles, Serverless and
  per-tier limits, and describe-storage being unsupported on Cloud.
---

# rpk topic: Manage, Produce & Consume

`rpk topic` is the `rpk` command group for all topic-level operations on a
Redpanda cluster. It wraps the Kafka protocol to create, inspect, alter, and
delete topics, and provides full-featured produce and consume commands with a
powerful percent-escape format language. All subcommands read connection config
from the active rpk profile or `-X` flags.

## Quickstart

```bash
# 1. Create a 3-partition topic with replication factor 3
rpk topic create orders -p 3 -r 3

# 2. Create with configs set at creation time
rpk topic create events -p 6 -r 3 \
  -c cleanup.policy=compact \
  -c retention.ms=86400000

# 3. Produce three keyed JSON records — key and value on each line (Ctrl-D to finish)
# Note: when %k appears in --format, it reads the key from the input line and
# takes precedence over any -k flag. Use one mechanism or the other, not both.
rpk topic produce orders -f '%k %v{json}\n'
order-1 {"id":1,"status":"pending"}
order-2 {"id":2,"status":"shipped"}
order-3 {"id":3,"status":"delivered"}

# 4. Produce a single record inline via stdin redirect
printf 'hello world\n' | rpk topic produce orders

# 5. Consume from the beginning and stop at current end
rpk topic consume orders -o start

# 6. Consume last 5 records
rpk topic consume orders -o -5

# 7. Consume from a specific offset until current end
rpk topic consume orders -o 100:end

# 8. Consume in a named consumer group
rpk topic consume orders -g my-service

# 9. Describe the topic (summary + configs by default)
rpk topic describe orders

# 10. Describe including partition detail
rpk topic describe orders -p

# 11. Alter a topic config
rpk topic alter-config orders --set retention.ms=3600000

# 12. Delete a topic config key (revert to cluster default)
rpk topic alter-config orders --delete retention.ms

# 13. Add 2 more partitions
rpk topic add-partitions orders -n 2

# 14. List all topics
rpk topic list

# 15. Delete a topic
rpk topic delete orders
```

## Subcommands

| Subcommand | What it does |
|---|---|
| `create` | Create one or more topics with partitions, replicas, configs |
| `list` (alias `ls`) | List topics with partition and replica counts |
| `describe` (alias `info`) | Show topic summary, configs, and partition offsets |
| `describe-storage` | Show tiered-storage cloud/local status per partition |
| `alter-config` | Incrementally set, delete, append, or subtract config keys |
| `add-partitions` | Add N new partitions to an existing topic |
| `trim-prefix` | Move the log start offset forward, discarding old data |
| `analyze` | Measure batch rate and batch size over a time window |
| `delete` | Delete one or more topics |
| `produce` | Write records from stdin to a topic |
| `consume` | Read records from topics and print to stdout |

## create

```bash
rpk topic create <TOPICS...> [flags]
```

| Flag | Type | Default | Description |
|---|---|---|---|
| `-p, --partitions` | int32 | `-1` | Number of partitions; `-1` uses `default_topic_partitions` |
| `-r, --replicas` | int16 | `-1` | Replication factor (must be odd); `-1` uses `default_topic_replications` |
| `-c, --topic-config` | string (repeatable) | | `key=value` config pair, e.g. `-c cleanup.policy=compact` |
| `-d, --dry` | bool | false | Validate only; do not create |
| `--if-not-exists` | bool | false | Skip silently if topic already exists |

```bash
# Compact topic
rpk topic create audit-log -p 12 -r 3 -c cleanup.policy=compact

# Dry run
rpk topic create test-topic -p 3 -r 3 -d
```

## list

```bash
rpk topic list [TOPICS...] [flags]
```

| Flag | Default | Description |
|---|---|---|
| `-d, --detailed` | false | Show per-partition leader/replica detail |
| `-i, --internal` | false | Include internal topics (e.g. `__consumer_offsets`) |
| `-r, --regex` | false | Parse topic names as regex |

```bash
rpk topic list
rpk topic list -r '^orders.*'
rpk topic list -d
```

## describe

```bash
rpk topic describe <TOPICS...> [flags]
```

By default prints the `summary` and `configs` sections. Sections:

| Flag | Description |
|---|---|
| `-s, --print-summary` | Print topic name, partitions, replicas |
| `-c, --print-configs` | Print all config key/value/source pairs |
| `-p, --print-partitions` | Print per-partition leader, epoch, replicas, offsets |
| `-a, --print-all` | Print all three sections |
| `--stable` | Add last-stable-offset column (for transactional topics) |
| `-r, --regex` | Describe topics matching a regex |

```bash
rpk topic describe orders -a
rpk topic describe -r '^events.*' -a
```

## alter-config

```bash
rpk topic alter-config <TOPICS...> [flags]
```

Supports four operations (all repeatable):

| Flag | Operation |
|---|---|
| `-s, --set key=value` | Set a config value |
| `-d, --delete key` | Delete a key (revert to default) |
| `--append key=value` | Append to a list-of-values key |
| `--subtract key=value` | Remove from a list-of-values key |
| `--dry` | Validate only; do not apply |
| `--no-confirm` | Skip confirmation prompt |

```bash
# Enable tiered storage on a topic
rpk topic alter-config orders \
  --set redpanda.remote.read=true \
  --set redpanda.remote.write=true

# Change retention
rpk topic alter-config orders --set retention.ms=86400000

# Revert retention to cluster default
rpk topic alter-config orders --delete retention.ms
```

## add-partitions

```bash
rpk topic add-partitions <TOPICS...> -n <N> [flags]
```

`-n` is required. Partitions can only be added, never removed.

```bash
rpk topic add-partitions orders -n 6
```

## trim-prefix

Moves the log start offset (low watermark) forward, deleting segments before
the specified offset. Data before the new start offset is no longer readable.

```bash
rpk topic trim-prefix [TOPIC] -o <OFFSET> [flags]
```

| Flag | Description |
|---|---|
| `-o, --offset` | Target offset (`47`, `end`, or `@<timestamp>`) |
| `-p, --partitions` | Comma-separated partition list (default: all) |
| `-f, --from-file` | File with topic/partition/offset rows |
| `--no-confirm` | Skip the confirmation prompt |

```bash
# Trim partition 0 to offset 1000
rpk topic trim-prefix orders -o 1000 -p 0

# Trim all partitions to a timestamp
rpk topic trim-prefix orders -o "@2024-01-01T00:00:00Z"

# Trim to the current end (delete everything)
rpk topic trim-prefix orders -o end
```

## analyze

Consumes a time window of records and reports batch rate and size statistics.

```bash
rpk topic analyze <TOPICS...> [flags]
```

| Flag | Default | Description |
|---|---|---|
| `-t, --time-range` | `-1m:end` | Time range to sample (e.g. `-24h:end`, `-48h:-24h`) |
| `--batches` | `10` | Minimum number of batches to consume per partition |
| `--timeout` | `10s` | How long to run |
| `-a, --print-all` | false | Print all output sections |
| `-s, --print-summary` | false | Global summary |
| `--print-topics` | false | Per-topic summary |
| `--print-partition-batch-rate` | false | Batch rate percentiles |
| `--print-partition-batch-size` | false | Batch size percentiles |
| `-r, --regex` | false | Parse topic names as regex |

```bash
rpk topic analyze orders -t -1h:end -a
rpk topic analyze -r '^orders.*' -t -24h:end -s --print-topics
```

## describe-storage

Requires the Admin API endpoint (from your profile or `-X admin.hosts=...`).
Shows tiered storage cloud vs. local bytes, segment counts, offsets, and sync
lag per partition. Not supported on Redpanda Cloud clusters (the Admin API is
not exposed there); all other `rpk topic` subcommands are.

```bash
rpk topic describe-storage <TOPIC> [flags]
```

| Flag | Description |
|---|---|
| `-a, --print-all` | All sections |
| `-s, --print-summary` | Summary (name, mode, last-upload) |
| `-z, --print-size` | Cloud + local bytes and segment counts |
| `-y, --print-sync` | Upload lag, manifest sync |
| `-o, --print-offset` | Cloud and local start/last offsets |
| `-H, --human-readable` | Human-readable sizes/durations |

```bash
rpk topic describe-storage orders -a -H
```

Cloud storage modes: `disabled`, `write_only`, `read_only`, `full`,
`read_replica`, `cloud_topic`, `cloud_topic_read_replica`.

## delete

```bash
rpk topic delete <TOPICS...> [flags]
```

`-r, --regex` parses topic names as regular expressions. Expressions are
anchored with `^` and `$`.

```bash
rpk topic delete old-topic
rpk topic delete -r '^test-.*'
```

## produce

See [Produce Reference](references/produce.md) for full detail.

```bash
rpk topic produce [TOPIC] [flags]
```

Key flags:

| Flag | Default | Description |
|---|---|---|
| `-f, --format` | `%v\n` | Input record format (percent-escape syntax) |
| `-k, --key` | | Fixed key for all records (parsed `%k` in format takes precedence) |
| `-H, --header` | | `key:value` header (repeatable) |
| `-z, --compression` | `snappy` | `none`, `gzip`, `snappy`, `lz4`, `zstd` |
| `--acks` | `-1` | `-1`=all ISR, `0`=none, `1`=leader |
| `-p, --partition` | `-1` | Direct-produce to this partition |
| `-Z, --tombstone` | false | Produce empty value as null (tombstone) |
| `--schema-id` | | Schema ID or `topic` (TopicName strategy) for value |
| `--schema-key-id` | | Schema ID or `topic` for key |
| `--schema-type` | | Fully-qualified Protobuf message type for value |
| `--schema-key-type` | | Fully-qualified Protobuf message type for key |
| `--allow-auto-topic-creation` | false | Auto-create the topic if it does not exist |
| `-o, --output-format` | `Produced to partition %p at offset %o with timestamp %d.\n` | Line printed to stdout after each successful record |
| `--delivery-timeout` | `0` | Per-record delivery timeout (min 1s) |
| `--max-message-bytes` | `-1` | Max batch bytes before compression |

```bash
# Fixed key, newline-delimited values from stdin
rpk topic produce orders -k order-key

# Key and value separated by space
rpk topic produce orders -f '%k %v\n'

# Add headers
rpk topic produce orders -H source:backend -H env:prod

# Encode with schema registry (TopicName strategy)
rpk topic produce orders --schema-id=topic

# Tombstone
rpk topic produce orders -k deleted-key -Z
```

## consume

See [Consume Reference](references/consume.md) for full detail.

```bash
rpk topic consume <TOPICS...> [flags]
```

Key flags:

| Flag | Default | Description |
|---|---|---|
| `-f, --format` | `json` | Output format (`json` or percent-escape string) |
| `-o, --offset` | `start` | Where to start (and optionally end) consuming |
| `-p, --partitions` | | Comma-separated list of partitions |
| `-g, --group` | | Consumer group ID |
| `-n, --num` | `0` | Stop after N records (0 = unbounded) |
| `-r, --regex` | false | Parse topic names as regex |
| `--read-committed` | false | Only read committed offsets (for transactions) |
| `--print-control-records` | false | Also print control records |
| `--use-schema-registry` | | Decode with schema registry (`key`, `value`, or both) |
| `--meta-only` | false | Print metadata but not record value (only affects `-f json` output) |

```bash
# Consume all records from beginning
rpk topic consume orders -o start

# Consume last 10 records
rpk topic consume orders -o -10

# Consume in a group, print key+value
rpk topic consume orders -g my-svc -f '%k %v\n'

# Consume a timestamp window
rpk topic consume orders -o @2024-01-01:1h

# Stop at current end
rpk topic consume orders -o :end

# Decode values via schema registry
rpk topic consume orders --use-schema-registry=value
```

## Redpanda Cloud notes

`rpk topic` works against Redpanda Cloud clusters (Serverless, BYOC, Dedicated) over the Kafka API. Authenticate with `rpk cloud login` and wire your profile to the cluster (`rpk cloud cluster select`, or `rpk profile create --from-cloud`); plain `rpk topic ...` commands then target the Cloud cluster.

- **All `rpk topic` subcommands are supported on Cloud except `rpk topic describe-storage`**, which needs the Admin API (not exposed by Redpanda Cloud).
- **Automatic topic creation is disabled** in Redpanda Cloud — create topics explicitly. BYOC/Dedicated clusters can opt in via the `auto_create_topics_enabled` cluster property.
- **Replication factor**: Redpanda Cloud requires a minimum of 3 replicas; a topic created with `-r 1` is reset to 3.
- **Message size**: capped per topic by `max.message.bytes`; the default and maximum differ by cluster type (Serverless caps are lower than BYOC/Dedicated). Check the Cloud "Topics Overview" page for current values rather than assuming self-managed defaults.
- **Partition limits**: Serverless clusters have a per-cluster partition cap (logical partitions, pre-replication) plus other usage limits (consumer groups, connections, ACLs, producer IDs) — see "Serverless usage limits" on the Serverless cluster-type page of the cloud docs. BYOC/Dedicated partition maxima depend on the usage tier — see the "BYOC Tiers and Regions" / "Dedicated Tiers and Regions" reference pages. These numbers change; do not hardcode them.
- **Managed cluster defaults**: cluster properties (e.g. `default_topic_partitions`) are not user-configurable on Serverless, and on BYOC/Dedicated (AWS/GCP only) only a curated subset is settable.
- **Tiered Storage on Cloud** is enabled and configured by Redpanda by default. The Enterprise topic properties section below is written for self-managed clusters — note `rpk cluster license` is also unsupported on Cloud.
- **TODO (unverified)**: the cloud docs do not publish an explicit list of which topic-level configs are settable versus rejected/managed on Serverless. Before advising a specific `alter-config --set` key on Serverless, verify against a live cluster or the Cloud UI.

## Enterprise topic properties

Several Redpanda differentiators are configured as **topic-level properties**
through `rpk topic create -c key=value` or
`rpk topic alter-config <topic> --set key=value`. All of these **require a valid
Enterprise Edition license**; without one they cannot be enabled, and they enter
a restricted state on license expiration. Verify license status with
`rpk cluster license info`.

| Feature | Key topic property(ies) | Notes |
|---|---|---|
| Tiered Storage | `redpanda.remote.read`, `redpanda.remote.write`, `redpanda.remote.delete`, `redpanda.remote.recovery`, `redpanda.storage.mode=tiered`, `retention.local.target.{ms,bytes}` | Needs cluster `cloud_storage_enabled=true`; enabled when read+write both `true`. `remote.recovery` is create-only |
| Cloud Topics | `redpanda.cloud_topic.enabled`, `redpanda.storage.mode=cloud` | Object-storage-native topic; `storage.mode=cloud` is preferred |
| Iceberg Topics | `redpanda.iceberg.mode` (`disabled`/`key_value`/`value_schema_id_prefix`/`value_schema_latest`), `redpanda.iceberg.delete`, `redpanda.iceberg.partition.spec`, `redpanda.iceberg.target.lag.ms`, `redpanda.iceberg.invalid.record.action` (`drop`/`dlq_table`) | Needs cluster `iceberg_enabled=true` |
| Remote Read Replicas | `redpanda.remote.readreplica=<bucket>` | Mutually exclusive with `remote.read`/`remote.write` |
| Leader Pinning | `redpanda.leaders.preference` (`none` / `racks:` / `ordered_racks:`) | Needs `enable_rack_awareness=true` |
| Schema ID Validation | `redpanda.key.schema.id.validation`, `redpanda.value.schema.id.validation`, `redpanda.key.subject.name.strategy`, `redpanda.value.subject.name.strategy` | Needs cluster `enable_schema_id_validation=redpanda` or `compat` |
| Topic Deletion Control | `delete_topic_enable` (cluster property) | Guards `rpk topic delete` for all users |

```bash
# Tiered Storage
rpk topic alter-config orders --set redpanda.storage.mode=tiered

# Iceberg topic
rpk topic create txns --topic-config=redpanda.iceberg.mode=key_value

# Leader Pinning
rpk topic alter-config orders --set redpanda.leaders.preference=ordered_racks:A,B,C

# Schema ID validation
rpk topic alter-config events --set redpanda.value.schema.id.validation=true
```

See [enterprise-topic-properties.md](references/enterprise-topic-properties.md)
for the full nested key list, accepted values, defaults, and expiration behavior.

## Reference Directory

- [produce.md](references/produce.md): `rpk topic produce` in depth — format percent-escape tokens, keys, headers, compression, acks, schema-registry encoding, tombstones, and worked examples.
- [consume.md](references/consume.md): `rpk topic consume` in depth — all `--offset` forms (numeric, relative, timestamp, ranges), consumer groups, format tokens, schema-registry decoding, and worked examples.
- [manage.md](references/manage.md): `create`, `alter-config`, `add-partitions`, `describe`, `describe-storage`, `trim-prefix`, `analyze`, and `delete` — with key config keys for retention, compaction, and tiered storage.
- [enterprise-topic-properties.md](references/enterprise-topic-properties.md): Enterprise-licensed topic properties set via `create -c` / `alter-config --set` — Tiered Storage (`redpanda.remote.*`, `redpanda.storage.mode`, `retention.local.target.*`), Cloud Topics (`redpanda.cloud_topic.enabled`), Iceberg Topics (`redpanda.iceberg.mode/delete/partition.spec/target.lag.ms/invalid.record.action`), Remote Read Replicas (`redpanda.remote.readreplica`), Leader Pinning (`redpanda.leaders.preference`), and Schema ID Validation (`redpanda.key/value.schema.id.validation`, `subject.name.strategy`), with accepted values, defaults, and license-expiration behavior.
