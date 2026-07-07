# rpk-transform Skill Source Map

Maps each file in `skills/rpk-transform/` to the source paths it derives from, so future syncs and human maintainers know exactly where to verify claims.

The `rpk transform` CLI is Go source in the **public** repo `redpanda-data/redpanda` under `src/go/rpk/pkg/cli/transform/`. The broker-side Data Transforms engine (in-broker WebAssembly) is C++ under `src/v/transform/`, and transform cluster-config keys are defined in `src/v/config/configuration.cc`. The transform SDKs live under `src/transform-sdk/` (`go/`, `rust/`, `js/`, `cpp/`). The user-facing reference is in the **public** repo `redpanda-data/docs`. All are public — read them via the Redpanda-Github-Read MCP connector (`search_code`, `get_file_contents`) or `gh api .../contents/<path>`; do not guess. Before writing or changing any fact, re-open the cited source and confirm exact command paths, flag names, config keys, and metric names. `rpk`/Redpanda are versioned: verify against the **current stable release tag**, not `dev`/`main`.

## File-to-source table

| Skill file | redpanda source paths | docs sources |
|---|---|---|
| `SKILL.md` | `src/go/rpk/pkg/cli/transform/transform.go` (`NewCommand`, `wasm` alias, `newPauseCommand`/`newResumeCommand` are defined here — no separate `pause.go`/`resume.go`), `init.go`, `build.go`, `deploy.go`, `list.go`, `logs.go`, `delete.go`, `meta.go`, `project/`, `template/`, `buildpack/`; broker engine `src/v/transform/` (`transform_manager.cc`, `transform_processor.cc`, `probe.cc`, `logger.cc`); config keys `src/v/config/configuration.cc` (`data_transforms_*`); SDK import paths `src/transform-sdk/go/transform/` (+ `sr/`), `src/transform-sdk/rust/`, `src/transform-sdk/js/` | `modules/reference/pages/rpk/rpk-transform/rpk-transform.adoc` (+ per-command pages below); `modules/develop/pages/data-transforms/` (`index.adoc`, `how-transforms-work.adoc`, `deploy.adoc`, `monitor.adoc`); `modules/reference/partials/properties/cluster-properties.adoc` |
| `references/develop-and-build.md` | `src/go/rpk/pkg/cli/transform/init.go`, `build.go`, `template/`, `project/`, `buildpack/`; SDK sources `src/transform-sdk/go/transform/` (+ `sr/`), `src/transform-sdk/rust/`, `src/transform-sdk/js/` (generated boilerplate + API surface); language/build behavior verified against `build.go` | `modules/develop/pages/data-transforms/build.adoc`, `run-transforms.adoc`, `configure.adoc`, `test.adoc`, `versioning-compatibility.adoc`; `modules/reference/pages/rpk/rpk-transform/rpk-transform-init.adoc`, `rpk-transform-build.adoc` |
| `references/deploy-and-operate.md` | `src/go/rpk/pkg/cli/transform/deploy.go`, `list.go` (+ `list_test.go`), `logs.go` (+ `logs_test.go`), `delete.go`, `transform.go` (pause/resume); config keys `src/v/config/configuration.cc` (`data_transforms_*`); metrics `src/v/transform/probe.cc` (labels `function_name`, `state`, `output_topic` verified) | `modules/develop/pages/data-transforms/deploy.adoc`, `monitor.adoc`; `modules/reference/pages/rpk/rpk-transform/rpk-transform-deploy.adoc`, `rpk-transform-list.adoc`, `rpk-transform-logs.adoc`, `rpk-transform-pause.adoc`, `rpk-transform-resume.adoc`, `rpk-transform-delete.adoc`; `modules/reference/partials/properties/cluster-properties.adoc` |
| `references/enterprise-output-topics.md` | Enterprise **cluster/topic** config keys defined in `src/v/config/configuration.cc` (`iceberg_*`, `cloud_storage_*`, `enable_schema_id_validation`, `default_leaders_preference`) and `src/v/config/leaders_preference.cc` — rpk only passes these through via `rpk cluster config set` / `rpk topic create|alter-config`; license check `src/go/rpk/pkg/cli/cluster/license/`; RBAC `src/go/rpk/pkg/cli/security/role/` | `modules/reference/partials/properties/cluster-properties.adoc`, `topic-properties.adoc`, `object-storage-properties.adoc`; Iceberg / Tiered Storage / schema-ID-validation / leadership-pinning pages under `modules/manage/` and `modules/develop/` |

## Deferred to live introspection (NOT drift — do not pin or hardcode)

