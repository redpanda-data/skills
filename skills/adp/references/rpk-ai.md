Source: `cloudv2 apps/rpai/testdata/commands-snapshot.md` (golden help, including the `rpk ai`-mode root help), `cloudv2 apps/rpai/internal/cmd/` (incl. `run/`, `secret/`, `docs/`), `apps/rpai/internal/{gitops,updatecheck,client}/`, `apps/rpai/.goreleaser.yaml` (platforms), `cloudv2 adp/RELEASE_NOTES.md` (shipped status), `redpanda/src/go/rpk/pkg/cli/ai/`, `adp-docs modules/cli/pages/index.adoc`, `modules/connect/pages/coding-agents.adoc`, `modules/control/pages/secrets.adoc`. Full per-claim mapping and the dated verification log: the `references/rpk-ai.md` rows of `SOURCES.md`.

# rpk ai CLI Reference

**Maturity:** The Agentic Data Plane is generally available, and so is the `rpk ai` CLI. Command groups and flags still change between releases, so confirm them with `--help` before relying on them.

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

**The CLI announces its own updates.** A background check, at most once a day, prints a notice on **stderr** naming a newer version and the command that upgrades it, including after a command that failed or printed help. It never delays a command, and it appears only when **both** stdout and stderr are terminals — so a script, a pipe, an `-o json` capture and an agent never see it — and never in continuous integration. `RPAI_NO_UPDATE_CHECK=1` turns it off.

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

**A sign-in is not a client credential.** It authenticates the management commands; the gateway's own traffic is authenticated by an **ADP API key** (see [API keys](governance.md#api-keys) and [The session credential is an ADP API key](#the-session-credential-is-an-adp-api-key)).

## Global flags (under `rpk ai`)

Running as an rpk plugin, some long flags are renamed to avoid colliding with rpk's own global flags. Short flags are unchanged.

| Flag | Short | Env var | Default | Description |
|------|-------|---------|---------|-------------|
| `--rpai-environment` | (none) | (none) | (empty) | Select a manual environment for this invocation; switch environments with `rpk ai env use` |
| `--rpai-config` | `-c` | `RPAI_CONFIG` | `$HOME/.rpai/config` | Path to the config file |
| `--rpai-verbose` | `-v` | `RPAI_VERBOSE` | false | One line per HTTP request on stderr: method, URL, response status, latency |
| `--rpai-endpoint` | `-s` | (none) | `""` | Override the selected environment's AI Gateway URL for this invocation |
| `--token` | (none) | (none; ambient `RPAI_TOKEN` is ignored under `rpk ai`) | `""` | Static bearer token override |
| `--format` | `-o` | `RPAI_FORMAT` | `table` | Output format: `table`, `wide`, `json`, `yaml`, `markdown` |
| `--no-color` | (none) | `NO_COLOR` | false | Disable colored output |

`--rpai-endpoint` has no environment-variable binding, so it can never silently override the environment chosen with `rpk ai env use`; it takes effect only when passed for a single invocation.

**`--rpai-verbose` logs requests, not payloads.** Every HTTP request the CLI makes gets one stderr line carrying the method, URL, response status, and latency — enough to see which endpoint a command called and how long it took. Request and response bodies, headers, and your bearer token never appear, so the output is safe to attach to a support ticket. `RPAI_VERBOSE` turns it on for the whole session; any value other than `0`, `false`, `no`, or `off` counts as on. The device-code exchange during `rpk ai auth login` is not logged.

## Top-level command tree

