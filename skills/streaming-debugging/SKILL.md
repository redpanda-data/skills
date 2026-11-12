---
name: streaming-debugging
description: >-
  Diagnose a self-managed Redpanda broker or cluster with debug bundles, the
  metrics endpoints, logs, CPU profiling, and partition and Raft health checks,
  and look up the details in the Redpanda docs. Use when a broker is unhealthy,
  crashing, or out of disk, when partitions are under-replicated or leaderless,
  when consumer lag keeps growing, when collecting a debug bundle for Redpanda
  support with rpk debug bundle or rpk debug remote-bundle, or when an
  Enterprise feature such as Continuous Data Balancing, Tiered Storage, or
  Shadow Linking misbehaves. For raw Admin API endpoints, see
  /redpanda:streaming-admin-api, and for rpk debug flags, see /redpanda:rpk-debug.
---

# Redpanda Streaming debugging

Debugging a self-managed cluster means reading its health, metrics, logs, and
debug bundles, then fixing the cause. This skill keeps only the safety rule
below. Look up everything else in the docs (last section).

## How to work

**Confirm a broker is gone for good before you force recovery or decommission
it.** Forcing recovery of partitions that lost majority
(`rpk cluster partitions unsafe-recover`, or the Admin API
`force_recover_from_nodes`) can lose every record the surviving replicas
didn't have. Decommissioning removes the broker from the cluster for good and
moves all its data. A broker that is only down rejoins and catches up when it
restarts. So when brokers are down, say what restarting them would restore and
what each forced step would cost, then ask the user whether the brokers can
come back. A `--dry` run is fine without asking.

**To stop partitions moving, take the balancer off `continuous` first, then
cancel the moves.** With `partition_autobalancing_mode=continuous`, cancelling
the current movements is not enough, because the balancer schedules new ones on
its next round. Set the mode to `off` (or `node_add`), then run
`rpk cluster partitions move-cancel`, and remind the user to set the mode back
afterward.

## Use the docs for everything else

Look up commands, flags, endpoints, metric names, properties, and
troubleshooting procedures in the Redpanda docs instead of from memory:

- Follow `/redpanda:redpanda-docs`. Use `get_rpk_command` for one rpk command,
  `get_config_property` for one cluster or broker property,
  `search_api_reference` for an Admin API endpoint, and `ask_redpanda_question`
  for everything else.
- Most useful pages:
  - Debug bundles: https://docs.redpanda.com/streaming/current/troubleshoot/debug-bundle/overview/
  - Cluster diagnostics: https://docs.redpanda.com/streaming/current/troubleshoot/cluster-diagnostics/diagnose-issues/
  - Errors and solutions: https://docs.redpanda.com/streaming/current/troubleshoot/errors-solutions/
  - Monitoring: https://docs.redpanda.com/streaming/current/manage/monitoring/
  - Public metrics reference: https://docs.redpanda.com/streaming/current/reference/public-metrics-reference/
  - Node-wise partition recovery: https://docs.redpanda.com/streaming/current/manage/cluster-maintenance/nodewise-partition-recovery/
  - Decommission brokers: https://docs.redpanda.com/streaming/current/manage/cluster-maintenance/decommission-brokers/

  Swap `current` for the user's version.

If the Docs MCP server refuses for quota and you can't fetch the page, tell the
user to sign in through `/mcp` rather than answering from memory.

`<command> --help` on the installed rpk, and a live `GET /public_metrics` on
the broker, are the live checks for flags and metric names in that version.
