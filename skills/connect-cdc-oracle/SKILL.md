---
name: connect-cdc-oracle
description: >-
  Streams change data capture from Oracle Database into Redpanda or Kafka using the
  oracledb_cdc input in Redpanda Connect, which reads redo logs via LogMiner. Use when
  configuring oracledb_cdc, enabling ARCHIVELOG mode and supplemental logging,
  granting LogMiner privileges, tuning SCN checkpointing, capturing LOBs, monitoring a
  pluggable database (CDB/PDB), or choosing a snapshot_mode. Also covers Redpanda
  Enterprise destination features such as Iceberg Topics, Tiered Storage, and
  server-side Schema ID Validation, all of which require a Redpanda Enterprise
  license.
---

# Redpanda Connect CDC: Oracle

The `oracledb_cdc` input in Redpanda Connect streams inserts, updates, and deletes from an Oracle database into Redpanda or any Kafka-compatible cluster using Oracle LogMiner. It can optionally snapshot all existing rows before streaming live changes. This is an Enterprise feature (Redpanda Community License) and requires Connect version 4.83.0 or later.

LogMiner reads Oracle's redo logs via the `V$LOGMNR_CONTENTS` view using the `online_catalog` strategy. The connector tracks progress with a System Change Number (SCN) stored either in a built-in Oracle checkpoint table (default) or in an external cache resource such as Redis or Memcached.

## Quickstart

### 1. Prepare Oracle (four SQL commands)

```sql
-- 1. Verify or enable ARCHIVELOG mode (requires SYSDBA, then restart DB)
SELECT LOG_MODE FROM V$DATABASE;
-- If not ARCHIVELOG: SHUTDOWN IMMEDIATE; STARTUP MOUNT; ALTER DATABASE ARCHIVELOG; ALTER DATABASE OPEN;

-- 2. Enable minimal supplemental logging database-wide
ALTER DATABASE ADD SUPPLEMENTAL LOG DATA;

-- 3. Enable ALL columns supplemental logging for each table to capture
ALTER TABLE MYSCHEMA.ORDERS ADD SUPPLEMENTAL LOG DATA (ALL) COLUMNS;
ALTER TABLE MYSCHEMA.PRODUCTS ADD SUPPLEMENTAL LOG DATA (ALL) COLUMNS;

-- 4. Create a replication user and grant LogMiner privileges
CREATE USER rpcn IDENTIFIED BY "SecurePassword1";
GRANT CREATE SESSION TO rpcn;
GRANT SELECT ANY TRANSACTION TO rpcn;
GRANT LOGMINING TO rpcn;                     -- Oracle 12c+
GRANT SELECT ON V_$DATABASE TO rpcn;
GRANT SELECT ON V_$LOG TO rpcn;
GRANT SELECT ON V_$LOGFILE TO rpcn;
GRANT SELECT ON V_$ARCHIVED_LOG TO rpcn;
GRANT SELECT ON V_$ARCHIVE_DEST_STATUS TO rpcn;
GRANT SELECT ON V_$LOGMNR_CONTENTS TO rpcn;
GRANT SELECT ON ALL_TABLES TO rpcn;
GRANT SELECT ON ALL_LOG_GROUPS TO rpcn;
GRANT SELECT ON ALL_TAB_COLUMNS TO rpcn;
GRANT SELECT ON ALL_CONSTRAINTS TO rpcn;   -- snapshot PK discovery
GRANT SELECT ON ALL_CONS_COLUMNS TO rpcn;  -- snapshot PK discovery
GRANT SELECT ON MYSCHEMA.ORDERS TO rpcn;
GRANT SELECT ON MYSCHEMA.PRODUCTS TO rpcn;
-- For the built-in checkpoint table (default, no checkpoint_cache configured):
GRANT CREATE TABLE TO rpcn;
GRANT CREATE PROCEDURE TO rpcn;
-- Note: the CREATE USER statement above already creates the RPCN schema.
-- In Oracle, a schema is the same as a user and is created implicitly by CREATE USER.
```

### 2. Minimal pipeline YAML

