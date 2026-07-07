# rpk topic: Management Commands Reference

Covers `create`, `alter-config`, `add-partitions`, `describe`,
`describe-storage`, `trim-prefix`, `analyze`, and `delete`.
All flag details are verified against `src/go/rpk/pkg/cli/topic/` source.

---

## create

```bash
rpk topic create <TOPICS...> [flags]
```

Creates one or more topics with identical settings. All topics in a single
invocation share the same partition count, replication factor, and configs.

### Flags

| Flag | Short | Type | Default | Description |
|---|---|---|---|---|
| `--partitions` | `-p` | int32 | `-1` | Number of partitions; `-1` uses `default_topic_partitions` |
| `--replicas` | `-r` | int16 | `-1` | Replication factor (must be odd); `-1` uses `default_topic_replications` |
| `--topic-config` | `-c` | string (repeatable) | | `key=value` config, e.g. `-c cleanup.policy=compact` |
| `--dry` | `-d` | bool | false | Validate only; do not create |
| `--if-not-exists` | | bool | false | No-op if topic already exists |

### Config keys commonly set at creation

| Key | Example value | Effect |
|---|---|---|
| `cleanup.policy` | `compact` | Log compaction (default is `delete`) |
| `cleanup.policy` | `compact,delete` | Both compaction and size/time-based deletion |
| `retention.ms` | `86400000` | Retain records for 24 hours |
| `retention.bytes` | `1073741824` | Retain up to 1 GiB per partition |
| `segment.bytes` | `134217728` | Segment roll size (128 MiB) |
| `max.message.bytes` | `1048576` | Max message batch size |
| `redpanda.remote.write` | `true` | Enable tiered storage writes |
| `redpanda.remote.read` | `true` | Enable tiered storage reads |
| `compression.type` | `zstd` | Producer-side compression: `none`, `gzip`, `snappy`, `lz4`, `zstd`, `producer` |
| `message.timestamp.type` | `CreateTime` | `CreateTime` or `LogAppendTime` |

### Examples

```bash
# Single topic, cluster defaults
rpk topic create orders

# 12 partitions, RF=3, compact
rpk topic create audit-log -p 12 -r 3 -c cleanup.policy=compact

# Tiered storage enabled from birth
rpk topic create archive -p 6 -r 3 \
  -c redpanda.remote.write=true \
  -c redpanda.remote.read=true

# Two topics at once
rpk topic create orders events -p 6 -r 3

# Dry run (validate only)
rpk topic create test-topic -p 3 -r 3 -d

# Idempotent create (no error if exists)
rpk topic create orders --if-not-exists
```

> **Redpanda Cloud:** minimum replication factor is 3 (`-r 1` is reset to 3 by the broker), automatic topic creation is disabled, and `max.message.bytes` is capped per cluster type (Serverless lower than BYOC/Dedicated) — check the Cloud "Topics Overview" page for current caps. Serverless clusters also enforce a per-cluster partition cap ("Serverless usage limits" page); BYOC/Dedicated partition maxima are per usage tier ("BYOC/Dedicated Tiers and Regions" pages).

---

## list

```bash
rpk topic list [TOPICS...] [flags]
```

Alias: `rpk topic ls`.

### Flags

| Flag | Short | Default | Description |
|---|---|---|---|
| `--detailed` | `-d` | false | Per-partition leader, replicas, offline replicas |
| `--internal` | `-i` | false | Include internal topics |
| `--regex` | `-r` | false | Filter by regular expression |

```bash
rpk topic list
rpk topic list -d
rpk topic list -r '^orders.*'
rpk topic list -i                    # show __consumer_offsets etc.
```

Output columns (summarized): `NAME`, `PARTITIONS`, `REPLICAS`.

---

## describe

```bash
rpk topic describe <TOPICS...> [flags]
```

Alias: `rpk topic info`.

Prints up to three sections: **summary**, **configs**, and **partitions**.
Default: summary + configs for a single topic; all three for multiple topics.

### Flags

