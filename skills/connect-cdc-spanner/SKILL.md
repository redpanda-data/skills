---
name: connect-cdc-spanner
description: "Behavioral guidance for Google Cloud Spanner CDC with Redpanda Connect. Use when: setting up gcp_spanner_cdc, troubleshooting change streams, or diagnosing partition issues. This skill provides agent choreography - the actual config fields come from docs."
metadata:
  version: "2.0.0"
---

# Google Cloud Spanner CDC: Agent Behavior Guide

This skill provides behavioral guidance for setting up and troubleshooting Google Cloud Spanner CDC with Redpanda Connect. For config field reference and detailed procedures, see the [gcp_spanner_cdc documentation](https://docs.redpanda.com/redpanda-connect/components/inputs/gcp_spanner_cdc/).

> **Enterprise Feature**: `gcp_spanner_cdc` requires a Redpanda Enterprise license.

## Before you start

Always verify these prerequisites in order:

1. **Change stream created on table(s)** — `CREATE CHANGE STREAM my_stream FOR my_table;`
2. **Service account has Spanner permissions** — needs `spanner.databases.read` and `spanner.sessions.create`
3. **Change stream retention configured** — default is 1 day; adjust based on connector downtime tolerance
4. **GCP credentials available** — service account JSON or workload identity

## Common gotchas

| Gotcha | How to Avoid |
|--------|--------------|
| No change stream exists | Must explicitly create change stream with DDL — not automatic |
| Change stream retention too short | Default 1 day. If connector is down longer, data is lost. |
| Missing service account permissions | Need both database read and session create permissions |
| Partition handling complexity | Spanner change streams have partitions; connector handles merging |
| Regional vs multi-regional differences | Behavior can vary; test in your specific configuration |
| Cost implications | Change streams have storage and read costs; monitor billing |

## Decision tree

| Symptom | First Move |
|---------|-----------|
| Connector won't start | Verify change stream exists with `SELECT * FROM INFORMATION_SCHEMA.CHANGE_STREAMS;` |
| Can't resume after gap | Change stream retention expired. Increase retention period. |
| Permission denied | Check service account has Spanner read permissions |
| Missing changes | Verify change stream covers the correct tables |
| License error | `gcp_spanner_cdc` is enterprise — verify license is loaded |

## Change stream setup

```sql
-- Create change stream for specific tables
CREATE CHANGE STREAM my_stream FOR my_table, other_table;

-- Create change stream for all tables
CREATE CHANGE STREAM my_stream FOR ALL;

-- Set retention (e.g., 7 days)
ALTER CHANGE STREAM my_stream SET OPTIONS (retention_period = '7d');

-- Verify
SELECT * FROM INFORMATION_SCHEMA.CHANGE_STREAMS;
```

## Retention period

Change stream data is retained for a configurable period (default 1 day, max 7 days). If the connector is stopped longer than retention, it cannot resume and will miss data.

Plan retention based on:
- Maximum expected connector downtime
- Cost (longer retention = more storage cost)
- Recovery requirements

## When to escalate

- Change stream partitioning issues
- Data inconsistencies between source and sink
- Unexpected latency or throughput issues
- Multi-regional replication complexity

**Docs**: [gcp_spanner_cdc Input](https://docs.redpanda.com/redpanda-connect/components/inputs/gcp_spanner_cdc/)
