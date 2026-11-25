# connect-cdc-mongodb Skill Source Map

Maps each file in `skills/connect-cdc-mongodb/` to the source paths it derives from, so
future syncs and human maintainers know exactly where to verify claims.

The skill documents the `mongodb_cdc` **input** of Redpanda Connect (MongoDB Change
Streams). Two public repos ground it:

- **`redpanda-data/connect`** (Go) — the connector implementation lives under
  `internal/impl/mongodb/`, with the CDC input in the `cdc/` subpackage. This is the
  authoritative source for behavior, field names, defaults, enums, and error strings.
- **`redpanda-data/rp-connect-docs`** — the user-facing `mongodb_cdc` connector
  reference page is **auto-generated** from the Go config spec; DRY description overrides
  live in `docs-data/overrides.json`.

Read them via the Redpanda-Github-Read MCP connector
(`get_file_contents`) or `gh api .../contents/`. Avoid `gh search code` (rate-limited).
Before writing or changing any fact, re-open the cited source and confirm exact field
names, defaults, enums, and error text. Redpanda Connect is versioned; verify against the
current release, and treat the **generated page + overrides** as the field-list source of
record rather than any hardcoded table in the skill.

Scope note: MongoDB server topology/roles/oplog/Atlas setup is **external** (MongoDB
documentation), not defined in either Redpanda repo. The enterprise topic/cluster
properties (Iceberg, Schema ID Validation, Tiered Storage) are **broker** properties
defined in `redpanda-data/redpanda` / documented in `redpanda-data/docs`, not in Connect —
they belong to other skills' domains and are cited here only as pairing context.

## File-to-source table

| Skill file | redpanda-data/connect source paths | rp-connect-docs sources |
|---|---|---|
| `SKILL.md` | `internal/impl/mongodb/cdc/input.go` (config spec, `newMongoCDC`, `license.CheckRunningEnterprise`, checkpoint/snapshot/streaming logic, metadata keys), `internal/impl/mongodb/cdc/incremental_snapshot.go` (chunked read alongside streaming, `incSnapshotRun.request`), `internal/impl/mongodb/cdc/signalling.go` (`decodeMongoSignal`, `parseSnapshotCollections`, `handleSignal`), `internal/replication/signalling.go` (`LogSignalType`, `SnapshotSignalType`, `SnapshotSignal`), `internal/replication/incrementalsnapshot/coordinator.go` (chunk/window algorithm), `internal/impl/mongodb/cdc/schema.go` (schema metadata, `normaliseDecimal128`), `internal/impl/mongodb/cdc/checkpoint_cache.go`, `internal/impl/mongodb/common.go` (connection/URL/auth/driver timeouts) | `modules/components/pages/inputs/mongodb_cdc.adoc` (auto-generated); `docs-data/overrides.json` (`mongodb_cdc` entry) |
| `references/config-reference.md` | `internal/impl/mongodb/cdc/input.go` (every field: `url`, `database`, `username`, `password`, `app_name`, `collections`, `checkpoint_*`, `read_*`, `stream_snapshot`, `snapshot_parallelism`, `snapshot_auto_bucket_sharding`, `document_mode`, `json_marshal_mode`, `auto_replay_nacks`; `$match` filter; driver timeouts), `internal/impl/mongodb/cdc/schema.go` (`normaliseDecimal128`, `schema.BigDecimal` contract) | `modules/components/pages/inputs/mongodb_cdc.adoc` (field list + defaults — **auto-generated, source of record**); `docs-data/overrides.json` |
| `references/setup-mongodb.md` | `internal/impl/mongodb/cdc/input.go` (startup `{hello:1}` check, `lastWrite.majorityOpTime.ts` / `isdbgrid` / `getCurrentResumeToken`, version `< 4` error string, `splitVector` / `$bucketAuto` snapshot paths, error messages) | `modules/components/pages/inputs/mongodb_cdc.adoc` |
| `references/pipeline-and-output.md` | `internal/impl/mongodb/cdc/input.go` (message body per `document_mode`, metadata keys `operation`/`collection`/`operation_time`/`schema`, resume/restart semantics, `ResumeAfter`), `internal/impl/mongodb/cdc/schema.go` (Decimal128 normalization) | `modules/components/pages/inputs/mongodb_cdc.adoc`; cache-resource and `redpanda`/`kafka_franz` output pages under `modules/components/pages/` (see TODO) |
| `references/enterprise-integration.md` | `internal/impl/mongodb/cdc/input.go` (`license.CheckRunningEnterprise` gating); output SASL mechanism enum from the Kafka/franz output impl in `redpanda-data/connect` (see TODO) | `modules/components/pages/inputs/mongodb_cdc.adoc`; `redpanda`/`kafka_franz` output reference pages. **Enterprise topic/cluster keys (Iceberg, Schema ID Validation, Tiered Storage) are NOT Connect sources** — see TODO |

## Deferred to auto-generation / external (NOT drift — do not pin or hardcode)

