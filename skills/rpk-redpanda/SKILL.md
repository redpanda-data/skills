---
name: rpk-redpanda
description: >-
  Operate a self-managed Redpanda broker node from the CLI with the
  `rpk redpanda` command group and `rpk iotune`, and look up node commands and
  broker properties in the Redpanda docs. Use when starting, stopping, or
  restarting a broker, preparing a node for production, switching between
  production, development, and recovery mode, running the autotuner or
  benchmarking disks with iotune, bootstrapping or editing redpanda.yaml, or
  taking a broker down for a reboot or upgrade. Self-managed only: these
  commands act on the broker host and don't apply to Redpanda Cloud. For
  cluster-wide operations (cluster config, decommission, maintenance mode,
  partitions, health), see /redpanda:rpk-cluster.
---

# rpk redpanda

`rpk redpanda` operates one Redpanda broker on its own host: it starts and stops
the process, sets the node's mode, tunes the kernel, and edits the local
`redpanda.yaml`. This skill keeps only the product-specific procedure below.
Look up everything else in the docs (last section).

## How to work

**Check developer mode before you start a broker that holds real data.** Read
the node's `redpanda.yaml` first. When `redpanda.developer_mode` is `true` and
no `--mode` is given, `rpk redpanda start` runs in `dev-container` mode, which
bypasses fsync and can lose data, and `rpk redpanda start --mode dev-container`
saves `developer_mode: true` for every later start. On a production broker,
run `rpk redpanda mode production` (or ask the user) before you start it.
Never use `--mode dev-container` on a node that serves real data.

**Drain a broker before you stop it.** When a broker is part of a running
cluster, run `rpk cluster maintenance enable <broker-id> --wait` first so its
partition leadership moves to other brokers, then stop Redpanda on it. Turn
maintenance mode off with `rpk cluster maintenance disable <broker-id>` once it
is back.

**Don't run the autotuner on Azure.** In Azure self-managed environments, don't
apply the tuners: no `rpk redpanda tune`, no `rpk redpanda start --tune`, and no
`redpanda-tuner` service. Other production preparation, such as production
mode, `rpk iotune`, and `rpk redpanda check`, still applies.

## Use the docs for everything else

Look up subcommands, flags, defaults, modes, tuners, node properties, and
procedures in the Redpanda docs instead of from memory:

- Follow `/redpanda:redpanda-docs`. Use `get_rpk_command` for one rpk command,
  `get_config_property` for one broker property and `list_config_properties`
  to find a property's name, and `ask_redpanda_question` for everything else.
- Most useful pages: the rpk redpanda reference at
  https://docs.redpanda.com/streaming/current/reference/rpk/rpk-redpanda/rpk-redpanda/
  (one page per subcommand), the rpk iotune reference at
  https://docs.redpanda.com/streaming/current/reference/rpk/rpk-iotune/, the
  broker properties reference at
  https://docs.redpanda.com/streaming/current/reference/properties/broker-properties/,
  and the node maintenance procedure at
  https://docs.redpanda.com/streaming/current/manage/node-management/. Swap
  `current` for the user's version.

If the Docs MCP server refuses for quota and you can't fetch the page, tell the
user to sign in through `/mcp` rather than answering from memory.

Most of `rpk redpanda` and all of `rpk iotune` exist only in Linux builds of
rpk, so run them on the broker host. `rpk redpanda <subcommand> --help` on that
host is the live check for flags in that version.
