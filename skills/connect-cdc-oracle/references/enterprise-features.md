# Enterprise Features for Oracle CDC Pipelines

`oracledb_cdc` is itself a Redpanda Connect **enterprise connector** (Redpanda Community License). Beyond the connector, several Redpanda enterprise features apply directly to an Oracle CDC pipeline — either on the Connect side (how the pipeline runs) or on the destination Redpanda cluster (where the CDC stream lands). This file documents the relevant ones and their nested config keys. Every key here is grounded in the Redpanda licensing docs and the feature reference docs; keys are not invented.

> **License note:** Each feature below that is marked "Enterprise" requires a valid Redpanda Enterprise Edition license. On the Connect side the license is applied to the Connect instance; on the broker side it is applied to the Redpanda cluster (`rpk cluster license set`). Without a valid license, enterprise connectors are blocked, and enterprise topic/cluster properties cannot be created or modified.

---

## 1. Redpanda Connect enterprise connector: `oracledb_cdc` (Enterprise)

The `oracledb_cdc` input is an enterprise connector. From the licensing overview:

- Enterprise connectors are "additional inputs, outputs, and processors available only to enterprise customers."
- **Restriction without a valid license:** "All enterprise connectors are blocked." The connector refuses to start with a license error.
- A 30-day trial license unlocks it for evaluation; after expiry you are blocked unless you upgrade.

Apply a license key to Redpanda Connect (env var or config) before running the pipeline. See the connector field reference in [config-reference.md](config-reference.md).

---

## 2. Iceberg Topics (Enterprise) — landing CDC into a lakehouse

The most common reason to stream Oracle CDC into Redpanda is to materialize change data as Apache Iceberg tables for query engines (Spark, Trino, Snowflake, Databricks). Iceberg Topics is an enterprise feature.

- **Restriction without a valid license:** "Topics cannot be created or modified with the `redpanda.iceberg.mode` property."

### Cluster-level enablement (cluster properties)

| Property | Purpose |
|---|---|
| `iceberg_enabled` | Master switch. Set to `true` to allow any topic to write to Iceberg. Required before `redpanda.iceberg.mode` takes effect. |
| `iceberg_catalog_type` | Catalog integration type (for example, REST catalog). |
| `iceberg_rest_catalog_endpoint` | REST catalog endpoint when using an external catalog. |
| `iceberg_default_catalog_namespace` | Default namespace for Iceberg tables. |
| `iceberg_target_lag_ms` | Default lag target (default ~1 minute). Redpanda tries to commit produced data to the Iceberg table within this window. |
| `iceberg_invalid_record_action` | Cluster-wide default for invalid records (`dlq_table` default, or `drop`). |
| `iceberg_delete` | Cluster-wide default for whether the Iceberg table is deleted with the topic. |
| `iceberg_dlq_table_suffix` | Suffix for the dead-letter-queue (DLQ) table holding invalid records. Must not contain dots or `~`. |

```bash
rpk cluster config set iceberg_enabled true
```

### Per-topic Iceberg properties (topic properties on the CDC destination topic)

| Topic property | Values / meaning |
|---|---|
| `redpanda.iceberg.mode` | `disabled` (default), `key_value`, `value_schema_id_prefix`, or `value_schema_latest`. |
| `redpanda.iceberg.delete` | If `false`, the Iceberg table survives topic deletion. Defaults to the `iceberg_delete` cluster value. |
| `redpanda.iceberg.partition.spec` | Iceberg partition spec for the table (partition transforms over columns). |
| `redpanda.iceberg.target.lag.ms` | Per-topic override of `iceberg_target_lag_ms`. |
| `redpanda.iceberg.invalid.record.action` | Per-topic override: `dlq_table` (default) or `drop`. |

### Iceberg mode meanings

- `key_value`: two-column table — one column for record metadata (including key), one binary column for the value. Works without a registered schema.
- `value_schema_id_prefix`: structured table matching the topic's registered schema; producers must use the Schema Registry wire format (the `schema_registry_encode` processor). A schema must be registered.
- `value_schema_latest`: structured table matching the latest registered schema for the subject.
- `disabled` (default): no Iceberg writes.

### Why this matters for Oracle CDC

`oracledb_cdc` emits a `schema` metadata field (a serialized `schema.Common`) specifically so you can encode messages with the `schema_registry_encode` processor. Encoding into the Schema Registry wire format is the prerequisite for `value_schema_id_prefix` / `value_schema_latest` Iceberg modes, which produce a structured Iceberg table whose columns mirror the Oracle table columns.

```bash
# Create (or alter) the destination topic for structured Iceberg output
rpk topic create oracle-cdc-orders
rpk topic alter-config oracle-cdc-orders --set redpanda.iceberg.mode=value_schema_id_prefix
rpk topic alter-config oracle-cdc-orders --set redpanda.iceberg.target.lag.ms=300000
```

Pipeline that encodes CDC events for a structured Iceberg topic:

```yaml
input:
  oracledb_cdc:
    connection_string: ${ORACLE_DSN}
    include:
      - ^MYSCHEMA\.ORDERS$
    logminer:
      strategy: online_catalog
      lob_enabled: true

pipeline:
  processors:
    # The schema metadata field is produced by oracledb_cdc; encode with it.
    - schema_registry_encode:
        url: http://redpanda:8081
        subject: ${! meta("table_name") }-value
        avro_raw_json: false

output:
  kafka_franz:
    seed_brokers: [ ${REDPANDA_BROKERS} ]
    topic: oracle-cdc-orders   # Iceberg mode set on this topic via rpk
```

