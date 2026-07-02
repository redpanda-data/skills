# streaming-admin-api Skill Source Map

Maps each file in `skills/streaming-admin-api/` to the source paths it derives from, so future
syncs and human maintainers know exactly where to verify claims.

The `streaming-admin-api` skill documents the Redpanda **Admin API** — the HTTP management
interface served on **port 9644** (base path `/v1`) plus the ConnectRPC services added in
v25.3. Source of truth is the Admin API server, request handlers, and Swagger 1.2 / OpenAPI
JSON specs in the **public** repo `redpanda-data/redpanda` under `src/v/redpanda/admin/`
(server is C++; the API surface is described by the `api-doc/*.json` specs and the ConnectRPC
`.proto` files). Cluster-config property claims are grounded in the auto-generated partial in
the **public** repo `redpanda-data/docs`. Both repos are public — read them via the
Redpanda-Github-Read MCP connector (`get_file_contents`, `search_code`), or `gh api` for
verification.

**Property grounding:** all cluster-config property claims (types, defaults, `needs_restart`,
visibility, enum values) are grounded in the auto-generated partial
`modules/reference/partials/properties/cluster-properties.adoc`, regenerated per release; its
upstream source of truth is `src/v/config/configuration.cc`. Node-config keys (e.g. the Admin
API listener `admin_api`, `admin_api_tls`) come from `src/v/config/node_config.cc`. Do not pin
property defaults to hardcoded values. The Admin API is versioned: verify against the
**current stable release tag** of `redpanda-data/redpanda`, not `dev`/`main`. (Endpoint
availability and ConnectRPC services are version-gated — v25.3+ for the `redpanda.core.admin.v2`
services.)

## File-to-source table

| Skill file | redpanda source paths | docs sources |
|---|---|---|
| `SKILL.md` | `src/v/redpanda/admin/server.cc`, `server.h` (auth_level enum), `api-doc/*.json` (all specs), `cluster_config_schema_util.cc`, `src/v/config/configuration.cc`, `src/v/config/node_config.cc` (`admin_api`, `admin_api_tls`) | `modules/manage/pages/use-admin-api.adoc`, `modules/reference/pages/api-reference.adoc`, `modules/reference/partials/properties/cluster-properties.adoc` |
| `references/endpoints-overview.md` | `src/v/redpanda/admin/api-doc/`: `broker.json`, `partition.json`, `cluster.json`, `cluster_config.json` (+`cluster_config.def.json`), `features.json`, `security.json`, `transaction.json`, `shadow_indexing.json` (+`.def.json`), `debug.json`, `debug_bundle.json` (+`.def.json`); handlers `partition.cc`, `transaction.cc`, `security.cc`, `debug.cc`, `debug_bundle.cc`, `recovery.cc`, `services/broker.cc`, `services/cluster.cc`, `services/features.cc`; ConnectRPC `proto/redpanda/core/admin/v2/*.proto` + `src/v/redpanda/admin/services/` | `modules/reference/pages/api-reference.adoc`, `modules/manage/pages/use-admin-api.adoc` |
| `references/auth-and-connection.md` | `src/v/redpanda/admin/server.h` (`enum class auth_level { publik=0, user, superuser }`; note: `authenticated` in docs = enum `user`/`require_authenticated`), `server.cc`, `src/v/config/node_config.cc` (`admin_api`, `admin_api_tls`, `admin_api_doc_dir`); ConnectRPC `proto/redpanda/core/admin/v2/` | `modules/manage/pages/use-admin-api.adoc`, `modules/manage/pages/security/authentication.adoc`, `listener-configuration.adoc`, `encryption.adoc` |
| `references/brokers-and-partitions.md` | `src/v/redpanda/admin/api-doc/broker.json`, `partition.json`, `cluster.json`, `debug.json` (`force_replicas`); `src/v/redpanda/admin/partition.cc` (incl. `cancel_partition_reconfig_handler` + `force_set_partition_replicas_handler` controller/raft0 escape hatches, `evil_mode` — **v26.1.12**), `src/v/cluster/controller.cc` (`cancel_raft0_reconfiguration`, `force_raft0_reconfiguration`), `services/broker.cc`/`.h`, `services/cluster.cc`/`.h` | `modules/manage/pages/node-management.adoc`, `modules/manage/pages/cluster-maintenance/decommission-brokers.adoc`, `rolling-restart.adoc`, `partition-recovery.adoc`, `nodewise-partition-recovery.adoc`, `cluster-balancing.adoc`, `raft-group-reconfiguration.adoc` |
| `references/cluster-config.md` | `src/v/redpanda/admin/api-doc/cluster_config.json` (+`cluster_config.def.json`), `src/v/redpanda/admin/cluster_config_schema_util.cc`/`.h`, `src/v/config/configuration.cc` | `modules/manage/pages/cluster-maintenance/cluster-property-configuration.adoc`, `node-property-configuration.adoc`, `modules/reference/partials/properties/cluster-properties.adoc` |
| `references/debug-endpoints.md` | `src/v/redpanda/admin/api-doc/debug.json`, `debug_bundle.json` (+`.def.json`); `src/v/redpanda/admin/debug.cc`, `debug_bundle.cc`/`.h` | `modules/troubleshoot/pages/cluster-diagnostics/diagnose-issues.adoc`, `modules/troubleshoot/pages/debug-bundle/` (`overview.adoc`, `generate/`, `configure/`, `inspect.adoc`) |
| `references/enterprise-features.md` | `src/v/config/configuration.cc` (enterprise keys: `cloud_storage_*`, `cloud_topics_*`, `iceberg_*`, `partition_autobalancing_*`, `core_balancing_*`, `audit_*`, `enable_schema_id_validation`, `default_leaders_preference`, `sasl_mechanisms`, `oidc_*`, `sasl_kerberos_*`), `src/v/config/node_config.cc` (`fips_mode`); `src/v/redpanda/admin/api-doc/shadow_indexing.json`, `features.json`, `security.json`; `src/v/redpanda/admin/cluster_recovery.cc`, `recovery.cc`, `security.cc`, `services/features.cc`; ConnectRPC `proto/redpanda/core/admin/v2/shadow_link.proto` + `src/v/redpanda/admin/services/shadow_link/`; license gating `src/v/features/enterprise_features.cc`/`.h`, `enterprise_feature_messages.h` | `modules/manage/pages/tiered-storage.adoc`, `remote-read-replicas.adoc`, `mountable-topics.adoc`, `audit-logging.adoc`, `modules/manage/pages/iceberg/`, `modules/manage/pages/disaster-recovery/shadowing/`, `topic-recovery.adoc`, `whole-cluster-restore.adoc`, `modules/manage/pages/cluster-maintenance/continuous-data-balancing.adoc`, `modules/manage/pages/security/authorization/rbac.adoc`, `gbac.adoc`, `modules/manage/pages/security/fips-compliance.adoc`, `modules/develop/pages/manage-topics/cloud-topics.adoc`, `modules/get-started/pages/licensing/disable-enterprise-features.adoc`, `overview.adoc`, `modules/reference/partials/properties/cluster-properties.adoc`, `topic-properties.adoc` |

