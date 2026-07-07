# Enterprise Features for MySQL CDC into Redpanda

The `mysql_cdc` input is itself a Redpanda **enterprise connector**, and the most
valuable CDC patterns land changes into Redpanda **enterprise destination features**
(Iceberg Topics, Tiered Storage). This reference documents the enterprise
differentiators relevant to a MySQL/MariaDB CDC pipeline, with their exact nested
config keys, grounded in the licensing docs and source under `/tmp/redpanda-skills-src`.

For the canonical list of all Redpanda enterprise features and license-expiration
behavior, see `get-started/licensing/overview.adoc`.

---

## 1. Redpanda Connect license (REQUIRED for `mysql_cdc`)

`mysql_cdc` calls `license.CheckRunningEnterprise` at startup. Without a valid
Enterprise Edition license, the connector is **blocked** after the 30-day trial.
All CDC inputs (`mysql_cdc`, `postgres_cdc`, `mongodb_cdc`, etc.) are enterprise
connectors — see the catalog filtered by `support=enterprise`.

Apply a license to Redpanda Connect in any of these ways (grounded in
`connect/internal/cli/flags_redpanda.go`):

| Method | Value |
|---|---|
| CLI flag | `--redpanda-license <license-string>` (inline string) |
| Env var (inline) | `REDPANDA_LICENSE` — the license content itself |
| Env var (path) | `REDPANDA_LICENSE_FILEPATH` — path to a license file |
| Default file path | `/etc/redpanda/redpanda.license` (applied automatically if present) |

```bash
# Inline flag
rpk connect run --redpanda-license "$(cat redpanda.license)" mysql-cdc-pipeline.yaml

# Env var
export REDPANDA_LICENSE_FILEPATH=/etc/redpanda/redpanda.license
rpk connect run mysql-cdc-pipeline.yaml
```

The same `--redpanda-license` flag exists on `rpk connect dry-run` and
`rpk connect agent run`. `rpk cluster license info` does **not** report Connect
license violations — it only covers the Redpanda broker cluster.

License precedence: inline `--redpanda-license` flag > `REDPANDA_LICENSE` >
`REDPANDA_LICENSE_FILEPATH` > default `/etc/redpanda/redpanda.license`.

---

## 2. Iceberg Topics — land CDC changes in a lakehouse (Enterprise)

The most common CDC destination differentiator: write each table's change stream
into an Apache Iceberg table so analysts query the data directly from Snowflake,
Databricks, Spark, Trino, etc. — no separate ETL. Requires an **Enterprise license**
**and** Tiered Storage enabled on the topic (Iceberg builds on Tiered Storage).

### Cluster-level config (set once)

| Property | Default | Purpose |
|---|---|---|
| `iceberg_enabled` | `false` | Master switch; must be `true`. Restart required when changed on a running cluster. |
| `iceberg_default_catalog_namespace` | `["redpanda"]` | Namespace for created tables. Use a distinct namespace per cluster sharing one REST catalog (e.g. AWS Glue). Immutable after enabling Iceberg. |
| `iceberg_target_lag_ms` | `60000` (1 min) | Cluster default commit window — Redpanda tries to commit produced data to Iceberg within this window. |
| `iceberg_invalid_record_action` | `dlq_table` | Cluster default for records that fail translation. Accepted values: `drop`, `dlq_table`. |

```bash
rpk cluster config set iceberg_enabled true
```

### Topic-level properties (per CDC topic)

Set these on the topics your CDC pipeline writes to (the topics produced by the
`kafka_franz`/`redpanda` output). Grounded in `manage/iceberg/*.adoc` and
`reference/properties/topic-properties.adoc`.

