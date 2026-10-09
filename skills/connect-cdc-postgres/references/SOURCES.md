# connect-cdc-postgres Skill Source Map

Maps each file in `skills/connect-cdc-postgres/` to the source paths it derives from, so future
syncs and human maintainers know exactly where to verify claims.

The `postgres_cdc` input is Go source in the **public** repo `redpanda-data/connect` under
`internal/impl/postgresql/` (logical replication / WAL decoding via the `pgoutput` plugin). The
user-facing reference is **auto-generated** into the **private** repo `redpanda-data/rp-connect-docs`
(`modules/components/pages/inputs/postgres_cdc.adoc`), with field descriptions supplied by
`docs-data/overrides.json`. The same generated page is committed into the **public** `redpanda-data/connect`
repo at `docs/modules/components/pages/inputs/postgres_cdc.adoc` and is tagged with each release, so
per-field verification at a specific release tag can be done entirely in the public repo — prefer that
path, and use the private repo only for overrides and the versioned `docs-data/connect-<version>.json`. Read them via the Redpanda-Github-Read MCP
connector (`get_file_contents`) or `gh api .../contents/`; avoid `gh search code` (rate-limited).
Before writing or changing any fact, re-open the cited source and confirm exact field names, types,
and defaults. The connector was introduced in Connect **4.39.0**; the legacy input name `pg_stream`
is deprecated but still present. Verify against the current release, not `main`, for version-sensitive
claims.

Scope note: the destination-topic **enterprise** features (Iceberg Topics, Tiered Storage,
Schema ID Validation) are **Redpanda broker** features, not part of `postgres_cdc`. Their config
keys live in `redpanda-data/redpanda` (`src/v/config/configuration.cc`) and are documented in
`redpanda-data/docs`; treat those as a separate source domain (see the enterprise-sink row and TODO).

## File-to-source table

| Skill file | connect source paths (`redpanda-data/connect`) | docs sources |
|---|---|---|
| `SKILL.md` | `internal/impl/postgresql/input_pg_stream.go` (field registration, connector name/version, Enterprise gating, `signal_table_name` field + startup validation), `internal/impl/postgresql/signaller.go` (control-signal detection: signal-row shape `id`/`type`/`data`, `log` signal type, forward-downstream + warn-on-unrecognized behavior, since 4.105.0), `internal/replication/signalling.go` (the signal-type constants `log` and `snapshot-execute` and their `data` payload shapes), `internal/impl/postgresql/pglogicalstream/incremental_snapshot.go` (signal dispatch, signal rejection reasons, TOAST-fidelity and partitioned-table warnings), `internal/impl/postgresql/pglogicalstream/` (`logical_stream.go`, `stream_message.go`, `snapshotter.go`, `heartbeat.go`, `monitor.go`, `schema.go`) | `redpanda-data/rp-connect-docs`: `modules/components/pages/inputs/postgres_cdc.adoc` (auto-generated), `docs-data/overrides.json` (`inputs[].name == "postgres_cdc"`) |
| `references/config-reference.md` | `internal/impl/postgresql/input_pg_stream.go` (config spec: every field, type, default, required/advanced/deprecated flags), `internal/impl/postgresql/aws/` (the `aws` IAM auth block), `internal/impl/postgresql/pglogicalstream/config.go`; `incremental_snapshot` block: `internal/impl/postgresql/input_pg_stream.go` (the `incremental_snapshot` object field + nested specs/defaults), `internal/impl/postgresql/config.go` (`parseIncrementalSnapshotCfg` — every startup validation: `stream_snapshot` exclusivity, `signal_table_name` requirement, non-zero top-level `heartbeat_interval`, required `checkpoint_cache` + cache-resource existence, `chunk_size`/`heartbeat_interval` > 0, `retry_cooldown` >= 0), `internal/impl/postgresql/incrementalsnapshot/config.go` (the default constants) | `modules/components/pages/inputs/postgres_cdc.adoc` (field list + defaults — **auto-generated**), `docs-data/overrides.json` (`postgres_cdc` field descriptions: `dsn`, `aws`, `include_transaction_markers`, …) |
| `references/setup-postgres.md` | `internal/impl/postgresql/pglogicalstream/logical_stream.go` (slot/publication creation, `pglog_stream_<slot_name>` naming, `pgoutput`), `pglogrepl.go` (replication protocol, `IDENTIFY_SYSTEM`, version detection / `messages` option for PG 15+), `snapshotter.go` (snapshot export), `monitor.go` (`postgres_snapshot_progress` denominator = `pg_class.reltuples` planner estimate, runtime `TrackSnapshotTable` for incrementally backfilled tables, and the "run ANALYZE" warning when the estimate is unavailable), `incremental_snapshot.go` (`publish_via_partition_root` requirement for partitioned tables). PostgreSQL server-side setup (`wal_level`, `REPLICA IDENTITY`, RDS/Aurora, IAM) is **external** (PostgreSQL/AWS docs), not in this repo. | `modules/components/pages/inputs/postgres_cdc.adoc` (setup prose) |
| `references/pipeline-and-output.md` | `internal/impl/postgresql/pglogicalstream/stream_message.go` (`OpType` constants: `read`/`insert`/`update`/`delete`/`begin`/`commit`), `logical_stream.go` (checkpointing via `github.com/Jeffail/checkpoint`, LSN ack, `pg_standby_status_update`, snapshot→stream lifecycle, `RelationMessage` DDL handling), `input_pg_stream.go` (metadata keys `table`/`operation`/`lsn`/`commit_ts_ms`/`before`/`schema`; `parquet_encode` schema-metadata compatibility; the `snapshot_complete` / `incremental_snapshot_checkpoint` internal sentinels, which are **never** forwarded downstream and so must not appear in the `operation` table); incremental backfill lifecycle: `pglogicalstream/incremental_snapshot.go` (chunk release on streamed commit, `ReadOpType` with nil LSN for backfilled rows, primary-key dedup incl. the key vacated by a key-changing update, `lock_timeout` 5s / read timeout 15s, retry cooldown), `internal/impl/postgresql/incrementalsnapshot/chunk_query.go` (`ROW(pk) > lower AND <= upper`, `ORDER BY pk ASC`, `LIMIT chunk_size`; max-key upper bound), `internal/replication/incrementalsnapshot/` (coordinator, window buffer, watermark, state) | `modules/components/pages/inputs/postgres_cdc.adoc` (metadata table, examples) |
| `references/enterprise-sink-features.md` | **Not `postgres_cdc`** — Redpanda broker features. Connector-license gating: `input_pg_stream.go` (Enterprise registration). | `redpanda-data/docs` (AsciiDoc, **unverified in this pass** — see TODO): `manage:iceberg/about-iceberg-topics.adoc`, `reference:properties/topic-properties.adoc`, `manage:tiered-storage.adoc`, `manage:schema-reg/schema-id-validation.adoc`, `get-started:licensing/overview.adoc`. Ground truth for broker/topic property defaults + accepted values: `redpanda-data/redpanda` `src/v/config/configuration.cc`. |

