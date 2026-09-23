Source: `cloudv2 apps/rpai/testdata/commands-snapshot.md` (golden help output, including the `rpk ai`-mode root help), `cloudv2 apps/rpai/internal/cmd/` (auth, env, connection, trigger, run, llm pricing), `cloudv2 apps/rpai/internal/gitops/`, `cloudv2 apps/rpai/.goreleaser.yaml` and publish manifest (platforms, no FIPS build), `cloudv2 adp/RELEASE_NOTES.md` (shipped status), `redpanda/src/go/rpk/pkg/cli/ai/` (install path, lifecycle errors), `adp-docs modules/cli/`. Evidence date: 2026-09-23 (command tree, canonical group names and aliases, `rpk ai` global flags, `llm-provider create` flags including `--pricing`, `mcp-server tools`, `trigger`, `run claude`/`run codex` help, and GitOps `apply`/`diff` help re-verified against the snapshot); earlier: `run claude` transport-mode guards 2026-09-14, `auth login --no-browser` 2026-08-24, `connection` 2026-08-03.

# rpk ai CLI Reference

**Maturity: Preview.** The Agentic Data Plane is generally available; the `rpk ai` CLI is in Preview.

Audience: an AI agent using `rpk ai` to operate the Redpanda Agentic Data Plane. Optimize for correct command usage.

Related references: [SKILL.md](../SKILL.md), [agents.md](agents.md), [mcp-servers.md](mcp-servers.md), [gateway-and-providers.md](gateway-and-providers.md), [governance.md](governance.md), [observability.md](observability.md).

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

| Command | Key flags | Purpose |
|---------|-----------|---------|
| `rpk ai install` | `--ai-version string` (default `latest`), `--force` | Download and install the plugin |
| `rpk ai upgrade` | `--no-confirm` | Upgrade to the latest plugin |
| `rpk ai uninstall` | (none) | Remove the managed plugin |

Install path: `~/.local/bin/.rpk.managed-rpai`.

Platforms: `darwin-amd64`, `darwin-arm64`, `linux-amd64`, `linux-arm64`, `windows-amd64`, `windows-arm64`. There is no FIPS build, so a FIPS-only environment cannot install a FIPS-validated `rpk ai`.

## Authentication

`rpk ai` owns its own credentials and Agentic Data Plane environment selection; it does not ride the active `rpk cloud` session. Sign in and pick a target:

```bash
rpk ai auth login              # OAuth device-authorization flow
rpk ai env list                # your organization's live ADP environments + local manual environments
rpk ai env use <environment>   # select the environment whose AI Gateway becomes the active target
rpk ai auth status             # show the current token state
```

`rpk ai auth login` runs the OAuth 2.0 device-authorization grant against Redpanda Cloud and caches the credentials in `~/.rpai/credentials` (mode `0600`). `rpk ai env use <environment>` selects the environment whose AI Gateway URL becomes the active target. `rpk ai env show` prints the resolved environment as YAML (tokens redacted).

**`login` always runs the device flow.** Every `rpk ai auth login` forces a fresh grant and replaces the stored credentials for the organization, even when the current token has time left, so a revoked session cannot leave `rpk ai` insisting you are logged in. Re-authenticating keeps the current environment selection. For a conditional login in a script, guard the call yourself:

```bash
rpk ai auth status -o json | jq -e .logged_in >/dev/null || rpk ai auth login
```

**`--no-browser`.** `rpk ai auth login --no-browser` prints the verification URL without opening a browser — for a headless host, an SSH session, or a container. On a Linux host with no `$DISPLAY` / `$WAYLAND_DISPLAY` the CLI skips the browser automatically.

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

## Global flags (under `rpk ai`)

Running as an rpk plugin, some long flags are renamed to avoid colliding with rpk's own global flags. Short flags are unchanged.

