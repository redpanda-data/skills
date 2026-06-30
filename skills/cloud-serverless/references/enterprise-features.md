# Enterprise Features on Serverless Clusters

Redpanda Cloud is a managed deployment of **Redpanda Enterprise Edition**, so the
enterprise license is bundled — you do not apply an `rpk cluster license set` key
on Serverless. What matters for Serverless users is **which** enterprise
differentiators are user-configurable and **how** to set them.

On Serverless (fully managed, shared infrastructure) most cluster- and node-level
enterprise features are operated by Redpanda and are not user-tunable
(Tiered Storage internals, FIPS node config, Continuous Data Balancing
thresholds, Audit Logging cluster config, Whole Cluster Restore). The enterprise
differentiators you **do** configure on Serverless are exposed as **topic
configuration keys** through the Data Plane API (`${DP_URL}/v1/topics`) and as
**RBAC roles** through `${DP_URL}/v1/roles`.

Grounding: topic property keys, defaults, and accepted values are taken from
`docs/modules/reference/partials/properties/topic-properties.adoc`; the
enterprise-license requirement and per-feature behavior on license expiry are
from `docs/modules/get-started/pages/licensing/overview.adoc`. Lines flagged
`Available in the Redpanda Cloud Console` in the source confirm Cloud
(including Serverless) availability of the property.

> All keys below require the **Enterprise Edition** license. On Redpanda Cloud
> that license is included; the table at the end maps each key to the
> self-managed cluster property and the documented behavior on license expiry.

---

## Iceberg Topics (Enterprise)

Iceberg Topics expose a Redpanda topic as an Apache Iceberg table in object
storage so query engines (Snowflake, Databricks, Spark, Trino, AWS Athena) can
read the topic's data directly. You enable it **per topic** via topic configs;
there is no Serverless cluster toggle to flip (the cluster-level
`iceberg_enabled` is managed by Redpanda).

Set the configs on topic create or with `PATCH .../configurations`:

```bash
# Enable Iceberg on a topic at create time:
curl -s -X POST "${DP_URL}/v1/topics" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "topic": {
      "name": "orders",
      "partition_count": 6,
      "configs": [
        {"name": "redpanda.iceberg.mode",            "value": "value_schema_id_prefix"},
        {"name": "redpanda.iceberg.target.lag.ms",   "value": "60000"},
        {"name": "redpanda.iceberg.partition.spec",  "value": "(hour(redpanda.timestamp))"},
        {"name": "redpanda.iceberg.invalid.record.action", "value": "dlq_table"},
        {"name": "redpanda.iceberg.delete",          "value": "true"}
      ]
    }
  }' | jq .

# Or enable/adjust on an existing topic (incremental PATCH):
curl -s -X PATCH "${DP_URL}/v1/topics/orders/configurations" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"configurations": [{"name": "redpanda.iceberg.mode", "value": "value_schema_latest"}]}' | jq .
```

### Iceberg topic config keys

| Key | Type | Accepted values / format | Self-managed default | Purpose |
|---|---|---|---|---|
| `redpanda.iceberg.mode` | string (enum) | `disabled`, `key_value`, `value_schema_id_prefix`, `value_schema_latest` | `disabled` (`null` until set) | Enables the integration and selects the table layout. |
| `redpanda.iceberg.target.lag.ms` | integer | milliseconds | `null` | How often the Iceberg table is committed with new topic data. Lower = fresher data, more overhead. |
| `redpanda.iceberg.partition.spec` | string | Iceberg partition spec, e.g. `(hour(redpanda.timestamp))` | `(hour(redpanda.timestamp))` | Partitioning specification for the Iceberg table. |
| `redpanda.iceberg.invalid.record.action` | string (enum) | `drop`, `dlq_table` | `dlq_table` | Where to send records that fail schema translation: drop them or route to a dead-letter-queue table. |
| `redpanda.iceberg.delete` | boolean | `true`, `false` | `true` | Whether the Iceberg table is deleted when the topic is deleted. Set `false` to retain the table. |

**Mode semantics** (from `about-iceberg-topics.adoc`):

- `key_value` — two columns: one for record metadata (including key), one binary
  column for the value. No Schema Registry entry required.
- `value_schema_id_prefix` — table columns mirror the registered schema; producers
  must write in the Schema Registry wire format. Requires a registered schema.
- `value_schema_latest` — table columns mirror the **latest** registered schema for
  the subject. Requires a registered schema.
- `disabled` — no Iceberg writes (default).

**On license expiry**: topics cannot be created or modified with
`redpanda.iceberg.mode`. (On Cloud the license is managed by Redpanda.)

---

## Server-Side Schema ID Validation (Enterprise)

Validates that the schema ID embedded in a record (Schema Registry wire format)
is registered before the broker accepts the record. Records referencing an
unregistered schema are **dropped by the broker** rather than reaching consumers.
Configured per topic.

```bash
curl -s -X PATCH "${DP_URL}/v1/topics/orders/configurations" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"configurations": [
    {"name": "redpanda.key.schema.id.validation",   "value": "true"},
    {"name": "redpanda.key.subject.name.strategy",  "value": "TopicNameStrategy"},
    {"name": "redpanda.value.schema.id.validation",  "value": "true"},
    {"name": "redpanda.value.subject.name.strategy", "value": "TopicNameStrategy"}
  ]}' | jq .
```

### Schema ID validation topic config keys

