# SQL Server CDC: Setup and Permissions

This reference covers everything you need to do in SQL Server before starting
a `microsoft_sql_server_cdc` pipeline. All T-SQL commands are grounded in
SQL Server's system stored procedures and documented behaviour.

---

## Prerequisites Checklist

- [ ] SQL Server 2012 or later (or Azure SQL Database / Managed Instance)
- [ ] `sysadmin` or `db_owner` rights to run the enable procedures
- [ ] SQL Server Agent service running (on-premises SQL Server)
- [ ] `VIEW DATABASE STATE` permission for the Connect user (for `sys.fn_cdc_get_max_lsn()`)
- [ ] Source tables have a primary key (required for snapshot)
- [ ] `rpcn` schema (or custom schema) created for the built-in checkpoint cache

---

## Step 1: Enable CDC on the Database

CDC must be enabled at the database level first. This creates the `cdc` schema,
system tables, and the Agent cleanup job.

```sql
USE MyDatabase;
EXEC sys.sp_cdc_enable_db;
GO
```

Verify:
```sql
SELECT name, is_cdc_enabled FROM sys.databases WHERE name = 'MyDatabase';
-- is_cdc_enabled should be 1
```

To disable (removes all capture instances and change tables):
```sql
EXEC sys.sp_cdc_disable_db;
```

---

## Step 2: Enable CDC per Table (Create Capture Instances)

For each table you want to capture, create a **capture instance**. This creates
the change table `cdc.<schema>_<tablename>_CT` and the associated Agent jobs.

### Minimal (capture all columns, no role-based access control)

```sql
USE MyDatabase;
EXEC sys.sp_cdc_enable_table
  @source_schema = N'dbo',
  @source_name   = N'orders',
  @role_name     = NULL;   -- NULL = no role gate on change table access
GO
```

### With explicit capture instance name

```sql
EXEC sys.sp_cdc_enable_table
  @source_schema    = N'dbo',
  @source_name      = N'orders',
  @role_name        = NULL,
  @capture_instance = N'dbo_orders';  -- default name is schema_tablename
GO
```

### Capture only specific columns

```sql
EXEC sys.sp_cdc_enable_table
  @source_schema      = N'dbo',
  @source_name        = N'orders',
  @role_name          = NULL,
  @captured_column_list = N'id,customer_id,amount,status';
GO
```

### Verify capture instances

```sql
SELECT
  capture_instance,
  source_schema,
  source_table,
  start_lsn,
  create_date
FROM cdc.change_tables;
```

The connector queries `cdc.change_tables` by `capture_instance = '<schema>_<tablename>'`
to find the starting LSN. If no row is found for a matched table, the pipeline
errors at startup: "no change table found for table 'dbo.orders'".

### Disable a capture instance

```sql
EXEC sys.sp_cdc_disable_table
  @source_schema    = N'dbo',
  @source_name      = N'orders',
  @capture_instance = N'all';  -- 'all' disables all instances for this table
```

---

## Step 3: Verify SQL Server Agent Jobs

CDC requires two Agent jobs per database:

| Job | Purpose |
|---|---|
| `cdc.MyDatabase_capture` | Scans the transaction log and populates change tables |
| `cdc.MyDatabase_cleanup` | Removes old entries from change tables based on retention |

Check that they exist and are running. Use `EXEC sys.sp_cdc_help_jobs` as the authoritative source — it reports CDC-specific job status regardless of SQL Server version:

```sql
EXEC sys.sp_cdc_help_jobs;
```

For a general job listing (job naming conventions can vary by version — treat this as illustrative):

```sql
-- General guidance; exact job names and sysjobactivity column availability
-- may vary by SQL Server version. Prefer sp_cdc_help_jobs above.
USE msdb;
SELECT j.name, j.enabled
FROM sysjobs j
WHERE j.name LIKE 'cdc.%';
```

If Agent is stopped, change tables will not be updated. The connector will
connect successfully but emit no new change events.

