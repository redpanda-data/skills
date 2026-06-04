---
name: connect-cdc-oracle
description: "Behavioral guidance for Oracle CDC with Redpanda Connect. Use when: setting up oracledb_cdc with LogMiner, troubleshooting supplemental logging, or diagnosing archive log issues. This skill provides agent choreography - the actual config fields come from docs."
metadata:
  version: "2.0.0"
---

# Oracle CDC: Agent Behavior Guide

This skill provides behavioral guidance for setting up and troubleshooting Oracle CDC with Redpanda Connect. For config field reference and detailed procedures, see the [oracledb_cdc documentation](https://docs.redpanda.com/redpanda-connect/components/inputs/oracledb_cdc/).

> **Enterprise Feature**: `oracledb_cdc` requires a Redpanda Enterprise license.

## Before you start

Always verify these prerequisites in order:

1. **Database is in ARCHIVELOG mode** — run `SELECT LOG_MODE FROM V$DATABASE;` must return `ARCHIVELOG`
2. **Supplemental logging enabled** — `ALTER DATABASE ADD SUPPLEMENTAL LOG DATA;`
3. **Table-level supplemental logging** — `ALTER TABLE schema.table ADD SUPPLEMENTAL LOG DATA (ALL) COLUMNS;`
4. **User has LogMiner privileges** — requires EXECUTE on DBMS_LOGMNR and SELECT on V$ views

## Common gotchas

| Gotcha | How to Avoid |
|--------|--------------|
| Database not in ARCHIVELOG mode | LogMiner requires archive logs. Check with `SELECT LOG_MODE FROM V$DATABASE;` |
| Supplemental logging not enabled | Both database-level and table-level supplemental logging required |
| Archive logs purged too quickly | If RMAN purges logs before connector reads them, data is lost. Adjust retention. |
| Missing privileges | LogMiner needs many privileges. Use the documented privilege set. |
| PDB vs CDB confusion | For pluggable databases, connect to the correct container |
| LOB columns | Large objects require special handling and add complexity |

## Decision tree

| Symptom | First Move |
|---------|-----------|
| Connector won't start | Check ARCHIVELOG mode and supplemental logging first |
| Missing columns in changes | Table-level supplemental logging not enabled for all columns |
| Can't resume after gap | Archive logs were purged. Adjust RMAN retention policy. |
| Permission denied | User needs LogMiner privileges — EXECUTE on DBMS_LOGMNR packages |
| License error | `oracledb_cdc` is enterprise — verify license is loaded |

## LogMiner configuration

The connector uses Oracle LogMiner to read redo logs. Key considerations:

- **Archive log retention**: Keep logs long enough for connector downtime
- **Supplemental logging granularity**: Enable at database AND table level
- **Mining session resources**: LogMiner uses PGA memory; size appropriately

## Supplemental logging checklist

```sql
-- Database level (minimum)
ALTER DATABASE ADD SUPPLEMENTAL LOG DATA;

-- Table level (for each table)
ALTER TABLE schema.table ADD SUPPLEMENTAL LOG DATA (ALL) COLUMNS;

-- Verify
SELECT SUPPLEMENTAL_LOG_DATA_MIN FROM V$DATABASE;
```

## When to escalate

- LogMiner session errors
- Archive log gaps causing data loss
- Performance issues with high-volume tables
- RAC or Data Guard specific issues

**Docs**: [oracledb_cdc Input](https://docs.redpanda.com/redpanda-connect/components/inputs/oracledb_cdc/)
