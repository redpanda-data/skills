# Shadowing / Shadow Links — Cross-Cluster Disaster Recovery (Enterprise)

**Requires an Enterprise license on both clusters.** Shadowing requires Redpanda **v25.3 or later** on both source and shadow clusters (Console v3.30+ if used). On license expiration: new shadow links cannot be created, but existing shadow links keep operating and can be updated.

## What It Does

Shadowing is Redpanda's enterprise disaster-recovery solution. A **shadow link** establishes asynchronous, **offset-preserving, byte-level** replication from a source cluster to a read-only shadow cluster. Unlike tools that re-produce messages, Shadowing copies data at the byte level, so shadow topics are identical copies with preserved offsets, timestamps, and headers. It follows an **active-passive** pattern: the source serves production traffic; the shadow continuously receives updates and can be failed over to become writable during a disaster.

Shadowing replicates: topic data (offsets + timestamps preserved), topic configurations, consumer group offsets, ACLs, and Schema Registry data.

## Prerequisite: enable shadow linking

The **shadow** (destination) cluster must set `enable_shadow_linking=true` before any shadow link can be created (via rpk or Admin API v1):

```bash
rpk cluster config set enable_shadow_linking true
```

The source cluster needs a service account (when SASL is enabled) with these ACLs: `read` on topics, `describe_configs` on topics, `describe`+`read` on consumer groups, `describe` on ACL resources, and `describe` on the cluster resource.

## rpk shadow Workflow

```bash
# 1. Generate a config file (placeholder values, or a documented template)
rpk shadow config generate -o shadow-config.yaml
rpk shadow config generate --print-template -o shadow-config-template.yaml

# 2. Create the shadow link FROM the shadow cluster
rpk shadow create --config-file shadow-config.yaml

# 3. Monitor
rpk shadow list                      # all links + health
rpk shadow describe <link-name>      # full config (connection, filters, sync options)
rpk shadow status <link-name>        # lag, task health, sync status

# 4. Update (opens editor; only changed fields are pushed; name is immutable)
rpk shadow update <link-name>

# 5. Failover (promote shadow topics to writable)
rpk shadow failover <link-name> --topic <topic-name>   # individual topic
rpk shadow failover <link-name> --all                  # entire link / cluster

# Emergency / force delete
rpk shadow delete <link-name> --force
rpk shadow delete <link-name>
```

After failover, automatic fallback to the original source is **not** supported. To avoid split-brain, reconfigure all clients to point at the shadow cluster before resuming writes.

## Shadow Link Tasks

Each replication concern runs as a continuous task, mapping to a section of `shadow-config.yaml`:

| Task | Config section | Replicates |
|---|---|---|
| Source Topic Sync | `topic_metadata_sync_options` | Topic discovery, auto-creation filters, topic properties, starting offset |
| Consumer Group Shadowing | `consumer_offset_sync_options` | Consumer group offsets/membership (with offset clamping to shadow HWM) |
| Security Migrator | `security_sync_options` | ACLs (all by default) |
| Schema Registry Sync | `schema_registry_sync_options` | Byte-for-byte `_schemas` topic replication |

Task states: `ACTIVE`, `PAUSED`, `FAULTED`, `NOT_RUNNING`, `LINK_UNAVAILABLE`. Pause an individual task by setting `paused: true` in its section.

## Config File Nested Keys (shadow-config.yaml)

