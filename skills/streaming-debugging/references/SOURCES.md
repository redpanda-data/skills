# streaming-debugging Skill Source Map

Maps each file in `skills/streaming-debugging/` to the source paths it derives from, so
future syncs and human maintainers know exactly where to verify claims.

The `streaming-debugging` skill is an operator's debugging playbook for a Redpanda
broker/cluster: debug bundles, the Prometheus metrics endpoints, logs and log levels, CPU
profiling, partition/raft health, and failure-mode triage plus enterprise-feature health
signals. It is grounded in the **public** repo `redpanda-data/redpanda` — the `rpk` CLI is
Go under `src/go/rpk/`, the broker + Admin API are C++ under `src/v/`, config under
`src/v/config/` — and the monitoring/troubleshooting + auto-generated reference pages in the
**public** repo `redpanda-data/docs`. Both are public — read them via the Redpanda-Github-Read
MCP connector (`search_code`, `get_file_contents`), or `gh` for verification.

**Metric grounding:** metric *names* are release-specific and are NOT pinned to a source
path. The human-readable list is the auto-generated reference pages
`modules/reference/pages/public-metrics-reference.adoc` and `internal-metrics-reference.adoc`
(regenerated per release); the definitions themselves are scattered across `src/v/` modules
(`cluster/`, `raft/`, `cloud_storage/`, `storage/`, `kafka/server/`, `datalake/`,
`cluster_link/`). Treat metric names, `--help` flag output, and live JSON response shapes as
live-introspection items (see below), not drift. Debugging is versioned: verify against the
**current stable release tag**, not `dev`/`main`.

## File-to-source table

| Skill file | redpanda source paths | docs sources |
|---|---|---|
| `SKILL.md` | `src/go/rpk/pkg/cli/debug/debugbundle/common.go`, `debug/bundle/`, `debug/remotebundle/`, `src/v/redpanda/admin/debug.cc`, `partition.cc`, `server.{h,cc}`, `src/v/config/configuration.cc`, `node_config.cc` | `modules/manage/pages/monitoring.adoc` (+ `manage/partials/monitor-redpanda.adoc`, `monitor-health.adoc`), `modules/reference/pages/public-metrics-reference.adoc`, `internal-metrics-reference.adoc`, `modules/reference/pages/rpk/rpk-debug/`, `modules/troubleshoot/pages/` |
| `references/debug-bundle.md` | `src/go/rpk/pkg/cli/debug/debugbundle/common.go` (`DebugBundleSharedOptions` + flag defaults: controller-logs-size-limit `132MB`, cpu-profiler-wait `30s`, logs-size-limit `100MiB`, logs-since `yesterday`, metrics-interval `10s`, metrics-samples `2`, kafka-connections-limit `256`, label-selector `app.kubernetes.io/name=redpanda`), `debug/bundle/{bundle.go,bundle_linux.go,bundle_k8s_linux.go}` (bundle file layout, K8s detection via `KUBERNETES_SERVICE_HOST/PORT`, `--output`/`--upload-url`/`--timeout`), `debug/remotebundle/{start,status,download,cancel,remote}.go`, `src/v/redpanda/admin/debug_bundle.cc`/`.h` (Admin-API-driven remote bundle), `src/v/config/configuration.cc` (`debug_bundle_auto_removal_seconds`) | `modules/reference/pages/rpk/rpk-debug/rpk-debug-bundle.adoc`, `rpk-debug-remote-bundle{,-start,-status,-download,-cancel}.adoc`, `modules/troubleshoot/pages/debug-bundle/`, `modules/troubleshoot/partials/debug-bundle/generate-rpk.adoc` |
| `references/metrics.md` | Metric definitions scattered across `src/v/` (`cluster/`, `raft/`, `cloud_storage/`, `storage/`, `kafka/server/`); `src/v/config/configuration.cc` (`enable_consumer_group_metrics`). **Metric names are release-specific — not pinned to a path (see Deferred).** | `modules/reference/pages/public-metrics-reference.adoc` (generated), `internal-metrics-reference.adoc` (generated), `modules/manage/partials/monitor-health.adoc`, `monitor-redpanda.adoc` |
| `references/triage-playbooks.md` | `src/v/redpanda/admin/debug.cc` (`cpu_profile`, `storage/disk_stat`, `controller_status`, `partition_leaders_table`, `is_node_isolated`, `refresh_disk_health_info`, `blocked_reactor_notify_ms`, `partition/…`), `partition.cc` (`/v1/partitions`, `majority_lost`, `force_recover_from_nodes`, decommission; `cancel_partition_reconfig_handler` + `force_set_partition_replicas_handler` controller/raft0 escape hatches — **v26.1.12**), `src/v/cluster/controller.cc` (`cancel_raft0_reconfiguration`, `force_raft0_reconfiguration`), `src/v/config/configuration.cc` (`partition_autobalancing_mode`, `raft_learner_recovery_rate`, `enable_rack_awareness`, `log_retention_ms`, `retention_bytes`, `raft_election_timeout_ms`), `src/v/config/node_config.cc` + `src/v/crash_tracker/limiter.cc` (`crash_loop_limit`, `crash_loop_sleep_sec`, `startup_log`, `crash_reports/`) | `modules/manage/pages/cluster-maintenance/{cluster-balancing,continuous-data-balancing,disk-utilization,decommission-brokers,nodewise-partition-recovery,partition-recovery}.adoc`, `modules/manage/pages/rack-awareness.adoc`, `modules/troubleshoot/pages/errors-solutions/`, `modules/reference/pages/public-metrics-reference.adoc` |
| `references/profiling-and-selftest.md` | `src/v/redpanda/admin/debug.cc` (`cpu_profile`, `sampled_memory_profile`, `storage/disk_stat/{data,cache}`, `controller_status`, `partition_leaders_table`, `local_storage_usage`, `cloud_storage_usage`, `blocked_reactor_notify_ms`, `log_backtrace`, `reset_leaders`, `partition/…`, `producers/…`, `refresh_disk_health_info`), `src/v/redpanda/admin/server.cc` (`register_self_test_routes`), self-test impl `src/v/cluster/self_test/{diskcheck,netcheck,cloudcheck,metrics}.h` + `src/v/cluster/self_test_frontend.h`, `self_test_backend.h` | `modules/reference/pages/rpk/rpk-cluster/rpk-cluster-self-test{,-start,-status,-stop}.adoc`, `modules/troubleshoot/partials/cluster-diagnostics.adoc`, `modules/troubleshoot/pages/cluster-diagnostics/` |
| `references/enterprise-features.md` | `src/v/config/configuration.cc` (`partition_autobalancing_*`, `core_balancing_continuous`/`_on_core_count_change`, `cloud_storage_*`, `cloud_topics_enabled`, `iceberg_*`, `default_leaders_preference`, `enable_rack_awareness`, `audit_*`, `enable_schema_id_validation`, `schema_registry_enable_authorization`), `src/v/config/node_config.cc` (`fips_mode`), license/enterprise gating `src/v/features/enterprise_features.h` + `src/v/cluster/feature_manager.cc`, Shadow Linking `src/v/cluster_link/` + `src/v/redpanda/admin/services/shadow_link/`, Iceberg `src/v/datalake/`, Cloud Topics `src/v/cloud_topics/` | property partials `modules/reference/partials/properties/{cluster-properties,topic-properties,object-storage-properties,topic-property-mappings}.adoc`; `modules/manage/partials/tiered-storage.adoc`, `remote-read-replicas.adoc`, `audit-logging.adoc`; `modules/manage/pages/iceberg/{about-iceberg-topics,iceberg-troubleshooting,use-iceberg-catalogs,specify-iceberg-schema}.adoc`; `modules/manage/pages/disaster-recovery/shadowing/{overview,setup,monitor,failover,failover-runbook}.adoc`; `modules/manage/pages/cluster-maintenance/{cluster-balancing,continuous-data-balancing}.adoc` |

