# connect-cdc-postgres Skill Source Map

Maps each file in `skills/connect-cdc-postgres/` to the source paths it derives from, so future
syncs and human maintainers know exactly where to verify claims.

The `postgres_cdc` input is Go source in the **public** repo `redpanda-data/connect` under
`internal/impl/postgresql/` (logical replication / WAL decoding via the `pgoutput` plugin). The
user-facing reference is **auto-generated** into the **public** repo `redpanda-data/rp-connect-docs`
(`modules/components/pages/inputs/postgres_cdc.adoc`), with field descriptions supplied by
`docs-data/overrides.json`. Both repos are public — read them via the Redpanda-Github-Read MCP
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
| `SKILL.md` | `internal/impl/postgresql/input_pg_stream.go` (field registration, connector name/version, Enterprise gating), `internal/impl/postgresql/pglogicalstream/` (`logical_stream.go`, `stream_message.go`, `snapshotter.go`, `heartbeat.go`, `monitor.go`, `schema.go`) | `redpanda-data/rp-connect-docs`: `modules/components/pages/inputs/postgres_cdc.adoc` (auto-generated), `docs-data/overrides.json` (`inputs[].name == "postgres_cdc"`) |
| `references/config-reference.md` | `internal/impl/postgresql/input_pg_stream.go` (config spec: every field, type, default, required/advanced/deprecated flags), `internal/impl/postgresql/aws/` (the `aws` IAM auth block), `internal/impl/postgresql/pglogicalstream/config.go` | `modules/components/pages/inputs/postgres_cdc.adoc` (field list + defaults — **auto-generated**), `docs-data/overrides.json` (`postgres_cdc` field descriptions: `dsn`, `aws`, `include_transaction_markers`, …) |
| `references/setup-postgres.md` | `internal/impl/postgresql/pglogicalstream/logical_stream.go` (slot/publication creation, `pglog_stream_<slot_name>` naming, `pgoutput`), `pglogrepl.go` (replication protocol, `IDENTIFY_SYSTEM`, version detection / `messages` option for PG 15+), `snapshotter.go` (snapshot export). PostgreSQL server-side setup (`wal_level`, `REPLICA IDENTITY`, RDS/Aurora, IAM) is **external** (PostgreSQL/AWS docs), not in this repo. | `modules/components/pages/inputs/postgres_cdc.adoc` (setup prose) |
| `references/pipeline-and-output.md` | `internal/impl/postgresql/pglogicalstream/stream_message.go` (`OpType` constants: `read`/`insert`/`update`/`delete`/`begin`/`commit`), `logical_stream.go` (checkpointing via `github.com/Jeffail/checkpoint`, LSN ack, `pg_standby_status_update`, snapshot→stream lifecycle, `RelationMessage` DDL handling), `input_pg_stream.go` (metadata keys `table`/`operation`/`lsn`/`commit_ts_ms`/`before`/`schema`; `parquet_encode` schema-metadata compatibility) | `modules/components/pages/inputs/postgres_cdc.adoc` (metadata table, examples) |
| `references/enterprise-sink-features.md` | **Not `postgres_cdc`** — Redpanda broker features. Connector-license gating: `input_pg_stream.go` (Enterprise registration). | `redpanda-data/docs` (AsciiDoc, **unverified in this pass** — see TODO): `manage:iceberg/about-iceberg-topics.adoc`, `reference:properties/topic-properties.adoc`, `manage:tiered-storage.adoc`, `manage:schema-reg/schema-id-validation.adoc`, `get-started:licensing/overview.adoc`. Ground truth for broker/topic property defaults + accepted values: `redpanda-data/redpanda` `src/v/config/configuration.cc`. |

## Deferred to live introspection (NOT drift — do not pin or hardcode)

The `postgres_cdc` field list, per-field defaults, and descriptions are **auto-generated**:

- **Field enumeration + defaults** (e.g. `snapshot_batch_size`, `checkpoint_limit`, `heartbeat_interval`, `pg_standby_timeout`, `pg_wal_monitor_interval`, `stream_snapshot`, `max_parallel_snapshot_tables`, `temporary_slot`, `include_transaction_markers`, `unchanged_toast_value`, `tls.*`, `aws.*`, `batching.*`, `auto_replay_nacks`) — the canonical list is the generated `modules/components/pages/inputs/postgres_cdc.adoc` in `rp-connect-docs`, produced from the Go config spec in `input_pg_stream.go`. Field **descriptions** come from `docs-data/overrides.json`. Re-generate/re-read rather than trust the skill's hardcoded table.
- **Connector reference page as a whole** — regenerated by the auto-docs pipeline (`npx doc-tools generate rpcn-connector-docs`); never hand-edit the generated `.adoc`.
- **Enterprise/community binary component availability** (`components/aws` for IAM auth) — depends on the binary build, not a fixed path.

## TODO / re-verify

- **Per-field defaults not each line-verified** against `input_pg_stream.go` (e.g. `snapshot_batch_size: 1000`, `checkpoint_limit: 1024`, `heartbeat_interval: 1h`, `pg_standby_timeout: 10s`, `pg_wal_monitor_interval: 3s`, `max_parallel_snapshot_tables: 1`) — re-read the Go spec / generated page. Reconcile the `batching.count` default (skill states `1`, but the "all fields" example shows `count: 0`).
- **`config-reference.md` cites the generated page as `docs/modules/components/pages/inputs/postgres_cdc.adoc`** — the actual path in `rp-connect-docs` is `modules/components/pages/inputs/postgres_cdc.adoc` (no `docs/` prefix). Fix the citation.
- **Enterprise-sink AsciiDoc paths not verified** (`manage:iceberg/about-iceberg-topics.adoc`, `reference:properties/topic-properties.adoc`, `manage:tiered-storage.adoc`, `manage:schema-reg/schema-id-validation.adoc`, `get-started:licensing/overview.adoc`) nor the broker/topic property defaults. Treat the docs property partials as citation of record; upstream is `configuration.cc`.
- **Heartbeat message prefix** — skill states two different prefixes (`redpanda_connect_<slot_name>` in config-reference/pipeline vs `pglog_stream_<slot_name>` for the publication). Confirm against `pglogicalstream/heartbeat.go`.
- **Metadata `schema` / `lsn` semantics** (absent on snapshot `read`, immutable schema value) — confirm against `input_pg_stream.go` metadata-set calls and `pglogicalstream/schema.go`.
- **Metadata `commit_ts_ms` (4.98.0, #4554) + `before` (4.99.0, #4555):** grounded in `input_pg_stream.go` — `commit_ts_ms` is set via `MetaSet("commit_ts_ms", strconv.FormatInt(msg.CommitTime.UnixMilli(),10))` when `!msg.CommitTime.IsZero()` (not set for snapshot reads); `before` carries the pre-change row for update/delete, with update contents governed by the table's `REPLICA IDENTITY` (default = key columns only, `FULL` = all columns). Both added to the metadata tables in `SKILL.md` and `pipeline-and-output.md` this sync.

## Usage

For each file being reviewed or updated, open the listed source paths first and confirm every claim
still matches. For any `postgres_cdc` field, type, or default, treat the **generated** rp-connect-docs
page + `docs-data/overrides.json` (backed by `input_pg_stream.go`) as the source of record — do not
hardcode. For PostgreSQL server setup, the authority is upstream PostgreSQL/AWS docs. For the
enterprise sink-topic features, the authority is `redpanda-data/docs` + `src/v/config/configuration.cc`,
not this connector.