## Deferred to live introspection (NOT drift — do not pin or hardcode)

- **Endpoint response payloads / exact JSON field sets** (e.g. `broker`, `decommission_status`, `partition_state`, `cpu_profile_result`, `cluster_health_overview`): read the `*.def.json` model definitions at the target ref, or the live Admin API. The example JSON bodies in the skill are illustrative and version-specific.
- **Per-version endpoint availability** (which paths/methods exist in a given release): source from the live Admin API — the served Swagger at `GET /v1/` / the `api-doc/*.json` at the target tag — not a fixed list. New ConnectRPC services (`redpanda.core.admin.v2.*`) are v25.3+.
- **ConnectRPC message shapes** (ShadowLinkService `CreateShadowLink`, `FailOver`, nested `ShadowLinkConfigurations`): the authoritative structure is `proto/redpanda/core/admin/v2/shadow_link.proto` at the target ref, or the generated SDK. Field names drift; verify against the proto.
- **Self-test request body** (`{"tests":[...]}`): not modeled in `api-doc/debug.json`; derived from `rpk` + cluster source. Confirm against `debug.cc` / live behavior.
- **`upsert` value coercion** (`cluster-config.md`): Swagger declares `additionalProperties: {type: string}` but the server coerces JSON scalars — behavior; verify against handler.

## Naming note

The auth-level enum in `server.h` uses `publik` (not a typo — `public` is a C++ keyword) for
the unauthenticated level, `user` for the authenticated level, and `superuser`. The skill's
"authenticated" maps to enum `user` (`require_authenticated()`). Shadow Linking is the
user-facing name; the ConnectRPC service is `redpanda.core.admin.v2.ShadowLinkService` and the
broker-side module is `cluster_link` — search source for `shadow_link` and `cluster_link`.

## TODO / re-verify

- **Current stable release line:** as of verification `redpanda-data/redpanda` was tagging the v26.x line; ConnectRPC references in the skill are labeled "v25.3+". Re-confirm the ConnectRPC service set and paths against the current stable tag (verified above against `dev`).
- **Security users vs roles specs:** `security.json` covers both SASL users (`/v1/security/users*`) and RBAC roles (`/v1/security/roles*`); the exact nicknames were not pinned to a line — confirm against `security.json` + `security.cc`.
- **`kafka_connections` ConnectRPC:** `proto/redpanda/core/admin/v2/kafka_connections.proto` + `src/v/redpanda/admin/kafka_connections_service*.{h,cc}` back the "connected-client monitoring" claim; verify if expanded.

## Usage

For each file being reviewed or updated, open the listed source paths first and confirm every
claim still matches. Verify against the current stable release tag of `redpanda-data/redpanda`
(not `dev`/`main`); prefer the `api-doc/*.json` specs and `*.def.json` models for endpoint/schema
facts, the generated `cluster-properties.adoc` partial for cluster-config property facts, and
the `.proto` files for ConnectRPC message shapes. Re-confirm exact paths, methods, and property
keys before writing any new fact; treat response payloads and per-version endpoint availability
as live-introspection items, not pinned constants.
