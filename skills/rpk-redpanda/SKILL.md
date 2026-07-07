---
name: rpk-redpanda
description: >-
  Operates a self-managed Redpanda broker process and node from the command
  line using the `rpk redpanda` command family and `rpk iotune` — node
  lifecycle (start/stop), production vs development mode, kernel autotuning,
  system checks, node configuration (redpanda.yaml), and per-node Admin API
  operations including broker decommission/recommission. SELF-MANAGED ONLY:
  these commands operate the broker process on the node itself and do not
  apply to Redpanda Cloud clusters.
  Use when: starting or stopping a Redpanda broker process, bootstrapping a
  node's redpanda.yaml before first start, setting node (not cluster)
  configuration, switching a node between production/development/recovery
  mode, running the autotuner or checking kernel tuning, benchmarking disk
  I/O with iotune, decommissioning or recommissioning a broker, monitoring
  decommission progress, listing brokers or a broker's partitions through
  the admin listener, temporarily changing a broker's log level, or printing
  a broker's effective configuration. Also use when asked about
  rpk redpanda start, rpk redpanda stop, rpk redpanda mode prod/dev/recovery,
  rpk redpanda check, rpk redpanda tune / the autotuner /
  rpk redpanda tune list, rpk iotune / io-config.yaml,
  rpk redpanda config bootstrap/set/print,
  rpk redpanda admin brokers list/decommission/decommission-status/
  recommission, rpk redpanda admin partitions list,
  rpk redpanda admin config log-level set, or
  rpk redpanda admin config print. Cluster-wide operations (cluster config,
  partition movement, maintenance mode, cluster health) are `rpk cluster`
  — see the rpk-cluster skill.
---

# rpk redpanda: Node Lifecycle, Tuning & Broker Decommission

The `rpk redpanda` family operates a **single Redpanda broker process and its
host node**: starting/stopping the process, editing the node's local
`redpanda.yaml`, tuning the Linux kernel for production, and talking to a
broker's Admin API listener (including broker decommission/recommission).
`rpk iotune` (a separate top-level command) benchmarks the node's disk
hardware for the same node-provisioning story.

**Self-managed only.** These commands manage the broker process on the node
itself. They are not applicable to Redpanda Cloud (Serverless, BYOC,
Dedicated), where Redpanda operates the brokers. Most of the family is also
**Linux-only**: `start`, `stop`, `mode`, `check`, `tune`, `config`, and
`iotune` are hidden on macOS/Windows builds of rpk — only the `admin`
subtree (which talks to a possibly-remote Admin API) is available
everywhere.

## Command Tree

| Command | Purpose |
|---|---|
| `rpk redpanda start` | Start the local broker process (optionally tuning first) |
| `rpk redpanda stop` | Stop the local broker: SIGINT → SIGTERM → SIGKILL escalation |
| `rpk redpanda mode <mode>` | Switch node presets: `production`/`prod`, `development`/`dev`, `recovery` |
| `rpk redpanda check` | Verify the system meets Redpanda's requirements |
| `rpk redpanda tune <tuner>...` \| `all` | The autotuner — optimize Linux kernel settings (root required) |
| `rpk redpanda tune list` | List tuners with enabled/supported status |
| `rpk redpanda tune help [TUNER]` | Describe a tuner in detail |
| `rpk redpanda config bootstrap` | Generate `redpanda.yaml` to form/join a cluster |
| `rpk redpanda config set <key> <value>` | Set node config values in `redpanda.yaml` |
| `rpk redpanda config print` | Display the node configuration (alias: `dump`) |
| `rpk redpanda config init` | (Deprecated) Set the node UUID after install |
| `rpk redpanda admin brokers list` | List brokers via the admin listener (alias: `ls`) |
| `rpk redpanda admin brokers decommission <ID>` | Remove a broker from the cluster (moves its replicas away) |
| `rpk redpanda admin brokers decommission-status <ID>` | Monitor decommission progress |
| `rpk redpanda admin brokers recommission <ID>` | Abort an in-progress decommission |
| `rpk redpanda admin partitions list [ID]` | List the partitions hosted on one broker |
| `rpk redpanda admin config print` | Display a broker's effective configuration |
| `rpk redpanda admin config log-level set` | Temporarily change a broker's logger levels |
| `rpk iotune` | Benchmark disk I/O and write `io-config.yaml` for the broker to read at startup |