| Flag | Short | Env var | Default | Description |
|------|-------|---------|---------|-------------|
| `--rpai-environment` | (none) | (none) | (empty) | Select a manual environment for this invocation; switch environments with `rpk ai env use` |
| `--rpai-config` | `-c` | `RPAI_CONFIG` | `$HOME/.rpai/config` | Path to the config file |
| `--rpai-verbose` | `-v` | `RPAI_VERBOSE` | false | Verbose debug logging to stderr |
| `--rpai-endpoint` | `-s` | (none) | `""` | Override the selected environment's AI Gateway URL for this invocation |
| `--token` | (none) | (none; ambient `RPAI_TOKEN` is ignored under `rpk ai`) | `""` | Static bearer token override |
| `--format` | `-o` | `RPAI_FORMAT` | `table` | Output format: `table`, `wide`, `json`, `yaml`, `markdown` |
| `--no-color` | (none) | `NO_COLOR` | false | Disable colored output |

`--rpai-endpoint` has no environment-variable binding, so it can never silently override the environment chosen with `rpk ai env use`; it takes effect only when passed for a single invocation.

## Top-level command tree

| Command | Aliases | Notes |
|---------|---------|-------|
| `agent` | `agents` | Manage agents (managed and self-managed) |
| `auth` | (none) | `login`, `logout`, `token`, `status` |
| `completion` | (none) | Generate a shell autocompletion script |
| `connection` | `connections`, `conn` | Manage your own OAuth connections: `list`, `revoke <provider-name>` |
| `env` | `environment` | Manage environments: `add`, `list`, `use`, `show`, `rename`, `delete` |
| `llm-provider` | `llm-providers`, `llm`, `provider`, `lp` | Manage LLM providers |
| `mcp-server` | `mcp-servers`, `mcp` | Manage MCP servers |
| `model` | `models`, `m` | Discover models in the catalog (read-only) |
| `oauth-client` | `oauth-clients`, `oc` | Manage OAuth clients |
| `oauth-provider` | `oauth-providers`, `oauth`, `op` | Manage OAuth providers |
| `policy` | `policies`, `pol` | Manage Cedar authorization policies |
| `run` | (none) | Launch Claude Code or Codex routed through the AI Gateway |
| `trigger` | `triggers`, `agent-trigger` | Manage an agent's triggers (top-level, not under `agent`) |
| `version` | (none) | Print version and commit |

The canonical group names are `llm-provider` and `mcp-server`; `llm` and `mcp` remain aliases, so `rpk ai llm create …` and `rpk ai mcp tools list …` still work.

## `rpk ai version`

`rpk ai version` prints `rpai <version> (<commit>)` and works without an environment or config. The root `--version` flag exists for `rpk ai upgrade`'s version probe; use the `version` command for version information.

## `agent` subcommands

Aliases: `agents`.

CRUD and lifecycle: `create`, `get`, `list`, `update`, `delete`, `start`, `stop`, `apply`, `diff`. `create` makes a managed agent by default; pass `--self-managed` for a metadata-only record of an agent you host yourself.

**`credential`** (aliases: `credentials`, `cred`): `create <agent>`, `list <agent>`, `delete <name>` — client-ID/secret pairs an agent uses to authenticate against the gateway.

**`transcript`** (aliases: `transcripts`, `tr`): `list <agent>`, `get <agent> <conversation-id>`.

**`a2a`** — talk to a running agent over A2A. The target is a registered agent name or a full `http(s)://` A2A endpoint URL:
- `card <agent|url>` — fetch the A2A agent card
- `send <agent|url> [message]` — flags: `--context-id`, `--task-id`, `--stream`, `--no-block`, `--timeout` (default 5m; `0` waits forever)
- `task get|cancel|watch <agent|url> <task-id>` (`watch` alias: `resubscribe`)

Your bearer token is attached only for a registered agent or a URL on the environment's dataplane host; other hosts are called without credentials (a note on stderr says so). Exit codes: `0` success (including a task waiting for input), `4` task ended failed/canceled/rejected, `1` anything else.

## `connection` subcommands

A *connection* is your personal OAuth grant to a third-party provider, created by signing in through the browser consent flow (the **Connect** action in the UI), that lets `user_oauth` MCP servers act on your behalf. These commands manage connections you already hold — the terminal equivalent of **My Connections** — and do not create them.

| Command | Purpose |
|---------|---------|
| `rpk ai connection list` | List your OAuth connections and their status. `-o wide` / `-o yaml` add connected-at, token-expiry, and refresh-token detail |
| `rpk ai connection revoke <provider-name>` | Revoke your own connection to the named provider: invalidates your stored tokens and calls the provider's revocation endpoint best-effort. Affects only your connection |

