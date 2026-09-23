# sql-debugging Skill Source Map

Maps each file in `skills/sql-debugging/` to the source paths it derives from, so future
syncs and human maintainers know exactly where to verify claims.

The skill documents **Oxla** (the closed-source C++ analytical database behind Redpanda
SQL) plus the **Redpanda-side** Iceberg Topics integration that feeds it. Oxla source is
the **PRIVATE** repo `redpanda-data/oxla` — read it **only** via the Redpanda-Github-Read
MCP connector (`get_file_contents`, `search_code`); do **not** use `gh` or clone it. The
Redpanda Iceberg source is the **public** repo `redpanda-data/redpanda` (`src/v/datalake/`,
`src/v/config/`) and the **private** docs repo `redpanda-data/docs` (`manage/iceberg` module).
Users do **not** run Oxla's default branch. They run the Oxla version that
`redpanda-data/cloudv2` pins (`vars.redpanda_oxla_version` in `install-pack/*.yml`,
`redpanda-oxla:` in `adp/images.yaml`; the lowest if they differ), built from the Oxla tag
`<version>-rcN` on its `release/X.Y` branch. **Verify against that tag** — the default branch
runs ahead of it, and a surface that exists only there is not shipped. `search_code` only
searches the default branch, so use it to locate files and confirm with `get_file_contents` at
the tag.

Before writing or changing any fact, re-open the cited source and confirm exact table/column
names, metric `k_name` strings, proto enum values, and config keys. **Do not pin config
default values** — they are version-specific; cite the live surface (`SHOW`, the node's config,
the admin config service) instead.

## File-to-source table

