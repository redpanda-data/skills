---
name: connect-cdc-sqlserver
description: >-
  Stream change data capture from Microsoft SQL Server into Redpanda or Kafka
  using the Redpanda Connect `microsoft_sql_server_cdc` input — CDC capture
  instances, LSN-based change tables, initial snapshots, and LSN checkpointing.
  Covers every config field (connection_string, include/exclude regexp filters,
  stream_snapshot, max_parallel_snapshot_tables, snapshot_max_batch_size,
  checkpoint_cache, checkpoint_cache_table_name, checkpoint_cache_connection_string,
  checkpoint_cache_key, checkpoint_limit, stream_backoff_interval, batching),
  the emitted metadata fields (database_schema, schema, table, operation, lsn),
  operation types (read, insert, update_before, update_after, delete), the
  built-in SQL Server checkpoint cache (rpcn schema, auto-created table and
  stored procedure), and using an external Connect cache instead.
  Use when: capturing inserts/updates/deletes from Microsoft SQL Server into
  Redpanda or Kafka; enabling SQL Server CDC capture instances with
  sys.sp_cdc_enable_db and sys.sp_cdc_enable_table; configuring the
  microsoft_sql_server_cdc input in a Redpanda Connect pipeline; setting up
  an initial snapshot alongside live CDC streaming; tuning LSN checkpoint
  storage; routing per-table CDC events to separate Kafka topics; or
  troubleshooting a SQL Server CDC pipeline (LSN gaps, missing Agent jobs,
  permission errors, checkpoint failures).
  Also covers the Redpanda Enterprise features that pair with the destination:
  applying a Connect Enterprise license (REDPANDA_LICENSE, REDPANDA_LICENSE_FILEPATH,
  --redpanda-license, /etc/redpanda/redpanda.license), landing CDC events in a
  lakehouse via Iceberg Topics (iceberg_enabled, redpanda.iceberg.mode/delete/
  partition.spec/target.lag.ms/invalid.record.action), enforcing destination
  schema integrity with server-side Schema ID Validation (enable_schema_id_validation,
  redpanda.value.schema.id.validation, subject name strategy), and long-term
  retention via Tiered Storage (cloud_storage_enabled, redpanda.remote.write/read)
  and Cloud Topics (redpanda.cloud_topic.enabled). All of these require a valid
  Redpanda Enterprise license.
---

# Redpanda Connect CDC: Microsoft SQL Server

The `microsoft_sql_server_cdc` input in Redpanda Connect streams change events from Microsoft SQL Server's native CDC change tables directly into Redpanda or any Kafka-compatible output. It reads SQL Server's built-in change tables (`cdc.<schema>_<tablename>_CT`) using LSN (Log Sequence Number) ordering, optionally precedes streaming with a consistent point-in-time snapshot of existing rows, and durably checkpoints the last-delivered LSN so the pipeline can resume after a restart without re-consuming stale data.

This is an **Enterprise** component — it requires a valid Redpanda Enterprise license. The component name registered in Connect is `microsoft_sql_server_cdc`.

## Quickstart

**Step 1–3: Run the following T-SQL in SSMS or `sqlcmd` (as a sysadmin user):**

```sql
-- 1. Enable CDC on the database
USE MyDatabase;
EXEC sys.sp_cdc_enable_db;
GO

-- 2. Enable CDC on each table you want to capture
EXEC sys.sp_cdc_enable_table
  @source_schema = N'dbo',
  @source_name   = N'orders',
  @role_name     = NULL;
GO

EXEC sys.sp_cdc_enable_table
  @source_schema = N'dbo',
  @source_name   = N'customers',
  @role_name     = NULL;
GO

-- 3. Create the rpcn schema for the built-in checkpoint cache
--    and grant the Connect user rights to create objects in it
CREATE SCHEMA rpcn;
GO

GRANT CREATE TABLE TO connect_user;
GRANT CREATE PROCEDURE TO connect_user;
GRANT ALTER ON SCHEMA::rpcn TO connect_user;
GO
```

