# Node Lifecycle and Tuning: start, stop, mode, check, tune, iotune

All commands on this page are **Linux-only** (hidden on macOS/Windows builds
of rpk) and act on the **local machine**. They are self-managed only — none
of this applies to Redpanda Cloud.

## rpk redpanda start

Starts the Redpanda broker process on the local node, optionally running
system checks and tuners first.

```bash
# Plain start (runs system checks first by default)
rpk redpanda start

# Start and tune first
rpk redpanda start --tune

# Skip the pre-start system checks
rpk redpanda start --check=false

# Development/test one-liner with dev presets
rpk redpanda start --mode dev-container

# Override listeners and seeds at start time
rpk redpanda start \
  --kafka-addr internal://0.0.0.0:9092 \
  --advertise-kafka-addr internal://10.0.0.1:9092 \
  --rpc-addr 0.0.0.0:33145 \
  --advertise-rpc-addr 10.0.0.1:33145 \
  --seeds 10.0.0.1:33145,10.0.0.2:33145,10.0.0.3:33145
```

Key flags:

| Flag | Purpose |
|---|---|
| `--mode <mode>` | Apply well-known config presets (`--mode help` for options) |
| `--check` | System checks before start (default `true`; `--check=false` to skip) |
| `--tune` | Run enabled tuners before starting |
| `--kafka-addr` / `--advertise-kafka-addr` | Kafka listener bind/advertise addresses (`<scheme>://<host>:<port>\|<name>`, comma-separated) |
| `--rpc-addr` / `--advertise-rpc-addr` | Internal RPC bind/advertise address |
| `--pandaproxy-addr` / `--advertise-pandaproxy-addr` | HTTP Proxy listener addresses |
| `--schema-registry-addr` | Schema Registry listener addresses |
| `-s, --seeds` | Comma-separated seed nodes to join |
| `--install-dir` | Where the redpanda binary is installed |
| `--well-known-io <vendor>:<vm-type>:<storage-type>` | Hint the cloud/VM/storage type for I/O presets (e.g. `aws:i3.xlarge:default`) |
| `--timeout` | Max time for checks + tuning (default 10s) |
| `--node-tuner-state-path` | Alternative path to read the node tuner state file |

`rpk redpanda start` also registers resource/Seastar flags that it passes
to the broker process (verified in `start.go` at v25.3.6): `--smp`
(restrict CPU count), `--memory`, `--reserve-memory`, `--lock-memory`,
`--cpuset`, `--node-id`, and `--io-properties-file <path>` /
`--io-properties '<yaml-string>'` to point at an iotune output file (see
iotune below). Any additional arguments are passed through to
redpanda/Seastar without needing `--`. Consult
`rpk redpanda start --help` on the node for the live flag set.

### dev-container mode

`--mode dev-container` presets a throwaway dev/test broker. It bundles
flags (`--overprovisioned`, `--reserve-memory 0M`, `--check=false`,
`--unsafe-bypass-fsync`) and dev-friendly cluster properties (write
caching on, topic auto-creation on, small storage minimums). The exact
bundled property set is version-dependent — see the
`rpk redpanda start` docs page or `rpk redpanda start --mode help` for the
current list. Never use it in production: `--unsafe-bypass-fsync` can lose
data.

## rpk redpanda stop

Stops the local broker with escalating signals: first `SIGINT`, then after
`--timeout` `SIGTERM`, then `SIGKILL`.

```bash
rpk redpanda stop                 # default timeout 5s per signal
rpk redpanda stop --timeout 30s   # give a loaded broker longer to shut down cleanly
```

For a broker that is part of a serving cluster, drain leadership first with
`rpk cluster maintenance enable <id> --wait` (rpk-cluster skill) before
stopping the process.

## rpk redpanda mode

Sets well-known node presets in `redpanda.yaml`. Accepted modes:
`development` (`dev`), `production` (`prod`), `recovery`.

```bash
rpk redpanda mode production
rpk redpanda mode dev
rpk redpanda mode recovery
```

| Mode | Effect |
|---|---|
| `production` / `prod` | `developer_mode: false`, `overprovisioned: false`, enables the production set of autotuner tuners |
| `development` / `dev` | `developer_mode: true` (no memory minimums, no core-assignment rules, write caching, fsync bypass), `overprovisioned: true` (disables thread affinity, idle polling, disk busy-poll), disables all tuners |
| `recovery` | Sets `redpanda.recovery_mode_enabled: true` — a stable environment for troubleshooting/restoring a failed cluster |

Mode changes edit the local config file; restart the broker for them to take
effect.

## rpk redpanda check

Checks that the system meets Redpanda's requirements (the same checks
`rpk redpanda start` runs by default).

```bash
rpk redpanda check
rpk redpanda check --timeout 10s   # default 2s
```

## rpk redpanda tune (the autotuner)

Identifies the hardware configuration and optimizes the Linux kernel for
Redpanda. Run as **root**. Run it on every broker node as part of
production deployment. **Do not use in Azure self-managed environments.**

