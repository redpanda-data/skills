# sql-admin-api Skill Source Map

Maps each file in `skills/sql-admin-api/` to the source paths it derives from, so future syncs and human maintainers know exactly where to verify claims.

Oxla admin/operations are grounded in the **private** repo `redpanda-data/oxla`. Read it **only** via the Redpanda-Github-Read MCP connector (`search_code`, `get_file_contents`) — never `gh`, never clone. Oxla is a C++ codebase built with Bazel/CMake; it is **trunk-based** (`version.txt`, no `v/*` release-tag scheme like rpk), so verify against the branch/ref you actually deploy. Before writing or changing any fact, re-open the cited source and confirm exact YAML keys, `OXLA__` env-var names, ports, and DDL option keys. Config defaults are version-specific — prefer `config/{Release,Debug}/default_config.yml` at the target ref over hardcoding.

Scope note: SQL-level administration (roles, grants, system-table queries, DDL semantics) belongs to the `sql` skill, not here. This skill has **no `redpanda-data/docs` citations** — there is no public `sql` module on the docs repo (`modules/` on `main` has no `sql`); all grounding is source-only.

## File-to-source table

| Skill file | redpanda-data/oxla source paths |
|---|---|
| `SKILL.md` | `config/Release/default_config.yml`, `config/Debug/default_config.yml`, `src/config/config_parameter_list.h`, `src/config/startup_config.{h,cpp}`, `src/admin/proto/logging.proto`, `src/admin/server.cpp`, `src/catalog/{iceberg_catalog_parser.cpp,storage_parser.cpp,kafka/conversions.cpp}`, `src/sqlparser/sql/connection_option_names.h`, `src/sqlparser/bison_parser/bison_parser.y`, `src/access_control/aes256_gcm/`, `tests/blackbox/configurations/` |
| `references/configuration.md` | `config/Release/default_config.yml` (+ `config/Debug/default_config.yml`), `src/config/config_parameter_list.h` (public/internal classification; `executor.workers` is internal), `src/config/startup_config.{h,cpp}` (`ExecutorConfig executor`), `src/config/env_var_overlay.cpp`, `src/config/config_file_generator.cpp`, `src/config/deep_merge.cpp` |
| `references/admin-grpc-and-runtime.md` | `src/admin/proto/logging.proto`, `src/admin/proto/debug.proto` (`DebugService` RPCs incl. `GetConfig`), `src/admin/debug_service/` (`get_config.cpp`, `debug_service_impl.{cpp,h}`), `src/config/config_dumper.{cpp,h}` (server-side redaction allowlist + `***` placeholder), `src/admin/proto/CMakeLists.txt` (`protobuf_generate_connect`), `src/admin/server.cpp` (route registration), `src/admin/logging_service_impl.{cpp,h}`, `src/admin/connect.h`, `src/admin/README.md`, `tests/blackbox/admin_client/client.py`, `tests/blackbox/admin_api.py`, `tests/blackbox/admin_client/test_admin.py`; `config/Release/default_config.yml` (`admin_api`, `metrics`, `memory` sections) |
| `references/auth-and-security.md` | `config/Release/default_config.yml` (`access_control`, `oidc`, `feature_flags.centralized_access_control`), `src/config/config_parameter_list.h`, `src/config/startup_config.cpp` (CAC → `access_control.cac.*` mapping), `src/access_control/scram_sha256/`, `src/access_control/access_controller.cpp`, `src/access_control/aes256_gcm/{crypt.cpp,aes256_gcm.cpp}`, `src/access_control/oidc/`, `src/sqlparser/sql/connection_option_names.h` (`k_*_sensitive_keys`) |
| `references/cluster-and-deploy.md` | `config/Release/default_config.yml` (`network`, `leader_election`, `shared_memory`), `tests/blackbox/configurations/{one_node.yml,one_node_ssl.yml,one_node_minio_no_cas.yml,three_nodes.yml,three_nodes_ports.yml,three_nodes_with_network.yml,certs/}`, `ansible/{devcluster_deploy.yml,devcluster_deploy_aws.yml,requirements.yml}`, `ansible/templates/{config.yml.j2,config_aws.yml.j2,iceberg_glue.j2}`, `ansible/inventory/*.yml`, `terraform/devcluster/{main.tf,variables.tf,outputs.tf,userdata.sh,templates/ansible-inventory.yml.tpl}` |
| `references/lakehouse-and-streaming.md` | `src/sqlparser/sql/connection_option_names.h` (authoritative option-key constants), `src/sqlparser/bison_parser/bison_parser.y` (DDL grammar), `src/catalog/iceberg_catalog_parser.cpp`, `src/catalog/kafka/conversions.cpp`, `src/catalog/storage_parser.cpp`, `src/metastore/system_iceberg_catalogs.{cpp,h}`, `src/metastore/system_iceberg_tables.{cpp,h}` (also `system_kafka_connections.*`, `system_kafka_sources.*`, `system_storage.*`), `config/Release/default_config.yml` (`feature_flags.allow_iceberg_queries`), `ansible/templates/iceberg_glue.j2` |
| `scripts/set_log_level.sh` | `src/admin/proto/logging.proto` (LoggingService RPCs + `LOG_LEVEL_*` enum), admin API endpoints per `references/admin-grpc-and-runtime.md` |
| `resources/docker-compose-local.yml` | `tests/blackbox/configurations/one_node.yml` pattern + `config/Release/default_config.yml` env-var equivalents; image ref from repo `docker/` build config (ECR `oxla-devel`) |