| Flag | Short | Default | Description |
|---|---|---|---|
| `--print-summary` | `-s` | | Show name, partitions, replicas |
| `--print-configs` | `-c` | | Show all config key/value/source pairs |
| `--print-partitions` | `-p` | | Show per-partition leader, epoch, replicas, and offsets |
| `--print-all` | `-a` | | All three sections |
| `--stable` | | false | Add last-stable-offset column (for transactional topics) |
| `--regex` | `-r` | false | Describe topics matching regex |

### Partition columns

| Column | Description |
|---|---|
| `partition` | Partition ID |
| `leader` | Broker ID of the current leader |
| `epoch` | Leader epoch |
| `replicas` | All replica broker IDs |
| `offline-replicas` | Shown only if any replicas are offline |
| `load-error` | Shown only if metadata reports partition errors |
| `log-start-offset` | Earliest available offset (low watermark) |
| `last-stable-offset` | Shown only with `--stable`; equals HWM unless transactions are in flight |
| `high-watermark` | Next offset to be produced (end of committed data) |

```bash
rpk topic describe orders
rpk topic describe orders -a
rpk topic describe orders -p --stable
rpk topic describe -r '^orders.*' -a
```

---

## alter-config

```bash
rpk topic alter-config <TOPICS...> [flags]
```

Uses the Kafka IncrementalAlterConfigs API for fine-grained, atomic config
changes. Supports four operations:

| Flag | Short | Operation |
|---|---|---|
| `--set key=value` | `-s` | Set or overwrite a key |
| `--delete key` | `-d` | Remove a key (revert to cluster/broker default) |
| `--append key=value` | | Append value to a list-of-values key |
| `--subtract key=value` | | Remove value from a list-of-values key |
| `--dry` | | Validate; do not apply |
| `--no-confirm` | | Skip confirmation on destructive operations |

All flags are repeatable. Multiple operations can be combined in one call.

```bash
# Change retention
rpk topic alter-config orders --set retention.ms=3600000

# Enable tiered storage (remote.read and remote.write together)
rpk topic alter-config orders \
  --set redpanda.remote.read=true \
  --set redpanda.remote.write=true

# Revert to cluster defaults
rpk topic alter-config orders \
  --delete retention.ms \
  --delete retention.bytes

# Append a compression type to the allowed list (if it's a list key)
rpk topic alter-config orders --append compression.type=gzip

# Dry run
rpk topic alter-config orders --set max.message.bytes=2097152 --dry
```

**Note:** Disabling tiered storage (`redpanda.remote.write=false`) requires
a confirmation prompt (may cause data loss); pass `--no-confirm` to skip it.

---

## add-partitions

```bash
rpk topic add-partitions <TOPICS...> -n <N> [flags]
```

`-n` is required. Adds N new partitions to each named topic. Partitions can
only be added, never removed; this is a permanent, irreversible change.

| Flag | Short | Description |
|---|---|---|
| `--num` | `-n` | Number of partitions to add (required, must be > 0) |
| `--force` | `-f` | Allow changing partition count on internal topics |

```bash
# Add 4 partitions to orders
rpk topic add-partitions orders -n 4

# Add to multiple topics at once
rpk topic add-partitions orders events -n 2
```

> **Redpanda Cloud:** partition ceilings apply — a per-cluster cap on Serverless ("Serverless usage limits" page) and per-usage-tier maxima on BYOC/Dedicated (tiers reference pages). Check those pages before advising large partition counts.

---

## trim-prefix

Sets the log start offset (low watermark) for one or more partitions, making
all records before that offset permanently unreadable. Segments entirely before
the new start offset are scheduled for deletion.

```bash
rpk topic trim-prefix [TOPIC] [flags]
```

Alias: `rpk topic trim`.

### Flags

| Flag | Short | Description |
|---|---|---|
| `--offset` | `-o` | Target offset: `47`, `end`, or `@<timestamp>` |
| `--partitions` | `-p` | Comma-separated partitions to trim (default: all) |
| `--from-file` | `-f` | File of `topic partition offset` rows (text, JSON, or YAML) |
| `--no-confirm` | | Skip the confirmation prompt |

