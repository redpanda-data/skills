---
name: connect-cdc-postgres
description: >-
  Streams change data capture (CDC) from PostgreSQL into Redpanda or Kafka using
  Redpanda Connect's postgres_cdc input — logical replication via the WAL
  (pgoutput), optional initial snapshot, replication slots, and publications.
  Use when: capturing inserts/updates/deletes from PostgreSQL into Redpanda or
  Kafka; configuring the postgres_cdc input (formerly pg_stream); setting up
  PostgreSQL logical replication (wal_level=logical); creating replication slots
  or publications; enabling stream_snapshot to back-fill existing rows before
  streaming changes; routing per-table CDC events to separate topics with
  Bloblang; using AWS IAM auth for RDS or Aurora PostgreSQL; tuning
  checkpoint_limit, heartbeat_interval, or max_parallel_snapshot_tables;
  understanding the lsn/operation/table/schema/commit_ts_ms/before message
  metadata emitted by the connector (before carries the pre-change row for
  updates/deletes, subject to REPLICA IDENTITY); troubleshooting slot growth or WAL accumulation; or asking about
  the Enterprise license requirement for this connector. Also covers the
  enterprise features that apply to the destination CDC topics: Iceberg Topics
  (redpanda.iceberg.mode/delete/partition.spec/target.lag.ms/invalid.record.action,
  iceberg_enabled) for landing CDC events in an Apache Iceberg lakehouse; Tiered
  Storage (redpanda.remote.read/write, retention.local.target.ms) for long-term
  CDC retention; and server-side Schema ID Validation
  (enable_schema_id_validation, redpanda.value.schema.id.validation) for
  governing CDC event schemas — all of which require a Redpanda Enterprise
  license.
---

# Redpanda Connect CDC: PostgreSQL

The `postgres_cdc` input in Redpanda Connect streams change data capture (CDC) from a PostgreSQL database into Redpanda or any Kafka-compatible topic. It uses PostgreSQL's logical replication protocol (`pgoutput` plugin), reads the Write-Ahead Log (WAL), and optionally snapshots all existing rows before switching to live replication. Introduced in version 4.39.0. The legacy name `pg_stream` is deprecated.

This is an **Enterprise feature** — a Redpanda Enterprise license is required. The connector creates and manages a logical replication slot and a publication automatically, but both can be pre-created manually.

## Quickstart

### 1. Prepare PostgreSQL (4 commands)

```sql
-- 1. Verify or set wal_level (requires server restart if changed)
ALTER SYSTEM SET wal_level = logical;
-- Check current value:
SHOW wal_level;   -- must return 'logical'

-- 2. Create a dedicated replication user
CREATE USER cdc_user WITH REPLICATION LOGIN PASSWORD 'secret';
GRANT CONNECT ON DATABASE mydb TO cdc_user;
GRANT SELECT ON TABLE public.orders, public.customers TO cdc_user;

-- 3. (Optional) Pre-create the publication to avoid needing CREATE PUBLICATION privilege
-- Connector uses the pattern: pglog_stream_<slot_name>
CREATE PUBLICATION pglog_stream_my_slot FOR TABLE public.orders, public.customers;

-- 4. (Optional) Pre-create the replication slot
SELECT pg_create_logical_replication_slot('my_slot', 'pgoutput');
```

### 2. Full pipeline YAML (snapshot + stream, two tables)

```yaml
# postgres-cdc-pipeline.yaml
input:
  label: "pg_cdc"
  postgres_cdc:
    dsn: postgres://cdc_user:secret@localhost:5432/mydb?sslmode=disable
    schema: public
    tables:
      - orders
      - customers
    slot_name: my_slot
    stream_snapshot: true        # back-fill existing rows first
    snapshot_batch_size: 5000   # rows per query during snapshot
    max_parallel_snapshot_tables: 2   # snapshot both tables simultaneously
    checkpoint_limit: 1024
    heartbeat_interval: 1h       # prevents slot lag on quiet tables
    include_transaction_markers: false
    batching:
      count: 100
      period: 1s

pipeline:
  processors:
    # Route each event to a topic named after the source table
    - mapping: |
        meta topic = "pg.cdc." + metadata("table")

output:
  kafka_franz:
    seed_brokers:
      - localhost:9092
    topic: ${! metadata("topic") }
    key: ${! json("id").string() }
```

> **Tip**: When writing to Redpanda, the native `redpanda` output is the idiomatic choice — it handles seed broker discovery and authentication more ergonomically than `kafka_franz`. `kafka_franz` is fully valid for both Redpanda and generic Kafka targets.

### 3. Run the pipeline

```bash
# Self-managed Redpanda Connect binary
redpanda-connect run postgres-cdc-pipeline.yaml

# Via rpk (if installed)
rpk connect run postgres-cdc-pipeline.yaml

# Docker
docker run --rm \
  -v $(pwd)/postgres-cdc-pipeline.yaml:/pipeline.yaml \
  docker.redpanda.com/redpandadata/connect:latest \
  run /pipeline.yaml
```

### 4. Inspect the emitted messages

Every message has these metadata fields (set via `metadata()` in Bloblang):

