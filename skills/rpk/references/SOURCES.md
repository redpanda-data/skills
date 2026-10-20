# rpk Skill Source Map

Maps each file in `skills/rpk/` to the source paths it derives from, so future syncs and
human maintainers know exactly where to verify claims.

The `rpk` CLI is Go source in the **public** repo `redpanda-data/redpanda` under
`src/go/rpk/`; the user-facing reference is auto-generated in the **private** repo
`redpanda-data/docs`. Read them via the Redpanda-Github-Read MCP
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
| `references/enterprise-features.md` | `src/go/rpk/pkg/cli/cluster/license/` (`info.go`, `set.go`, `license.go`), `src/go/rpk/pkg/cli/cluster/config/` (`set.go`, `get.go`), `src/go/rpk/pkg/cli/topic/create.go`, `topic/config.go`, `src/go/rpk/pkg/cli/shadow/` (`update.go` — full-configuration replace + `--config-file`; `types.go` — config sections incl. `role_sync_options`, and `AuthenticationConfiguration` = SASL/PLAIN | SASL/SCRAM only), `src/v/cluster/cluster_link/frontend.cc` + `src/v/features/enterprise_features.h` (the Enterprise license is gated on `enable_shadow_linking`, set on the shadow cluster), `src/go/rpk/pkg/cli/security/role/`, `security/acl/`, `src/go/rpk/pkg/cli/generate/license.go`, `src/go/rpk/pkg/cli/redpanda/config.go`; enterprise **broker** config keys are defined in `src/v/config/configuration.cc` (rpk only passes them through) | `modules/reference/partials/properties/cluster-properties.adoc`, `topic-properties.adoc`, `object-storage-properties.adoc`, `modules/reference/pages/rpk/rpk-cluster/` (license/config subpages), `rpk-shadow/` |
| `references/install.md` | `src/go/rpk/pkg/cli/version/` (version-output format only). Release archives are published at `https://rpk.redpanda.com/<release>/` — no in-repo source path; the published file layout (per-platform archive names, the `latest` alias, the checksums files) is documented in the repo's own `README.md`, section "rpk binaries". | `modules/get-started/pages/rpk-install.adoc` + the partials it includes: `modules/get-started/partials/install-rpk-linux.adoc`, `install-rpk-macos.adoc`, `install-rpk-apple-silicon.adoc`, `install-rpk-intel-macos.adoc`, `install-rpk-homebrew.adoc` |
| `references/profiles.md` | `src/go/rpk/pkg/cli/profile/` (`create.go`, `use.go`, `list.go`, `current.go`, `edit.go`, `set.go`, `set_globals.go`, `delete.go`, `rename.go`, `print.go`, `validate.go`, `clear.go`, `prompt.go`), `src/go/rpk/pkg/config/rpk_yaml.go` (profile + globals structs), `profile_doc.go`, `src/go/rpk/pkg/cli/cloud/` (`--from-cloud` resolution) | `modules/reference/pages/rpk/rpk-profile/`, `modules/get-started/pages/config-rpk-profile.adoc` |
| `references/x-flags-and-config.md` | `src/go/rpk/pkg/config/params.go` (all `-X` key constants, defaults struct, `XFlags()`, `XFlagYamlPath()`, `RPK_*` env mapping, `RPK_PROFILE`), `rpk_yaml.go` (globals), `redpanda_yaml.go` (the `rpk:` section of redpanda.yaml) | `modules/reference/pages/rpk/rpk-x-options.adoc` |

## Deferred to live introspection (NOT drift — do not pin or hardcode)

The skill deliberately points the agent at live introspection for these; a sync/audit
must not "correct" them into hardcoded values:

