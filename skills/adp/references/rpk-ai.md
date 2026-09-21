Source: `cloudv2/apps/rpai/internal/cmd/root.go` (subcommand tree lines 134-150, persistent flags lines 199-237, version subcommand lines 631-641), `cloudv2/apps/rpai/internal/auth` (token-resolver chain and OAuth device flow), `cloudv2/apps/rpai/internal/cmd/auth` (login, logout, token, status; `--no-browser` flag and always-fresh-grant behavior in `login.go`), `cloudv2/apps/rpai/internal/cmd/env` (add, list, use, show, rename, delete), `cloudv2/apps/rpai/internal/cmd/connection` (list, revoke; `ListConnections`/`RevokeConnection` RPCs), `cloudv2/apps/rpai/internal/cmd/trigger` (`cmd.go`, `create.go`, `update.go`, `runs.go`, `gitops.go`: the `trigger` command tree, kind flags, pause/resume, `runs`, GitOps wiring), `cloudv2/apps/rpai/internal/gitops` (`doc.go`, `command.go`: the complete-manifest comparison rule and the `apply`/`diff` long help shared by every resource group), `cloudv2/apps/rpai/testdata/commands-snapshot.md` (golden help output), `cloudv2/apps/rpai/internal/config/cloudenv.go` (config path lines 179-181), `cloudv2/apps/rpai/.goreleaser.yaml` (platforms, no FIPS build), `redpanda-data/redpanda/src/go/rpk/pkg/cli/ai/` (rpk-side install path and error messages), `cloudv2/apps/rpai/internal/cmd/run/claude.go` and `codex.go` (`run claude`/`run codex` flags, provider-type gating, Bedrock SigV4 routing; and in `claude.go` the transport-mode neutralization — `buildClaudeEnv`'s scrub list, `claudeRouteEnv`'s overlay pins, `claudeOnDiskTransportModeSet` / `claudeOnDiskAuthTokenSet` and `claudeEnvTruthy` for the two on-disk `settings.json` guards), `cloudv2/apps/rpai/internal/cmd/llm/pricing.go` (`--pricing` flag: keys, USD-per-million units, merge-into-`provider-models` behavior) and `cloudv2/apps/rpai/internal/cmd/generated.go` (`AddPricingSugar` wiring — `llm create`/`update` only). Published-docs coverage notes are checked against the `adp-docs` `rpk-ai-*.adoc` reference pages. Evidence date: 2026-09-14 (`trigger` command tree and the shared GitOps complete-manifest rule verified against `internal/cmd/trigger`, `internal/gitops` and `testdata/commands-snapshot.md` on 2026-09-14; `run claude` transport-mode neutralization and the two on-disk `settings.json` guards verified against `claude.go` on 2026-09-14; `auth login --no-browser` flag and always-fresh-grant behavior verified against `login.go` on 2026-08-24; `--pricing` flag on `llm create`/`update` verified 2026-08-17; `connection` subcommands re-verified 2026-08-03; `run` subcommand flags last verified 2026-07-06).

# rpk ai CLI Reference

**Maturity: Preview.** The Agentic Data Plane product is generally available; the `rpk ai` CLI itself is in Preview (every `rpk ai` reference page in the Agentic Data Plane documentation carries the Preview marker). The binary is in production use.

Audience: an AI agent using `rpk ai` to operate the Redpanda AI platform. Optimize for correct command usage.

Related references: [SKILL.md](../SKILL.md), [agents.md](agents.md), [mcp-servers.md](mcp-servers.md), [gateway-and-providers.md](gateway-and-providers.md), [governance.md](governance.md), [observability.md](observability.md).

## Discover the live surface

The subcommand tree below is sourced from the cloudv2 repo at a point in time. Before acting, confirm what is currently available:

```bash
# Top-level help (confirms all subcommands and global flags)
rpk ai --help

# Per-group help
rpk ai agent --help
rpk ai mcp --help
rpk ai llm --help
```

Always prefer live `--help` output over this document when there is a discrepancy.