```bash
sudo rpk redpanda tune all              # run every enabled tuner
sudo rpk redpanda tune disk_irq net     # run specific tuners
rpk redpanda tune list                  # what exists, what's enabled/supported
rpk redpanda tune help <tuner>          # detailed description of one tuner
```

Key flags for `tune` (and `tune list`):

| Flag | Purpose |
|---|---|
| `-m, --mode` | IRQ distribution mode: `sq` (all IRQs to CPU0), `sq_split` (CPU0 + HT siblings), `mq` (spread across all CPUs; default depends on device/core count) |
| `-d, --disks` | Devices to tune (e.g. `sda1`) |
| `-r, --dirs` | Data directories to tune for |
| `-n, --nic` | NICs to tune |
| `--cpu-set` | CPUs for tuners to use, cpuset(7) format (default `all`) |
| `--reboot-allowed` | Let tuners change boot parameters and request a reboot (e.g. the `cpu` tuner's P-state/C-state/turbo changes) |
| `--output-script <file>` | Emit a tuning script instead of applying immediately |
| `--node-tuner-state-path` | Alternative tuner state file path (default `/var/run/redpanda_node_tuner_state.yaml`) |
| `--timeout` | Max time for tuning (default 10s) |

### Discovering and enabling tuners

The tuner set and each tuner's support status vary by kernel, architecture,
and cloud — **`rpk redpanda tune list` is the source of truth**. Its output
has TUNER / ENABLED / SUPPORTED / UNSUPPORTED-REASON columns. Examples of
tuners: `disk_irq`, `disk_scheduler`, `disk_nomerges`, `aio_events`,
`swappiness`, `ballast_file`, `cpu`, `net`, `clocksource`, `fstrim`,
`transparent_hugepages`, `coredump` (introspect for the current full list
and per-tuner descriptions via `rpk redpanda tune help <tuner>`).

Each tuner is enabled/disabled by a node-config key under `rpk:` in
`redpanda.yaml`, generally `rpk.tune_<tuner-name>`:

```bash
rpk redpanda config set rpk.tune_aio_events true
rpk redpanda config set rpk.tune_disk_irq true
```

(Some keys differ from the tuner name — e.g. the `net` tuner is
`rpk.tune_network`; some tuners have extra keys like
`rpk.ballast_file_size`, `rpk.ballast_file_path`, `rpk.coredump_dir` —
check `rpk redpanda tune help <tuner>` / the tune-list docs page.)

`rpk redpanda mode production` enables the production tuner set in one
step; you then apply them with `sudo rpk redpanda tune all`.

### Run at boot

The `redpanda-tuner` systemd service (shipped with the rpm/apt packages)
runs `rpk redpanda tune all` at boot:

```bash
sudo systemctl start redpanda-tuner
sudo systemctl enable redpanda-tuner   # already enabled on Ubuntu apt installs
```

## rpk iotune

Benchmarks the I/O performance of the node's storage (read/write IOPS and
bandwidth) and writes the results to an I/O configuration file that
Redpanda reads at startup to calibrate its I/O scheduler.

```bash
sudo rpk iotune                            # default: 10m run, writes /etc/redpanda/io-config.yaml
sudo rpk iotune --duration 30m             # longer, more accurate run
sudo rpk iotune --directories /var/lib/redpanda/data
sudo rpk iotune --out /tmp/io-config.yaml --no-confirm
```

| Flag | Purpose |
|---|---|
| `--directories` | Directories to evaluate (default: the data directory) |
| `--duration` | Benchmark duration (default `10m0s`) |
| `--out` | Output file (default `/etc/redpanda/io-config.yaml`) |
| `--no-confirm` | Don't prompt if the output file already exists |
| `--iotune-path` | Path to the iotune executable (default `iotune-redpanda`) |
| `--timeout` | Max wait for iotune to complete (default `1h0m0s`) |

Output shape (values are per-mountpoint benchmark results):

```yaml
disks:
- mountpoint: /var/lib/redpanda/data
  read_iops: ...
  read_bandwidth: ...
  write_iops: ...
  write_bandwidth: ...
```

Operational notes:

- Run iotune **once per hardware type**, not on every start. The output
  file can be copied to other nodes with identical hardware and passed at
  start: `rpk redpanda start --io-properties-file <path>` (or inline via
  `--io-properties '<string>'`).
- rpk ships an embedded database of I/O presets for well-known cloud VM
  types (AWS, GCP) and auto-detects the instance via the cloud metadata
  API. If metadata is unavailable, hint it with
  `rpk redpanda start --well-known-io '<vendor>:<vm-type>:<storage-type>'`
  or `rpk.well_known_io` in `redpanda.yaml`. `well-known-io` and
  `--io-properties-file`/`--io-properties` are mutually exclusive.

## Production node bring-up (putting it together)

```bash
# On each node:
sudo rpk redpanda config bootstrap --self <private-ip> --ips <seed1>,<seed2>,<seed3>
sudo rpk redpanda config set redpanda.empty_seed_starts_cluster false
rpk redpanda mode production
sudo rpk redpanda tune all
sudo rpk iotune                    # once per hardware type; copy io-config.yaml to twins
rpk redpanda check
sudo systemctl start redpanda      # package installs; or: rpk redpanda start
```
