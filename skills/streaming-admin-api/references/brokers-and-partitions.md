# Brokers and Partitions

Reference for the broker lifecycle and partition operation endpoints. All examples assume `ADMIN=http://localhost:9644` and superuser credentials `-u admin:secret` where needed.

---

## Broker Endpoints

### List All Brokers

```bash
curl "$ADMIN/v1/brokers"
```

Returns an array of `broker` objects. Each contains:

| Field | Type | Description |
|-------|------|-------------|
| `node_id` | long | Broker ID |
| `num_cores` | long | CPU cores |
| `rack` | string | Rack ID (for rack-aware replication) |
| `internal_rpc_address` | string | Internal RPC hostname |
| `internal_rpc_port` | long | Internal RPC port |
| `membership_status` | string | Cluster membership state (`active`, `draining`, etc.) |
| `is_alive` | boolean | Whether the cluster sees this node as alive |
| `recovery_mode_enabled` | boolean | Whether the node booted in recovery mode |
| `disk_space` | array | Disk space per data directory (`path`, `free`, `total` bytes) |
| `version` | string | Redpanda version string |
| `maintenance_status` | object | Maintenance mode drain state |
| `in_fips_mode` | string | FIPS mode status |

Example response for a single broker:
```json
[
  {
    "node_id": 1,
    "num_cores": 4,
    "rack": null,
    "internal_rpc_address": "redpanda-0.redpanda.default.svc.cluster.local",
    "internal_rpc_port": 33145,
    "membership_status": "active",
    "is_alive": true,
    "recovery_mode_enabled": false,
    "disk_space": [
      {"path": "/var/lib/redpanda/data", "free": 49283072000, "total": 107374182400}
    ],
    "version": "v25.1.2 - 123abc",
    "maintenance_status": {
      "draining": false,
      "finished": false,
      "errors": false,
      "partitions": 0,
      "eligible": 0,
      "transferring": 0,
      "failed": 0
    }
  }
]
```

### Get a Single Broker

```bash
curl "$ADMIN/v1/brokers/1"
```

Returns a single `broker` object (same schema as above).

### Get Node ID → UUID Mappings

```bash
curl "$ADMIN/v1/broker_uuids"
```

Returns an array of `{"node_id": 1, "uuid": "some-uuid-string"}`. The UUID is generated when a broker starts with an empty data directory.

### Cluster View

```bash
curl "$ADMIN/v1/cluster_view"
```

Returns `{"version": <long>, "brokers": [...]}`.

---

## Broker Maintenance Mode

Maintenance mode gracefully transfers partition leadership away from a broker before a planned restart, minimizing impact on clients.

### Enter Maintenance Mode

```bash
curl -u admin:secret -X PUT "$ADMIN/v1/brokers/2/maintenance"
```

### Check Maintenance Status

Poll the broker's maintenance status in the broker list or via the broker endpoint:

```bash
curl "$ADMIN/v1/brokers/2" | python3 -c "
import json, sys
b = json.load(sys.stdin)
m = b['maintenance_status']
print(f'draining={m[\"draining\"]} finished={m[\"finished\"]} transferring={m[\"transferring\"]} failed={m[\"failed\"]}')
"
```

The `maintenance_status` fields:
- `draining` — true while maintenance mode is active
- `finished` — true when all eligible leadership transfers are complete
- `errors` — true if any transfer failed
- `partitions` — total partitions on this node
- `eligible` — partitions eligible for leadership transfer
- `transferring` — partitions currently transferring leadership
- `failed` — partitions that failed to transfer

Wait for `finished=true` before restarting the broker.

### Exit Maintenance Mode

```bash
curl -u admin:secret -X DELETE "$ADMIN/v1/brokers/2/maintenance"
```

### Local Maintenance (Node-Self Endpoints)

These endpoints target the node receiving the request, not a specific broker ID:

```bash
# Put this node into maintenance
curl -u admin:secret -X PUT "$ADMIN/v1/maintenance"

# Remove this node from maintenance
curl -u admin:secret -X DELETE "$ADMIN/v1/maintenance"

# Get this node's maintenance status
curl "$ADMIN/v1/maintenance"
```

---

## Broker Decommission / Recommission

Decommission permanently removes a broker from the cluster. All its partition replicas are moved to other brokers before it is removed.

### Decommission a Broker

```bash
curl -u admin:secret -X PUT "$ADMIN/v1/brokers/3/decommission"
```

This starts the decommission process asynchronously.

### Monitor Decommission Progress

```bash
curl -u admin:secret "$ADMIN/v1/brokers/3/decommission"
```

Response schema (`decommission_status`):

| Field | Description |
|-------|-------------|
| `finished` | True when decommission is complete |
| `replicas_left` | Partitions still on this node |
| `allocation_failures` | NTPs that could not be relocated |
| `partitions` | Array of `partition_reconfiguration_status` per partition |
| `reallocation_failure_details` | Detailed failure info per NTP (ns, topic, partition, error) |

