# Broker decommission and rpk cluster maintenance

## Broker decommission (`rpk redpanda admin brokers`)

Broker decommission/recommission commands live under `rpk redpanda admin
brokers` (they talk to the Admin API through the `rpk redpanda admin`
subtree), **not** under `rpk cluster`:

- `rpk redpanda admin brokers decommission <BROKER-ID>` — start removing a
  broker from the cluster
- `rpk redpanda admin brokers decommission-status <BROKER-ID>` — monitor the
  progress of a decommission
- `rpk redpanda admin brokers recommission <BROKER-ID>` — abort an
  in-progress decommission
- `rpk redpanda admin brokers list` — list the brokers in the cluster

`rpk cluster info -b` (or `rpk cluster info -b --detailed`) also lists
brokers, from the Kafka metadata side.

They are documented here because decommission is a cluster-shrink operation
that pairs with maintenance mode (below) in day-2 ops workflows.

### decommission

Decommissioning removes a broker from the cluster. Redpanda moves all of its
partition replicas to the remaining brokers before the node is fully removed.

```bash
rpk redpanda admin brokers decommission 4
# Output:
# Success, broker 4 decommission started.
# Use 'rpk redpanda admin brokers decommission-status 4' to monitor data movement.
```

A dead or unreachable broker can block the pre-decommission checks. To issue
the decommission request anyway, use the hidden `--force` flag (described in
the command's long help, not in `--help` flag lists):

```bash
rpk redpanda admin brokers decommission 4 --force
```

(The generated docs page mentions a `--skip-liveness-check` flag; current rpk
releases reject it — `--force` is the flag that exists in source, verified at
v25.3.6.)

A decommission request is sent to every broker; only the cluster leader
processes it.

### decommission-status

```bash
rpk redpanda admin brokers decommission-status 4
```

Output sections:

1. **DECOMMISSION PROGRESS** — table of partitions being moved:
   - PARTITION: `<namespace>/<topic>/<partition>`
   - MOVING-TO: destination broker ID
   - COMPLETION-%: percentage of data moved
   - PARTITION-SIZE: total size in bytes

2. **REALLOCATION FAILURE DETAILS** (if present) — partitions that failed to
   rebalance, with reasons (e.g. no broker with enough disk space, rack
   constraints unsatisfiable).

3. **ALLOCATION FAILURES** (older clusters) — list of topic-partitions that
   could not be placed.

Flags:
```bash
rpk redpanda admin brokers decommission-status 4 -d    # --detailed: adds BYTES-MOVED, BYTES-REMAINING
rpk redpanda admin brokers decommission-status 4 -H    # --human-readable: sizes in human units
```

When decommission is complete, rpk exits with a message:
```
Node 4 is decommissioned successfully.
```

### recommission

Cancels an **in-progress** decommission. Once a broker is fully decommissioned,
recommission will not bring it back — the broker must rejoin the cluster as a
new node.

```bash
rpk redpanda admin brokers recommission 4
# Output: Success, broker 4 has been recommissioned!
```

A recommission request is sent to every broker; only the cluster leader
processes it.

---

## rpk cluster maintenance

Maintenance mode places a broker into a state where all raft leadership is
transferred away before the node is shut down or restarted. This minimizes
client disruption during planned operations like rolling upgrades.

**Key rule:** Only one node may be in maintenance mode at a time.

When maintenance mode is enabled:
- All partition leadership is transferred to eligible other nodes.
- The node rejects new leadership requests.
- Partitions with a single replica cannot have their leadership transferred
  (single-replica partitions stay on the maintenance node).

### enable

```bash
# Enable maintenance mode on node 1
rpk cluster maintenance enable 1

# Enable and block until leadership draining is complete
rpk cluster maintenance enable 1 --wait
```

With `--wait`, rpk polls every 2 s and prints the status table until
`FINISHED=true`. After draining is confirmed you can safely restart the broker.

Errors returned:
- 400: Another node is already in maintenance mode.
- 404: The node ID was not found.

### disable

```bash
rpk cluster maintenance disable 1
```

Removes the node from maintenance mode. The node will resume accepting
leadership when the cluster re-elects leaders.

### status

```bash
rpk cluster maintenance status
rpk cluster maintenance status --format json
```

Output table (one row per cluster node):

| Column | Description |
|---|---|
| NODE-ID | Broker node ID |
| ENABLED | `true` if the node is currently draining |
| FINISHED | Leadership drain is complete (only populated when ENABLED=true) |
| ERRORS | Errors encountered during drain (check broker logs for detail) |
| PARTITIONS | Number of partitions whose leadership has moved |
| ELIGIBLE | Number of partitions eligible for leadership transfer |
| TRANSFERRING | Current active leadership transfers |
| FAILED | Failed leadership transfers |

`-` in FINISHED, ERRORS, PARTITIONS, ELIGIBLE, TRANSFERRING, and FAILED means
the node is not in maintenance mode.

---

## Rolling Upgrade Playbook

Use this sequence when upgrading each broker:

```bash
# 1. Check cluster health before starting
rpk cluster health

# 2. Enable maintenance mode and wait for drain
rpk cluster maintenance enable <node-id> --wait

# 3. Stop and upgrade the broker process (OS/package manager steps)

# 4. Start the broker and verify it rejoined
rpk cluster info -b --detailed

# 5. Disable maintenance mode
rpk cluster maintenance disable <node-id>

# 6. Confirm cluster is healthy before proceeding to the next node
rpk cluster health

# Repeat steps 2–6 for each node
```

---

## Decommission vs. Maintenance Comparison

| Aspect | `decommission` | `maintenance` |
|---|---|---|
| Purpose | Permanently remove a broker | Temporarily take a broker offline |
| Data movement | Replicas moved to other brokers | No data moved; only leadership transferred |
| Reversible? | No (once complete) | Yes (`maintenance disable`) |
| One at a time? | No (multiple nodes can decommission) | Yes |
| Client impact | Minimal (partitions move before removal) | Minimal (leadership drains before shutdown) |
| Use case | Decommissioning hardware, downsizing cluster | Rolling upgrades, kernel patches |
