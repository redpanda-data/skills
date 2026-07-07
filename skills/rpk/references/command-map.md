# rpk Command Group Map

Every top-level rpk command group with a one-line description and a pointer
to the dedicated subskill where applicable. Use this as a routing guide before
diving into a specific task.

---

## Registered command groups (from root.go)

### `rpk topic`
Create, list, describe, alter-config, add partitions, trim, analyze, and delete
topics; produce records from stdin or files; consume records with offset/group/
format control.

**Subskill**: `rpk-topic`

```bash
rpk topic create my-topic -p 3 -r 1
rpk topic produce my-topic
rpk topic consume my-topic --offset start
rpk topic describe my-topic
rpk topic delete my-topic
```

---

### `rpk cluster`
Cluster health, metadata, and log dirs; cluster-wide configuration
(get/set/edit/list/import/export/lint/status); partition balancing and
movement; maintenance mode; Kafka connection monitoring; client quotas;
storage; transactions; self-test (disk/network benchmarks); licensing.

**Subskill**: `rpk-cluster`

```bash
rpk cluster health
rpk cluster info -b                # includes broker list
rpk cluster connections list       # current Kafka connections
rpk cluster config get <key>
rpk cluster config set <key> <value>
rpk cluster partitions balance
rpk cluster selftest start
rpk cluster license info          # check license + Enterprise-feature violations
rpk cluster license set --path /etc/redpanda/redpanda.license
```

