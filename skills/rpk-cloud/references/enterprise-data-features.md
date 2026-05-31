# Enterprise data features on Redpanda Cloud clusters

Redpanda Cloud is a fully managed deployment of **Redpanda Enterprise Edition**, so the enterprise/differentiator features are licensed and available out of the box — you do not apply your own license key (the platform owns it). Once you have wired an rpk profile to a Cloud cluster (`rpk cloud cluster select`, see [clusters-and-resourcegroups.md](clusters-and-resourcegroups.md)), the same `rpk topic`, `rpk cluster config`, and `rpk cluster storage` commands operate against the Cloud data plane.

This reference covers the enterprise data-plane features you drive through rpk against a Cloud cluster:

- Mountable Topics (Tiered Storage mount / unmount — topic migration & DR)
- Iceberg Topics
- Cloud Topics
- Tiered Storage topic-level retention

> License: all of these are **Enterprise** features. On Redpanda Cloud the license is supplied by the managed platform. On self-managed Redpanda the same features require an Enterprise Edition license key (`rpk cluster license info` / `rpk cluster license set`). See the canonical enterprise feature list in `get-started/licensing/overview.adoc`.

---

## Mountable Topics — Tiered Storage mount / unmount

Mountable Topics let you detach a topic to object storage (Tiered Storage) and re-attach ("mount") it to the **same or a different** cluster, as long as the log segments are reachable in that cluster's Tiered Storage bucket. This is the foundation for topic-level migration and disaster recovery. It is built on **Tiered Storage**, an Enterprise feature.

Commands live under `rpk cluster storage` (they detect a Cloud profile via `CheckFromCloud()` and route to the Cloud data-plane `CloudStorageService` instead of the Admin API):

| Command | Cloud data-plane RPC | Purpose |
|---|---|---|
| `rpk cluster storage list-mountable` | `CloudStorageService.ListMountableTopics` | List topics in object storage that can be mounted |
| `rpk cluster storage mount [TOPIC] [--to NS/NAME]` | `CloudStorageService.MountTopics` | Mount a topic from Tiered Storage into the cluster (optionally rename) |
| `rpk cluster storage unmount [TOPIC]` | `CloudStorageService.UnmountTopics` | Flush a topic to Tiered Storage and remove it from the cluster |
| `rpk cluster storage list-mount` (alias `list-unmount`) | `CloudStorageService.ListMountTasks` | List in-flight/finished mount & unmount operations |
| `rpk cluster storage status-mount [ID]` (alias `status-unmount`) | `CloudStorageService.GetMountTask` | Status of a single mount/unmount migration |
| `rpk cluster storage cancel-mount [ID]` (alias `cancel-unmount`) | `CloudStorageService.UpdateMountTask` (action `CANCEL`) | Cancel an in-flight migration |

### Cloud-specific behavior (grounded in rpk source)

- **Namespace restriction**: On a Cloud cluster only the `kafka` namespace is allowed. Passing any other namespace (e.g. `myns/topic` or `--to myns/new`) fails with `namespace %q not allowed; only kafka topics can be mounted/unmounted in Redpanda Cloud clusters`. On self-managed clusters the `<namespace>/<topic>` form is honored (default namespace `kafka`).
- **Mount with rename**: `rpk cluster storage mount my-topic --to my-new-topic` sets the `Alias` on the `MountTopicsRequest_TopicMount`; `SourceTopicReference` is the source topic.
- **Migration ID**: `mount`/`unmount` return a numeric **Migration ID** (`MountTaskId`). Track it with `status-mount <ID>`; cancel it with `cancel-mount <ID>`.
- **`list-mount --filter` (`-f`)** accepts: `planned`, `prepared`, `executed`, `finished`, or `all` (default). Filtering is text-output only.
- **`status-mount` states** are reported with the `STATE_` prefix trimmed.
- **`list-mountable` columns**: `Topic`, `Namespace` (defaults to `kafka`), `Location` (the object-storage location).

### Unmount semantics