| Command | Aliases | Notes |
|---------|---------|-------|
| `agent` | `agents` | Manage agents (managed and self-managed) |
| `auditlog` | `audit-log`, `audit` | Read the audit log: `list`, `get` (read-only; see [observability.md](observability.md#read-the-audit-log-from-the-cli)) |
| `auth` | (none) | `login`, `logout`, `token`, `status` |
| `completion` | (none) | Generate a shell autocompletion script |
| `connection` | `connections`, `conn` | Manage your own OAuth connections: `list`, `revoke <provider-name>` |
| `docs` | (none) | Read the published ADP documentation from the terminal; needs no sign-in (see [`docs`](#docs-read-the-product-documentation)) |
| `env` | `environment` | Manage environments: `add`, `list`, `use`, `show`, `rename`, `delete` |
| `kill-switch-policy` | `kill-switch-policies`, `ksp`, `kill-switch` | Manage an agent's kill switch policies (see [`kill-switch-policy`](#kill-switch-policy-subcommands)) |
| `llm-provider` | `llm-providers`, `llm`, `provider`, `lp` | Manage LLM providers |
| `mcp-server` | `mcp-servers`, `mcp` | Manage MCP servers |
| `model` | `models`, `m` | Discover models in the catalog (read-only) |
| `oauth-client` | `oauth-clients`, `oc` | Manage OAuth clients |
| `oauth-provider` | `oauth-providers`, `oauth`, `op` | Manage OAuth providers |
| `policy` | `policies`, `pol` | Manage Cedar authorization policies |
| `run` | (none) | Launch Claude Code, Codex or Antigravity CLI routed through the AI Gateway |
| `secret` | `secrets`, `sec` | Manage the secrets other resources reference by ID (see [`secret`](#secret-subcommands)) |
| `trigger` | `triggers`, `agent-trigger` | Manage an agent's triggers (top-level, not under `agent`) |
| `version` | (none) | Print version and commit |

The canonical group names are `llm-provider` and `mcp-server`; `llm` and `mcp` remain aliases, so `rpk ai llm create …` and `rpk ai mcp tools list …` still work.

Newer releases keep adding groups, including ones for budgets, spending, traces and the agent network. Before you tell a user a task is UI-only, check `rpk ai --help`, and read that group's own `--help` instead of guessing its flags.

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

`create` takes the provider name as a **positional argument** and has no `--type` or `--name` flag. The provider type is selected by which provider-config flag group you set — `openai-config`, `anthropic-config`, `google-config`, `bedrock-config`, `openai-compatible-config` or `vertex-config` — and setting flags from two groups is an error. Provider-config flags carry the group as a dotted prefix (`--<group>.<field>`); there are no bare `--api-key-ref` or `--base-url` flags (an unknown flag error suggests the dotted spelling). Key flags:

| Flag | Description |
|------|-------------|
| `NAME` (positional) | LLM provider name |
| `--provider-models stringArray` | Model identifiers; repeatable, bare names (comma-split) or a JSON object. Empty allows all models. Replaces the full list on `update` |
| `--enabled` | True when set; `--enabled=false` to disable |
| `--<group>.api-key-ref string` (`openai-config`, `anthropic-config`, `google-config`, `openai-compatible-config`) | Secret-store reference for the API key; setting one selects that provider type. OpenAI and Anthropic need either a key or authorization passthrough; only `openai-compatible-config` may leave it empty for a no-auth endpoint |
| `--<group>.base-url string` (all six groups) | Override the default endpoint |
| `--<group>.authorization-passthrough` (`openai-config`, `anthropic-config`, `openai-compatible-config`) | Forward the caller's `Authorization` header upstream instead of a stored key (on Anthropic, enterprise/Max plan OAuth; on the OpenAI family, also the caller's `ChatGPT-Account-ID`); `=false` to disable. See [gateway-and-providers.md](gateway-and-providers.md#authorization-passthrough) |
| `--bedrock-config.region string` (alias `--region`) | AWS region; required within the Bedrock group |
| `--bedrock-config.static-credentials.access-key-id-ref` (alias `--access-key-id-ref`), `--bedrock-config.static-credentials.secret-access-key-ref` (alias `--secret-access-key-ref`) | Static AWS credentials; both required within their sub-group |
| `--bedrock-config.assume-role.role-arn` (alias `--role-arn`), `.external-id`, `.session-name` | STS assume-role credentials; `role-arn` required within its sub-group |
| `--bedrock-config.api-key.api-key-ref` | Secret-store reference for a Bedrock API key (no `Bearer` prefix); required within its sub-group, and exclusive with the other Bedrock credential modes |
| `--vertex-config.project`, `--vertex-config.location` | Google Cloud project and the single Vertex AI location the provider serves from (`global`, `us`/`eu`, or a region); both required within the Vertex group |
| `--vertex-config.credentials-json.credentials-json-ref` | Secret-store reference for the Google service-account key JSON; required within its sub-group |
| `--transcripts.record-input-messages`, `--transcripts.record-output-messages` | Transcript content capture; `=false` to disable |
| `--guardrail string` | Guardrail to attach |
| `--tags stringArray` | `key=value`, repeatable; replaces the full map on `update` |
| `-f, --filename string` | Manifest to create from (YAML or JSON; `-` for stdin). Flags override file values; `--dry-run` prints the request instead of sending it |
| `--pricing stringArray` | Per-model pricing override in USD per million tokens; repeatable. Also on `update` |

The CLI help for `--openai-config.api-key-ref` says it can be left empty for no-auth endpoints. That applies only to `openai-compatible-config`: an OpenAI provider needs an API key or authorization passthrough, and create is rejected otherwise.

Authorization passthrough is a flag on the `openai-config`, `anthropic-config` and `openai-compatible-config` groups; Google Gemini API, Vertex AI and Bedrock always use stored credentials. A new provider type or field shows up as a new flag group or dotted flag, not as a new value of a `--type` flag.

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

## `oauth-client` subcommands

Aliases: `oauth-clients`, `oc`.

Subcommands: `create`, `get`, `list`, `update`, `delete`, `revoke-tokens <name>`, `dcr`, `apply`, `diff`.

`revoke-tokens` revokes every refresh token issued under the client, forcing every user who connected it to sign in again; already-issued short-lived access tokens may keep working until they expire. It is idempotent.

**`dcr`** manages Dynamic Client Registration settings: `dcr get`, `dcr update`, and initial access tokens under `dcr iat` (`mint`, `list`, `revoke <id>`).

## `oauth-provider` subcommands

Aliases: `oauth-providers`, `oauth`, `op`. Subcommands: `create`, `get`, `list`, `update`, `delete`, `apply`, `diff`.

## `policy` subcommands

Aliases: `policies`, `pol`. Subcommands: `create`, `get`, `list`, `update` (Cedar body or metadata), `delete`, `apply`, `diff`. See [governance.md](governance.md).

`create` also takes `--agent <id>` and `--template readonly|sandboxed|standard|full`, which bind a policy to one agent in a single command. That is how you give a newly created agent its first policy, because none is written for it at create time. See [governance.md](governance.md#give-a-new-agent-access).

## `secret` subcommands

Aliases: `secrets`, `sec`. Subcommands: `create <id>`, `get <id>`, `list` (alias `ls`), `update <id>`, `delete <id>` (alias `rm`). Every verb takes the bare ID (`OPENAI_API_KEY`) or the `secrets/<id>` resource name. Secret values are **write-only**: no command prints one, and `get` and `list` return IDs, tags and audit fields only. For what a secret is, who may manage one, and when a rotated value takes effect, see [governance.md](governance.md#secrets).

```bash
printf %s "$OPENAI_API_KEY" | rpk ai secret create OPENAI_API_KEY --value-file=-   # stdin
rpk ai secret create GITHUB_TOKEN --value-file ./token.txt --tag team=ai
rpk ai secret update OPENAI_API_KEY --tag env=prod --remove-tag stale              # value kept
rpk ai secret list --tag team=ai
rpk ai secret delete OPENAI_API_KEY --etag <etag>
```

- **Write `--value-file=-`, with the equals sign, to read from stdin.** Under `rpk ai`, a bare `-` passed as a separate argument is dropped before it reaches the plugin, so `--value-file -` fails with an argument error instead of reading the pipe. This does not carry over to `rpk ai policy --cedar-file`, which takes a file path only and has no stdin mode: write the Cedar to a file, or pass it with `--cedar`.
- `--value` takes the value inline, which leaves it in your shell history and the process list; prefer `--value-file`. The two are mutually exclusive, and one trailing newline is stripped from a file or stdin.
- `update` changes only what you pass: omit the value to keep the stored one, `--tag KEY=VALUE` adds or overwrites a tag, `--remove-tag KEY` drops one. A tag change reads the secret first and writes the merged set fenced by the etag it read, so a concurrent edit fails the update rather than being overwritten. `delete` takes an optional `--etag`.
- `list` ANDs `--filter` (AIP-160 over `name`, `created_by`, `updated_by`, `created_at`, `updated_at`, `tags.KEY`, `tags:KEY`) with `--tag`, then `--name-contains` narrows to IDs holding that substring, case-insensitively.
- **Delete does not check references.** An LLM provider, MCP server, OAuth client, trigger or agent that still names the secret keeps its reference and fails at its next call. Repoint those first.

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

## `kill-switch-policy` subcommands

Aliases: `kill-switch-policies`, `ksp`, `kill-switch`. Subcommands: `create <name> --parent agents/<agent>`, `get`, `list --parent agents/<agent>` (the parent is required), `update`, `delete`. A policy belongs to one agent and watches one signal (`--spec.signal guardrail-block-rate|datapolicy-deny-rate|evaluation-error-rate`) with *Burst* (`--spec.burst.threshold`, `--spec.burst.confidence 95|99|999`) or *Drift* (`--spec.drift.baseline`, `.slack`, `.threshold`) detection. `--spec.mode shadow` is the UI's **Observe** and `enforce` its **Enforce**. `create` and `update` take `-f` and `--dry-run` like other groups. For what containment does and who may manage it, see [governance.md](governance.md#kill-switch).

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

Routes a coding tool's model traffic through the AI Gateway for the active environment: the tool authenticates to the gateway, never directly to the upstream provider, and no upstream key is written to disk. `-L`/`-m` are command-local flags (not renamed under `rpk ai`); pass the tool's own flags after a literal `--`.

All three share `-L, --llmprovider` (the provider to route through), `-m, --model` (a model ID on the provider's allowlist) and `--api-key ask|yes|no` (see below). Each section lists only its own flags; confirm them with `rpk ai run <tool> --help`.

### The session credential is an ADP API key

**A sign-in token never authenticates the session itself.** Every `run` session authenticates to the gateway with an [ADP API key](governance.md#api-keys), so a long session keeps working after the sign-in that started it expires. Starting one still needs a valid sign-in, which `run` uses to read the provider and to create or check the key. There is **no fallback to the login token**: if no key can be obtained, the launch stops.

`--api-key` chooses the behavior on all three subcommands: `ask` (the default) asks before creating a key, `yes` creates one without asking — use it where nothing can answer a prompt, such as a script or an IDE task — and `no` requires a key you already provided with `--token`.

- The first launch in an environment creates a key valid for **30 days**, named after the command and your hostname, stored beside the `rpk ai` credentials and keyed by organization and environment. A later launch reuses it until the last tenth of its lifetime (three days of a 30-day key), then replaces it, as it does a key that expired or no longer exists. A replaced key stays valid until it expires, so a session still running on it is not cut off.
- The key a running session uses is **pinned** to the organization and environment you launched in, so `rpk ai env use` or signing in to another organization does not change it. If a different sign-in replaces the stored key mid-session, the session stops and asks you to restart it rather than carrying on as that other user.
- `--token` on a `run` command accepts **only an API key** (`rpadp_…`), not a sign-in token; such a launch uses that key and never creates one.
- ADP issues keys only to users who sign in directly, so a **service account cannot start a session**; creating one needs the *Sandboxed* template or above. Configure a CI runner or application with OIDC client credentials instead.
- An environment whose auth mode is `none` keeps its no-auth behavior for `run claude` / `run codex`; `run agy` requires a key regardless.

### `run claude [flags] [-- CLAUDE_ARGS...]`

Launches Claude Code with `ANTHROPIC_BASE_URL` pointed at the gateway for the chosen provider. Works against **anthropic, bedrock and vertex** LLM providers. It runs in your real Claude Code config home (trust, onboarding, theme and MCP servers apply) and writes nothing into it.

Omit `-m` for Claude Code's default; on Bedrock pass an inference-profile ID (e.g. `us.anthropic.claude-sonnet-4-6`). Own flags: `--passthrough` and `--bedrock` force that mode, needed only with invoke-only access, when the provider can't be read to detect it (`--passthrough` is anthropic-only); `--claude-config-dir` runs against that `CLAUDE_CONFIG_DIR` instead of your real config home (never written to); `--print-settings` prints the generated settings and launch environment, then exits.

Modes:
- **Managed (API key)**: the gateway credential helper is passed through `claude --settings` as a JSON overlay, merged on top of your settings; `~/.claude/settings.json` is untouched.
- **Passthrough**: your existing subscription login stays in `Authorization` and is relayed upstream unchanged; the launch sets only the gateway base URL and the session's API key in the `X-Redpanda-Api-Key` header. That header is inherited by Claude Code's tool subprocesses. Tokens bill against your subscription seat, not as API usage.
- **Bedrock**: the gateway signs the upstream call with the provider's AWS credentials, so no AWS credentials reach your machine; passthrough does not apply, and `--passthrough` on a Bedrock provider is an error. If the provider's allowlist lacks Claude Code's background (small/fast) model, export `ANTHROPIC_SMALL_FAST_MODEL` with an allowlisted ID.
- **Vertex**: Claude Code runs in its native Vertex mode against the provider's own project and location, which the launch reads off the provider — so a Vertex provider needs **read** access (`dataplane_adp_llmprovider_get`), not only invoke access, and no flag substitutes for it. With invoke-only access the launch warns, falls back to the managed Anthropic shape, and the gateway rejects the first request. The gateway signs the upstream call with the provider's service account, so no Google credentials are needed locally. Passthrough does not apply, and `--passthrough` on a Vertex provider is an error. Pass `-m` a Claude model the provider allows.

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

Launches the OpenAI Codex CLI with a throwaway `CODEX_HOME` pointed at the gateway's OpenAI-compatible Responses endpoint, authenticated with the session's ADP API key. Your own `~/.codex` is never read or modified, and no key is written to `config.toml`. Works against **openai and openai_compatible** providers only.

`-L` is required; omit `-m` for Codex's default. Own flags: `-e, --effort minimal|low|medium|high` (omit for Codex's default); `--codex-home` for a persistent `CODEX_HOME` (default a throwaway temp dir; `~/.codex` is refused; its `config.toml` is regenerated each run); `--no-auto-trust` to skip pre-trusting the launch directory (default: auto-trusted under a workspace-write sandbox); `--print-config` to print the generated `config.toml` and exit.

`run codex` does **not** set up ChatGPT/Codex *subscription* passthrough. Configure that yourself: create the provider with `--openai-config.authorization-passthrough` (or the `openai-compatible-config` equivalent) and set that group's `base-url` to `https://chatgpt.com/backend-api/codex`, then configure Codex by hand so it sends the subscription token in `Authorization` and the ADP API key in `X-Redpanda-Api-Key`. See [gateway-and-providers.md](gateway-and-providers.md#authorization-passthrough).

```bash
rpk ai run codex -L openai -m gpt-5.3-codex -e high -- --ask-for-approval never
```

### `run agy [flags] [-- AGY_ARGS...]`

Launches **Antigravity CLI** (`agy`), Google's command-line coding assistant, against a **google or vertex** provider. Requires **agy 1.3.5 or newer**; an older or unparseable version is refused before a key is created, rather than falling back to your personal Google sign-in. The session runs against a throwaway settings directory, so your own Antigravity CLI settings are neither read nor changed, and the launch clears the Google and Vertex credential variables from the session environment.

`-L` names an enabled Google or Vertex provider. `-m` takes a Gemini model the provider allows and has **no default**: omit it and pick a model in Antigravity CLI before the first prompt. Own flags: `-e, --effort low|medium|high|xhigh|max` (requires `-m`); `--print-config` prints the isolated Antigravity settings and exits (no gateway call, no credential).

- **Read access is always required**, unlike `run claude`: the launch reads the provider every time to check its type and models, so invoke-only access cannot start a session.
- **The model is checked before launch.** It must be a Gemini model on the provider's allowlist — embedding models, Claude models on a Vertex provider, and a provider with no Gemini model are all refused, so a Claude-only Vertex provider cannot serve this command. A Vertex provider also needs a configured project and location; the gateway signs the upstream call over its Gemini-compatibility route, so no Google credentials or ADC are needed locally.
- Set the model and effort with `-m` / `-e`, not with Antigravity CLI's own flags; only the native flags the launch supports pass through after `--`, and the gateway still enforces the allowlist.

```bash
rpk ai run agy -L <gemini-provider> -m <gemini-model>
rpk ai run agy -L <gemini-provider> -m <gemini-model> -e medium -- -p "Summarize this repository"
```

## Exit codes

Branch on the exit code rather than parsing messages:

| Code | Meaning |
|---|---|
| `0` | Success. An A2A task left waiting for more input also exits `0` |
| `1` | Any other failure: a usage error, an unreachable gateway, a rejected request, a resource that does not exist |
| `3` | The call was not authenticated or not authorized — credentials missing or expired, or an identity the gateway refuses |
| `4` | An A2A task ended failed, canceled, or rejected. The call itself worked, so this is the task's own outcome rather than a transport error |

Separating `3` from `1` is what lets a scheduled job re-authenticate instead of treating an expired token as a broken command: on `3`, run `rpk ai auth login` and retry. A second `3` after a fresh login is a permissions problem, not a credentials problem — re-authenticating again will not help; map the refused operation to its permission and grant it (see [governance.md](governance.md#roles-and-permissions)).

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
