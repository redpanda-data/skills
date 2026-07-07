# rpk redpanda admin: Broker Decommission, Partitions, Log Levels

`rpk redpanda admin` talks to the Redpanda **Admin API listener** (default
port 9644). Unlike the rest of the `rpk redpanda` family, it is available
on every OS build of rpk and can be run from any machine that can reach the
Admin API — target it with your rpk profile or
`-X admin.hosts=<host>:9644`.

Subtree:

```
rpk redpanda admin
├── brokers
│   ├── list                  (alias: ls)
│   ├── decommission <ID>
│   ├── decommission-status <ID>
│   └── recommission <ID>
├── partitions
│   └── list [BROKER ID]      (alias: ls)
└── config
    ├── print                 (aliases: dump, list, ls, display)
    └── log-level
        └── set [LOGGERS...]
```

Note: there is **no `rpk cluster brokers` group** — broker
decommission/recommission live here. Cluster-wide partition operations
(move, balance, enable/disable, unsafe-recover) are
`rpk cluster partitions` (rpk-cluster skill).

## rpk redpanda admin brokers list

Lists all brokers, active and inactive; decommissioned brokers are excluded
unless you pass `-d, --include-decommissioned`.

```bash
rpk redpanda admin brokers list
rpk redpanda admin brokers list --include-decommissioned
```

Output columns: `ID` (node ID), `HOST`/`PORT` (internal RPC address),
`RACK`, `CORES`, `MEMBERSHIP` (`active` or decommissioned state),
`IS-ALIVE`, `VERSION`, and `UUID` (hidden when the cluster doesn't expose
UUIDs via the Admin API).

## Broker Decommission

### Semantics

Decommissioning **permanently removes** a broker: the controller leader
builds a reallocation plan for every partition replica on that broker and
moves them (in batches governed by `partition_autobalancing_concurrent_moves`)
to the remaining brokers; the broker is removed only after all
reallocations complete. During the process, no new partitions are allocated
to the broker. The process tolerates controller leadership transfers.

Hard rules:

- **A decommissioned broker cannot rejoin.** A broker with the same ID
  attempting to rejoin is rejected. Give replacement brokers a **new,
  unique node ID**.
- The decommission request is sent to every broker, but only the cluster
  leader handles it.
- **Maintenance mode is optional** before decommissioning: decommission
  drains partition leadership gracefully on its own. (On v22.x clusters a
  broker in maintenance mode could not be decommissioned; v23.x+ supports
  it natively. Maintenance mode itself is `rpk cluster maintenance` — see
  the rpk-cluster skill.)
- Automatic alternative: with Continuous Data Balancing enabled, the
  cluster property `partition_autobalancing_node_autodecommission_timeout_sec`
  auto-decommissions brokers that stay unavailable for that duration.

### Pre-decommission checks

Confirm the cluster can afford to lose the broker:

```bash
# Cluster healthy? (rpk-cluster skill)
rpk cluster health

# Rack/AZ spread: enough brokers per rack after removal?
rpk cluster config get enable_rack_awareness
rpk cluster info                                  # shows RACK per broker

# Replication factor: remaining broker count must be >= the highest
# replication factor across all topics
rpk topic list | tail -n +2 | awk '{print $3}' | sort -n | tail -1

# Disk: remaining brokers must absorb the leaving broker's data
rpk cluster logdirs describe --aggregate-into broker

# Partition density: stay under ~1K partitions per core across the
# remaining brokers (CORES column)
rpk redpanda admin brokers list
```

### decommission

```bash
rpk redpanda admin brokers decommission 4
# Success, broker 4 decommission started.
```

Before issuing the request, rpk checks the broker list and node versions
(and, on old clusters, maintenance-mode state). The hidden `--force` flag
bypasses these client-side checks — use it when the target broker is **not
running** (its version is unknown) or the checks cannot be satisfied, e.g.:

```bash
rpk redpanda admin brokers decommission 4 --force
```

(`--force` is a hidden flag — described in the command's long help text but
not listed in its Flags section. Some older docs mention a
`--skip-liveness-check` flag; current rpk releases reject it — `--force` is
the bypass flag.)

### decommission-status

Monitors progress. The data comes from cached cluster health information
refreshed roughly every 10 seconds.

