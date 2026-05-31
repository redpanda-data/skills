# Continuous Data Balancing (Enterprise)

**Requires an Enterprise license.** Continuous Data Balancing is enabled by default for all new clusters that have a valid license. On license expiration, the cluster reverts to `node_add` balancing (partitions are balanced only when a broker is added). Continuous Intra-Broker (core) balancing (`core_balancing_continuous`) is separately licensed and is disabled on expiration.

## What It Does

Continuous Data Balancing continuously monitors node availability, rack availability, and disk usage, and dynamically moves partition replicas to keep the cluster balanced and healthy ("self-healing"). It maintains the configured replication level after infrastructure failure, and repairs rack-awareness constraints once a failed/replacement rack returns.

## Partition Autobalancing Modes

Controlled by the cluster property `partition_autobalancing_mode`:

```bash
rpk cluster config get partition_autobalancing_mode
rpk cluster config set partition_autobalancing_mode <value>
```

| Mode | Behavior | License |
|---|---|---|
| `node_add` | Partitions are balanced only when brokers are added. New partitions go to random healthy brokers. Default for clusters **without** an enterprise license. | Community |
| `continuous` | Redpanda continuously monitors broker failures, high disk usage, and rack availability, and automatically redistributes partitions. Default for clusters **with** an enterprise license. | **Enterprise** |
| `off` | All Redpanda-initiated partition balancing is disabled. Not recommended for production; only for manual partition moves. | Community |

To disable Continuous Data Balancing (e.g., to remove a license violation):

```bash
rpk cluster config set partition_autobalancing_mode node_add
```

## Continuous-Mode Tuning Properties

These apply when `partition_autobalancing_mode=continuous`:

| Cluster property | Default | Purpose |
|---|---|---|
| `partition_autobalancing_node_availability_timeout_sec` | `900` (15 min) | If a node is unreachable for this long, Redpanda re-creates its replicas on other nodes (rebalances) while keeping the node in the cluster so it can rejoin. |
| `partition_autobalancing_node_autodecommission_timeout_sec` | `null` (disabled) | If a node is unavailable for this long, Redpanda **permanently** decommissions it (it cannot rejoin). Only one node is decommissioned at a time; only applies in `continuous` mode. |
| `partition_autobalancing_max_disk_usage_percent` | `80` | When a node's disk usage reaches this percentage, Redpanda moves replicas off it onto nodes below the threshold. |

## Intra-Broker (Core) Partition Balancing

Balances a topic's partition replicas across the CPU cores **within** a single broker (thread-per-core architecture). Configured separately from cross-broker balancing:

| Cluster property | Default | Purpose | License |
|---|---|---|---|
| `core_balancing_on_core_count_change` | `true` | Rebalance partitions across cores after broker startup when its core count changes. | Community |
| `core_balancing_continuous` | `false` | Continuously rebalance partitions across cores at runtime (e.g., when partitions move to/from a broker). | **Enterprise** |

```bash
rpk cluster config set core_balancing_continuous false   # disable (license violation remediation)
```

Manually trigger an intra-broker rebalance via the Admin API:

```bash
curl -X POST http://localhost:9644/v1/partitions/rebalance_cores
curl http://localhost:9644/v1/partitions   # check resulting assignments
```

## Monitoring and Controlling Balancing

```bash
# Status: time since last balance, in-progress moves, unavailable nodes,
# nodes over disk threshold, and overall status.
rpk cluster partitions balancer-status
```

Status values: `off`, `ready`, `starting`, `in-progress`, `stalled`. If `stalled`, check for enough healthy nodes, sufficient disk space, partition quorum, and nodes in maintenance mode.

```bash
# Cancel current partition movements (cluster-wide)
rpk cluster partitions movement-cancel

# Cancel moves only on node 1
rpk cluster partitions movement-cancel --node 1
```

To fully stop balancing, first set `partition_autobalancing_mode=off`, then cancel moves — otherwise Redpanda reschedules another balancing round while continuous mode is enabled.