## Deferred to live introspection (NOT drift — do not pin or hardcode)

The `postgres_cdc` field list, per-field defaults, and descriptions are **auto-generated**:

- **Field enumeration + defaults** (e.g. `snapshot_batch_size`, `checkpoint_limit`, `heartbeat_interval`, `pg_standby_timeout`, `pg_wal_monitor_interval`, `stream_snapshot`, `max_parallel_snapshot_tables`, `temporary_slot`, `include_transaction_markers`, `unchanged_toast_value`, `signal_table_name`, `tls.*`, `aws.*`, `batching.*`, `auto_replay_nacks`) — the canonical list is the generated `modules/components/pages/inputs/postgres_cdc.adoc` in `rp-connect-docs`, produced from the Go config spec in `input_pg_stream.go`. Field **descriptions** come from `docs-data/overrides.json`. Re-generate/re-read rather than trust the skill's hardcoded table.
- **Recognized control-signal types** — the set of `type` values the signaller acts on is evolving (only `log` is recognized as of 4.105.0; unrecognized types are forwarded downstream and logged as warnings). The source of record is the `switch` in `signaller.go` and the generated `postgres_cdc.adoc`; the skill documents the mechanism, not an exhaustive signal catalog. Do not hardcode the list as fixed.
- **Connector reference page as a whole** — regenerated by the auto-docs pipeline (`npx doc-tools generate rpcn-connector-docs`); never hand-edit the generated `.adoc`.
- **Enterprise/community binary component availability** (`components/aws` for IAM auth) — depends on the binary build, not a fixed path.

## TODO / re-verify