## Quickstart

```bash
# --- Provision a production node (run on the node, as root where noted) ---

# 1. Generate redpanda.yaml with this node's IP and the seed servers
rpk redpanda config bootstrap --self <private-ip> --ips <ip1>,<ip2>,<ip3>

# 2. Switch the node to production mode (enables the production tuner set)
rpk redpanda mode production

# 3. Run the autotuner (requires root; Linux kernel settings)
sudo rpk redpanda tune all

# 4. Benchmark disk I/O once per hardware type (defaults: 10m run,
#    writes /etc/redpanda/io-config.yaml which redpanda reads at startup)
sudo rpk iotune

# 5. Verify the system meets requirements, then start
rpk redpanda check
rpk redpanda start

# --- Development: one-shot local broker with dev presets ---
rpk redpanda start --mode dev-container

# --- Stop the local broker (SIGINT, then SIGTERM, then SIGKILL) ---
rpk redpanda stop --timeout 10s

# --- Node configuration (redpanda.yaml on local disk) ---
rpk redpanda config set redpanda.empty_seed_starts_cluster false
rpk redpanda config set rpk.tune_aio_events true
rpk redpanda config print

# --- Broker decommission (works from any machine; talks to the Admin API) ---
rpk redpanda admin brokers list
rpk redpanda admin brokers decommission 4
rpk redpanda admin brokers decommission-status 4 -d -H   # monitor
rpk redpanda admin brokers recommission 4                # abort (only while in progress)

# --- Per-broker diagnostics via the admin listener ---
rpk redpanda admin partitions list 1 --leader-only
rpk redpanda admin config print --host 0
rpk redpanda admin config log-level set storage -l debug -e 300
```

## Decision Rules

- **`rpk redpanda` vs `rpk cluster`:** `rpk redpanda` is node-level (the
  local process, the local `redpanda.yaml`, per-broker admin operations).
  `rpk cluster` is cluster-wide (cluster config, health, partition
  balancing/movement, maintenance mode, self-test) — see the **rpk-cluster**
  skill.
- **Broker decommission lives here.** There is no `rpk cluster brokers`
  command group — decommission/recommission are
  `rpk redpanda admin brokers ...`.
- **Maintenance mode is NOT here.** Draining leadership for a rolling
  restart is `rpk cluster maintenance enable/disable/status` (rpk-cluster
  skill). Entering maintenance mode before decommissioning is **optional** —
  decommission drains leadership gracefully on its own.
- **Node config vs cluster config:** properties in the local
  `redpanda.yaml` (listeners, seeds, data dir, `rpk.tune_*` tuner flags)
  are set with `rpk redpanda config set` and generally need a broker
  restart. Cluster-wide properties (retention, tiered storage, etc.) are
  `rpk cluster config set` and propagate to all nodes.
- **`tune` vs `iotune`:** `rpk redpanda tune` (the autotuner) modifies
  Linux **kernel** settings; `rpk iotune` **benchmarks the disks** and
  writes an I/O properties file that redpanda reads at startup. A
  production node wants both. `iotune` output is reusable across nodes with
  identical hardware.
- **Which node does a command touch?** `start`, `stop`, `mode`, `check`,
  `tune`, `config`, and `iotune` act on the **local machine**. The `admin`
  subtree targets whatever `rpk.admin_api.addresses` (or
  `-X admin.hosts=...`) points at, so it can be run from anywhere.