```yaml
# oracle-cdc.yaml
input:
  oracledb_cdc:
    connection_string: oracle://rpcn:SecurePassword1@oracle-host:1521/ORCL
    snapshot_mode: snapshot_and_stream   # snapshot existing rows, then stream (use snapshot_only for a one-time backfill)
    max_parallel_snapshot_tables: 2
    snapshot_max_batch_size: 1000
    include:
      - ^MYSCHEMA\.ORDERS$         # anchor with ^...$ to match exactly
      - ^MYSCHEMA\.PRODUCTS$
    logminer:
      scn_window_size: 20000       # default; tune up for high-volume
      backoff_interval: 5s
      mining_interval: 300ms
      strategy: online_catalog
      max_transaction_events: 0    # 0 = no limit
      lob_enabled: true
    checkpoint_limit: 1024

output:
  kafka_franz:
    seed_brokers:
      - redpanda-broker:9092
    topic: oracle-cdc-events
```

Run it:

```bash
rpk connect run oracle-cdc.yaml
```

### 3. Route each table to its own topic

```yaml
input:
  oracledb_cdc:
    connection_string: oracle://rpcn:SecurePassword1@oracle-host:1521/ORCL
    include:
      - ^MYSCHEMA\.ORDERS$
      - ^MYSCHEMA\.PRODUCTS$
    logminer:
      scn_window_size: 20000
      backoff_interval: 5s
      mining_interval: 300ms
      strategy: online_catalog
      lob_enabled: true

pipeline:
  processors:
    - mapping: |
        meta topic = meta("table_name").lowercase()

output:
  kafka_franz:
    seed_brokers:
      - redpanda-broker:9092
    topic: ${! meta("topic") }
```

### 4. Use an external Redis checkpoint cache

```yaml
cache_resources:
  - label: redis_scn_cache
    redis:
      url: redis://redis-host:6379

input:
  oracledb_cdc:
    connection_string: oracle://rpcn:SecurePassword1@oracle-host:1521/ORCL
    include:
      - ^MYSCHEMA\.ORDERS$
    logminer:
      scn_window_size: 20000
      backoff_interval: 5s
      mining_interval: 300ms
      strategy: online_catalog
      lob_enabled: true
    checkpoint_cache: redis_scn_cache
    checkpoint_cache_key: oracle-prod-scn
    checkpoint_limit: 1024

output:
  kafka_franz:
    seed_brokers:
      - redpanda-broker:9092
    topic: oracle-cdc-events
```

## Message Metadata Fields

Every message emitted by `oracledb_cdc` carries these metadata fields (access with `meta("field_name")` in Bloblang):

| Field | Description |
|---|---|
| `database_schema` | Oracle schema (owner) of the source table |
| `table_name` | Name of the source table |
| `operation` | `read` (snapshot), `insert`, `update`, or `delete` |
| `scn` | Oracle System Change Number for this event. On snapshot (`read`) messages this is Oracle's current SCN captured at the start of the snapshot — the same value for every snapshot row (since 4.98.0) |
| `checkpoint_scn` | Checkpoint low-watermark SCN for this event (CDC only; used internally to advance the checkpoint). Absent on snapshot (`read`) messages. |
| `transaction_id` | Oracle transaction ID in `USN.SLOT.SEQ` format; absent on snapshot (`read`) messages |
| `source_ts_ms` | Wall-clock time when Oracle wrote the change to redo log (ms since epoch); absent on snapshot messages |
| `commit_ts_ms` | Commit timestamp of the transaction (ms since epoch). On snapshot (`read`) messages this is Oracle's `SYSTIMESTAMP` captured when the snapshot SCN was taken — the same value for every snapshot row (since 4.99.0) |
| `schema` | Serialised table schema for use with `schema_registry_encode` processor; present when schema resolution succeeds |

## Performance and Scaling

Three constraints shape every `oracledb_cdc` deployment:

**Throughput is bounded by the LogMiner session, not by CPU.** Each pipeline mines the redo stream through a **single synchronous LogMiner reader**, so giving Redpanda Connect more cores does not raise the capture rate. To capture more aggregate change volume from one database, run **multiple pipelines whose `include` patterns cover disjoint sets of tables** — each pipeline gets its own LogMiner reader.

