Source: `cloudv2 apps/rpai/testdata/commands-snapshot.md` (golden help, including the `rpk ai`-mode root help), `cloudv2 apps/rpai/internal/cmd/` (incl. `docs/`), `apps/rpai/internal/{gitops,updatecheck,client}/`, `apps/rpai/.goreleaser.yaml` (platforms), `cloudv2 adp/RELEASE_NOTES.md` (shipped status), `redpanda/src/go/rpk/pkg/cli/ai/`, `adp-docs modules/cli/pages/index.adoc`. Full per-claim mapping and the dated verification log: the `references/rpk-ai.md` rows (now `cli.md` and `coding-tools.md`) of `SOURCES.md`.

# rpk ai CLI Reference

**Maturity:** GA, but command groups and flags change between releases — confirm them with `--help` before relying on them.

## Discover the live surface

The command tree below is a point-in-time summary. Confirm what the installed CLI offers before acting:

```bash
rpk ai --help                 # all command groups and global flags
rpk ai agent --help
rpk ai mcp-server --help
rpk ai llm-provider --help
rpk ai llm-provider create --help -o json   # machine-readable flag schema (fields, enums, groups)
```

Always prefer live `--help` output over this document when they disagree.

## What `rpk ai` is

`rpk ai` is the Redpanda AI command-line interface, delivered as an rpk managed plugin: rpk downloads and manages the underlying `rpai` binary, and you invoke it as `rpk ai`. The lifecycle commands below belong to `rpk` itself, not to the plugin.

## Lifecycle management (rpk-side commands)

`rpk ai install` (`--ai-version`, default `latest`; `--force`), `rpk ai upgrade` (`--no-confirm`) and `rpk ai uninstall` manage the plugin, which lands at `~/.local/bin/.rpk.managed-rpai`. macOS, Linux and Windows on amd64 and arm64 are published; **there is no FIPS build**, so a FIPS-only environment cannot install a FIPS-validated `rpk ai`.

**The CLI announces its own updates.** A background check, at most once a day, prints a notice on **stderr** naming a newer version and the command that upgrades it, including after a command that failed or printed help. It never delays a command, and it appears only when **both** stdout and stderr are terminals — so a script, a pipe, an `-o json` capture and an agent never see it — and never in continuous integration. `RPAI_NO_UPDATE_CHECK=1` turns it off.

## Authentication

`rpk ai` owns its own credentials and Agentic Data Plane environment selection; it does not ride the active `rpk cloud` session. Sign in and pick a target:

```bash
rpk ai auth login              # OAuth device-authorization flow
rpk ai env list                # live ADP environments (NAME and ID) + local manual environments
rpk ai env use <environment>   # select the environment whose AI Gateway becomes the active target
rpk ai auth status             # show the current token state
```

`rpk ai auth login` runs the OAuth 2.0 device-authorization grant against Redpanda Cloud and caches the credentials in `~/.rpai/credentials` (mode `0600`). `rpk ai env use <environment>` selects the environment whose AI Gateway URL becomes the active target. `rpk ai env show` prints the resolved environment as YAML (tokens redacted).

**`login` always runs the device flow.** Every `rpk ai auth login` forces a fresh grant and replaces the stored credentials for the organization, even when the current token has time left, so a revoked session cannot leave `rpk ai` insisting you are logged in. **Without `--env`**, re-authenticating keeps the current environment: an unchanged organization re-confirms the cached selection without prompting, and a manual environment is left alone. For a conditional login in a script, guard the call yourself:

```bash
rpk ai auth status -o json | jq -e .logged_in >/dev/null || rpk ai auth login
```

**`--no-browser`.** `rpk ai auth login --no-browser` prints the verification URL without opening a browser — for a headless host, an SSH session, or a container. On a Linux host with no `$DISPLAY` / `$WAYLAND_DISPLAY` the CLI skips the browser automatically.

**`--env` picks the environment without prompting.** `rpk ai auth login --env <name-or-id>` selects the ADP environment after sign-in instead of opening the interactive picker. It is the flag for a script, a CI job or a coding agent: with no terminal to prompt in, a plain `login` fails once the organization has more than one environment. `--env` **replaces** the current selection, including a manual environment that a plain login would preserve. When the value matches nothing, or the environment has no AI Gateway URL yet, login fails *after* signing in and **keeps the new credentials** — finish with `rpk ai env use <name>` rather than logging in again. `rpk ai env list` prints the `ID` column that both `--env` and `env use` accept, in every output format.