> Broker decommission/recommission is NOT under `rpk cluster` — it lives at
> `rpk redpanda admin brokers` (see `rpk redpanda` below and the
> `rpk-cluster` skill's brokers-maintenance reference).

> Enterprise features (Tiered Storage, Cloud Topics, Iceberg, Continuous Data
> Balancing, Audit Logging, Schema ID Validation, Leader Pinning, OIDC/Kerberos)
> are enabled via `rpk cluster config set <key> <value>`. See
> [enterprise-features.md](enterprise-features.md) for every key and topic
> property. All require an Enterprise license.

---

### `rpk group`
List, describe (lag, members, committed offsets), seek (reset offsets), and
delete consumer groups or committed offsets.

**Subskill**: `rpk-group`

```bash
rpk group list
rpk group describe my-group
rpk group seek my-group --to start
rpk group delete my-group
```

---

### `rpk security`
SASL/SCRAM user management (create/list/delete/describe/alter-password); Kafka
ACL management (create/list/delete — replaces deprecated `rpk acl`); RBAC role
management (create/list/describe/delete/assign); secrets management.

**Subskill**: `rpk-security`

```bash
rpk security user create alice --password s3cr3t
rpk security acl create --allow-principal User:alice \
  --operation read,write --topic my-topic
rpk security acl list
```

---

### `rpk cloud`
Log in to Redpanda Cloud (SSO or client credentials); manage Cloud auth tokens;
select a Cloud cluster to target (wires the profile to the data-plane URL);
manage resource groups; provision BYOC clusters with the rpk byoc plugin
(install/apply/destroy/validate).

**Subskill**: `rpk-cloud`

```bash
rpk cloud login
rpk cloud cluster select
rpk cloud byoc apply --redpanda-id <id>
```

> Note: `rpk cloud cluster` only exposes `select` (interactive cluster picker).
> Programmatic cluster listing uses the control-plane API.

---

### `rpk debug`
Collect a local debug bundle (logs, metrics, CPU profile) or a remote
cluster-wide bundle (via the Admin API); print local Redpanda process info.

**Subskill**: `rpk-debug`

```bash
rpk debug bundle --logs-since "1h"
rpk debug remote-bundle start
rpk debug remote-bundle download <bundle-id>
rpk debug info
```

---

### `rpk registry`
Manage Schema Registry subjects, schemas (Avro/Protobuf/JSON), versions,
compatibility levels, and modes.

**Subskill**: `rpk-registry`

```bash
rpk registry schema create my-topic-value --schema schema.avsc
rpk registry schema list
rpk registry schema get my-topic-value --schema-version 1
rpk registry compatibility-level set my-topic-value --level BACKWARD
```

---

### `rpk transform`
Initialize a Data Transforms project (Go/Rust/JS templates), build the Wasm
binary, deploy a transform (input topic → output topic), list/delete/pause/
resume transforms, and tail transform logs.

**Subskill**: `rpk-transform`

```bash
rpk transform init --language go
rpk transform build
rpk transform deploy --input-topic input --output-topic output
rpk transform list
rpk transform logs my-transform
```

---

### `rpk ai`
AI/MCP integration — exposes Redpanda cluster operations as MCP tools for LLM
agents. Includes subcommands for running an MCP server that AI clients like
Claude Code can connect to.

**Subskill**: `ai`

```bash
rpk ai --help
```

---

### `rpk connect`
Run Redpanda Connect (formerly Benthos) pipelines directly from rpk. Provides
`run`, `lint`, `list` (list components), and other subcommands for operating
the stream processor.

**Subskill**: `connect`

```bash
rpk connect run config.yaml
rpk connect lint config.yaml
rpk connect list
```

> Note: `rpk connect` is a managed-plugin passthrough — subcommands and flags
> are provided by the external Redpanda Connect binary, not defined in this
> repo. Confirm available flags with `rpk connect list --help`.

---

### `rpk profile`
Manage rpk profiles — create, use, list, current, edit, set, delete, rename,
print, validate, and configure globals. Profiles are stored in `rpk.yaml` and
provide persistent per-cluster configuration.

**Subskill**: This skill (`rpk`) — see [profiles.md](profiles.md)

```bash
rpk profile create local --set brokers=localhost:9092
rpk profile use prod
rpk profile list
rpk profile current
rpk profile edit
rpk profile set user=alice
rpk profile delete staging
```

---

### `rpk acl`
**Deprecated.** Use `rpk security acl` instead. Retained for backward
compatibility; functionality is identical.

**Subskill**: `rpk-security`

---

### `rpk generate`
Generate shell completions, app scaffolding, Prometheus configuration, and
other artifacts.

No dedicated subskill. Use `rpk generate --help` for available subcommands.

```bash
rpk generate shell-completion bash > /etc/bash_completion.d/rpk
rpk generate prometheus-config
```

---

### `rpk version`
Print the current rpk version and commit hash.

```bash
rpk version
# Output format: (Redpanda CLI): v<version> (rev <sha>)
```

---

### `rpk container`
Manage a local single-node or multi-node Redpanda cluster using Docker
containers. Useful for local development without installing a full broker.

```bash
rpk container start    # starts a local Redpanda container cluster
rpk container stop
rpk container purge
```

---

### `rpk plugin`
Manage rpk plugins — list installed plugins, install new ones, uninstall.
Managed plugins (such as the BYOC plugin) are downloaded and executed by rpk
automatically.

```bash
rpk plugin list
rpk plugin install <plugin-name>
rpk plugin uninstall <plugin-name>
```

---

### `rpk shadow`
Manage Redpanda Shadow Links — create, describe, update, delete, list, and
failover shadow links for cluster-to-cluster replication and migration. Also
includes `config generate` to produce a shadow link configuration file.

**Enterprise feature.** Shadowing is Redpanda's enterprise-grade disaster
recovery: asynchronous, offset-preserving replication between two distinct
clusters. Requires an Enterprise license. See
[enterprise-features.md](enterprise-features.md) for the full DR workflow and
status/failover flags.

```bash
rpk shadow create
rpk shadow list
rpk shadow describe <link-name>
rpk shadow status <link-name>
rpk shadow failover <link-name>
rpk shadow update <link-name>
rpk shadow delete <link-name>
rpk shadow config generate
```

---

### `rpk redpanda`
Operate the local broker process and talk to the Admin API — **self-managed
only**. Subtrees: `start`/`stop`, `mode` (prod/dev tuning presets), `tune`
(autotuner; `tune list` shows available tuners), `check` (verify system
requirements), `config` (bootstrap/init/print/set for node config), and
`admin` (brokers list/decommission/decommission-status/recommission,
partitions list, config log-level set). Some subcommands (start, stop, tune,
mode, check) are Linux-only and hidden from `--help` on macOS.

**Subskill**: `rpk-redpanda`

```bash
rpk redpanda mode prod
rpk redpanda tune all
rpk redpanda check
rpk redpanda admin brokers list
rpk redpanda admin brokers decommission 4
rpk redpanda config bootstrap --self <ip> --ips <ip1,ip2,ip3>
```

---

### `rpk iotune`
Benchmark the disk I/O of a node and write optimal io properties to
`io-config.yaml` for the broker to use at startup. Linux-only; part of the
same node-tuning story as `rpk redpanda tune`.

**Subskill**: `rpk-redpanda`

```bash
rpk iotune --duration 10m
```

---

### `rpk oxla`
Redpanda Oxla (SQL engine) — currently a "Coming Soon" stub in the CLI. The
SQL product surface is covered by the `sql` skills.

---

## Global flags available on all commands

| Flag | Short | Description |
|---|---|---|
| `--config <path>` | | Use a specific config file instead of default search paths |
| `--profile <name>` | | Use a named rpk profile |
| `--ignore-profile` | | Ignore rpk.yaml and redpanda.yaml; use built-in defaults |
| `-X <key=value>` | | Override a configuration option (use multiple `-X` flags) |
| `--verbose` | `-v` | Enable verbose/debug logging |

`--ignore-profile` and `--profile` are mutually exclusive.
`--ignore-profile` and `--config` are mutually exclusive.

---

## Discover commands interactively

```bash
# Top-level help
rpk --help

# Help for a specific group
rpk topic --help
rpk cluster --help

# Help for a specific subcommand
rpk topic create --help
rpk cluster config set --help

# List all -X configuration options
rpk -X list
rpk -X help
```
