# rpk-debug Skill Source Map

Maps each file in `skills/rpk-debug/` to the source paths it derives from, so future syncs and human maintainers know exactly where to verify claims.

The `rpk debug` command group is Go source in the **public** repo `redpanda-data/redpanda` under `src/go/rpk/pkg/cli/debug/`. The remote (cluster-wide) bundle is orchestrated through the Redpanda **Admin API**, whose server-side handler lives in the same repo under `src/v/redpanda/admin/`. The user-facing reference is in the **public** repo `redpanda-data/docs`. All are public — read them via the Redpanda-Github-Read MCP connector (`search_code`, `get_file_contents`), or `gh api .../contents/<path>` for verification; do not guess. `rpk` is versioned: verify against the **current stable release tag**, not `dev`/`main`.

## File-to-source table

| Skill file | redpanda source paths | docs sources |
|---|---|---|
| `SKILL.md` | `src/go/rpk/pkg/cli/debug/debug.go` (command group wiring), `debug/info.go` (hidden no-op `info`, `status` alias, backompat), `debug/bundle/` (`bundle.go`, `bundle_all.go`, `bundle_linux.go`, `bundle_k8s_linux.go`), `debug/remotebundle/` (`remote.go`, `start.go`, `status.go`, `download.go`, `cancel.go`), `debug/debugbundle/common.go`; enterprise config keys are broker config in `src/v/config/configuration.cc` (rpk only passes them through) | `modules/reference/pages/rpk/rpk-debug/rpk-debug.adoc`, `rpk-debug-bundle.adoc`, `rpk-debug-remote-bundle.adoc`, `rpk-debug-remote-bundle-{start,status,download,cancel}.adoc`; `modules/troubleshoot/pages/debug-bundle/` (`index.adoc`, `overview.adoc`, `inspect.adoc`, `configure/{index,linux,kubernetes}.adoc`, `generate/{index,linux,kubernetes}.adoc`); `modules/troubleshoot/pages/cluster-diagnostics/` |
| `references/bundle.md` | `src/go/rpk/pkg/cli/debug/bundle/bundle.go` (flags, output-path logic, `--cpu-profiler-wait`/`--metrics-samples` validation), `bundle_all.go` (Admin API snapshot set + rpadmin client method mapping, `kafka.json`, metrics scrapes), `bundle_linux.go` (Linux/bare-metal collectors: `utils/`, `proc/`, journald `redpanda.log`, controller logs, `data-dir.txt`), `bundle_k8s_linux.go` (Kubernetes detection via `KUBERNETES_SERVICE_HOST`/`_PORT`, `k8s/` manifests, per-pod logs), `bundle_test.go` | `modules/troubleshoot/pages/debug-bundle/generate/{linux,kubernetes}.adoc`, `configure/{linux,kubernetes}.adoc`, `inspect.adoc`; `modules/reference/pages/rpk/rpk-debug/rpk-debug-bundle.adoc` |
| `references/remotebundle.md` | `src/go/rpk/pkg/cli/debug/remotebundle/` (`remote.go` [group], `start.go` [`CreateDebugBundle`, `--wait`/`--job-id`, credential forwarding], `status.go` [`GetDebugBundleStatus`, `--format`, `job_id` JSON key], `download.go` [`DownloadDebugBundleFile`, ZIP-of-ZIPs layout, addr sanitization], `cancel.go` [`CancelDebugBundleProcess`]), `debug/debugbundle/common.go`; Admin API server side: `src/v/redpanda/admin/debug_bundle.cc`, `debug_bundle.h`, `debug.cc` | `modules/reference/pages/rpk/rpk-debug/rpk-debug-remote-bundle*.adoc`; `modules/troubleshoot/pages/debug-bundle/generate/index.adoc` |
| `references/enterprise-triage.md` | Bundle capture points in `src/go/rpk/pkg/cli/debug/bundle/bundle_all.go` (`admin/cluster_config.json`, `admin/license.json`, `admin/features.json`, `kafka.json`, per-node `admin/node_config_<addr>.json`, `partitions/cloud_*`); enterprise keys/topic properties defined in `src/v/config/configuration.cc` (rpk passes them through). Live triage commands: `src/go/rpk/pkg/cli/cluster/license/`, `src/go/rpk/pkg/cli/shadow/`, `src/go/rpk/pkg/cli/security/role/` + `security/acl/` | `modules/reference/partials/properties/cluster-properties.adoc`, `topic-properties.adoc`, `object-storage-properties.adoc` (citation of record for keys/defaults/accepted values); `modules/troubleshoot/pages/debug-bundle/inspect.adoc` |

