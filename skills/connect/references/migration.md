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
| Pairing | `input_bundle_label` / internal routing | Implicit for a single pair; matching `label` on input and output when one config carries several |
| Where logic lives | Split across subcomponents | All migration logic in the **output** (topic creation, schema sync, ACLs, consumer group offsets) |
| Topic renaming | `topic_prefix` | `topic` with interpolation, e.g. `'migrated_${! @kafka_topic }'` |
| Offset sync | `redpanda_migrator_offsets` pair | `consumer_groups` block on the output |

If you encounter a config using the bundle components, the full field-by-field mapping lives in the Redpanda Connect migration guide (docs.redpanda.com → Redpanda Connect → Guides → Migration). Key renames: `topic_prefix` → output `topic` interpolation; `regexp_topics: true` → `regexp_topics_include`/`regexp_topics_exclude` arrays; `translate_schema_ids` → `schema_registry.translate_ids`; `consumer_group_offsets_poll_interval` → `consumer_groups.interval`.

## When to use the migrator vs a plain pipeline

**Use `redpanda_migrator` input → `redpanda_migrator` output when:**
- You are migrating a cluster (or a set of topics) from Kafka to Redpanda and need topics auto-created at the destination with matching partition counts and configs.
- You need schemas, consumer group offsets, or ACLs carried over — a plain pipeline moves none of these.
- You want live cutover: the migrator keeps syncing new data, new topics (as messages arrive), schemas, and offsets while producers/consumers stay on the source, until you repoint them.

**Use a plain `redpanda` input → `redpanda` output when:**
- You just need to copy or fork message data, possibly transformed, between clusters or topics.
- Destination topics already exist (or auto-creation is acceptable) and you don't need schema/offset/ACL sync.
- The flow is a permanent data pipeline, not a migration. The migrator pair is designed for migration scenarios, not general streaming.

**Not migrated (manual steps):** users/credentials, and Redpanda roles (when the source is Redpanda), require manual migration. Changing topic settings such as partition count during migration is not supported.

## Workflow shape

A typical Kafka → Redpanda migration:

1. **Grant ACLs** to the migrator's principals (see below) if the clusters enforce authorization.
2. **Write the pipeline**: source cluster + source Schema Registry on the input; destination cluster, destination Schema Registry, and migration behavior on the output. A single pair needs no labels; see below if one config carries several pairs.
3. **Lint and run**: `rpk connect lint migrator.yaml`, then `rpk connect run migrator.yaml`, and leave it running. Test with non-production topics first.
4. **Monitor**: watch the `redpanda_lag` gauge (labels: `topic`, `partition`), which the input emits only when it has a `consumer_group` set, until lag reaches ~0; the output also emits `redpanda_migrator_*` counters/timers for topic, schema, and consumer-group sync (e.g. `redpanda_migrator_topics_created_total`, `redpanda_migrator_sr_schemas_created_total`, `redpanda_migrator_cg_offsets_translated_total`).
5. **Verify**: `rpk topic list` and `rpk security acl list` against the destination; compare schemas.
6. **Cut over**: stop source consumers, give the migrator time to sync the final translated offsets, then start consumers against the destination with the *same consumer group* — they resume from the translated offsets. Repoint producers.