| Key | Type | Accepted values | Self-managed default | Purpose |
|---|---|---|---|---|
| `redpanda.key.schema.id.validation` | boolean | `true`, `false` | `false` | Validate the schema ID in the record **key**. |
| `redpanda.value.schema.id.validation` | boolean | `true`, `false` | `false` | Validate the schema ID in the record **value**. |
| `redpanda.key.subject.name.strategy` | string (enum) | `TopicNameStrategy`, `RecordNameStrategy`, `TopicRecordNameStrategy` | `TopicNameStrategy` | Maps topic + schema to a Schema Registry subject for keys. |
| `redpanda.value.subject.name.strategy` | string (enum) | `TopicNameStrategy`, `RecordNameStrategy`, `TopicRecordNameStrategy` | `TopicNameStrategy` | Same, for values. |

Confluent-compatible aliases also exist (`confluent.key.schema.validation`,
`confluent.value.schema.validation`, and the matching subject-name-strategy
aliases) — Redpanda treats them as compatibility aliases for the
`redpanda.*` keys above.

**On license expiry**: topics with schema validation settings cannot be created
or modified.

---

## Leadership Pinning (Enterprise)

Pins the leaders of a topic's partitions to a preferred location (rack /
availability zone). On Serverless you set it per topic via
`redpanda.leaders.preference`; it inherits from the cluster-wide
`default_leaders_preference`.

```bash
curl -s -X PATCH "${DP_URL}/v1/topics/orders/configurations" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"configurations": [{"name": "redpanda.leaders.preference", "value": "none"}]}' | jq .
```

| Key | Type | Self-managed default | Notes |
|---|---|---|---|
| `redpanda.leaders.preference` | object/string | `none` | Preferred rack(s) for partition leaders. Inherits cluster `default_leaders_preference`; disabled cluster-wide if `enable_rack_awareness=false`. |

**On license expiry**: Leader Pinning is disabled on all topics.

---

## Role-Based Access Control (Enterprise)

RBAC roles are managed through the Data Plane `SecurityService` at
`${DP_URL}/v1/roles` (see [Data Plane Reference](data-plane.md#security-roles-rbac)).
Roles bundle ACLs and are assigned to principals; this is the recommended way to
grant permissions at scale instead of per-principal ACLs.

```bash
# Create a role, then attach members:
curl -s -X POST "${DP_URL}/v1/roles" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"role": {"name": "topic-reader"}}' | jq .role

curl -s "${DP_URL}/v1/roles/topic-reader/members" \
  -H "Authorization: Bearer ${TOKEN}" | jq .
```

**On license expiry**: roles and role-associated ACLs cannot be created or
modified; deletion is still allowed.

---

## Features managed by Redpanda on Serverless (not user-configurable)

These enterprise differentiators exist in Redpanda Enterprise Edition but are
**not** exposed as user knobs on Serverless because Redpanda manages the
underlying infrastructure. Listed here so you do not waste time looking for an
API to set them:

| Feature | Why not user-configurable on Serverless |
|---|---|
| Tiered Storage (`cloud_storage_*`) | Storage is fully managed; Serverless is object-storage-native by design. |
| Customer-managed encryption keys (BYOK / CMK) | **Not offered on Redpanda Cloud** (any tier). Encryption keys are Redpanda-managed — data at rest uses SSE-S3 / cloud-provider AES-256. There is no API to bring your own key. Source: https://docs.redpanda.com/cloud-data-platform/security/cloud-encryption/ |
| Cloud Topics (`redpanda.cloud_topic.enabled`) | Managed cluster topology; not a tenant toggle. |
| Continuous Data Balancing (`partition_autobalancing_mode`, `partition_autobalancing_node_availability_timeout_sec`, disk-pressure thresholds) | Cluster-level balancing is managed by Redpanda. |
| FIPS mode (`fips_mode` node config) | Node configuration is not tenant-accessible. |
| Audit Logging (`audit_enabled` cluster config) | Cluster config not tenant-accessible. |
| Remote Read Replicas (`cloud_storage_enable_remote_read`) | Cross-cluster object-storage reads are not a Serverless tenant feature. |
| Shadow Linking / cross-cluster DR (`rpk shadow`, `ShadowLinkService`) | Shadow Linking is a **control-plane** API (`ShadowLinkService` at `https://api.redpanda.com`: `/v1/shadow-links`, `/v1/shadow-links/{id}`), with a data-plane shadow-topic/failover surface at `/v1/shadow-links/{name}/...`. Availability on Serverless is **unconfirmed** (see data-plane.md); DR for Serverless is handled by the managed platform. |
| Whole Cluster Restore | Cluster-snapshot restore is a managed/self-managed operation, not a Serverless tenant API. |

To configure these, use a **BYOC or Dedicated** cluster (see the `cloud-byoc`
skill) where you have cluster-config access, or a self-managed deployment.

---

## License-requirement summary

Every key in this file requires an **Enterprise Edition** license. On Redpanda
Cloud Serverless the license is included and managed by Redpanda — there is no
`rpk cluster license` step and no expiry to track as a tenant. The "on license
expiry" notes above describe self-managed behavior and are included so the
mapping to self-managed clusters is explicit.

| Enterprise feature | Topic/data-plane keys (Serverless) | Self-managed cluster property |
|---|---|---|
| Iceberg Topics | `redpanda.iceberg.mode`, `.target.lag.ms`, `.partition.spec`, `.invalid.record.action`, `.delete` | `iceberg_enabled`, `iceberg_delete`, `iceberg_default_partition_spec`, `iceberg_invalid_record_action` |
| Schema ID Validation | `redpanda.key/value.schema.id.validation`, `redpanda.key/value.subject.name.strategy` | `enable_schema_id_validation` |
| Leadership Pinning | `redpanda.leaders.preference` | `default_leaders_preference`, `enable_rack_awareness` |
| RBAC | `${DP_URL}/v1/roles` (SecurityService) | RBAC roles + `rpk security role` |