**Step 4: Run the pipeline from a shell:**

```bash
rpk connect run mssql-cdc.yaml
```

`mssql-cdc.yaml` (copy-pasteable):

```yaml
input:
  microsoft_sql_server_cdc:
    connection_string: "sqlserver://connect_user:secret@sqlserver-host/MyDatabase?database=MyDatabase"
    stream_snapshot: true          # snapshot existing rows before streaming changes
    max_parallel_snapshot_tables: 2
    snapshot_max_batch_size: 1000
    include:
      - "^dbo\\.orders$"      # anchored for exact match — unanchored also matches dbo.orders_archive
      - "^dbo\\.customers$"
    # Built-in checkpoint cache: auto-creates rpcn.CdcCheckpointCache table
    checkpoint_cache_table_name: rpcn.CdcCheckpointCache
    checkpoint_limit: 1024
    stream_backoff_interval: 5s
    batching:
      count: 100
      period: 1s

output:
  kafka_franz:
    seed_brokers:
      - localhost:9092
    topic: '${! meta("table") }'   # route each table to its own topic
    key: '${! json("id") }'        # key by primary key for correct ordering and log compaction
```

To route to a Redpanda Cloud cluster with SASL:

```yaml
output:
  kafka_franz:
    seed_brokers:
      - seed-abc123.cloud.redpanda.com:9092
    tls:
      enabled: true
    sasl:
      - mechanism: SCRAM-SHA-256
        username: my-user
        password: "${REDPANDA_PASSWORD}"
    topic: '${! "mssql." + meta("database_schema") + "." + meta("table") }'
```

## Prerequisites

Before starting the pipeline:

1. **SQL Server CDC enabled at database level** — `sys.sp_cdc_enable_db` must have been run on the source database.
2. **SQL Server Agent running** — CDC uses Agent jobs to scan the transaction log and populate change tables. Without it, change tables stay empty.
3. **Capture instance per table** — `sys.sp_cdc_enable_table` creates a change table (`cdc.<schema>_<tablename>_CT`) for each table. Only tables with a capture instance emit changes.
4. **Table has a primary key** — the snapshot phase issues keyset-pagination queries; tables without a primary key cannot be snapshotted and will error at connect time.
5. **Connect user permissions** — the user in `connection_string` needs `SELECT` on the source tables and the CDC change tables. For the built-in checkpoint cache it also needs `CREATE TABLE` and `CREATE PROCEDURE` rights on the target schema, and that schema (`rpcn` by default) must already exist.

See [setup-sqlserver.md](references/setup-sqlserver.md) for the complete T-SQL setup walkthrough.

## Config Fields

All fields are under `input.microsoft_sql_server_cdc`.

