# connect Skill Source Map

Maps each file in `skills/connect/` to the source paths it derives from, so future syncs and human maintainers know exactly where to verify claims.

Redpanda Connect (formerly Benthos) is split across **two public repos plus one dependency**, and getting the split right matters:

- **`redpanda-data/connect`** (Go) — Redpanda-specific components under `internal/impl/<group>/`, the `redpanda-connect` binary (`cmd/redpanda-connect/main.go`), license enforcement, secrets resolver, connector allow/deny list, and the Redpanda flags (`--redpanda-license`, `--secrets`, `pipeline_id`, `logs_topic`). CDC inputs and AI/ML processors live here.
- **`redpanda-data/benthos`** (Go, a dependency of `connect` — pinned in `connect/go.mod`, currently **v4.84.0**) — the **engine**: the CLI commands (`run`, `list`, `create`, `lint`, `streams`, `blobl`), the Bloblang language (`internal/bloblang/`), the core config model, and the base `logger`/`metrics`/`tracer`/`buffer` components. The CLI verbs the skill teaches (`rpk connect run/list/create/lint`) are defined here, **not** in `redpanda-data/connect`.
- **`redpanda-data/rp-connect-docs`** — the **auto-generated** component reference (`modules/components/pages/{inputs,processors,outputs,caches,buffers,rate_limits,scanners,metrics,tracers,...}/`) built from each component's Go `Spec()`, plus `docs-data/overrides.json` (DRY overrides via `$ref`) and versioned snapshots `docs-data/connect-<version>.json`.