## Deferred to live introspection (NOT drift — do not pin or hardcode)

- **Config defaults and the full parameter list** — read `config/{Release,Debug}/default_config.yml` and `src/config/config_parameter_list.h` at the target ref; do not hardcode values beyond what is grounded there.
- **Runtime cluster state** — `system_iceberg_catalogs`, `system_iceberg_tables`, `system_kafka_connections`, `system_kafka_sources`, `system_storage`, `system_nodes` contents; node health/leader status. Query live.
- **ConnectRPC response payloads** — actual `GetLogLevel`/`SetLogLevel` returns and `/healthz` output are runtime values.
- **Docker image tag** — `778696301129.dkr.ecr.eu-central-1.amazonaws.com/oxla-devel:latest` is registry/release state, not pinned in source.

## TODO / re-verify

- **No public docs exist.** The `sql` module named in the sourcing brief is **not present** on `redpanda-data/docs` `main`. (The `sql` skill's user-facing docs are in `redpanda-data/cloud-docs`; admin-api has none.) If a public admin docs module lands later, add a docs column. (unverified — no path)
- **Memory/OOM monitor internals** in `admin-grpc-and-runtime.md` (samples `/proc/self/status` RSS, ~1% margin below `memory.max`, cancels queries + evicts storage cache) are **not backed by a cited source path** — only the `memory.*` config keys are grounded. Locate and cite the OOM-monitor source (`src/mem/oom_monitor.cpp`, per the sql-debugging map) before treating these mechanics as verified.
- **public vs internal per-key classification** grounded in `src/config/config_parameter_list.h` but not line-verified key by key against the skill's tables.
- `default_config.yml` also contains a `kafka:` connection-pool section (`handle_pool_max_handles`, `admin_pool_max_admins`, `pool_max_idle`, `pool_maintenance_interval`) that `configuration.md` does not document — a gap to consider on the next sync. (The `executor:` section — `executor.workers` — is now documented in the Executor Section.)

## Usage

For each file being reviewed or updated, open the listed source paths first (via the Redpanda-Github-Read connector — the repo is private) and confirm every claim still matches. Verify against the branch/ref you deploy, and re-confirm exact YAML keys, `OXLA__` env-var names, ports, and DDL option keys before writing any new fact.
