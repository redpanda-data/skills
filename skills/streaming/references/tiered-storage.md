# Tiered Storage (Shadow Indexing)

## What It Does

Tiered Storage (also called shadow indexing) offloads log segments from Redpanda broker local disks to object storage (Amazon S3, Google Cloud Storage, or Azure Blob Storage / Azure Data Lake Storage). Redpanda indexes where each segment is stored in object storage so it can retrieve data transparently when a consumer requests older offsets that are no longer on local disk.

Two operations:
- **Remote write**: Redpanda uploads closed log segments to object storage automatically.
- **Remote read**: When a consumer requests data that has been removed from local disk, Redpanda fetches it from object storage.

From a client's perspective, the topic looks the same regardless of where the data is stored. There is no API difference — consumers use the same `Fetch` Kafka API and the broker handles retrieval transparently.

Tiered Storage requires an **enterprise license**. Check your license:

```bash
rpk cluster license info --brokers localhost:9092
```

Tiered Storage is also always enabled in **Redpanda Cloud** (no license step needed).

## Supported Object Storage Providers

- Amazon S3
- Google Cloud Storage (GCS — uses the Google Cloud Platform S3-compatible API)
- Microsoft Azure Blob Storage (ABS)
- Microsoft Azure Data Lake Storage (ADLS)

Multi-region buckets are **not** supported. Migrating between providers or between buckets is **not** supported.

## Enabling Tiered Storage

### New Topic (v26.1+ Recommended Method)

The `redpanda.storage.mode=tiered` topic property is the recommended way to enable Tiered Storage starting in Redpanda v26.1:

```bash
# At topic creation
rpk topic create archive-topic -p 6 -r 3 \
  -c redpanda.storage.mode=tiered \
  --brokers localhost:9092
```

### Existing Topic (v26.1+)

```bash
# Convert a local topic to tiered (object storage must be configured)
rpk topic alter-config archive-topic \
  --set redpanda.storage.mode=tiered \
  --brokers localhost:9092
```

When you enable Tiered Storage on a topic that already has data, Redpanda uploads existing local segments to object storage starting from the earliest offset on local disk.

> Caution: Redpanda strongly recommends against repeatedly toggling Tiered Storage on and off for a topic. Re-enabling after disabling can result in inconsistent data and gaps in object storage.

### Legacy Topic Properties (Pre-v26.1 or `redpanda.storage.mode=unset`)

For topics where `redpanda.storage.mode` is `unset` (the default before v26.1), Tiered Storage is controlled by two topic-level properties:

| Property | Effect |
|---|---|
| `redpanda.remote.write=true` | Uploads data from Redpanda to object storage |
| `redpanda.remote.read=true` | Allows Redpanda to fetch data from object storage for consumers |

```bash
# Enable on a new topic (legacy method)
rpk topic create archive-topic \
  -c redpanda.remote.read=true \
  -c redpanda.remote.write=true \
  --brokers localhost:9092

# Enable on an existing topic (legacy method)
rpk topic alter-config archive-topic \
  --set redpanda.remote.read=true \
  --set redpanda.remote.write=true \
  --brokers localhost:9092
```

> Note: `redpanda.remote.read` and `redpanda.remote.write` have **no effect** on topics where `redpanda.storage.mode` is set to anything other than `unset` (i.e., `local`, `tiered`, `cloud`, or `tiered_cloud`).

### Cluster-Wide Default (Legacy)

For legacy (`unset`) topics, the cluster-level properties `cloud_storage_enable_remote_write` and `cloud_storage_enable_remote_read` set the default for all newly created topics. Changing these has no effect on existing topics.

In v26.1+, use `default_redpanda_storage_mode` instead:

```bash
# Default all new topics to tiered storage
rpk cluster config set default_redpanda_storage_mode=tiered \
  --brokers localhost:9092
```

## Storage Mode Reference