## Deferred to live introspection (NOT drift — do not pin or hardcode)

- `rpk debug bundle --help` / `rpk debug remote-bundle <sub> --help` — the live flag set and defaults; verify against the current tag rather than trusting a static table.
- **Exact bundle file manifest** — the set of files/`admin/*.json` snapshots collected varies by version, environment (Linux vs Kubernetes), whether `--partition` was passed, and which Admin API endpoints succeed at collection time. `errors.txt` records per-step failures. Treat the manifest in `bundle.md` as representative, not exhaustive.
- `rpk debug remote-bundle status` values (`running`/`success`/`error`) and output columns — runtime state from the Admin API.
- Live-only enterprise triage: `rpk cluster license info`, `rpk shadow status`/`describe`/`list`, `rpk security role`/`acl list` — live cluster state.
- `--upload-url` presigned S3 URLs — provided by Redpanda Support at runtime.

## TODO / re-verify

- **Per-flag defaults** (`--logs-since=yesterday`, `--logs-size-limit=100MiB`, `--controller-logs-size-limit=132MB`, `--cpu-profiler-wait=30s`, `--metrics-samples=2`, `--metrics-interval=10s`, `--kafka-connections-limit=256`, `--wait-timeout=5m`) not each line-verified against flag registrations in `bundle/bundle.go` and `remotebundle/start.go` — re-check. Also re-confirm local `bundle` validates `--cpu-profiler-wait>=15s`/`--metrics-samples>=2` while `remote-bundle` passes them through.
- **rpadmin client method → file mapping** (e.g., `cl.Brokers`→`admin/brokers.json`, `cl.GetLicenseInfo`→`admin/license.json`, per-node `cl.RawNodeConfig`→`admin/node_config_<addr>.json`) not each line-verified against `bundle_all.go`.
- **Admin API endpoint names** (`CreateDebugBundle`, `GetDebugBundleStatus`, `DownloadDebugBundleFile`, `CancelDebugBundleProcess`) — verify against `src/v/redpanda/admin/debug_bundle.cc`/`.h` and the Go rpadmin client wrapper (`src/go/rpk/pkg/adminapi/`).
- **Enterprise config keys / topic-property values** (all of `enterprise-triage.md`) are broker config, not rpk. The docs property partials are the citation of record. `fips_mode` is set via the local `redpanda.yaml`; the `rpk node config set` spelling was corrected to `rpk redpanda config set` on 2026-07-07 (rpk has no `node` group).

## Redpanda Cloud applicability sources

The "Scope: Self-Managed Deployments Only" section in `SKILL.md` and the Cloud callouts in `references/bundle.md` / `references/remotebundle.md` derive from the **private** repo `redpanda-data/cloud-docs` (read via the Redpanda-Github-Read connector; do not clone):

- `modules/get-started/pages/cloud-overview.adoc`, "Redpanda Cloud vs Self-Managed feature compatibility": lists the Admin API, Redpanda debug bundles, `rpk debug`, `rpk cluster health`, `rpk cluster license`, `rpk cluster maintenance`, `rpk cluster partitions`, and `rpk cluster self-test` as unsupported in Redpanda Cloud.
- Supported client-side surface cited as the fallback: cloud-docs `modules/reference/pages/rpk/` documents `rpk-cluster` (info, logdirs-describe, quotas, txn, connections, config, storage), `rpk-group`, `rpk-registry`, `rpk-security`, `rpk-topic`, and `rpk-transform`; it has **no** `rpk-debug` pages.

## Usage

For each file being reviewed or updated, open the listed source paths first and confirm every claim still matches. Verify against the current stable release tag of `redpanda-data/redpanda`, and re-confirm exact command paths / flag names / defaults / config keys before writing any new fact.
