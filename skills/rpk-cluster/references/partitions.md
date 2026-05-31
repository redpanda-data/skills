# rpk cluster partitions

`rpk cluster partitions` manages partition replica placement and the partition
balancer. All subcommands communicate with the Admin API.

## Subcommands

| Subcommand | What it does |
|---|---|
| `list [TOPICS...]` | List partitions with replica/leader placement |
| `balance` | Trigger on-demand partition balancing |
| `balancer-status` | Show balancer state and replica distribution |
| `move` | Move replicas to specific brokers/cores |
| `move-cancel` | Cancel ongoing replica movements |
| `move-status` | Show status of ongoing movements |
| `transfer-leadership` | Transfer leadership for a partition |
| `enable` | Re-enable a disabled partition |
| `disable` | Disable a partition (emergency isolation) |
| `unsafe-recover` | Recover partitions that lost quorum (last resort) |

## list

```bash
# List partitions for one or more topics
rpk cluster partitions list my-topic
rpk cluster partitions list foo bar

# List ALL partitions in the cluster
rpk cluster partitions list --all

# Filter by partition IDs
rpk cluster partitions list my-topic --partition 0,1

# Filter by broker IDs (show partitions that have a replica on broker 2)
rpk cluster partitions list my-topic --node-ids 2

# Show only disabled partitions
rpk cluster partitions list --all --disabled-only

# JSON output
rpk cluster partitions list my-topic --format json
```

Output columns: NAMESPACE, TOPIC, PARTITION, LEADER-ID, REPLICA-CORE, DISABLED.

- **REPLICA-CORE**: list of `<node-id>-<core>` assignments for each replica.
- **LEADER-ID**: `-` if the partition has no leader (leaderless).
- **DISABLED**: `-` if the cluster version does not support the disable API;
  `true`/`false` otherwise.

Prefixing a topic with `<namespace>/` queries internal namespaces, e.g.
`kafka_internal/tx`.

The output also shows **Leader distribution** and **Replica distribution**
sections that summarize how leaders and replicas are spread across brokers.

## balance

Triggers a one-time on-demand partition rebalancing. Useful after:
- A node rejoins the cluster after prolonged absence.
- Adding a new broker (Community Edition does not rebalance automatically).
- Noticing significant partition skew via `balancer-status`.

```bash
rpk cluster partitions balance
```

After running, monitor with:
```bash
rpk cluster partitions balancer-status
rpk cluster partitions move-status
```

## balancer-status

```bash
rpk cluster partitions balancer-status
rpk cluster partitions balancer-status --format json
```

Output fields:

| Field | Meaning |
|---|---|
| Status | `off`, `ready`, `starting`, `in_progress`, or `stalled` |
| Seconds Since Last Tick | When the balancer last ran |
| Current Reassignment Count | Active partition moves in progress |
| Unavailable Nodes | Nodes absent longer than `partition_autobalancing_node_availability_timeout_sec` |
| Over Disk Limit Nodes | Nodes exceeding `partition_autobalancing_max_disk_usage_percent` |
| Partitions Pending Recovery | Partitions pending force recovery (`partitions_pending_force_recovery_count`) |
| Broker Replica Distribution | Replica count per broker |

### Balancer states

- **off**: The balancer is disabled (`partition_autobalancing_mode=off`).
- **ready**: Active but nothing to balance.
- **starting**: Starting, has not run yet.
- **in_progress**: Actively scheduling moves.
- **stalled**: Violations detected but balancer cannot fix them.

### Diagnosing a stalled balancer

A stalled balancer usually means one of:
1. Not enough healthy nodes to absorb moves (e.g. 3-node cluster with
   replication factor 3 — no valid target exists).
2. All nodes are above 80% disk utilization (no room to move data).
3. A partition lacks quorum (majority of replicas are down).
4. A node is in maintenance mode (balancer pauses during maintenance).

## move

Manually reassign partition replicas to specific brokers (and optionally
specific CPU cores).

### Syntax

```
-p <topic>/<partition>:<broker1>,<broker2>,<broker3>
```

Or, when specifying the topic as a positional argument:
```
<topic> -p <partition>:<broker1>,<broker2>,<broker3>
```

With explicit core assignment (`<broker>-<core>`):
```
<topic> -p <partition>:<broker1>-<core1>,<broker2>-<core2>
```

### Examples

```bash
# Move partition 0 of "orders" to brokers 1, 2, 3
rpk cluster partitions move orders -p 0:1,2,3

# Move two partitions at once
rpk cluster partitions move orders -p 0:1,2,3 -p 1:2,3,4

# Move using fully qualified name (no positional topic arg)
rpk cluster partitions move -p orders/0:1,2,3

# Move an internal partition
rpk cluster partitions move -p kafka_internal/tx/0:1-0,2-0,3-0

# Pin all new replicas of partition 0 to core 0 on each broker
rpk cluster partitions move orders -p 0:1-0,2-0,3-0
```

**Notes:**
- You cannot change the replication factor with `move`. The number of brokers
  in the new assignment must match the current replication factor. To change
  replication factor, use `rpk topic alter-config ... -s replication.factor=N`.
- When a core is not specified for a new broker, rpk randomly picks a core.
- For core-only reassignment (same broker set, different core), use the
  `node-core` notation with existing node IDs.
- The command outputs: NAMESPACE, TOPIC, PARTITION, OLD-REPLICAS, NEW-REPLICAS,
  ERROR. An empty ERROR column means the movement was successfully initiated.
