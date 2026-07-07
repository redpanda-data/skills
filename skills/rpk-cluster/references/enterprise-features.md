# Enterprise Features via rpk cluster

Redpanda's key differentiators are gated behind an **Enterprise license**. Most
are toggled through cluster configuration properties (`rpk cluster config set`),
so they fall squarely in the `rpk cluster` domain. This file is the canonical
map of the **enterprise-flagged cluster-config properties** and their nested
settings.

All keys, defaults, and enterprise values below are grounded in the Redpanda
property schema (`is_enterprise: true`, `config_scope: cluster`) and the
licensing docs. License behavior on expiration is summarized per feature.

## License lifecycle (rpk cluster license)

Enterprise features require a valid license. New clusters (24.3+) get a 30-day
trial automatically; extend it with `rpk generate license --apply`.

```bash
# Show license status: Organization, Type, Expires, License Status, Violation
rpk cluster license info
rpk cluster license info --format json    # also: status (alias)

# Upload a license to the cluster (no restart required)
rpk cluster license set --path /etc/redpanda/redpanda.license
rpk cluster license set "<license-string>"     # inline form
# If neither --path nor inline string is given, rpk looks in
# /etc/redpanda/redpanda.license
```

`rpk cluster license info` is the authoritative way to detect a **license
violation** — enterprise features enabled without a valid license. When
`Violation: true`, either upload a valid license or disable the offending
feature (see "Disabling enterprise features" below). This command reports
violations only for Redpanda enterprise features, not Redpanda Connect/Console.

**On license expiration:** the cluster keeps operating without data loss, but
enabling/modifying enterprise features is restricted. Existing configuration is
preserved so you can re-apply a license and resume.

## The 14 enterprise-flagged cluster-config properties

These are every property with `is_enterprise: true` at cluster scope. The
`enterprise_value` column lists the value(s) that require a license; the
`sanctioned` value is the license-free fallback (where one exists).

| Property | Type | Default | Enterprise value(s) | License-free value | Restart |
|---|---|---|---|---|---|
| `audit_enabled` | boolean | `false` | `true` | `false` | No |
| `cloud_storage_enabled` | boolean | `false` | `true` | `false` | Yes |
| `core_balancing_continuous` | boolean | `true` | `true` | `false` (sanctioned) | No |
| `default_leaders_preference` | object | `none` | any non-`none` value | `none` | No |
| `delete_topic_enable` | boolean | `true` | `false` | `true` | No |
| `enable_schema_id_validation` | string | `none` | `compat`, `redpanda` | `none` | No |
| `enable_shadow_linking` | boolean | `false` | `true` | `false` | No |
| `features_auto_finalization` | boolean | `true` | `false` (disabling auto-finalization requires a license) | `true` | No |
| `http_authentication` | array | `[BASIC]` | `OIDC` | `[BASIC]` | No |
| `iceberg_enabled` | boolean | `false` | `true` | `false` | Yes |
| `partition_autobalancing_mode` | string | `continuous` | `continuous` | `node_add` (sanctioned) | No |
| `sasl_mechanisms` | array | `[SCRAM]` | `GSSAPI`, `OAUTHBEARER` entries | `SCRAM`/`PLAIN` | No |
| `sasl_mechanisms_overrides` | array | `[]` | enterprise mechanisms | (empty) | No |
| `schema_registry_enable_authorization` | boolean | `false` | `true` | `false` | No |

> Defaults reflect the shipped property schema. `partition_autobalancing_mode`
> and `core_balancing_continuous` default to their enterprise values *because*
> new clusters ship with a trial license; on expiration they revert to the
> sanctioned values.

---

## Continuous Data Balancing (Enterprise)

Self-healing balancer that continuously monitors node/rack availability and disk
usage. Enabled by setting `partition_autobalancing_mode=continuous`. It is the
default for licensed clusters; on expiration it reverts to `node_add` (rebalance
only when a broker is added).

```bash
rpk cluster config set partition_autobalancing_mode continuous   # Enterprise
rpk cluster config set partition_autobalancing_mode node_add     # license-free fallback
rpk cluster config set partition_autobalancing_mode off          # manual moves only
```

Nested tuning properties (cluster scope, NOT individually enterprise-flagged —
they only take effect in `continuous` mode):

