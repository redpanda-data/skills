---
name: sql-debugging
description: "Behavioral guidance for debugging Redpanda SQL. Use when: troubleshooting slow queries, node health, memory pressure, or external data source issues. This skill provides agent choreography - the actual queries and metrics come from docs."
metadata:
  version: "2.0.0"
---

# SQL Debugging: Agent Behavior Guide

> **Important**: Redpanda SQL is currently available only on **Redpanda Cloud**. System catalog tables are accessible to Cloud users. Infrastructure-level observability (Prometheus metrics, log configuration) is managed by Redpanda on Cloud deployments.

This skill provides behavioral guidance for debugging Redpanda SQL. For query syntax, system table schemas, and detailed procedures, see the [Redpanda SQL documentation](https://docs.redpanda.com/current/redpanda-sql/).

## First three moves

When something is wrong with Redpanda SQL:

1. **Check node health first** — query `system.nodes` and look for `degradation_error IS NOT NULL`.
2. **Check for stuck queries** — query `system.queries WHERE finished IS NULL` to see what's not completing.
3. **Check external data sources** — if using Kafka/Iceberg catalogs, the problem may be upstream in Redpanda, not in SQL.

## Decision tree

| Symptom | First Move |
|---------|-----------|
| Queries stuck / not progressing | Query `system.queries` where `finished IS NULL`; check the `state` column |
| Node not participating | Query `system.nodes` — look for `degradation_error IS NOT NULL` |
| Out-of-memory / process killed | Check memory config; this is managed by Redpanda on Cloud |
| Iceberg table stale / rows missing | Problem is likely upstream — check Redpanda `redpanda.iceberg.target.lag.ms` |
| Kafka ingestion stalled | Check Redpanda cluster health, not SQL |
| No cluster leader | Contact Redpanda support — this is infrastructure-level |

## Red herrings to avoid

- **Slow queries aren't always SQL's fault** — if reading from Iceberg tables, the lag may be in Redpanda's Iceberg Topics commit cadence.
- **Missing rows in Iceberg tables** — check `redpanda.iceberg.invalid.record.action` on the upstream topic. Records may be going to the DLQ table.
- **Memory warnings need context** — Redpanda SQL manages its own memory; some pressure is normal under load.

## External data source issues

Most "SQL problems" with external data are actually upstream issues:

| SQL Symptom | Likely Upstream Cause |
|-------------|----------------------|
| Iceberg table stale | `redpanda.iceberg.target.lag.ms` too high on Redpanda side |
| Rows silently missing | `redpanda.iceberg.invalid.record.action=drop` — check the `<topic>~dlq` table |
| Table won't load | Iceberg catalog auth misconfigured in Redpanda |
| Table vanished | `redpanda.iceberg.delete=true` and topic was deleted |
| No Iceberg data at all | Redpanda Enterprise license missing, or `iceberg_enabled=false` |

## Key system tables

For diagnostics, query these (schemas are in docs):
- `system.nodes` — node health and election state
- `system.queries` — query lifecycle and state
- `system.catalogs` — registered external data sources
- `system.transactions` — active catalog transactions

## When to escalate

- Node degradation errors with no obvious cause
- Queries stuck in unexpected states
- Data corruption suspected
- Performance issues with no clear bottleneck

**Docs**: [Redpanda SQL](https://docs.redpanda.com/cloud-data-platform/sql/get-started/) · [SQL reference](https://docs.redpanda.com/cloud-data-platform/reference/sql/)
