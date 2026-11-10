---
name: rpk-cluster
description: >-
  Operate a Redpanda cluster from the CLI with the `rpk cluster` command group,
  and look up cluster commands and properties in the Redpanda docs. Use when
  checking cluster health or metadata, decommissioning or recommissioning
  brokers, getting, setting, importing, or resetting cluster config properties,
  balancing, moving, or recovering partitions, enabling maintenance mode,
  setting broker log levels, finalizing an upgrade, managing client quotas,
  running self-tests, restoring or mounting topics from Tiered Storage, or
  managing the Enterprise license and the cluster properties that turn on
  Enterprise features. For single-node process lifecycle (start, stop, tuning,
  redpanda.yaml), see /redpanda:rpk-redpanda; for diagnostics bundles, see
  /redpanda:rpk-debug.
---

# rpk cluster

`rpk cluster` inspects and operates a running Redpanda cluster, mostly through
the Admin API. This skill keeps only the product-specific procedure below. Look
up everything else in the docs (last section).

## How to work

**Never import a file that holds only the properties you want to change.**
`rpk cluster config import` treats the file as the whole configuration: every
property that is set on the cluster and missing from the file goes back to its
default, including authorization and SASL settings, and it does not ask first.
For a few properties use `rpk cluster config set`. For bulk changes, export the
current configuration, edit that export, and import it.

**To reset a property on a running cluster, use `rpk cluster config set
<property> ""`.** `rpk cluster config force-reset` only edits the local
broker's configuration cache, for a broker that won't start, and only while
Redpanda is stopped.

**Get the user's go-ahead before an unsafe recovery or an upgrade
finalization.** `rpk cluster partitions unsafe-recover` can lose data: run it
with `--dry` first, show the plan, and ask. `rpk cluster upgrade finalize` is
irreversible and removes the option to downgrade. A cluster that reports
"ready to finalize" with auto-finalization off is waiting for that decision, so
report it and ask instead of finalizing.

**Ask before starting a self-test on a cluster that serves traffic.**
`rpk cluster self-test start` runs disk and network benchmarks that load the
brokers and can make a latency problem worse. Say so, and run it only after the
user agrees or picks a quiet window.

**Don't get past an rpk warning on your own.** When rpk prompts because a
change may lose data or load the cluster, read the warning and tell the user.
Don't add `--no-confirm` or pipe an answer into the prompt to skip it. For
example, the warning on turning off `cloud_storage_enable_remote_write` names
the property to use to pause uploads instead.

## Use the docs for everything else

Look up subcommands, flags, defaults, cluster properties, Enterprise license
gates, and procedures in the Redpanda docs instead of from memory:

- Follow `/redpanda:redpanda-docs`. Use `get_rpk_command` for one rpk command,
  `get_config_property` for one cluster property and `list_config_properties`
  to find a property's name, and `ask_redpanda_question` for everything else.
- Most useful pages: the rpk cluster reference at
  https://docs.redpanda.com/streaming/current/reference/rpk/rpk-cluster/rpk-cluster/
  (one page per subcommand), the cluster properties reference at
  https://docs.redpanda.com/streaming/current/reference/properties/cluster-properties/,
  and the object storage properties reference at
  https://docs.redpanda.com/streaming/current/reference/properties/object-storage-properties/.
  Swap `current` for the user's version.
- For a Redpanda Cloud cluster, pass `platform: "cloud"`.

If the Docs MCP server refuses for quota and you can't fetch the page, tell the
user to sign in through `/mcp` rather than answering from memory.

`rpk cluster <subcommand> --help` on the installed rpk is the live check for
flags in that version.
