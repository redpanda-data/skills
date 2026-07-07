# Enterprise Redpanda Features for TigerBeetle CDC Pipelines

The `tigerbeetle_cdc` input itself is a **certified** community connector, not an enterprise one — `connect/internal/plugins/info.csv` marks it `certified` (every other `*_cdc` input is `enterprise`), its source file carries an Apache-2.0 license header, and there is no runtime Enterprise license check. The docs mark it **beta**. See [config-reference.md](config-reference.md).

However, once TigerBeetle ledger events land in a Redpanda topic, the **destination topic and cluster** can use Redpanda Enterprise features. These are Redpanda's key differentiators for a CDC sink — and financial ledger events are the archetypal workload for them (long-term auditable retention, lakehouse analytics, DR). **Each feature below requires a valid Redpanda Enterprise license** on the destination cluster (not on Connect). Without a valid license, topics cannot be created or modified to enable these features, and on license expiration the behaviors noted apply.

Authoritative source: `docs/modules/get-started/pages/licensing/overview.adoc`, `docs/modules/reference/partials/properties/topic-properties.adoc`, `docs/modules/reference/partials/properties/cluster-properties.adoc`.

---

## 1. Iceberg Topics (Enterprise)

Land TigerBeetle transfer events directly into an Apache Iceberg table in object storage, queryable by Spark/Trino/Snowflake/Databricks without a separate ETL job — the change stream becomes an analytics-ready lakehouse table of ledger activity.

**License:** Enterprise. On expiration, topics cannot be created or modified with `redpanda.iceberg.mode`.

### Enable at the cluster level

```bash
# Cluster property (Enterprise): turn on the Iceberg integration
rpk cluster config set iceberg_enabled true

# Optional: custom catalog namespace (default "redpanda"); cannot change after enabling
rpk cluster config set iceberg_default_catalog_namespace '["tigerbeetle_cdc"]'
```

### Per-topic Iceberg properties

Set on the CDC destination topic (the topic the `redpanda` output writes to, e.g. `transfers.2`).

| Topic property | Type | Default | Values / notes |
|---|---|---|---|
| `redpanda.iceberg.mode` | string | `null` (disabled) | `key_value`, `value_schema_id_prefix`, `value_schema_latest`, `disabled` |
| `redpanda.iceberg.delete` | boolean | `true` | Delete the Iceberg table when the topic is deleted. Cluster default: `iceberg_delete`. |
| `redpanda.iceberg.invalid.record.action` | string (enum) | `dlq_table` | `drop`, `dlq_table`. Cluster default: `iceberg_invalid_record_action`. |
| `redpanda.iceberg.partition.spec` | string | `(hour(redpanda.timestamp))` | Iceberg partitioning spec. Cluster default: `iceberg_default_partition_spec`. |
| `redpanda.iceberg.target.lag.ms` | integer (ms) | `null` | How often the Iceberg table is refreshed with new topic data. Cluster default: `iceberg_target_lag_ms`. |

Iceberg mode meanings:
- `key_value` — two-column table (record metadata incl. key, plus a binary value column). No Schema Registry needed.
- `value_schema_id_prefix` — table structure matches the registered schema; producers must use the Schema Registry wire format (schema ID prefix on the value).
- `value_schema_latest` — table structure matches the latest registered schema for the subject.
- `disabled` (default) — no Iceberg writes for this topic.

```bash
# Create CDC destination topic and enable Iceberg (key_value works without a schema)
rpk topic create transfers-cdc
rpk topic alter-config transfers-cdc --set redpanda.iceberg.mode=key_value

# Or structured mode with a registered schema + custom partitioning + lag target
rpk topic alter-config transfers-cdc \
  --set redpanda.iceberg.mode=value_schema_id_prefix \
  --set 'redpanda.iceberg.partition.spec=(hour(redpanda.timestamp))' \
  --set redpanda.iceberg.target.lag.ms=60000 \
  --set redpanda.iceberg.invalid.record.action=dlq_table
```

For `value_schema_id_prefix` / `value_schema_latest`, the events written by the Connect pipeline must carry the Schema Registry wire format. Use a `schema_registry_encode` processor (register a schema for the TigerBeetle change-event JSON — note the 128/64-bit numeric fields are strings) so the Iceberg table gets typed columns instead of a single binary blob. With `key_value` mode no schema is required.

---

## 2. Tiered Storage / Remote Write & Read (Enterprise)

Financial ledger events typically must be retained for years for audit and compliance. Tiered Storage offloads the CDC topic to object storage for effectively unlimited retention and lets the cluster reclaim local disk — a durable, replayable home for the full change history.

