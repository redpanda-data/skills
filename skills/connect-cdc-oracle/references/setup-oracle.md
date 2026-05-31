# Setting Up Oracle for CDC

This reference covers every Oracle-side step required before starting `oracledb_cdc`. All SQL commands were verified against the connector's `replication/stream.go` (`VerifyUserTables` checks `ALL_LOG_GROUPS`) and `input_oracledb_cdc.go` (permission requirements in the description block).

## Prerequisites Summary

| Requirement | Purpose |
|---|---|
| ARCHIVELOG mode | LogMiner requires archived redo logs |
| Supplemental logging | Redo logs must contain enough column data to reconstruct rows |
| LogMiner privileges | Connect user needs access to `V$LOGMNR_CONTENTS` and catalog views |
| RPCN schema (default only) | Built-in checkpoint table is created under `RPCN` |
| ARCHIVELOG retention | Logs must exist long enough for LogMiner to process them |

---

## 1. ARCHIVELOG Mode

LogMiner requires the database to run in ARCHIVELOG mode.

### Check current mode

```sql
SELECT LOG_MODE FROM V$DATABASE;
-- Result: ARCHIVELOG or NOARCHIVELOG
```

### Enable ARCHIVELOG mode (requires SYSDBA, database restart)

```sql
-- As SYSDBA:
SHUTDOWN IMMEDIATE;
STARTUP MOUNT;
ALTER DATABASE ARCHIVELOG;
ALTER DATABASE OPEN;

-- Verify:
SELECT LOG_MODE FROM V$DATABASE;
-- LOG_MODE
-- -----------
-- ARCHIVELOG
```

On **Amazon RDS for Oracle**, ARCHIVELOG mode is enabled by default. On **Oracle Cloud Infrastructure (OCI)**, it is also enabled by default.

---

## 2. Supplemental Logging

Supplemental logging ensures that redo log entries contain enough data to reconstruct full row images. The connector validates this at startup via `ALL_LOG_GROUPS` (`replication/stream.go` `VerifyUserTables`). Zero log groups for a table causes an error: `"supplemental logging not enabled for table '<owner.table>' - no log groups found"`.

### Enable minimal database-wide supplemental logging

```sql
ALTER DATABASE ADD SUPPLEMENTAL LOG DATA;
```

This is required. It enables logging of the primary key for all changes.

### Enable ALL columns supplemental logging per table

```sql
-- Must be run for each table you want to capture:
ALTER TABLE MYSCHEMA.ORDERS    ADD SUPPLEMENTAL LOG DATA (ALL) COLUMNS;
ALTER TABLE MYSCHEMA.PRODUCTS  ADD SUPPLEMENTAL LOG DATA (ALL) COLUMNS;
ALTER TABLE MYSCHEMA.CUSTOMERS ADD SUPPLEMENTAL LOG DATA (ALL) COLUMNS;
```

`ALL COLUMNS` ensures that UPDATE events include both old and new values for every column. Without this, UPDATE events may only contain the changed columns.

### Verify supplemental logging is active

```sql
-- Check database-level:
SELECT SUPPLEMENTAL_LOG_DATA_MIN FROM V$DATABASE;
-- Result: YES

-- Check per-table log groups:
SELECT OWNER, TABLE_NAME, LOG_GROUP_NAME, LOG_GROUP_TYPE
FROM ALL_LOG_GROUPS
WHERE OWNER = 'MYSCHEMA'
ORDER BY TABLE_NAME;
```

---

## 3. LogMiner Privileges

The Connect user needs access to Oracle's LogMiner infrastructure and the catalog views that the connector queries.

### Create the replication user

```sql
CREATE USER rpcn IDENTIFIED BY "SecurePassword1";
```

### Grant required privileges

