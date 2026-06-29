---
name: connect-cdc-mysql
description: "Behavioral guidance for MySQL CDC with Redpanda Connect. Use when: setting up mysql_cdc, troubleshooting binlog replication, or diagnosing checkpoint issues. This skill provides agent choreography - the actual config fields come from docs."
metadata:
  version: "2.0.0"
---

# MySQL CDC: Agent Behavior Guide

This skill provides behavioral guidance for setting up and troubleshooting MySQL CDC with Redpanda Connect. For config field reference and detailed procedures, see the [mysql_cdc documentation](https://docs.redpanda.com/redpanda-connect/components/inputs/mysql_cdc/).

> **Enterprise Feature**: `mysql_cdc` requires a Redpanda Enterprise license.

## Before you start

Always verify these prerequisites in order:

1. **Binary logging enabled** — run `SHOW VARIABLES LIKE 'log_bin';` must return `ON`
2. **Row-based binlog format** — run `SHOW VARIABLES LIKE 'binlog_format';` must return `ROW`
3. **User has REPLICATION SLAVE privilege** — `GRANT REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO 'cdc_user'@'%';`
4. **User has SELECT on target tables** — `GRANT SELECT ON mydb.* TO 'cdc_user'@'%';`

## Common gotchas

| Gotcha | How to Avoid |
|--------|--------------|
| Binary logging not enabled | `log_bin` must be ON. Requires MySQL restart to change. |
| Wrong binlog format | Must be `ROW`, not `STATEMENT` or `MIXED`. Check with `SHOW VARIABLES LIKE 'binlog_format';` |
| Binlog files purged | If connector is stopped too long, needed binlog files may be deleted. Monitor `binlog_expire_logs_seconds`. |
| GTID vs file/position confusion | Decide upfront: use GTID mode for simpler failover, or file/position for legacy setups |
| Checkpoint cache not configured | Without a cache, connector can't resume after restart. Configure `checkpoint_cache`. |
| Schema changes break replication | DDL changes may require connector restart or reconfiguration |

## Decision tree

| Symptom | First Move |
|---------|-----------|
| Connector won't start | Check `log_bin=ON` and `binlog_format=ROW` first |
| Can't resume after restart | Checkpoint cache not configured or corrupted. Check cache health. |
| Missing events | Binlog files may have been purged. Check `SHOW BINARY LOGS;` |
| Permission denied | User needs REPLICATION SLAVE, REPLICATION CLIENT, and SELECT privileges |
| License error | `mysql_cdc` is enterprise — verify license is loaded |

## GTID vs position mode

- **GTID mode** (recommended): Simpler failover, automatic position tracking
- **File/position mode**: Works with older MySQL, more manual management

Check if GTID is enabled: `SHOW VARIABLES LIKE 'gtid_mode';`

## Checkpoint configuration

Without a checkpoint cache, the connector can't resume from where it left off. Always configure `checkpoint_cache` with a persistent backend (file, Redis, etc.) for production.

## When to escalate

- Replication lag growing despite healthy connector
- Data inconsistencies between source and sink
- Binlog parsing errors
- Performance issues with high-volume tables

**Docs**: [mysql_cdc Input](https://docs.redpanda.com/redpanda-connect/components/inputs/mysql_cdc/)
