---
name: connect-cdc-mysql
description: >-
  Streams change data capture (CDC) from MySQL or MariaDB into Redpanda/Kafka
  using the mysql_cdc input in Redpanda Connect. Covers binlog (row) replication,
  initial snapshots, checkpoint caching, and operational tuning. Use when:
  capturing inserts/updates/deletes from MySQL or MariaDB into Redpanda or Kafka
  via Redpanda Connect's mysql_cdc input; configuring binlog replication; setting
  up snapshots with stream_snapshot; wiring a checkpoint_cache resource; tuning
  checkpoint_limit or max_parallel_snapshot_tables; using AWS RDS/Aurora with IAM
  auth; routing per-table CDC events to different Kafka topics; debugging a MySQL
  CDC pipeline that stalls, skips, or fails to resume after restart; understanding
  binlog_position metadata; distinguishing mysql vs mariadb flavor; landing CDC
  changes into Iceberg Topics (redpanda.iceberg.mode/delete/partition.spec/
  target.lag.ms/invalid.record.action) or Tiered Storage (redpanda.remote.write/
  read, cloud_storage_enabled) for a lakehouse; enabling server-side Schema ID
  Validation on CDC topics; applying a Redpanda Connect enterprise license
  (--redpanda-license, REDPANDA_LICENSE); using secrets management for the DSN
  password or FIPS-compliant Connect. mysql_cdc is an Enterprise connector and
  several destination features (Iceberg, Tiered Storage, Schema ID Validation)
  require a Redpanda Enterprise license.
---

# Redpanda Connect CDC: MySQL

The `mysql_cdc` input in Redpanda Connect captures row-level changes from MySQL and MariaDB databases using binlog replication and streams them as structured messages into Redpanda or any Kafka-compatible cluster. It is an **Enterprise feature** (requires a Redpanda Enterprise license) introduced in version **4.45.0**.

The connector operates in two phases: an optional **snapshot** (bulk-reads existing rows as `read` operations using consistent transactions under a table-scoped `FLUSH TABLES <tables> WITH READ LOCK` — only the configured tables are locked, not the whole server) followed by **continuous binlog streaming** (receives `insert`, `update`, and `delete` events via the MySQL canal replication protocol). Checkpoints are stored in a user-supplied cache resource so the pipeline can resume from the exact binlog position after a restart.

## Quickstart

### 1. Prepare MySQL (run as root / DBA)

```sql
-- 1. Verify binlog is enabled and in ROW format
SHOW VARIABLES LIKE 'log_bin';          -- must be ON
SHOW VARIABLES LIKE 'binlog_format';    -- must be ROW

-- 2. Create a replication user
CREATE USER 'cdc_user'@'%' IDENTIFIED BY 'StrongPassword123!';
GRANT REPLICATION SLAVE  ON *.* TO 'cdc_user'@'%';
GRANT REPLICATION CLIENT ON *.* TO 'cdc_user'@'%';
GRANT SELECT             ON mydb.* TO 'cdc_user'@'%';
GRANT LOCK TABLES        ON mydb.* TO 'cdc_user'@'%';  -- required for snapshot (FLUSH TABLES ... WITH READ LOCK)
FLUSH PRIVILEGES;
```

### 2. Write the Connect pipeline YAML

```yaml
# mysql-cdc-pipeline.yaml
cache_resources:
  - label: binlog_cache
    file:
      directory: /var/lib/connect/checkpoints

input:
  label: mysql_source
  mysql_cdc:
    flavor: mysql                             # or mariadb
    dsn: cdc_user:StrongPassword123!@tcp(localhost:3306)/mydb
    tables:
      - orders
      - customers
    stream_snapshot: true                     # bulk-read existing rows first
    snapshot_max_batch_size: 1000
    max_parallel_snapshot_tables: 2
    checkpoint_cache: binlog_cache            # REQUIRED — must match a cache_resources label
    checkpoint_key: mysql_binlog_position     # default key; change if sharing a cache
    checkpoint_limit: 1024
    max_reconnect_attempts: 10
    batching:
      count: 100
      period: 1s

pipeline:
  processors:
    - mapping: |
        # Route each event to a topic named after the source table
        meta topic = "cdc." + meta("table")

output:
  label: redpanda_out
  kafka_franz:
    seed_brokers:
      - localhost:9092
    topic: ${! meta("topic") }
    compression: snappy
```