- After submitting, movements are asynchronous. Monitor with `move-status`.

## move-cancel

Cancels ongoing partition movements.

```bash
# Cancel ALL in-progress movements (prompts for confirmation)
rpk cluster partitions move-cancel

# Skip confirmation
rpk cluster partitions move-cancel --no-confirm

# Cancel only movements on broker 1
rpk cluster partitions move-cancel --node 1
```

## move-status

Shows in-progress partition movements. Polling this after `move` or `balance`
confirms work is progressing.

```bash
rpk cluster partitions move-status
rpk cluster partitions move-status --format json
```

## transfer-leadership

Transfers the raft leadership of a specific partition to a different replica
without moving data. Useful for rebalancing leader distribution.

The only flag is `--partition/-p`, which takes the format
`<partition>:<target-broker>` when paired with a positional topic argument, or
`<topic>/<partition>:<target-broker>` without one. For internal namespaces,
use `<namespace>/<topic>/<partition>:<target-broker>`.

```bash
# Topic as positional arg: transfer partition 0 of "my-topic" to broker 2
rpk cluster partitions transfer-leadership my-topic --partition 0:2

# Fully-qualified form (no positional arg)
rpk cluster partitions transfer-leadership --partition my-topic/0:2

# Internal namespace
rpk cluster partitions transfer-leadership --partition kafka_internal/tx/0:1
```

There are no `--topic` or `--target-broker` flags; both pieces of information
are encoded in the `--partition` value.

## enable and disable

Disabling a partition stops all production and consumption to it, halts
internal processes, and prevents it from loading at startup. The data remains
on disk but Redpanda will not interact with it. Use this only to isolate a
corrupted partition that is causing cluster instability.

The flag is `--partitions` (plural, `-p`). It accepts:
- `{namespace}/{topic}/[partitions...]` — e.g. `-p my-topic/0,1` or `-p kafka_internal/tx/5`
- A positional topic argument with partition numbers — e.g. `my-topic --partitions 0`
- `--all` to operate on every partition of the given topic

```bash
# Disable partition 0 of "my-topic"
rpk cluster partitions disable my-topic --partitions 0

# Short flag form
rpk cluster partitions disable -p my-topic/0

# Disable multiple partitions at once
rpk cluster partitions disable my-topic --partitions 0,1,2

# Disable ALL partitions of a topic
rpk cluster partitions disable my-topic --all

# Re-enable a partition
rpk cluster partitions enable my-topic --partitions 0
```

Note: `--partition` (singular) is not a valid flag on `enable`/`disable`; use
`--partitions` (plural) or `-p`.

## unsafe-recover

Recovers partitions that have permanently lost quorum due to multiple brokers
going offline at once. This can cause data loss (the out-of-sync replicas are
discarded). Only use when instructed by Redpanda Support.

**Required flag:** `--from-nodes <id1,id2,...>` — comma-separated IDs of the
permanently lost brokers whose replicas should be discarded. Omitting this flag
causes the command to fail with `required flag(s) --from-nodes not set`.

Additional flags:
- `--dry` — print the recovery plan without executing it.
- `--no-confirm` — skip the confirmation prompt.
- `--dry` and `--no-confirm` are mutually exclusive.

```bash
# Recover partitions that lost quorum when brokers 2 and 3 were permanently lost
rpk cluster partitions unsafe-recover --from-nodes 2,3

# Dry run: inspect the plan first
rpk cluster partitions unsafe-recover --from-nodes 2,3 --dry

# Apply without confirmation prompt
rpk cluster partitions unsafe-recover --from-nodes 2,3 --no-confirm
```

## Safe Partition Move Workflow

1. Identify the current placement:
   ```bash
   rpk cluster partitions list my-topic
   ```
2. Choose target brokers (must be the same count as current replication factor).
3. Submit the move:
   ```bash
   rpk cluster partitions move my-topic -p 0:1,2,3
   ```
4. Monitor progress:
   ```bash
   rpk cluster partitions move-status
   rpk cluster partitions balancer-status
   ```
5. Confirm completion (partition no longer appears in `move-status`):
   ```bash
   rpk cluster partitions list my-topic
   ```

## Partition Balancer Configuration

The balancer is controlled by these cluster properties (set with
`rpk cluster config set`):

| Property | Description |
|---|---|
| `partition_autobalancing_mode` | `off`, `node_add`, or `continuous` |
| `partition_autobalancing_max_disk_usage_percent` | Disk % that triggers rebalancing (default 80) |
| `partition_autobalancing_node_availability_timeout_sec` | Seconds before an unavailable node triggers replica re-creation (default 900). Node stays in cluster and can rejoin. |
| `partition_autobalancing_node_autodecommission_timeout_sec` | Seconds before an unavailable node is **permanently decommissioned** (default null = disabled). `continuous` mode only. |

`continuous` mode (**Enterprise**) monitors disk usage and node/rack
availability continuously; it is the default for licensed clusters. `node_add`
mode is the license-free fallback — it rebalances only when a node joins.
`off` disables automatic balancing entirely (use only for manual moves).

On license expiration, `continuous` reverts to `node_add`. To disable balancing
fully, set `partition_autobalancing_mode=off` first, then run
`rpk cluster partitions move-cancel`.

See [enterprise-features.md](enterprise-features.md) for Continuous Data
Balancing, Continuous Intra-Broker (Core) Balancing, and the full set of
enterprise cluster-config gates.
