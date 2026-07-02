# connect-debugging Skill Source Map

Maps each file in `skills/connect-debugging/` to the source paths it derives from, so
future syncs and human maintainers know exactly where to verify claims.

Redpanda Connect is Go source in the **public** repo `redpanda-data/connect`: the CLI
(lint/dry-run/license/secrets/connector-list) lives under `internal/cli/`,
`internal/license/`, and `internal/secrets/`; the user-facing component reference
(logger, metrics, tracers, http, CDC inputs, `redpanda:` block) is AsciiDoc under
`docs/modules/components/pages/` **in the same repo**. The Connect *product* docs
(licensing overview, quickstarts) are the **public** repo `redpanda-data/rp-connect-docs`.
Both are public — read them via the Redpanda-Github-Read MCP connector
(`get_file_contents`), or `gh api .../contents/`; avoid `gh search code` (rate-limited).
Before writing or changing any fact, re-open the cited source and confirm exact flag
names, config keys, and error strings. Connect is versioned: verify against the **current
stable release tag**, not `main`.

Scope note: the top-level `rpk connect lint`/`run`/`test`/`list` command surface is a
managed-plugin passthrough to the **upstream Benthos framework** (`redpanda-data/benthos`,
`public/service`), not defined in `redpanda-data/connect`. Only `dry-run`, the
`mcp-server lint` (`custom_lint.go`), license, secrets, and connector-list code live in
the connect tree. Benthos-defined flags are deferred (see below).

## File-to-source table

| Skill file | redpanda-data/connect Go paths | redpanda-data/connect docs paths | rp-connect-docs paths |
|---|---|---|---|
| `SKILL.md` | `internal/cli/dry_run.go`, `internal/cli/custom_lint.go`, `internal/cli/flags_redpanda.go`, `internal/cli/flags_common.go`, `internal/cli/enterprise.go`, `internal/cli/connectors_list.go`, `internal/license/service.go`, `internal/secrets/secrets.go` | `docs/modules/components/pages/http/about.adoc`, `logger/about.adoc`, `metrics/prometheus.adoc`, `metrics/json_api.adoc`, `tracers/open_telemetry_collector.adoc` | `modules/get-started/pages/licensing.adoc` |
| `references/lint-and-validate.md` | `internal/cli/dry_run.go` (`dryRunCli()`, output format, `--redpanda-license`), `internal/cli/custom_lint.go` (`customLintCli()` = `mcp-server lint`), `internal/cli/flags_common.go` / `flags_redpanda.go` (`--verbose`, `--env-file`/`-e`, `--secrets`) | — | — |
| `references/logging-metrics-tracing.md` | — | `docs/modules/components/pages/logger/about.adoc`, `metrics/prometheus.adoc`, `metrics/statsd.adoc`, `metrics/json_api.adoc`, `metrics/logger.adoc`, `tracers/open_telemetry_collector.adoc`, `http/about.adoc`, `redpanda/about.adoc` | — |
| `references/failure-modes.md` | `internal/cli/dry_run.go`, `internal/cli/custom_lint.go`, `internal/license/service.go` (`readLicense`, default-path fallback), `internal/license/shared_service.go` (`CheckRunningEnterprise` error string) | `docs/modules/components/pages/logger/about.adoc`, `metrics/*`, `http/about.adoc`; CDC input skeletons under `docs/modules/components/pages/inputs/` | — |
| `references/enterprise-features.md` | `internal/cli/enterprise.go` (connector-list apply, `OnConfigParse`), `internal/cli/connectors_list.go` (`ApplyConnectorsList`, allow/deny), `internal/cli/flags_redpanda.go` (`--redpanda-license`, `--secrets`, `defaultLicenseConfig()`), `internal/license/service.go` (`defaultLicenseFilepath`), `internal/secrets/secrets.go` (`parseSecretsLookupURN`, URN schemes) | `docs/modules/components/pages/inputs/postgres_cdc.adoc`, `mysql_cdc.adoc`, `mongodb_cdc.adoc`, `oracledb_cdc.adoc`, `microsoft_sql_server_cdc.adoc`, `aws_dynamodb_cdc.adoc`, `gcp_spanner_cdc.adoc`, `salesforce_cdc.adoc`; `redpanda/about.adoc` | `modules/get-started/pages/licensing.adoc` (Connect enterprise feature table) |

All Go and connect-repo doc paths above were verified to exist (branch `main`). Spot-checked
Go claims: `connectors_list.go` — exact error `"connector list must only contain deny or allow
items, not both"`, `env.With(...)`/`env.Without(...)`, `allow`/`deny` YAML keys; `secrets.go` —
schemes `test`, `redis`, `env`, `aws`, `gcp`, `az`, `none`, and error `"secrets scheme %v not
recognized"`.

## Deferred to live introspection (NOT drift — do not pin or hardcode)

- **Top-level `rpk connect lint` / `run` / `test` / `list` flags and subcommands** — from the upstream Benthos framework (`redpanda-data/benthos`, `public/service`), not the connect tree. The skill already flags "confirm with `rpk connect --help`." Only `dry-run` and `mcp-server lint` flags are verifiable in `redpanda-data/connect`.
- **Metric names** (`input_received`, `input_latency`, `output_sent`, `output_batch_sent`, `redpanda_cluster_features_enterprise_license_expiry_sec`) — release-specific; source from a live `json_api`/`prometheus` `/metrics` endpoint or generated docs, not pinned.
- **Runtime log/trace output** — the "Successfully loaded Redpanda license", allow/deny apply, and logfmt/json log-line examples are illustrative runtime output.
- **Component enterprise-support status** — confirm via the component catalog (`?support=enterprise`) or `rpk connect dry-run` at runtime, not a static list.

## TODO / re-verify

- **Licensing doc path mismatch:** the skill cites `docs/modules/get-started/pages/licensing/overview.adoc` and `.../licensing/disable-enterprise-features.adoc`. Neither exists. The Connect licensing page is a single file in **rp-connect-docs**: `modules/get-started/pages/licensing.adoc` (no `licensing/` subdir). `disable-enterprise-features.adoc` is a **self-managed `redpanda-data/docs`** page, out of this skill's scope — re-point or drop.
- **`connectors_list.go` vs `connector_list.go`:** `enterprise-features.md` prose says `connector_list.go`; the actual file is `connectors_list.go` (function `ApplyConnectorsList`). The runtime file it reads is `/etc/redpanda/connector_list.yaml` (singular). Fix the source-file name in prose.
- **Constant names** `defaultLicenseFilepath` (`service.go`) and `connectorListPath` (`enterprise.go`) — files verified; exact constant identifiers not individually re-confirmed. Re-open to confirm spellings and the `/etc/redpanda/redpanda.license` / `/etc/redpanda/connector_list.yaml` defaults.
- **CDC config field skeletons** in `enterprise-features.md` (postgres_cdc slot/heartbeat, mysql_cdc binlog/checkpoint_cache, mongodb_cdc change streams, oracledb_cdc `logminer{}`) transcribed from the input pages — field names/defaults are release-specific; re-check each against its input page on the current tag.

## Usage

For each file being reviewed or updated, open the listed source paths first and confirm
every claim still matches. Verify against the current stable release tag of
`redpanda-data/connect` (Go + component docs) and `redpanda-data/rp-connect-docs`
(licensing/product docs). Treat the upstream Benthos command surface as live-introspected,
not pinned. Re-confirm exact flag names, config keys, and error strings before writing any
new fact.
