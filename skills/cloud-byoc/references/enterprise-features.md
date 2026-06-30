# Enterprise Features on BYOC Clusters

Redpanda Cloud (BYOC and BYOVPC) is a managed deployment of **Redpanda Enterprise Edition** — the enterprise license is included with your Cloud subscription, so you do **not** apply a license key yourself. Every enterprise differentiator below is available on a BYOC cluster; you enable it through cluster configuration and topic properties, not through a license workflow.

Source grounding: `docs/modules/get-started/pages/licensing/overview.adoc`, the per-feature pages under `docs/modules/manage/` and `docs/modules/develop/`, and the property partials under `docs/modules/reference/partials/properties/`.

---

## How to set enterprise config on a BYOC cluster

There are two surfaces. Both are valid; pick based on whether the property is a **cluster config** or a **topic property**.

### 1. Cluster configuration via the Control Plane API

Cluster-level enterprise properties (e.g. `iceberg_enabled`, `audit_enabled`, `partition_autobalancing_mode`, `default_leaders_preference`, `enable_schema_id_validation`) are set through `custom_properties`.

At **create time** (`POST /v1/clusters`) or at **update time** (`PATCH /v1/clusters/{id}`), nest them under `cluster_configuration.custom_properties`:

```bash
# Enable an enterprise cluster property after the cluster exists.
# Integer-valued properties must be passed as strings in custom_properties.
# update_mask is a REQUIRED query parameter (snake_case field paths); the body IS the
# ClusterUpdate object directly (no "cluster" wrapper, no update_mask inside the body).
curl -s -X PATCH "https://api.redpanda.com/v1/clusters/${CLUSTER_ID}?update_mask=cluster_configuration.custom_properties" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "cluster_configuration": {
      "custom_properties": {
        "iceberg_enabled": "true"
      }
    }
  }' | jq '.operation.id'
```

The PATCH returns a long-running `Operation` (can take up to ~10 minutes). Poll `GET /v1/operations/{id}` until `STATE_COMPLETED`.

### 2. Cluster configuration / topic properties via the data plane (rpk)

Once the cluster is `STATE_READY`, point rpk at the data plane and use the normal Admin/Kafka APIs:

```bash
rpk cloud login
rpk profile create --from-cloud <cluster-id>

# Cluster config (Admin API)
rpk cluster config set iceberg_enabled true

# Topic property (Kafka API)
rpk topic alter-config <topic> --set redpanda.iceberg.mode=key_value
```

> Cluster-config changes that require a cluster restart (e.g. `iceberg_enabled`) are handled by the control plane in Cloud; you do not restart brokers yourself.

---

## Tiered Storage (always on in Cloud)

Tiered Storage is the foundation of Cloud BYOC — every cluster writes log segments to the object-storage bucket you registered in `customer_managed_resources` (`cloud_storage_bucket.arn` on AWS, `tiered_storage_bucket.name` on GCP, `tiered_cloud_storage.*` on Azure — see `clusters-and-agent.md`).

Per-topic Tiered Storage properties (grounded in `topic-properties.adoc`):

| Property | Type | Meaning |
|---|---|---|
| `redpanda.remote.write` | bool | Upload local segments to object storage. Cluster default: `cloud_storage_enable_remote_write`. |
| `redpanda.remote.read` | bool | Fetch segments from object storage to local. Cluster default: `cloud_storage_enable_remote_read`. |
| `redpanda.remote.delete` | bool | Delete objects from storage when the topic/data is deleted. |
| `redpanda.remote.recovery` | bool | Recover/reproduce a topic from object storage. Create-time only — cannot be altered on an existing topic. (Topic Recovery enterprise feature.) |
| `redpanda.storage.mode` | string | Newer unified control: `local`, `tiered`, `cloud`, or `unset`. |

License note: Tiered Storage is an Enterprise feature. Topic Recovery (`redpanda.remote.recovery=true`) and Whole Cluster Restore (WCR) are also enterprise-gated. All are included with the Cloud subscription.

---

## Cloud Topics (object-storage-native topics)

Cloud Topics store data primarily in object storage, using local disk only as a write buffer. Enterprise feature.

| Property | Type | Meaning |
|---|---|---|
| `redpanda.cloud_topic.enabled` | string | Enable Cloud Topic storage mode for the topic. |
| `redpanda.storage.mode=cloud` | string | Preferred, more flexible control (supports `local`, `tiered`, `cloud`, `unset`). |