- **Not for local dev containers:** to spin up throwaway local clusters in
  Docker, use `rpk container` (see the rpk skill) instead of
  `rpk redpanda start`.

## Broker Decommission (Top-Tier Ops Task)

Decommissioning permanently removes a broker: the controller leader moves
all of its partition replicas to the remaining brokers, then removes it
from the cluster. **A decommissioned broker cannot rejoin**, and its node ID
must never be reused.

```bash
# 1. Pre-check: cluster healthy, and remaining brokers can absorb the data
rpk cluster health
rpk redpanda admin brokers list

# 2. Start the decommission
rpk redpanda admin brokers decommission 4

# 3. Monitor until every partition reaches 100% (add -d for bytes moved/remaining)
rpk redpanda admin brokers decommission-status 4 -d -H

# 4. Changed your mind while it is still moving data? Abort:
rpk redpanda admin brokers recommission 4

# 5. When complete, verify removal, then shut the node's process down
rpk redpanda admin brokers list --include-decommissioned
```

Before decommissioning, confirm the remaining broker count still satisfies
the highest topic replication factor, rack-awareness spread, disk capacity,
and partition-per-core limits. If progress stalls, check for leaderless
partitions and consider raising `raft_learner_recovery_rate`. Full
pre-checks, failure modes, `--force` semantics, and the
maintenance-mode interaction are in
[admin-and-decommission.md](references/admin-and-decommission.md).

## The Autotuner and iotune

`rpk redpanda tune` identifies the node's hardware and optimizes the Linux
kernel for Redpanda (disk IRQs, scheduler, AIO limits, swappiness, CPU
governor, and more). Run it as root, as part of production deployment, on
every broker node. Do not run it in Azure self-managed environments.

```bash
sudo rpk redpanda tune all          # run every enabled tuner
rpk redpanda tune list              # tuners + enabled/supported status (live source of truth)
rpk redpanda tune help <tuner>      # what one tuner does
sudo rpk iotune                     # disk benchmark -> /etc/redpanda/io-config.yaml
```

The available tuners and their support status vary by kernel, hardware, and
cloud — always introspect with `rpk redpanda tune list` rather than relying
on a static list. Each tuner is toggled by an `rpk.tune_*` key in
`redpanda.yaml` (for example `rpk.tune_aio_events`), set via
`rpk redpanda config set`; `rpk redpanda mode production` enables the
production tuner set in one step. Details, IRQ modes (`sq`/`sq_split`/`mq`),
the `redpanda-tuner` systemd service, and iotune reuse across identical
hardware are in
[node-lifecycle-and-tuning.md](references/node-lifecycle-and-tuning.md).

## Reference Directory

- [node-lifecycle-and-tuning.md](references/node-lifecycle-and-tuning.md):
  `rpk redpanda start` (flags, `--mode dev-container`, tuning-at-start,
  well-known-io), `stop` (signal escalation), `mode`
  (production/development/recovery semantics), `check`, the autotuner
  (`tune`, `tune list`, `tune help`, IRQ modes, systemd unit), and
  `rpk iotune` (flags, output file, reuse workflow).
- [admin-and-decommission.md](references/admin-and-decommission.md): the
  `rpk redpanda admin` subtree — `brokers list/decommission/
  decommission-status/recommission` with the full safe-decommission
  workflow, capacity pre-checks, stall troubleshooting, and
  maintenance-mode interaction; `partitions list`; `config print`; and
  `config log-level set`.
- [config-bootstrap.md](references/config-bootstrap.md): node configuration —
  `rpk redpanda config bootstrap` (forming a cluster, `--self`, `--ips`,
  advertised addresses), `config set` (dot paths, YAML/JSON values, arrays),
  `config print`, the deprecated `config init`, and node-vs-cluster config
  rules.
- [SOURCES.md](references/SOURCES.md): source map — where each claim comes
  from and what is deferred to live introspection.