| Property | Default | Meaning |
|---|---|---|
| `partition_autobalancing_node_availability_timeout_sec` | `900` | After a node is unreachable this long, Redpanda re-creates its replicas elsewhere (node stays in cluster, can rejoin). |
| `partition_autobalancing_node_autodecommission_timeout_sec` | `null` (disabled) | After a node is unavailable this long, Redpanda permanently decommissions it. `continuous` mode only. One node at a time. |
| `partition_autobalancing_max_disk_usage_percent` | `80` | When a node exceeds this disk %, replicas move to nodes below the threshold. |

Monitor and control with `rpk cluster partitions balancer-status` and
`rpk cluster partitions move-cancel [--node <id>]`. To fully stop balancing,
set `partition_autobalancing_mode=off` first, then cancel in-flight moves.

## Continuous Intra-Broker (Core) Balancing (Enterprise)

Balances partition replicas across CPU cores within a single broker.

| Property | Default | Enterprise? | Meaning |
|---|---|---|---|
| `core_balancing_continuous` | `true` | Yes (sanctioned `false`) | Rebalance across cores at runtime (e.g. when partitions move to/from the broker). |
| `core_balancing_on_core_count_change` | `true` | No | Rebalance across cores at startup when core count changes. |

```bash
rpk cluster config set core_balancing_continuous true     # Enterprise
rpk cluster config set core_balancing_continuous false    # disable (license-free)
```

## Leadership Pinning (Enterprise)

`default_leaders_preference` specifies the availability zones / racks where
partition leaders should be placed cluster-wide (topics can override). Any value
other than `none` requires a license.

```bash
# Prefer leaders in specific racks (any order)
rpk cluster config set default_leaders_preference racks:rack1,rack2
# Priority-ordered racks (v26.1+): prefer rack1, fail over to rack2, ...
rpk cluster config set default_leaders_preference ordered_racks:rack1,rack2
# Disable leadership pinning (license-free)
rpk cluster config set default_leaders_preference none
```

On license expiration, leader pinning is disabled on all topics.

## Tiered Storage (Enterprise)

Object-storage-backed long-term retention. Gated by `cloud_storage_enabled=true`
(requires restart). The many `cloud_storage_*` sub-properties (bucket, region,
credentials, cache) configure it; the enterprise gate is the master switch.

```bash
rpk cluster config set cloud_storage_enabled true        # Enterprise; needs restart
```

Related enterprise-adjacent toggles (set via `rpk cluster config set`):

| Property | Meaning |
|---|---|
| `cloud_storage_enable_remote_write` | Write segments to object storage (per-topic via `redpanda.remote.write`). |
| `cloud_storage_enable_remote_read` | Read from object storage. Setting `false` is how you disable **Remote Read Replicas**. |
| `cloud_storage_bucket` / `cloud_storage_region` | Target bucket/container and region. |

> **Remote Read Replicas** (Enterprise) reuse the Tiered Storage stack. Disable
> by `rpk cluster config set cloud_storage_enable_remote_read false`. On
> expiration, Remote Read Replica topics cannot be created or modified.

## Cloud Topics

Object-storage-native topic type (durable object storage as the primary backing
store instead of local disk replication).

```bash
rpk cluster config set cloud_topics_enabled=true     # cluster prerequisite; needs restart
```

`cloud_topics_enabled` is the cluster-level prerequisite to enable the feature.
In the Redpanda source it is a `deprecated_property` (not an `enterprise<>`-wrapped
schema property), so it is NOT one of the enterprise-flagged cluster-config
properties listed in the table above — do not classify it as `is_enterprise: true`.
The command is still current per the docs (cloud-topics.adoc).

Per-topic, a topic is made a Cloud Topic only at creation time using the topic
property `redpanda.storage.mode=cloud`:

```bash
rpk topic create -c redpanda.storage.mode=cloud <new-cloud-topic-name>
```

(See the rpk-topic skill for the topic-level property.)

## Iceberg Topics (Enterprise)

Exposes topic data as Apache Iceberg tables. The cluster gate is
`iceberg_enabled=true` (requires restart). Per-topic behavior is controlled by
topic properties (`redpanda.iceberg.mode`, etc. — see the rpk-topic skill).