```yaml
name: production-dr                      # unique link name (immutable)

client_options:
  bootstrap_servers:                     # source cluster brokers
  - prod-kafka-1.example.com:9092
  source_cluster_id: <uuid>              # optional; `rpk cluster config get cluster_id`
  tls_settings:
    enabled: true
    tls_file_settings:                   # self-managed: file paths
      ca_path: /etc/ssl/certs/ca.crt
      key_path: /etc/ssl/private/client.key   # optional (mTLS)
      cert_path: /etc/ssl/certs/client.crt    # optional (mTLS)
    do_not_set_sni_hostname: false
  authentication_configuration:
    scram_configuration:
      username: shadow-replication-user
      password: <sasl-password>          # in Cloud: ${secrets.<id>}
      scram_mechanism: SCRAM_SHA_256     # or SCRAM_SHA_512
    # plain_configuration: { username, password }   # self-managed SASL/PLAIN
  # Connection tuning (defaults shown)
  metadata_max_age_ms: 10000
  connection_timeout_ms: 1000
  retry_backoff_ms: 100
  fetch_wait_max_ms: 500
  fetch_min_bytes: 5242880               # 5 MB
  fetch_max_bytes: 20971520              # 20 MB
  fetch_partition_max_bytes: 1048576     # 1 MB

topic_metadata_sync_options:
  interval: 30s
  auto_create_shadow_topic_filters:      # which source topics become shadow topics
  - pattern_type: LITERAL                # LITERAL (incl. wildcard '*') or PREFIX
    filter_type: INCLUDE                 # INCLUDE or EXCLUDE (EXCLUDE wins)
    name: '*'
  synced_shadow_topic_properties:        # extra properties to sync beyond defaults
  - retention.ms
  - segment.ms
  exclude_default: false                 # if true, skip the "always replicated unless excluded" set
  start_at_earliest: {}                  # OR start_at_latest: {} OR start_at_timestamp: <ts>
  paused: false

consumer_offset_sync_options:
  interval: 30s
  paused: false
  group_filters:
  - pattern_type: LITERAL
    filter_type: INCLUDE
    name: '*'

security_sync_options:
  interval: 30s
  paused: false
  acl_filters:
  - resource_filter:
      resource_type: TOPIC               # TOPIC, GROUP, CLUSTER
      pattern_type: PREFIXED             # LITERAL or PREFIXED
      name: prod-
    access_filter:
      principal: User:app-user
      operation: READ                    # READ, WRITE, CREATE, DELETE, ALTER, DESCRIBE, ANY
      permission_type: ALLOW             # ALLOW or DENY
      host: '*'

schema_registry_sync_options:
  shadow_schema_registry_topic: {}       # enable byte-for-byte _schemas replication
```

### Filter rules

- EXCLUDE filters take precedence over INCLUDE.
- Among INCLUDE filters, the first match wins.
- Items matching no filter are excluded by default.

### Starting offset for new shadow topics

Only affects newly created shadow topics (not existing ones): `start_at_earliest` (default, full history), `start_at_latest` (only new data), or `start_at_timestamp: <ts>` (point-in-time).

## Topic Property Replication Rules

**Never replicated:** `redpanda.remote.readreplica`, `redpanda.remote.recovery`, `redpanda.remote.allowgaps`, `redpanda.virtual.cluster.id`, `redpanda.leaders.preference`, `redpanda.cloud_topic.enabled`.

**Always replicated:** `max.message.bytes`, `cleanup.policy`, `message.timestamp.type`.

**Always replicated unless `exclude_default: true`:** `compression.type`, `retention.bytes`, `retention.ms`, `delete.retention.ms`, `replication.factor`, `min.compaction.lag.ms`, `max.compaction.lag.ms`.

To replicate anything else, list it under `synced_shadow_topic_properties`.

## Networking and Limitations

- Pull-based: the **shadow** cluster initiates outbound Kafka-protocol (TCP 9092) connections to the source. Open inbound 9092 on the source from the shadow's subnets.
- Each shadow cluster maintains **only one** shadow link (active-passive only; no active-active).
- Asynchronous only — there is always some replication lag.
- Data transforms are not supported on shadow clusters while Shadowing is active; writing to shadow topics is blocked until failover.
- Do not shadow source topics that have `write.caching` enabled (risk of divergence on broker reset).
- System topics: literal filters for `__consumer_offsets` and `_redpanda.audit_log` are rejected; prefix filters on `_redpanda`/`__redpanda` are rejected; `*` does not match `_redpanda`/`__redpanda` topics.