**License:** Enterprise. On expiration, topics cannot be created/modified to enable Tiered Storage and partitions cannot be added.

### Cluster level

```bash
rpk cluster config set cloud_storage_enabled true
# plus cloud_storage_bucket / region / credentials per your object store
```

### Per-topic properties

| Topic property | Type | Default | Notes |
|---|---|---|---|
| `redpanda.remote.write` | boolean | `false` | Upload local segments to object storage. |
| `redpanda.remote.read` | boolean | `false` | Fetch data back from object storage to local. `remote.write` + `remote.read` = Tiered Storage. |
| `redpanda.remote.delete` | boolean | (cluster default) | Whether object-storage data is deleted with the topic. Does not apply to Remote Read Replica topics. |
| `redpanda.remote.recovery` | boolean | — | Recover a topic's data from object storage. Set only at topic-create time. Topic Recovery is Enterprise-gated. |

```bash
# Enable Tiered Storage on the CDC topic for long-term ledger-event retention
rpk topic alter-config transfers-cdc \
  --set redpanda.remote.write=true \
  --set redpanda.remote.read=true
```

---

## 3. Remote Read Replicas (Enterprise)

A read-only copy of the CDC topic in a remote cluster, served from object storage — geo-fanout of the ledger-event stream to analytics or reporting clusters without loading the primary.

**License:** Enterprise. On expiration, Remote Read Replica topics cannot be created or modified. Disable cluster-wide with `rpk cluster config set cloud_storage_enable_remote_read false`.

| Topic property | Type | Notes |
|---|---|---|
| `redpanda.remote.readreplica` | string | Object storage bucket name for the Remote Read Replica topic. Cannot be combined with `redpanda.remote.read` or `redpanda.remote.write` (error). |

```bash
# On the remote cluster, create a read replica of the CDC topic
rpk topic create transfers-cdc --set redpanda.remote.readreplica=<source-bucket>
```

---

## 4. Shadow Linking / Shadowing (Enterprise) — cross-cluster DR

Shadowing is Redpanda's enterprise-grade disaster recovery feature: asynchronous, **offset-preserving** replication between two distinct Redpanda clusters, copying source data including offsets, timestamps, and cluster metadata. For TigerBeetle CDC this protects the landed ledger-event stream — if the primary cluster (or region) is lost, consumers fail over to the shadow cluster at the same offsets, so consumer position in the change history is preserved. Remote Read Replicas (above) are read-only/object-storage-served, whereas Shadowing is a managed link with failover.

**License:** Enterprise. On expiration, new shadow links cannot be created; existing shadow links continue operating and can be updated.

Managed entirely with the `rpk shadow` command family (Admin API), not a topic property:

| Command | Purpose |
|---|---|
| `rpk shadow create` | Create a shadow link from a source cluster (can select the CDC topics to shadow). |
| `rpk shadow list` | List shadow links. |
| `rpk shadow describe` | Show a shadow link's configuration. |
| `rpk shadow status [LINK_NAME]` | Monitor replication progress (e.g. `--print-overview --print-topic`). |
| `rpk shadow update` | Update an existing shadow link. |
| `rpk shadow failover [LINK_NAME]` | Promote shadow topics to writable on the target during DR (`--all` or `--topic <name>`). |
| `rpk shadow delete` | Remove a shadow link. |
| `rpk shadow config-generate` | Generate a shadow link configuration. |

```bash
# On the DR (target) cluster: monitor and, on disaster, fail over the CDC topic
rpk shadow status my-cdc-shadow-link --print-overview --print-topic
rpk shadow failover my-cdc-shadow-link --topic transfers-cdc
```

See `docs/modules/manage/pages/disaster-recovery/index.adoc` and `docs/modules/reference/pages/rpk/rpk-shadow/`.

---

## 5. Server-Side Schema ID Validation (Enterprise)

Enforce, at the broker, that CDC records written to the topic carry a Schema-Registry-registered schema ID — invalid records are rejected by the broker rather than reaching downstream consumers. Useful when the pipeline encodes TigerBeetle change events against a contract.

**License:** Enterprise. On expiration, topics with schema validation settings cannot be created or modified. Disable cluster-wide with `rpk cluster config set enable_schema_id_validation false`.

### Cluster level

```bash
# Values: none | redpanda | compat
rpk cluster config set enable_schema_id_validation redpanda
```

- `none` — disabled; associated topic properties cannot be modified.
- `redpanda` — enabled; only Redpanda-native topic properties accepted.
- `compat` — enabled; both Redpanda and Confluent-compatible aliases accepted.