| Skill file | redpanda-data/oxla source paths (PRIVATE) | Redpanda / docs sources (public) |
|---|---|---|
| `SKILL.md` | `src/metastore/system_{nodes,queries,transactions,storage,execs,catalogs}.cpp`; `src/processors/consts/show_shapes.cpp` (system-table column schemas); `src/monitoring/metrics/*.h/.cpp` (metric `k_name` constants); `src/util/plog.h` (`initPlog`, log dir/filenames); `src/admin/proto/logging.proto` + `src/admin/logging_service_impl.cpp` (LoggingService, `LOG_LEVEL_*`); `src/mem/limits.h` (`k_oom_monitor_margin_factor = 0.01`) + `src/mem/oom_monitor.cpp`; `config/Release/default_config.yml` (ports, `logging.level`, `memory.*`, `admin_api.*`) | `rpk cluster license info` (redpanda `src/go/rpk/`); Iceberg cluster/topic properties (see iceberg row) |
| `references/system-tables.md` | `src/metastore/metastore.cpp` (`createSystemTables()`); `system_nodes.cpp`, `system_queries.cpp`, `system_transactions.cpp`, `system_storage.cpp` (`StorageConnections`), `system_execs.cpp`, `system_catalogs.cpp`, `system_databases.cpp`, `system_tables.cpp`, `system_columns.cpp`; `src/processors/consts/show_shapes.cpp` → `nodeStateOutputSchema()`, `nodeQueriesOutputSchema()`, `nodeExecsOutputSchema()`; `information_schema_*.cpp` and `pg_*.cpp` under `src/metastore/` (incl. `pg_views.cpp` — the `schemaname`/`viewname`/`viewowner`/`definition` column schema, the per-role grant scoping, the empty `viewowner`, and `definition` = the view's stored query text; `pg_class.cpp` for `relkind = 'v'`, with `tests/blackbox/pit/views/test_views.py` as the end-to-end authority); `src/scheduler/states/context.cpp` + `src/executor/executor.cpp` (`state` value domain); `config/Release/default_config.yml` (`feature_flags.allow_table_operations`, `distributed_catalog.*`) | — |
| `references/metrics-and-logging.md` | `src/monitoring/metrics/` — per-metric header/`.cpp` `k_name` strings (`cluster_has_leader.h`, `node_is_{leader,ready,degraded}.h`, `nodes_connected.h`, `open_connections.h`, `oxla_net_postgres_*`, `query_errors.h` (`error_type` enum), `query_{duration,parse_duration,plan_duration,execute_duration}.h`, `query_{rows_processed,rows_returned,bytes_processed}.h`, `file_cache_use.cpp`, `journal_size.h`, `kafka_{messages_consumed,messages_failed,bytes_consumed}`, `catalog_transactions_{active,total}`, `ddl_operations_total.h`, `data_task_duration.h`, `scheduler_queries_running`, `executor_tasks_running`, `thread_pool_*`, …); `src/util/plog.h`; `src/admin/proto/logging.proto` + `logging_service_impl.cpp`; `config/Release/default_config.yml` (`metrics.port: 8080`, `admin_api.port: 9090`, `logging.level`) | — |
| `references/troubleshooting.md` | **`EXPLAIN` step of Playbook 1**: `src/query_planner/context/explain_mode.{h,cpp}` (mode registry + the per-mode result-column schemas quoted in that step; `physical_plan` carries `requires_pipeline`), `src/query_planner/visitors/ast_builder.cpp` (`buildExplain` — the pipeline requirement and the help fallback), `src/query_planner/query_planner.cpp` (`buildExplainPlan`, and `describePlan` rendering a partial plan when a build fails), `src/net/postgres/states/helpers/set_helper.cpp` (`SET oxla.query_planner.pipeline`) — full grounding in `skills/sql/references/SOURCES.md` (the `ddl-dml.md` row); the **rows** `EXPLAIN` returns are runtime, only the column names are pinned. `src/mem/oom_monitor.cpp` + `src/mem/limits.h` (RSS check, `operational_total = total − total·0.01`); `src/metastore/system_{queries,execs,nodes}.cpp`; `src/monitoring/metrics/*`; **Playbook 1 Step 8** (`oxla.parquet_late_materialization`): `src/net/postgres/states/helpers/set_helper.cpp` (the `SET` parameter name and its boolean parsing, incl. the `parameter "…" requires Boolean value` message; the proto field is inverted — `set_oxla_disable_parquet_late_materialization(!value)` — so the option reads as ON where nothing set it), `src/query_planner/query_planner.cpp` (`buildShowPlan` — the `SHOW` arm, which is the live surface the step tells the reader to use), `src/session/proto/session_context.proto` (`oxla_disable_parquet_late_materialization`), `src/processors/parquet/planner.{h,cpp}` (`LateMaterializationConfig::enabled` and the `NativePlanBuilder` guard — off forces a one-pass read; the numeric thresholds beside it are tuning, never results, and must NOT be documented), `src/query_planner/sources/iceberg_source.cpp` + `src/query_planner/import_planner/import_planner.cpp` (the option reaches Iceberg scans and parquet `COPY FROM`), `tests/blackbox/pit/session_info/test_session_info.py` (the `SET`/`SHOW` round trip). `config/Release/default_config.yml` (`memory.*`, `resource_management.{max_concurrent_queries,query_queue_timeout}` — **key names only; the shipped defaults have changed and must not be pinned**, `network.node.port`, `heartbeat.timeout`); `logging_service_impl.cpp`; `src/query_planner/visitors/kafka_offset_pruner.{h,cpp}` (Kafka-source read pruning: a `(redpanda).timestamp` bound needs a broker timequery, and a failed resolution degrades the scan to reading without timestamp bounds — exact results, larger read — with a warning carrying the query ID; offset/partition pruning is unaffected) | — |
| `references/redpanda-iceberg-source.md` | *(not oxla)* — see right column | redpanda `src/v/datalake/` (`record_translator.cc`, `record_multiplexer.cc`, `translation_task.cc`, `record_schema_resolver.cc`, `schema_registry.cc`, `partition_spec_parser.cc`, `table_id_provider.cc`); redpanda `src/v/config/configuration.{cc,h}` + `src/v/config/validators.cc` (`iceberg_enabled`, `iceberg_default_catalog_namespace`, `iceberg_dlq_table_suffix` (`~dlq`), `iceberg_rest_catalog_*`); docs `modules/manage/pages/iceberg/{about-iceberg-topics,use-iceberg-catalogs,iceberg-troubleshooting}.adoc`; docs `modules/reference/partials/properties/topic-properties.adoc` (`redpanda.iceberg.*`); `rpk cluster license info` |

## Deferred to live introspection (NOT drift — do not pin or hardcode)

Even though the entries below are grounded in `redpanda-data/oxla` at the current default
branch, the **runtime surface is release-specific**. A sync/audit must not "correct" these
into a static list, nor flag a live/source mismatch as drift:

- **Prometheus metric names, types, and label values** — sourced from `k_name`/enum constants in `src/monitoring/metrics/*` at build time, but the exposed set varies by Oxla release. Confirm against a live `curl http://<host>:8080/metrics`, not a pinned catalog.
- **System-table row *contents*** — every `system.*` table is populated at query runtime; no materialized cache. Column *schemas* are pinned (`show_shapes.cpp`); the rows are live.
- **`system.queries.state` value strings** (`created`, `scheduling`, `scheduled`, `executing`, `cancelling`, `cleanup`, `ready`, `finished`) — emitted by the scheduler state machine at runtime; observe live.
- **Log level in effect** — settable at runtime via `oxla.admin.v1.LoggingService/{Get,Set}LogLevel` (port 9090); the current level is runtime state.
- **`rpk cluster license info` output** and Iceberg property *values on a given cluster* — runtime cluster state.

## TODO / re-verify

- **Log filename pattern** (SKILL + metrics-and-logging say `server.<DATETIME>.<PID>.log`): `src/util/plog.h` documents the rolling log as `$TMPDIR/oxla/server.$DATETIME.log` (**no PID**); the `.<PID>.` form appears on the separate `startup.$DATETIME.$PID.log` tee file. Reconcile the `server.*` pattern.
- **`state` value strings not line-verified**: `src/scheduler/states/context.cpp` and `src/executor/executor.cpp` confirmed to exist, but the exact lowercase enum-to-string mapping was not read line-by-line. Re-verify if precision matters.
- **Config default values** confirmed against `config/Release/default_config.yml`; note troubleshooting.md uses `60 s` / `50` as *tuning examples*, not defaults — do not treat as drift.
- **`redpanda.iceberg.*` topic-property defaults / accepted values**: treat `modules/reference/partials/properties/topic-properties.adoc` as citation of record; upstream is redpanda `src/v/config/`, not oxla.
- **`get-started/licensing/overview.adoc`** (cited in redpanda-iceberg-source.md) not path-verified this pass; confirm before relying on it.

## Usage

For each file being reviewed or updated, open the listed source paths first and confirm every
claim still matches. Read `redpanda-data/oxla` **only** through the Redpanda-Github-Read connector.
Treat everything under "Deferred to live introspection" as runtime state — verify against a live
`/metrics` scrape or `SELECT`, never by pinning to source — and re-confirm exact table/column names,
metric `k_name` strings, proto enums, and config keys before writing any new fact.
