# Node Configuration: rpk redpanda config

`rpk redpanda config` edits the **node** configuration file
(`redpanda.yaml`) on local disk. Linux-only (like the rest of the family
except `admin`).

Node config vs cluster config:

| | Node config | Cluster config |
|---|---|---|
| Command | `rpk redpanda config set/print/bootstrap` | `rpk cluster config set/get/edit/...` (rpk-cluster skill) |
| Scope | This node's `redpanda.yaml` | All nodes, stored by the cluster |
| Examples | listeners, seeds, `node_id`, data dir, `rpk.tune_*` tuner flags, `rpk.well_known_io` | retention, tiered storage, autobalancing, auth mechanisms |
| Takes effect | Broker restart (generally) | Propagates immediately (some need restart — `rpk cluster config status`) |

Subcommands: `bootstrap`, `set`, `print` (alias `dump`), and the
**deprecated** `init` (set the node UUID after install — do not use in new
automation).

## rpk redpanda config bootstrap

Generates a `redpanda.yaml` to bootstrap a cluster. Run it on each node
**before first start**; bootstrap first, then make further edits (running
bootstrap over an existing file resets the fields it manages).

```bash
# On every node of a 3-node cluster (same --ips list on each):
rpk redpanda config bootstrap \
  --self <this-node-private-ip> \
  --ips 10.0.0.1,10.0.0.2,10.0.0.3

# Custom advertised addresses (default to --self)
rpk redpanda config bootstrap \
  --self 10.0.0.1 \
  --ips 10.0.0.1,10.0.0.2,10.0.0.3 \
  --advertised-kafka broker-1.example.com:9092 \
  --advertised-rpc 10.0.0.1:33145
```

| Flag | Purpose |
|---|---|
| `--ips` | Comma-separated seed-server addresses/hostnames this broker uses to form the cluster; at least three recommended |
| `--self` | IP for redpanda to listen on; defaults to the machine's private IP (required if the machine has several) |
| `--advertised-kafka` | `<address>:<port>` to advertise for the Kafka listener (defaults to `--self`) |
| `--advertised-rpc` | `<address>:<port>` to advertise for the RPC listener (defaults to `--self`) |

The production deployment flow pairs bootstrap with disabling
empty-seed cluster formation, so a broker with an empty `seed_servers`
list cannot accidentally start a brand-new cluster:

```bash
sudo rpk redpanda config bootstrap --self <ip> --ips <ip1>,<ip2>,<ip3> && \
sudo rpk redpanda config set redpanda.empty_seed_starts_cluster false
```

## rpk redpanda config set

Sets node configuration values in the local `redpanda.yaml`. The key is a
dot path into the YAML; the value is parsed as YAML (so JSON also works).

```bash
# Scalars
rpk redpanda config set redpanda.developer_mode true
rpk redpanda config set rpk.tune_disk_irq true

# Structs (YAML or JSON)
rpk redpanda config set redpanda.rpc_server '{address: 10.0.0.1, port: 33145}'

# Whole arrays, or one element by index (index one past the end extends it)
rpk redpanda config set redpanda.advertised_kafka_api '[{address: 10.0.0.1, port: 9092}]'
rpk redpanda config set redpanda.advertised_kafka_api[1] '{address: 10.0.0.2, port: 9092}'

# key=value notation also works
rpk redpanda config set redpanda.kafka_api[0].port=9092
```

Common uses:

- Tuner flags: `rpk.tune_<tuner>` (see
  [node-lifecycle-and-tuning.md](node-lifecycle-and-tuning.md)).
- Node properties under `redpanda.` (e.g. `redpanda.node_id`,
  `redpanda.data_directory`, listener arrays, `redpanda.rack`).
- rpk connection defaults under `rpk.` (e.g. `rpk.admin_api.addresses`).

Restart the broker for `redpanda.*` node-property changes to take effect.
For the authoritative list of node properties and their meanings, see the
node-configuration properties reference in the Redpanda docs
(docs.redpanda.com → Reference → Node Configuration Properties) — property
names and defaults are version-specific, so verify against your release.

There is **no `rpk node` command group** — if you see `rpk node config set`
anywhere, the correct spelling is `rpk redpanda config set`.

## rpk redpanda config print

Displays the selected node configuration.

```bash
rpk redpanda config print          # alias: dump
```

To see a **running broker's** effective configuration via the Admin API
(from any machine), use `rpk redpanda admin config print` instead — see
[admin-and-decommission.md](admin-and-decommission.md).