| Topic property | Values | Notes |
|---|---|---|
| `redpanda.iceberg.mode` | `key_value` \| `value_schema_id_prefix` \| `value_schema_latest` \| `disabled` (default) | Enables Iceberg for the topic. See modes below. |
| `redpanda.iceberg.delete` | `true` (default) \| `false` | If `false`, the Iceberg table survives topic deletion. Cluster default: `iceberg_delete`. |
| `redpanda.iceberg.target.lag.ms` | duration (ms) | Per-topic override of `iceberg_target_lag_ms`. |
| `redpanda.iceberg.invalid.record.action` | `dlq_table` (default) \| `drop` | Where invalid records go. Per-topic override of `iceberg_invalid_record_action`. |
| `redpanda.iceberg.partition.spec` | e.g. `(id)`, `(col1, col2)`, `(year(ts1), col1)` | Custom Iceberg partitioning for query performance. |

Iceberg modes:
- `key_value`: two-column table (record metadata incl. key, plus binary value). Good
  for raw CDC JSON bodies where you do not register a schema.
- `value_schema_id_prefix`: table columns mirror the registered schema; producers must
  write using the Schema Registry wire format (schema-id prefix on each record).
- `value_schema_latest`: table columns mirror the latest registered schema for the subject.
- `disabled` (default): no Iceberg table.

```bash
# CDC events as raw JSON → key_value mode (no schema needed)
rpk topic create cdc.orders \
  -c redpanda.remote.write=true \
  -c redpanda.iceberg.mode=key_value

# Structured columns matching a registered schema, custom partitioning
rpk topic create cdc.orders \
  -c redpanda.remote.write=true \
  -c redpanda.iceberg.mode=value_schema_id_prefix \
  -c "redpanda.iceberg.partition.spec=(year(created_at), status)" \
  -c redpanda.iceberg.target.lag.ms=300000
```

### DLQ table for failed translations

In `value_schema_id_prefix` / `value_schema_latest` modes, records that fail to
translate (e.g. body does not match the schema) are written to a DLQ Iceberg table
named `<topic-name>~dlq` (default `redpanda.iceberg.invalid.record.action=dlq_table`). The
DLQ table uses the `key_value` schema. Set the action to `drop` to discard invalid
records instead. The DLQ table follows the same `redpanda.iceberg.delete` persistence
rule as the main table.

CDC-specific note: `mysql_cdc` emits the **new row image** for updates and the deleted
row for deletes (no before-image). If you need DELETE semantics in the lakehouse (soft
deletes / tombstones), carry `meta("operation")` into the record body via a `mapping`
processor before the Iceberg topic, because Iceberg mode `value_schema_*` does not
interpret CDC operation semantics — it appends rows.

### Limitations

- Cannot append to an Iceberg table not created by Redpanda.
- Enabling Iceberg on an existing topic does **not** backfill historical data — combine
  with `stream_snapshot: true` so the connector's snapshot rows seed the table.
- JSON schemas require Redpanda 25.2+.

Upon license expiration: topics cannot be created or modified with `redpanda.iceberg.mode`.

---

## 3. Tiered Storage — long retention of CDC streams (Enterprise)

CDC streams are often retained far longer than local disk allows, and Tiered Storage
is a **prerequisite for Iceberg Topics**. Requires an Enterprise license.

### Cluster-level config

| Property | Default | Purpose |
|---|---|---|
| `cloud_storage_enabled` | `false` | Master switch for Tiered Storage. |
| `cloud_storage_enable_remote_write` | — | Default for new topics' `redpanda.remote.write`. |
| `cloud_storage_enable_remote_read` | — | Default for new topics' `redpanda.remote.read`. |

### Topic-level properties (on CDC topics)

| Topic property | Purpose |
|---|---|
| `redpanda.remote.write` | Upload local segments to object storage. **Required for Iceberg.** |
| `redpanda.remote.read` | Allow reads to fetch from object storage when not on local disk. |
| `redpanda.remote.recovery` | Restore a topic from object storage (Topic Recovery, enterprise). |
| `redpanda.storage.mode=tiered` | Fully enables Tiered Storage regardless of remote.read/write; overrides them. |
| `retention.local.target.ms` | Local-disk retention target before data ages out to object storage (default `86400000` = 1 day). |
| `retention.local.target.bytes` | Local-disk retention by size (default `-1` = unlimited). |

