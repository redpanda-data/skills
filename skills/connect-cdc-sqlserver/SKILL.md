---
name: connect-cdc-sqlserver
description: "Behavioral guidance for SQL Server CDC with Redpanda Connect. Use when: setting up microsoft_sql_server_cdc, troubleshooting CT/CDC configuration, or diagnosing capture job issues. This skill provides agent choreography - the actual config fields come from docs."
metadata:
  version: "2.0.0"
---

# SQL Server CDC: Agent Behavior Guide

This skill provides behavioral guidance for setting up and troubleshooting SQL Server CDC with Redpanda Connect. For config field reference and detailed procedures, see the [microsoft_sql_server_cdc documentation](https://docs.redpanda.com/redpanda-connect/components/inputs/microsoft_sql_server_cdc/).

> **Enterprise Feature**: `microsoft_sql_server_cdc` requires a Redpanda Enterprise license.

## Before you start

Always verify these prerequisites in order:

1. **CDC enabled on database** — `EXEC sys.sp_cdc_enable_db;`
2. **CDC enabled on each table** — `EXEC sys.sp_cdc_enable_table @source_schema='dbo', @source_name='mytable', @role_name=NULL;`
3. **SQL Server Agent running** — CDC capture and cleanup jobs require SQL Server Agent
4. **User has db_owner or specific CDC permissions** — needs SELECT on CDC tables

## Common gotchas

| Gotcha | How to Avoid |
|--------|--------------|
| CDC not enabled on database | Run `sys.sp_cdc_enable_db` first — this is often forgotten |
| CDC not enabled on tables | Must enable CDC per-table, not just database-level |
| SQL Server Agent not running | Capture job won't run. Check Agent service status. |
| Capture job falling behind | Transaction log growing because capture can't keep up. Monitor and tune. |
| Cleanup job too aggressive | May delete changes before connector reads them. Adjust retention. |
| Azure SQL limitations | Azure SQL Database has different CDC behavior than on-prem |

## Decision tree

| Symptom | First Move |
|---------|-----------|
| Connector won't start | Check CDC is enabled on both database AND tables |
| No changes captured | SQL Server Agent running? Capture job enabled? |
| Transaction log growing | Capture job falling behind. Check job history for errors. |
| Missing older changes | Cleanup job deleted them. Adjust retention period. |
| Permission denied | User needs SELECT on cdc schema tables |
| License error | `microsoft_sql_server_cdc` is enterprise — verify license is loaded |

## CDC jobs

SQL Server CDC uses two Agent jobs:
- **Capture job**: Reads transaction log, writes to CDC tables
- **Cleanup job**: Purges old CDC data based on retention

Monitor both jobs. If capture falls behind, transaction log grows. If cleanup is too aggressive, you lose data.

## Enabling CDC checklist

```sql
-- Enable on database
EXEC sys.sp_cdc_enable_db;

-- Enable on each table
EXEC sys.sp_cdc_enable_table
    @source_schema = 'dbo',
    @source_name = 'orders',
    @role_name = NULL,
    @supports_net_changes = 1;

-- Verify
SELECT name, is_cdc_enabled FROM sys.databases WHERE name = DB_NAME();
SELECT * FROM cdc.change_tables;
```

## When to escalate

- Capture job errors in SQL Server Agent
- Transaction log growth despite running capture
- Data inconsistencies between source and CDC tables
- Azure SQL specific issues

**Docs**: [microsoft_sql_server_cdc Input](https://docs.redpanda.com/redpanda-connect/components/inputs/microsoft_sql_server_cdc/)