```bash
rpk cluster config set iceberg_enabled true          # Enterprise; needs restart
```

Cluster-scoped Iceberg defaults (not individually enterprise-flagged; they
default new topics' behavior). All set via `rpk cluster config set`:

| Property | Default | Meaning |
|---|---|---|
| `iceberg_catalog_type` | `object_storage` | Catalog type. Enum: `object_storage`, `rest`. |
| `iceberg_catalog_base_location` | `redpanda-iceberg-catalog` | Base path for the object-storage catalog. |
| `iceberg_catalog_commit_interval_ms` | `1 minute` | How often metadata is committed to the catalog. |
| `iceberg_target_lag_ms` | `1 minute` | Target freshness lag for the Iceberg table. |
| `iceberg_default_partition_spec` | `(hour(redpanda.timestamp))` | Default Iceberg partition spec for new topics. |
| `iceberg_invalid_record_action` | `dlq_table` | What to do with records that fail schema translation (`dlq_table`, `drop`). |
| `iceberg_delete` | `true` | Whether dropping a topic also drops the Iceberg table. |
| `iceberg_default_catalog_namespace` | `redpanda` | Default catalog namespace. |
| `iceberg_rest_catalog_endpoint` | `null` | REST catalog endpoint (when `iceberg_catalog_type=rest`). |
| `iceberg_rest_catalog_authentication_mode` | `none` | REST catalog auth mode. |

On expiration, topics cannot be created/modified with the
`redpanda.iceberg.mode` property.

## Shadow Linking — cross-cluster DR (Enterprise)

Shadow Linking provides offset-preserving asynchronous replication between
distinct Redpanda clusters for disaster recovery. The cluster-level enable flag
is in this domain; the link lifecycle lives in `rpk shadow` (separate skill).

```bash
rpk cluster config set enable_shadow_linking true    # Enterprise
```

`enable_shadow_linking` enables *creating* shadow links from this cluster to a
remote source cluster for data replication. On expiration, new shadow links
cannot be created, but existing links keep operating and can be updated.

## Audit Logging (Enterprise)

Records cluster activity to an internal audit log topic. Master switch:
`audit_enabled=true`. On expiration, read access to the audit topic is denied
but logging continues.

```bash
rpk cluster config set audit_enabled true            # Enterprise
```

Nested audit-tuning cluster properties (all set via `rpk cluster config set`):

| Property | Meaning |
|---|---|
| `audit_enabled_event_types` | Event categories to record (e.g. `management`, `authenticate`, `produce`, `consume`, `describe`, `heartbeat`, `schema_registry`, `admin`). |
| `audit_log_num_partitions` | Partition count of the audit log topic. |
| `audit_log_replication_factor` | Replication factor of the audit log topic. |
| `audit_excluded_principals` | Principals to exclude from auditing. |
| `audit_excluded_topics` | Topics to exclude from auditing. |
| `audit_failure_policy` | Behavior when the audit subsystem cannot record events. |
| `audit_client_max_buffer_size` | Max client-side audit buffer. |
| `audit_queue_max_buffer_size_per_shard` | Per-shard audit queue buffer size. |
| `audit_queue_drain_interval_ms` | Audit queue drain interval. |

## Server-Side Schema ID Validation (Enterprise)

The broker drops records whose schema IDs are not registered. Master switch:
`enable_schema_id_validation` (string enum).

```bash
rpk cluster config set enable_schema_id_validation redpanda   # Enterprise
rpk cluster config set enable_schema_id_validation compat     # Enterprise (Confluent-compatible)
rpk cluster config set enable_schema_id_validation none       # disable (license-free)
```

| Value | Meaning |
|---|---|
| `none` | Validation disabled (default, license-free). |
| `redpanda` | Redpanda-native validation. |
| `compat` | Confluent-compatible validation. |

Per-topic validation uses topic properties `redpanda.key.schema.id.validation`,
`redpanda.value.schema.id.validation`, and the subject-name strategies
`redpanda.key.subject.name.strategy` / `redpanda.value.subject.name.strategy`
(see the rpk-topic skill). On expiration, topics with schema validation settings
cannot be created or modified.

## Schema Registry Authorization (Enterprise)

ACLs for Schema Registry resources. Master switch:
`schema_registry_enable_authorization=true`. On expiration you can no longer
enable it nor create/modify schema ACLs.

```bash
rpk cluster config set schema_registry_enable_authorization true   # Enterprise
```

## Authentication: OIDC / OAUTHBEARER / Kerberos (Enterprise)

Enterprise SASL/HTTP authentication mechanisms are enabled through
`sasl_mechanisms` (Kafka API) and `http_authentication` (Admin/HTTP API).

```bash
# Enable Kerberos (GSSAPI) and/or OIDC on the Kafka API (Enterprise)
rpk cluster config set sasl_mechanisms "[SCRAM,GSSAPI,OAUTHBEARER]"

# Enable OIDC on the HTTP/Admin API (Enterprise)
rpk cluster config set http_authentication "[BASIC,OIDC]"
```

- `sasl_mechanisms` (array, default `[SCRAM]`): adding `GSSAPI` (Kerberos) or
  `OAUTHBEARER`/OIDC requires a license. `SCRAM`/`PLAIN` are license-free.
- `sasl_mechanisms_overrides` (array, default `[]`): per-listener mechanism
  overrides; enterprise mechanisms here also require a license.
- `http_authentication` (array, default `[BASIC]`): adding `OIDC` requires a
  license.

On expiration there is no change to active OIDC/OAUTHBEARER/Kerberos auth.

## Topic Deletion Control (Enterprise)

`delete_topic_enable=false` blocks all topic deletion (including superusers) via
the Kafka DeleteTopics API — a cluster-wide safety guard. Setting it to `false`
requires a license; on expiration it reverts to `true` (deletion enabled).

```bash
rpk cluster config set delete_topic_enable false     # Enterprise (lock deletes)
```

## Automatic Feature Finalization (Enterprise)

`features_auto_finalization` controls whether the cluster's active logical
version advances automatically once all nodes are upgraded (`true`, default), or
only on an explicit Admin API request (`false`). **Setting it to `false` is the
Enterprise-gated action** (it keeps the cluster downgrade-capable until you
finalize manually). It is `enterprise<>`-wrapped at cluster scope in the source.

```bash
rpk cluster config set features_auto_finalization false   # Enterprise (stay downgrade-capable)
rpk cluster config set features_auto_finalization true    # default (license-free)
```

Note: if you upgraded with this set to `false` and are ready to finalize,
flipping it back to `true` does not reliably trigger finalization — finalize via
the Admin API, then optionally set it back to `true`.

## FIPS Compliance (Enterprise) — node config

FIPS is a **node** property, not a cluster property, but it is an enterprise
differentiator commonly checked alongside cluster setup. Disable via
`rpk redpanda config set redpanda.fips_mode disabled` (edits the node's
`redpanda.yaml`; there is no `rpk node` command group). On expiration there
is no change.

## RBAC / GBAC (Enterprise) — managed via rpk security

Role-Based Access Control and Group-Based Access Control are enterprise
features managed through `rpk security role` (separate skill), not
`rpk cluster config`. To disable RBAC for license compliance, delete all roles:

```bash
rpk security role list
rpk security role delete <role-name>
```

GBAC restriction on expiration: ACLs with `Group:` principals cannot be created;
existing group ACLs are still evaluated and can be deleted.

---

## Disabling enterprise features (license compliance)

When `rpk cluster license info` shows `Violation: true`, disable features with:

```bash
rpk cluster config set audit_enabled false
rpk cluster config set partition_autobalancing_mode node_add
rpk cluster config set core_balancing_continuous false
rpk redpanda config set redpanda.fips_mode disabled
rpk cluster config set sasl_mechanisms <non-enterprise-mechanisms>     # drop GSSAPI/OIDC
rpk cluster config set http_authentication <non-enterprise-mechanisms> # drop OIDC
rpk cluster config set default_leaders_preference none
rpk cluster config set cloud_storage_enable_remote_read false          # Remote Read Replicas
rpk cluster config set enable_schema_id_validation none
rpk cluster config set features_auto_finalization true                 # back to license-free default
rpk cluster config set cloud_storage_enabled false                     # Tiered Storage
rpk security role delete <role-name>                                   # RBAC (per role)
```

Then confirm `rpk cluster license info` reports `Violation: false`.
