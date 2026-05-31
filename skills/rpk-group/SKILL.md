---
name: rpk-group
description: >-
  Use rpk group to list and describe consumer groups, inspect lag and members,
  reset or seek consumer group offsets, delete groups, and delete committed
  offsets. Use when: inspecting consumer group lag and membership; resetting or
  seeking consumer group offsets (to earliest/latest/timestamp/specific offset
  or to another group's commits); stopping consumers and rewinding after a bad
  deploy; deleting a consumer group; deleting committed offsets for specific
  topic-partitions; reading CURRENT-OFFSET, LOG-END-OFFSET, and LAG columns;
  spotting stuck or over-lagged consumer groups; using rpk group list, describe,
  seek, offset-delete, or delete subcommands; verifying or repairing consumer
  group offsets after a Shadow Linking disaster-recovery failover (Enterprise
  offset-preserving replication, consumer_offset_sync_options, group_filters,
  offset clamping); and authorizing rpk group operations via GROUP-resource ACLs,
  Enterprise RBAC roles (rpk security role / --allow-role), or Enterprise GBAC
  OIDC Group: principals.
---

# rpk group: Consumer Group Management

`rpk group` is the CLI interface for managing Kafka consumer groups on a Redpanda cluster. It lets you list groups, inspect their lag and partition assignment, reset offsets to rewind or fast-forward consumption, delete groups, and surgically remove committed offsets for specific partitions. The alias `rpk g` works everywhere `rpk group` does.

Consumer groups commit offsets to the internal `__consumer_offsets` topic so brokers can track progress. Lag — the gap between the last committed offset and the log-end offset — is the primary signal that a group is healthy or falling behind.

## Quickstart

```bash
# 1. List all groups (see group name, coordinator broker, and state)
rpk group list

# 2. Filter by state (e.g. only Stable groups)
rpk group list --states Stable

# 3. Describe a group — shows members, committed offsets, log-end offsets, and lag
rpk group describe my-consumer-group

# 4. Describe all groups matching a regex pattern
rpk group describe -r '^payments-.*'

# 5. Describe multiple groups at once
rpk group describe group-a group-b group-c

# 6. Show summary block only (GROUP, COORDINATOR-NODE, COORDINATOR-PARTITION, STATE, BALANCER, MEMBERS, TOTAL-LAG)
rpk group describe my-consumer-group --print-summary

# 7. Show aggregated lag per topic
rpk group describe my-consumer-group --print-lag-per-topic

# --- Seek / reset offsets (group must be empty: stop all consumers first) ---

# 8. Rewind to the very beginning of all committed topics
rpk group seek my-consumer-group --to start

# 9. Fast-forward to the end (skip everything in backlog)
rpk group seek my-consumer-group --to end

# 10. Seek to a specific Unix timestamp (second, millisecond, or nanosecond accepted)
rpk group seek my-consumer-group --to 1622505600        # second
rpk group seek my-consumer-group --to 1622505600000     # millisecond
rpk group seek my-consumer-group --to 1622505600000000000  # nanosecond

# 11. Seek only specific topics (leave others untouched)
rpk group seek my-consumer-group --to start --topics orders,payments

# 12. Seek to match another group's committed offsets (merging operation)
rpk group seek target-group --to-group source-group

# 13. Seek to offsets listed in a file (topic partition offset, space or tab separated)
rpk group seek my-consumer-group --to-file offsets.txt

# 14. Seek to a new topic the group has not consumed before
rpk group seek my-consumer-group --to start --topics new-topic --allow-new-topics

# --- Delete offsets (surgical; group may be active but must not hold those offsets) ---

# 15. Delete committed offsets for specific partitions
rpk group offset-delete my-consumer-group --topic orders:0,1,2

# 16. Delete all offsets for a topic (no partition list = all partitions)
rpk group offset-delete my-consumer-group --topic orders

# 17. Delete offsets from a file listing topic-partition tuples
rpk group offset-delete my-consumer-group --from-file partitions.txt

# --- Delete entire group ---

# 18. Delete one or more groups (removes all their committed offsets)
rpk group delete my-consumer-group temp-test-group
```

## Command Reference

| Subcommand | Aliases | What it does |
|---|---|---|
| `rpk group list` | `ls` | Lists all groups with coordinator broker and state |
| `rpk group describe` | — | Shows members, per-partition offsets, and lag |
| `rpk group seek` | — | Rewrites committed offsets to start/end/timestamp/group/file |
| `rpk group offset-delete` | — | Deletes committed offsets for specific topic-partitions |
| `rpk group delete` | — | Deletes one or more entire groups |

All subcommands accept the standard rpk connection flags: `-X brokers=...`, `--profile`, `--config`, `-X tls.*`, `-X sasl.*`. Output format can be set with `--format json|yaml|text|wide|help`. `wide` adds extra columns for describe (and otherwise equals text); `help` prints the output schema.

## Listing Groups

```bash
rpk group list
```

Output columns:

| Column | Description |
|---|---|
| `BROKER` | Node ID of the group coordinator |
| `GROUP` | Consumer group name |
| `STATE` | Group lifecycle state (see below) |

Group states: `PreparingRebalance`, `CompletingRebalance`, `Stable`, `Dead`, `Empty`.

Filter by state with `--states` (case-insensitive, comma-separated):

```bash
rpk group list --states stable,empty
```

## Describing Groups

`rpk group describe` calculates lag and shows detailed partition-level information.

```bash
rpk group describe my-consumer-group
```

Default output has two sections per group:

**Summary block:**

```
GROUP             my-consumer-group
COORDINATOR-NODE  1
COORDINATOR-PARTITION __consumer_offsets/23
STATE             Stable
BALANCER          range
MEMBERS           3
TOTAL-LAG         4201
```

**Per-partition table:**

```
TOPIC    PARTITION  CURRENT-OFFSET  LOG-START-OFFSET  LOG-END-OFFSET  LAG   MEMBER-ID                      CLIENT-ID   HOST
orders   0          80100           0                 80150           50    consumer-1-abc123-0            my-app      /10.0.0.1
orders   1          80200           0                 81200           1000  consumer-1-abc123-1            my-app      /10.0.0.1
orders   2          -               0                 3151            3151  -                              -           -
```

Key columns:

| Column | Meaning |
|---|---|
| `CURRENT-OFFSET` | Last committed offset; `-` means nothing committed yet |
| `LOG-START-OFFSET` | Earliest available offset in that partition |
| `LOG-END-OFFSET` | Next offset to be written (producer high watermark) |
| `LAG` | `LOG-END-OFFSET - CURRENT-OFFSET`; `-` when nothing produced |
| `MEMBER-ID` | Which consumer instance owns this partition; empty if unassigned |

Flags:

| Flag | Short | Effect |
|---|---|---|
| `--print-summary` | `-s` | Print only the summary block (GROUP, COORDINATOR-NODE, COORDINATOR-PARTITION, STATE, BALANCER, MEMBERS, TOTAL-LAG, and ERROR if present) |
| `--print-commits` | `-c` | Print only the partition commit table (no summary) |
| `--print-lag-per-topic` | `-t` | Print summary + aggregated lag per topic |
| `--regex` | `-r` | Treat arguments as regular expressions |
| `--instance-ID` | `-i` | Add the INSTANCE-ID column (for static membership) |
| `--format` | — | `json`, `yaml`, `text`, `wide`; default `text` |

## Seeking (Resetting) Offsets

`rpk group seek` rewrites committed offsets. **The group must be empty (no active consumers) before seeking with `--to`**; otherwise the broker returns `INVALID_OPERATION: seeking a non-empty group is not allowed.`

### `--to start` / `--to end`

```bash
# Rewind all committed topics to the beginning
rpk group seek my-group --to start

# Skip everything in the backlog
rpk group seek my-group --to end
```

### `--to <timestamp>`

Accepts Unix epoch in seconds (10 digits), milliseconds (13 digits), or nanoseconds (19 digits). rpk normalizes all forms to milliseconds before the broker lookup; nanosecond timestamps are divided by 1,000,000, so sub-millisecond precision is silently truncated:

```bash
rpk group seek my-group --to 1622505600          # June 1 2021 00:00:00 UTC
rpk group seek my-group --to 1622505600000       # same, in ms
rpk group seek my-group --to 1622505600000000000 # same, in ns (truncated to ms)
```

### `--topics` (per-topic filter)

Only seek the listed topics; other commits remain unchanged:

```bash
rpk group seek my-group --to start --topics orders,inventory
```

**Caution:** A bare `--to <value>` without `--topics` seeks every topic the group has committed offsets for. When using a timestamp seek for incident recovery, always use `--topics` to scope the rewind to only the affected topics and avoid rewinding unrelated topics. Also note that partitions with no record at or after the given timestamp will be seeked to the log-end offset (not the beginning).

Topics with no existing commit are **not** sought unless `--allow-new-topics` is passed:

```bash
rpk group seek my-group --to start --topics brand-new-topic --allow-new-topics
```

### `--to-group` (copy another group's commits)

Merging operation: commits are updated only for topics the source group has committed; `--allow-new-topics` is implied.

```bash
# Copy topic-B commits from g2 into g1 (g1's topic-A commits are unchanged)
rpk group seek g1 --to-group g2

# Narrow to a single topic
rpk group seek g1 --to-group g2 --topics topic-b
```

### `--to-file` (explicit offset file)

File format: one line per `TOPIC PARTITION OFFSET` (space or tab separated):

```
orders    0  80000
orders    1  80000
inventory 0  5000
```

```bash
rpk group seek my-group --to-file offsets.txt
```

Seek output shows `PRIOR-OFFSET` and `CURRENT-OFFSET` for each partition committed:

```
TOPIC    PARTITION  PRIOR-OFFSET  CURRENT-OFFSET
orders   0          80100         0
orders   1          80200         0
orders   2          -1            0
```

## Deleting Committed Offsets

`rpk group offset-delete` surgically removes committed offsets for specific partitions **without** deleting the whole group. The broker allows the request when the group is in a dead/empty state (no subscriptions) **or** when the specific topic-partitions requested are not currently subscribed to by any group member.

```bash
# Delete offsets for specific partitions of a topic
rpk group offset-delete my-group --topic orders:0,1,2

# Delete offsets for all partitions of a topic (omit partition list)
rpk group offset-delete my-group --topic orders

# Repeatable: delete offsets for multiple topics
rpk group offset-delete my-group --topic orders:0,1 --topic payments

# From a file (topic and partition per line, space or tab separated)
rpk group offset-delete my-group --from-file partitions.txt
```

File format for `--from-file`:

```
orders    0
orders    1
payments  0
```

`--from-file` and `--topic` are mutually exclusive.

## Deleting Groups

Deletes the group and all its committed offsets. Groups are also automatically cleaned up after they have been empty for `group_offset_retention_sec` (cluster config). Explicit deletion is useful for cleaning up temporary test groups immediately.

```bash
rpk group delete my-test-group old-group
```

Output:

```
GROUP          STATUS
my-test-group  OK
old-group      OK
```

## Safe Reset Playbook

1. Identify the group to reset: `rpk group describe my-group --print-summary`
2. Stop all consumer instances for that group (scale to 0, stop the service, etc.)
3. Confirm the group is `Empty`: `rpk group list --states empty`
4. Seek to the desired position: `rpk group seek my-group --to start`
5. Verify the new offsets: `rpk group describe my-group --print-commits`
6. Restart consumers.

## Authorizing rpk group Operations

Each `rpk group` subcommand maps to Kafka APIs the broker authorizes against the `GROUP` resource (and sometimes `TOPIC`):

| Subcommand | Required permission |
|---|---|
| `rpk group list` | `DESCRIBE` on `GROUP` (or `DESCRIBE` on `CLUSTER`) |
| `rpk group describe` | `DESCRIBE` on `GROUP` + `DESCRIBE` on `TOPIC` |
| `rpk group seek` | `DESCRIBE` + `READ` on `GROUP` + `READ`/`DESCRIBE` on `TOPIC` |
| `rpk group offset-delete` | `DELETE` on `GROUP` + `READ` on `TOPIC` |
| `rpk group delete` | `DELETE` on `GROUP` |

Grant with plain ACLs (free), or at scale with **RBAC** roles (Enterprise) or **GBAC** OIDC `Group:` principals (Enterprise):

```bash
# Plain ACL: full group admin
rpk security acl create --allow-principal User:group-admin \
  --operation read,describe,delete --group my-consumer-group

# RBAC (Enterprise): bind to a role, then assign
rpk security acl create --allow-role group-admin \
  --operation read,describe,delete --group my-consumer-group
rpk security role assign group-admin --principal alice,Group:sre
```

RBAC roles and `Group:` ACLs require an Enterprise license. See [authorization.md](references/authorization.md).

## Consumer Groups in Disaster Recovery (Shadow Linking)

Shadowing is Redpanda's **Enterprise** DR feature: offset-preserving replication to a read-only shadow cluster. The **Consumer Group Shadowing task** replicates committed group offsets and membership so consumers resume after failover. It is configured via `consumer_offset_sync_options` in the shadow-link config (`rpk shadow config generate`):

```yaml
consumer_offset_sync_options:
  interval: 30s          # how often to sync group offsets
  paused: false          # pause this task without stopping the whole link
  group_filters:
  - pattern_type: PREFIX   # LITERAL | PREFIX
    filter_type: INCLUDE   # INCLUDE | EXCLUDE
    name: prod-consumer-   # group name / prefix, or '*' for all
```

Only offsets for *active shadow topics* are replicated, and offsets are **clamped** to the shadow partition's high watermark. After a failover, verify and repair with the same commands in this skill:

```bash
rpk group describe prod-consumer-orders --print-commits   # verify replicated offsets
rpk group seek prod-consumer-orders --to <timestamp> --topics orders   # repair if wrong
```

Requires an Enterprise license. See [shadow-link-consumer-groups.md](references/shadow-link-consumer-groups.md).

## Reference Directory

- [describe.md](references/describe.md): Deep reference for `rpk group describe` — reading members, partition assignments, committed offset, log-end offset, and lag; the summary/commits/lag-per-topic output modes; and how to spot stuck or over-lagged groups.
- [seek-and-reset.md](references/seek-and-reset.md): Deep reference for `rpk group seek` and `rpk group offset-delete` — all `--to` modes, `--to-group`, `--to-file`, the empty-group requirement, safe reset playbook, and per-partition offset deletion.
- [authorization.md](references/authorization.md): Which `GROUP`/`TOPIC` ACL operations each `rpk group` subcommand requires, and how to grant them via plain ACLs, Enterprise RBAC roles (`rpk security acl create --allow-role`, `rpk security role assign`), or Enterprise GBAC OIDC `Group:` principals. Notes license-expiration behavior.
- [shadow-link-consumer-groups.md](references/shadow-link-consumer-groups.md): How consumer group offsets are replicated by Shadow Linking (Enterprise DR) — the `consumer_offset_sync_options` config (`interval`, `paused`, `group_filters` with `pattern_type`/`filter_type`/`name`), selective per-topic replication, offset clamping, group-name conflict guidance, and the post-failover verify/repair playbook using `rpk group describe`/`seek`.
