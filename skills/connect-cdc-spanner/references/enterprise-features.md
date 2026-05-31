# Enterprise Features for Spanner CDC into Redpanda

This reference documents the Redpanda enterprise differentiators that are
relevant to a `gcp_spanner_cdc` pipeline. Two scopes matter:

1. **Redpanda Connect enterprise features** — the connector itself and related
   Connect capabilities are gated by a Redpanda Enterprise license.
2. **Redpanda broker enterprise features** — once Spanner CDC events land in a
   Redpanda topic (the `output:` side of the pipeline), broker-side enterprise
   features such as Iceberg Topics and Tiered Storage govern how that CDC
   history is retained, queried, and replicated.

All keys/flags below are grounded in the source docs under
`/tmp/redpanda-skills-src`. Features marked **Enterprise** require a valid
Redpanda Enterprise Edition license. License behavior on expiration is taken
from `get-started/licensing/overview.adoc`.

---

## 1. Redpanda Connect enterprise gating (the connector itself)

The `gcp_spanner_cdc` input is one of the **enterprise connectors** listed in
`get-started/licensing/overview.adoc` (the connect section). Without a valid
Enterprise license, *all enterprise connectors are blocked* — the pipeline
fails at startup with a license error (`license.CheckRunningEnterprise` in the
connector source).

How to supply the license to Redpanda Connect (see
`connect:get-started:licensing.adoc#apply-a-license-key-to-redpanda-connect`):

- `REDPANDA_LICENSE` environment variable, or
- `--redpanda.license` / a license file path, or
- the `redpanda` config block when run inside a Redpanda cluster.

A 30-day trial license unlocks enterprise connectors for evaluation; after it
expires you are blocked from running enterprise connectors until you upgrade.

### Other Connect enterprise features that pair with this connector

| Feature | License | Where it fits |
|---------|---------|---------------|
| Enterprise connectors (incl. `gcp_spanner_cdc`) | **Enterprise** | The CDC input itself |
| Secrets management (remote secret lookup at runtime) | **Enterprise** | Keep `credentials_json` / SASL passwords out of the YAML — resolve them from a remote secrets manager at runtime instead of env vars |
| Redpanda Connect configuration service (`redpanda` block) | **Enterprise** | Send pipeline logs and status events to topics on a Redpanda cluster |
| Allow/deny lists | **Enterprise** | Restrict which components a Connect instance may run |
| FIPS compliance | **Enterprise** | Run Connect with a FIPS-compliant `rpk` build |

### The `redpanda` configuration-service block

Enterprise feature. Lives under the top-level `redpanda` namespace (not the
`gcp_spanner_cdc` input). Sends Connect process logs and pipeline status to
Redpanda topics. Grounded in `connect:components:redpanda/about.adoc`.

```yaml
redpanda:
  seed_brokers:                       # required
    - "redpanda-broker-0:9092"
  pipeline_id: "spanner-cdc"          # tag present in logs/status
  logs_topic: "__redpanda.connect.logs"
  logs_level: info                    # debug | info | warn | error
  status_topic: "__redpanda.connect.status"
  # Producer/connection tuning (defaults shown for the load-bearing ones):
  client_id: redpanda-connect
  idempotent_write: true              # exactly-once per partition; forces acks=all
  acks: all                           # all | leader | none
  compression: snappy                 # lz4 | snappy | gzip | none | zstd
  max_buffered_records: 10000
  max_in_flight_requests: 1           # capped at 5 when idempotent_write=true
  tls:
    enabled: false
  sasl:
    - mechanism: SCRAM-SHA-512        # also OAUTHBEARER, PLAIN, AWS_MSK_IAM, REDPANDA_CLOUD_SERVICE_ACCOUNT, none
      username: connect
      password: "${REDPANDA_PASSWORD}"
```

Note: the data output for CDC events normally uses `kafka_franz`; the `redpanda`
block is for operational logs/status telemetry, not the CDC payload.

---

## 2. Iceberg Topics — CDC into a queryable lakehouse table

**Enterprise.** This is the highest-value destination-side differentiator for a
CDC pipeline: instead of only landing change events as Kafka records, Redpanda
can also materialize the destination topic as an Apache Iceberg table in object
storage, queryable by Spark, Flink, Snowflake, Databricks, ClickHouse, Trino,
etc. — no separate ETL. Grounded in `manage/iceberg/about-iceberg-topics.adoc`
and `reference/properties/topic-properties.adoc`.

**Prerequisites:** an Enterprise license **and** Tiered Storage enabled on the
topic (Iceberg writes Parquet alongside the Tiered Storage log segments).