- `rpk transform <cmd> --help` and the live command tree — authoritative flag list; confirm the skill's flag tables against live `--help`.
- Deployed-transform runtime state: `rpk transform list` / `--detailed` output (processor counts, `NODE`, `STATUS`, `LAG`), and `rpk transform logs` content.
- Live metric values and the exact label set surfaced on `/public_metrics` for a running cluster.
- Language toolchain / SDK versions (Go `>=1.20`, Node LTS, Rust stable, `redpanda-transform-sdk` version, `write_with_options` requiring SDK `>= 1.1.0`) — external/versioned; confirm against current SDK releases.
- Buildpack download behavior (TinyGo / JS Wasm VM fetched at build time) — depends on the release's bundled buildpack versions.

## TODO / re-verify

- **Exact Prometheus metric names** (`redpanda_transform_execution_latency_sec`, `redpanda_transform_execution_errors`, `redpanda_wasm_engine_*`) not each line-verified. `src/v/transform/probe.cc` confirms labels `function_name`/`state`/`output_topic` and stems `failures`/`lag`/`read_bytes`/`write_bytes`/`state`; the `redpanda_transform_` prefix and `wasm_engine_*` metrics are added elsewhere (likely `src/v/wasm/` probes). Re-verify the full metric-name list against `probe.cc`, the wasm-engine probe, and `modules/develop/pages/data-transforms/monitor.adoc`.
- **Cluster-config defaults** shown as "(varies)" are intentionally not pinned; authoritative values are `configuration.cc` + `cluster-properties.adoc`. Note `configuration.cc` also defines `data_transforms_read_buffer_memory_percentage` and `data_transforms_write_buffer_memory_percentage`, not listed by the skill — confirm whether they belong in the property table.
- **Enterprise topic-property defaults** (Iceberg `redpanda.iceberg.*`, `redpanda.remote.*`, schema-ID-validation, `redpanda.leaders.preference`) not each line-verified; treat `topic-properties.adoc` / `object-storage-properties.adoc` as citation of record.
- **Per-command flag tables** (deploy/init/build/list/logs) not each verified against current flag registrations — re-confirm flag names/shorthands before editing.
- **Cloud pause/resume**: `cloud-docs modules/reference/pages/rpk/rpk-transform/` has no `rpk-transform-pause`/`-resume` pages (the self-managed reference does). Whether pause/resume work on Cloud clusters is unconfirmed — verify on a live Cloud cluster or with the Cloud team.
- **Azure enablement path**: the docs do not state how to enable transforms on Azure BYOC/Dedicated clusters, where self-service cluster properties are unavailable.

## Redpanda Cloud applicability sources

The "Redpanda Cloud Applicability" section in `SKILL.md` and the Cloud callouts in `references/deploy-and-operate.md` derive from the **private** repo `redpanda-data/cloud-docs` (read via the Redpanda-Github-Read connector; do not clone) plus the cloud-tagged property partial in `redpanda-data/docs`:

- BYOC/Dedicated (Redpanda 24.3+) availability, Serverless not listed: `cloud-docs modules/develop/pages/data-transforms/how-transforms-work.adoc` (NOTE at top).
- Cloud enablement via `rpk cluster config set` — rpk 25.1.2+ / Redpanda 25.1.2+, `rpk cloud login` first, BYOC/Dedicated on AWS/GCP only (not Azure, not Serverless), `REASON_INVALID_INPUT` on unsupported properties, restart-requiring sets return a long-running-operation ID: `cloud-docs modules/manage/pages/cluster-maintenance/config-cluster.adoc`; the same command appears in the `ifdef::env-cloud` "Enable data transforms" block of `docs modules/develop/pages/data-transforms/build.adoc`.
- Cloud-settable `data_transforms_*` subset: `// tag::redpanda-cloud[]` boundaries in `docs modules/reference/partials/properties/cluster-properties.adoc` (included by `cloud-docs modules/reference/pages/properties/cluster-properties.adoc`); the non-cloud tuning sections are also `ifndef::env-cloud`-gated in `docs modules/develop/pages/data-transforms/configure.adoc`.
- Cloud UI can view transform logs and delete transforms: `ifdef::env-cloud` TIPs in `docs modules/develop/pages/data-transforms/deploy.adoc` and `monitor.adoc`.

## Usage

For each file being reviewed or updated, open the listed source paths first and confirm every claim still matches. Verify against the current stable release tag of `redpanda-data/redpanda`, and re-confirm exact command paths, flag names, config keys, and metric names before writing any new fact.
