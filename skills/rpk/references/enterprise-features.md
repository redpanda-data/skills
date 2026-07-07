# rpk and Redpanda Enterprise Features

Redpanda's key differentiators are **Enterprise Edition features**. They require a
valid Enterprise license (clusters get an automatic 30-day trial license on first
start in v24.3+). This reference maps each enterprise feature to the **exact `rpk`
command(s)** that enable, configure, or operate it, and lists the **nested config
keys / topic properties** for each. All keys below are grounded in the Redpanda
docs; none are invented.

To check license status and whether you are in violation (using enterprise
features without a license):

```bash
rpk cluster license info            # alias: rpk cluster license status
rpk cluster license info --format json
```

`Violation: true` means enterprise features are active without a valid license.
To apply a license:

```bash
rpk cluster license set --path /etc/redpanda/redpanda.license
rpk cluster license set "<license-string>"   # inline
rpk generate license --apply                  # generate + apply a 30-day trial
```

> Applying or updating a license does **not** require a cluster restart.

Two configuration surfaces are used throughout:

- **Cluster config** — `rpk cluster config set <key> <value>` (cluster-wide).
- **Topic properties** — `rpk topic create <t> -c <prop>=<value>` or
  `rpk topic alter-config <t> --set <prop>=<value>` (per topic).

---

## Tiered Storage (Enterprise)

Offloads log segments to object storage for long-term retention and cheap reads.

**Enable cluster-wide:**
```bash
rpk cluster config set cloud_storage_enabled true
```

**Related cluster config keys:**

| Key | Purpose |
|---|---|
| `cloud_storage_enabled` | Master switch for Tiered Storage. |
| `cloud_storage_enable_remote_read` | Default remote-read for new topics. |
| `cloud_storage_enable_remote_write` | Default remote-write for new topics. |

**Per-topic properties** (set with `rpk topic create -c` or `alter-config --set`):

| Topic property | Purpose |
|---|---|
| `redpanda.remote.write` | Upload (archive) this topic's data to object storage. |
| `redpanda.remote.read` | Allow reads to fetch from object storage. |
| `redpanda.remote.delete` | Delete objects in storage when data is removed. |
| `redpanda.remote.recovery` | Restore a topic from object storage (Topic Recovery). |
| `retention.local.target.ms` | Local-disk retention by time (rest stays remote). |
| `retention.local.target.bytes` | Local-disk retention by size. |

```bash
rpk topic create events -c redpanda.remote.write=true -c redpanda.remote.read=true
rpk topic alter-config events --set retention.local.target.ms=86400000
```

Disable to exit license violation: `rpk cluster config set cloud_storage_enabled false`.

---

## Cloud Topics (Enterprise)

Object-storage-native topics that use durable object storage as the primary
backing store instead of local-disk replication.

**Enable cluster-wide, then create a cloud topic:**
```bash
rpk cluster config set cloud_topics_enabled true
rpk topic create my-cloud-topic -c redpanda.storage.mode=cloud
```

| Key | Surface | Purpose |
|---|---|---|
| `cloud_topics_enabled` | Cluster config | Master switch for Cloud Topics. |
| `redpanda.storage.mode=cloud` | Topic property | Marks a topic as a Cloud Topic. |

On license expiration: new Cloud Topics cannot be created and existing ones cannot
be modified (including partition changes).

---

## Iceberg Topics (Enterprise)

Exposes a topic as an Apache Iceberg table queryable by external engines.

**Enable cluster-wide, then set the per-topic mode:**
```bash
rpk cluster config set iceberg_enabled true
rpk topic create logs -c redpanda.iceberg.mode=value_schema_id_prefix
rpk topic alter-config logs --set redpanda.iceberg.mode=key_value
```

**Per-topic Iceberg properties:**

| Topic property | Values / format | Purpose |
|---|---|---|
| `redpanda.iceberg.mode` | `disabled` (default), `key_value`, `value_schema_id_prefix`, `value_schema_latest` | Iceberg table mode for the topic. |
| `redpanda.iceberg.target.lag.ms` | duration in ms | Max lag before translating records to the table. |
| `redpanda.iceberg.partition.spec` | e.g. `(col1)`, `(col1, col2)`, `(year(ts1), col1)` | Custom Iceberg partitioning. |
| `redpanda.iceberg.invalid.record.action` | `dlq` (default), `drop` | What to do with records that fail translation. |
| `redpanda.iceberg.delete` | `true`/`false` | Drop the Iceberg table when the topic is deleted. |

