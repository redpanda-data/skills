# rpk group describe

`rpk group describe` fetches group lag information and prints detailed information about a group's members, partition assignments, committed offsets, and per-partition lag.

## Usage

```
rpk group describe [GROUPS...] [flags]
```

At least one group name (or regex with `-r`) must be supplied. Multiple groups can be described in a single call:

```bash
rpk group describe group-a group-b
```

## Flags

| Flag | Short | Type | Description |
|---|---|---|---|
| `--print-summary` | `-s` | bool | Print only the group summary block |
| `--print-commits` | `-c` | bool | Print only the partition commit table |
| `--print-lag-per-topic` | `-t` | bool | Print summary + aggregated lag per topic |
| `--regex` | `-r` | bool | Treat arguments as regular expressions |
| `--instance-ID` | `-i` | bool | Include the INSTANCE-ID column for static group members |
| `--format` | — | string | Output format: `json`, `yaml`, `text`, `wide`, `help`. Default: `text`. `wide` adds extra columns; `help` prints the schema. |
| `--profile` | — | string | rpk profile to use |
| `-X, --config-opt` | — | stringArray | Override rpk config (e.g. `-X brokers=localhost:9092`) |

`--print-summary` and `--print-commits` are mutually exclusive. `--print-lag-per-topic` and `--print-commits` are also mutually exclusive. If both `--print-lag-per-topic` and `--print-summary` are set, `--print-lag-per-topic` takes precedence (it is checked first in the run logic).

## Understanding the Output

### Summary Block

```
GROUP             payments-consumer
COORDINATOR-NODE  2
COORDINATOR-PARTITION __consumer_offsets/7
STATE             Stable
BALANCER          range
MEMBERS           2
TOTAL-LAG         15342
```

| Field | Meaning |
|---|---|
| `GROUP` | Consumer group name |
| `COORDINATOR-NODE` | Broker node ID acting as the coordinator for this group |
| `COORDINATOR-PARTITION` | Partition in the `__consumer_offsets` internal topic that holds this group's commits. Computed via a hash of the group name. Shown only when metadata for `__consumer_offsets` is available. |
| `STATE` | Current group lifecycle state (see below) |
| `BALANCER` | Partition assignment strategy reported by the consumer (e.g. `range`, `roundrobin`, `sticky`, `cooperative-sticky`) |
| `MEMBERS` | Number of active consumer instances in the group |
| `TOTAL-LAG` | Sum of lag across all assigned partitions |

Group states:

| State | Meaning |
|---|---|
| `Stable` | Group is active; no membership changes in progress |
| `PreparingRebalance` | Group is preparing to rebalance (member joins/leaves) |
| `CompletingRebalance` | Waiting for the leader to publish the new assignment |
| `Empty` | No active members; offsets may still exist |
| `Dead` | Transient; group is being removed |

### Per-Partition Commit Table

```
TOPIC    PARTITION  CURRENT-OFFSET  LOG-START-OFFSET  LOG-END-OFFSET  LAG   MEMBER-ID                     CLIENT-ID    HOST
orders   0          80100           0                 80155           55    consumer-1-uuid-0             my-service   /10.0.0.5
orders   1          -               0                 3200            3200  -                             -            -
orders   2          80300           0                 80300           0     consumer-1-uuid-1             my-service   /10.0.0.6
```

| Column | Meaning |
|---|---|
| `TOPIC` | Topic name |
| `PARTITION` | Partition number |
| `CURRENT-OFFSET` | Last committed offset for this partition by this group. `-` means no commit has been made yet. |
| `LOG-START-OFFSET` | Earliest available offset in the partition (records before this have been deleted by retention) |
| `LOG-END-OFFSET` | Next offset to be written; the producer's high watermark |
| `LAG` | `LOG-END-OFFSET - CURRENT-OFFSET`. `-` when nothing has been produced yet (log-end offset is 0). |
| `MEMBER-ID` | The consumer instance assigned to this partition; empty/`-` if the partition is unassigned |
| `INSTANCE-ID` | (Visible with `-i`) Static instance ID for static group membership |
| `CLIENT-ID` | Client ID string reported by the consumer |
| `HOST` | IP address of the consumer instance |

**Key interpretation rules:**