`auth` subcommands: `login`, `logout` (current organization, or `--all` for a clean slate), `status`, `token` (print the current bearer token, refreshing if expired).

Environment auth modes are `device|rpk|token|none` (default `device`):

| Mode | Behavior |
|------|----------|
| `device` | OAuth device-authorization flow (default); credentials cached in `~/.rpai/credentials` |
| `rpk` | Reuse the `rpk cloud` token from `rpk.yaml`; a selectable fallback, not the primary path |
| `token` | Static bearer token passed with `--token` |
| `none` | No Authorization header; for a local or unauthenticated AI Gateway |

Define a local or manual gateway with `rpk ai env add <name> --ai-gateway-url <url> --auth-mode none`.

For headless or CI use, pass `--token <bearer>` on the command line. Under `rpk ai` the ambient `RPAI_TOKEN` environment variable is **ignored**; only the flag works.

**A sign-in is not a client credential.** It authenticates the management commands; the gateway's own traffic is authenticated by an **ADP API key** (see API keys in `/redpanda:adp-governance` and [The session credential is an ADP API key](coding-tools.md#the-session-credential-is-an-adp-api-key)).

## Global flags (under `rpk ai`)

Running as an rpk plugin, the long flags that would collide with rpk's own globals are renamed, and short flags are unchanged throughout. The renamed four are `--rpai-environment` (select a manual environment for this invocation), `--rpai-config` (`-c`, `RPAI_CONFIG`, default `$HOME/.rpai/config`), `--rpai-verbose` (`-v`, `RPAI_VERBOSE`) and `--rpai-endpoint` (`-s`, override the environment's AI Gateway URL for this invocation). The rest keep their names: `--token`, `--format` (`-o`, `RPAI_FORMAT`, default `table`, one of `table|wide|json|yaml|markdown`) and `--no-color` (`NO_COLOR`).

`--rpai-endpoint` has no environment-variable binding, so it can never silently override the environment chosen with `rpk ai env use`; it takes effect only when passed for a single invocation.

**`--rpai-verbose` logs requests, not payloads.** Every HTTP request the CLI makes gets one stderr line carrying the method, URL, response status, and latency — enough to see which endpoint a command called and how long it took. Request and response bodies, headers, and your bearer token never appear, so the output is safe to attach to a support ticket. `RPAI_VERBOSE` turns it on for the whole session; any value other than `0`, `false`, `no`, or `off` counts as on. The device-code exchange during `rpk ai auth login` is not logged.

## Top-level command tree