`connect` and `benthos` are public; **`rp-connect-docs` is private**, so its paths and contents stay off public surfaces (PR titles, descriptions, commit messages) — see the repo `CLAUDE.md`. Note that the generated component reference is **no longer committed** into the `redpanda-data/connect` tree (its `docs/README.md` at v4.113.1 says so, and the version check now reads the previous release's `redpanda-connect-docs.tar.gz` asset instead of committed partials), so per-field verification at a tag means reading the component's Go `Spec()` in `internal/impl/`, the release's docs asset, or the generated pages in `rp-connect-docs`. Read them via the Redpanda-Github-Read MCP connector (`get_file_contents`) or `gh api repos/redpanda-data/<repo>/contents/<path>`; avoid `gh search code` (rate-limited). `rpk connect` itself is a **managed-plugin passthrough** to the `redpanda-connect` binary — its subcommand tree is not defined in `redpanda-data/redpanda`. Before writing or changing any fact, re-open the cited source and confirm exact field names, flag names, and defaults against the matching Connect release tag (and the benthos version in `go.mod`).

## File-to-source table

| Skill file | connect / benthos source paths | docs sources (rp-connect-docs) |
|---|---|---|
| `SKILL.md` | benthos `internal/cli/` (`run.go`, `list.go`, `create.go`, `lint.go`, `common/run_flags.go`); connect `internal/cli/enterprise.go` (config search paths, `connector_list.yaml`), `internal/cli/flags_redpanda.go` (`--redpanda-license`, `--secrets`, `pipeline_id`, `logs_topic`); connect `internal/impl/kafka/input_redpanda.go`, `output_redpanda.go`; benthos `internal/bloblang/`; connect `internal/impl/{postgresql,mysql,mongodb,oracledb,mssqlserver,salesforce,openai,cohere,ollama}/`, `internal/license/service.go` | `modules/components/pages/**`, `modules/get-started/` (licensing) |
| `references/config-structure.md` | connect `internal/impl/prometheus/metrics_prometheus.go` (the `prometheus` metrics exporter's config spec — it is in `connect`, not in the benthos engine); connect `internal/cli/enterprise.go` (config file search-path list incl. `redpanda-connect.yaml`, `/etc/connect/config.yaml`, legacy `benthos.yaml`); benthos `internal/cli/run.go` + `internal/cli/common/run_flags.go` (`set`=`-s`, `env-file`); benthos config model + base `internal/impl/{log,metadata,pipeline,stream}` and `logger`/`metrics`/`tracer`/`buffer` component specs; connect `internal/cli/flags_redpanda.go` (global `redpanda` block: `pipeline_id`, `logs_topic`, `logs_level`, `status_topic`) | `modules/components/pages/{logger,metrics,tracers,buffers}/`, `modules/configuration/` |
| `references/components.md` | benthos `internal/cli/list.go`, `create.go` (discovery/templates); component `Spec()` in connect `internal/impl/kafka/` (`redpanda` in/out), `internal/impl/io/` (`generate`, `file`, `http_server`, `http_client`), `internal/impl/{aws,gcp,azure,sql,redis,mongodb,nats,amqp09,amqp1}/`, plus caches/rate-limits/buffers in benthos `internal/impl/` and connect | `modules/components/pages/{inputs,processors,outputs,caches,rate_limits,buffers,scanners}/`, `docs-data/connect-<version>.json`, `docs-data/overrides.json` |
| `references/bloblang.md` | benthos `internal/bloblang/` — `query/functions.go`, `query/methods*.go` (function & method catalogs), `mapping/`, `parser/`, `field/` (interpolation `${! … }`); CLI REPL: benthos `internal/cli/blobl/` | `modules/guides/` + `modules/components/pages/` Bloblang reference; playground `play.benthos.dev` |
| `references/patterns.md` | Composite — no single source. Grounded in the component `Spec()`s cited above (connect `internal/impl/kafka/`, `io/`, `aws/`, `sql/`, `redis/`; benthos `broker`/`fallback`/`switch`/`retry` outputs, `system_window` buffer, `archive`/`dedupe`/`schema_registry_encode` processors) | `modules/cookbooks/`, `modules/components/pages/**` |
| `references/enterprise.md` | connect `internal/impl/postgresql/` (`postgres_cdc`), `mysql/`, `mongodb/`, `oracledb/`, `mssqlserver/`, `salesforce/`, `aws/` (`aws_dynamodb_cdc`), `gcp/` (`gcp_spanner_cdc`); AI/ML in `internal/impl/{openai,cohere,ollama,aws,gcp}/`; connect `internal/cli/enterprise.go` (`connectorListPath = "/etc/redpanda/connector_list.yaml"`, allow/deny error text), `internal/secrets/secrets.go` (`--secrets` URN schemes), `internal/cli/flags_redpanda.go` (`--redpanda-license`, `REDPANDA_LICENSE`, `REDPANDA_LICENSE_FILEPATH`, `/etc/redpanda/redpanda.license`, `logs_topic`/`status_topic`), `internal/license/service.go`; support tiers: connect `internal/plugins/info.csv` (per-component `support` column: `enterprise` vs `certified`) | `docs-data/overrides.json`, `docs-data/connect-<version>.json`, generated `modules/components/pages/**` (`?support=enterprise`), `modules/get-started/` licensing page |
| `references/migration.md` | connect `internal/impl/redpanda/migrator/` (`migrator.go`, `migrator_topic.go`, `migrator_schema_registry.go`, `migrator_groups.go`, `plumbing.go`) — the unified migrator does **not** live under `internal/impl/kafka/`; the separate standalone `schema_registry` input/output pair **does**: connect `internal/impl/kafka/output_schema_registry.go` (`translate_ids` ↔ required destination mode, the `Connect()` mode check and per-subject-mode warning) and `internal/impl/kafka/schema_registry.go`; support tier (`certified`, not enterprise): connect `internal/plugins/info.csv` (re-verified at tag v4.111.1, 2026-10-01) | `modules/cookbooks/pages/redpanda_migrator.adoc` (workflow, required ACLs, offset-translation semantics), `modules/guides/pages/migration/migrate-unified-redpanda-migrator.adoc` (4.67.5+ availability; legacy bundle deprecated 4.67.5 / removed 4.85.0; legacy→unified field mapping), `modules/components/pages/inputs/redpanda_migrator.adoc` (pairing, tuning, `input_redpanda_migrator_lag`), `modules/components/pages/outputs/redpanda_migrator.adoc` (sync schedules, guarantees, limitations, `redpanda_migrator_*` metrics) |
| `references/streams-mode.md` | benthos `internal/cli/streams.go` (`streams` subcommand; `-o/--observability`, `--prefix-stream-endpoints`, `--bind-http` flags, and the hidden deprecated `--no-api`), benthos `internal/cli/common/service.go` (the `--no-api` deprecation warning and the rationale comment for gating the CRUD routes), benthos `internal/cli/common/run_flags.go` (`-r/--resources`), benthos `internal/stream/manager/api.go` (`registerEndpoints(enableCrud bool)`: `/ready` registered unconditionally; `/streams`, `/streams/{id}`, `/streams/{id}/stats`, `/resources/{type}/{id}` gated; `lintErrors` JSON tag `lint_errors`; `chilled` lint bypass) | `modules/guides/pages/streams_mode/about.adoc`, `using_config_files.adoc`, `using_rest_api.adoc`, `streams_api.adoc` (full endpoint spec) |
| `references/connector-catalog.md` | connect `internal/plugins/info.csv` at the current stable tag (tier record; enterprise roster verified complete at v4.115.0); runtime-gate spot checks: `license.CheckRunningEnterprise` callers (e.g. `internal/impl/splunk/`, `internal/impl/google/`, `internal/impl/jira/processor_jira.go` and `internal/impl/jira/input_jira.go`) vs ungated Apache-2.0 impls (`internal/impl/openai/chat_processor.go`, `internal/impl/aws/dynamodb/input_cdc.go`) | one-liners from `modules/components/pages/{inputs,outputs,processors}/<name>.adoc`; tier filter UI `components/catalog/?support=enterprise` |

## Deferred to live introspection (NOT drift — do not pin or hardcode)

- **Per-field config of every connector/processor is auto-generated** from each component's Go `Spec()`. Do NOT hardcode or "complete" per-field enumerations in the skill. Source of truth: the generated rp-connect-docs pages (`modules/components/pages/**`) + `docs-data/connect-<version>.json`, and live `rpk connect create <name>` / `rpk connect list <type>`. The CDC/AI field blocks in `enterprise.md` are illustrative snapshots, not an authoritative field list.
- **Bloblang function & method catalogs** are generated from benthos `internal/bloblang/query/{functions.go,methods*.go}`. Defer to the generated Bloblang docs and the `rpk connect blobl` REPL.
- **Which components exist** (`rpk connect list inputs|outputs|processors|caches|rate-limits|buffers|scanners|metrics`) — dynamic; the tables in the skill are "notable members," not exhaustive.
- **`rpk connect` subcommand tree / flags** — a managed-plugin passthrough to the external `redpanda-connect` binary; confirm with `rpk connect --help` / `rpk connect run --help`.
- **Versions** — the benthos dependency version (`connect/go.mod`) and the Connect release tag are intentionally not pinned in the skill.

## TODO / re-verify

- **Drift audit 2026-10-01 (connect v4.111.1):** `internal/plugins/info.csv` re-read at the tag. Every CDC input name, the enterprise-tier roster (`a2a_message`, `gateway`, the `google_drive_*` trio, `otlp_grpc`/`otlp_http`, `open_telemetry_collector`, the Slack and Splunk families) and the `tigerbeetle_cdc` `certified` / `cloud: n` facts all still match, as do the `pg_stream` and `jira`-processor deprecations and the `redpanda_migrator` `certified` tier. The `dry-run` subcommand, its `--verbose` flag, directory support and exit-code-1 behavior re-verified against connect `internal/cli/dry_run.go`. Stale version stamps were refreshed and the hardcoded enterprise-component count was dropped from `connector-catalog.md` in favour of the deferral the file already carries. Three community-tier outputs added since the last catalog pass (`arc`, `cyborgdb`, `elasticsearch_v9`) are intentionally not listed — the catalog is exhaustive only for the enterprise tier.
- **`tigerbeetle_cdc` is NOT enterprise (verified 2026-07-07):** `internal/plugins/info.csv` at connect v4.98.0 lists it as `certified` (all other `*_cdc` inputs are `enterprise`), its `internal/impl/tigerbeetle/input_tigerbeetle.go` carries an Apache-2.0 header and contains **no** `license.CheckRunningEnterprise` call (contrast `internal/impl/postgresql/input_pg_stream.go`, which has all three enterprise markers). The `connect-debugging` drift (it listed `tigerbeetle_cdc` among enterprise CDC inputs) is fixed in the `connect-cdc-tigerbeetle` skill PR. The docs page marks it beta and CGO-only; `info.csv` says `cloud: n` ("not yet certified for cloud").
- **Unified migrator version bounds** (migration.md): "introduced 4.67.5, legacy deprecated 4.67.5 / removed 4.85.0" per `guides/migration/migrate-unified-redpanda-migrator.adoc`. The generated component metadata says `4.67.0` for the input and the output page says "Introduced in version 4.37.0" (the output *name* predates the unified rework); the guide's 4.67.5+ figure is used as the compatibility boundary. Re-check if the guide changes.

- **AI/ML processors are certified, not enterprise (corrected 2026-07-07):** all 16 (`openai_*`, `aws_bedrock_*`, `cohere_*`, `gcp_vertex_ai_*`, `ollama_*`) are `certified` in `info.csv` at v4.99.0 and `internal/impl/openai/chat_processor.go` is Apache-2.0 with no license check. `SKILL.md`, `components.md`, and `enterprise.md` previously called them enterprise — corrected. If a future release re-tiers them, treat that as a user-facing change.
- **Tier vs runtime gate discrepancies — the `jira` half is RESOLVED at v4.113.0:** `info.csv` at v4.113.1 lists both `jira` `input` and `jira` `processor` (still `deprecated=y`) as `enterprise`, matching the `license.CheckRunningEnterprise` call their source has always carried, so the catalog now files them under the enterprise roster. `modules/components/pages/inputs/jira.adoc` also exists now (it 404'd at the earlier sync), though its page header still carries `:support: certified` — a docs-side lag, not a skill claim; the skill states the tier from `info.csv`. **Still open:** `aws_dynamodb_cdc` is `enterprise` in `info.csv` but its source (`internal/impl/aws/dynamodb/input_cdc.go`) has no runtime gate; the catalog carries a caveat instead of asserting either way, and it needs product/Connect-team confirmation.
- **`gateway` (input) and `a2a_message` (processor)** are enterprise-tier in `info.csv` at v4.99.0 but have no rp-connect-docs reference page — likely ADP-related surfaces. Do not document further until they have public reference pages.
- **benthos vs connect split (accepted, not drift):** the CLI verbs (`run`/`list`/`create`/`lint`/`streams`/`blobl`), Bloblang, the core config model, and base `logger`/`metrics`/`tracer`/`buffer` components live in the dependency **`redpanda-data/benthos`** (v4.84.0 as of connect v4.115.0, re-checked 2026-10-23), NOT in `redpanda-data/connect`. Verify engine-level claims against the matching benthos tag; verify Redpanda-specific claims against the connect release tag.
- **CDC/AI field defaults** in `enterprise.md` (e.g. `checkpoint_limit: 1024`, `scn_window_size: 20000`, `api_version: v65.0`) grounded from the generated component docs snapshot, not line-verified against each impl's `Spec()` this pass. Re-check against the generated reference for the target version.
- **`logger`/`metrics`/`tracer`/`buffer` field defaults** in `config-structure.md` not each line-verified against benthos component specs.
- **`fallback_error` metadata field** (patterns.md) and exact license-error / connector-list log strings carried from the skill text; re-confirm against `internal/cli/enterprise.go` and `internal/license/`.

## Usage

For each file being reviewed or updated, open the listed source paths first and confirm every claim still matches. Route engine/CLI/Bloblang questions to `redpanda-data/benthos` (at the version in `connect/go.mod`), Redpanda-specific component/license/secrets/CDC/AI questions to `redpanda-data/connect`, and treat `redpanda-data/rp-connect-docs` (generated pages + `docs-data/`) as the citation of record for per-field connector config. Never hardcode auto-generated field lists or Bloblang catalogs — defer to the generated reference and `rpk connect list`/`create`/`blobl`.

## Sync log

### Connect v4.115.0 / benthos v4.84.0 (2026-10-23)

Releases checked: `v4.115.0` (changelog dated 2026-10-22, the current stable
tag) and `v4.114.0` (2026-10-16), both newer than the `v4.113.1` sync below.

- **benthos moved v4.82.0 → v4.84.0** (`connect/go.mod` at the tag). Two of its
  changes were weighed and one was applied:
  - **New `--docs-format` flag on `list`** (applied). Verified in benthos
    `internal/cli/list.go` at `v4.84.0`: a string flag defaulting to
    `asciidoc`, accepting `asciidoc` or `markdown`, which governs the doc
    strings carried by the `json-full` and `cue` formats and by `jsonschema`
    for Bloblang functions and methods; an unknown value is an error naming the
    two options, and a malformed conditional only warns on stderr. The same
    file at `v4.82.0` has no such flag, so it is new in this window. Added to
    the discovery block in `references/connector-catalog.md`. The sibling
    change in that function — `--status` now filtering *after* rendering, so
    links to components of another status stay links — is internal and not a
    skill claim.
  - **Credentials in URLs are redacted** from errors, logs, spans and request
    dumps, including credential headers such as `Authorization`, across the
    HTTP components, `websocket`, the `parse_url` method, URL config fields and
    the `studio` CLI (benthos `CHANGELOG.md` at `v4.83.0`, with the new
    `public/utils/redact` package behind it). No skill asserted the opposite,
    but it changes what a reader sees in a failing pipeline's output, so
    `connect-debugging/references/logging-metrics-tracing.md` gained a short
    Logger subsection saying a credential-free URL in an error is redaction
    rather than truncation. Grounded in the changelog at the tag, not
    line-verified against each call site.
  - Not a skill surface: the HTTP retry no longer spinning when a request fails
    to be created (`v4.83.0`), the `NewOAuth2Field` family (`v4.82.0`, already
    recorded below), and the `v4.84.0` Go API additions for docs attributes and
    Markdown rendering (`SetDocsAttributes`, `MarshalJSONV0Markdown`,
    `LintDocsConditionals`, the `CLIOptSetDocs*` options) plus the fix letting
    `lint` and `test` take custom run flags after the subcommand name — all
    plugin-author API.
- **New enterprise output `snowflake_streaming_pipe`.** `info.csv` at the tag
  carries `snowflake_streaming_pipe ,output ,Snowflake Streaming Pipe
  ,enterprise`, and `internal/impl/snowflake/output_snowflake_streaming_pipe.go`
  registers it with `license.CheckRunningEnterprise` in its constructor. Its
  `Spec()` is `Beta()`, `Version("4.115.0")`, and the facts taken into
  `references/connector-catalog.md` all come from that spec: channels are
  opened on a **pipe** rather than a table so the pipe's `COPY INTO`
  transformations run before rows land; `snowflake_streaming` remains the
  simpler choice when those are not needed (it also creates its table); the
  pipe and table must pre-exist and a missing pipe is reported at connect time,
  before any message is written; moving a `snowflake_streaming` config across
  is not a rename (fields are removed and `commit_timeout` changes meaning —
  the constant explains that it replaces the `commit_backoff` object because
  `WaitUntilCommitted` takes a single deadline); and a channel must be written
  by one ordered source with at most one batch in flight, the default channel
  being the constant `<database>.<schema>.<pipe>` from `defaultChannelName`,
  with `channel_name` the opt-in for per-partition parallelism.
  - **Deliberately deferred:** the whole field set (`account`/`url`/`user`/
    `role`/`private_key*`/`compression`/`commit_poll_interval`/`request_timeout`/
    `tolerate_row_errors`/the `channel_open_retry` block), the JSON-to-column
    type table, the Iceberg caveats and the per-metric names
    (`snowflake_empty_rows_skipped`, `snowflake_out_of_order_submissions`) stay
    in the generated reference and `rpk connect create snowflake_streaming_pipe`.
    The catalog entry points at the reference page for the `offset_token`
    deduplication rules instead of restating them.
  - The spec's licensing link still uses the old
    `docs.redpanda.com/redpanda-connect/` prefix; the skills use the current
    `/connect/` path (see the v4.113.1 entry). Not a skill claim either way.
- **Verification stamps refreshed** against `info.csv` at `v4.115.0`: the
  enterprise roster is otherwise unchanged, so `connector-catalog.md`'s
  completeness heading and the tier-vs-gate caveat now read v4.115.0. The
  `aws_dynamodb_cdc` discrepancy is still open — the file at the tag
  (`internal/impl/aws/dynamodb/input_cdc.go`) carries only the RCL header and no
  `license.CheckRunningEnterprise` call, while `info.csv` tiers it
  `enterprise`. `sap_hana` is still `enterprise` with `cloud: n`, the 16 AI/ML
  processors still `certified`, and `gateway` / `a2a_message` still enterprise
  with no published reference page.
- **Verified and deliberately not documented this release:** the `tombstone`
  field on the franz-based Kafka outputs (`redpanda`, `kafka_franz`) for
  compacted-topic deletes and null values, and the `partition_assignment_strategy`
  field on the `redpanda` input (`cooperative-sticky`, `sticky`, `range`,
  `roundrobin`) — both per-field additions to existing connectors, deferred to
  the generated reference and `rpk connect create`; the `--rpc-plugins` flag now
  merging root- and subcommand-level values and being accepted by `dry-run`
  (connect `internal/cli/flags_common.go`: `rpcPluginsFlag` and
  `rpcPluginPaths`) — these skills document no RPC-plugin surface at all, so
  there is nothing to correct, and documenting the flag would mean introducing
  the plugin-manifest system; the `sap_hana` hardening (negative `max_retries`
  rejected, the table reference recorded in checkpoints so two tables sharing a
  checkpoint cache no longer share state, Iceberg record-name sanitization) —
  the skill's `sap_hana` section claims nothing about cross-table checkpoint
  sharing, so nothing needed correcting; the `schema_registry_encode`
  `json_schema` null fix; the `couchbase` output acking only successful
  operations; the `oracledb_cdc` schema-cache and parsing performance work; the
  `docs_gen` hex-quoting fix; and the dependency bump for the eMudhra advisory.
- **Out of scope for this routine:** nothing this window belongs to another
  product's skill.

### Connect v4.113.1 / benthos v4.82.0 (2026-10-16)

Release checked: `v4.113.1` (published 2026-10-14, the current stable tag), which
also carries the `v4.113.0` changelog section (2026-10-09). `CHANGELOG.md` has no
`4.113.1` section — its entries live only in the GitHub release notes, so several
items below are grounded in source at the tag rather than in the changelog.

- **benthos moved v4.81.0 → v4.82.0** (`connect/go.mod` at the tag). Both of its
  changes were checked and neither is a skill surface: the new
  `NewOAuth2Field` / `NewRetryBackOffFields` / `NewMaxRetriesField` helpers are
  Go plugin-author API, and the `cache` output's new `key` default
  (`${!timestamp_unix_nano()}-${!uuid_v4()}`, replacing the impure `count`) is a
  per-field default, deferred to the generated reference. No CLI verb, Bloblang
  function/method, or core config-model claim was re-opened.
- **`jira` input and processor are now enterprise-tier.**
  `internal/plugins/info.csv` at the tag lists both rows as `enterprise` (the
  processor still `deprecated=y`), which closes the long-standing tier-vs-gate
  discrepancy: their source has always called `license.CheckRunningEnterprise`.
  `references/connector-catalog.md` now carries them in the enterprise roster,
  the caveat keeps only the remaining `aws_dynamodb_cdc` case, and the
  "notable certified" bullet points at the move.
- **New enterprise input `sap_hana`.** Verified at the tag in
  `internal/impl/saphana/config.go` (the `Spec()`: five `mode` values —
  `bulk`, `incrementing`, `query`, `timestamp`, `timestamp+incrementing` — the
  per-mode required fields, `rejectInertFields`, the `checkpoint_cache` /
  `checkpoint_cache_key` pair, `timestamp_clock`, and the
  `license.CheckRunningEnterprise` call in `newSAPHANAInput`) and
  `internal/impl/saphana/input_sap_hana.go` (the per-mode queries, the
  database-clock window bound, `bulk`/`query` terminating the input, and the
  `table_name` / `database_schema` / `schema` / `primary_key_columns` metadata;
  per the spec's metadata list in `config.go`, only `table_name` is
  unconditional, the other three need `schema_name`, and `primary_key_columns`
  also needs a table primary key).
  `info.csv` lists `sap_hana ,input ,SAP HANA ,enterprise`. Documented as a
  family in `references/connector-catalog.md` and as a subsection in
  `references/enterprise.md`, with the field set deferred to
  `rpk connect create sap_hana`.
  - **Flagged, not resolved:** the spec is annotated `Version("4.114.0")` even
    though the component is registered in the `v4.113.1` tag and announced in
    that release's notes. The skill therefore states no "introduced in" version
    (it pins no versions anyway). Re-check whether the annotation or the release
    is the one that moves.
  - The per-connector cloud availability in `info.csv` (`cloud: n` for
    `sap_hana`) is deliberately not recorded in the skill — availability is a
    volatile matrix, as with the `websocket` flip at v4.111.0.
- **`kafka` and `kafka_franz` inputs *and* outputs are now all deprecated in
  favour of `redpanda`.** `info.csv` marks all four rows `deprecated=y`, and
  `internal/impl/kafka/output_kafka_franz.go` carries `.Deprecated()` with a
  description that now opens "Use the `redpanda` output instead" (same for
  `input_kafka_franz.go`). Documented in `references/components.md` (both
  `redpanda` sections) and `references/connector-catalog.md` (a new
  "Deprecated in favour of `redpanda`" subsection, which also records that
  `redpanda_common` is deprecated and that a `redpanda` input/output with its
  connection fields omitted reads the same global `redpanda` block —
  `output_redpanda.go`). `references/migration.md` no longer offers
  `kafka_franz` as the plain-pipeline input.
  - **Consequence across the Connect skills:** every `kafka_franz:` component
    key in an example was renamed to `redpanda:`, because the examples otherwise
    scaffold a deprecated component. The rename is field-safe: both specs are
    built from the same `FranzConnection*` / `FranzWriterConfigFields` /
    `FranzProducerFields` groups (`output_kafka_franz.go` vs
    `output_redpanda.go`), the only differences being that `seed_brokers` is
    optional on `redpanda`, that `kafka_franz` carries a deprecated `rack_id`,
    and that `max_in_flight` defaults differ (10 vs 256) — no skill asserted
    either default. Every changed YAML block was re-parsed after the rename.
- **License error string and community-binary behavior.**
  `internal/license/shared_service.go` at the tag shows
  `errEnterpriseLicenseRequired` now pointing at
  `https://docs.redpanda.com/connect/get-started/licensing/`, and
  `CheckRunningEnterprise` returning that same error when no license service is
  registered at all (the community binary, which can still import enterprise
  components) instead of the internal "unable to access license service" fault.
  Both are reflected in `references/components.md` and
  `references/enterprise.md`.
- **Docs URLs moved** from `docs.redpanda.com/redpanda-connect/` to
  `docs.redpanda.com/connect/` (the old path only 301-redirects). Grounded in
  the public `redpanda-data/connect` repo at the tag: `README.md`,
  `docs/README.md` and `config/README.md` now use the new prefix, and the
  license error string above carries it. Every link in these skills was
  updated, including two that used the wrong `www.docs.redpanda.com` host. Note
  that some paths changed shape in the move (`/about#components` →
  `/components/about/`, `/about` → `/home/`), so the prefix swap was checked
  per link rather than applied blind. `internal/cli/enterprise.go` still sets
  the *old* documentation URL for CLI help output — left alone, not a skill
  claim.
- **Verification stamps refreshed** against `info.csv` at `v4.113.1`: the
  16 AI/ML processors are still `certified`; `gateway` and `a2a_message` are
  still enterprise with no published reference page; the enterprise roster is
  complete at the tag for non-deprecated components. `pg_stream` (input) and
  `redpanda_common` (input and output) are also `enterprise` in `info.csv` but
  `deprecated=y`, so the roster heading says deprecated components are
  excluded, and the "Deprecated in favour of `redpanda`" note records that
  `redpanda_common` is enterprise-tier.
- **Verified and deliberately not documented this release:** the `sftp`
  credentials block for extra SSH key-exchange algorithms, ciphers and MACs
  (per-field addition); the `compression` field defaulting to `snappy` on the
  Kafka/Redpanda producers (per-field default, and the franz-go behavior it
  describes is unchanged); the Postgres CDC snapshot-chunk release on the first
  idle heartbeat (internal resource management); the `timeplus` output being
  re-registered after a refactor dropped it (restores availability, no surface);
  and the Redpanda Migrator tolerating a per-subject schema-registration
  failure instead of failing the whole output (a resilience fix that moves no
  field, metric, or documented error string — `references/migration.md` made no
  claim about per-subject failure handling, so nothing needed correcting; not
  line-verified beyond the release note).

### Connect v4.112.0 / benthos v4.81.0 (2026-10-09)

- **benthos unchanged.** `connect/go.mod` at tag `v4.112.0` still pins
  `github.com/redpanda-data/benthos/v4 v4.81.0`, the same version as at
  `v4.111.0`, so the CLI verbs, the Bloblang catalogs, the core config model,
  and the base `logger`/`tracer`/`buffer` components are unmoved this release.
  No Bloblang or CLI claim was re-opened.
- **`prometheus` metrics: new `histogram_timing_seconds_suffix` field** (bool,
  default `false`, `Version("4.112.0")`, Advanced), verified in connect
  `internal/impl/prometheus/metrics_prometheus.go` at the tag. With
  `use_histogram_timing: true` the histogram already observed the delta in
  seconds while the series kept its `_ns` name; this flag rewrites the suffix
  to `_seconds`, which also keeps the histogram series distinct from the
  summary series emitted under the `_ns` name when `use_histogram_timing` is
  `false`. Opt-in, and enabling it renames existing series. Added to the
  metrics block in `references/config-structure.md`.
  - **Provenance note:** this file's source map previously attributed the base
    `metrics` components wholesale to benthos. The `prometheus` exporter is
    registered in `connect`, so it verifies against the Connect release tag;
    the `config-structure.md` row now says so.
- **`schema_registry` output: required destination mode now follows
  `translate_ids`.** Verified in connect
  `internal/impl/kafka/output_schema_registry.go` at the tag: with
  `translate_ids: false` (the default) schemas are created with their original
  IDs and versions, which requires the destination registry in `IMPORT` mode
  (Redpanda v25.3 or later, or Confluent Schema Registry); with
  `translate_ids: true` the destination assigns new IDs and must be in
  `READWRITE`. `Connect()` fails when the global mode is neither, and only
  **warns** on a mismatch with `translate_ids`, because mode can also be set
  per subject. The pre-25.3 fixed-ID workaround was removed from
  `internal/impl/kafka/schema_registry.go`.
  - Added to `references/migration.md` as a scoped subsection. Deliberately
    scoped: the **unified migrator's** `schema_registry.translate_ids`
    (connect `internal/impl/redpanda/migrator/migrator_schema_registry.go`) is
    a different implementation that still carries a fixed-ID fallback — on an
    ID conflict it compares the existing schema and reuses its ID — and its
    `validateSchemaRegistries` only requires `READWRITE` **or** `IMPORT`. The
    skill now states that difference explicitly so the two are not conflated.
    The migrator's pre-existing mode claim in `migration.md` was re-verified
    and is unchanged, with the `serverless: true` per-subject IMPORT-mode
    switch-and-restore added from `newImportModeManager`.
- **Verified and deliberately not documented this release:** the `opensearch`
  output's new `compress_request_body` field (a per-field addition to an
  existing connector — deferred to the generated reference), the `iceberg`
  nanosecond-timestamp validation, and the `gcp_spanner_cdc` and
  `oracledb_cdc` fixes. The Spanner and Postgres/Oracle changes that *did*
  carry durable surface were applied in their own skills — see
  `skills/connect-cdc-{postgres,oracle,spanner}/references/SOURCES.md`.

### Connect v4.111.0 / benthos v4.81.0 (2026-09-25)

- **Streams-mode management API is now opt-in (breaking).** Verified in benthos
  at tag `v4.81.0`, the version `connect/go.mod` pins at connect `v4.111.0`:
  `internal/cli/streams.go` adds a `--bind-http` bool flag (default `false`) and
  marks `--no-api` `Hidden: true` with a deprecation usage string;
  `internal/cli/common/service.go` logs a warning when `--no-api` is passed and
  carries the comment explaining that the CRUD routes accept pipeline
  configuration over HTTP; `internal/stream/manager/api.go`
  `registerEndpoints(enableCrud bool)` registers `/ready` before the
  `if !enableCrud { return }` guard, so `/ready` is always available while
  `/resources/{type}/{id}`, `/streams/{id}/stats`, `/streams/{id}`, and
  `/streams` are gated. `internal/cli/streams_test.go` `TestStreamsModeBindHTTP`
  pins the behavior. Applied to `references/streams-mode.md` and the streams
  pointer in `SKILL.md`.
  - Note: the benthos `CHANGELOG.md` at tag `v4.81.0` still lists this under
    **Unreleased** — the changelog heading had not been rolled at tag time. The
    source at the tag is what grounds this entry, not the changelog.
- **Corrected while verifying:** the streams REST lint-failure body key is
  `lint_errors`, not `linting_errors` as the skill stated
  (`internal/stream/manager/api.go`: the `lintErrors` struct's `LintErrs` field
  carries the JSON tag `lint_errors`).
- **`websocket` input/output are now cloud-enabled** (`internal/plugins/info.csv`
  at connect `v4.111.0` flips both rows' cloud columns from `n` to `y` and drops
  the "long-lived persistent connection not suitable for cloud" note). No skill
  edit: `references/connector-catalog.md` records support **tier**, not
  per-connector cloud availability, which is a volatile availability matrix
  deferred to the catalog UI and `rpk connect list`.

### Connect v4.115.1 / benthos v4.84.0 (2026-10-30)

Release checked: `v4.115.1` (changelog section dated 2026-10-23, the current
stable tag — no newer tag exists as of this sync). The benthos dependency is
unchanged at `v4.84.0` in `go.mod` at the tag, so no engine, CLI or Bloblang
surface was re-opened for the release itself.

- **Nothing in the `v4.115.1` changelog is a Connect skill surface.** The two
  `kafka` entries are fixes inside the franz writer (a data race between the
  produce-error and record-decoration slices, and the dispatch signal now firing
  when a record is handed to the producer, restoring the hand-off the ordered
  per-partition input relies on). Neither changes a flag, field, component name
  or documented behaviour; no skill asserted the broken behaviour. The
  `oracledb_cdc` timestamp-unit entry belongs to `connect-cdc-oracle` and is
  recorded there.
- **Migrator drift, found via the changed reference page and fixed in
  `references/migration.md`.** All four items were verified in source at the
  tag:
  - **The lag metric is `redpanda_lag`, not `input_redpanda_migrator_lag`.**
    `internal/impl/kafka/lag.go` defines `lagMetricNameRedpanda = "redpanda_lag"`
    as "the consumer lag gauge emitted by the Redpanda branded inputs
    (`redpanda`, `redpanda_common` and the migrator)", and both migrator specs
    in `internal/impl/redpanda/migrator/migrator.go` (plus that package's
    `README.md`) document `redpanda_lag` with `topic` and `partition` labels.
    The old name appears nowhere in the repo. The specs also state the gauge is
    emitted only when the input has a `consumer_group`, which the workflow step
    now says.
  - **A single pair needs no labels.** `newMigratorFrom` in `migrator.go` keys
    the shared `Migrator` by `migratorKey{label, stream}` with the label
    defaulting to `"default"` when unset, so one input/output pair coordinates
    without any `label`. The labels were dropped from the workflow YAML to match.
  - **A label mismatch is not silent.** The input spec says a mismatched pair
    "fail[s] to connect", and `validateInitialized` returns
    `input not initialized` / `output not initialized` — the skill previously
    claimed the pair silently fails to coordinate.
  - **Label syntax comes from the engine**: benthos `v4.84.0`
    `internal/docs/config.go` (`labelExpression = ^[a-z0-9_\-]+$` and
    `ValidateLabel`, which also rejects a leading `_` or `-`). The previous
    "3–128 chars, `A-Za-z0-9-_`" claim was wrong on both the case range and the
    length bound and is gone.
- **Exact consumer-group offset translation documented** (the skill previously
  presented translation as timestamp-based and approximate, full stop).
  `rmoFieldOffsetHeader` in `migrator.go` (default `redpanda-migrator-offset`,
  `Version("4.71.0")`) stamps each migrated record with its source offset, and
  `migrator_groups.go` refines the timestamp result with it in
  `tryFindExactOffset` — applied only when `g.State == "Empty" && m.offsetHeader
  != ""`, which is why the field's own description limits exact translation to
  groups with no active members. The per-field detail (bounds, attempt limit,
  encoding) stays in the generated reference.
- **Partition top-up recorded**: the output spec's guarantees state that an
  existing destination topic with fewer partitions than its source has
  partitions added to match, which the skill's "never overwritten" bullet
  overstated.
- **TODO — duplicate-label lint vs documented pairing.** benthos `v4.84.0`
  registers every component label in one per-run `LintContext`
  (`labelsToLine`), returning `LintDuplicateLabel` ("label '%v' collides with a
  previously defined label at line %v") for a label used twice in a config. That
  appears to collide with the migrator's documented multi-pair scheme, where an
  input and its output deliberately share a label. `migration.md` now warns to
  lint before relying on a multi-pair layout rather than asserting either way;
  the Connect team should confirm whether a matched pair lints clean.
- **Out of scope for this routine:** nothing this window belongs to another
  product's skill.