- **The `mongodb_cdc` field list, types, and defaults are auto-generated** from the Go config spec in `cdc/input.go` and rendered into `mongodb_cdc.adoc`, with descriptions overridden via `docs-data/overrides.json`. Verify field/default facts against the generated page + overrides + the Go spec — never trust a static table alone.
- **MongoDB server setup** (replica set / sharded cluster, `rs.initiate`, roles like `read`/`clusterManager`, `changeStreamPreAndPostImages`, `$jsonSchema` validators, `--oplogMinRetentionHours`, Atlas UI) is **external MongoDB behavior**, not defined in either Redpanda repo.
- **`rpk connect run` / connector availability** is a managed-plugin passthrough to the Redpanda Connect binary; confirm with `rpk connect list` rather than assuming.

## TODO / re-verify

- **`references/pipeline-and-output.md` and `references/config-reference.md` predate the v4.116.0
  incremental snapshot mode.** `SKILL.md` now carries the modes, the signal contract and the
  enforced constraints, and `pipeline-and-output.md`'s restart/resume prose still describes only
  the up-front snapshot. Fold the incremental and signal paths into those two files on the next
  pass, or leave them to the docs if this skill is converted to the thin format first.

- **Skill cites a wrong docs path:** `config-reference.md` and `setup-mongodb.md` reference the generated page as `connect/docs/modules/components/pages/inputs/mongodb_cdc.adoc`. The published page actually lives in **`rp-connect-docs`** at `modules/components/pages/inputs/mongodb_cdc.adoc` (no `connect/docs/` prefix). The Go docstrings that feed generation are in `connect/internal/impl/mongodb/cdc/input.go`. Correct the skill's citation.
- **Enterprise topic/cluster properties** (`iceberg_enabled`, `redpanda.iceberg.*`, `enable_schema_id_validation`, `redpanda.{key,value}.schema.id.validation`, `redpanda.{key,value}.subject.name.strategy`, `redpanda.remote.{read,write,delete}`, `retention.local.target.{ms,bytes}`) in `enterprise-integration.md` are **broker** properties, not Connect. Citation of record: `redpanda-data/docs` property partials (`topic-properties.adoc`, `cluster-properties.adoc`, `object-storage-properties.adoc`), upstream `redpanda-data/redpanda` `src/v/config/configuration.cc`. Not verified this session.
- **Licensing / Schema ID Validation prose** (`licensing/overview.adoc`, `schema-reg/schema-id-validation.adoc`) live in `redpanda-data/docs`, not Connect — not verified this session.
- **`redpanda` / `kafka_franz` output fields** (`seed_brokers`, `tls.client_certs[]`, `sasl[].mechanism` enum, `sasl[].token`/`extensions`, `metadata.include_patterns`) are grounded in the Kafka/franz output impl in `redpanda-data/connect` + output pages in `rp-connect-docs` (`modules/components/pages/outputs/`) — exact files not verified this session.
- **Cache resource fields** cited in `pipeline-and-output.md` come from the respective cache component sources/pages — not verified this session.
- **Individual defaults/enums** in `config-reference.md` (e.g. `app_name: "benthos"`, `checkpoint_limit: 1000`, `read_max_wait: 1s`, `document_mode`/`json_marshal_mode` enums, `snapshot_parallelism >= 1` lint) not each line-verified against `cdc/input.go` this session.

## Sync log