Poll until `finished=true`:
```bash
until curl -s -u admin:secret "$ADMIN/v1/brokers/3/decommission" | python3 -c "
import json, sys; s = json.load(sys.stdin)
print(s['finished'])
" | grep -q true; do sleep 5; done
echo "Decommission complete"
```

### Recommission (Cancel Decommission)

If you need to cancel an in-progress decommission:

```bash
curl -u admin:secret -X PUT "$ADMIN/v1/brokers/3/recommission"
```

### Cancel All Partition Moves Involving a Broker

Stop all in-progress partition moves that involve a specific broker (either as source or destination):

```bash
curl -u admin:secret -X POST "$ADMIN/v1/brokers/3/cancel_partition_moves"
```

---

## Pre/Post Restart Probes

### Pre-Restart Safety Check

Before restarting a broker, check which partitions are at risk:

```bash
curl "$ADMIN/v1/broker/pre_restart_probe"
```

Optional `?limit=<n>` to control how many partitions are listed per risk category (default 128).

Response contains a `risks` object with four NTP-string arrays:
- `rf1_offline` — RF=1 partitions that will go offline
- `full_acks_produce_unavailable` — acks=-1 produces may be rejected
- `unavailable` — partition goes fully unavailable (no consume or produce)
- `acks1_data_loss` — potential data loss for acks=1 producers

If all arrays are empty, the restart is low-risk.

### Post-Restart Recovery Check

After a broker restarts, check how much load it has reclaimed:

```bash
curl "$ADMIN/v1/broker/post_restart_probe"
```

Response: `{"load_reclaimed_pc": <0-100>}` — percentage of in-sync replicas reclaimed.

---

## Partition Endpoints

### List Node-Local Partitions

Returns partitions that have a replica on **this node only** (not cluster-wide):

```bash
curl "$ADMIN/v1/partitions"
```

Each `partition_summary` includes `ns`, `topic`, `partition_id`, `core`, `materialized`, `leader`.

### Node-Local Partition Summary

```bash
curl "$ADMIN/v1/partitions/local_summary"
```

Returns `{"count": 120, "leaderless": 0, "under_replicated": 0}`.

### Get Detailed Partition Info

Requires `{namespace}/{topic}/{partition}` path. For Kafka topics, namespace is `kafka`:

```bash
curl "$ADMIN/v1/partitions/kafka/my-topic/0"
```

Response (`partition` object):
```json
{
  "ns": "kafka",
  "topic": "my-topic",
  "partition_id": 0,
  "status": "done",
  "leader_id": 2,
  "raft_group_id": 7,
  "replicas": [
    {"node_id": 1, "core": 0},
    {"node_id": 2, "core": 1},
    {"node_id": 3, "core": 0}
  ],
  "disabled": false
}
```

`status` values include `done` (stable), `in_progress` (reconfiguring), `error`.

### Get All Partitions for a Topic

```bash
curl "$ADMIN/v1/partitions/kafka/my-topic"
```

Returns an array of `partition` objects — one per partition.

### Cluster-Wide Partition Metadata

This endpoint (from `cluster.json`) returns leader and replica assignments for all partitions visible at the cluster level:

```bash
# All partitions
curl "$ADMIN/v1/cluster/partitions"

# With filter for disabled partitions only
curl "$ADMIN/v1/cluster/partitions?disabled=true"

# Including internal (redpanda) partitions
curl "$ADMIN/v1/cluster/partitions?with_internal=true"

# All partitions for a specific topic
curl "$ADMIN/v1/cluster/partitions/kafka/my-topic"
```

---

## Moving Partition Replicas

### Move Replicas to New Brokers

```bash
curl -u admin:secret -X POST "$ADMIN/v1/partitions/kafka/my-topic/0/replicas" \
  -H "Content-Type: application/json" \
  -d '[{"node_id": 1, "core": 0}, {"node_id": 4, "core": 0}, {"node_id": 5, "core": 0}]'
```

The body is an array of `{"node_id": <int>, "core": <int>}` replica assignments. This triggers an asynchronous reconfiguration.

### Update a Single Replica's Core Assignment

```bash
curl -u admin:secret -X POST "$ADMIN/v1/partitions/kafka/my-topic/0/replicas/1" \
  -H "Content-Type: application/json" \
  -d '{"core": 2}'
```

### Transfer Leadership

Transfer the raft leader for a partition to a different node:

```bash
# Transfer to any eligible node
curl -u admin:secret -X POST "$ADMIN/v1/partitions/kafka/my-topic/0/transfer_leadership"

# Transfer to a specific target node
curl -u admin:secret -X POST "$ADMIN/v1/partitions/kafka/my-topic/0/transfer_leadership?target=2"
```

### List Ongoing Reconfigurations