`--from-file` and `--offset` are mutually exclusive.
`--from-file` and `--partitions` are mutually exclusive.

### Offset forms

| Value | Meaning |
|---|---|
| `47` | Exact offset |
| `end` | Current log end (trim everything) |
| `@1717000000000` | 13-digit Unix millisecond timestamp |
| `@1717000000` | 10-digit Unix second timestamp |
| `@2024-06-01` | `YYYY-MM-DD` (UTC) |
| `@2024-06-01T12:00:00Z` | RFC3339 (UTC) |
| `@-1h` | 1 hour ago |

### Examples

```bash
# Trim to offset 1000 on partition 0
rpk topic trim-prefix orders -o 1000 -p 0

# Trim all partitions to a timestamp (data before that point is gone)
rpk topic trim-prefix orders -o "@2024-01-01T00:00:00Z"

# Trim to current end on all partitions (delete all existing data)
rpk topic trim-prefix orders -o end

# From a file
cat > /tmp/trim.txt << 'EOF'
orders 0 1000
orders 1 800
orders 2 1200
EOF
rpk topic trim-prefix --from-file /tmp/trim.txt
```

---

## analyze

Consumes a time window of records and reports throughput and batch-size
statistics. Useful for understanding write patterns before changing partition
counts or compaction policies.

```bash
rpk topic analyze <TOPICS...> [flags]
```

### Flags

| Flag | Short | Default | Description |
|---|---|---|---|
| `--time-range` | `-t` | `-1m:end` | Time range to sample (same syntax as consume `--offset`) |
| `--batches` | | `10` | Minimum number of batches to consume per partition |
| `--timeout` | | `10s` | Maximum run time |
| `--print-all` | `-a` | | All output sections |
| `--print-summary` | `-s` | | Global summary (topics, partitions, throughput, batch rate, batch size) |
| `--print-topics` | | | Per-topic summary |
| `--print-partition-batch-rate` | | | Batch rate percentiles (P25/P50/P75/P99) per topic |
| `--print-partition-batch-size` | | | Batch size percentiles per topic |
| `--regex` | `-r` | false | Parse topics as regex |

By default (no section flags), prints global summary + topic summary.

### Output sections

**Global summary:**
- `topics` — number of topics analyzed
- `partitions` — total partition count
- `total throughput (bytes/s)` — bytes per second across all partitions
- `total batch rate (batches/s)` — batches per second across all partitions
- `average batch size (bytes)` — mean compressed batch size

**Topic summary:**
`TOPIC`, `PARTITIONS`, `BYTES-PER-SECOND`, `BATCHES-PER-SECOND`,
`AVERAGE-BYTES-PER-BATCH`

**Partition batch rate / batch size:**
Percentile columns P25, P50, P75, P99 per topic (aggregated across partitions).

### Examples

```bash
# Last hour overview
rpk topic analyze orders -t -1h:end -a

# Last 24 hours, multiple topics
rpk topic analyze orders events -t -24h:end -s --print-topics

# Regex
rpk topic analyze -r '^orders.*' -t -24h:end -a

# Longer time range with extended timeout
rpk topic analyze orders -t -7d:end --timeout 60s -a
```

---

## describe-storage

Shows tiered storage (cloud) status per partition. Requires the Admin API
(set via `--api-urls` or `-X admin.hosts=...`). Not supported on Redpanda
Cloud clusters — Cloud does not expose the Admin API, and the Cloud docs list
`rpk topic describe-storage` as the one unsupported `rpk topic` subcommand.

```bash
rpk topic describe-storage <TOPIC> [flags]
```

### Flags

| Flag | Short | Description |
|---|---|---|
| `--print-all` | `-a` | All sections |
| `--print-summary` | `-s` | Topic name, cloud-storage-mode, last-upload |
| `--print-size` | `-z` | Cloud + local bytes, total bytes, segment counts |
| `--print-sync` | `-y` | Upload lag and manifest sync state |
| `--print-offset` | `-o` | Cloud and local start/last offsets |
| `--human-readable` | `-H` | Human-readable sizes/durations |