## `env` subcommands

Subcommands: `add` (alias `create`), `list`, `use`, `show`, `rename`, `delete`. All work without a config or signed-in session. `add`, `rename`, and `delete` act on manual (local) environments; `use` switches to a manual environment or selects an ADP environment by name or ID.

## `llm-provider` subcommands

Aliases: `llm-providers`, `llm`, `provider`, `lp`.

Subcommands: `create`, `get`, `list`, `update`, `delete`, `check` (connectivity check), `apply`, `diff`.

`create` takes the provider name as a **positional argument** and has no `--type` or `--name` flag. The provider type is selected by which provider-config flag group you set — `openai-config`, `anthropic-config`, `google-config`, `bedrock-config` or `openai-compatible-config` — and setting flags from two groups is an error. Provider-config flags carry the group as a dotted prefix (`--<group>.<field>`); there are no bare `--api-key-ref` or `--base-url` flags (an unknown flag error suggests the dotted spelling). Key flags:

| Flag | Description |
|------|-------------|
| `NAME` (positional) | LLM provider name |
| `--display-name string` | Human-readable label |
| `--provider-models stringArray` | Model identifiers; repeatable, bare names (comma-split) or a JSON object. Empty allows all models. Replaces the full list on `update` |
| `--enabled` | True when set; `--enabled=false` to disable |
| `--<group>.api-key-ref string` (`openai-config`, `anthropic-config`, `google-config`, `openai-compatible-config`) | Secret-store reference for the API key; setting one selects that provider type. OpenAI and Anthropic need either a key or authorization passthrough; only `openai-compatible-config` may leave it empty for a no-auth endpoint |
| `--<group>.base-url string` (all five groups) | Override the default endpoint |
| `--anthropic-config.authorization-passthrough` | Forward the caller's `Authorization` header upstream instead of a stored key (enterprise/Max plan OAuth); `=false` to disable. See [gateway-and-providers.md](gateway-and-providers.md#authorization-passthrough) |
| `--bedrock-config.region string` (alias `--region`) | AWS region; required within the Bedrock group |
| `--bedrock-config.static-credentials.access-key-id-ref` (alias `--access-key-id-ref`), `--bedrock-config.static-credentials.secret-access-key-ref` (alias `--secret-access-key-ref`) | Static AWS credentials; both required within their sub-group |
| `--bedrock-config.assume-role.role-arn` (alias `--role-arn`), `.external-id`, `.session-name` | STS assume-role credentials; `role-arn` required within its sub-group |
| `--transcripts.record-input-messages`, `--transcripts.record-output-messages` | Transcript content capture; `=false` to disable |
| `--guardrail string` | Guardrail to attach |
| `--tags stringArray` | `key=value`, repeatable; replaces the full map on `update` |
| `-f, --filename string` | Manifest to create from (YAML or JSON; `-` for stdin). Flags override file values |
| `--dry-run` | Print the request that would be sent and exit |
| `--pricing stringArray` | Per-model pricing override in USD per million tokens; repeatable. Also on `update` |

<!-- TODO(human): the current `--openai-config.api-key-ref` help says to leave it empty for no-auth endpoints, which matches the OpenAI-compatible type, not OpenAI; the product docs say OpenAI requires a key or passthrough. The CLI help text looks stale. -->

The current help lists an authorization-passthrough flag only for the Anthropic group; check `rpk ai llm-provider create --help` for other groups. A new provider type or field shows up as a new flag group or dotted flag, not as a new value of a `--type` flag.

`update` adds `--clear <field-path>` (add a field to the update mask with it unset) and `--update-mask` (override the inferred mask); `update` with no changed flags is an error.

**`--pricing`.** Repeatable once per model. Each value is `model=<name>,input=<usd>,output=<usd>,cached=<usd>,cache_write_5m=<usd>,cache_write_1h=<usd>`: `model` is required and at least one rate must be set. Rates are **US dollars per million tokens**; an omitted rate keeps the catalog default and an explicit `0` sets a free rate. Naming the same model twice is rejected. The flag merges each rate card into `--provider-models` by model name (appending the model if absent), so on `update` it replaces the whole model list like `--provider-models` does. Hand-written `--provider-models` JSON carrying `custom_pricing` keeps working. See [gateway-and-providers.md](gateway-and-providers.md).

