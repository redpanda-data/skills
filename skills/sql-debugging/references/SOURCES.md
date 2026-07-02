# sql-debugging Skill Source Map

Maps each file in `skills/sql-debugging/` to the source paths it derives from, so future
syncs and human maintainers know exactly where to verify claims.

The skill documents **Oxla** (the closed-source C++ analytical database behind Redpanda
SQL) plus the **Redpanda-side** Iceberg Topics integration that feeds it. Oxla source is
the **PRIVATE** repo `redpanda-data/oxla` — read it **only** via the Redpanda-Github-Read
MCP connector (`get_file_contents`, `search_code`); do **not** use `gh` or clone it. The
Redpanda Iceberg source is the **public** repo `redpanda-data/redpanda` (`src/v/datalake/`,
`src/v/config/`) and the **public** docs repo `redpanda-data/docs` (`manage/iceberg` module).
Before writing or changing any fact, re-open the cited source and confirm exact table/column
names, metric `k_name` strings, proto enum values, and config keys.

## File-to-source table

| Skill file | redpanda-data/oxla source paths (PRIVATE) | Redpanda / docs sources (public) |
|---|---|---|
| `SKILL.md` | `src/metastore/system_{nodes,queries,transactions,storage,execs,catalogs}.cpp`; `src/processors/consts/show_shapes.cpp` (system-table column schemas); `src/monitoring/metrics/*.h/.cpp` (metric `k_name` constants); `src/util/plog.h` (`initPlog`, log dir/filenames); `src/admin/proto/logging.proto` + `src/admin/logging_service_impl.cpp` (LoggingService, `LOG_LEVEL_*`); `src/mem/limits.h` (`k_oom_monitor_margin_factor = 0.01`) + `src/mem/oom_monitor.cpp`; `config/Release/default_config.yml` (ports, `logging.level`, `memory.*`, `admin_api.*`) | `rpk cluster license info` (redpanda `src/go/rpk/`); Iceberg cluster/topic properties (see iceberg row) |
| `references/system-tables.md` | `src/metastore/metastore.cpp` (`createSystemTables()`); `system_nodes.cpp`, `system_queries.cpp`, `system_transactions.cpp`, `system_storage.cpp` (`StorageConnections`), `system_execs.cpp`, `system_catalogs.cpp`, `system_databases.cpp`, `system_tables.cpp`, `system_columns.cpp`; `src/processors/consts/show_shapes.cpp` → `nodeStateOutputSchema()`, `nodeQueriesOutputSchema()`, `nodeExecsOutputSchema()`; `information_schema_*.cpp` and `pg_*.cpp` under `src/metastore/`; `src/scheduler/states/context.cpp` + `src/executor/executor.cpp` (`state` value domain); `config/Release/default_config.yml` (`feature_flags.allow_table_operations`, `distributed_catalog.*`) | — |
| `references/metrics-and-logging.md` | `src/monitoring/metrics/` — per-metric header/`.cpp` `k_name` strings (`cluster_has_leader.h`, `node_is_{leader,ready,degraded}.h`, `nodes_connected.h`, `open_connections.h`, `oxla_net_postgres_*`, `query_errors.h` (`error_type` enum), `query_{duration,parse_duration,plan_duration,execute_duration}.h`, `query_{rows_processed,rows_returned,bytes_processed}.h`, `file_cache_use.cpp`, `journal_size.h`, `kafka_{messages_consumed,messages_failed,bytes_consumed}`, `catalog_transactions_{active,total}`, `ddl_operations_total.h`, `data_task_duration.h`, `scheduler_queries_running`, `executor_tasks_running`, `thread_pool_*`, …); `src/util/plog.h`; `src/admin/proto/logging.proto` + `logging_service_impl.cpp`; `config/Release/default_config.yml` (`metrics.port: 8080`, `admin_api.port: 9090`, `logging.level`) | — |
| `references/troubleshooting.md` | `src/mem/oom_monitor.cpp` + `src/mem/limits.h` (RSS check, `operational_total = total − total·0.01`); `src/metastore/system_{queries,execs,nodes}.cpp`; `src/monitoring/metrics/*`; `config/Release/default_config.yml` (`memory.*`, `resource_management.{max_concurrent_queries: 100, query_queue_timeout: 30 s}`, `network.node.port: 5771`, `heartbeat.timeout: 60000 ms`); `logging_service_impl.cpp` | — |
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