```bash
rpk topic create t1 -p5 -r3 \
  -c redpanda.iceberg.mode=value_schema_id_prefix \
  -c "redpanda.iceberg.partition.spec=(year(ts1), col1)"
```

**Cluster-wide Iceberg config keys (defaults + catalog connection):**

| Cluster config key | Purpose |
|---|---|
| `iceberg_enabled` | Master switch; required before any topic uses Iceberg. |
| `iceberg_catalog_type` | Catalog type (e.g. object storage or REST). |
| `iceberg_catalog_base_location` | Base storage location for tables. |
| `iceberg_default_catalog_namespace` | Default namespace for created tables. |
| `iceberg_catalog_commit_interval_ms` | Commit interval to the catalog. |
| `iceberg_target_lag_ms` | Cluster default for translation lag. |
| `iceberg_invalid_record_action` | Cluster default for invalid records (`dlq`/`drop`). |
| `iceberg_default_partition_spec` | Cluster default partition spec. |
| `iceberg_delete` | Cluster default for table deletion behavior. |
| `iceberg_dlq_table_suffix` | Suffix for dead-letter-queue tables. |

**REST catalog connection keys** (cluster config, used with REST catalogs):
`iceberg_rest_catalog_endpoint`, `iceberg_rest_catalog_authentication_mode`,
`iceberg_rest_catalog_client_id`, `iceberg_rest_catalog_client_secret`,
`iceberg_rest_catalog_token`, `iceberg_rest_catalog_prefix`,
`iceberg_rest_catalog_warehouse`, `iceberg_rest_catalog_request_timeout_ms`,
and the `iceberg_rest_catalog_aws_*` family (`_access_key`, `_secret_key`,
`_region`, `_service_name`, `_credentials_source`).

On license expiration: topics cannot be created or modified with
`redpanda.iceberg.mode`.

---

## Continuous Data Balancing (Enterprise)

Continuously rebalances partitions across the cluster under disk pressure and on
broker add/remove. Enabled by default on new licensed clusters.

**Enable / disable:**
```bash
rpk cluster config set partition_autobalancing_mode continuous   # Enterprise
rpk cluster config set partition_autobalancing_mode node_add     # community fallback
```

`partition_autobalancing_mode` values: `off`, `node_add` (community default
behavior — balances only when a broker is added), `continuous` (Enterprise).

**Tuning thresholds (cluster config):**

| Key | Purpose |
|---|---|
| `partition_autobalancing_max_disk_usage_percent` | Disk-usage % that triggers rebalancing. |
| `partition_autobalancing_node_availability_timeout_sec` | How long a node can be down before its partitions move. |
| `partition_autobalancing_node_autodecommission_timeout_sec` | Auto-decommission timeout for unavailable nodes. |
| `partition_autobalancing_concurrent_moves` | Max concurrent partition moves. |
| `partition_autobalancing_movement_batch_size_bytes` | Bytes moved per batch. |
| `partition_autobalancing_tick_interval_ms` | Balancer tick interval. |
| `partition_autobalancing_tick_moves_drop_threshold` | Drop-threshold per tick. |
| `partition_autobalancing_min_size_threshold` | Minimum partition size to consider. |
| `partition_autobalancing_topic_aware` | Spread replicas of a topic evenly. |

**Continuous Intra-Broker (core) Balancing (Enterprise):**
```bash
rpk cluster config set core_balancing_continuous true
rpk cluster config set core_balancing_on_core_count_change true
```

On expiration: continuous balancing reverts to `node_add`;
`core_balancing_continuous` is disabled.

---

## Shadow Linking / Cross-Cluster Disaster Recovery (Enterprise) — `rpk shadow`

Shadowing is Redpanda's enterprise-grade DR solution: asynchronous,
offset-preserving replication between two distinct clusters (offsets, timestamps,
and cluster metadata are preserved). This is a key DR differentiator and is
operated entirely through `rpk shadow`.