```bash
rpk redpanda admin brokers decommission-status 4        # progress table
rpk redpanda admin brokers decommission-status 4 -d     # + BYTES-MOVED / BYTES-REMAINING
rpk redpanda admin brokers decommission-status 4 -H     # human-readable sizes
```

The `DECOMMISSION PROGRESS` table has one row per moving partition:
`PARTITION` (`namespace/topic/partition`), `MOVING-TO` (destination broker),
`COMPLETION-%`, `PARTITION-SIZE` (bytes; `-H` humanizes). With `-d` it adds
`BYTES-MOVED` and `BYTES-REMAINING`. The broker is decommissioned when all
rows reach 100% (and it disappears from `brokers list`).

If a partition cannot be placed, a `REALLOCATION FAILURE DETAILS` (or
`ALLOCATION FAILURES` on older clusters) section lists the partition and
reason, and the decommission fails. Typical causes:

- Insufficient storage on the remaining brokers for a partition.
- No placement that satisfies rack constraints.
- Missing partition size information — all replicas may be offline.

### Troubleshooting a stalled decommission

- **No controller leader / leaderless partitions:** the controller leader
  orchestrates decommission, and a partition without a leader cannot be
  reconfigured. Verify every partition has a leader (`rpk cluster health`).
- **Recovery bandwidth:** raise the cluster property
  `raft_learner_recovery_rate` (`rpk cluster config set`), and watch the
  `redpanda_raft_recovery_partition_movement_available_bandwidth` metric.
- Still stuck: enable `TRACE` logging on the controller leader (see
  log-level set below) and inspect.

### recommission

Aborts an **in-progress** decommission and returns the broker to `active`.

```bash
rpk redpanda admin brokers recommission 4
```

- Only works **while the decommission is still running**. Once a broker is
  fully decommissioned, it cannot be recommissioned — a replacement must
  join as a new node with a new ID.
- Use it when a decommission was started by mistake, when the capacity
  math turns out wrong mid-move, or when reallocation failures mean you'd
  rather keep the broker.
- Like decommission, the request goes to every broker; the cluster leader
  handles it.

### End-to-end workflow

```bash
rpk cluster health                                        # 1. healthy start
rpk redpanda admin brokers list                           # 2. pick the ID; capacity pre-checks above
rpk redpanda admin brokers decommission 4                 # 3. start
rpk redpanda admin brokers decommission-status 4 -d -H    # 4. watch to 100%
rpk redpanda admin brokers list --include-decommissioned  # 5. verify removal
# 6. stop the process / retire the node; never reuse node ID 4
```

## rpk redpanda admin partitions list

Lists the partitions hosted on **one broker** (positional broker ID).

```bash
rpk redpanda admin partitions list 1
rpk redpanda admin partitions list 1 --leader-only   # -l: only partitions it leads
```

For cluster-wide partition listings and movement, use
`rpk cluster partitions list/move/...` (rpk-cluster skill).

## rpk redpanda admin config print

Displays a broker's current effective configuration via the admin listener.

```bash
rpk redpanda admin config print
rpk redpanda admin config print --host 0            # index into rpk.admin_api.addresses
rpk redpanda admin config print --host broker-1     # or a hostname
```

Aliases: `print`, `dump`, `list`, `ls`, `display`.

## rpk redpanda admin config log-level set

Temporarily changes a broker's logger levels — the standard way to get
debug/trace logs without a restart and without the risk of leaving debug
logging on permanently (overrides expire).

```bash
# Raise one logger to debug for the default 300s
rpk redpanda admin config log-level set storage -l debug

# Several loggers, custom expiry; 0 = persist until shutdown
rpk redpanda admin config log-level set raft rpc -l trace -e 60

# Everything (the special logger "all")
rpk redpanda admin config log-level set all -l debug -e 120

# Discover available loggers
rpk redpanda admin config log-level set --help-loggers
```

| Flag | Purpose |
|---|---|
| `-l, --level` | `error`, `warn`, `info`, `debug`, `trace` (default `debug`) |
| `-e, --expiry-seconds` | Seconds before the broker reverts (default 300; 0 = until shutdown) |
| `--host` | Hostname or index into `rpk.admin_api.addresses` to target one broker |
| `--help-loggers` | Print the available loggers |

Notes: omitting the logger prompts interactively from the available set;
unknown logger names are accepted (per-logger success/failure is printed) so
rpk and redpanda can be upgraded independently.
