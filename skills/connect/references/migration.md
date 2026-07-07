# Redpanda Connect: Kafka → Redpanda Migration (redpanda_migrator)

Redpanda Migrator moves a workload from any Apache Kafka-compatible cluster to Redpanda using a single Connect pipeline. It is built from a dedicated pair of components — the `redpanda_migrator` **input** and the `redpanda_migrator` **output** — that together migrate:

- **Topic data** (messages), preserving partition counts.
- **Topic configuration** (a serverless-aware subset of config keys) and replication factor.
- **Schemas** (Schema Registry subjects, versions, and compatibility settings).
- **ACLs** (optional, via `sync_topic_acls`), with safety downgrades.
- **Consumer group offsets**, translated to equivalent destination positions.

The migrator components are **not license-gated**: they are certified community components (`support: certified` in `internal/plugins/info.csv` of `redpanda-data/connect`), so no Enterprise license is required.

## Unified migrator vs the legacy bundle

The **unified** `redpanda_migrator` input/output pair was introduced in **Redpanda Connect 4.67.5**. It replaces the older bundle components — `redpanda_migrator_bundle`, `legacy_redpanda_migrator`, and `legacy_redpanda_migrator_offsets` — which were **deprecated in 4.67.5 and removed in 4.85.0**. The two models are not backward-compatible.

| | Legacy (removed in 4.85.0) | Unified (4.67.5+) |
|---|---|---|
| Shape | `redpanda_migrator_bundle` wrapper managing three subcomponents (data, `schema_registry`, offsets) | One `redpanda_migrator` input + one `redpanda_migrator` output |
| Pairing | `input_bundle_label` / internal routing | Matching `label` on input and output |
| Where logic lives | Split across subcomponents | All migration logic in the **output** (topic creation, schema sync, ACLs, consumer group offsets) |
| Topic renaming | `topic_prefix` | `topic` with interpolation, e.g. `'migrated_${! @kafka_topic }'` |
| Offset sync | `redpanda_migrator_offsets` pair | `consumer_groups` block on the output |

If you encounter a config using the bundle components, the full field-by-field mapping lives in the docs guide `guides:migration/migrate-unified-redpanda-migrator.adoc` (docs.redpanda.com → Redpanda Connect → Guides → Migration). Key renames: `topic_prefix` → output `topic` interpolation; `regexp_topics: true` → `regexp_topics_include`/`regexp_topics_exclude` arrays; `translate_schema_ids` → `schema_registry.translate_ids`; `consumer_group_offsets_poll_interval` → `consumer_groups.interval`.

## When to use the migrator vs a plain pipeline

**Use `redpanda_migrator` input → `redpanda_migrator` output when:**
- You are migrating a cluster (or a set of topics) from Kafka to Redpanda and need topics auto-created at the destination with matching partition counts and configs.
- You need schemas, consumer group offsets, or ACLs carried over — a plain pipeline moves none of these.
- You want live cutover: the migrator keeps syncing new data, new topics (as messages arrive), schemas, and offsets while producers/consumers stay on the source, until you repoint them.

**Use a plain `redpanda` (or `kafka_franz`) input → `redpanda` output when:**
- You just need to copy or fork message data, possibly transformed, between clusters or topics.
- Destination topics already exist (or auto-creation is acceptable) and you don't need schema/offset/ACL sync.
- The flow is a permanent data pipeline, not a migration. The migrator pair is designed for migration scenarios, not general streaming.

**Not migrated (manual steps):** users/credentials, and Redpanda roles (when the source is Redpanda), require manual migration. Changing topic settings such as partition count during migration is not supported.

## Workflow shape

A typical Kafka → Redpanda migration:

1. **Grant ACLs** to the migrator's principals (see below) if the clusters enforce authorization.
2. **Write the pipeline**: source cluster + source Schema Registry on the input; destination cluster, destination Schema Registry, and migration behavior on the output. Pair them with matching `label` values.
3. **Lint and run**: `rpk connect lint migrator.yaml`, then `rpk connect run migrator.yaml`, and leave it running. Test with non-production topics first.
4. **Monitor**: watch the `input_redpanda_migrator_lag` metric (labels: `topic`, `partition`) until lag reaches ~0; the output also emits `redpanda_migrator_*` counters/timers for topic, schema, and consumer-group sync (e.g. `redpanda_migrator_topics_created_total`, `redpanda_migrator_sr_schemas_created_total`, `redpanda_migrator_cg_offsets_translated_total`).
5. **Verify**: `rpk topic list` and `rpk security acl list` against the destination; compare schemas.
6. **Cut over**: stop source consumers, give the migrator time to sync the final translated offsets, then start consumers against the destination with the *same consumer group* — they resume from the translated offsets. Repoint producers.