```bash
# 1. Generate a shadow-link config (sample or fully documented template)
rpk shadow config generate -o shadow-link.yaml
rpk shadow config generate --print-template -o shadow-link.yaml

# 2. Create the link on the shadow (target) cluster
rpk shadow create --config-file shadow-link.yaml
rpk shadow create -c shadow-link.yaml --no-confirm

# 3. Monitor replication health and per-topic progress
rpk shadow list
rpk shadow describe <link-name>
rpk shadow status <link-name>
rpk shadow status <link-name> --print-overview --print-topic   # also: --print-task / --print-all

# 4. Update (opens $EDITOR; applies only changed fields; name is immutable)
rpk shadow update <link-name>

# 5. Fail over — converts shadow topics into regular topics; replication stops
rpk shadow failover <link-name> --all
rpk shadow failover <link-name> --topic my-topic
rpk shadow failover <link-name> --all --no-confirm

# 6. Tear down
rpk shadow delete <link-name>
```

`rpk shadow status` flags: `-o/--print-overview`, `-k/--print-task`,
`-t/--print-topic`, `-a/--print-all`, `--format json|yaml|text|wide`.
For Cloud, generate and create with `--for-cloud`; for SCRAM auth, store the
password in the shadow cluster's secret store and reference it in the config file
as `${secrets.SECRET_NAME}`.

On expiration: new shadow links cannot be created; existing links keep running and
can be updated.

---

## Remote Read Replicas (Enterprise)

A remote cluster reads a topic's data from object storage for DR — read-only.

**Enable cluster-wide, then create the read-replica topic:**
```bash
rpk cluster config set cloud_storage_enable_remote_read true
rpk topic create <topic> -c redpanda.remote.readreplica=<bucket_name>
```

| Key | Surface | Purpose |
|---|---|---|
| `cloud_storage_enable_remote_read` | Cluster config | Required for remote reads. |
| `redpanda.remote.readreplica` | Topic property | Bucket the read replica reads from. |

Optional bucket query params:
```bash
rpk topic create my-topic \
  -c "redpanda.remote.readreplica=my-bucket?region=us-east-1&endpoint=s3.us-east-1.amazonaws.com"
```

Do **not** combine `redpanda.remote.readreplica` with `redpanda.remote.read` /
`redpanda.remote.write` — those are ignored on read-replica topics. Disable to
exit violation: `rpk cluster config set cloud_storage_enable_remote_read false`.

---

## Leadership Pinning (Enterprise)

Pins partition leaders to a preferred set of availability zones / racks.

**Per-topic and cluster default:**
```bash
rpk topic alter-config <topic> --set redpanda.leaders.preference=ordered_racks:<rack1>,<rack2>
rpk cluster config set default_leaders_preference ordered_racks:<rack1>,<rack2>
```

| Key | Surface | Values |
|---|---|---|
| `redpanda.leaders.preference` | Topic property | `none`, `racks:<r1>,<r2>...`, `ordered_racks:<r1>,<r2>...` |
| `default_leaders_preference` | Cluster config | Same format; default for topics without the topic property; default `none`. |

Requires rack awareness (`enable_rack_awareness`). Disable to exit violation:
`rpk cluster config set default_leaders_preference none`.

---

## Audit Logging (Enterprise)

Records detailed cluster-activity logs to an internal topic for compliance.

**Enable / disable:**
```bash
rpk cluster config set audit_enabled true
rpk cluster config set audit_enabled false   # to exit violation
```

**Related cluster config keys:**

| Key | Purpose |
|---|---|
| `audit_enabled` | Master switch. |
| `audit_enabled_event_types` | Event categories to log (e.g. management, authenticate, describe). |
| `audit_log_num_partitions` | Partitions for the audit log topic. |
| `audit_log_replication_factor` | Replication factor for the audit log topic. |
| `audit_excluded_principals` | Principals to exclude from auditing. |
| `audit_excluded_topics` | Topics to exclude from auditing. |
| `audit_queue_drain_interval_ms` | Drain interval for the in-memory audit queue. |
| `audit_queue_max_buffer_size_per_shard` | Per-shard audit buffer size. |
| `audit_client_max_buffer_size` | Audit client buffer size. |

On expiration: read access to the audit log topic is denied, but logging continues.

---

## Role-Based Access Control (RBAC) (Enterprise) — `rpk security role`

Manage roles and bind ACLs/permissions to them instead of to individual users.