## What `rpk ai` is

`rpk ai` is the Redpanda AI CLI, delivered as an rpk managed plugin: rpk downloads and manages the underlying `rpai` binary (via `rpk ai install`), and you invoke it as `rpk ai`. The binary presents itself as "Redpanda AI command-line interface" (`root.go:115-118`).

Because the binary is rpk-managed, the lifecycle commands `rpk ai install`, `rpk ai upgrade`, and `rpk ai uninstall` exist on the `rpk` side to download, update, and remove it; they are not subcommands of `rpai` itself.

## Lifecycle management (rpk-side commands)

These commands are part of `rpk`, not `rpai`. They manage the rpai binary download.

| Command | Key flags | Purpose |
|---------|-----------|---------|
| `rpk ai install` | `--ai-version string` (default `latest`), `--force` | Download and install the rpai binary |
| `rpk ai upgrade` | `--no-confirm` | Upgrade to the latest rpai binary |
| `rpk ai uninstall` | (none) | Remove the managed rpai binary |

Install path: `~/.local/bin/.rpk.managed-rpai`

Platforms: `darwin-amd64`, `darwin-arm64`, `linux-amd64`, `linux-arm64`, `windows-amd64`, `windows-arm64`. Source: `apps/rpai/tools/publish-manifest/manifest.go:41-48`.

**FIPS note:** No FIPS build of the `rpai` binary exists. The goreleaser config (`.goreleaser.yaml`) defines only the standard `darwin`, `linux`, and `windows` (amd64/arm64) targets with no FIPS platform entries or FIPS build tags, and the publish manifest lists no FIPS artifact. A FIPS-only environment cannot install a FIPS-validated `rpai`.

## Authentication

`rpk ai` is self-contained: it owns its own credentials and Agentic Data Plane environment selection rather than riding the active `rpk cloud` session. Sign in and pick a target:

```bash
rpk ai auth login              # OAuth device-authorization flow
rpk ai env list                # list local + live Agentic Data Plane environments
rpk ai env use <environment>   # select the Agentic Data Plane environment whose AI Gateway becomes the active target
rpk ai auth status             # show the current token state
```

`rpk ai auth login` runs the OAuth 2.0 device-authorization grant against Redpanda Cloud and caches the resulting credentials in `~/.rpai/credentials` (mode `0600`). `rpk ai env use <environment>` selects the Agentic Data Plane environment whose AI Gateway URL becomes the active dataplane target (this replaces the old `rpk cloud cluster select` step). `rpk ai env show` prints the resolved environment.

**`login` always runs the device flow.** Every `rpk ai auth login` invocation forces a fresh grant and replaces the stored credentials for the organization, even when the current token still has time left. A locally-valid expiry says nothing about whether the identity provider still honors the token, so a revoked session can no longer leave `rpk ai` insisting you are already logged in. Re-authenticating keeps the current environment: when the organization is unchanged, the existing selection is re-confirmed without prompting; a manual environment is left untouched. For a conditional login in a script, guard the call yourself:

```bash
rpk ai auth status -o json | jq -e .logged_in >/dev/null || rpk ai auth login
```

**`--no-browser`.** Pass `rpk ai auth login --no-browser` to skip opening the browser and print the verification URL only — for a headless host, an SSH session, or a container. On a Linux host with no `$DISPLAY` / `$WAYLAND_DISPLAY` the CLI already skips the browser automatically; the flag forces the same behavior everywhere.

Auth modes are `device|rpk|token|none` (default `device`; source `internal/types/types.go:81-90`):

| Mode | Behavior |
|------|----------|
| `device` | OAuth device-authorization flow (default); credentials cached in `~/.rpai/credentials` |
| `rpk` | Reuse the `rpk cloud` token (`cloud_auth.auth_token` from `rpk.yaml`); a selectable fallback, not the primary path |
| `token` | Static bearer token from `--token` / `RPAI_TOKEN` only |
| `none` | No Authorization header; for a local/unauthenticated AI Gateway |