### 3. Run the pipeline

```bash
# Validate config first
rpk connect lint mysql-cdc-pipeline.yaml

# Run
rpk connect run mysql-cdc-pipeline.yaml
```

### 4. Verify events are flowing

```bash
# Consume from one of the output topics
rpk topic consume cdc.orders --brokers localhost:9092 --offset start --num 5

# Trigger a test change in MySQL
mysql -u root mydb -e "INSERT INTO orders (id, amount) VALUES (9999, 42.00);"
```

## How binlog replication works

The connector uses the [go-mysql canal](https://github.com/go-mysql-org/go-mysql) library to establish a replication connection. Connect registers itself as a MySQL replica with a fake server ID. MySQL pushes binlog events (row changes) to the connector in real time. The connector checkpoints the `binlog_position` (filename + offset) to the configured cache after each batch is acknowledged by the output.

On restart:
1. Connect reads the last `binlog_position` from the cache.
2. If found, it resumes binlog streaming from that position (no snapshot).
3. If not found and `stream_snapshot: true`, it performs a fresh snapshot then streams from the snapshot's start position.
4. If not found and `stream_snapshot: false`, it starts from the current (live) binlog position — skipping all historical data.

## Message format

Each message body is a JSON object (or structured value) with one key per table column. Column values are Go-native types determined by the MySQL type — see [Type Mapping](references/config-reference.md#type-mapping) for the full table.

**Metadata fields set on every message:**

| Metadata key | Value |
|---|---|
| `operation` | `read` (snapshot), `insert`, `update`, or `delete` |
| `table` | Name of the source table (e.g. `orders`) |
| `binlog_position` | Binlog filename and offset in `filename@XXXXXXXX` format — **only set for CDC messages, not snapshot** |
| `schema` | Table schema in Benthos common schema format (compatible with `parquet_encode`) |

Example snapshot message body:
```json
{"id": 1, "amount": 99.95, "status": "shipped", "created_at": "2024-01-15T10:30:00Z"}
```
With metadata: `operation=read`, `table=orders`, no `binlog_position`.

Example CDC insert message:
```json
{"id": 2, "amount": 25.00, "status": "pending", "created_at": "2024-05-30T08:00:00Z"}
```
With metadata: `operation=insert`, `table=orders`, `binlog_position=mysql-bin.000003@00A3F2B1`.

## Cache resource requirement

`checkpoint_cache` is **required** and must reference a named `cache_resources` entry in the same config. The connector will fail to start if the cache label does not exist. Any cache backend works (file, redis, memory — but memory does not survive restarts):

```yaml
cache_resources:
  # Persistent on disk — recommended for production
  - label: binlog_cache
    file:
      directory: /var/lib/connect/checkpoints

  # Redis — recommended when running multiple Connect replicas
  - label: binlog_cache
    redis:
      url: redis://localhost:6379
```

## Bloblang per-table routing

Use the `table` metadata to route changes from different tables to different Redpanda topics:

```yaml
pipeline:
  processors:
    - mapping: |
        meta topic = "cdc." + meta("table")
        # Optionally filter out delete events
        root = if meta("operation") == "delete" { deleted() }
```

## AWS RDS / Aurora (IAM auth)

```yaml
input:
  mysql_cdc:
    flavor: mysql
    dsn: cdc_user@tcp(mydb.abc123.us-east-1.rds.amazonaws.com:3306)/mydb
    tables: [orders]
    stream_snapshot: false
    checkpoint_cache: binlog_cache
    aws:
      enabled: true
      endpoint: mydb.abc123.us-east-1.rds.amazonaws.com
      region: us-east-1          # optional; uses env default if omitted
    max_reconnect_attempts: 3    # keep low so IAM tokens refresh quickly
```

For RDS, binary logging is enabled by setting the automated backup retention period to 1+ days (console or CLI). Then set `binlog_format = ROW`, `binlog_row_image = FULL`, and `log_bin_trust_function_creators = 1` in the DB parameter group, and reboot the instance to apply. See [MySQL Setup](references/setup-mysql.md#5-aws-rds--aurora-mysql) for the full procedure.

## MariaDB

```yaml
input:
  mysql_cdc:
    flavor: mariadb               # required — changes the replication protocol
    dsn: cdc_user:pass@tcp(mariadb-host:3306)/mydb
    tables: [events]
    stream_snapshot: true
    checkpoint_cache: binlog_cache
```

MariaDB uses a slightly different binlog format and GTID scheme. Set `flavor: mariadb` explicitly. All other fields are identical to MySQL.

## Enterprise features (licensing + lakehouse destinations)

`mysql_cdc` is a Redpanda Connect **Enterprise connector** — it calls
`license.CheckRunningEnterprise` at startup and is blocked after the 30-day trial
without a valid license. Apply a license with `--redpanda-license`, the
`REDPANDA_LICENSE` / `REDPANDA_LICENSE_FILEPATH` env vars, or the default file
`/etc/redpanda/redpanda.license`.

The highest-value CDC pattern is landing change streams into **Iceberg Topics** so the
data is queryable as a lakehouse table (Snowflake/Databricks/Spark/Trino) with no
separate ETL. Set `iceberg_enabled=true` at the cluster level, enable Tiered Storage on
the CDC topic (`redpanda.remote.write=true`), then set `redpanda.iceberg.mode` on the
topic (`key_value` for raw CDC JSON, `value_schema_id_prefix`/`value_schema_latest` for
schema-structured tables). Tune with `redpanda.iceberg.partition.spec`,
`redpanda.iceberg.target.lag.ms`, `redpanda.iceberg.delete`, and
`redpanda.iceberg.invalid.record.action` (DLQ table `<topic>~dlq`).

```bash
# CDC topic that also lands changes in an Iceberg lakehouse table
rpk cluster config set iceberg_enabled true
rpk cluster config set cloud_storage_enabled true
rpk topic create cdc.orders \
  -c redpanda.remote.write=true \
  -c redpanda.iceberg.mode=key_value
```

Other relevant enterprise differentiators: **Tiered Storage** for long CDC retention,
**Server-side Schema ID Validation** (`enable_schema_id_validation`,
`redpanda.value.schema.id.validation`) for schema-encoded events, Connect **secrets
management** (`${secrets.NAME}`) to keep the DSN password out of config, and
**FIPS**-compliant Connect. All of these require a Redpanda Enterprise license — see the
reference below for exact nested keys and license-expiration behavior.

## Reference Directory

- [Enterprise Features](references/enterprise-features.md): Enterprise differentiators relevant to MySQL CDC into Redpanda — Connect license application (`--redpanda-license`, `REDPANDA_LICENSE`), Iceberg Topics (`redpanda.iceberg.mode/delete/target.lag.ms/partition.spec/invalid.record.action`, `iceberg_enabled`), Tiered Storage (`redpanda.remote.write/read`, `cloud_storage_enabled`), Server-side Schema ID Validation, secrets management, and FIPS. Includes which features need a license and expiration behavior.
- [Config Reference](references/config-reference.md): Every `mysql_cdc` config field with type, default, required flag, and description — grounded in `input_mysql_stream.go` and `mysql_cdc.adoc`. Includes the full MySQL-to-Go type mapping table.
- [MySQL Setup](references/setup-mysql.md): Step-by-step preparation of MySQL and MariaDB for CDC — binlog configuration, replication user privileges, RDS/Aurora specifics, GTID notes, and server_id.
- [Pipeline and Output](references/pipeline-and-output.md): Full runnable pipeline examples (including the cache resource), message/metadata shape, per-table routing with Bloblang, snapshot + stream behavior, and restart/checkpoint semantics.
