# Enterprise Features for CDC Sink Topics

The `postgres_cdc` input is itself a **Redpanda Connect Enterprise connector** — it requires a
valid Redpanda Enterprise license, and after the 30-day trial expires the connector is blocked
until you upgrade. (See `get-started:licensing/overview.adoc`, "Redpanda Connect enterprise
features" → "Enterprise connectors".)

Once CDC events land in a Redpanda topic, several **Redpanda broker** enterprise features apply to
those sink topics. They are the differentiators that turn raw CDC streams into a governed,
queryable, durably-retained dataset. Every feature below requires an Enterprise license on the
**Redpanda cluster** (independent of the Connect license).

This reference grounds the nested config keys for each. Verify license status on the cluster with:

```bash
rpk cluster license info
```

---

## 1. Iceberg Topics (CDC → lakehouse, no extra ETL)

Enabling Iceberg on the destination topic writes each CDC event into an Apache Iceberg (v2) table
in object storage, in addition to the Kafka log. This is the highest-value pairing for CDC: the
`postgres_cdc` snapshot + WAL stream becomes a continuously-updated Iceberg table queryable from
Snowflake, Databricks, Spark, Flink, Trino, etc., with no separate ETL job.

**Enterprise license required.** Grounded in `manage:iceberg/about-iceberg-topics.adoc` and
`reference:properties/topic-properties.adoc`.

### Cluster-level enablement (prerequisite)

| Property | Type | Default | Notes |
|---|---|---|---|
| `iceberg_enabled` | bool | `false` | Activates Iceberg at the cluster level. **Requires restart.** `true` requires an Enterprise license. Each topic must also set `redpanda.iceberg.mode`. |
| `iceberg_default_catalog_namespace` | string list | `["redpanda"]` | Namespace for Iceberg tables. Set a distinct value per cluster when multiple clusters share one REST catalog (e.g. AWS Glue). Cannot be changed after enablement. |
| `iceberg_catalog_type` | string | — | Catalog integration type; set `rest` to use an external REST catalog (then `iceberg_rest_catalog_endpoint` must also be set). |
| `iceberg_delete` | bool | `true` | Cluster default for the `redpanda.iceberg.delete` topic property. |
| `iceberg_invalid_record_action` | string | `dlq_table` | Cluster default for the `redpanda.iceberg.invalid.record.action` topic property. |
| `iceberg_default_partition_spec` | string | `(hour(redpanda.timestamp))` | Cluster default for the `redpanda.iceberg.partition.spec` topic property. |

**Tiered Storage is a prerequisite** for Iceberg — enable it on the topics for which you want
Iceberg tables (see section 2).

```bash
rpk cluster config set iceberg_enabled true
# optional custom namespace:
# rpk cluster config set iceberg_default_catalog_namespace '["cdc_prod"]'
```

### Per-topic Iceberg properties

Set on the CDC destination topic (`rpk topic create` / `rpk topic alter-config`):

| Topic property | Type | Default | Accepted values |
|---|---|---|---|
| `redpanda.iceberg.mode` | string | `null` (disabled) | `key_value`, `value_schema_id_prefix`, `value_schema_latest`, `disabled` |
| `redpanda.iceberg.delete` | bool | `true` | `true` deletes the Iceberg table when the topic is deleted; `false` keeps it. |
| `redpanda.iceberg.invalid.record.action` | string (enum) | `dlq_table` | `drop`, `dlq_table` — where to route records that fail translation. The DLQ table is named `<topic-name>~dlq`. |
| `redpanda.iceberg.partition.spec` | string | `(hour(redpanda.timestamp))` | Iceberg partitioning spec, e.g. `(table, hour(redpanda.timestamp))`. |
| `redpanda.iceberg.target.lag.ms` | integer (ms) | `null` | How often the Iceberg table is refreshed from the topic; Redpanda commits within this lag target. |

Iceberg mode choices for CDC:
- `key_value`: two columns — record metadata (incl. key) + a binary value column. Use when CDC
  payloads are opaque JSON and you do not register schemas.
- `value_schema_id_prefix`: structured table matching the registered schema; producers must write
  in the Schema Registry wire format. For `postgres_cdc`, the connector emits plain JSON, so to use
  this mode you must serialize events through a schema-aware processor (e.g. `schema_registry_encode`)
  before the output.
- `value_schema_latest`: structured table tracking the latest registered subject schema.

```bash
rpk topic create pg.cdc.orders
rpk topic alter-config pg.cdc.orders \
  --set redpanda.iceberg.mode=key_value \
  --set redpanda.iceberg.target.lag.ms=60000 \
  --set redpanda.iceberg.partition.spec='(hour(redpanda.timestamp))'
```

Redpanda follows the Iceberg schema-evolution spec: when the registered schema changes (e.g. a CDC
source table gains a column and the `schema` metadata updates), the Iceberg table schema is updated
automatically.

---

## 2. Tiered Storage (long-term CDC retention)

CDC topics often must be retained far longer than local disk allows (replay, audit, lakehouse
backfill). Tiered Storage offloads topic log segments to object storage. **Enterprise license
required.** Grounded in `manage:tiered-storage.adoc` and `reference:properties/topic-properties.adoc`.

### Cluster enablement

| Property | Type | Notes |
|---|---|---|
| `cloud_storage_enabled` | bool | Master switch for Tiered Storage. Disable to turn the feature off (`rpk cluster config set cloud_storage_enabled false`). |
| `cloud_storage_enable_remote_read` | bool | Cluster default backing `redpanda.remote.read`. |
| `cloud_storage_enable_remote_write` | bool | Cluster default backing `redpanda.remote.write`. |

### Per-topic Tiered Storage properties

| Topic property | Type | Default | Notes |
|---|---|---|---|
| `redpanda.remote.write` | bool | `false` | Upload (archive) the topic's segments to object storage. |
| `redpanda.remote.read` | bool | `false` | Fetch data from object storage to local storage. Set with `redpanda.remote.write` to enable Tiered Storage end-to-end. |
| `redpanda.remote.recovery` | bool | `false` | Recover/reproduce a topic from object storage. Settable only at topic creation. (Topic Recovery is itself an enterprise capability.) |
| `retention.local.target.ms` | integer (ms) | — | How long to keep data on local disk before relying on object storage. |
| `retention.local.target.bytes` | integer | — | Local-disk size target before relying on object storage. |

```bash
rpk topic create pg.cdc.orders \
  --topic-config redpanda.remote.write=true \
  --topic-config redpanda.remote.read=true \
  --topic-config retention.local.target.ms=86400000   # keep 1 day local; older data in object storage
```

> Note: `redpanda.remote.readreplica` (Remote Read Replicas, a separate enterprise DR feature)
> **cannot** be combined with `redpanda.remote.read`/`redpanda.remote.write` on the same topic.

---

## 3. Server-Side Schema ID Validation (govern CDC event schemas)

When CDC events are serialized with the Confluent SerDes wire format (schema ID in the payload
header), Redpanda brokers can reject records whose schema ID is not registered. This stops a
misconfigured pipeline from polluting a CDC topic. **Enterprise license required.** Grounded in
`manage:schema-reg/schema-id-validation.adoc`.

Note: `postgres_cdc` emits plain JSON by default, so schema ID validation applies only when you
serialize events through a schema-aware processor (`schema_registry_encode`) before the output.

### Cluster enablement

| Property | Type | Default | Accepted values |
|---|---|---|---|
| `enable_schema_id_validation` | string | `none` | `none` (disabled), `redpanda` (Redpanda topic props only), `compat` (Redpanda + Confluent props) |

```bash
rpk cluster config set enable_schema_id_validation redpanda
```

### Per-topic validation properties

| Redpanda topic property | Confluent equivalent | Type | Default |
|---|---|---|---|
| `redpanda.key.schema.id.validation` | `confluent.key.schema.validation` | bool | `false` |
| `redpanda.key.subject.name.strategy` | `confluent.key.subject.name.strategy` | string | `TopicNameStrategy` |
| `redpanda.value.schema.id.validation` | `confluent.value.schema.validation` | bool | `false` |
| `redpanda.value.subject.name.strategy` | `confluent.value.subject.name.strategy` | string | `TopicNameStrategy` |

Subject name strategies: `TopicNameStrategy`, `RecordNameStrategy`, `TopicRecordNameStrategy`. When
using the `confluent.` prefix, strategy names must be prefixed with
`io.confluent.kafka.serializers.subject.` (e.g. `io.confluent.kafka.serializers.subject.TopicNameStrategy`).

```bash
rpk topic create pg.cdc.orders \
  --topic-config redpanda.value.schema.id.validation=true \
  --topic-config redpanda.value.subject.name.strategy=TopicNameStrategy
```

---

## 4. Redpanda Connect: license + secret management for the DSN

- **Enterprise connector**: `postgres_cdc` is gated behind the Connect Enterprise license. Apply a
  license to Redpanda Connect (see `connect:get-started:licensing.adoc`). After the 30-day trial
  the connector is blocked.
- **Secrets management** (Connect enterprise feature): instead of embedding the PostgreSQL password
  or AWS keys in the `dsn`/`aws` block, reference a secret resolved at runtime from an external
  secret manager, e.g. `dsn: postgres://cdc_user:${secrets.PG_PASSWORD}@host:5432/mydb`. This avoids
  storing credentials in the pipeline config or environment variables.

---

## License-expiration behavior (sink-topic features)

From `get-started:licensing/overview.adoc`:

| Feature | Behavior on license expiration |
|---|---|
| Enterprise connectors (incl. `postgres_cdc`) | All enterprise connectors are blocked. |
| Iceberg Topics | Topics cannot be created or modified with `redpanda.iceberg.mode`. |
| Tiered Storage | Topics cannot be created/modified to enable Tiered Storage; partitions cannot be added to Tiered-Storage topics. |
| Topic Recovery (`redpanda.remote.recovery=true`) | Cannot create topics with this property or perform recovery. |
| Server-Side Schema ID Validation | Topics with schema validation settings cannot be created or modified. |
| Remote Read Replicas | Remote Read Replica topics cannot be created or modified. |

Existing data continues to operate without loss; only the creation/modification of enterprise
configuration is restricted.
```