Unmount (1) rejects writes to the topic, (2) flushes data to Tiered Storage, (3) removes the topic from the cluster. During unmount, reads/writes return `UNKNOWN_TOPIC_OR_PARTITION`. Unmount runs independently of `redpanda.remote.delete=false`. After unmount the topic can be remounted to this or another cluster whose Tiered Storage holds the segments.

### Example: migrate a topic between Cloud clusters

```bash
# On the source cluster (profile already wired with rpk cloud cluster select)
rpk cluster storage unmount my-topic
# -> Migration ID 42
rpk cluster storage status-mount 42         # wait until finished

# On the destination cluster
rpk cloud cluster select dest-cluster
rpk cluster storage list-mountable          # confirm my-topic is visible
rpk cluster storage mount my-topic --to my-topic
rpk cluster storage status-mount <new-id>
```

> Serverless clusters: these commands call `config.CheckExitServerlessAdmin(p)` and exit early on Serverless (no Admin-API-style access). Mountable topics apply to BYOC / Dedicated.

---

## Iceberg Topics

Iceberg Topics write a topic's data to object storage in the **Apache Iceberg** open table format (Parquet data files + Iceberg metadata/catalog), making streaming data queryable directly by lakehouse tools (Snowflake, Databricks, ClickHouse, Spark, Flink, etc.) without ETL. **Enterprise feature.** On Cloud, supported for **BYOC / BYOVPC** clusters running v25.1+.

### Enable at the cluster level

```bash
rpk cloud login
rpk cloud cluster select <cluster>           # or: rpk profile create --from-cloud <cluster-id>
rpk cluster config set iceberg_enabled true
# Optional: custom catalog namespace (default "redpanda"); cannot be changed after enabling.
rpk cluster config set iceberg_default_catalog_namespace '["<custom-namespace>"]'
```

When multiple clusters write to the same REST catalog (e.g. AWS Glue, which has one global catalog per account), give each cluster a distinct `iceberg_default_catalog_namespace` to avoid table-name collisions.

### Per-topic Iceberg configuration keys

Set with `rpk topic create <t> --topic-config=KEY=VALUE` (or `-c KEY=VALUE`) or `rpk topic alter-config <t> --set KEY=VALUE`.

| Topic property | Cluster default property | Type / accepted values | Default | Meaning |
|---|---|---|---|---|
| `redpanda.iceberg.mode` | — | enum: `key_value`, `value_schema_id_prefix`, `value_schema_latest`, `disabled` | `disabled` (self-managed shows `null`) | Enables Iceberg for the topic and chooses table schema strategy |
| `redpanda.iceberg.delete` | `iceberg_delete` | boolean | `true` | Whether the Iceberg table is deleted when the topic is deleted. Set `false` to keep the table |
| `redpanda.iceberg.partition.spec` | `iceberg_default_partition_spec` | string (Iceberg partition spec) | `(hour(redpanda.timestamp))` | Custom partitioning, e.g. `(col1)`, `(col1, col2)`, `(year(ts1), col1)` |
| `redpanda.iceberg.target.lag.ms` | `iceberg_target_lag_ms` | integer (ms) | (cluster default) | How often the Iceberg table is refreshed with new topic data |
| `redpanda.iceberg.invalid.record.action` | `iceberg_invalid_record_action` | enum: `dlq_table`, `drop` | `dlq_table` | What to do with records that cannot be translated. `dlq_table` writes them to a `<topic-name>~dlq` table; `drop` discards them |

### Iceberg modes

- `key_value`: two-column table (record metadata incl. key; binary value column). No schema required.
- `value_schema_id_prefix`: table columns match the registered schema; producers must use the Schema Registry wire format.
- `value_schema_latest`: table columns match the **latest** registered schema for the subject.
- `disabled` (default): no Iceberg table for the topic.

For `value_schema_id_prefix` / `value_schema_latest` you must register a schema:

```bash
rpk topic create page-views --topic-config=redpanda.iceberg.mode=key_value
rpk topic alter-config page-views --set redpanda.iceberg.mode=value_schema_id_prefix
rpk topic create events -p5 -r3 \
  -c redpanda.iceberg.mode=value_schema_id_prefix \
  -c "redpanda.iceberg.partition.spec=(year(ts), region)"
rpk registry schema create events-value --schema ./events.avsc --type avro
```