| `redpanda.storage.mode` | Local disk | Object storage | Notes |
|---|---|---|---|
| `unset` (default) | Yes | Controlled by `redpanda.remote.read/write` | Legacy behavior |
| `local` | Yes | No | Upload disabled regardless of cluster config |
| `tiered` | Yes (as cache) | Yes | Tiered Storage fully enabled |
| `cloud` | Write buffer only | Primary storage | Cloud Topics architecture |
| `tiered_cloud` | Yes (local + tiered) | Yes | Internal combined mode; present in source but not a user-settable value via topic config |

Transitions allowed:
- `local` → `tiered`: Yes
- `tiered` → `local`: With caution (can create gaps in object storage; avoid toggling repeatedly)
- Any → `cloud`: No (Cloud Topics can only be set at creation)
- `cloud` → Any: No

## Retention with Tiered Storage

With Tiered Storage enabled, retention operates at two levels:

### Total (Object Storage) Retention

| Property | Default | Applies to |
|---|---|---|
| `retention.ms` | 604800000 (7 days) | Total data age — local + object storage |
| `retention.bytes` | -1 (unlimited) | Total data size per partition — local + object storage |

Data becomes eligible for deletion from object storage when `retention.ms` or `retention.bytes` is exceeded. If neither is set, cluster-level defaults apply.

### Local Retention

| Property | Default | Applies to |
|---|---|---|
| `retention.local.target.ms` | 86400000 (1 day, as of v22.3) | Local disk age target |
| `retention.local.target.bytes` | -1 | Local disk size target per partition |

These properties control how long data stays on local disk. Data expired from local disk is still accessible via remote read if `retention.ms` / `retention.bytes` have not expired. These are equivalent to `retention.ms` / `retention.bytes` without Tiered Storage.

Example: retain 1 day locally, 90 days in object storage:

```bash
rpk topic alter-config archive-topic \
  --set retention.local.target.ms=86400000 \
  --set retention.ms=7776000000 \
  --brokers localhost:9092
```

### Compacted Topics

When `cleanup.policy=compact`, nothing is deleted from object storage based on retention. With `cleanup.policy=compact,delete`, compacted segments are deleted from object storage based on `retention.ms` and `retention.bytes`.

## Topic Deletion and Object Storage Cleanup

The property `redpanda.remote.delete` (default `true`) controls whether deleting a topic also deletes its objects in object storage:

```bash
# Default: delete objects in object storage when topic is deleted
# (redpanda.remote.delete=true)

# Prevent object deletion when topic is deleted
rpk topic alter-config archive-topic \
  --set redpanda.remote.delete=false \
  --brokers localhost:9092
```

As of Redpanda v22.3, when you delete a topic, data is also deleted in object storage (default behavior).

## Reading Historical Data

Consumers do not need any special configuration to read data from object storage. The broker's fetch handler retrieves segments from object storage transparently when a consumer requests offsets that are no longer on local disk. The client uses the standard `Fetch` Kafka API on port 9092.

To consume from the beginning of a topic with tiered data:

```bash
rpk topic consume archive-topic \
  --from-beginning \
  --brokers localhost:9092
```

Or in Java:

```java
props.put("auto.offset.reset", "earliest");
consumer.subscribe(List.of("archive-topic"));
```

## Remote Read Replicas

Remote Read Replicas are read-only topic mirrors backed by object storage. A different cluster can serve read-only access to a topic's data from object storage without impacting the primary cluster. This is configured at the cluster/topic level and is transparent to consumers — they use the same Kafka API.

For setup and operational details (object storage credentials, bucket config, cluster properties), see the Admin API skill or the Redpanda Tiered Storage documentation.

## Limitations

- Multi-region object storage buckets are not supported.
- Migrating a topic from one bucket or provider to another is not supported.
- Atomicity of transactions is not guaranteed when remote recovery is used (self-managed).
- In Redpanda Cloud, `delete.retention.ms` is not supported for Tiered Storage topics for tombstone marker deletion.
- Re-enabling Tiered Storage after disabling it is strongly discouraged — it can result in data gaps.
