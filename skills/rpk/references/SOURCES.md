# rpk Skill Source Map

Maps each file in `skills/rpk/` to the source paths it derives from, so future syncs and
human maintainers know exactly where to verify claims.

The `rpk` CLI is Go source in the **public** repo `redpanda-data/redpanda` under
`src/go/rpk/`; the user-facing reference is auto-generated in the **public** repo
`redpanda-data/docs`. Both are public — read them via the Redpanda-Github-Read MCP
connector (`search_code`, `get_file_contents`), or `gh` for verification; do not guess.
Before writing or changing any fact, re-open the cited source and confirm exact command
paths, flag names, and config keys. `rpk` is versioned: verify against the **current
stable release tag**, not `dev`/`main` (unreleased commands are not yet user-facing).

Scope note: this map covers the core `rpk` skill. `rpk ai` (`src/go/rpk/pkg/cli/ai/`) is
**out of scope** — it belongs to the ADP skill (`skills/adp/references/rpk-ai.md`).

## File-to-source table

| Skill file | redpanda source paths | docs sources |
|---|---|---|
| `SKILL.md` | `src/go/rpk/pkg/cli/root.go`, `root_linux.go`, `root_darwin.go`, `src/go/rpk/pkg/cli/profile/`, `src/go/rpk/pkg/cli/cloud/`, `src/go/rpk/pkg/cli/cluster/license/`, `src/go/rpk/pkg/cli/shadow/`, `src/go/rpk/pkg/cli/security/role/`, `src/go/rpk/pkg/cli/topic/`, `src/go/rpk/pkg/cli/generate/license.go`, `src/go/rpk/pkg/config/params.go`, `rpk_yaml.go`, `redpanda_yaml.go` | `modules/get-started/pages/rpk-install.adoc`, `modules/get-started/pages/intro-to-rpk.adoc`, `modules/reference/pages/rpk/rpk-commands.adoc`, `modules/reference/pages/rpk/rpk-x-options.adoc`, `modules/reference/pages/rpk/rpk-profile/`, `rpk-cluster/`, `rpk-shadow/` |
| `references/command-map.md` | `src/go/rpk/pkg/cli/root.go`, `root_linux.go`, `root_darwin.go`, `deprecated.go`, `printtree.go`, `plugin_cmds.go`, and the command dirs `topic/`, `cluster/`, `group/`, `security/`, `cloud/`, `debug/`, `registry/`, `transform/`, `connect/`, `profile/`, `acl/`, `generate/`, `version/`, `container/`, `plugin/`, `benchmark/`, `shadow/`, `check/`, `redpanda/` (all under `src/go/rpk/pkg/cli/`), `src/go/rpk/pkg/config/params.go` | `modules/reference/pages/rpk/index.adoc`, `rpk-commands.adoc`, `rpk-help.adoc`, and per-group dirs under `modules/reference/pages/rpk/` (`rpk-topic/`, `rpk-cluster/`, `rpk-group/`, `rpk-security/`, `rpk-debug/`, `rpk-registry/`, `rpk-transform/`, `rpk-connect/`, `rpk-profile/`, `rpk-generate/`, `rpk-container/`, `rpk-plugin/`, `rpk-shadow/`, `rpk-redpanda/`, `rpk-version.adoc`) |
| `references/enterprise-features.md` | `src/go/rpk/pkg/cli/cluster/license/` (`info.go`, `set.go`, `license.go`), `src/go/rpk/pkg/cli/cluster/config/` (`set.go`, `get.go`), `src/go/rpk/pkg/cli/topic/create.go`, `topic/config.go`, `src/go/rpk/pkg/cli/shadow/`, `src/go/rpk/pkg/cli/security/role/`, `security/acl/`, `src/go/rpk/pkg/cli/generate/license.go`, `src/go/rpk/pkg/cli/redpanda/config.go`; enterprise **broker** config keys are defined in `src/v/config/configuration.cc` (rpk only passes them through) | `modules/reference/partials/properties/cluster-properties.adoc`, `topic-properties.adoc`, `object-storage-properties.adoc`, `modules/reference/pages/rpk/rpk-cluster/` (license/config subpages), `rpk-shadow/` |
| `references/install.md` | `src/go/rpk/pkg/cli/version/` (version-output format only). Release archives are GitHub release assets (`redpanda-data/redpanda/releases`) — no in-repo source path. | `modules/get-started/pages/rpk-install.adoc` |
| `references/profiles.md` | `src/go/rpk/pkg/cli/profile/` (`create.go`, `use.go`, `list.go`, `current.go`, `edit.go`, `set.go`, `set_globals.go`, `delete.go`, `rename.go`, `print.go`, `validate.go`, `clear.go`, `prompt.go`), `src/go/rpk/pkg/config/rpk_yaml.go` (profile + globals structs), `profile_doc.go`, `src/go/rpk/pkg/cli/cloud/` (`--from-cloud` resolution) | `modules/reference/pages/rpk/rpk-profile/`, `modules/get-started/pages/config-rpk-profile.adoc` |
| `references/x-flags-and-config.md` | `src/go/rpk/pkg/config/params.go` (all `-X` key constants, defaults struct, `XFlags()`, `XFlagYamlPath()`, `RPK_*` env mapping, `RPK_PROFILE`), `rpk_yaml.go` (globals), `redpanda_yaml.go` (the `rpk:` section of redpanda.yaml) | `modules/reference/pages/rpk/rpk-x-options.adoc` |

## Deferred to live introspection (NOT drift — do not pin or hardcode)

The skill deliberately points the agent at live introspection for these; a sync/audit
must not "correct" them into hardcoded values:

- `rpk -X list` / `rpk -X help` — dynamic output of `XFlags()`.
- `rpk <cmd> --help` — the live command tree; the skill directs users to introspect rather than trust a static list.
- `rpk --version` output — runtime value.
- Install versions / `latest` download URLs (`install.md`) — GitHub release state, intentionally not pinned.
- `rpk connect` subcommands/flags — a managed-plugin passthrough to the external Redpanda Connect binary, not defined in `redpanda-data/redpanda`; the skill flags "confirm with `rpk connect list --help`."

## TODO / re-verify

- **`rpk node` is not an rpk command** (resolved): rpk has no `node` command group. Node / `redpanda.yaml` properties — including `fips_mode` — are set via `rpk redpanda config set redpanda.<key>` (`src/go/rpk/pkg/cli/redpanda/config.go`, `NewConfigCommand` → `set`, which edits the local `redpanda.yaml`). The skill already documents this form; `rpk node config set` is a docs/Admin-API spelling, not an rpk command.
- **Enterprise cluster-config keys / topic properties** (accepted values, defaults) are broker config, not rpk. Treat the docs property partials (`cluster-properties.adoc`, `topic-properties.adoc`, `object-storage-properties.adoc`) as the citation of record; the upstream is `src/v/config/configuration.cc`.
- Per-`-X` default values in `x-flags-and-config.md` were not each line-verified against the `params.go` defaults struct — re-check individual defaults there.

## Usage

For each file being reviewed or updated, open the listed source paths first and confirm
every claim still matches. Verify against the current stable release tag of
`redpanda-data/redpanda`, and re-confirm exact command paths / flag names / config keys
before writing any new fact.