---

## Cloud Topics

**Cloud Topics** (v26.1+) store a topic's data primarily in object storage (S3/ADLS/GCS/MinIO) with local disk only as a write buffer, eliminating cross-AZ replication network cost for latency-tolerant, high-throughput workloads. Enterprise feature.

**Prerequisite — enable Cloud Topics at the cluster level.** Before any topic can use Cloud Topic storage, the cluster property `cloud_topics_enabled` (type `boolean`, default `false`) must be set to `true`. Setting it to `true` requires an Enterprise license, and the change requires a cluster restart to take effect.

```bash
rpk cluster config set cloud_topics_enabled=true
# verify
rpk cluster config get cloud_topics_enabled
```

Two topic properties then control this per topic (you can make a topic a Cloud Topic only at creation time):

| Topic property | Type / values | Notes |
|---|---|---|
| `redpanda.cloud_topic.enabled` | string (boolean-like) | Enables Cloud Topic storage mode for the topic |
| `redpanda.storage.mode` | enum: `local`, `tiered`, `cloud`, `unset` | More flexible storage selector (v26.1.1+). `cloud` = Cloud Topics; `tiered` = Tiered Storage; `local` = disk only; `unset` = follow cluster default. Overrides cluster `default_redpanda_storage_mode` |

```bash
rpk topic create obs-stream --topic-config=redpanda.cloud_topic.enabled=true
# or, with the storage-mode selector:
rpk topic create obs-stream --topic-config=redpanda.storage.mode=cloud
```

Expect end-to-end latency of ~1-2 seconds with public cloud object stores (data is acknowledged only after upload to object storage). Use Cloud Topics for observability streams, offline analytics, AI/ML training feeds, and dev environments — not for latency-sensitive paths.

---

## Tiered Storage topic-level retention

On Cloud, Tiered Storage itself is managed by the platform, but you still control per-topic Tiered Storage behavior and local retention through topic properties:

| Topic property | Cluster default property | Type | Meaning |
|---|---|---|---|
| `redpanda.remote.read` | `cloud_storage_enable_remote_read` | boolean | Fetch topic data from object storage to local. With `redpanda.remote.write=true`, enables Tiered Storage for the topic |
| `redpanda.remote.write` | `cloud_storage_enable_remote_write` | boolean | Upload topic data to object storage |
| `redpanda.remote.delete` | — | boolean | Delete object-storage data when the topic's local data is deleted. Does not apply to Remote Read Replica topics |
| `initial.retention.local.target.bytes` | `initial_retention_local_target_bytes_default` | bytes | Local retention target (size) for newly created/recovered partitions |
| `initial.retention.local.target.ms` | `initial_retention_local_target_ms_default` | ms | Local retention target (time) for newly created/recovered partitions |

> Tombstone removal cannot be enabled on a topic that has `redpanda.remote.read` or `redpanda.remote.write` set.

```bash
rpk topic alter-config logs --set redpanda.remote.write=true --set redpanda.remote.read=true
rpk topic alter-config logs --set initial.retention.local.target.bytes=1073741824
```

---

## Features managed elsewhere

Some enterprise differentiators are configured outside the `rpk cloud` / Cloud-data-plane surface and are intentionally not duplicated here:

- **Shadow Linking** (cross-cluster DR, `rpk shadow`), **Remote Read Replicas**, **Continuous Data Balancing** (`partition_autobalancing_mode=continuous`), **Leadership Pinning** (`default_leaders_preference`), **Audit Logging** (`audit_enabled`), **FIPS** (`fips_mode`), **Server-side Schema ID Validation** (`enable_schema_id_validation`), and SASL **OIDC/OAuthBearer/Kerberos** mechanisms are cluster-level / self-managed concerns. See `get-started/licensing/overview.adoc` and `get-started/licensing/disable-enterprise-features.adoc` for the full enterprise list and the config key used to disable each.
- **RBAC / IAM** for Cloud is covered in [rbac-and-iam.md](rbac-and-iam.md).
