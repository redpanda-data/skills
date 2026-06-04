---
name: streaming-debugging
description: "Behavioral guidance for debugging Redpanda brokers. Use when: a broker is unhealthy, crashing, lagging, or out of disk; triaging cluster health issues; or diagnosing enterprise feature problems. This skill provides agent choreography - the actual commands and metrics come from docs."
metadata:
  version: "2.0.0"
---

# Streaming Debugging: Agent Behavior Guide

This skill provides behavioral guidance for debugging Redpanda clusters. For command syntax, metric names, and configuration details, see the [Redpanda documentation](https://docs.redpanda.com/).

## First three moves

When something is wrong with a Redpanda cluster:

1. **Check cluster health first** — run `rpk cluster health`. If unhealthy, that's your starting point.
2. **Check license status early** — many "feature broken" issues are actually license violations. Run `rpk cluster license info` and look for `Violation: true`.
3. **Collect a debug bundle before deep-diving** — you'll need it for support, and it captures point-in-time state. Use `rpk debug bundle` locally or `rpk debug remote-bundle start` remotely.

## Decision tree

Based on what you find, prioritize:

| Signal | Priority | Next Step |
|--------|----------|-----------|
| `Violation: true` in license info | High | License issue - resolve before investigating features |
| Under-replicated partitions > 0 | High | Investigate replica health, check if brokers are down |
| `disk_free_space_alert` non-zero | Urgent | Disk pressure - check retention, delete data, or add capacity |
| Unavailable partitions > 0 | Critical | Partitions have no leader - check broker status immediately |
| Consumer lag growing | Medium | Check if it's throughput-bound or processing-bound |
| High leadership changes | Medium | Indicates instability - check network, resources, or config |

## Red herrings to avoid

- **High CPU doesn't always mean a problem** — check if throughput is proportional. CPU should scale with load.
- **Don't suggest config changes until you've identified root cause** — config tweaks without diagnosis often make things worse.
- **A single slow broker may be network, not the broker itself** — check network metrics and connectivity before blaming the broker.
- **Memory pressure warnings need context** — Redpanda manages its own memory; low available memory is normal under load.

## When analyzing a debug bundle

1. **Start with `admin/health_overview.json`** — gives you the cluster health summary
2. **Check `admin/license.json` first** — dismiss license issues before proceeding
3. **Look at metrics snapshots for trends, not point-in-time values** — compare `t0_public_metrics.txt` vs `t1_public_metrics.txt`
4. **Check `admin/cluster_config.json`** for non-default settings that might be causing issues
5. **Review crash reports** in `crash_reports/` if brokers are restarting

## Enterprise feature debugging

For enterprise features (Tiered Storage, Continuous Data Balancing, Iceberg Topics, Shadow Linking):

1. **Always verify license first** — enterprise features silently degrade without a valid license
2. **Check feature-specific status commands** before diving into metrics
3. **On license expiration** — cluster keeps running but you can't enable/modify enterprise features

## When to escalate

- Crash loops with no obvious cause in logs
- Data corruption suspected (checksum errors, inconsistent state)
- Cluster won't form quorum after multiple broker restarts
- Performance degradation with no clear resource bottleneck

**Docs**: [Monitoring](https://docs.redpanda.com/current/manage/monitoring/) · [Debug bundles](https://docs.redpanda.com/current/troubleshoot/debug-bundle/overview/) · [rpk commands](https://docs.redpanda.com/current/reference/rpk/)