| Field | Type | Default | Required | Description |
|---|---|---|---|---|
| `connection_string` | string | — | yes | ADO.NET / go-mssqldb DSN. Format: `sqlserver://user:pass@host/instance?database=DB` |
| `stream_snapshot` | bool | `false` | no | When `true`, snapshot all existing rows before streaming changes |
| `max_parallel_snapshot_tables` | int | `1` | no | Number of tables snapshotted concurrently |
| `snapshot_max_batch_size` | int | `1000` | no | Max rows per batch during snapshot |
| `include` | array of strings | — | yes | **Unanchored** regular expressions matched against `schema.tablename`. Use `^...$` to match exactly one table (e.g. `^dbo\.orders$`); without anchors, `dbo\.orders` also matches `dbo.orders_archive`. |
| `exclude` | array of strings | — | no | **Unanchored** regular expressions for tables to exclude. Applied after `include`. |
| `checkpoint_cache` | string | — | no | Name of a Connect cache resource to store the LSN checkpoint. If omitted, the built-in SQL Server cache is used |
| `checkpoint_cache_table_name` | string | `rpcn.CdcCheckpointCache` | no | Table for the built-in SQL Server checkpoint cache (schema.table format) |
| `checkpoint_cache_connection_string` | string | — | no | Optional separate DSN for the checkpoint cache table (useful when writing checkpoints to a read replica or separate DB) |
| `checkpoint_cache_key` | string | `microsoft_sql_server_cdc` | no | Cache key used only with an **external** `checkpoint_cache` resource. Ignored by the built-in SQL Server cache (which always uses the fixed key `max_lsn`). |
| `checkpoint_limit` | int | `1024` | no | Max in-flight messages. Higher values allow more output parallelism; LSN is not committed until all messages under it are acked |
| `stream_backoff_interval` | duration | `5s` | no | How long to wait between change-table polls when no new data is found |
| `auto_replay_nacks` | bool | `true` | no | Automatically replay rejected messages. Set `false` to drop nacked messages and improve memory efficiency on high-throughput pipelines |
| `batching` | object | — | no | Batching policy: `count`, `byte_size`, `period`, `check`, `processors`. If all fields are zero/unset (a no-op policy), the input defaults to `count: 1` (one message per batch). Set `count` or `period` to actually batch. |

See [config-reference.md](references/config-reference.md) for full per-field detail including validation rules for `checkpoint_cache_table_name`.

## Emitted Message Shape

Each message body is a JSON object containing the changed row's column values. System columns (`__$start_lsn`, `__$operation`, etc.) are stripped; only user-defined columns are present.

```json
{
  "id": 42,
  "customer_name": "Acme Corp",
  "amount": "199.99",
  "created_at": "2024-03-15T10:30:00Z"
}
```

Metadata fields set on change messages:

| Metadata key | Value | Present on |
|---|---|---|
| `database_schema` | SQL Server schema of the source table (e.g. `dbo`) | all messages |
| `schema` | Table schema in Benthos common schema format (compatible with `parquet_encode`) | all messages |
| `table` | Table name (e.g. `orders`) | all messages |
| `operation` | One of: `read`, `insert`, `update_before`, `update_after`, `delete` | all messages |
| `lsn` | Raw varbinary(10) LSN bytes (set via `string(m.LSN)`) — binary, not a printable hex string | streamed changes only (insert/update/delete); **absent on snapshot `read` rows** |

The `lsn` metadata is the raw binary representation of the SQL Server LSN, not the `0x…` hex form you see in log output (which uses `.String()`). To use it in a Bloblang expression or Kafka header as a readable value, hex-encode it first, for example:

```yaml
pipeline:
  processors:
    - mutation: |
        root = this
        root._lsn_hex = meta("lsn").encode("hex")
```

Snapshot (`operation: read`) rows have **no `lsn` metadata key** — they are built with `LSN: nil` in the snapshot phase and are not individually checkpointed.

### Operation Types

| Value | When emitted |
|---|---|
| `read` | Initial snapshot rows (only when `stream_snapshot: true`) |
| `insert` | A new row was inserted |
| `delete` | A row was deleted |
| `update_before` | The row state before an update |
| `update_after` | The row state after an update |

Updates produce **two** consecutive messages: `update_before` followed by `update_after` with the same LSN. Use a Bloblang processor or filter to keep only one if needed.

## Snapshot Behaviour

When `stream_snapshot: true` and no prior LSN checkpoint exists, the pipeline:

1. Captures the current max LSN via `sys.fn_cdc_get_max_lsn()`.
2. Snapshots each included table in parallel (up to `max_parallel_snapshot_tables`) using `SNAPSHOT` isolation transactions and keyset pagination.
3. Emits all existing rows with `operation: read`.
4. Stores the captured LSN as the checkpoint.
5. Begins streaming from that LSN in the change tables.

If a checkpoint already exists (restart), the snapshot phase is skipped regardless of `stream_snapshot`.

## Checkpointing