```bash
rpk ai llm-provider create openai-prod --openai-config.api-key-ref OPENAI_KEY \
  --pricing model=gpt-4o,input=2.50,output=10.00,cached=1.25
```

## `mcp-server` subcommands

Aliases: `mcp-servers`, `mcp`.

Subcommands: `create`, `get`, `list`, `update`, `delete`, `types`, `tools`, `apply`, `diff`.

- `types` lists the available managed MCP server types (use it rather than a hardcoded list).
- `tools list <server> [--code-mode]` lists a server's tools through the gateway's MCP endpoint, exercising the same auth path a real call uses.
- `tools call <server> <tool> [--args '<json>'] [--code-mode]` invokes a tool. `--code-mode` targets the server's code-mode endpoint (`<server>-code`), which exposes the `search` and `execute` sandbox tools.

See [mcp-servers.md](mcp-servers.md) for create flags and auth modes.

## `model` subcommands

Aliases: `models`, `m`. Subcommands: `list` (filter with `--provider-type`), `get <name>`. The catalog is read-only.

## `oauth-client` subcommands

Aliases: `oauth-clients`, `oc`.

Subcommands: `create`, `get`, `list`, `update`, `delete`, `revoke-tokens <name>`, `dcr`, `apply`, `diff`.

`revoke-tokens` revokes every refresh token issued under the client, forcing every user who connected it to sign in again; already-issued short-lived access tokens may keep working until they expire. It is idempotent.

**`dcr`** manages Dynamic Client Registration settings: `dcr get`, `dcr update`, and initial access tokens under `dcr iat` (`mint`, `list`, `revoke <id>`).

## `oauth-provider` subcommands

Aliases: `oauth-providers`, `oauth`, `op`. Subcommands: `create`, `get`, `list`, `update`, `delete`, `apply`, `diff`.

## `policy` subcommands

Aliases: `policies`, `pol`. Subcommands: `create`, `get`, `list`, `update` (Cedar body or metadata), `delete`, `apply`, `diff`. See [governance.md](governance.md).

## `trigger` subcommands

Aliases: `triggers`, `agent-trigger`.

Subcommands: `create <agent>`, `get <name>`, `list <agent>` (alias `ls`), `update <name>`, `delete <name>`, `runs <name>`, `apply`, `diff`.

A trigger belongs to one agent, but its command group is **top-level** (`rpk ai trigger …`, not `rpk ai agent trigger …`), which keeps `rpk ai trigger apply` drivable from a GitOps tool like every other group.

**Naming.** A trigger's name carries its parent: `agents/{agent}/triggers/{trigger}`. `create` and `list` take the parent agent, as a bare ID (`my-agent`) or `agents/my-agent`; `get`, `update`, `delete` and `runs` take the full name exactly as `list` prints it. A bare trigger ID is rejected (`expected 4 path segments, got 1`). The trigger ID is server-assigned unless `--id <dns-1123-label>` names one; the full name is printed on success.

**Kind.** Exactly one kind per trigger, chosen at `create` by which flag family you pass, and immutable afterwards (delete and recreate to change it):

| Kind | Flags |
|---|---|
| Microsoft Teams | `--teams-bot-app-id` (Azure Bot application/client ID), `--teams-bot-tenant-id` (Azure AD tenant ID), `--teams-bot-app-secret-ref` (secret-store key holding the bot client secret — a bare `UPPER_SNAKE_CASE` key, never the secret itself) |
| Schedule (cron) | `--cron-schedule` (standard 5-field expression, e.g. `"0 9 * * 1-5"`), `--cron-timezone` (IANA zone, e.g. `Europe/Prague`; **required** — there is no UTC fallback), `--cron-input` (message text each scheduled run sends to the agent) |

Common flags on `create` and `update`: `--display-name`, `--description`, `--enabled` (default `true`). A `create` with no kind flags is an error naming both flag families. On `update`, only the flags you pass change; `--cron-*` flags apply only to a schedule trigger and `--teams-*` only to a Teams trigger.

**Pause and resume.** `update <name> --enabled=false` pauses a trigger, keeping its configuration and run history; `--enabled=true` resumes it from the next scheduled instant, with no catch-up of missed runs. See [agents.md](agents.md).