```bash
# Create a Cloud Topic on the data plane
rpk topic create -c redpanda.storage.mode=cloud <topic-name>

# Or make cloud the cluster default
rpk cluster config set default_redpanda_storage_mode cloud
```

License behavior: without a valid license, new Cloud Topics cannot be created and existing ones cannot be modified (including partition changes).

---

## Iceberg Topics

Iceberg integration writes topic data as Apache Iceberg (Parquet) tables in your object-storage bucket, in addition to the Tiered Storage log segments. Supported on BYOC/BYOVPC clusters running Redpanda 25.1+. Enterprise feature.

**Cluster config** (set via `custom_properties` or `rpk cluster config set`):

| Cluster property | Meaning |
|---|---|
| `iceberg_enabled` | Master switch. Must be `true` before any topic can use Iceberg. |
| `iceberg_default_catalog_namespace` | Namespace (default `redpanda`). Set when enabling Iceberg; **cannot** be changed afterward. Critical when multiple clusters share one REST catalog (e.g. AWS Glue). Passed as a JSON list, e.g. `'["my-ns"]'`. |
| `iceberg_delete` | Cluster default for `redpanda.iceberg.delete`. |
| `iceberg_invalid_record_action` | Cluster default for `redpanda.iceberg.invalid.record.action`. |
| `iceberg_default_partition_spec` | Cluster default for `redpanda.iceberg.partition.spec`. |

**Topic properties** (grounded in `topic-properties.adoc`):

| Topic property | Type | Values / Default |
|---|---|---|
| `redpanda.iceberg.mode` | string | `key_value`, `value_schema_id_prefix`, `value_schema_latest`, or `disabled` (default). Enables the integration for the topic. |
| `redpanda.iceberg.delete` | bool | Delete the Iceberg table when the topic is deleted. Default `true`. Set `false` to keep the table. |
| `redpanda.iceberg.invalid.record.action` | string (enum) | `drop` or `dlq_table` (default). Where invalid records go (DLQ table `<topic>~dlq`). |
| `redpanda.iceberg.partition.spec` | string | Iceberg partitioning spec. Default `(hour(redpanda.timestamp))`. |
| `redpanda.iceberg.target.lag.ms` | integer (ms) | How often the Iceberg table is refreshed from the topic. |

```bash
# 1. Enable at the cluster level (Control Plane API)
#    update_mask is a REQUIRED query param (snake_case field paths); body is the ClusterUpdate object directly.
curl -s -X PATCH "https://api.redpanda.com/v1/clusters/${CLUSTER_ID}?update_mask=cluster_configuration.custom_properties" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d '{"cluster_configuration":{"custom_properties":{"iceberg_enabled":"true"}}}'

# 2. Enable per topic (data plane)
rpk topic create my-iceberg-topic
rpk topic alter-config my-iceberg-topic --set redpanda.iceberg.mode=value_schema_latest
```

`value_schema_id_prefix` and `value_schema_latest` require a registered schema in the Schema Registry.

---

## Continuous Data Balancing

Self-healing partition balancing across nodes/racks based on node availability and disk pressure. Enabled by default on new Cloud clusters. Enterprise feature.

Cluster config (set via `custom_properties` or `rpk cluster config set`):

| Cluster property | Meaning / Default |
|---|---|
| `partition_autobalancing_mode` | `continuous` to enable; `node_add` is the non-enterprise fallback; `off` disables all balancing. |
| `partition_autobalancing_node_availability_timeout_sec` | Unreachable-node timeout before replicas are re-created elsewhere. Default 900 (15 min). |
| `partition_autobalancing_node_autodecommission_timeout_sec` | Unavailable-node timeout before permanent auto-decommission. `continuous` mode only. Default null (disabled). |
| `partition_autobalancing_max_disk_usage_percent` | Disk-usage threshold that triggers moving replicas off a node. Default 80(%). |
| `core_balancing_continuous` | Continuous Intra-Broker (per-CPU-core) partition balancing. Separate enterprise feature; bool. |

```bash
rpk cluster partitions balancer-status          # off | ready | starting | in-progress | stalled
rpk cluster partitions movement-cancel [--node N]
```