```bash
curl "$ADMIN/v1/partitions/reconfigurations"
```

Returns an array of `reconfiguration` objects with `bytes_left_to_move`, `bytes_moved`, `partition_size`, `status`, and per-node reconciliation statuses.

### Cancel a Reconfiguration

Cancel an in-progress reconfiguration for a specific partition:

```bash
curl -u admin:secret -X POST "$ADMIN/v1/partitions/kafka/my-topic/0/cancel_reconfiguration"
```

Since **v26.1.12** this endpoint also accepts the controller partition
(`redpanda/controller/0`); earlier releases rejected it with a `400`. Targeting
the controller cancels an in-flight controller (raft0) reconfiguration — an
escape hatch for a controller wedged by a dead node that joined as a raft0
learner and never caught up. The request is routed to the raft0 leader (it
redirects if you hit a follower):

```bash
curl -u admin:secret -X POST "$ADMIN/v1/partitions/redpanda/controller/0/cancel_reconfiguration"
```

### Cancel All Reconfigurations Cluster-Wide

```bash
curl -u admin:secret -X POST "$ADMIN/v1/cluster/cancel_reconfigurations"
```

### Forcibly Abort a Reconfiguration (Unclean)

Use only as a last resort when a clean cancel fails:

```bash
curl -u admin:secret -X POST "$ADMIN/v1/partitions/kafka/my-topic/0/unclean_abort_reconfiguration"
```

### Force-Set a Partition's Replicas (Debug, Last Resort)

`POST /v1/debug/partitions/{namespace}/{topic}/{partition}/force_replicas`
forcibly replaces a partition's replica set, bypassing the normal
reconfiguration guards. It is unclean by design — reserve it for recovering a
partition that cannot be reconfigured through the clean endpoints above. The
body is the same `[{"node_id": <int>, "core": <int>}, ...]` replica array as
`/replicas`:

```bash
curl -u admin:secret -X POST \
  "$ADMIN/v1/debug/partitions/kafka/my-topic/0/force_replicas" \
  -H "Content-Type: application/json" \
  -d '[{"node_id": 1, "core": 0}, {"node_id": 2, "core": 0}, {"node_id": 3, "core": 0}]'
```

**Breaking a wedged controller (raft0).** Since **v26.1.12** this endpoint can
target the controller partition (`redpanda/controller/0`) to force-reconfigure
raft0 in one shot — superseding any in-flight or enqueued raft0
reconfiguration. This is gated behind an explicit `evil_mode=true` query
parameter; without it the request is rejected with a `400` ("Refusing to
reconfigure the controller"). Removing the current raft0 leader from the
replica set makes it step down so a survivor takes over.

```bash
curl -u admin:secret -X POST \
  "$ADMIN/v1/debug/partitions/redpanda/controller/0/force_replicas?evil_mode=true" \
  -H "Content-Type: application/json" \
  -d '[{"node_id": 1, "core": 0}, {"node_id": 2, "core": 0}, {"node_id": 3, "core": 0}]'
```

---

## Partition Rebalance

### Trigger On-Demand Rebalance

Manually trigger the partition balancer to redistribute partitions:

```bash
curl -u admin:secret -X POST "$ADMIN/v1/partitions/rebalance"
```

### Trigger Core Placement Rebalance

Rebalance partition-to-core assignment on this broker:

```bash
curl -u admin:secret -X POST "$ADMIN/v1/partitions/rebalance_cores"
```

### Check Partition Balancer Status

```bash
curl "$ADMIN/v1/cluster/partition_balancer/status"
```

`status` values: `off`, `ready`, `in_progress`, `stalled`.

`violations` shows which nodes are unavailable or over disk limit.

---

## Force Recovery from Dead Nodes

When a set of nodes is permanently lost and partitions have lost majority, force recovery:

### Check Which Partitions Lost Majority

```bash
# dead_nodes is a comma-separated list of node IDs
curl "$ADMIN/v1/partitions/majority_lost?dead_nodes=3,4"
```

Returns a list of NTPs with majority loss.

### Force Recover

```bash
curl -u admin:secret -X POST "$ADMIN/v1/partitions/force_recover_from_nodes" \
  -H "Content-Type: application/json" \
  -d '{"dead_nodes": [3, 4], "partitions": [...]}'
```

The body should include the NTPs with majority loss as returned by the `majority_lost` endpoint.

---

## Enable / Disable Partitions

Disable all partitions of a topic (stops leader election and I/O):

```bash
curl -u admin:secret -X POST "$ADMIN/v1/cluster/partitions/kafka/my-topic" \
  -H "Content-Type: application/json" \
  -d '{"disabled": true}'
```

Disable a single partition:
```bash
curl -u admin:secret -X POST "$ADMIN/v1/cluster/partitions/kafka/my-topic/0" \
  -H "Content-Type: application/json" \
  -d '{"disabled": true}'
```

Re-enable by passing `false`.