```bash
rpk cluster config set cloud_storage_enabled true
rpk topic create cdc.orders \
  -c redpanda.remote.write=true \
  -c redpanda.remote.read=true \
  -c retention.local.target.ms=86400000
```

Disable to drop enterprise dependency: `rpk cluster config set cloud_storage_enabled false`.

---

## 4. Server-side Schema ID Validation (Enterprise)

If your CDC pipeline serializes records with the Schema Registry wire format (required
for Iceberg `value_schema_id_prefix` mode), enable broker-side validation so records
referencing an unregistered schema are **dropped by the broker**, not silently passed
to consumers.

### Cluster-level config

| Property | Default | Values |
|---|---|---|
| `enable_schema_id_validation` | `none` | `none` (off) \| `redpanda` (native) \| `compat` (Confluent-compatible) |

```bash
rpk cluster config set enable_schema_id_validation redpanda
```

### Topic-level properties (on CDC topics)

| Topic property | Default | Purpose |
|---|---|---|
| `redpanda.key.schema.id.validation` | `false` | Validate key schema IDs. |
| `redpanda.key.subject.name.strategy` | `TopicNameStrategy` | `TopicNameStrategy` \| `RecordNameStrategy` \| `TopicRecordNameStrategy`. |
| `redpanda.value.schema.id.validation` | `false` | Validate value schema IDs. |
| `redpanda.value.subject.name.strategy` | `TopicNameStrategy` | Same strategy options. |

```bash
rpk topic create cdc.orders \
  --topic-config redpanda.value.schema.id.validation=true \
  --topic-config redpanda.value.subject.name.strategy=RecordNameStrategy
```

Upon license expiration: topics with schema validation settings cannot be created or
modified. Disable with `rpk cluster config set enable_schema_id_validation false`.

---

## 5. Secrets management for the DSN (Connect Enterprise)

The MySQL `dsn` embeds a password. The Redpanda Connect enterprise **secrets
management** feature retrieves secret values from a remote secret store at runtime
instead of putting credentials in the config file or environment. Reference secrets in
the pipeline with `${secrets.NAME}` syntax so the static password never appears in the
YAML:

```yaml
input:
  mysql_cdc:
    dsn: cdc_user:${secrets.MYSQL_CDC_PASSWORD}@tcp(localhost:3306)/mydb
    tables: [orders]
    stream_snapshot: true
    checkpoint_cache: binlog_cache
```

For AWS RDS/Aurora, prefer IAM auth (the `aws` block — see config-reference.md) so no
password is stored at all.

---

## 6. FIPS compliance (Connect Enterprise)

For regulated environments, run Redpanda Connect using the FIPS-compliant `rpk` build
so all cryptography (TLS to MySQL, TLS/SASL to Redpanda) uses FIPS-validated modules.
This is a Connect enterprise capability surfaced through the FIPS-compliant `rpk`
binary; the pipeline YAML is unchanged. (Broker-side `fips_mode` node config is a
separate Redpanda enterprise feature — `rpk redpanda config set redpanda.fips_mode <enabled|...>`.)

---

## License-expiration behavior summary (features in this skill's domain)

| Feature | Behavior on Enterprise license expiration |
|---|---|
| `mysql_cdc` connector (Redpanda Connect) | Enterprise connectors are **blocked** after the 30-day trial. |
| Iceberg Topics | Topics cannot be created/modified with `redpanda.iceberg.mode`. |
| Tiered Storage | Topics cannot be created/modified to enable Tiered Storage; no new partitions on TS topics. |
| Topic Recovery (`redpanda.remote.recovery=true`) | Cannot create recovery topics or run recovery. |
| Server-side Schema ID Validation | Topics with schema validation settings cannot be created/modified. |

The cluster continues operating without data loss; only the further *use* of these
features is restricted. See `get-started/licensing/disable-enterprise-features.adoc`
for the disable commands per feature.