License behavior on expiration: reverts to `node_add`; `core_balancing_continuous` is disabled.

---

## Shadow Linking (cross-cluster disaster recovery)

Shadowing is Redpanda's enterprise-grade DR: asynchronous, offset-preserving, byte-level replication between two clusters (active-passive). Supported on BYOC and Dedicated clusters on Redpanda 25.3+. It replicates topic data (offsets + timestamps preserved), topic configs, consumer group offsets, ACLs, and Schema Registry data.

Driven by `rpk shadow`. In Cloud, use the `--for-cloud` flag where shown.

```bash
# On the SHADOW (target) cluster:
rpk cloud login
rpk cloud cluster select

# 1. Generate a config skeleton (Cloud variant)
rpk shadow config generate --for-cloud -o shadow-link.yaml
# (or with inline field docs)
rpk shadow config generate --print-template -o shadow-link.yaml

# For SCRAM auth, store the source password in the secret store and reference
# it in the config as ${secrets.SECRET_NAME}.

# 2. Create the shadow link
rpk shadow create --config-file shadow-link.yaml [--no-confirm]

# 3. Monitor replication
rpk shadow status
rpk shadow list
rpk shadow describe [LINK_NAME]
rpk shadow update [LINK_NAME] ...

# 4. Disaster: fail over (converts shadow topics to writable regular topics; replication stops)
rpk shadow failover [LINK_NAME] --all          # or --topic <name>   (+ optional --no-confirm)

rpk shadow delete [LINK_NAME]
```

Key constraints (from `shadowing/overview.adoc`): each shadow cluster maintains exactly **one** shadow link; async only (no active-active); data transforms are blocked on the shadow cluster while shadowing is active; no automatic fallback to the original source after failover — reconfigure all clients to the shadow cluster before resuming writes to avoid split-brain.

License behavior: new shadow links cannot be created without a license; existing links keep operating and can be updated.

---

## Remote Read Replicas

Read-only clusters that serve data directly from another cluster's object storage. Enterprise feature.

| Property | Type | Meaning |
|---|---|---|
| `redpanda.remote.readreplica` | string (topic) | Name of the object-storage bucket of the source Tiered Storage topic. Cannot be combined with `redpanda.remote.read`/`redpanda.remote.write`. |
| `cloud_storage_enable_remote_read` | bool (cluster) | Cluster gate for remote reads; disabling it turns off RRR. |

---

## Security & access-control enterprise features

All of these are configured on the data plane (Admin/Kafka API) once the cluster is `STATE_READY`, or via `custom_properties` for cluster-config-backed ones.

### Role-Based Access Control (RBAC)
Manage permissions at scale via roles. Enterprise feature.
```bash
rpk security role create <role>
rpk security role list
rpk security role delete <role>
```
On expiration: roles/role-ACLs cannot be created or modified (deletion still allowed).

### Group-Based Access Control (GBAC)
ACLs/role assignments keyed on OIDC group memberships (`Group:` principals). Enterprise feature. On expiration, `Group:` ACLs cannot be created (existing ones still evaluated/deletable).

### Audit Logging
Records cluster activity to the internal `_redpanda.audit_log` topic. Enterprise feature. Cluster config:

| Cluster property | Meaning / Default |
|---|---|
| `audit_enabled` | Master switch. |
| `audit_log_num_partitions` | Partitions for the audit topic. Default 12. Set **before** enabling; cannot be altered after the topic exists. |
| `audit_log_replication_factor` | Replication factor for the audit topic. Set before enabling. |
| `audit_enabled_event_types` | JSON list: any of `management, produce, consume, describe, heartbeat, authenticate, schema_registry, admin`. Default `'["management","authenticate","admin"]'`. |
| `audit_excluded_topics` | JSON list of topics to ignore (cannot include `_redpanda.audit_log`). Default null. |
| `audit_excluded_principals` | JSON list of principals to ignore (`User:name` or `name`). Default null. |
| `audit_client_max_buffer_size` | Bytes for the internal audit client buffer. Default 16777216. Toggle audit off/on to apply changes. |
| `audit_queue_drain_interval_ms` | Drain interval to the audit topic. Default 500. |

```bash
rpk cluster config set audit_log_num_partitions 6
rpk cluster config set audit_enabled_event_types '["management","describe","authenticate"]'
rpk cluster config set audit_enabled true
```
On expiration: read access to the audit topic is denied, but logging continues.