```sql
-- Basic connection
GRANT CREATE SESSION TO rpcn;

-- LogMiner: Oracle 12c+ (preferred)
GRANT LOGMINING TO rpcn;

-- LogMiner: Oracle 10g/11g (alternative to LOGMINING)
-- GRANT EXECUTE ON DBMS_LOGMNR TO rpcn;
-- GRANT EXECUTE ON DBMS_LOGMNR_D TO rpcn;

-- Read transaction metadata
GRANT SELECT ANY TRANSACTION TO rpcn;

-- System views used by LogMiner
GRANT SELECT ON V_$DATABASE        TO rpcn;
GRANT SELECT ON V_$LOG             TO rpcn;
GRANT SELECT ON V_$LOGFILE         TO rpcn;
GRANT SELECT ON V_$ARCHIVED_LOG    TO rpcn;
GRANT SELECT ON V_$ARCHIVE_DEST_STATUS TO rpcn;
GRANT SELECT ON V_$LOGMNR_CONTENTS TO rpcn;

-- Catalog views for table/column/supplemental-log discovery
GRANT SELECT ON ALL_TABLES         TO rpcn;
GRANT SELECT ON ALL_LOG_GROUPS     TO rpcn;
GRANT SELECT ON ALL_TAB_COLUMNS    TO rpcn;
-- Required for snapshot primary-key discovery (replication/snapshot.go queries these):
GRANT SELECT ON ALL_CONSTRAINTS    TO rpcn;
GRANT SELECT ON ALL_CONS_COLUMNS   TO rpcn;

-- Read access to monitored tables (required for snapshots)
GRANT SELECT ON MYSCHEMA.ORDERS    TO rpcn;
GRANT SELECT ON MYSCHEMA.PRODUCTS  TO rpcn;

-- For the built-in checkpoint table (skip if using checkpoint_cache):
GRANT CREATE TABLE     TO rpcn;
GRANT CREATE PROCEDURE TO rpcn;
-- Note: no separate schema-creation step needed. In Oracle, CREATE USER rpcn (above)
-- implicitly creates the RPCN schema. The connector creates its checkpoint table
-- under that schema using the CREATE TABLE privilege granted here.
```

### CDB/PDB additional privilege

When using `pdb_name` (CDB/PDB mode), the user must connect to the CDB root and be granted container-switching rights:

```sql
-- As SYSDBA connected to CDB$ROOT:
CREATE USER C##RPCN IDENTIFIED BY "SecurePassword1" CONTAINER=ALL;
GRANT CREATE SESSION     TO C##RPCN CONTAINER=ALL;
GRANT LOGMINING          TO C##RPCN CONTAINER=ALL;
GRANT SET CONTAINER      TO C##RPCN CONTAINER=ALL;
GRANT SELECT ANY TRANSACTION TO C##RPCN CONTAINER=ALL;
GRANT SELECT ON V_$DATABASE         TO C##RPCN CONTAINER=ALL;
GRANT SELECT ON V_$LOG              TO C##RPCN CONTAINER=ALL;
GRANT SELECT ON V_$LOGFILE          TO C##RPCN CONTAINER=ALL;
GRANT SELECT ON V_$ARCHIVED_LOG     TO C##RPCN CONTAINER=ALL;
GRANT SELECT ON V_$ARCHIVE_DEST_STATUS TO C##RPCN CONTAINER=ALL;
GRANT SELECT ON V_$LOGMNR_CONTENTS  TO C##RPCN CONTAINER=ALL;
GRANT SELECT ON ALL_TABLES          TO C##RPCN CONTAINER=ALL;
GRANT SELECT ON ALL_LOG_GROUPS      TO C##RPCN CONTAINER=ALL;
GRANT SELECT ON ALL_TAB_COLUMNS     TO C##RPCN CONTAINER=ALL;
-- Required for snapshot primary-key discovery:
GRANT SELECT ON ALL_CONSTRAINTS     TO C##RPCN CONTAINER=ALL;
GRANT SELECT ON ALL_CONS_COLUMNS    TO C##RPCN CONTAINER=ALL;
GRANT CREATE TABLE       TO C##RPCN CONTAINER=ALL;
GRANT CREATE PROCEDURE   TO C##RPCN CONTAINER=ALL;
```

Common-user names in a CDB must have the `C##` prefix.

> **Note:** The connector's table discovery (`VerifyUserTables`) excludes any table owner whose name matches `C##%`. Tables owned by common users (schemas with the `C##` prefix) cannot be captured. Monitored tables must live in a local PDB schema (a non-`C##` schema inside the target PDB).

---

## 4. Oracle Wallet (TLS/SSL)