### Cluster-level enablement

```bash
rpk cluster config set iceberg_enabled true            # required, restart needed
# Optional: isolate this cluster's tables in a custom catalog namespace
# (default namespace is "redpanda"; cannot be changed after enabling Iceberg)
rpk cluster config set iceberg_default_catalog_namespace '["spanner_cdc"]'
```

### Per-topic Iceberg properties (set on the CDC destination topic)

| Topic property | Cluster property | Type | Default | Notes |
|----------------|------------------|------|---------|-------|
| `redpanda.iceberg.mode` | — | string (enum) | `null` (disabled) | `key_value`, `value_schema_id_prefix`, `value_schema_latest`, or `disabled`. For Spanner CDC JSON, use `key_value` unless you register a schema for the topic. |
| `redpanda.iceberg.delete` | `iceberg_delete` | boolean | `true` | When `false`, the Iceberg table survives topic deletion. |
| `redpanda.iceberg.invalid.record.action` | `iceberg_invalid_record_action` | string (enum) | `dlq_table` | `drop` or `dlq_table`. DLQ table is named `<topic-name>~dlq`. |
| `redpanda.iceberg.partition.spec` | `iceberg_default_partition_spec` | string | `(hour(redpanda.timestamp))` | Iceberg partitioning expression. |
| `redpanda.iceberg.target.lag.ms` | `iceberg_target_lag_ms` | integer (ms) | `null` (cluster default 60000) | How often the Iceberg table is refreshed with new topic data. |

```bash
rpk topic create spanner.cdc.orders
rpk topic alter-config spanner.cdc.orders --set redpanda.iceberg.mode=key_value
rpk topic alter-config spanner.cdc.orders --set redpanda.iceberg.target.lag.ms=30000
rpk topic alter-config spanner.cdc.orders --set redpanda.iceberg.partition.spec='(hour(redpanda.timestamp))'
```

For a structured table (one column per Spanner field) instead of a single binary
value column, register a schema in the Schema Registry and produce CDC events in
the Schema Registry wire format, then use `value_schema_id_prefix` or
`value_schema_latest`. Schema evolution is applied to the Iceberg table
automatically (reorder fields, promote types).

**On license expiration:** topics cannot be created or modified with
`redpanda.iceberg.mode`.

---

## 3. Tiered Storage — long-term retention of CDC history

**Enterprise.** Required as a prerequisite for Iceberg Topics, and valuable on
its own so the destination topic can retain the full CDC history in object
storage well beyond local-disk capacity. This complements Spanner's own change
stream `retention_period` (default 1 day, max 7 days) — once events are in a
Tiered Storage topic, they are retained per the topic's retention policy in
object storage, not bounded by Spanner retention.

### Cluster-level enablement

```bash
rpk cluster config set cloud_storage_enabled true      # master switch; restart needed
```

To disable (community-compliance): `rpk cluster config set cloud_storage_enabled false`.

### Per-topic Tiered Storage properties

| Topic property | Type | Description |
|----------------|------|-------------|
| `redpanda.remote.write` | boolean | Upload local log segments to object storage. |
| `redpanda.remote.read` | boolean | Fetch data from object storage to local storage. Setting both `remote.write` + `remote.read` = Tiered Storage enabled. |
| `redpanda.remote.delete` | boolean | Whether object-storage data is removed when the topic is deleted. |
| `redpanda.remote.recovery` | boolean | Topic Recovery — restore a single topic from object storage (create-time only). |
| `redpanda.remote.readreplica` | string | Remote Read Replica (see below). Mutually exclusive with `remote.read`/`remote.write`. |

```bash
rpk topic alter-config spanner.cdc.orders \
  --set redpanda.remote.write=true \
  --set redpanda.remote.read=true
```

**On license expiration:** topics cannot be created or modified to enable Tiered
Storage; partitions cannot be added to Tiered-Storage topics.

---

## 4. Cloud Topics — object-storage-native destination topic for CDC history

**Enterprise.** An alternative object-storage-backed topic type for landing
Spanner CDC events. A Cloud Topic stores topic data primarily in durable object
storage (used as the primary backing store instead of local-disk replication),
with local storage acting only as a write buffer. This is the most relevant
remaining "where CDC events land" differentiator alongside Tiered Storage and
Iceberg Topics: it is optimized for high-throughput, cost-sensitive CDC
workloads that can tolerate higher latencies than standard Kafka topics.
Grounded in `get-started/licensing/overview.adoc` (Cloud Topics row),
`develop/manage-topics/cloud-topics.adoc`, and
`reference/properties/topic-properties.adoc` (`redpanda.cloud_topic.enabled`,
line 948) and `cluster-properties.adoc` (`cloud_topics_enabled`).