### OIDC / OAUTHBEARER and Kerberos (GSSAPI) authentication
Enterprise authentication mechanisms, configured via cluster config:

| Cluster property | Meaning |
|---|---|
| `sasl_mechanisms` | Include `OAUTHBEARER` (OIDC) and/or `GSSAPI` (Kerberos) alongside `SCRAM`. |
| `http_authentication` | Include `OIDC` for the HTTP Proxy / Schema Registry / Admin API. |

On expiration: no change to existing auth, but you cannot newly enable these.

### Server-Side Schema ID Validation
Brokers detect and drop records whose schema IDs are not registered per the subject-name strategy. Enterprise feature.

| Property | Type | Meaning / Default |
|---|---|---|
| `enable_schema_id_validation` | cluster | `none` (default, off), `redpanda`, or `compat`. |
| `redpanda.key.schema.id.validation` | topic (bool) | Validate key schema IDs. |
| `redpanda.value.schema.id.validation` | topic (bool) | Validate value schema IDs. |
| `redpanda.key.subject.name.strategy` | topic | Subject-name strategy for keys. Default `TopicNameStrategy`. |
| `redpanda.value.subject.name.strategy` | topic | Subject-name strategy for values. Default `TopicNameStrategy`. |

```bash
rpk cluster config set enable_schema_id_validation redpanda
rpk topic alter-config <topic> --set redpanda.value.schema.id.validation=true
```

### Schema Registry Authorization
ACLs for Schema Registry resources. Enterprise feature. Gated by cluster property `schema_registry_enable_authorization`.

### FIPS Compliance
FIPS-validated cryptography. Enterprise feature. Node-level property `fips_mode` (`enabled` / `disabled` / `permissive`). For Cloud, FIPS is selected at cluster provisioning — request a FIPS-enabled BYOC cluster rather than toggling it on a running cluster.

### Encryption keys (BYOK / CMK not offered)
Redpanda Cloud uses Redpanda-managed encryption keys; **customer-managed keys (BYOK / CMK) are not offered**. Data at rest is encrypted with keys Redpanda manages. Source: `cloud-data-platform/security/cloud-encryption/`.

---

## Leadership Pinning

Pins partition leaders to preferred availability zones/racks to lower cross-AZ latency and networking cost. Requires rack awareness (`enable_rack_awareness=true`; in Cloud the broker `rack` labels map to AZs). Enterprise feature.

| Property | Scope | Values / Default |
|---|---|---|
| `default_leaders_preference` | cluster | Default for all topics. `none` (default), `racks:<r1>[,<r2>...]`, or `ordered_racks:<r1>[,<r2>...]` (priority order; 26.1+). |
| `redpanda.leaders.preference` | topic | Same value grammar; overrides the cluster default per topic. |

```bash
rpk cluster info     # shows broker RACK (AZ) identifiers
rpk cluster config set default_leaders_preference ordered_racks:use1-az1,use1-az2
rpk topic alter-config <topic> --set redpanda.leaders.preference=racks:use1-az1
```

`ordered_racks` is ideal for a primary-AZ-with-failover layout. On expiration: Leader Pinning is disabled on all topics.

---

## Other license-gated controls relevant to operators

| Control | Property | Notes |
|---|---|---|
| Topic Deletion Control | `delete_topic_enable` | Cluster-wide guard against accidental topic deletion (blocks even superusers via DeleteTopics). On expiration reverts to `true`. |
| Whole Cluster Restore (WCR) | n/a (operation) | Restore a cluster from a source snapshot in object storage. Enterprise-gated. |
| Topic Recovery | `redpanda.remote.recovery=true` (topic) | Restore a single topic from Tiered Storage. Create-time only. |

---

## Redpanda Connect enterprise connectors

Managed Redpanda Connect pipelines on Cloud can use enterprise-only inputs/outputs/processors (including all CDC inputs). These run as data-plane pipelines, not as cluster config. The connector catalog marks enterprise components; they are unlocked by the Cloud subscription. See the dedicated Redpanda Connect / pipelines skill for pipeline configuration.

> **Kafka Connect** (the separate managed Kafka Connect runtime, distinct from Redpanda Connect) is **disabled by default on new clusters** (since July 2025). Enable it explicitly if you need it.