By default, the pipeline auto-creates a stored procedure and then a table under the `rpcn` schema in the source database (in this order):

1. Stored procedure: `rpcn.CdcCheckpointCacheUpdate` (upsert, created first via `CREATE OR ALTER PROCEDURE`)
2. Table: `rpcn.CdcCheckpointCache` (columns: `cache_key varchar(7)`, `cache_val varchar(100)`, created if absent)

The `rpcn` schema **must already exist** before starting the pipeline — the pipeline creates the table and procedure but not the schema. Grant the Connect user `CREATE TABLE` and `CREATE PROCEDURE` on this schema.

To use an external Connect cache resource instead:

```yaml
cache_resources:
  - label: my_redis_cache
    redis:
      url: redis://localhost:6379

input:
  microsoft_sql_server_cdc:
    connection_string: "sqlserver://user:pass@host/MyDB"
    checkpoint_cache: my_redis_cache
    checkpoint_cache_key: mssql_orders_cdc
    include:
      - "dbo\\.orders"
```

## Column Type Mapping

The connector has **two distinct code paths** with different type handling: the snapshot mapper (`snapshot.go prepSnapshotScannerAndMappers`) and the stream mapper (`stream.go mapScannedValue`). The types below reflect what is emitted into the message body; the `schema` metadata uses Benthos common schema type names independent of the path.

### Snapshot path (operation: read)

| SQL Server type | Emitted body value |
|---|---|
| `DECIMAL`, `NUMERIC` | canonical decimal string with the column's precision/scale (e.g. `"199.990"`); raw text if precision is unknown |
| `MONEY`, `SMALLMONEY` | canonical decimal string |
| `DATE`, `TIME`, `DATETIME`, `DATETIME2`, `SMALLDATETIME`, `DATETIMEOFFSET` | `time.Time` (marshals as RFC3339 in JSON) |
| `TINYINT`, `SMALLINT`, `MEDIUMINT`, `INT`, `BIGINT`, `YEAR` | Go `int` (JSON number) |
| `FLOAT`, `DOUBLE` | `float64` (JSON number) |
| `BINARY`, `VARBINARY`, `VARBINARY(MAX)`, `IMAGE` | `[]byte` (base64 in JSON) |
| `JSON` | parsed JSON value (the string is `json.Unmarshal`-ed into the body) |
| All other types — including `BIT`, `REAL`, `CHAR`, `VARCHAR`, `NVARCHAR`, `UNIQUEIDENTIFIER`, `XML`, etc. | `string` (fall-through to `sql.Null[string]`) |

### Stream path (operation: insert / update_before / update_after / delete)

The stream mapper only special-cases decimal/money types; all other values come directly from the go-mssqldb driver:

| SQL Server type | Emitted body value |
|---|---|
| `DECIMAL`, `NUMERIC`, `MONEY`, `SMALLMONEY` | canonical decimal string |
| `BIT` | driver-native value (typically `bool`) |
| `TINYINT`, `SMALLINT`, `INT`, `BIGINT` | driver-native integer |
| `FLOAT`, `REAL` | driver-native float |
| `DATETIME`, `DATETIME2`, etc. | driver-native `time.Time` |
| `BINARY`, `VARBINARY`, etc. | `[]byte` (base64 in JSON) |
| `CHAR`, `VARCHAR`, `NVARCHAR`, `UNIQUEIDENTIFIER`, `XML`, etc. | `string` |

> The snapshot and stream paths use different mappers, so the emitted type for a given column may differ between an initial snapshot row and a subsequent CDC change event. Treat downstream consumers for non-decimal types defensively (accept both string and native forms).

## Per-Table Topic Routing

Use Bloblang in the output `topic` field or a `switch` processor:

```yaml
output:
  kafka_franz:
    seed_brokers:
      - localhost:9092
    topic: '${! "sqlserver." + meta("database_schema") + "." + meta("table") }'
```