### Per-topic properties

| Topic property | Type | Default | Notes |
|---|---|---|---|
| `redpanda.key.schema.id.validation` | boolean | `false` | Validate the schema ID encoded in the record key. Alias: `confluent.key.schema.validation`. |
| `redpanda.value.schema.id.validation` | boolean | `false` | Validate the schema ID encoded in the record value. Alias: `confluent.value.schema.validation`. |
| `redpanda.key.subject.name.strategy` | string | `TopicNameStrategy` | Key subject mapping. Alias: `confluent.key.subject.name.strategy`. |
| `redpanda.value.subject.name.strategy` | string | `TopicNameStrategy` | Value subject mapping. Alias: `confluent.value.subject.name.strategy`. |

```bash
rpk topic alter-config transfers-cdc \
  --set redpanda.value.schema.id.validation=true \
  --set redpanda.value.subject.name.strategy=TopicNameStrategy
```

Pair with a `schema_registry_encode` processor in the Connect pipeline so the CDC value carries the wire-format schema ID the broker validates.

---

## 6. Securing the CDC topic and pipeline (Enterprise)

| Feature | License | Key config / command | Notes |
|---|---|---|---|
| Role-Based Access Control (RBAC) | Enterprise | `rpk security role create/list/delete`; bind ACLs to roles | Grant a dedicated role write access to `transfers.*` topics. On expiration, roles/role-ACLs cannot be created or modified (deletion allowed). |
| Audit Logging | Enterprise | `rpk cluster config set audit_enabled true` | Records cluster activity (incl. CDC topic access) for compliance — particularly relevant for financial event streams. On expiration, read access to the audit topic is denied but logging continues. |
| OAUTHBEARER / OIDC authentication | Enterprise | add `OIDC` to cluster config `sasl_mechanisms` (and `http_authentication`) | Authenticate the Connect client / consumers via OIDC. No change on expiration. |
| Kerberos (GSSAPI) authentication | Enterprise | add `GSSAPI` to cluster config `sasl_mechanisms` | No change on expiration. |
| FIPS compliance | Enterprise | node config `fips_mode` (`enabled`/`permissive`/`disabled`) | Run brokers in FIPS mode. |

The `redpanda` output in this skill's pipelines already supports `sasl` (SCRAM today); switch the `mechanism` and credentials to match an OIDC/Kerberos-secured cluster.

---

## 7. Redpanda Connect enterprise features (pipeline side)

Distinct from the Redpanda cluster license. These apply to the Connect process running the `tigerbeetle_cdc` pipeline and require a Connect Enterprise license after the 30-day trial.

| Feature | Doc | Notes |
|---|---|---|
| Enterprise connectors | `connect:components:catalog` (support=enterprise) | `tigerbeetle_cdc` is `certified`, not enterprise. Other inputs/outputs/processors in the same pipeline may be enterprise. |
| Secrets management | `connect:configuration:secrets.adoc` | Look up secrets (e.g., Redis URL, Kafka SASL password) from a remote secret manager at runtime instead of env vars. |
| Redpanda Connect configuration service | `connect:components:redpanda/about.adoc` | The `redpanda:` config block streams Connect logs and status events to a topic on the Redpanda cluster. |
| Allow / deny lists | `connect:configuration:allow_and_deny_lists.adoc` | Restrict which components a pipeline may run. |
| FIPS compliance | `connect:get-started:quickstarts/rpk.adoc#fips-compliance` | FIPS guidance is documented for the `rpk`-embedded Connect; `tigerbeetle_cdc` requires the standalone cgo binary, so verify FIPS applicability for that build separately. |

Apply a Connect license as described in `connect:get-started:licensing.adoc`. Without it, enterprise connectors are blocked after the trial; the un-gated `tigerbeetle_cdc` input keeps working.

---

## Quick reference: which license gates what

| Where the data is | Feature | License-gated? |
|---|---|---|
| Connect input (`tigerbeetle_cdc`) | the connector itself | No — `certified` tier in `info.csv`, Apache-2.0 source, beta status, cgo builds only |
| Connect pipeline | enterprise connectors, secrets mgmt, config service, allow/deny lists | Connect Enterprise |
| Redpanda topic | Iceberg, Tiered Storage, Remote Read Replicas, Schema ID Validation | Redpanda Enterprise |
| Redpanda cluster | Shadow Linking (DR), RBAC, Audit Logging, OIDC/Kerberos, FIPS | Redpanda Enterprise |