Default: summary + size.

### Cloud storage modes

| Mode | Description |
|---|---|
| `disabled` | No tiered storage |
| `write_only` | Segments uploaded but not served from cloud |
| `read_only` | Cloud data available for reads; no new uploads |
| `full` | Both reads and writes via tiered storage |
| `read_replica` | Read-only replica from another cluster's tiered storage |
| `cloud_topic` | Redpanda Cloud Topic (L0/L1 storage) |
| `cloud_topic_read_replica` | Cloud Topic read replica |

### Output sections

**SUMMARY:** name, partitions, replicas, cloud-storage-mode, last-upload age.

**OFFSETS:** per-partition `CLOUD-START`, `CLOUD-LAST`, `LOCAL-START`, `LOCAL-LAST`.

**SIZE (tiered):** `PARTITION`, `CLOUD-BYTES`, `LOCAL-BYTES`, `TOTAL-BYTES`,
`CLOUD-SEGMENTS`, `LOCAL-SEGMENTS`.

**SIZE (cloud_topic):** `PARTITION`, `LOCAL-BYTES`, `L0-BYTES`, `L1-BYTES`,
`TOTAL-BYTES`, `L1-EXTENTS`.

**SYNC:** `PARTITION`, `LAST-SEGMENT-UPLOAD`, `LAST-MANIFEST-UPLOAD`,
`METADATA-UPDATE-PENDING`, and optionally `LAST-MANIFEST-SYNC` for read replicas.

```bash
rpk topic describe-storage orders -a -H
rpk topic describe-storage orders -z -y
```

---

## delete

```bash
rpk topic delete <TOPICS...> [flags]
```

Deletes all named topics. The `--regex` flag wraps each expression with `^`
and `$`, matching whole topic names only.

| Flag | Short | Description |
|---|---|---|
| `--regex` | `-r` | Parse topic names as regular expressions |

```bash
# Delete one topic
rpk topic delete old-data

# Delete multiple
rpk topic delete test-a test-b test-c

# Delete by pattern
rpk topic delete -r '^test-.*'
rpk topic delete -r '.*-2023$'
```

**Preview before deleting:**

```bash
# See what matches before you delete
rpk topic list -r '^test-.*'
# Then delete
rpk topic delete -r '^test-.*'
```

---

## Common config key reference

| Key | Description |
|---|---|
| `cleanup.policy` | `delete` (default), `compact`, or `compact,delete` |
| `retention.ms` | Max age of records in ms; `-1` = unlimited |
| `retention.bytes` | Max total size per partition; `-1` = unlimited |
| `segment.ms` | Max segment age before roll |
| `segment.bytes` | Max segment size before roll |
| `max.message.bytes` | Max record batch size (bytes) |
| `compression.type` | `producer`, `none`, `gzip`, `snappy`, `lz4`, `zstd` |
| `message.timestamp.type` | `CreateTime` or `LogAppendTime` |
| `redpanda.remote.write` | `true`/`false` — enable tiered storage writes |
| `redpanda.remote.read` | `true`/`false` — enable tiered storage reads |
| `min.insync.replicas` | Minimum ISR count for successful produce |
| `replication.factor` | Cannot be changed after creation via this API |
| `write.caching` | `true`/`false` — ack on majority before fsync (see enterprise reference) |

**Enterprise topic properties** (Tiered Storage, Cloud Topics, Iceberg Topics,
Remote Read Replicas, Leader Pinning, Schema ID Validation) are set the same way
via `create -c` / `alter-config --set`. See
[enterprise-topic-properties.md](enterprise-topic-properties.md) for the full
nested key list (`redpanda.iceberg.*`, `redpanda.storage.mode`,
`redpanda.leaders.preference`, `redpanda.remote.readreplica`,
`redpanda.key/value.schema.id.validation`, etc.) and license requirements.