```bash
rpk security role create <role>
rpk security role list
rpk security role describe <role>
rpk security role assign <role> --principal User:alice
rpk security role unassign <role> --principal User:alice
rpk security role delete <role>     # used to exit violation (delete all roles)
```

On expiration: roles and role-associated ACLs cannot be created or modified;
deletion is still allowed. Group-Based Access Control (GBAC) — ACLs with `Group:`
principals via OIDC group membership — is a related Enterprise feature; create
group ACLs with `rpk security acl create --allow-principal Group:<name> ...`.

---

## Authentication: OIDC / OAUTHBEARER, Kerberos (GSSAPI) (Enterprise)

SASL mechanisms and HTTP authentication are configured cluster-side and consumed
by rpk via `-X sasl.mechanism` / profile auth.

**Cluster config keys:**

| Key | Purpose |
|---|---|
| `sasl_mechanisms` | Enabled SASL mechanisms. Include `OAUTHBEARER` for OIDC, `GSSAPI` for Kerberos (both Enterprise); `SCRAM-SHA-256`/`SCRAM-SHA-512`/`PLAIN` are community. |
| `http_authentication` | HTTP auth mechanisms (e.g. `OIDC`, `BASIC`) for Admin API / Schema Registry / Console. |

**rpk client side:** see [x-flags-and-config.md](x-flags-and-config.md). For OIDC,
use `-X sasl.mechanism=OAUTHBEARER` and pass the access token via `-X pass=<token>`
(or `token:<token>`) with `user` unset.

To exit violation: remove `OIDC` from `sasl_mechanisms` and `http_authentication`,
or remove `GSSAPI` from `sasl_mechanisms`:
```bash
rpk cluster config set sasl_mechanisms <other-mechanisms>
rpk cluster config set http_authentication <other-mechanisms>
```

---

## Server-Side Schema ID Validation (Enterprise)

Brokers reject records whose schema IDs are not registered, instead of pushing the
check to consumers.

**Enable cluster-wide, then set per-topic strategy:**
```bash
rpk cluster config set enable_schema_id_validation true
rpk topic alter-config <topic> --set redpanda.value.schema.id.validation=true
```

| Key | Surface | Purpose |
|---|---|---|
| `enable_schema_id_validation` | Cluster config | Master switch (set `false` to exit violation). |
| `redpanda.key.schema.id.validation` | Topic property | Validate key schema IDs. |
| `redpanda.value.schema.id.validation` | Topic property | Validate value schema IDs. |
| `redpanda.key.subject.name.strategy` | Topic property | Subject-name strategy for keys. |
| `redpanda.value.subject.name.strategy` | Topic property | Subject-name strategy for values. |

Schema Registry Authorization (`schema_registry_enable_authorization`) is a related
Enterprise feature controlling ACLs on Schema Registry resources.

---

## FIPS Compliance (Enterprise)

Runs Redpanda (and rpk) with a FIPS-validated crypto module.

**Node config (per broker), set in `redpanda.yaml`.** rpk has no `node`
command group — use `rpk redpanda config set`, which edits the local
`redpanda.yaml`:
```bash
rpk redpanda config set redpanda.fips_mode enabled
rpk redpanda config set redpanda.fips_mode disabled   # to disable
```

`fips_mode` values include `disabled`, `enabled`, `permissive`. License behavior:
no change on expiration. Redpanda Connect also offers a FIPS-compliant `rpk` build
(Enterprise).

---

## Other license-gated controls operated via rpk

| Feature | rpk control | Notes |
|---|---|---|
| Topic Recovery | `rpk topic create <t> -c redpanda.remote.recovery=true` | Restore a single topic from Tiered Storage. Enterprise. |
| Whole Cluster Restore (WCR) | restore from a source-cluster snapshot | Enterprise; blocked without a valid license. |
| Topic Deletion Control | `rpk cluster config set delete_topic_enable false` | Cluster-wide guard against topic deletion; reverts to `true` on expiration. |

---

## Quick "am I in violation?" workflow

```bash
rpk cluster license info                 # check Violation field
# If true and you have no license, either apply one:
rpk cluster license set --path /etc/redpanda/redpanda.license
# ...or disable the offending feature(s) using the per-feature commands above,
# then re-check:
rpk cluster license info
```