### Cluster-level enablement (prerequisite)

```bash
rpk cluster config set cloud_topics_enabled=true       # boolean; default false; restart needed
```

`cloud_topics_enabled` is a `boolean` cluster property (default `false`) and the
value `true` itself requires an Enterprise license.

### Creating a CDC destination as a Cloud Topic (creation time only)

A topic can be made a Cloud Topic only at creation time. The canonical way the
current docs show this is the `redpanda.storage.mode` storage mode:

```bash
rpk topic create -c redpanda.storage.mode=cloud spanner.cdc.orders
```

The dedicated topic property is `redpanda.cloud_topic.enabled` (type `string`,
default `null`, not nullable). The docs recommend `redpanda.storage.mode`
(`local` | `tiered` | `cloud` | `unset`) for more flexible configuration of
storage modes.

**On license expiration:** new Cloud Topics cannot be created; existing Cloud
Topics cannot be modified (including adding or modifying partitions); major
upgrades are blocked when in a violation state.

---

## 5. Remote Read Replicas — read-only DR copy of CDC topics

**Enterprise.** A remote cluster can mount the CDC destination topic read-only
from object storage for disaster recovery / geo-distributed reads. Set via the
topic property `redpanda.remote.readreplica` (the object-storage bucket name).
Mutually exclusive with `redpanda.remote.read`/`redpanda.remote.write` on the
same topic. Disable cluster-wide with
`rpk cluster config set cloud_storage_enable_remote_read false`.

**On license expiration:** Remote Read Replica topics cannot be created or
modified.

---

## 6. Shadowing — cross-cluster disaster recovery for CDC topics

**Enterprise.** Redpanda Shadowing provides asynchronous, offset-preserving
replication of topics (including your CDC destination topics) between distinct
Redpanda clusters for cross-region data protection, managed with `rpk shadow`
(setup / monitor / failover). This is the key DR feature for protecting the
stream of Spanner change events after they land in Redpanda. Grounded in
`get-started/licensing/overview.adoc` (Shadowing row) and
`deploy:redpanda/manual/disaster-recovery/shadowing/index.adoc`.

**On license expiration:** new shadow links cannot be created; existing shadow
links keep operating and can be updated.

---

## 7. Security differentiators on the destination cluster

These apply to the Redpanda cluster the CDC events are written into, and to the
SASL block of the Connect `kafka_franz` output / `redpanda` block.

| Feature | License | Key config |
|---------|---------|-----------|
| RBAC | **Enterprise** | Manage roles with `rpk security role ...`; grant the Connect producer principal `WRITE`/`CREATE` on the CDC topics. |
| OAUTHBEARER / OIDC auth | **Enterprise** | `sasl_mechanisms` includes `OIDC`; Connect output `sasl[].mechanism: OAUTHBEARER` with `sasl[].token`. |
| Kerberos (GSSAPI) auth | **Enterprise** | `sasl_mechanisms` includes `GSSAPI`. |
| Audit Logging | **Enterprise** | `rpk cluster config set audit_enabled true`. |
| Server-side Schema ID Validation | **Enterprise** | `rpk cluster config set enable_schema_id_validation true`; per-topic `redpanda.key.schema.id.validation` / `redpanda.value.schema.id.validation`. Pairs with Iceberg `value_schema_*` modes to guarantee CDC events carry registered schemas. |
| FIPS compliance | **Enterprise** | Node config `fips_mode`; Connect FIPS `rpk` build. |

---

## License-requirement summary

| Feature | Enterprise license required |
|---------|------------------------------|
| `gcp_spanner_cdc` input (enterprise connector) | Yes |
| Connect secrets management / `redpanda` config-service block / allow-deny lists / Connect FIPS | Yes |
| Iceberg Topics (`redpanda.iceberg.*`) | Yes |
| Tiered Storage (`redpanda.remote.*`, `cloud_storage_enabled`) | Yes |
| Cloud Topics (`redpanda.cloud_topic.enabled` / `redpanda.storage.mode=cloud`, `cloud_topics_enabled`) | Yes |
| Remote Read Replicas (`redpanda.remote.readreplica`) | Yes |
| Shadowing (`rpk shadow`) | Yes |
| RBAC, OIDC/OAUTHBEARER, Kerberos, Audit Logging, Schema ID Validation, FIPS | Yes |

Check current license status / violations:

```bash
rpk cluster license info
```