To connect with TLS, place an Oracle Wallet in a directory accessible to the Connect process and set `wallet_path`.

### Auto-login wallet (cwallet.sso)

No password required. The connector enables SSL automatically when `wallet_path` is set.

```yaml
input:
  oracledb_cdc:
    connection_string: oracle://rpcn:password@host:2484/service_ssl
    wallet_path: /opt/oracle/wallet
```

### PKCS#12 wallet (ewallet.p12)

```yaml
input:
  oracledb_cdc:
    connection_string: oracle://rpcn:password@host:2484/service_ssl
    wallet_path: /opt/oracle/wallet
    wallet_password: "${ORACLE_WALLET_PASSWORD}"
```

Alternatively, pass the wallet path via the connection string query parameter:

```yaml
connection_string: oracle://user:password@host:1522/service?WALLET=/opt/oracle/wallet&SSL=true
```

---

## 5. CDB/PDB (Pluggable Databases)

### Architecture

- **CDB (Container Database):** The root container, accessed via `CDB$ROOT`. LogMiner at the CDB root can mine redo from all PDBs.
- **PDB (Pluggable Database):** An application database inside the CDB. Use `pdb_name` to scope the connector to one PDB.

### Connection model

Connect via the **CDB root service** (not a PDB-local service) and set `pdb_name` to the PDB you want to monitor:

```yaml
input:
  oracledb_cdc:
    connection_string: oracle://C##RPCN:password@host:1521/CDB_ROOT_SERVICE
    pdb_name: MYPDB
    include:
      - ^APPSCHEMA\.ORDERS$
    logminer:
      scn_window_size: 20000
      backoff_interval: 5s
      mining_interval: 300ms
      strategy: online_catalog
      lob_enabled: true
```

### What the connector does in CDB mode

1. Detects CDB mode by querying `SYS_CONTEXT('USERENV', 'CON_NAME')` — must return `CDB$ROOT`.
2. Filters `V$LOGMNR_CONTENTS` by `SRC_CON_NAME = '<pdb_name>'`.
3. Switches session context to the PDB (`ALTER SESSION SET CONTAINER = <pdb_name>`) for catalog queries (`ALL_TABLES`, `ALL_LOG_GROUPS`, `ALL_TAB_COLUMNS`).
4. Names the built-in checkpoint table `C##RPCN.CDC_CHECKPOINT_<PDB>` to avoid SCN collisions between PDBs.

### Error: "pdb_name is set but connected to container X instead of CDB$ROOT"

You are connecting directly to a PDB service. Use the CDB root service in `connection_string` instead.

---

## 6. ARCHIVELOG Retention

LogMiner can only mine redo logs that still exist on disk. If archived logs are purged before the connector processes them, Oracle returns `ORA-01291: missing logfile`. This usually happens when:

- The connector is paused or offline for longer than Oracle's log retention window.
- `scn_window_size` is very large and processing one window takes too long.

### Increase retention via RMAN

```sql
-- In RMAN:
CONFIGURE RETENTION POLICY TO RECOVERY WINDOW OF 7 DAYS;

-- Or by archive log deletion policy:
-- CONFIGURE ARCHIVELOG DELETION POLICY TO APPLIED ON ALL STANDBY;
```

### Check current archive log status

```sql
SELECT NAME, STATUS, ARCHIVED, FIRST_CHANGE#, NEXT_CHANGE#
FROM V$ARCHIVED_LOG
WHERE STATUS = 'A'
ORDER BY FIRST_CHANGE#;
```

### On Amazon RDS for Oracle

```sql
-- Retention is set in hours (720 = 30 days):
EXEC rdsadmin.rdsadmin_util.set_configuration('archivelog retention hours', 720);
COMMIT;
```

---

## 7. Checking Supplemental Log Groups (Quick Validation)

Before starting the connector, verify the expected tables have log groups:

```sql
SELECT OWNER, TABLE_NAME, COUNT(*) AS LOG_GROUPS
FROM ALL_LOG_GROUPS
WHERE OWNER = 'MYSCHEMA'
GROUP BY OWNER, TABLE_NAME;
```

Expected: at least one log group per table. Zero log groups will cause the connector to return an error at startup.