- **Verified against Connect v4.118.0 (2026-11-13 sync).** One new structural surface: `mongodb_cdc`
  gained an incremental snapshot mode and a signal collection at **v4.116.0**, neither of which the
  skill covered. Grounded at tag `v4.118.0` in `internal/impl/mongodb/cdc/input.go` (the field
  constants `incremental_snapshot` with `enabled` / `chunk_size` / `checkpoint_cache_key` /
  `retry_cooldown`, and `signal_collection_name`; their `Description` strings; and the startup
  checks in the config parse), `internal/impl/mongodb/cdc/signalling.go` and
  `internal/replication/signalling.go`.
  - **Two mutually exclusive snapshot modes.** `stream_snapshot` and
    `incremental_snapshot.enabled` are rejected together at startup — "are mutually exclusive
    snapshot modes, only one can be enabled" — because both read the same documents. The
    incremental mode reads collections in `_id`-ordered chunks alongside the stream with no up-front
    phase, releasing each chunk once the stream has caught up with the moment it was read.
  - **A `snapshot-execute` signal works in every snapshot mode**, `incremental_snapshot.enabled`
    included or not; the field's own description says so, and `handleSignal` queues on the run that
    "every connection with a signal collection has, whatever the snapshot mode". The payload accepts
    `collections` **and** the shared `tables` key, merged by `parseSnapshotCollections`.
  - **The four traps taken into the skill**, each from an enforced check or a log line:
    `signal_collection_name` must not name a streamed collection ("its inserts are read as
    signals"); signal inserts are also emitted as ordinary messages with `collection` metadata set
    to the signal collection (stated in the field description); a signal naming a collection outside
    `collections` is rejected and only logged at error while the stream continues
    (`handleSignal`), and one already queued or being read is logged at info; and with neither
    `enabled` nor a signal collection the stored progress is discarded (the "Discarding the
    incremental snapshot progress stored under %s" log).
  - **Two startup constraints**, both from the config parse: `incremental_snapshot.checkpoint_cache_key`
    must differ from `checkpoint_key`, and `incremental_snapshot.chunk_size` must not exceed
    `checkpoint_limit` ("a chunk is in flight as a whole").
  - **Contrast with `postgres_cdc` taken from the field description verbatim in substance:** a new
    `checkpoint_cache_key` does *not* cause a new read in `mongodb_cdc`; re-reading a collection
    takes a signal.
  - **`references/pipeline-and-output.md` Restart Behavior was drifted** by the same change — it
    said no snapshot runs on restart "regardless of the `stream_snapshot` setting", which is still
    true of the up-front snapshot but not of an incremental read (resumed from its own progress key)
    or of a queued signal (checkpointed into the queue before the carrying transaction is acked).
    Corrected in `SKILL.md`; see the TODO below for the reference file.
  - **Deliberately deferred:** the field types, defaults and the full `incremental_snapshot` block
    stay in the generated reference and `rpk connect create mongodb_cdc`. The skill documents the
    modes, the signal contract and the enforced constraints only.
  - **Also in the window, deliberately not documented:** the `v4.116.0` fix to snapshot-signal
    behavior across all modes and for collections unknown to stored progress (`#5066`), and the
    `v4.118.0` fix making the incremental snapshot wait for the majority snapshot to reach the
    stream start (`#5132`). Both are corrections to the behavior the skill now describes, with no
    separate config or decision surface.

- **Verified against Connect v4.106.0 (2026-08-21 sync).** New sources for this release:
  - `internal/impl/mongodb/common.go` — `AWSIAMAuthField()` (the shared `aws` block spec: `enabled`, `region`, `session_duration`, `id`/`secret`/`token`, `role`/`role_external_id`, `roles[]`), plus the startup errors rejecting `username`/`password` and url-embedded credentials when `aws.enabled` is true, and the note that the processor and cache reject role/session credentials (no refresh path).
  - `internal/impl/mongodb/aws/aws.go` — the `MONGODB-AWS` credential builder; registered in `public/components/aws/package.go`.
  - `internal/impl/mongodb/cdc/input.go` — `checkpoint_write_timeout` (`defaultCheckpointWriteTimeout = 10 * time.Second`, rejected when ≤ 0) and `on_unresumable_position` (`fail`/`reset`, default `fail`); the post-snapshot checkpoint write; the token-epoch guard that discards late acks from a superseded checkpoint generation; and `maxConsecutiveUnresumableRecoveries = 3`, the breaker behind the "3 consecutive recoveries" claim in `SKILL.md` and `pipeline-and-output.md`.
  - Generated page `modules/components/pages/inputs/mongodb_cdc.adoc` — the new `Scaling` section (single database-level change stream; ~2-core ceiling; shard to scale) sourced the `SKILL.md` Scaling section.
- The per-sub-field `aws` table in `config-reference.md` is a convenience transcription; the generated page plus `docs-data/overrides.json` remain the field-list source of record.

## Usage

For each file being reviewed or updated, open the listed source paths first and confirm
every claim still matches. Verify connector behavior, field names, defaults, enums, and
error strings against `redpanda-data/connect` `internal/impl/mongodb/cdc/` and the
auto-generated `mongodb_cdc.adoc` + `docs-data/overrides.json` in `redpanda-data/rp-connect-docs`.
Do not hardcode the auto-generated field list; defer MongoDB server setup to MongoDB's own
docs; and treat the enterprise topic/cluster keys as broker properties owned by the
Redpanda docs, re-verifying them there rather than in Connect.

### Connect v4.113.1 (2026-10-16 sync)

- **`kafka_franz` → `redpanda` in every example.** All four `kafka`/`kafka_franz`
  rows in `internal/plugins/info.csv` are `deprecated=y` at tag `v4.113.1`, and
  `internal/impl/kafka/output_kafka_franz.go` is `.Deprecated()` with a
  description that opens "Use the `redpanda` output instead". The rename is
  field-safe: both specs are assembled from the same `FranzConnection*`,
  `FranzWriterConfigFields` and `FranzProducerFields` groups, so every field used
  in these examples exists unchanged on `redpanda` (`seed_brokers` is merely
  optional there). Each changed YAML block was re-parsed after the rename.
- The Redpanda-sink section in `references/enterprise-integration.md` said
  "the `redpanda`/`kafka_franz` output"; it now names `redpanda` alone. The
  file-to-source rows in this map still mention both, because the shared franz
  writer fields are where those claims are grounded.