Define a local or manual gateway with `rpk ai env add <name> --ai-gateway-url <url> --auth-mode none`.

For headless or CI use, the binary accepts `--token` (or the `RPAI_TOKEN` env var) for a static bearer token override.

## Global flags (when running as `rpk ai`)

When running as `rpk ai`, the binary uses prefixed flag names. Source: `root.go:199-237`, snapshot lines 1439-1445.

| Flag | Short | Env var | Default | Description |
|------|-------|---------|---------|-------------|
| `--rpai-environment` | (none) | (not bound to any env var) | (empty) | select a manual environment for this invocation; switch environments with `rpk ai env use` |
| `--rpai-config` | `-c` | `RPAI_CONFIG` | `$HOME/.rpai/config` | path to rpai config file |
| `--rpai-verbose` | `-v` | `RPAI_VERBOSE` | false | verbose debug logging to stderr |
| `--rpai-endpoint` | `-s` | **not bound to any env var** | `""` | override the selected environment's AI Gateway URL for this invocation |
| `--token` | (none) | `RPAI_TOKEN` | `""` | static bearer token override |
| `--format` | `-o` | `RPAI_FORMAT` | `table` | output format: `table`, `wide`, `json`, `yaml`, `markdown` |
| `--no-color` | (none) | `NO_COLOR` | false | disable colored output |

**Important:** `--rpai-endpoint` is intentionally NOT bound to a `RPAI_ENDPOINT` environment variable. The published `rpk ai` reference pages incorrectly describe it as `(env: RPAI_ENDPOINT)`. The source code comment at `root.go:206-213` states this explicitly: binding it would silently override the Agentic Data Plane environment chosen via `rpk ai env use`. The correct behavior is that `--rpai-endpoint` only takes effect when passed as a flag for a single invocation.

Config default path: `$HOME/.rpai/config` (production). Non-production environments use `$HOME/.rpai_<env>/config` (for example, `$HOME/.rpai_integration/config`). Source: `apps/rpai/internal/config/cloudenv.go:179-181`.

## Top-level subcommand tree

Source: `root.go:134-150` (AddCommand calls), confirmed against `testdata/commands-snapshot.md:25-36`.

| Subcommand | Aliases | Notes |
|-----------|---------|-------|
| `agent` | `agents` | Manage Agentic Data Plane agents |
| `auth` | (none) | Authentication helpers |
| `connection` | `connections`, `conn` | Manage your own OAuth connections: `list`, `revoke <provider-name>` |
| `env` | `environment` | Manage rpai environments (replaces deprecated `profile`) |
| `llm` | `llm-provider`, `provider`, `lp` | Manage LLM provider configurations |
| `mcp` | `mcp-server` | Manage MCP servers |
| `model` | `models`, `m` | List available models |
| `oauth-client` | `oauth-clients`, `oc` | Manage OAuth clients |
| `oauth-provider` | `oauth`, `op` | Manage OAuth providers (canonical name is `oauth-provider`; `oauth` is an alias) |
| `policy` | `policies`, `pol` | Manage Cedar authorization policies: `create`, `get`, `list`, `update`, `delete`, plus `apply`/`diff` for GitOps-style manifest management |
| `run` | (none) | Run AI coding tools (Claude Code, Codex) through the AI Gateway |
| `trigger` | `triggers`, `agent-trigger` | Manage an agent's triggers (Microsoft Teams, cron schedule): `create`, `get`, `list`, `update`, `delete`, `runs`, plus `apply`/`diff`. Top-level, not under `agent` |
| `version` | (none) | Print rpai version and commit |

## `rpk ai version`

`version` is a real cobra subcommand (`root.go:631-641`). It prints `rpai <version> (<commit>)`. It works without a profile or config (`AnnotationSkipDeps: "true"`).

There is also a `--version` flag on the root command. That flag exists specifically for `rpk ai upgrade`, which runs `<binary> --version` and reads a `Version: X.Y.Z` line to detect upgrade availability. It is an internal upgrade probe, not the user-facing version command.