**`runs <name>`** lists a schedule trigger's recorded runs, newest first. Only cron triggers have runs; a Teams trigger reports an empty history. Each run's `conversation_id` joins it to its transcript (`rpk ai agent transcript get`).

**`get -o yaml`** shows the kind configuration and the reported health, which the table output does not.

**Credentials are not validated at create time.** A trigger is stored without checking the Teams credentials or resolving the secret refs, so an accepted trigger can still be reported unhealthy — read its status (`get -o yaml`) after creating one.

`delete` is idempotent.

```bash
rpk ai trigger create my-agent --cron-schedule "0 9 * * 1-5" --cron-timezone Europe/Prague --cron-input "Post the daily summary"
rpk ai trigger list my-agent
rpk ai trigger update agents/my-agent/triggers/<id> --enabled=false
rpk ai trigger runs agents/my-agent/triggers/<id>
```

## GitOps: `apply` and `diff`

Every group that has `apply` and `diff` — `agent`, `llm-provider`, `mcp-server`, `oauth-client`, `oauth-provider`, `policy`, `trigger` — behaves the same way. Both verbs take `-f <file|dir|->` (repeatable; `-` reads stdin) and reconcile YAML manifests against the live environment.

**A manifest is the complete desired state of the resource.** Every writable field is compared, *including the ones the manifest omits*: an omitted field is compared as the value a `create` from that manifest would have produced. Trimming a field out of a manifest does not mean "leave it alone"; if the live value differs, `diff` reports drift and `apply` reconciles it. Start from a complete manifest by round-tripping `get -o yaml` rather than hand-writing a partial one. Read-only (output-only) fields are not compared.

- Lists, maps and one-of variants replace wholesale.
- Fields that can only be set at creation are immutable; a manifest that changes one is an error, not a silent skip.
- Neither verb prunes: a resource that exists live but is absent from the manifests is not detected or deleted.
- `diff` prints, per manifest, whether `apply` would create, update (and which fields) or leave the resource unchanged, and exits non-zero when any change is pending, so CI can gate on "no drift". `apply` creates the resource if absent, otherwise updates every differing field.

## `run` subcommands

Routes an AI coding tool's model traffic through the AI Gateway for the active environment, reusing the `rpk ai` login with an auto-refreshing token: the tool authenticates to the gateway, never directly to the upstream provider, and no upstream key is written to disk. `-L`/`-m` are command-local flags (not renamed under `rpk ai`); pass the tool's own flags after a literal `--`.

### `run claude [flags] [-- CLAUDE_ARGS...]`

Launches Claude Code with `ANTHROPIC_BASE_URL` pointed at the gateway for the chosen provider. Works against **anthropic and bedrock** LLM providers. It runs in your real Claude Code config home (trust, onboarding, theme and MCP servers apply) and writes nothing into it.