See `references/pipeline-and-output.md` for the `schema` metadata field details.

---

## 3. Server-side Schema ID Validation (Enterprise)

If the CDC pipeline encodes records with `schema_registry_encode`, you can have Redpanda brokers reject any record whose schema ID is not registered — catching misconfigured producers server-side instead of at the consumer.

- **Restriction without a valid license:** "Topics with schema validation settings cannot be created or modified." You can no longer enable validation.

### Cluster property

- `enable_schema_id_validation`: `none` (default, disabled), `redpanda` (Redpanda topic properties only), or `compat` (Redpanda + Confluent-compatible properties).

```bash
rpk cluster config set enable_schema_id_validation redpanda
```

### Per-topic properties (on the CDC destination topic)

| Redpanda property | Confluent-compatible equivalent | Meaning |
|---|---|---|
| `redpanda.key.schema.id.validation` | `confluent.key.schema.validation` | Enable key schema ID validation. |
| `redpanda.key.subject.name.strategy` | `confluent.key.subject.name.strategy` | Subject name strategy for keys (default `TopicNameStrategy`). |
| `redpanda.value.schema.id.validation` | `confluent.value.schema.validation` | Enable value schema ID validation. |
| `redpanda.value.subject.name.strategy` | `confluent.value.subject.name.strategy` | Subject name strategy for values (default `TopicNameStrategy`). |

Subject name strategies: `TopicNameStrategy`, `RecordNameStrategy`, `TopicRecordNameStrategy`.

```bash
rpk topic alter-config oracle-cdc-orders --set redpanda.value.schema.id.validation=true
rpk topic alter-config oracle-cdc-orders --set redpanda.value.subject.name.strategy=TopicNameStrategy
```

> Schema ID validation only checks that the schema ID encoded in the record is registered — it does not validate that the payload conforms to the schema.

---

## 4. Tiered Storage (Enterprise) — long-term retention of CDC history

CDC streams are append-heavy and often retained for replay, audit, or backfill. Tiered Storage offloads topic data to object storage so the CDC destination topic can hold history far beyond local disk.

- **Restriction without a valid license:** "Topics cannot be created or modified to enable Tiered Storage features. Additional partitions cannot be added to topics with Tiered Storage properties enabled."

### Cluster property

- `cloud_storage_enabled`: master switch (set to `true`, plus the object-storage backend credentials/bucket properties).

### Per-topic properties (on the CDC destination topic)

| Topic property | Meaning |
|---|---|
| `redpanda.remote.write` | Upload local segments to object storage. |
| `redpanda.remote.read` | Allow fetching historical segments back from object storage. |
| `redpanda.remote.recovery` | Restore a single topic from Tiered Storage (Topic Recovery, also enterprise-licensed). |
| `retention.ms` / `retention.bytes` | Local retention. |
| `retention.local.target.ms` / `retention.local.target.bytes` | Local (hot) tier retention when Tiered Storage is on; older data lives in object storage. |

```bash
rpk cluster config set cloud_storage_enabled true
rpk topic create oracle-cdc-orders \
  --topic-config redpanda.remote.write=true \
  --topic-config redpanda.remote.read=true
```

> **Related enterprise features (broker side):** Remote Read Replicas (`cloud_storage_enable_remote_read`) and Whole Cluster Restore build on Tiered Storage for disaster recovery. They are cluster-level concerns, not configured in the Connect pipeline.

---

## 5. Other Redpanda Connect enterprise capabilities used around CDC pipelines

These are enterprise Connect features (per the licensing overview) that commonly wrap an Oracle CDC pipeline. They do not change behavior on license expiry ("No change") but require a license to use.

| Feature | What it does for a CDC pipeline |
|---|---|
| **Secrets management** | Look up the Oracle password / `wallet_password` / Schema Registry credentials from a remote secret manager at runtime instead of via environment variables. Use it for `connection_string` and `wallet_password`. |
| **Redpanda Connect configuration service** (`redpanda` block) | Send pipeline logs and status events to a Redpanda topic. Configured under the top-level `redpanda:` namespace (see below). |
| **Allow or deny lists** | Limit which Connect components a pipeline may run on a shared Connect instance. |
| **FIPS compliance** | Run the pipeline using a FIPS-compliant build of `rpk connect`. |

### `redpanda` config service block (top-level namespace, grounded in connect `redpanda/about.adoc`)

```yaml
redpanda:
  seed_brokers: []        # required
  pipeline_id: ""
  logs_topic: ""          # topic to receive Connect logs
  logs_level: info
  status_topic: ""        # topic to receive status events
  # Advanced (selected): client_id, tls{enabled, skip_cert_verify, root_cas, client_certs},
  #   sasl, acks, compression, idempotent_write, allow_auto_topic_creation,
  #   max_message_bytes, max_in_flight_requests, record_retries, record_delivery_timeout
```

---

## License expiry summary (relevant features)

| Feature | Behavior on license expiry |
|---|---|
| `oracledb_cdc` (enterprise connector) | Blocked — all enterprise connectors are blocked. |
| Iceberg Topics | Cannot create/modify topics with `redpanda.iceberg.mode`. |
| Server-side Schema ID Validation | Cannot create/modify topics with schema validation settings. |
| Tiered Storage | Cannot create/modify Tiered Storage topics; cannot add partitions to them. |
| Connect secrets / config service / allow-deny / FIPS | No change. |

To check broker-side license status and violations:

```bash
rpk cluster license info
```
