---
name: connect-cdc-postgres
description: "Behavioral guidance for PostgreSQL CDC with Redpanda Connect. Use when: setting up postgres_cdc, troubleshooting replication, or diagnosing slot growth. This skill provides agent choreography - the actual config fields come from docs."
metadata:
  version: "2.0.0"
---

# PostgreSQL CDC: Agent Behavior Guide

This skill provides behavioral guidance for setting up and troubleshooting PostgreSQL CDC with Redpanda Connect. For config field reference and detailed procedures, see the [postgres_cdc documentation](https://docs.redpanda.com/redpanda-connect/components/inputs/postgres_cdc/).

> **Enterprise Feature**: `postgres_cdc` requires a Redpanda Enterprise license.

## Before you start

Always verify these prerequisites in order:

1. **`wal_level = logical`** — run `SHOW wal_level;` in PostgreSQL. If it's not `logical`, change requires a server restart.
2. **Tables have primary keys** — snapshot requires PKs for pagination. No PK = no snapshot for that table.
3. **User has REPLICATION privilege** — `CREATE USER cdc_user WITH REPLICATION LOGIN PASSWORD 'secret';`
4. **User has SELECT on target tables** — `GRANT SELECT ON TABLE public.orders TO cdc_user;`

## Common gotchas

| Gotcha | How to Avoid |
|--------|--------------|
| Forgot `wal_level=logical` | Always verify with `SHOW wal_level;` first — this is the #1 setup failure |
| Tables without primary keys | Snapshot will fail. Add PKs or exclude those tables |
| Replication slot grows unbounded | Pipeline stopped but slot still exists. Monitor `pg_replication_slots` |
| WAL disk fills up | Unacknowledged slot blocks WAL reclamation. Set `heartbeat_interval` for quiet tables |
| TOAST columns missing in updates | Set `REPLICA IDENTITY FULL` on the table, or use `unchanged_toast_value` sentinel |
| Publication doesn't exist error | Pre-create it as `pglog_stream_<slot_name>` or grant `CREATE PUBLICATION` |

## Decision tree

| Symptom | First Move |
|---------|-----------|
| Pipeline won't start | Check `wal_level` first, then verify user has REPLICATION privilege |
| Snapshot stuck/slow | Check if tables have PKs; reduce `snapshot_batch_size` if memory constrained |
| Missing changes after restart | Slot may have been dropped. Check `pg_replication_slots` |
| WAL disk filling up | Pipeline stopped? Slot is blocking WAL. Resume pipeline or drop slot |
| Updates missing columns | TOAST issue — set `REPLICA IDENTITY FULL` or configure `unchanged_toast_value` |
| License error | `postgres_cdc` is enterprise — verify license is loaded |

## Monitoring replication health

Watch these PostgreSQL views:
- `pg_replication_slots` — slot lag and status
- `pg_stat_replication` — replication connection status
- `pg_current_wal_lsn()` vs `confirmed_flush_lsn` — how far behind is the slot?

## Slot naming convention

- Slot name: whatever you configure in `slot_name` (alphanumeric + underscores only)
- Publication name: automatically `pglog_stream_<slot_name>`

If you pre-create the publication, use exactly that naming pattern.

## Heartbeats for quiet tables

If a table has infrequent writes, the slot won't advance and WAL accumulates. Set `heartbeat_interval` (default `1h`) to emit periodic logical messages that advance the LSN.

Set to `0s` to disable (not recommended for production).

## When to escalate

- Slot lag growing despite healthy pipeline
- Data corruption or missing transactions
- Replication connection drops intermittently
- Performance issues with high-volume tables

**Docs**: [postgres_cdc Input](https://docs.redpanda.com/redpanda-connect/components/inputs/postgres_cdc/)