| Flag | Short | Description |
|------|-------|-------------|
| `--llmprovider string` | `-L` | Required; the LLM provider to route through (`anthropic` or `bedrock` type) |
| `--model string` | `-m` | Model ID (must be in the provider's allowlist); omit for Claude Code's default. For bedrock, pass an inference-profile ID (e.g. `us.anthropic.claude-sonnet-4-6`) |
| `--passthrough` | (none) | Force enterprise/Max-subscription passthrough mode (anthropic only). Only needed with invoke-only access, when the provider can't be read to detect the mode |
| `--bedrock` | (none) | Force bedrock mode. Only needed with invoke-only access, when the provider type can't be read |
| `--claude-config-dir string` | (none) | Run against this `CLAUDE_CONFIG_DIR` instead of your real config home (never written to) |
| `--print-settings` | (none) | Print the generated settings and launch environment, then exit |

Modes:
- **Managed (API key)**: the gateway credential helper is passed through `claude --settings` as a JSON overlay, merged on top of your settings; `~/.claude/settings.json` is untouched.
- **Passthrough**: your existing subscription login is used; only the gateway base URL and a freshly minted `X-Redpanda-Cloud-Token` header are set in the environment. That token is inherited by Claude Code's tool subprocesses.
- **Bedrock**: the gateway signs the upstream call with the provider's AWS credentials, so no AWS credentials reach your machine; passthrough does not apply. If the provider's allowlist lacks Claude Code's background (small/fast) model, export `ANTHROPIC_SMALL_FAST_MODEL` with an allowlisted ID.

`--passthrough` and `--bedrock` are mutually exclusive.

```bash
rpk ai run claude -L anthropic -m claude-sonnet-4-6 -- --permission-mode plan
rpk ai run claude -L bedrock -m us.anthropic.claude-sonnet-4-6 -- -p "hi"
```

#### The launch cannot be rerouted away from the gateway

`run claude` neutralizes Claude Code's own transport-mode switches so the session stays metered and audited by the gateway:

- **Scrubbed from the launched environment**: the Vertex switches (`CLAUDE_CODE_USE_VERTEX`, `ANTHROPIC_VERTEX_BASE_URL`, `CLAUDE_CODE_SKIP_VERTEX_AUTH`), inherited `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_CUSTOM_HEADERS`, `AWS_BEARER_TOKEN_BEDROCK`, and `ANTHROPIC_MODEL` when you pass no `-m`. Outside Bedrock mode the Bedrock switches (`CLAUDE_CODE_USE_BEDROCK`, `ANTHROPIC_BEDROCK_BASE_URL`, `CLAUDE_CODE_SKIP_BEDROCK_AUTH`) are scrubbed too.
- **Pinned off in the settings overlay**, which outranks both the environment and on-disk `settings.json`: the mode you did not ask for is set to `0`.

**Passthrough fails fast instead.** Passthrough renders no overlay, so it cannot pin a switch off. A passthrough launch is **refused** when a `settings.json` that applies to it (the config home's, or `.claude/settings.json` / `.claude/settings.local.json` in the working directory) turns on `env.CLAUDE_CODE_USE_VERTEX` or `env.CLAUDE_CODE_USE_BEDROCK` (`1`, `true`, `yes`, `on`, case-insensitive). The error names the switch. A malformed settings file is ignored.

A separate guard: a managed launch using `--token` (against an environment whose auth mode is not `none`) is refused when one of those files sets `env.ANTHROPIC_AUTH_TOKEN`, which would override the gateway bearer; remove it or use `rpk ai auth login`.

Fix either case by removing the setting from `settings.json`. Use `--print-settings` to inspect the overlay without starting a session.

### `run codex [flags] [-- CODEX_ARGS...]`

Launches the OpenAI Codex CLI with a throwaway `CODEX_HOME` pointed at the gateway's OpenAI-compatible Responses endpoint, with its bearer refreshed through `rpk ai auth token`. Your own `~/.codex` is never read or modified. Works against **openai and openai_compatible** providers only.

| Flag | Short | Description |
|------|-------|-------------|
| `--llmprovider string` | `-L` | Required; the LLM provider to route through (`openai`/`openai_compatible`) |
| `--model string` | `-m` | Model ID (must be in the provider's allowlist); omit for Codex's default |
| `--effort string` | `-e` | Reasoning effort: `minimal`, `low`, `medium`, `high`; omit for Codex's default |
| `--codex-home string` | (none) | Persistent `CODEX_HOME` (default: a throwaway temp dir; `~/.codex` is refused). Its `config.toml` is regenerated each run |
| `--no-auto-trust` | (none) | Don't pre-trust the launch directory (default: auto-trusted under a workspace-write sandbox) |
| `--print-config` | (none) | Print the generated `config.toml` and exit |

Under `rpk ai`, `run codex` rejects a static `--token`; use `rpk ai auth login`.

`run codex` wires API-key-style gateway authentication. It does **not** set up ChatGPT/Codex *subscription* passthrough: that needs a provider configured for authorization passthrough and a Codex config that sends the subscription token in `Authorization` and the gateway token in `X-Redpanda-Cloud-Token` — configure Codex by hand. See [gateway-and-providers.md](gateway-and-providers.md#authorization-passthrough).

<!-- TODO(human): the current CLI help shows an authorization-passthrough flag only for `--anthropic-config`; confirm how an OpenAI-family provider is configured for passthrough (manifest field, UI, or not supported) before describing Codex subscription passthrough further. -->

```bash
rpk ai run codex -L openai -m gpt-5.3-codex -e high -- --ask-for-approval never
```

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