| Command | Aliases | Notes |
|---------|---------|-------|
| `agent` | `agents` | Manage agents (managed and self-managed) |
| `agent-kill-switch` | (none) | Inspect, set or release one agent's containment (see `agent-kill-switch` in `/redpanda:adp-governance`) |
| `agent-network` | (none) | Query agent relationships and provider failures: `get`, `node`, `provider-failures` (read-only) |
| `api-key` | `api-keys` | Manage API keys (see `api-key` in `/redpanda:adp-governance`) |
| `auditlog` | `audit-log`, `audit` | Read the audit log: `list`, `get`, `query` (read-only; see `/redpanda:adp-observability`, *Read the audit log from the CLI*) |
| `auth` | (none) | `login`, `logout`, `token`, `status` |
| `budget` | `budgets` | Manage budgets that cap agent spend (see `budget` in `/redpanda:adp-governance`) |
| `completion` | (none) | Generate a shell autocompletion script |
| `connection` | `connections`, `conn` | Manage your own OAuth connections: `list`, `revoke <provider-name>` |
| `docs` | (none) | Read the published ADP documentation from the terminal; needs no sign-in (see [`docs`](#docs-read-the-product-documentation)) |
| `doctor` | (none) | Diagnose local setup without changing anything (see [`rpk ai doctor`](#rpk-ai-doctor)) |
| `effective-policy-set` | (none) | Inspect the authorization policy snapshot in force (read-only) |
| `env` | `environment` | Manage environments: `add`, `list`, `use`, `show`, `rename`, `delete` |
| `guardrail` | `guardrails` | Manage guardrails (see `guardrail` in `/redpanda:adp-governance`) |
| `ingest-feedback` | (none) | `summary`: telemetry the ingestion pipeline dropped, and why (read-only) |
| `kill-switch-policy` | `kill-switch-policies`, `ksp`, `kill-switch` | Manage an agent's kill switch policies (see `kill-switch-policy` in `/redpanda:adp-governance`) |
| `llm-provider` | `llm-providers`, `llm`, `provider`, `lp` | Manage LLM providers; `types` lists the supported types |
| `mcp-server` | `mcp-servers`, `mcp` | Manage MCP servers |
| `model` | `models`, `m` | Discover models in the catalog (read-only) |
| `oauth-client` | `oauth-clients`, `oc` | Manage OAuth clients; also `dcr`, `cimd` and `catalog` |
| `oauth-provider` | `oauth-providers`, `oauth`, `op` | Manage OAuth providers; also `catalog` and `discover` |
| `policy` | `policies`, `pol` | Manage Cedar authorization policies, and check a draft without saving |
| `policy-template` | `policy-templates` | Manage policy templates that policies link to |
| `run` | (none) | Launch Claude Code, Codex or Antigravity CLI routed through the AI Gateway |
| `secret` | `secrets`, `sec` | Manage the secrets other resources reference by ID (see `secret` in `/redpanda:adp-governance`) |
| `session` | (none) | Inspect, rename or delete a managed agent's conversation sessions |
| `spending` | (none) | Query cost and usage: `summary`, `breakdown`, `time-series`, `time-series-by-dimension`, `tag-keys` (read-only) |
| `system-policy` | (none) | `list` and `action-groups`: the read-only policies Redpanda compiles from role bindings |
| `trace` | (none) | Read traces of agent runs and gateway calls: `list`, `get`, `span` (read-only; see `/redpanda:adp-observability`, *Read traces from the CLI*) |
| `trigger` | `triggers`, `agent-trigger` | Manage an agent's triggers (top-level, not under `agent`) |
| `version` | (none) | Print version and commit |

Newer releases keep adding groups — everything from `agent-kill-switch` through `trace` in this table arrived that way. Before you tell a user a task is UI-only, check `rpk ai --help`, and read that group's own `--help` instead of guessing its flags.

## `rpk ai version`

`rpk ai version` prints `rpai <version> (<commit>)` and works without an environment or config. The root `--version` flag exists for `rpk ai upgrade`'s version probe; use the `version` command for version information.

## `rpk ai doctor`

`rpk ai doctor` reports on local setup and changes nothing — it writes no files, signs nobody in and selects no environment. **Reach for it first on a broken setup**, because it loads the configuration itself instead of going through the normal startup path, so a config that other commands reject outright is reported here rather than failing the command. It checks the configuration, the environment selection, authentication, AI Gateway connectivity and whether a newer CLI release is published, printing each as `[status] id: message` with a fix and a `Run:` command where it has one (`--json`, or `-o json` / `-o yaml`, returns the same report structured). **It exits non-zero only on an `error` check**, so warnings still pass a script that gates on the exit code: a selected environment that cannot be resolved is an `error`, while no environment selected at all is only a `warn`.

```bash
rpk ai doctor
rpk ai doctor --offline       # skip the gateway probe and the release lookup
rpk ai doctor --timeout 10s   # per network check; default 3s, maximum 30s
```

- **An authentication `pass` does not mean the server accepts the credential.** That check reads local state only — whether stored credentials, a stored API key or a static token exist and have not expired. A green authentication line with a refused request is a permissions problem, not a login problem (see [Exit codes](#exit-codes)).
- **Connectivity is an unauthenticated probe** of the environment's AI Gateway URL, so it establishes reachability and nothing more. It is skipped under `--offline`, when a tunnel is configured, and when the gateway URL carries credentials, a query or a fragment; it warns on a redirect, a `429`, a `5xx`, and when TLS verification is disabled for the environment.

## `agent` subcommands

Aliases: `agents`.

CRUD and lifecycle: `create`, `get`, `list`, `update`, `delete`, `start`, `stop`, `apply`, `diff`. `create` makes a managed agent by default; pass `--self-managed` for a metadata-only record of an agent you host yourself, or `--policy-template <template>` to bind the agent's first access policy in the same command (see `/redpanda:adp-governance`, *Give a new agent access*).

**`credential`** (aliases: `credentials`, `cred`): `create <agent>`, `list <agent>`, `delete <name>` — client-ID/secret pairs an agent uses to authenticate against the gateway.

**`transcript`** (aliases: `transcripts`, `tr`): `list <agent>`, `get <agent> <conversation-id>`.

**`a2a`** — talk to a running agent over A2A. The target is a registered agent name or a full `http(s)://` A2A endpoint URL:
- `card <agent|url>` — fetch the A2A agent card
- `send <agent|url> [message]` — flags: `--context-id`, `--task-id`, `--stream`, `--no-block`, `--timeout` (default 5m; `0` waits forever)
- `task get|cancel|watch <agent|url> <task-id>` (`watch` alias: `resubscribe`)

Your bearer token is attached only for a registered agent or a URL on the environment's dataplane host; other hosts are called without credentials (a note on stderr says so). Exit codes: `0` success (including a task waiting for input), `4` task ended failed/canceled/rejected, `3` an authentication or authorization failure, `1` anything else (see [Exit codes](#exit-codes)).

## `env` subcommands

Subcommands: `add` (alias `create`), `list`, `use`, `show`, `rename`, `delete`. All work without a config or signed-in session. `add`, `rename`, and `delete` act on manual (local) environments; `use` switches to a manual environment or selects an ADP environment by name or ID.

## `llm-provider` subcommands

Aliases: `llm-providers`, `llm`, `provider`, `lp`.

Subcommands: `create`, `get`, `list`, `update`, `delete`, `check` (connectivity check), `apply`, `diff`.

`create` takes the provider name as a **positional argument** and has no `--type` or `--name` flag. The provider type is selected by which provider-config flag group you set — `openai-config`, `anthropic-config`, `google-config`, `bedrock-config`, `openai-compatible-config` or `vertex-config` — and setting flags from two groups is an error. Provider-config flags carry the group as a dotted prefix (`--<group>.<field>`); there are no bare `--api-key-ref` or `--base-url` flags (an unknown flag error suggests the dotted spelling). For each group's credential flags and rules, see [Provider types and credentials](gateway-and-providers.md#provider-types-and-credentials), and read the full flag schema with `rpk ai llm-provider create --help -o json`. Flags that commonly trip writers:

- On `update`, `--provider-models` (repeatable; empty allows all models) and `--pricing` each **replace the provider's whole model list**, and `--tags` replaces the whole tag map.
- `--enabled` and the `--transcripts.record-*-messages` flags are booleans: true when set, `=false` to turn off. Transcript capture defaults to on.
- The CLI help says `--openai-config.api-key-ref` can be empty for no-auth endpoints, but that's true only of `openai-compatible-config`: an OpenAI provider needs a key or authorization passthrough.
- `-f` creates from a manifest (flags override file values), and `--dry-run` prints the request instead of sending it.

`update` adds `--clear <field-path>` (add a field to the update mask with it unset) and `--update-mask` (override the inferred mask); `update` with no changed flags is an error.

**`--pricing`** takes one `model=<name>,input=<usd>,…` rate card per model, in US dollars per million tokens, and **on `update` replaces the whole model list** like `--provider-models`. For the keys and their rules, see [Per-model pricing overrides](gateway-and-providers.md#per-model-pricing-overrides).

## `mcp-server` subcommands

Aliases: `mcp-servers`, `mcp`.

Subcommands: `create`, `get`, `list`, `update`, `delete`, `types`, `tools`, `apply`, `diff`.

- `types` lists the available managed MCP server types (use it rather than a hardcoded list).
- `tools list <server> [--code-mode]` lists a server's tools through the gateway's MCP endpoint, exercising the same auth path a real call uses.
- `tools call <server> <tool> [--args '<json>'] [--code-mode]` invokes a tool. `--code-mode` targets the server's code-mode endpoint (`<server>-code`), which exposes the `search` and `execute` sandbox tools.

See [mcp-servers.md](mcp-servers.md) for create flags and auth modes.

## `model` subcommands

Aliases: `models`, `m`. Subcommands: `list` (filter with `--provider-type`), `get <name>`. The catalog is read-only.

## `docs`: read the product documentation

`rpk ai docs [path]` reads the published ADP documentation in the terminal and `rpk ai docs search <query...>` searches it, both with **no sign-in and no selected environment** — safe to reach for before `rpk ai auth login`.

```bash
rpk ai docs                     # searchable picker in a terminal; an index when piped
rpk ai docs cli                 # a page by its documentation path
rpk ai docs search "oauth"      # --limit 1-100 (default 20)
rpk ai docs cli --url           # print the URL instead (needs no network)
```

- Flags: `--web` (open in a browser), `--url`, `--no-pager`, `--non-interactive` (plain Markdown, no picker or pager — the one for scripts), `--refresh` (require a fresh fetch).
- `search` matches page **titles, paths and descriptions, not page bodies**, so a phrase that appears only inside a page does not find it.
- Responses are cached for an hour; after a temporary failure the cached copy is printed with a warning, marked `stale=true` under `-o json` / `-o yaml`, unless `--refresh` refuses the fallback. The documentation tracks the published site, not the installed CLI, so confirm flags with `--help` rather than from a page.

## Read-only query and inspection groups

`trace`, `spending` and `agent-network` return the same data the observability and cost pages show — see `/redpanda:adp-observability` (*Read traces from the CLI*). `spending` and `agent-network` take their request fields as **dotted flags** (`--filter.start-time`, `--filter.end-time`) or a whole request with `-f`, and under `-o json` / `-o yaml` print the entire response envelope, pagination token included, rather than just the rows; pass that token back with `--page-token`. The remaining groups in the command tree — read-only `system-policy`, `effective-policy-set` and `ingest-feedback`, plus `policy-template` and `session`, which also write — take their flags from their own `--help`.

## `trigger` subcommands

Aliases: `triggers`, `agent-trigger`.

Subcommands: `create <agent>`, `get <name>`, `list <agent>` (alias `ls`), `update <name>`, `delete <name>`, `runs <name>`, `apply`, `diff`.

A trigger belongs to one agent, but its command group is **top-level** (`rpk ai trigger …`, not `rpk ai agent trigger …`), which keeps `rpk ai trigger apply` drivable from a GitOps tool like every other group.

Naming, kinds and their flags, pause and resume, run history and health: see [Triggers in agents.md](agents.md#triggers). On `update`, only the flags you pass change; `--cron-*` flags apply only to a schedule trigger and `--teams-*` only to a Teams trigger.

## GitOps: `apply` and `diff`

Every group that has `apply` and `diff` — `agent`, `llm-provider`, `mcp-server`, `oauth-client`, `oauth-provider`, `policy`, `trigger` — behaves the same way. Both verbs take `-f <file|dir|->` (repeatable; `-` reads stdin) and reconcile YAML manifests against the live environment.

**A manifest is the complete desired state of the resource.** Every writable field is compared, *including the ones the manifest omits*: an omitted field is compared as the value a `create` from that manifest would have produced. Trimming a field out of a manifest does not mean "leave it alone"; if the live value differs, `diff` reports drift and `apply` reconciles it. Start from a complete manifest by round-tripping `get -o yaml` rather than hand-writing a partial one. Read-only (output-only) fields are not compared.

- Lists, maps and one-of variants replace wholesale.
- Fields that can only be set at creation are immutable; a manifest that changes one is an error, not a silent skip.
- Neither verb prunes: a resource that exists live but is absent from the manifests is not detected or deleted.
- `diff` prints, per manifest, whether `apply` would create, update (and which fields) or leave the resource unchanged, and exits non-zero when any change is pending, so CI can gate on "no drift". `apply` creates the resource if absent, otherwise updates every differing field.

## Exit codes

Branch on the exit code rather than parsing messages:

| Code | Meaning |
|---|---|
| `0` | Success. An A2A task left waiting for more input also exits `0` |
| `1` | Any other failure: a usage error, an unreachable gateway, a rejected request, a resource that does not exist |
| `3` | The call was not authenticated or not authorized — credentials missing or expired, or an identity the gateway refuses |
| `4` | An A2A task ended failed, canceled, or rejected. The call itself worked, so this is the task's own outcome rather than a transport error |

Separating `3` from `1` is what lets a scheduled job re-authenticate instead of treating an expired token as a broken command: on `3`, run `rpk ai auth login` and retry. A second `3` after a fresh login is a permissions problem, not a credentials problem — re-authenticating again will not help; map the refused operation to its permission and grant it (see `/redpanda:adp-governance`, *Roles and permissions*).

## Common errors

| Message | Cause | Fix |
|---------|-------|-----|
| `no token available (run rpai auth login)` | Not signed in (no cached credentials and no `--token`) | Run `rpk ai auth login` |
| `is not a local environment and you are not logged in` | `env use <name>` with no matching local environment and no credentials | Run `rpk ai auth login`, then `rpk ai env use <environment>` |
| Environment not ready (no AI Gateway URL) | Selected environment has no AI Gateway endpoint yet | Choose a ready environment with `rpk ai env list` / `rpk ai env use` |
| `unknown flag: --api-key-ref; did you mean …` | Bare provider-config flag | Use the dotted group form, e.g. `--openai-config.api-key-ref` |
| `no fields to update; pass at least one field flag or -f` | `update` with no changed flags | Pass a field flag, `--clear`, or `-f` |
| `The Redpanda AI CLI is already installed` | `install` without `--force` | Use `rpk ai upgrade` or add `--force` |
| `found a self-managed Redpanda AI CLI` | Binary outside `~/.local/bin` | Run `rpk ai uninstall && rpk ai install` |