Or use a `switch` output for explicit routing:

```yaml
output:
  switch:
    cases:
      - check: 'meta("table") == "orders"'
        output:
          kafka_franz:
            seed_brokers: [localhost:9092]
            topic: orders-cdc
      - check: 'meta("table") == "customers"'
        output:
          kafka_franz:
            seed_brokers: [localhost:9092]
            topic: customers-cdc
```

## License

`microsoft_sql_server_cdc` is an Enterprise-licensed Redpanda Connect connector. Attempting to run without a license produces an error at startup; after the 30-day evaluation period, enterprise connectors are blocked unless you upgrade.

Apply the Connect license in any of these ways (grounded in `connect/internal/cli/flags_redpanda.go` and `connect/internal/license/service.go`):

- `--redpanda-license <string>` flag on `rpk connect run` / `rpk connect dry-run` (takes precedence).
- `REDPANDA_LICENSE` env var (inline license string).
- `REDPANDA_LICENSE_FILEPATH` env var (path to a license file).
- Default file `/etc/redpanda/redpanda.license` (auto-applied if present and none of the above are set).

This license authorizes the **connector**. The Redpanda **cluster** you write into needs its own valid license to use destination-side enterprise features (Iceberg, Schema ID Validation, Tiered Storage, Cloud Topics).

## Destination Enterprise Features

When the CDC pipeline writes into Redpanda, these Enterprise (cluster-licensed) features pair directly with it. Full nested keys are in [enterprise-features.md](references/enterprise-features.md).

- **Iceberg Topics** (lakehouse landing of CDC events): cluster `iceberg_enabled`; per-topic `redpanda.iceberg.mode` (`key_value` / `value_schema_id_prefix` / `value_schema_latest` / `disabled`), `redpanda.iceberg.delete`, `redpanda.iceberg.partition.spec`, `redpanda.iceberg.target.lag.ms`, `redpanda.iceberg.invalid.record.action` (`drop` / `dlq_table`). Requires Tiered Storage.
- **Server-side Schema ID Validation** (reject unregistered schema IDs on destination topics): cluster `enable_schema_id_validation` (`none` / `redpanda` / `compat`); per-topic `redpanda.value.schema.id.validation`, `redpanda.value.subject.name.strategy`, and the key equivalents.
- **Tiered Storage** (long retention of CDC topics; prerequisite for Iceberg): cluster `cloud_storage_enabled`; per-topic `redpanda.remote.write`, `redpanda.remote.read`, `redpanda.remote.delete`.
- **Cloud Topics** (object-storage-native topics): per-topic `redpanda.cloud_topic.enabled` / `redpanda.storage.mode`.

## Reference Directory

- [config-reference.md](references/config-reference.md): Complete field-by-field reference for every `microsoft_sql_server_cdc` config option, types, defaults, validation rules, and the checkpoint cache internals.
- [setup-sqlserver.md](references/setup-sqlserver.md): T-SQL walkthrough for enabling SQL Server CDC — `sys.sp_cdc_enable_db`, `sys.sp_cdc_enable_table`, SQL Server Agent requirements, capture instance naming, permissions, and Azure SQL specifics.
- [pipeline-and-output.md](references/pipeline-and-output.md): Full runnable pipelines, metadata shape and routing, snapshot-then-stream lifecycle, checkpointing semantics, and restart behaviour.
- [enterprise-features.md](references/enterprise-features.md): Redpanda Enterprise features for CDC pipelines — Connect license application (flag, env vars, default file path), Iceberg Topics (`iceberg_enabled` + all `redpanda.iceberg.*` topic keys and modes), server-side Schema ID Validation (`enable_schema_id_validation` + per-topic validation/subject-name-strategy keys), Tiered Storage (`cloud_storage_enabled`, `redpanda.remote.*`), Cloud Topics (`redpanda.cloud_topic.enabled`), and license-expiration behavior. Notes which keys require an Enterprise license.