## Deferred to live introspection (NOT drift — do not pin or hardcode)

- **Metric names** (`metrics.md`, `triage-playbooks.md`, `enterprise-features.md`, `SKILL.md` — e.g. `redpanda_kafka_under_replicated_replicas`, `redpanda_storage_disk_free_space_alert`, `redpanda_cloud_storage_*`, `redpanda_iceberg_*`, `redpanda_shadow_link_*`, `vectorized_*` internals): **release-specific.** Source them from the generated metrics docs (`public-metrics-reference.adoc` / `internal-metrics-reference.adoc`) or a live `GET /public_metrics` / `GET /metrics`, NOT a fixed source line. Metrics are only exported for features in use.
- **`rpk --help` / CLI flag output**: the shared bundle flags are pinned in `debugbundle/common.go`, but `--output`/`--upload-url`/`--timeout`/`--wait*` and other subcommand flags live in the individual `cmd`/`start.go`/`download.go` files and shift between releases. Prefer the auto-generated `rpk` reference pages at the target tag or live `--help`.
- **Live diagnostics output / JSON shapes** (`cpu_profile`, `disk_stat`, `controller_status`, `partition_leaders_table`, `self-test status`, `partition_balancer_status`, bundle file inventory): response schemas come from the Admin API at the target version; confirm against the swagger under `src/v/redpanda/admin/api-doc/` and live responses, not pinned text.
- **Enterprise state/status strings** (shadow link/topic/task states `ACTIVE|PAUSED|FAULTED|…`, balancer status `off|ready|starting|in-progress|stalled`, `redpanda.iceberg.mode` / `redpanda.storage.mode` value sets): verify against the source enums at the target ref.

## Naming note

Shadow Linking is the **user-facing** name; internally the broker module is
**`cluster_link`** / "cluster linking". Search the source for `cluster_link` and
`shadow_link`, not `shadow-link`. (Same convention as the `streaming` skill.)

## TODO / re-verify

- **Admin API endpoint paths** (`/v1/debug/*`, `/v1/partitions/*`, `/v1/cluster/partition_balancer/status`, `/v1/brokers/*`): route bodies are in `src/v/redpanda/admin/{debug,partition,server}.cc`; the canonical path + query-param definitions are in the swagger JSON under `src/v/redpanda/admin/api-doc/`. Cross-check with the `streaming-admin-api` skill.
- **`debug_bundle_auto_removal_seconds` scope** (`debug-bundle.md`): claim that it governs only remotely-triggered bundles is grounded in `debug_bundle.cc`; re-confirm the exact behavior at the target tag.
- **Crash-loop mechanics** (`triage-playbooks.md`): `crash_loop_limit`/`crash_loop_sleep_sec`, `startup_log`, and `crash_reports/` are owned by `src/v/crash_tracker/` (`limiter.cc`) reading `src/v/config/node_config.cc`; re-verify default `crash_loop_limit` (skill states `5`) and the 1-hour reset window against source.

## Usage

For each file being reviewed or updated, open the listed source paths first and confirm every
claim still matches. Verify against the current stable release tag of `redpanda-data/redpanda`;
prefer the generated metrics + `rpk` reference pages for names/flags, and re-confirm exact
endpoint paths, metric names, flag defaults, and status enums (all live-introspection items
above) before writing any new fact.
