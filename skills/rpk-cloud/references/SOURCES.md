# rpk-cloud Skill Source Map

Maps each file in `skills/rpk-cloud/` to the source paths it derives from, so future syncs
and human maintainers know exactly where to verify claims.

The `rpk cloud` command **CLI surface** is Go source in the **public** repo
`redpanda-data/redpanda` under `src/go/rpk/pkg/cli/cloud/` (plus supporting packages
`oauth/`, `publicapi/`, `config/`). The user-facing reference is auto-generated: the content
**partials** live in the **public** `redpanda-data/docs` repo under
`modules/reference/partials/rpk-cloud/`, and are single-sourced into stub **pages** in the
`redpanda-data/cloud-docs` repo under `modules/reference/pages/rpk/rpk-cloud/`. All are
public — read them via the Redpanda-Github-Read MCP connector (`search_code`,
`get_file_contents`) or `gh`; do not guess. `rpk` is versioned: verify against the **current
stable release tag** of `redpanda-data/redpanda`, not `dev`/`main` (unreleased commands are
not yet user-facing).

**Boundary note (important):** this skill documents the `rpk cloud` **CLI surface** only,
which is grounded in `redpanda-data/redpanda`. The Redpanda Cloud **control-plane / data-plane
semantics** it drives (BYOC provisioning internals, cluster/network/IAM APIs, the RPCs the MCP
server forwards) live in the private `cloudv2` repo and are owned by the Cloud skills
(`skills/cloud-*`). Broker-side config keys and topic properties for the enterprise features
(Iceberg, Cloud Topics, Tiered Storage) are defined in `redpanda-data/redpanda`
`src/v/config/configuration.cc` — rpk only passes them through. Do **not** duplicate those
semantics here; cite the Cloud skills / cloudv2 for them.

## File-to-source table

| Skill file | redpanda source paths (all under `src/go/rpk/pkg/`) | docs sources |
|---|---|---|
| `SKILL.md` | `cli/cloud/cloud.go`, `cli/cloud/login.go`, `cli/cloud/logout.go`; `cli/cloud/auth/` (`auth.go`, `list.go`, `use.go`, `delete.go`, `token.go`, and deprecated no-ops `create.go`, `rename.go`, `edit.go`); `cli/cloud/cluster/` (`cluster.go`, `select.go`); `cli/cloud/resourcegroup/` (`resourcegroup.go`, `create.go`, `list.go`, `delete.go`); `cli/cloud/byoc/` (`byoc.go`, `install.go`, `uninstall.go`); `cli/cloud/mcp/mcp.go`; supporting: `oauth/`, `publicapi/`, `config/rpk_yaml.go` | docs: `modules/reference/partials/rpk-cloud/rpk-cloud.adoc` (+ per-subcommand partials); cloud-docs: `modules/reference/pages/rpk/rpk-cloud/` (stub pages) |
| `references/login-and-auth.md` | `cli/cloud/login.go` (flags `--client-id/--client-secret/--no-browser/--save/--no-profile`, SSO vs client-credentials, `--save` secret persistence); `cli/cloud/logout.go` (`-c/--clear-credentials`, `-a/--all`); `cli/cloud/auth/` (`list.go`, `use.go`, `delete.go`, `token.go`; deprecated `create.go`/`rename.go`/`edit.go`); auth flow: `oauth/oauth.go`, `oauth/load.go`, `oauth/providers/auth0`, `oauth/authtoken`; `config/rpk_yaml.go` (`RpkCloudAuth` struct, `CloudAuths`, `CurrentCloudAuthOrgID`, `CurrentCloudAuthKind`), `config/config.go` (`DevOverrides`, `RPK_CLOUD_AUTH_URL`), `config/params.go` (`RPK_CLOUD_CLIENT_ID/SECRET`, `RPK_PROFILE`) | docs: `modules/reference/partials/rpk-cloud/rpk-cloud-login.adoc`, `rpk-cloud-logout.adoc`, `rpk-cloud-auth*.adoc` |
| `references/clusters-and-resourcegroups.md` | `cli/cloud/cluster/select.go` (alias `use`; `--serverless-network`, `--profile`; `--from-cloud` equivalence — cross-ref `cli/profile/create.go`); `cli/cloud/resourcegroup/` (`resourcegroup.go` aliases `namespace`/`ns`; `create.go`, `list.go`, `delete.go` `--no-confirm`); control-plane calls via `publicapi/controlplane.go` | docs: `modules/reference/partials/rpk-cloud/rpk-cloud-cluster-select.adoc`, `rpk-cloud-cluster.adoc`; `rpk-profile/rpk-profile-create.adoc` (`--from-cloud`, `--serverless-network`) |
| `references/byoc.md` | `cli/cloud/byoc/byoc.go` (provider subcommands `aws`/`gcp`/`azure` from downloaded plugin; common flags `--redpanda-id`, hidden `--cloud-api-token`, `RPK_CLOUD_SKIP_VERSION_CHECK`, sudo refusal), `cli/cloud/byoc/install.go` (SHA256 pinning, `ListArtifactsByRedpandaID`, up-to-date/success messages), `cli/cloud/byoc/uninstall.go`; `publicapi/enterprise.go`. Note: `apply`/`destroy`/`validate` are **plugin-provided** (not in this repo) | docs: `modules/reference/partials/rpk-cloud/rpk-cloud-byoc.adoc`, `rpk-cloud-byoc-install.adoc`, `rpk-cloud-byoc-uninstall.adoc` (no apply/destroy/validate pages — plugin surface) |
| `references/enterprise-data-features.md` | **CLI surface only:** Mountable Topics — `cli/cluster/storage/` (`storage.go`, `mount.go`, `unmount.go`, `list-mountable.go`, `list-mount.go`, `status-mount.go`, `cancel-mount.go`; `CheckFromCloud()` routing, kafka-namespace restriction, `CloudStorageService` RPCs). Iceberg / Cloud Topics / retention config set via `cli/cluster/config/set.go`,`get.go` and `cli/topic/` (`create.go`, `config.go`, alter-config). The **property definitions/defaults/accepted values are broker config**, not rpk → `src/v/config/configuration.cc` and the docs property partials | docs (property partials, source of record for values): `modules/reference/partials/properties/{cluster,topic,object-storage}-properties.adoc`; cloud-docs Iceberg/Cloud-Topics/Tiered-Storage feature pages. Cloud-side semantics: cloudv2 / Cloud skills |
| `references/rbac-and-iam.md` | **CLI/MCP surface only:** control-plane IAM services forwarded in `cli/cloud/mcp/mcp.go` (`iamv1mcp.*`: Organization, Permission, Role, RoleBinding, ServiceAccount, User, UserInvite) via `publicapi/controlplane.go`; data-plane forwarded (`dataplanev1mcp.*`: Security, ACL, User) via `publicapi/dataplane.go`; `--allow-delete` gating in `mcp.go`. Cluster-scope rpk commands: `cli/security/role/`, `security/acl/`, `security/user/`. Token: `cli/cloud/auth/token.go`. IAM/RBAC **semantics** = cloudv2 / Cloud skills | docs: `modules/reference/partials/rpk-cloud/rpk-cloud-auth-token.adoc`; `rpk-security/` pages; licensing `get-started/licensing/overview.adoc` |

