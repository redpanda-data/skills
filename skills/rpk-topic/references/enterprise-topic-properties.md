# rpk topic: Enterprise Topic Properties Reference

Many of Redpanda's key differentiators are configured as **topic-level
properties**, set at creation with `rpk topic create -c key=value` (alias
`--topic-config`) or on an existing topic with
`rpk topic alter-config <topic> --set key=value`. This file documents those
enterprise properties, their nested keys, accepted values, and defaults.

All property names, values, and defaults below are verified against
`docs/modules/reference/partials/properties/topic-properties.adoc`,
the feature docs under `docs/modules/manage` / `docs/modules/develop`, and
the licensing overview. **Features marked "Enterprise" require a valid
Enterprise Edition license**; without one they cannot be enabled, and on
license expiration they enter the restricted behavior noted in
[Licensing overview](https://docs.redpanda.com/current/get-started/licensing/overview/).

> License check: `rpk cluster license info` reports `license violation: true`
> when an enterprise topic property is set without a valid license.

---

## Tiered Storage (Enterprise)

Stores topic data in cloud object storage for long-term retention. Enabled per
topic via the legacy `redpanda.remote.*` flags, or with the newer
`redpanda.storage.mode` enum. Requires the cluster-level `cloud_storage_enabled=true`.

| Topic property | Type | Default | Effect |
|---|---|---|---|
| `redpanda.remote.write` | boolean | `false` | Upload (archive) local segments to object storage |
| `redpanda.remote.read` | boolean | `false` | Fetch data from object storage to local storage |
| `redpanda.remote.delete` | boolean | `null` | Delete objects from cloud storage when removed locally. Does NOT apply to Remote Read Replica topics |
| `redpanda.remote.recovery` | boolean | `null` | Recover/reproduce a topic from object storage. **Create-only — cannot be set on an existing topic** (Topic Recovery feature) |
| `redpanda.storage.mode` | enum | (cluster default) | `local`, `tiered`, `cloud`, `unset` (introduced v26.1.1) |

Tiered Storage is enabled when **both** `redpanda.remote.read=true` and
`redpanda.remote.write=true`. Corresponding cluster properties:
`cloud_storage_enable_remote_read`, `cloud_storage_enable_remote_write`.

`redpanda.storage.mode` accepted values:
- `local` — local disk only; object-storage upload disabled regardless of cluster settings.
- `tiered` — local disk + upload to object storage (Tiered Storage).
- `cloud` — Cloud Topics architecture; local storage used only as a write buffer.
- `unset` — mode unset; topic may still use the legacy `redpanda.remote.read`/`redpanda.remote.write` flags.

Overrides cluster property `default_redpanda_storage_mode`.

```bash
# Enable Tiered Storage at creation (legacy flags)
rpk topic create archive -p 6 -r 3 \
  -c redpanda.remote.write=true \
  -c redpanda.remote.read=true

# Enable on an existing topic
rpk topic alter-config orders \
  --set redpanda.remote.read=true \
  --set redpanda.remote.write=true

# Equivalent with the storage-mode enum
rpk topic alter-config orders --set redpanda.storage.mode=tiered

# Recover a topic from object storage (create-only)
rpk topic create recovered -c redpanda.remote.recovery=true
```

### Local retention overrides for tiered topics

When Tiered Storage is on, these control how much data is kept on **local**
disk (object storage keeps the full history per the standard `retention.*`).

| Topic property | Type | Cluster default property |
|---|---|---|
| `retention.local.target.bytes` | integer | `retention_local_target_bytes_default` |
| `retention.local.target.ms` | integer | `retention_local_target_ms_default` |
| `initial.retention.local.target.bytes` | integer | `initial_retention_local_target_bytes_default` |
| `initial.retention.local.target.ms` | integer | `initial_retention_local_target_ms_default` |

```bash
rpk topic alter-config orders --set retention.local.target.ms=3600000
```

> On expiration: topics cannot be created or modified to enable Tiered Storage,
> and partitions cannot be added to topics with Tiered Storage enabled.

---

## Cloud Topics (Enterprise)

A topic type that uses durable object storage as the **primary** backing store
instead of local disk replication. Local storage acts only as a write buffer.

| Topic property | Type | Default | Effect |
|---|---|---|---|
| `redpanda.cloud_topic.enabled` | string | `null` | Enable Cloud Topic storage mode for the topic |
| `redpanda.storage.mode=cloud` | enum | — | Preferred, flexible way to select the Cloud Topics architecture |

The docs recommend `redpanda.storage.mode=cloud` over the
`redpanda.cloud_topic.enabled` flag. Cluster-wide default:
`default_redpanda_storage_mode=cloud`.

```bash
# Create a Cloud Topic (preferred form)
rpk topic create my-cloud-topic -c redpanda.storage.mode=cloud
```

In `rpk topic describe-storage`, Cloud Topics report cloud-storage-mode
`cloud_topic` (or `cloud_topic_read_replica`).

> On expiration: new Cloud Topics cannot be created; existing ones cannot be
> modified (including adding/modifying partitions); major upgrades are blocked
> in a violation state.

---

## Iceberg Topics (Enterprise)

Exposes a Redpanda topic as an Apache Iceberg table in an external catalog.
Requires cluster property `iceberg_enabled=true`, then set the topic property
`redpanda.iceberg.mode`.

| Topic property | Type | Default | Accepted values / notes |
|---|---|---|---|
| `redpanda.iceberg.mode` | string | `null` (`disabled`) | `disabled`, `key_value`, `value_schema_id_prefix`, `value_schema_latest` |
| `redpanda.iceberg.delete` | boolean | `true` | Delete the Iceberg table when the topic is deleted. Cluster default: `iceberg_delete` |
| `redpanda.iceberg.partition.spec` | string | `(hour(redpanda.timestamp))` | Iceberg partitioning spec. Cluster default: `iceberg_default_partition_spec` |
| `redpanda.iceberg.target.lag.ms` | integer (ms) | `null` | How often the Iceberg table is refreshed with new topic data |
| `redpanda.iceberg.invalid.record.action` | string (enum) | `dlq_table` | `drop`, `dlq_table`. Cluster default: `iceberg_invalid_record_action` |

Iceberg modes:
- `key_value` — two-column table (metadata incl. key + binary value column); no schema needed.
- `value_schema_id_prefix` — table columns match the schema; producers must write using the Schema Registry wire format.
- `value_schema_latest` — table columns match the latest registered schema for the subject. Override the subject with `value_schema_latest:subject=<name>`.
- `disabled` — pause/disable Iceberg translation for the topic.

```bash
# Cluster prerequisite
rpk cluster config set iceberg_enabled true

# Create an Iceberg topic in key_value mode
rpk topic create transactions --topic-config=redpanda.iceberg.mode=key_value

# Enable on an existing topic with a schema-backed table
rpk topic alter-config transactions \
  --set redpanda.iceberg.mode=value_schema_latest:subject=transactions

# Tune refresh lag and keep the table on topic delete
rpk topic alter-config transactions \
  --set redpanda.iceberg.target.lag.ms=60000 \
  --set redpanda.iceberg.delete=false

# Drop invalid records instead of routing them to a DLQ table
rpk topic alter-config transactions \
  --set redpanda.iceberg.invalid.record.action=drop

# Pause translation (e.g. during catalog migration)
rpk topic alter-config transactions --set redpanda.iceberg.mode=disabled
```

> On expiration: topics cannot be created or modified with the
> `redpanda.iceberg.mode` property.

---

## Remote Read Replicas (Enterprise)

A read-only topic backed by another cluster's Tiered Storage bucket — used for
cross-region/disaster-recovery reads.

| Topic property | Type | Default | Effect |
|---|---|---|---|
| `redpanda.remote.readreplica` | string | `null` | Object storage bucket/container name of the source topic's Tiered Storage |

Setting `redpanda.remote.readreplica` together with `redpanda.remote.read` or
`redpanda.remote.write` is an **error**. Disable cluster-wide with
`cloud_storage_enable_remote_read=false`.

```bash
rpk topic create orders-replica -c redpanda.remote.readreplica=<bucket-name>
```

In `rpk topic describe-storage`, read replicas show cloud-storage-mode
`read_replica` (or `cloud_topic_read_replica`).

> On expiration: Remote Read Replica topics cannot be created or modified.

---

## Leader Pinning (Enterprise)

Pins partition leaders for a topic to a preferred set of availability zones /
racks. Requires cluster property `enable_rack_awareness=true`.

| Topic property | Type | Default | Effect |
|---|---|---|---|
| `redpanda.leaders.preference` | object/string | `none` | Preferred rack(s) for partition leaders. Cluster default: `default_leaders_preference` |

Accepted string values:
- `none` — disable Leader Pinning for the topic.
- `racks:<rack1>[,<rack2>,...]` — preferred racks (any order); leaders distributed across listed racks.
- `ordered_racks:<rack1>[,<rack2>,...]` — preferred racks in priority order (Redpanda v26.1+); failover down the list.

```bash
rpk topic alter-config orders \
  --set redpanda.leaders.preference=racks:rack1,rack2

rpk topic alter-config orders \
  --set redpanda.leaders.preference=ordered_racks:A,B,C
```

> On expiration: Leader Pinning is disabled on all topics. Disable manually
> with `rpk cluster config set default_leaders_preference none`.

---

## Server-Side Schema ID Validation (Enterprise)

Validates that the schema ID embedded in a record's key/value is registered in
the Schema Registry; unregistered records are rejected by the broker rather
than reaching consumers. Requires cluster property
`enable_schema_id_validation` set to `redpanda` or `compat` (default `none`).

| Topic property | Type | Default | Accepted values |
|---|---|---|---|
| `redpanda.key.schema.id.validation` | boolean | `false` | `true`/`false` — validate key schema ID |
| `redpanda.value.schema.id.validation` | boolean | `false` | `true`/`false` — validate value schema ID |
| `redpanda.key.subject.name.strategy` | string (enum) | `TopicNameStrategy` | `TopicNameStrategy`, `RecordNameStrategy`, `TopicRecordNameStrategy` |
| `redpanda.value.subject.name.strategy` | string (enum) | `TopicNameStrategy` | `TopicNameStrategy`, `RecordNameStrategy`, `TopicRecordNameStrategy` |

Confluent-compatible aliases also exist:
`confluent.key.schema.validation`, `confluent.value.schema.validation`,
`confluent.key.subject.name.strategy`, `confluent.value.subject.name.strategy`.

```bash
# Cluster prerequisite
rpk cluster config set enable_schema_id_validation redpanda

# Create a topic with value validation
rpk topic create events \
  --topic-config redpanda.value.schema.id.validation=true \
  --topic-config redpanda.value.subject.name.strategy=TopicNameStrategy

# Enable on an existing topic
rpk topic alter-config events \
  --set redpanda.value.schema.id.validation=true
```

> On expiration: topics with schema-validation settings cannot be created or
> modified. Disable cluster-wide with
> `rpk cluster config set enable_schema_id_validation false`.

---

## Topic Deletion Control (Enterprise)

`delete_topic_enable` is a **cluster** property (not a topic property), but it
directly governs `rpk topic delete`. When set to `false`, it blocks all users —
including superusers — from deleting topics via the Kafka DeleteTopics API,
guarding against accidental deletion.

```bash
rpk cluster config set delete_topic_enable false   # block all topic deletes
```

> On expiration: reverts to enabled (`true`).

---

## Write Caching (performance, not license-gated)

Not an enterprise-licensed feature, but a Redpanda-specific topic property worth
noting alongside the differentiators above. Acknowledges a write once a majority
of brokers receive it, without waiting for fsync; fsyncs then follow `flush.ms`
/ `flush.bytes`.

| Topic property | Type | Accepted values | Cluster default property |
|---|---|---|---|
| `write.caching` | string | `true`, `false` | `write_caching_default` |
| `flush.ms` | integer | ms between fsyncs | — |
| `flush.bytes` | integer | bytes between fsyncs | — |

```bash
rpk topic alter-config orders --set write.caching=true --set flush.ms=100
```

---

## Quick reference: enterprise topic properties

| Feature | Key topic property(ies) | Enterprise |
|---|---|---|
| Tiered Storage | `redpanda.remote.read`, `redpanda.remote.write`, `redpanda.remote.delete`, `redpanda.remote.recovery`, `redpanda.storage.mode=tiered`, `retention.local.target.*` | Yes |
| Cloud Topics | `redpanda.cloud_topic.enabled`, `redpanda.storage.mode=cloud` | Yes |
| Iceberg Topics | `redpanda.iceberg.mode`, `.delete`, `.partition.spec`, `.target.lag.ms`, `.invalid.record.action` | Yes |
| Remote Read Replicas | `redpanda.remote.readreplica` | Yes |
| Leader Pinning | `redpanda.leaders.preference` | Yes |
| Schema ID Validation | `redpanda.key/value.schema.id.validation`, `redpanda.key/value.subject.name.strategy` | Yes |
| Topic Deletion Control | `delete_topic_enable` (cluster) | Yes |
| Write Caching | `write.caching`, `flush.ms`, `flush.bytes` | No |