On **Azure SQL Managed Instance**, the Agent is available and the setup
procedure is identical to on-premises SQL Server. See [Step: Azure SQL Database](#azure-sql-database-specifics)
for single-database notes.

---

## Step 4: Grant Permissions to the Connect User

The Connect user (the one in `connection_string`) needs:

### Minimum permissions for CDC streaming only

```sql
USE MyDatabase;

-- Read source tables (required for table verification at startup)
GRANT SELECT ON SCHEMA::dbo TO connect_user;

-- Read CDC change tables
GRANT SELECT ON SCHEMA::cdc TO connect_user;

-- Required for fn_cdc_get_max_lsn() and fn_cdc_map_lsn_to_time()
GRANT VIEW DATABASE STATE TO connect_user;
```

### Additional permissions for the built-in checkpoint cache

The `rpcn` schema must be created separately (the pipeline will not create it):

```sql
-- Create the schema (one-time, as a DBO-level user)
CREATE SCHEMA rpcn;

-- Grant rights to the Connect user
GRANT CREATE TABLE TO connect_user;
GRANT CREATE PROCEDURE TO connect_user;
GRANT ALTER ON SCHEMA::rpcn TO connect_user;
```

The `ALTER ON SCHEMA` grant is required for the `CREATE OR ALTER PROCEDURE`
statement that creates the upsert stored procedure.

### Snapshot permissions

The snapshot phase opens a `SNAPSHOT` isolation transaction and reads all rows
from source tables. The `SELECT` grant on the source schema covers this.

SQL Server's snapshot isolation must be enabled on the database for the
`SNAPSHOT` isolation level to be available:

```sql
ALTER DATABASE MyDatabase SET ALLOW_SNAPSHOT_ISOLATION ON;
```

---

## Step 5: Create the Checkpoint Schema

```sql
USE MyDatabase;
CREATE SCHEMA rpcn;
GO
```

If you prefer a different schema (e.g. `dbo`), set `checkpoint_cache_table_name`
accordingly:

```yaml
checkpoint_cache_table_name: dbo.connect_cdc_checkpoint
```

---

## Capture Instance Naming

SQL Server CDC uses capture instance names in the format `<schema>_<tablename>`
by default (e.g. `dbo_orders`). The connector's `VerifyUserDefinedTables`
function queries `cdc.change_tables` using:

```sql
SELECT TOP 1 start_lsn
FROM cdc.change_tables
WHERE capture_instance = ?   -- e.g. 'dbo_orders'
```

If you used a custom `@capture_instance` name when calling
`sys.sp_cdc_enable_table`, the default lookup will fail. In that case, either:

1. Use the default naming (omit `@capture_instance`), or
2. Rename the capture instance to match the default format.

---

## CDC Change Table Structure

Each capture instance creates a change table named `cdc.<schema>_<tablename>_CT`.
The connector reads these tables directly:

```sql
-- Example: inspect change table for dbo.orders
SELECT TOP 10 *
FROM cdc.dbo_orders_CT
ORDER BY __$start_lsn DESC;
```

System columns (all with `__$` prefix) are stripped from emitted messages:

| Column | Description |
|---|---|
| `__$start_lsn` | LSN of the transaction that made the change |
| `__$end_lsn` | Always NULL in SQL Server 2012+ |
| `__$seqval` | Sequence value within a transaction |
| `__$operation` | 1=delete, 2=insert, 3=update_before, 4=update_after |
| `__$update_mask` | Bitmask of changed columns |
| `__$command_id` | Command ordering within a transaction |

---

## CDC Retention

By default, SQL Server retains CDC changes for **3 days** (4320 minutes). The
cleanup Agent job runs every 5 minutes and removes rows older than the
retention window.

Check and modify retention:

```sql
-- Check current retention (in minutes)
EXEC sys.sp_cdc_help_jobs;

-- Change retention to 7 days (10080 minutes)
EXEC sys.sp_cdc_change_job
  @job_type      = N'cleanup',
  @retention     = 10080;
```

If the pipeline is offline for longer than the retention window, some changes
may be missing when it resumes. The connector will resume from the checkpoint
LSN — changes between the checkpoint LSN and the earliest available LSN in the
change table will be silently lost (they have been purged). Monitor the gap
between `checkpoint_lsn` and `sys.fn_cdc_get_min_lsn()` in production.

---

## Azure SQL Database Specifics

> **Note:** The behavior of Azure SQL Database CDC (Agent requirements, retention limits, supported auth methods) is external Azure platform documentation and is not verified against the connector source. The information below is provided as general guidance; consult the [Microsoft Azure SQL Database CDC documentation](https://learn.microsoft.com/en-us/sql/relational-databases/track-changes/enable-and-disable-change-data-capture-sql-server) for authoritative details.

The `sys.sp_cdc_enable_db` and `sys.sp_cdc_enable_table` stored procedures are the same as on-premises. Use the standard `connection_string` format with `encrypt=true` for Azure:

```yaml
connection_string: "sqlserver://connect_user@myserver.database.windows.net?database=MyDatabase&encrypt=true"
```

For managed identity or Azure AD authentication, refer to the [go-mssqldb driver documentation](https://github.com/microsoft/go-mssqldb) for supported `fedauth` parameter values and connection string formats — these are not verified against the connector source and may change with driver versions.

---

## Azure SQL Managed Instance

Azure SQL Managed Instance includes a SQL Server Agent that you manage. Ensure the Agent is running and the capture job is active. The setup procedure is identical to on-premises SQL Server — use `EXEC sys.sp_cdc_help_jobs` to verify job status.

---

## Useful Diagnostic Queries

```sql
-- Check CDC is enabled on the database
SELECT is_cdc_enabled FROM sys.databases WHERE name = DB_NAME();

-- List all capture instances and their LSN range
SELECT
  ct.capture_instance,
  ct.source_schema,
  ct.source_table,
  ct.start_lsn,
  sys.fn_cdc_map_lsn_to_time(ct.start_lsn) AS start_time,
  sys.fn_cdc_get_max_lsn()                  AS current_max_lsn,
  sys.fn_cdc_map_lsn_to_time(sys.fn_cdc_get_max_lsn()) AS current_time
FROM cdc.change_tables ct;

-- Count pending changes in a capture instance
SELECT COUNT(*) AS pending_changes
FROM cdc.dbo_orders_CT
WHERE __$start_lsn > <checkpoint_lsn>;

-- Check CDC Agent jobs (prefer sp_cdc_help_jobs; job naming varies by SQL Server version)
EXEC sys.sp_cdc_help_jobs;
-- Fallback general listing (illustrative):
-- SELECT name, enabled FROM msdb.dbo.sysjobs WHERE name LIKE 'cdc.%';

-- Check the built-in checkpoint cache
SELECT cache_key, cache_val FROM rpcn.CdcCheckpointCache;
```