```yaml
# migrator.yaml — workflow shape (full field list: rpk connect create redpanda_migrator)
input:
  label: "migration_pipeline"          # input/output paired by matching label
  redpanda_migrator:
    seed_brokers: [ "source-kafka:9092" ]
    topics: [ '^[^_]' ]                # regex; skips internal topics starting with _
    regexp_topics: true                # newer alternative: regexp_topics_include/_exclude arrays
    consumer_group: migrator
    schema_registry:                   # SOURCE Schema Registry goes on the input
      url: http://source-registry:8081

output:
  label: "migration_pipeline"          # must match the input label exactly
  redpanda_migrator:
    seed_brokers: [ "destination-redpanda:9092" ]
    schema_registry:                   # DESTINATION Schema Registry + schema options
      url: http://destination-registry:8081
      translate_ids: true              # translate schema IDs to destination IDs
    consumer_groups:                   # consumer group offset migration
      enabled: true
      interval: 30s

metrics:
  prometheus: {}
```

Labels are required only with multiple migrator pairs in one config, but always recommended. Label constraints: 3–128 chars, `A-Za-z0-9-_`. Mismatched labels are the top failure mode — the pair silently fails to coordinate.

When migrating to **Redpanda Serverless**, set `serverless: true` on the output to restrict configuration to Serverless-supported features (the docs say to omit it when migrating to a BYOC cluster).

## How syncing works

Each concern syncs on its own schedule (all tunable on the output):

- **Topics**: on startup and every 5 minutes by default (`sync_topic_interval`; `0s` disables periodic sync — topics are then still created on demand when their first message arrives). Includes empty source topics.
- **Schema Registry**: once at startup, then every `schema_registry.interval` (default 5m; `0s` = one-time sync). Filter subjects with include/exclude regex lists; rename with `subject` interpolation; choose `versions: all` (default) or `latest`.
- **Consumer groups**: in the background every `consumer_groups.interval` (default 1m), filtered to migrated topics. By default all groups except `Dead`-state ones migrate; `only_empty: true` restricts to `Empty`-state groups.

### Semantics and guarantees

- Same delivery guarantees and ordering as the `redpanda` input; the input only commits its own source offsets after the output acknowledges writes.
- Destination topics are created with the source's partition count; existing destination topics are **never overwritten**.
- **Offset translation is timestamp-based and approximate** (best-effort; duplicates possible, not exactly-once). Translated offsets only ever move forward — never rewound.
- Consumer group migration requires **identical partition counts** at source and destination.
- ACL replication (when `sync_topic_acls` is enabled) never grants write access at the destination: `ALLOW WRITE` entries are not migrated, `ALLOW ALL` is downgraded to `ALLOW READ`, group ACLs are not migrated.
- The destination Schema Registry must be in `READWRITE` or `IMPORT` mode.

## Required ACLs (when clusters enforce authorization)

The input authenticates to the source, the output to the destination — grant each principal separately:

- **Source principal**: topic `READ` + `DESCRIBE_CONFIGS` on migrated topics; group `READ` on the migrator's own `consumer_group`; group `DESCRIBE` on migrated groups; cluster `DESCRIBE`.
- **Destination principal**: topic `CREATE`, `WRITE`, `ALTER`, `DESCRIBE_CONFIGS` (or cluster `CREATE` instead of per-topic `CREATE`); group `READ` on migrated groups; cluster `ALTER` only if `sync_topic_acls` is enabled.

Classic gotcha: a consumer ACL (`READ`) implicitly grants `DESCRIBE` but **not** `DESCRIBE_CONFIGS`. With only `READ`, the migrator consumes messages but fails topic creation with `TOPIC_AUTHORIZATION_FAILED` — and despite the "create topic" wording in the error, the failing call is the `DescribeConfigs` read against the *source*.

## Performance tuning

For high-throughput migrations:

- Input: raise `partition_buffer_bytes` (e.g. 2MB) for partition readahead, and `max_yield_batch_bytes` (e.g. 1MB — going higher is counter-productive unless brokers allow bigger batches).
- Output: set `max_in_flight` to the number of partitions being copied in parallel (higher values add nothing beyond the partition count).

## Authoritative reference

Do not rely on any per-field enumeration here; the migrator's full config schema is auto-generated. Consult:

- `rpk connect create redpanda_migrator` (input template) and `rpk connect create //redpanda_migrator` (output template) on your installed version.
- Component reference pages: docs.redpanda.com → Redpanda Connect → Components → Inputs/Outputs → `redpanda_migrator` (rp-connect-docs `modules/components/pages/{inputs,outputs}/redpanda_migrator.adoc`).
- End-to-end cookbook: rp-connect-docs `modules/cookbooks/pages/redpanda_migrator.adoc`.
- Legacy-to-unified upgrade guide: rp-connect-docs `modules/guides/pages/migration/migrate-unified-redpanda-migrator.adoc`.
- Implementation: `redpanda-data/connect` `internal/impl/redpanda/migrator/`.
