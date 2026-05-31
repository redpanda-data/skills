# rpk group seek and offset-delete

This reference covers the two offset-management commands in `rpk group`:

- **`rpk group seek`** — rewrites the committed offsets for a group to a new position (start, end, timestamp, another group's commits, or an explicit file).
- **`rpk group offset-delete`** — surgically deletes committed offsets for specific topic-partitions without removing the entire group.

## rpk group seek

### Usage

```
rpk group seek [GROUP] --to (start|end|timestamp) --to-group ... --topics ... [flags]
```

Exactly one of `--to`, `--to-group`, or `--to-file` must be specified. They are mutually exclusive.

### Flags

| Flag | Type | Description |
|---|---|---|
| `--to` | string | Seek destination: `start`, `end`, or a Unix timestamp (second/millisecond/nanosecond) |
| `--to-group` | string | Seek to the committed offsets of another group (merging operation) |
| `--to-file` | string | Seek to offsets listed in a text file |
| `--topics` | strings | Comma-separated list of topics to seek; others remain unchanged |
| `--allow-new-topics` | bool | Allow committing offsets for topics the group has not previously consumed |
| `--format` | string | Output format: `json`, `yaml`, `text`, `wide`, `help`. Default: `text`. `wide` behaves like `text` for non-tabular output; `help` prints the schema. |

### The Empty-Group Requirement

When using `--to` (start, end, or timestamp), **the group must be empty** — it must have no active consumer instances. If any consumer is still running, the seek fails with:

```
INVALID_OPERATION: seeking a non-empty group is not allowed.
```

This error string is a remap performed by rpk: the broker returns `UnknownMemberID` when an OffsetCommit is issued by a client (rpk) that is not a joined member of a non-empty group. rpk translates that error into the friendlier `INVALID_OPERATION: seeking a non-empty group is not allowed.` message.

**With `--to-group` and `--to-file`, the group is allowed to be active** because those seek modes perform a merging operation by directly committing offsets — no broker-side restriction applies.

### Seek to Start

Rewinds every committed topic/partition to offset 0 (the log-start offset — the earliest available record):

```bash
# Stop consumers first, then:
rpk group seek my-group --to start
```

### Seek to End

Fast-forwards every committed topic/partition to the current log-end offset (skips all backlog):

```bash
rpk group seek my-group --to end
```

### Seek to a Timestamp

The `--to` flag accepts a Unix epoch timestamp. The broker finds the first offset whose timestamp is at or after the given value (via `ListOffsetsAfterMilli`).

Accepted formats:

| Format | Digits | Example |
|---|---|---|
| Unix seconds | 10 | `1622505600` |
| Unix milliseconds | 13 | `1622505600000` |
| Unix nanoseconds | 19 | `1622505600000000000` |

```bash
# Seek to June 1, 2021 00:00:00 UTC
rpk group seek my-group --to 1622505600
rpk group seek my-group --to 1622505600000
rpk group seek my-group --to 1622505600000000000
```

All three examples above are equivalent. rpk normalizes all three forms to milliseconds before the broker lookup: 10-digit values are multiplied by 1000, 13-digit values are used as-is, and 19-digit values are divided by 1,000,000. Sub-millisecond precision in nanosecond timestamps is silently truncated.

### Limiting Seek to Specific Topics

Use `--topics` to seek only some topics; all other existing commits are left unchanged:

```bash
# Reset only the orders topic; payments commits stay where they are
rpk group seek my-group --to start --topics orders

# Reset multiple topics
rpk group seek my-group --to end --topics orders,payments,inventory
```

By default, topics that have no existing commit are **not** sought. To seek a topic the group has never consumed before:

```bash
rpk group seek my-group --to start --topics new-topic --allow-new-topics
```

### Seek to Another Group's Commits (`--to-group`)

This is a merging operation. The commits from the source group are applied on top of the target group's existing commits. Topics not present in the source group are untouched.

```bash
# Example: g1 commits topics A and B; g2 commits only topic B.
# After this command: g1's topic-B commits become g2's; g1's topic-A unchanged.
rpk group seek g1 --to-group g2

# Narrow to a single topic
rpk group seek g1 --to-group g2 --topics topic-b
```

Unlike `--to`, `--allow-new-topics` is implied: topics in the source group that the target group has not consumed are also committed.

### Seek from a File (`--to-file`)

The file must contain one entry per line, with `TOPIC PARTITION OFFSET` separated by a space or a tab:

```
orders    0  80000
orders    1  80000
payments  0  5000
payments  1  5000
```

```bash
rpk group seek my-group --to-file /path/to/offsets.txt
```

As with `--to-group`, `--allow-new-topics` is implied.

`--topics` can be used to further filter which lines in the file are applied.

### Seek Output

```
TOPIC    PARTITION  PRIOR-OFFSET  CURRENT-OFFSET
orders   0          80100         0
orders   1          80200         0
payments 0          5342          0
payments 1          6100          0
```

If any partition fails (e.g. the group is still active), an `ERROR` column appears:

```
TOPIC    PARTITION  PRIOR-OFFSET  CURRENT-OFFSET  ERROR
orders   0          80100         80100           INVALID_OPERATION: seeking a non-empty group is not allowed.
```

JSON field names: `topic`, `partition`, `prior_offset`, `current_offset`, `error` (omitempty).

### Full Safe Reset Playbook

This is the recommended sequence for resetting a production consumer group:

```bash
# Step 1: Identify the group and check its current state and lag
rpk group describe my-group --print-summary

# Step 2: Stop all consumer instances for this group
#   (scale deployment to 0, stop services, etc.)

# Step 3: Confirm the group is now Empty
rpk group list --states empty | grep my-group

# Step 4: Seek to desired position
rpk group seek my-group --to start

# Step 5: Verify the offsets were updated
rpk group describe my-group --print-commits

# Step 6: Restart consumers
#   (scale deployment back up, restart services)

# Step 7: Confirm lag is decreasing
rpk group describe my-group --print-summary
```

### Bad-Deploy Recovery Playbook

When a buggy deployment has consumed and committed bad data:

```bash
# Record the timestamp of the bad deploy (Unix milliseconds)
BAD_DEPLOY_TS=1700000000000

# Stop consumers
# Confirm group is empty:
rpk group list --states empty | grep my-group

# Rewind to just before the bad deploy (scope to affected topics with --topics)
# WARNING: without --topics, this rewinds ALL committed topics for the group,
# including any topics unrelated to the bad deploy. Use --topics to scope the
# reset to only the affected topics.
rpk group seek my-group --to $((BAD_DEPLOY_TS - 60000)) --topics affected-topic   # 1 minute before

# Verify: also note that partitions with no record at/after the timestamp will
# be seeked to the end (log-end offset), not the beginning.
rpk group describe my-group --print-commits

# Redeploy with the fixed version and restart consumers
```

---

## rpk group offset-delete

`rpk group offset-delete` forcefully deletes committed offsets for specific topic-partition tuples. Unlike `rpk group delete` (which removes the entire group), this command removes only the specified offsets while leaving the rest of the group intact.

### Usage

```
rpk group offset-delete [GROUP] --from-file FILE --topic foo:0,1,2 [flags]
```

### Broker Enforcement

The broker allows `offset-delete` when either:
- The group is in `Empty` state (no active members), **or**
- The specific topic-partitions being deleted are not currently subscribed to by any group member.

This is less restrictive than `seek` — you can delete offsets for topics the group has stopped consuming while the group is still active on other topics.

### Flags

| Flag | Short | Type | Description |
|---|---|---|---|
| `--topic` | `-t` | stringArray | `topic:partition_id` — repeatable; comma-separated partition list; omit partition list to target all partitions |
| `--from-file` | `-f` | string | Path to file with topic/partition tuples (one per line, space or tab separated) |
| `--format` | — | string | Output format: `json`, `yaml`, `text`, `wide`, `help`. Default: `text`. `wide` behaves like `text`; `help` prints the schema. |

`--topic` and `--from-file` are mutually exclusive.

### Using `--topic`

```bash
# Delete offsets for partitions 0, 1, and 2 of the orders topic
rpk group offset-delete my-group --topic orders:0,1,2

# Delete offsets for ALL partitions of the orders topic (no partition list)
rpk group offset-delete my-group --topic orders

# Multiple topics in one command (repeat the flag)
rpk group offset-delete my-group --topic orders:0,1 --topic payments
```

### Using `--from-file`

File format: one `topic partition` entry per line, separated by space or tab:

```
orders    0
orders    1
orders    2
payments  0
```

```bash
rpk group offset-delete my-group --from-file partitions.txt
```

### Output

```
orders    0  OK
orders    1  OK
payments  0  OK
```

On error (e.g. the group still subscribes to that partition), the STATUS column contains the raw error string returned by the broker — there is no `KAFKA_ERROR:` prefix added by rpk. The exact string depends on the Kafka/kadm error; for example, if the group is subscribed, the STATUS column will show a non-OK error string such as `GROUP_SUBSCRIBED_TO_TOPIC`.

JSON field names: `topic`, `partition`, `status`.

### When to Use offset-delete vs seek vs delete

| Scenario | Best command |
|---|---|
| Rewind/fast-forward all offsets for a group | `rpk group seek` |
| Remove committed offsets for a topic the group no longer consumes | `rpk group offset-delete` |
| Remove temporary test group and all its offsets | `rpk group delete` |
| Copy offsets from another group | `rpk group seek --to-group` |

---

## rpk group delete

Deletes one or more entire groups and all their committed offsets.

```bash
rpk group delete my-test-group stale-group-1 stale-group-2
```

Output:

```
GROUP             STATUS
my-test-group     OK
stale-group-1     OK
stale-group-2     OK
```

Groups are also automatically deleted after being empty for `group_offset_retention_sec` (a cluster configuration property). Explicit deletion is useful when you want offsets cleaned up immediately (e.g. after testing).

**Note:** The Kafka DeleteGroups API rejects deletion of non-empty groups at the broker level. When a group has active members, the broker returns a per-group error that appears in the STATUS column of `rpk group delete` output. rpk itself does not pre-validate the group state before sending the request.

---

## Connection Flags Reference

All `rpk group` commands accept standard rpk connection flags:

```bash
# Override broker list inline
rpk group seek my-group --to start -X brokers=broker1:9092,broker2:9092

# Use a named rpk profile
rpk group seek my-group --to start --profile production

# Full manual SASL+TLS override
rpk group seek my-group --to start \
  -X brokers=seed.cloud.redpanda.com:9092 \
  -X tls.enabled=true \
  -X sasl.mechanism=SCRAM-SHA-256 \
  -X user=myuser \
  -X pass=mypassword
```