- `CURRENT-OFFSET = -` and `LAG > 0`: The partition has messages but the group has never committed for it. Common for a group that has restarted with `auto.offset.reset=latest` and not yet consumed.
- `MEMBER-ID = -`: The partition has committed offsets but is not currently assigned to any consumer. This may indicate the group has fewer consumers than partitions, or the group is in an `Empty` state.
- Large `LAG` on a specific partition while others are near-zero: That partition's consumer may be slow, dead, or the partition itself has a backlog.

### `--print-summary` Mode

Prints only the summary header block: GROUP, COORDINATOR-NODE, COORDINATOR-PARTITION (when available), STATE, BALANCER, MEMBERS, TOTAL-LAG, and ERROR (when present). Useful for a quick overview of multiple groups without the per-partition noise.

```bash
rpk group describe -r '^payments.*' --print-summary
```

### `--print-commits` Mode

Prints only the partition commit table (skips the summary header). Useful when scripting to parse offsets.

```bash
rpk group describe my-group --print-commits
```

### `--print-lag-per-topic` Mode

Prints the summary block followed by a topic-level lag aggregation:

```
GROUP    my-group
...
TOTAL-LAG 15342

TOPIC     LAG
orders    10000
payments  5342
```

Useful when the group consumes many topics and you want to know which topic is generating the most lag.

## Regex Describe

```bash
# Describe all groups beginning with "payments-"
rpk group describe -r '^payments-.*'

# Describe all groups
rpk group describe -r '.*'

# Describe any single-character group
rpk group describe -r .
```

When `-r` is used, `rpk` first lists all groups and then filters them by your regex before describing.

## Machine-Readable Output

```bash
# JSON output
rpk group describe my-group --format json

# YAML output
rpk group describe my-group --format yaml
```

JSON field names (from source):

```json
{
  "group_name": "my-group",
  "coordinator_partition": "__consumer_offsets/7",
  "state": "Stable",
  "balancer": "range",
  "members": 2,
  "coordinator_node": 2,
  "total_lag": 15342,
  "partitions": [
    {
      "partition": 0,
      "current_offset": 80100,
      "log_start_offset": 0,
      "log_end_offset": 80155,
      "lag": 55,
      "topic": "orders",
      "member_id": "consumer-1-uuid-0",
      "client_id": "my-service",
      "host": "/10.0.0.5"
    }
  ],
  "members_details": [
    {
      "member_id": "consumer-1-uuid-0",
      "client_id": "my-service",
      "host": "/10.0.0.5",
      "topic_partitions": []
    }
  ]
}
```

Note: `current_offset: -1` in JSON indicates no commit has been made (displayed as `-` in text mode).

## Spotting Unhealthy Groups

### High total lag

```bash
rpk group describe my-group --print-summary
# Look at TOTAL-LAG — anything above your SLO is worth investigating
```

### Lag growing over time

Describe the group at two different times and compare `LOG-END-OFFSET`. If lag increases between snapshots, consumers are not keeping up. Consider scaling consumer instances or checking for processing bottlenecks.

### Unassigned partitions

Use `--format json` with `jq` for reliable filtering — awk column indexing is fragile because optional columns (INSTANCE-ID, ERROR) shift field numbers, and the unassigned MEMBER-ID renders as an empty string (not a literal `-`) in some output renderings:

```bash
rpk group describe my-group --format json \
  | jq '.[].partitions[] | select(.member_id == "" and .log_end_offset > 0)
        | {topic, partition, lag, log_end_offset}'
# Returns partitions with no assigned member that are accumulating lag
```

### Group stuck in rebalance

```bash
rpk group list --states PreparingRebalance
rpk group list --states CompletingRebalance
```

A group stuck in rebalance prevents consumers from making progress. Investigate the consumer logs for session timeout or heartbeat failures.

### Group in Empty state with residual lag

```bash
rpk group list --states Empty
rpk group describe <empty-group> --print-summary
```

An `Empty` group with `TOTAL-LAG > 0` means consumers have stopped but the group still has committed offsets. This is normal after a graceful shutdown. The offsets persist until the group is explicitly deleted or the `group_offset_retention_sec` timer expires.

## Connection Examples

```bash
# Self-managed cluster on localhost
rpk group describe my-group -X brokers=localhost:9092

# Using a named profile
rpk group describe my-group --profile production

# Redpanda Cloud with SASL
rpk group describe my-group \
  -X brokers=seed-abc.cloud.redpanda.com:9092 \
  -X tls.enabled=true \
  -X sasl.mechanism=SCRAM-SHA-256 \
  -X user=myuser \
  -X pass=mypassword
```