Use `rpk ai version` to print version information.

## `agent` subcommands

Aliases: `agents`. Source: `internal/cmd/agent/cmd.go`.

CRUD and lifecycle: `create`, `get`, `list`, `update`, `delete`, `start`, `stop`, `apply`, `diff`

Sub-groups:

**`credential`** (aliases: `credentials`, `cred`):
- `create <agent>`
- `list <agent>`
- `delete <name>`

**`transcript`** (aliases: `transcripts`, `tr`):
- `list <agent>`
- `get <agent> <conversation-id>`

**`a2a`**:
- `card <agent|url>` -- retrieve A2A agent card
- `send <agent|url> [message]` -- flags: `--context-id`, `--task-id`, `--stream`, `--no-block`, `--timeout` (default 5m)
- `task`:
  - `get <agent|url> <task-id>`
  - `cancel <agent|url> <task-id>`
  - `watch <agent|url> <task-id>` (alias: `resubscribe`)

Note: the published `rpk ai` reference currently covers only the `agent` group page and `agent list`. The full subcommand tree above is confirmed from source but not all subpages are published.

## `auth` subcommands

Source: `internal/cmd/auth/cmd.go:18`. Subcommands: `login`, `logout`, `token`, `status`.

Not yet covered by the published `rpk ai` reference.

## `connection` subcommands

Source: `internal/cmd/connection/cmd.go`. Subcommands: `list`, `revoke <provider-name>`.

A *connection* is your personal OAuth grant to a third-party provider — created by signing in through the browser consent flow (the **Connect** action in the UI) — that lets `user_oauth` MCP servers act on your behalf. These commands manage the connections you already hold; they do not create them (sign-in happens through the consent flow). They bring **My Connections** to the terminal.

| Command | Purpose |
|---------|---------|
| `rpk ai connection list` | List your OAuth connections and their status. `-o wide` / `-o yaml` add connected-at, token-expiry, and refresh-token detail |
| `rpk ai connection revoke <provider-name>` | Revoke your own connection to the named provider: invalidates your stored tokens and calls the provider's revocation endpoint best-effort. Affects only your connection, not other users' |

Backed by the `ListConnections` / `RevokeConnection` RPCs. Not yet covered by the published `rpk ai` reference.

## `env` subcommands

Source: `internal/cmd/env/cmd.go:47`. Subcommands: `add` (aliases: `create`), `list`, `use`, `show`, `rename`, `delete`.

All subcommands work without a profile or config (`AnnotationSkipDeps: "true"`). The deprecated `profile` alias exists for one-release compatibility.

Not yet covered by the published `rpk ai` reference.

## `llm` subcommands

Aliases: `llm-provider`, `provider`, `lp`. Source: `internal/cmd/llm/cmd.go:20`.

Subcommands: `create`, `get`, `list`, `update`, `delete`, `check`, `apply`, `diff`

Key flags for `llm create`:

| Flag | Required | Description |
|------|----------|-------------|
| `--name string` | yes | LLM provider name |
| `--type string` | yes | Provider type: `openai`, `anthropic`, `google`, `bedrock`, plus the OpenAI-compatible type and any type added since — confirm the accepted values live with `rpk ai llm create --help` |
| `--display-name string` | no | Human-readable label |
| `--base-url string` | no | Override base URL |
| `--api-key-ref string` | no | Secret reference for the API key |
| `--models []string` | no | Allowed model list |
| `--enabled bool` | no | Default true |
| `--authorization-passthrough bool` | no | Forward the caller's upstream credential instead of a stored key. Available on `anthropic`, `openai` and `openai-compatible` providers (not `google` or `bedrock`); the flag is generated from the provider-config group's `authorization_passthrough` field, so read its exact spelling for your provider type from `rpk ai llm create --help`. See [gateway-and-providers.md](gateway-and-providers.md#authorization-passthrough) for the credential rules and the `X-Redpanda-Cloud-Token` requirement |
| `--bedrock-region string` | no | AWS region (Bedrock only) |
| `--bedrock-access-key-id-ref string` | no | Secret reference for AWS access key (Bedrock only) |
| `--pricing []string` | no | Per-model pricing override in USD per million tokens; repeatable. Also available on `llm update`. See below |

**`--pricing` (per-model pricing overrides).** Available on both `rpk ai llm create` and `rpk ai llm update`, repeatable once per model. Each value is a comma-separated key list — `model=<name>,input=<usd>,output=<usd>,cached=<usd>,cache_write_5m=<usd>,cache_write_1h=<usd>` — where `model` is required and at least one rate key must be set. Rates are **US dollars per million tokens** (for example `input=2.50`); an omitted rate keeps the catalog default, and an explicit `0` sets a free rate. Naming the same model twice is rejected.

The flag is convenience sugar over `--provider-models`: it folds each rate card onto the matching model's `custom_pricing` by name (appending the model if it is not already in the list), so on `update` it follows the same replace-the-whole-list semantics as `--provider-models`. Hand-written `--provider-models` protojson that carries a `custom_pricing` object keeps working unchanged. The underlying API field is `ProviderModelPricing`, stored in microcents per million (the CLI converts from USD); the five rate keys `input`, `output`, `cached`, `cache_write_5m`, and `cache_write_1h` map to `input_per_million`, `output_per_million`, `cached_input_per_million`, `cache_creation_5m_per_million`, and `cache_creation_1h_per_million` respectively. See [gateway-and-providers.md](gateway-and-providers.md).

```bash
rpk ai llm create --name openai-prod --type openai --api-key-ref OPENAI_KEY \
  --pricing model=gpt-4o,input=2.50,output=10.00,cached=1.25
```

The published reference covers the `llm` group page and its CRUD subpages. `check`, `apply`, `diff`, and `--pricing` are not yet documented.

## `mcp` subcommands

Aliases: `mcp-server`. Source: `internal/cmd/mcp/cmd.go:37`.

Subcommands: `create`, `get`, `list`, `update`, `delete`, `types`, `tools`, `apply`, `diff`

**`tools` sub-group** (`mcp/tools.go:25`):
- `list <server>` -- flag: `--code-mode bool`
- `call <server> <tool>` -- flags: `--args string` (JSON), `--code-mode bool`

**`types`**: Lists available managed MCP server types.

The published reference covers the CRUD subpages plus `tools`, `tools list`, `tools call`, and `types`. `apply` and `diff` are not yet documented.

## `model` subcommands

Aliases: `models`, `m`. Source: `internal/cmd/model/cmd.go:51`.

Subcommands: `list`, `get <name>`

The published reference covers the `model` group page, `model get`, and `model list`.

## `oauth-client` subcommands

Aliases: `oauth-clients`, `oc`. Source: `internal/cmd/oauthclient/cmd.go:29`.

Subcommands: `create`, `get`, `list`, `delete`, `revoke-tokens`, `apply`, `diff`

**`dcr` sub-group** (`oauthclient/dcr.go:43`): `get`, `update`, `iat`, `mint`, `list`, `revoke <id>`

The published reference covers the basic CRUD subpages. `revoke-tokens`, `dcr`, `apply`, `diff` are not yet documented.

## `oauth-provider` subcommands

Canonical name: `oauth-provider`. Aliases: `oauth`, `op`. Source: `internal/cmd/oauth/cmd.go:33`.

Subcommands: `create`, `get`, `list`, `update`, `delete`, `apply`, `diff`

The published reference covers the CRUD subpages. `apply` and `diff` are not yet documented.

## `trigger` subcommands

Aliases: `triggers`, `agent-trigger`. Source: `internal/cmd/trigger/cmd.go`.

Subcommands: `create <agent>`, `get <name>`, `list <agent>` (alias `ls`), `update <name>`, `delete <name>`, `runs <name>`, `apply`, `diff`

A trigger is an agent-owned child resource, but its command group is mounted **top-level** (`rpk ai trigger …`, not `rpk ai agent trigger …`): a GitOps driver resolves `rpk ai <command> apply` with `<command>` as a single argv element, so a nested group could not be driven that way. The same reasoning keeps `policy` top-level.

**Naming.** A trigger's resource name carries its parent: `agents/{agent}/triggers/{trigger}`. `create` and `list` take the parent agent, as a bare id (`my-agent`) or its resource name (`agents/my-agent`); `get`, `update`, `delete` and `runs` take the full two-segment name exactly as `list` prints it — a bare trigger id is rejected (`expected 4 path segments, got 1`). The trigger id is server-assigned unless `--id <dns-1123-label>` names one; the full name is printed on success.

**Kind.** Exactly one kind per trigger, chosen at `create` by which flag family you pass, and immutable afterwards (delete and recreate to change it):

| Kind | Flags |
|---|---|
| Microsoft Teams | `--teams-bot-app-id` (Azure Bot application/client ID), `--teams-bot-tenant-id` (Azure AD directory/tenant ID), `--teams-bot-app-secret-ref` (secret-store key holding the bot client secret — a bare `UPPER_SNAKE_CASE` key, never the secret itself) |
| Schedule (cron) | `--cron-schedule` (standard 5-field expression, e.g. `"0 9 * * 1-5"`), `--cron-timezone` (IANA zone, e.g. `Europe/Prague`; **required** — the server never falls back to UTC), `--cron-input` (the message text each scheduled run sends to the agent) |

Common flags on `create` and `update`: `--display-name`, `--description`, `--enabled` (default `true`). A `create` with no kind flags is an error naming both flag families. On `update`, only the flags you pass are changed; `--cron-*` flags apply only to a trigger that is already a schedule and `--teams-*` only to one that is already Teams.

**Pause and resume.** `update <name> --enabled=false` pauses a trigger while keeping its configuration and run history; `--enabled=true` resumes it from the next scheduled instant onward, with no catch-up of missed ticks. This is the CLI form of the `Trigger.enabled` toggle in [agents.md](agents.md).

**`runs <name>`** lists the recorded fires of a schedule trigger, newest first. Only cron triggers have runs; a Teams trigger reports an empty history. Each run's `conversation_id` joins it to its transcript (`rpk ai agent transcript get`).

**`get -o yaml`** is how to see the kind configuration and the reported health: the tabular columns cannot reach the `kind` oneof or `status`.

**The registry does not validate credentials.** The API stores the trigger configuration but never validates the Teams credentials or resolves the secret refs, so a trigger that is accepted can still be reported unhealthy by the component that operates it — read `status` after creating one.

`delete` is idempotent: deleting an already-deleted trigger succeeds.

```bash
rpk ai trigger create my-agent --cron-schedule "0 9 * * 1-5" --cron-timezone Europe/Prague --cron-input "Post the daily summary"
rpk ai trigger list my-agent
rpk ai trigger update agents/my-agent/triggers/<id> --enabled=false
rpk ai trigger runs agents/my-agent/triggers/<id>
```

Not yet covered by the published `rpk ai` reference.

## GitOps: `apply` and `diff`

Every resource group that lists `apply` and `diff` — `agent`, `llm`, `mcp`, `oauth-client`, `oauth-provider`, `policy`, `trigger` — delegates to one shared engine (`internal/gitops`). Both verbs take `-f <file|dir|->` (repeatable; `-` reads stdin) and reconcile YAML manifests against the live environment.

**A manifest is the complete desired state of the resource.** Every writable field is compared, *including the ones the manifest omits*: an omitted field carries its proto zero — the value a `create` from that manifest would have produced — and is compared against the live value like any other. So trimming a field out of a manifest does not mean "leave it alone"; if the live resource holds a different value, `diff` reports drift and `apply` reconciles it back to the zero value. Start from a complete manifest by round-tripping `get -o yaml`, which dumps every writable field, rather than hand-writing a partial one. OUTPUT_ONLY fields are not compared.

Further rules:

- Lists, maps and oneof variants replace wholesale; a changed message masks only its changed leaves.
- Fields that can only be set at creation are immutable; a manifest that changes one is an error, not a silent skip.
- Neither verb prunes: a resource that exists live but is absent from the manifests is not detected or deleted.
- `diff` prints, per manifest, whether `apply` would create, update (and which fields) or leave the resource unchanged, and exits non-zero when any change is pending, so CI can gate on "no drift". `apply` creates the resource if absent, otherwise updates every field that differs.

## `run` subcommands

Source: `internal/cmd/run/{cmd,claude,codex}.go`. Routes an AI coding tool's model traffic through the AI Gateway for the active environment: the tool authenticates to the gateway (never directly to the upstream provider) and no upstream key is written to disk. Both subcommands take `-L`/`-m` as command-local flags (not renamed under `rpk ai`) and pass the tool's own flags after a literal `--`.

### `run claude [flags] [-- CLAUDE_ARGS...]`

Launches Anthropic's Claude Code with `ANTHROPIC_BASE_URL` pointed at the gateway for the chosen provider. Works against **anthropic and bedrock** LLM providers.

| Flag | Short | Description |
|------|-------|-------------|
| `--llmprovider string` | `-L` | REQUIRED; aigw LLM provider to route through (an `anthropic` or `bedrock` provider) |
| `--model string` | `-m` | Model id (must be in the provider's allowlist); omit to let Claude Code pick its default. For a bedrock provider pass an inference-profile id (e.g. `us.anthropic.claude-sonnet-4-6`) |
| `--passthrough` | (none) | Force enterprise/Max-subscription OAuth passthrough mode (anthropic only; a hard error for bedrock). Only needed under invoke-only access where rpai can't read the provider to detect the mode |
| `--bedrock` | (none) | Force bedrock mode. Only needed under invoke-only access where rpai can't read the provider type |
| `--claude-config-dir string` | (none) | Run against this `CLAUDE_CONFIG_DIR` instead of your real config home (rpai never writes into it) |
| `--print-settings` | (none) | Print the generated Claude Code settings.json plus launch env, then exit |

`--passthrough` and `--bedrock` are mutually exclusive. For a **bedrock** provider the gateway signs the upstream call with the provider's AWS credentials (SigV4), so no AWS credentials ever reach your machine; passthrough does not apply (Bedrock has no analog of a Claude subscription).

```bash
rpk ai run claude -L anthropic -m claude-sonnet-4-6 -- --permission-mode plan
rpk ai run claude -L bedrock -m us.anthropic.claude-sonnet-4-6 -- -p "hi"
```

#### The launch cannot be rerouted away from the gateway

The point of `run claude` is that the session's traffic is metered and audited by the gateway, so a launch actively neutralizes Claude Code's own transport-mode switches instead of hoping they are unset. Two layers:

- **Scrubbed from the child environment.** On every mode: the Vertex switch and its companions (`CLAUDE_CODE_USE_VERTEX`, `ANTHROPIC_VERTEX_BASE_URL`, `CLAUDE_CODE_SKIP_VERTEX_AUTH`), plus inherited `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` / `ANTHROPIC_CUSTOM_HEADERS` / `AWS_BEARER_TOKEN_BEDROCK`, and `ANTHROPIC_MODEL` when you passed no `-m` (an inherited one would silently override Claude Code's default and could select a model outside the provider's allowlist). On the non-Bedrock path the Bedrock switches (`CLAUDE_CODE_USE_BEDROCK`, `ANTHROPIC_BEDROCK_BASE_URL`, `CLAUDE_CODE_SKIP_BEDROCK_AUTH`) are scrubbed too; Bedrock mode sets them itself.
- **Pinned in the generated `--settings` overlay**, which outranks both the process environment and any on-disk `settings.json`: the mode you did not ask for is set to `0` and its companions emptied. An `anthropic` provider pins Bedrock off; both branches pin Vertex off. GCP project/region and `AWS_REGION` are left alone — inert once the switch is off.

**Passthrough is the exception, and it fails fast rather than silently.** `--passthrough` renders no settings overlay (that is what keeps the gateway token off disk), so it cannot pin a switch off, and an on-disk `settings.json` outranks the scrubbed environment. A passthrough launch is therefore **refused** when any `settings.json` applying to the launch — the Claude config home's, or `.claude/settings.json` / `.claude/settings.local.json` under the working directory — sets `env.CLAUDE_CODE_USE_VERTEX` or `env.CLAUDE_CODE_USE_BEDROCK` to a value Claude Code reads as on (`1`, `true`, `yes`, `on`, case-insensitive; `0` and empty are off). The error names the switch. An unreadable or malformed settings file is ignored rather than treated as a match.

A second, separate guard covers the credential rather than the transport: a **token-backed managed** launch (`--token`, not passthrough, against an environment whose auth mode is not `none`) is refused when one of those same files sets `env.ANTHROPIC_AUTH_TOKEN`, which would override the gateway bearer — the message points at removing it or using `rpk ai auth login` instead.

The fix in both cases is to remove the setting from `settings.json`, or to drop the flag that suppresses the overlay. Use `--claude-config-dir` to launch against a different `CLAUDE_CONFIG_DIR` (never written to), and `--print-settings` to see the overlay and launch environment without starting a session.

### `run codex [flags] [-- CODEX_ARGS...]`

Launches OpenAI Codex with a throwaway `CODEX_HOME` pointed at the gateway's OpenAI-compatible Responses endpoint. Works against **openai and openai_compatible** providers only.

| Flag | Short | Description |
|------|-------|-------------|
| `--llmprovider string` | `-L` | REQUIRED; aigw LLM provider to route through (`openai`/`openai_compatible`) |
| `--model string` | `-m` | Model id (must be in the provider's allowlist); omit to let Codex pick its default |
| `--effort string` | `-e` | Model reasoning effort: `minimal`, `low`, `medium`, `high`; omit for Codex's default |
| `--codex-home string` | (none) | Persistent `CODEX_HOME` dir (default: a throwaway temp dir; your real `~/.codex` is refused) |
| `--no-auto-trust` | (none) | Do not pre-trust the launch directory; let Codex show its normal first-run trust prompt |
| `--print-config` | (none) | Print the generated Codex config.toml and exit |

Under `rpk ai`, `run codex` rejects a static `--token` (its refresh command can't carry the token off-disk); use `rpk ai auth login` instead.

`run codex` wires API-key-style gateway authentication for the provider it targets. It does **not** set up ChatGPT/Codex *subscription* passthrough: that needs a provider with `authorization_passthrough` and the Codex base URL, and a Codex config that sends the subscription token in `Authorization` and the gateway token in `X-Redpanda-Cloud-Token` — configure Codex by hand for that case. See [gateway-and-providers.md](gateway-and-providers.md#authorization-passthrough).

```bash
rpk ai run codex -L openai -m gpt-5.3-codex -e high -- --ask-for-approval never
```

Not yet covered by the published `rpk ai` reference.

## Common errors

| Message | Cause | Fix |
|---------|-------|-----|
| `no token available (run rpai auth login)` | Not signed in (no cached credentials, no `--token`/`RPAI_TOKEN`) | Run `rpk ai auth login` |
| `is not a local environment and you are not logged in` | `env use <name>` with no matching local env and no credentials | Run `rpk ai auth login`, then `rpk ai env use <environment>` |
| Agentic Data Plane environment not ready (no AI Gateway URL) | Selected environment has no AI Gateway endpoint yet | Choose a ready environment with `rpk ai env list` / `rpk ai env use` |
| `The Redpanda AI CLI is already installed` | `install` without `--force` | Use `rpk ai upgrade` or add `--force` |
| `found a self-managed Redpanda AI CLI` | Binary outside `~/.local/bin` | Run `rpk ai uninstall && rpk ai install` |