- `rpk -X list` / `rpk -X help` — dynamic output of `XFlags()`.
- `rpk <cmd> --help` — the live command tree; the skill directs users to introspect rather than trust a static list.
- `rpk --version` output — runtime value.
- Install versions / `latest` download URLs (`install.md`) — resolved by the `latest` alias on the download host, intentionally not pinned. The skill names a version only as a `<version>` placeholder.
- `rpk connect` subcommands/flags — a managed-plugin passthrough to the external Redpanda Connect binary, not defined in `redpanda-data/redpanda`; the skill flags "confirm with `rpk connect list --help`."

## TODO / re-verify

- **Where releases are published (verified 2026-10-20).** `v26.2.2` is the last
  Redpanda release published as a GitHub Release, and the public repo carries no
  tag or branch head for the releases after it — its `v26.2.x` branch head is
  still the `v26.2.2` release commit. The user-facing changelog for `v26.2.3`
  and later is `modules/reference/pages/releases/redpanda.adoc` in the private
  `redpanda-data/docs` repo, and rpk binaries are distributed from
  `https://rpk.redpanda.com/` rather than GitHub release assets. Consequence for
  verification: an rpk behavior introduced in `v26.2.3` or later **cannot** be
  confirmed against Go source in the public repo. Confirm it against the
  generated rpk reference under `modules/reference/pages/rpk/` (regenerated per
  release from the shipped binary's `--help`) or a live binary of the target
  release; if neither reflects it, record it here as a TODO instead of writing
  it into a skill.
- **`-v` configuration provenance** (`x-flags-and-config.md`, added for
  `v26.2.3`): the claim that `-v` reports the loaded config files, the selected
  profile and what selected it, overriding `RPK_*`/`-X` values, and that secrets
  are never logged, is grounded in the release notes for `v26.2.3` only — the
  generated rpk reference still describes `-v` as "Enable verbose logging", and
  the public Go source is frozen before that release (see above). Re-confirm
  the exact log lines against a live `rpk -v` run and sharpen or trim this note.
- **`rpk node` is not an rpk command** (resolved): rpk has no `node` command group. Node / `redpanda.yaml` properties — including `fips_mode` — are set via `rpk redpanda config set redpanda.<key>` (`src/go/rpk/pkg/cli/redpanda/config.go`, `NewConfigCommand` → `set`, which edits the local `redpanda.yaml`). The skill already documents this form; `rpk node config set` is a docs/Admin-API spelling, not an rpk command.
- **Enterprise cluster-config keys / topic properties** (accepted values, defaults) are broker config, not rpk. Treat the docs property partials (`cluster-properties.adoc`, `topic-properties.adoc`, `object-storage-properties.adoc`) as the citation of record; the upstream is `src/v/config/configuration.cc`.
- **Per-`-X` default values** (resolved): there is **no defaults struct** in `params.go`. The
  `xflag` struct is `{path, testExample, kind, parse}` — the second string is a *test example*,
  not a default, and must never be read as one. Authoritative default sources are, per key:
  - address defaults (`brokers`, `admin.hosts`, `registry.hosts`) — `params.go`, which fills
    `127.0.0.1:{DefaultKafkaPort,DefaultAdminPort,DefaultSchemaRegPort}`;
  - `globals.command_timeout` — `rpk_yaml.go` `RpkGlobals.GetCommandTimeout()`;
  - `globals.dial_timeout` / `request_timeout_overhead` / `retry_timeout` / `fetch_max_wait` /
    `kafka_protocol_request_client_id` — `src/go/rpk/pkg/kafka/client_franz.go`, where rpk
    applies its own `kgo.*` options (an unset global means rpk's value stands; a key rpk does
    not set falls through to the franz-go default);
  - `globals.prompt`, `globals.no_default_cluster` — zero values; `RpkGlobals` sets no default.
  `ParamsHelp()` (`rpk -X help`) states the address defaults in prose and is a good cross-check.

## Usage

For each file being reviewed or updated, open the listed source paths first and confirm
every claim still matches. Verify against the current stable release tag of
`redpanda-data/redpanda`, and re-confirm exact command paths / flag names / config keys
before writing any new fact.