**Large transactions can look like a stall.** The Oracle driver fetches 25 rows per network round trip by default, so a large committed transaction can arrive minutes late while the database, network, and connector all look idle — each round trip is a full network exchange, and thousands of them are needed. Raise the fetch size with the `PREFETCH_ROWS` query parameter on `connection_string`:

```yaml
connection_string: oracle://user:pass@host:1521/service?PREFETCH_ROWS=1000
```

**Redo log retention must cover idle periods, not just outages.** The SCN checkpoint only advances when messages are delivered, so a monitored table set that goes quiet leaves the checkpoint stationary while Oracle ages out redo/archive logs. If the checkpointed SCN is gone when activity resumes or the pipeline restarts, the input cannot resume and fails repeatedly with **ORA-01292**. Therefore:

- Size archive log retention to exceed the longest plausible **idle** period for the monitored tables — not just the longest expected downtime.
- Alert on a **stagnant checkpoint SCN** and on repeated ORA errors; a stationary checkpoint under a quiet workload is indistinguishable from a healthy one until the logs age out.
- On databases with infrequent log switches, watch for **ORA-04036** (LogMiner PGA growth) and bound it with `logminer.max_session_age`.

## Enterprise License

`oracledb_cdc` is an enterprise connector licensed under the Redpanda Community License. You need a valid Redpanda Enterprise license. Without it the connector refuses to start with a license error ("all enterprise connectors are blocked"). Set your license via the environment variable or contact Redpanda for a 30-day trial key.

Several Redpanda Enterprise features apply to a CDC pipeline and to the destination cluster where the stream lands. Each requires a valid Enterprise license:

- **Iceberg Topics** — materialize CDC changes as Apache Iceberg tables. Enable with `iceberg_enabled` (cluster) and `redpanda.iceberg.mode` (topic). Use the `schema` metadata field with `schema_registry_encode` for structured (`value_schema_id_prefix`) tables.
- **Server-side Schema ID Validation** — have brokers reject records with unregistered schema IDs. Enable with `enable_schema_id_validation` (cluster) and `redpanda.value.schema.id.validation` (topic).
- **Tiered Storage** — retain CDC history in object storage. Enable with `cloud_storage_enabled` (cluster) and `redpanda.remote.write` / `redpanda.remote.read` (topic).
- **Connect enterprise capabilities** — secrets management (for the Oracle password / `wallet_password`), the `redpanda{}` config service block (logs/status to a topic), allow/deny lists, and FIPS-compliant `rpk connect`.

See [enterprise-features.md](references/enterprise-features.md) for every nested config key, mode value, and license-expiry behavior.

## Reference Directory

- [config-reference.md](references/config-reference.md): Complete field reference for every `oracledb_cdc` config option, grounded in source — types, defaults, constraints, and the nested `logminer{}` sub-block.
- [setup-oracle.md](references/setup-oracle.md): Preparing Oracle: ARCHIVELOG mode, supplemental logging, LogMiner grants, Oracle Wallet for SSL, and CDB/PDB (pluggable database) notes.
- [pipeline-and-output.md](references/pipeline-and-output.md): Full runnable pipelines, message/metadata shape, per-table topic routing, LOB handling, snapshot-then-stream behavior, checkpointing, and restart/resume semantics.
- [enterprise-features.md](references/enterprise-features.md): Redpanda Enterprise features relevant to a CDC pipeline and their nested config keys — Iceberg Topics (`redpanda.iceberg.mode`/`target.lag.ms`/`partition.spec`/`invalid.record.action`, `iceberg_enabled`), server-side Schema ID Validation (`enable_schema_id_validation`, `redpanda.{key,value}.schema.id.validation`), Tiered Storage (`cloud_storage_enabled`, `redpanda.remote.write`/`read`), and Connect enterprise capabilities (secrets, the `redpanda{}` config service block, allow/deny lists, FIPS). Includes license-expiry behavior for each.