MCP details verified in `cli/cloud/mcp/mcp.go`: subcommands `stdio` / `install` / `proxy`;
`--allow-delete` (default off; deletes blocked by name-match middleware); `install --client`
required, completion values `claude` / `claude-code`, writes `mcpServers.redpandaCloud` into
`claude_desktop_config.json` (macOS `~/Library/Application Support/Claude/…` via
`os.UserConfigDir()`) or `~/.claude.json` (claude-code); `proxy` requires `--mcp-server-id`
and one of `--cluster-id` / `--serverless-cluster-id`. Control-plane, IAM, data-plane, and
AI-Gateway (`aigatewayv1mcp.*`) services are all forwarded there.

## Deferred to live introspection (NOT drift — do not pin or hardcode)

- `rpk cloud <cmd> --help` — the live command tree; the skill directs users to introspect.
- **BYOC `apply` / `destroy` / `validate`** subcommands and their flags — provided by the **downloaded BYOC plugin** (version-pinned per cluster), not defined in `redpanda-data/redpanda`. Confirm with `rpk cloud byoc <aws|gcp|azure> --help` after install.
- **MCP server tool list / behavior** — the RPC set exposed by `rpk cloud mcp stdio` is generated from the cloud proto (`common-go` `*v1mcp` packages) and evolves; enumerate live rather than trusting a static list. `proxy` tool list is fetched at runtime from the remote server.
- Cloud cluster / resource-group / auth listings — runtime account state.
- BYOC plugin version / SHA256 and download URLs — control-plane state per cluster, intentionally not pinned.

## TODO / re-verify

- **Docs split:** rpk-cloud reference **content** lives in `redpanda-data/docs` `modules/reference/partials/rpk-cloud/`; the rendered **pages** are stubs in `redpanda-data/cloud-docs` `modules/reference/pages/rpk/rpk-cloud/`. The docs repo has **no** `modules/reference/pages/rpk/rpk-cloud/` dir — do not cite that path.
- **Auto-doc coverage gaps:** the generated partials do **not** include `rpk cloud resource-group`, `rpk cloud mcp proxy`, or BYOC `apply/destroy/validate`. Those facts in the skill are grounded in source (`cli/cloud/resourcegroup/`, `mcp/mcp.go`) not docs — re-verify against source, not docs.
- **`rpk cloud auth create/rename-to/edit`** are deprecated/hidden no-ops — confirm they still exist as no-ops (vs fully removed) at the target release tag.
- **Enterprise property values/defaults** (Iceberg modes, `redpanda.storage.mode`, retention keys) are **broker config**, not rpk. Source of record = docs property partials + `src/v/config/configuration.cc`; Cloud availability/semantics = cloudv2 / Cloud skills.
- Config field names: `rpk.yaml` uses `RpkCloudAuth` (Go) / `cloud_auth` (YAML). Re-check exact YAML keys (`current_cloud_auth_org_id`, `current_cloud_auth_kind`) in `config/rpk_yaml.go` at the target tag.
- All paths verified against the default branch (`dev`); re-confirm against the current stable release tag before writing new facts.

## Usage

For each file being reviewed or updated, open the listed source paths first and confirm every
claim still matches. Verify the CLI surface against the current stable release tag of
`redpanda-data/redpanda`; verify docs wording against the `redpanda-data/docs` partials.
Route any Cloud control-plane / data-plane **semantics** questions to the Cloud skills
(cloudv2) rather than documenting them here. Re-confirm exact command paths, flag names, and
config keys before writing any new fact.