- **Per-field defaults not each line-verified** against `input_pg_stream.go` (e.g. `snapshot_batch_size: 1000`, `checkpoint_limit: 1024`, `heartbeat_interval: 1h`, `pg_standby_timeout: 10s`, `pg_wal_monitor_interval: 3s`, `max_parallel_snapshot_tables: 1`) — re-read the Go spec / generated page. Reconcile the `batching.count` default (skill states `1`, but the "all fields" example shows `count: 0`).
- **`config-reference.md` cites the generated page as `docs/modules/components/pages/inputs/postgres_cdc.adoc`** — the actual path in `rp-connect-docs` is `modules/components/pages/inputs/postgres_cdc.adoc` (no `docs/` prefix). Fix the citation.
- **Enterprise-sink AsciiDoc paths not verified** (`manage:iceberg/about-iceberg-topics.adoc`, `reference:properties/topic-properties.adoc`, `manage:tiered-storage.adoc`, `manage:schema-reg/schema-id-validation.adoc`, `get-started:licensing/overview.adoc`) nor the broker/topic property defaults. Treat the docs property partials as citation of record; upstream is `configuration.cc`.
- **Heartbeat message prefix** — skill states two different prefixes (`redpanda_connect_<slot_name>` in config-reference/pipeline vs `pglog_stream_<slot_name>` for the publication). Confirm against `pglogicalstream/heartbeat.go`.
- **Metadata `schema` / `lsn` semantics** (absent on snapshot `read`, immutable schema value) — confirm against `input_pg_stream.go` metadata-set calls and `pglogicalstream/schema.go`.
- **Metadata `commit_ts_ms` (4.98.0, #4554) + `before` (4.99.0, #4555):** grounded in `input_pg_stream.go` — `commit_ts_ms` is set via `MetaSet("commit_ts_ms", strconv.FormatInt(msg.CommitTime.UnixMilli(),10))` when `!msg.CommitTime.IsZero()` (not set for snapshot reads); `before` carries the pre-change row for update/delete, with update contents governed by the table's `REPLICA IDENTITY` (default = key columns only, `FULL` = all columns). Both added to the metadata tables in `SKILL.md` and `pipeline-and-output.md` this sync.

## Sync log

### Connect v4.112.0 (2026-10-09)

- **`incremental_snapshot` added (new structural surface).** Verified against
  `redpanda-data/connect` at tag `v4.112.0`: the `incremental_snapshot` object field and its six
  nested fields (`enabled` false, `chunk_size` 1024, `heartbeat_interval` 1s, `retry_cooldown` 30s,
  `checkpoint_cache` optional-but-required-when-enabled, `checkpoint_cache_key`
  `postgres_cdc_incremental_snapshot`) in `internal/impl/postgresql/input_pg_stream.go`, with the
  defaults in `internal/impl/postgresql/incrementalsnapshot/config.go` and every startup validation
  in `internal/impl/postgresql/config.go`. Cross-checked against the generated page in the public
  connect repo (`docs/modules/components/pages/inputs/postgres_cdc.adoc` at the tag), which carries
  the same field list and defaults. Applied to `SKILL.md`, `references/config-reference.md`,
  `references/pipeline-and-output.md`, and `references/setup-postgres.md`.
  - **Version note:** the skill says "added in 4.112.0", matching the release changelog, which is the
    user-facing record. The code is in fact already present at the `v4.111.1` patch tag — that tag has
    no changelog section of its own and its entries were folded into the 4.112.0 one. The field carries
    no `Version()` annotation, so the generated reference states no "Requires version" line either.
- **New `snapshot-execute` control-signal type.** The literal value is `snapshot-execute`
  (`internal/replication/signalling.go`, `SnapshotSignalType`), payload `{"tables": [...]}` resolved
  against the configured `schema`. `SKILL.md` previously said only `log` was recognized — corrected.
  The skill still states the recognized set is not exhaustive and defers to the generated reference.
- **Deliberately not pinned:** the list of rejected primary-key types. The field description marks it
  as "currently not supported" (at the tag: `bytea`, `interval`, `bit`, `bit varying`, and any range
  or multirange type — `internal/impl/postgresql/pglogicalstream/incremental_snapshot.go`,
  `checkKeyTypesBindable`), so the skill records that a few key types are rejected and sends the
  reader to the generated reference rather than enumerating a moving list.
- **Noted while verifying:** the `signal_table_name` prose in the Go spec says the backfill key "may
  not be `bytea`", while the `incremental_snapshot.enabled` prose lists the fuller set. The source of
  truth is `checkKeyTypesBindable`; the narrower prose is an incomplete restatement, not a second
  rule. Not a skill change — flagged here so a future pass does not "fix" the skill to match it.

## Usage

For each file being reviewed or updated, open the listed source paths first and confirm every claim
still matches. For any `postgres_cdc` field, type, or default, treat the **generated** rp-connect-docs
page + `docs-data/overrides.json` (backed by `input_pg_stream.go`) as the source of record — do not
hardcode. For PostgreSQL server setup, the authority is upstream PostgreSQL/AWS docs. For the
enterprise sink-topic features, the authority is `redpanda-data/docs` + `src/v/config/configuration.cc`,
not this connector.