```yaml
# migrator.yaml — workflow shape (full field list: rpk connect create redpanda_migrator)
input:
  redpanda_migrator:
    seed_brokers: [ "source-kafka:9092" ]
    topics: [ '^[^_]' ]                # regex; skips internal topics starting with _
    regexp_topics: true                # newer alternative: regexp_topics_include/_exclude arrays
    consumer_group: migrator
    schema_registry:                   # SOURCE Schema Registry goes on the input
      url: http://source-registry:8081

output:
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

A single migrator pair needs no labels — the input and the output find each other on their own. Labels matter only when one config carries **several** pairs: each input is then paired with the output carrying the same `label`, and a pair whose labels differ fails to connect, reporting that the input or the output was not initialized. Label syntax is the engine's: lowercase `[a-z0-9_-]`, not starting with `_` or `-`. One caveat before relying on a multi-pair layout — the engine's linter reports a label used twice in one config as a collision, so lint the config (`rpk connect lint`) and confirm the behaviour on your installed version.

When migrating to **Redpanda Serverless**, set `serverless: true` on the output to restrict configuration to Serverless-supported features (the docs say to omit it when migrating to a BYOC cluster).

## How syncing works

Each concern syncs on its own schedule (all tunable on the output):

- **Topics**: on startup and every 5 minutes by default (`sync_topic_interval`; `0s` disables periodic sync — topics are then still created on demand when their first message arrives). Includes empty source topics.
- **Schema Registry**: once at startup, then every `schema_registry.interval` (default 5m; `0s` = one-time sync). Filter subjects with include/exclude regex lists; rename with `subject` interpolation; choose `versions: all` (default) or `latest`.
- **Consumer groups**: in the background every `consumer_groups.interval` (default 1m), filtered to migrated topics. By default all groups except `Dead`-state ones migrate; `only_empty: true` restricts to `Empty`-state groups.

### Semantics and guarantees

- Same delivery guarantees and ordering as the `redpanda` input; the input only commits its own source offsets after the output acknowledges writes.
- Destination topics are created with the source's partition count; existing destination topics are **never re-created**, though an existing one with fewer partitions than its source has partitions added to match.
- **Offset translation is timestamp-based and approximate** (best-effort; duplicates possible, not exactly-once) for every group that still has members. Translated offsets only ever move forward — never rewound.
- **Groups in the `Empty` state (no active members) are translated exactly**, as long as the output's offset header is in use: each migrated record carries its source offset in that header, and the output uses it to refine the timestamp result to the exact destination record. Timestamps have millisecond resolution, so records that share one can otherwise translate to a neighbour — which is why consumers should be stopped before the final offset sync. Setting `offset_header` to an empty string drops the header and the exact path with it.
- Consumer group migration requires **identical partition counts** at source and destination.
- ACL replication (when `sync_topic_acls` is enabled) never grants write access at the destination: `ALLOW WRITE` entries are not migrated, `ALLOW ALL` is downgraded to `ALLOW READ`, group ACLs are not migrated.
- The destination Schema Registry must be in `READWRITE` or `IMPORT` mode; the migrator checks the destination's global mode at sync time and fails otherwise. With `serverless: true`, and only when the destination is not already globally in `IMPORT` mode, it additionally flips each destination *subject* to `IMPORT` before writing its first version and restores the previous subject mode once the sync completes.

### Which registry mode, when (`schema_registry` output)

The standalone `schema_registry` input/output pair — the registry-to-registry copy, separate from the unified migrator — ties the required destination mode to its own `translate_ids` field (default `false`):

| `translate_ids` | Schemas created with | Destination mode required |
|---|---|---|
| `false` (default) | Their original IDs and versions | `IMPORT` — Redpanda **v25.3 or later**, or Confluent Schema Registry |
| `true` | New IDs assigned by the destination | `READWRITE` (a schema registered without an explicit ID is rejected in `IMPORT` mode) |

As of Connect 4.112.0 the output relies on native `IMPORT` support rather than the workaround it previously used for Redpanda versions before 25.3, so `translate_ids: false` against an older destination no longer works — either upgrade the destination or set `translate_ids: true`. The output fails to connect if the global mode is neither `READWRITE` nor `IMPORT`; a mode that merely mismatches `translate_ids` is a **warning**, not an error, because mode can also be set per subject, which the global check cannot see.

Note that the unified migrator's `schema_registry.translate_ids` is a *different* implementation with the same name: it keeps a fixed-ID fallback (on an ID conflict it compares the existing schema and reuses its ID), so it does not impose the table above. Do not carry a conclusion from one to the other.

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
- Component reference pages: docs.redpanda.com → Redpanda Connect → Components → Inputs/Outputs → `redpanda_migrator`.
- End-to-end cookbook: docs.redpanda.com → Redpanda Connect → Cookbooks → Redpanda Migrator.
- Legacy-to-unified upgrade guide: docs.redpanda.com → Redpanda Connect → Guides → Migration.
- Implementation: `redpanda-data/connect` `internal/impl/redpanda/migrator/`.