| Metadata key | Value |
|---|---|
| `table` | Table name (unquoted), e.g. `orders` |
| `operation` | `read`, `insert`, `update`, `delete`, `begin`, `commit` |
| `lsn` | WAL log sequence number string; not set (absent) for snapshot `read` rows |
| `commit_ts_ms` | Transaction commit timestamp (Unix milliseconds); set on `insert`/`update`/`delete`. Not set for snapshot `read` rows (since 4.98.0) |
| `before` | Pre-change row state for `update` and `delete`, in Benthos common schema format. For updates the contents depend on the table's `REPLICA IDENTITY`: the default identity carries only key columns, `REPLICA IDENTITY FULL` carries all columns (since 4.99.0) |
| `schema` | Column schema in Benthos common format; set on `read`, `insert`, `update`, `delete` messages. Use with `parquet_encode: { schema_metadata: schema }` |

Example payload for an `insert` into `orders`:

```json
{
  "id": 42,
  "customer_id": 7,
  "amount": 99.99,
  "status": "pending"
}
```

## Snapshot Behavior

When `stream_snapshot: true` the connector:
1. Creates a temporary replication slot and exports a snapshot (`EXPORT_SNAPSHOT`)
2. Opens reader transactions pinned to that snapshot and scans each table in key-order batches
3. Emits messages with `operation: read` (no `lsn` — LSN is `nil` for snapshot rows)
4. After all tables are fully scanned, copies the temporary slot into the permanent `slot_name` slot
5. Drops the temporary slot and begins streaming WAL changes from the LSN at snapshot time

Tables being snapshot **must have a primary key** — the connector uses the primary key to parallelize and paginate the scan.

## Operational Notes

- **Replication slot growth**: An unacknowledged replication slot blocks WAL reclamation. If the pipeline stops for a long time, disk can fill. Monitor `pg_replication_slots.confirmed_flush_lsn` and `pg_current_wal_lsn() - confirmed_flush_lsn`.
- **Heartbeats**: For tables with infrequent writes, the connector will not have LSNs to acknowledge, causing WAL accumulation. `heartbeat_interval` (default `1h`) writes a logical message periodically via `pg_logical_emit_message` to keep the LSN moving. Set to `0s` to disable.
- **TOAST columns**: For `UPDATE`/`DELETE` where `REPLICA IDENTITY` is not `FULL`, unchanged TOAST columns are not included in the WAL. Set `unchanged_toast_value` to a sentinel string to distinguish "unchanged" from "null".
- **Restarts**: On restart the connector reads `pg_replication_slots.confirmed_flush_lsn` and resumes from that LSN. Snapshot is skipped if the slot already exists.
- **Slot name validation**: `slot_name` must match `[A-Za-z0-9_]+` — alphanumeric and underscores only.
- **Publication naming**: The connector auto-creates (and manages) a publication named `pglog_stream_<slot_name>`. Pre-create it with exactly that name to avoid needing `CREATE PUBLICATION` privilege.

## Enterprise Features for CDC Sink Topics

`postgres_cdc` is itself a Redpanda Connect **Enterprise connector** (blocked after the 30-day trial without a license). Beyond the connector, the Redpanda topics that receive CDC events unlock additional **Enterprise** differentiators — each requires a valid license on the **cluster**:

- **Iceberg Topics**: land CDC events directly in an Apache Iceberg (v2) table in object storage — no separate ETL. Enable with cluster `iceberg_enabled=true` plus per-topic `redpanda.iceberg.mode` (`key_value`, `value_schema_id_prefix`, `value_schema_latest`, `disabled`), and tune `redpanda.iceberg.target.lag.ms`, `redpanda.iceberg.partition.spec`, `redpanda.iceberg.delete`, `redpanda.iceberg.invalid.record.action` (`drop`/`dlq_table`). Tiered Storage is a prerequisite.
- **Tiered Storage**: retain CDC topics long-term in object storage with `redpanda.remote.write`/`redpanda.remote.read` (cluster master switch `cloud_storage_enabled`) and `retention.local.target.ms`/`.bytes`.
- **Server-Side Schema ID Validation**: reject CDC events with unregistered schema IDs via cluster `enable_schema_id_validation` (`none`/`redpanda`/`compat`) and per-topic `redpanda.value.schema.id.validation` + `redpanda.value.subject.name.strategy` (applies when events are serialized in the Schema Registry wire format).
- **Connect secrets management**: resolve the DSN password / AWS keys from an external secret manager at runtime instead of embedding them.

See [enterprise-sink-features.md](references/enterprise-sink-features.md) for every nested config key, default, and license-expiration behavior.

## Reference Directory

- [config-reference.md](references/config-reference.md): Every `postgres_cdc` config field — type, default, required status, and description grounded in source.
- [setup-postgres.md](references/setup-postgres.md): Preparing PostgreSQL for logical replication: `wal_level`, server parameters, replication user, publications, slots, RDS/Aurora, and IAM auth.
- [pipeline-and-output.md](references/pipeline-and-output.md): Full runnable pipeline, message/metadata shape, per-table topic routing, snapshot-then-stream lifecycle, and checkpoint/restart semantics.
- [enterprise-sink-features.md](references/enterprise-sink-features.md): Enterprise features for the destination CDC topics — Iceberg Topics, Tiered Storage, Server-Side Schema ID Validation, and Connect secrets — with every nested config key (`redpanda.iceberg.*`, `iceberg_*`, `redpanda.remote.*`, `enable_schema_id_validation`, `redpanda.value.schema.id.validation`), defaults, and license-expiration behavior. All require a Redpanda Enterprise license.
