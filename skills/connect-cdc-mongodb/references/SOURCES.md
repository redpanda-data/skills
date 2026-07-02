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

Both are public — read them via the Redpanda-Github-Read MCP connector
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
| `SKILL.md` | `internal/impl/mongodb/cdc/input.go` (config spec, `newMongoCDC`, `license.CheckRunningEnterprise`, checkpoint/snapshot/streaming logic, metadata keys), `internal/impl/mongodb/cdc/schema.go` (schema metadata, `normaliseDecimal128`), `internal/impl/mongodb/cdc/checkpoint_cache.go`, `internal/impl/mongodb/common.go` (connection/URL/auth/driver timeouts) | `modules/components/pages/inputs/mongodb_cdc.adoc` (auto-generated); `docs-data/overrides.json` (`mongodb_cdc` entry) |
| `references/config-reference.md` | `internal/impl/mongodb/cdc/input.go` (every field: `url`, `database`, `username`, `password`, `app_name`, `collections`, `checkpoint_*`, `read_*`, `stream_snapshot`, `snapshot_parallelism`, `snapshot_auto_bucket_sharding`, `document_mode`, `json_marshal_mode`, `auto_replay_nacks`; `$match` filter; driver timeouts), `internal/impl/mongodb/cdc/schema.go` (`normaliseDecimal128`, `schema.BigDecimal` contract) | `modules/components/pages/inputs/mongodb_cdc.adoc` (field list + defaults — **auto-generated, source of record**); `docs-data/overrides.json` |
| `references/setup-mongodb.md` | `internal/impl/mongodb/cdc/input.go` (startup `{hello:1}` check, `lastWrite.majorityOpTime.ts` / `isdbgrid` / `getCurrentResumeToken`, version `< 4` error string, `splitVector` / `$bucketAuto` snapshot paths, error messages) | `modules/components/pages/inputs/mongodb_cdc.adoc` |
| `references/pipeline-and-output.md` | `internal/impl/mongodb/cdc/input.go` (message body per `document_mode`, metadata keys `operation`/`collection`/`operation_time`/`schema`, resume/restart semantics, `ResumeAfter`), `internal/impl/mongodb/cdc/schema.go` (Decimal128 normalization) | `modules/components/pages/inputs/mongodb_cdc.adoc`; cache-resource and `redpanda`/`kafka_franz` output pages under `modules/components/pages/` (see TODO) |
| `references/enterprise-integration.md` | `internal/impl/mongodb/cdc/input.go` (`license.CheckRunningEnterprise` gating); output SASL mechanism enum from the Kafka/franz output impl in `redpanda-data/connect` (see TODO) | `modules/components/pages/inputs/mongodb_cdc.adoc`; `redpanda`/`kafka_franz` output reference pages. **Enterprise topic/cluster keys (Iceberg, Schema ID Validation, Tiered Storage) are NOT Connect sources** — see TODO |

## Deferred to auto-generation / external (NOT drift — do not pin or hardcode)

- **The `mongodb_cdc` field list, types, and defaults are auto-generated** from the Go config spec in `cdc/input.go` and rendered into `mongodb_cdc.adoc`, with descriptions overridden via `docs-data/overrides.json`. Verify field/default facts against the generated page + overrides + the Go spec — never trust a static table alone.
- **MongoDB server setup** (replica set / sharded cluster, `rs.initiate`, roles like `read`/`clusterManager`, `changeStreamPreAndPostImages`, `$jsonSchema` validators, `--oplogMinRetentionHours`, Atlas UI) is **external MongoDB behavior**, not defined in either Redpanda repo.
- **`rpk connect run` / connector availability** is a managed-plugin passthrough to the Redpanda Connect binary; confirm with `rpk connect list` rather than assuming.

## TODO / re-verify

- **Skill cites a wrong docs path:** `config-reference.md` and `setup-mongodb.md` reference the generated page as `connect/docs/modules/components/pages/inputs/mongodb_cdc.adoc`. The published page actually lives in **`rp-connect-docs`** at `modules/components/pages/inputs/mongodb_cdc.adoc` (no `connect/docs/` prefix). The Go docstrings that feed generation are in `connect/internal/impl/mongodb/cdc/input.go`. Correct the skill's citation.
- **Enterprise topic/cluster properties** (`iceberg_enabled`, `redpanda.iceberg.*`, `enable_schema_id_validation`, `redpanda.{key,value}.schema.id.validation`, `redpanda.{key,value}.subject.name.strategy`, `redpanda.remote.{read,write,delete}`, `retention.local.target.{ms,bytes}`) in `enterprise-integration.md` are **broker** properties, not Connect. Citation of record: `redpanda-data/docs` property partials (`topic-properties.adoc`, `cluster-properties.adoc`, `object-storage-properties.adoc`), upstream `redpanda-data/redpanda` `src/v/config/configuration.cc`. Not verified this session.
- **Licensing / Schema ID Validation prose** (`licensing/overview.adoc`, `schema-reg/schema-id-validation.adoc`) live in `redpanda-data/docs`, not Connect — not verified this session.
- **`redpanda` / `kafka_franz` output fields** (`seed_brokers`, `tls.client_certs[]`, `sasl[].mechanism` enum, `sasl[].token`/`extensions`, `metadata.include_patterns`) are grounded in the Kafka/franz output impl in `redpanda-data/connect` + output pages in `rp-connect-docs` (`modules/components/pages/outputs/`) — exact files not verified this session.
- **Cache resource fields** cited in `pipeline-and-output.md` come from the respective cache component sources/pages — not verified this session.
- **Individual defaults/enums** in `config-reference.md` (e.g. `app_name: "benthos"`, `checkpoint_limit: 1000`, `read_max_wait: 1s`, `document_mode`/`json_marshal_mode` enums, `snapshot_parallelism >= 1` lint) not each line-verified against `cdc/input.go` this session.

## Usage

For each file being reviewed or updated, open the listed source paths first and confirm
every claim still matches. Verify connector behavior, field names, defaults, enums, and
error strings against `redpanda-data/connect` `internal/impl/mongodb/cdc/` and the
auto-generated `mongodb_cdc.adoc` + `docs-data/overrides.json` in `redpanda-data/rp-connect-docs`.
Do not hardcode the auto-generated field list; defer MongoDB server setup to MongoDB's own
docs; and treat the enterprise topic/cluster keys as broker properties owned by the
Redpanda docs, re-verifying them there rather than in Connect.
