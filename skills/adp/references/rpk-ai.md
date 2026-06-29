Source: `cloudv2/apps/rpai/internal/cmd/root.go` (subcommand tree lines 134-150, persistent flags lines 199-237, version subcommand lines 631-641), `cloudv2/apps/rpai/internal/auth` (token-resolver chain and OAuth device flow), `cloudv2/apps/rpai/internal/cmd/auth` (login, logout, token, status), `cloudv2/apps/rpai/internal/cmd/env` (add, list, use, show, rename, delete), `cloudv2/apps/rpai/testdata/commands-snapshot.md` (golden help output), `cloudv2/apps/rpai/internal/config/cloudenv.go` (config path lines 179-181), `cloudv2/apps/rpai/.goreleaser.yaml` (platforms, no FIPS build), `redpanda-data/redpanda/src/go/rpk/pkg/cli/ai/` (rpk-side install path and error messages). Evidence date: 2026-06-29.

# rpk ai CLI Reference

**Maturity: Beta.** The ADP product is generally available; the `rpk ai` CLI itself is Beta (all `rpk ai` reference pages in adp-docs carry `:page-beta: true`). The binary is in production use.

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

`rpk ai` is self-contained: it owns its own credentials and ADP environment selection rather than riding the active `rpk cloud` session. Sign in and pick a target:

```bash
rpk ai auth login              # OAuth device-authorization flow
rpk ai env list                # list local + live ADP environments
rpk ai env use <environment>   # select the ADP environment whose AI Gateway becomes the active target
rpk ai auth status             # show the current token state
```

`rpk ai auth login` runs the OAuth 2.0 device-authorization grant against Redpanda Cloud and caches the resulting credentials in `~/.rpai/credentials` (mode `0600`). `rpk ai env use <environment>` selects the ADP environment whose AI Gateway URL becomes the active dataplane target (this replaces the old `rpk cloud cluster select` step). `rpk ai env show` prints the resolved environment.

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
| `--rpai-profile` | `-p` | `RPAI_PROFILE` | (empty) | rpai profile name |
| `--rpai-config` | `-c` | `RPAI_CONFIG` | `$HOME/.rpai/config` | path to rpai config file |
| `--rpai-verbose` | `-v` | `RPAI_VERBOSE` | false | verbose debug logging to stderr |
| `--rpai-endpoint` | `-s` | **not bound to any env var** | `""` | override the selected environment's AI Gateway URL for this invocation |
| `--token` | (none) | `RPAI_TOKEN` | `""` | static bearer token override |
| `--format` | `-o` | `RPAI_FORMAT` | `table` | output format: `table`, `wide`, `json`, `yaml`, `markdown` |
| `--no-color` | (none) | `NO_COLOR` | false | disable colored output |

**Important:** `--rpai-endpoint` is intentionally NOT bound to a `RPAI_ENDPOINT` environment variable. The adp-docs pages incorrectly describe it as `(env: RPAI_ENDPOINT)`. The source code comment at `root.go:206-213` states this explicitly: binding it would silently override the ADP environment chosen via `rpk ai env use`. The correct behavior is that `--rpai-endpoint` only takes effect when passed as a flag for a single invocation.

Config default path: `$HOME/.rpai/config` (production). Non-production environments use `$HOME/.rpai_<env>/config` (for example, `$HOME/.rpai_integration/config`). Source: `apps/rpai/internal/config/cloudenv.go:179-181`.

## Top-level subcommand tree

Source: `root.go:134-150` (AddCommand calls), confirmed against `testdata/commands-snapshot.md:25-36`.

| Subcommand | Aliases | Notes |
|-----------|---------|-------|
| `agent` | `agents` | Manage ADP agents |
| `auth` | (none) | Authentication helpers |
| `connection` | `connections`, `conn` | Phase 1 stub; both subcommands print "coming soon" and exit 0 |
| `env` | `environment` | Manage rpai environments (replaces deprecated `profile`) |
| `llm` | `llm-provider`, `provider`, `lp` | Manage LLM provider configurations |
| `mcp` | `mcp-server` | Manage MCP servers |
| `model` | `models`, `m` | List available models |
| `oauth-client` | `oauth-clients`, `oc` | Manage OAuth clients |
| `oauth-provider` | `oauth`, `op` | Manage OAuth providers (canonical name is `oauth-provider`; `oauth` is an alias) |
| `run` | (none) | Run AI coding tools (Claude Code, Codex) through the AI Gateway |
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

Note: adp-docs currently publishes only `rpk-ai-agent.adoc` and `rpk-ai-agent-list.adoc`. The full subcommand tree above is confirmed from source but not all subpages are published.

## `auth` subcommands

Source: `internal/cmd/auth/cmd.go:18`. Subcommands: `login`, `logout`, `token`, `status`.

Not yet documented in adp-docs.

## `connection` subcommands (stub)

Source: `internal/cmd/connection/cmd.go:12`. Subcommands: `list`, `revoke`.

Both print "rpai connection: coming soon" and exit 0. This is a confirmed Phase 1 stub.

## `env` subcommands

Source: `internal/cmd/env/cmd.go:47`. Subcommands: `add` (aliases: `create`), `list`, `use`, `show`, `rename`, `delete`.

All subcommands work without a profile or config (`AnnotationSkipDeps: "true"`). The deprecated `profile` alias exists for one-release compatibility.

Not yet documented in adp-docs.

## `llm` subcommands

Aliases: `llm-provider`, `provider`, `lp`. Source: `internal/cmd/llm/cmd.go:20`.

Subcommands: `create`, `get`, `list`, `update`, `delete`, `check`, `apply`, `diff`

Key flags for `llm create`:

| Flag | Required | Description |
|------|----------|-------------|
| `--name string` | yes | LLM provider name |
| `--type string` | yes | Provider type: `openai`, `anthropic`, `google`, `bedrock` |
| `--display-name string` | no | Human-readable label |
| `--base-url string` | no | Override base URL |
| `--api-key-ref string` | no | Secret reference for the API key |
| `--models []string` | no | Allowed model list |
| `--enabled bool` | no | Default true |
| `--authorization-passthrough bool` | no | Anthropic enterprise/Max OAuth passthrough |
| `--bedrock-region string` | no | AWS region (Bedrock only) |
| `--bedrock-access-key-id-ref string` | no | Secret reference for AWS access key (Bedrock only) |

adp-docs publishes: `rpk-ai-llm.adoc` and CRUD subpages. `check`, `apply`, `diff` are not yet documented.

## `mcp` subcommands

Aliases: `mcp-server`. Source: `internal/cmd/mcp/cmd.go:37`.

Subcommands: `create`, `get`, `list`, `update`, `delete`, `types`, `tools`, `apply`, `diff`

**`tools` sub-group** (`mcp/tools.go:25`):
- `list <server>` -- flag: `--code-mode bool`
- `call <server> <tool>` -- flags: `--args string` (JSON), `--code-mode bool`

**`types`**: Lists available managed MCP server types.

adp-docs publishes CRUD subpages plus `tools`, `tools list`, `tools call`, and `types`. `apply` and `diff` are not yet documented.

## `model` subcommands

Aliases: `models`, `m`. Source: `internal/cmd/model/cmd.go:51`.

Subcommands: `list`, `get <name>`

adp-docs publishes `rpk-ai-model.adoc`, `rpk-ai-model-get.adoc`, `rpk-ai-model-list.adoc`.

## `oauth-client` subcommands

Aliases: `oauth-clients`, `oc`. Source: `internal/cmd/oauthclient/cmd.go:29`.

Subcommands: `create`, `get`, `list`, `delete`, `revoke-tokens`, `apply`, `diff`

**`dcr` sub-group** (`oauthclient/dcr.go:43`): `get`, `update`, `iat`, `mint`, `list`, `revoke <id>`

adp-docs publishes basic CRUD subpages. `revoke-tokens`, `dcr`, `apply`, `diff` are not yet documented.

## `oauth-provider` subcommands

Canonical name: `oauth-provider`. Aliases: `oauth`, `op`. Source: `internal/cmd/oauth/cmd.go:33`.

Subcommands: `create`, `get`, `list`, `update`, `delete`, `apply`, `diff`

adp-docs publishes CRUD subpages. `apply` and `diff` are not yet documented.

## `run` subcommands

Source: `internal/cmd/run/cmd.go:10`. Routes AI coding tool traffic through the rpai AI Gateway.

- `run claude [flags] [-- CLAUDE_ARGS...]` -- routes Claude Code through the AI Gateway
- `run codex [flags] [-- CODEX_ARGS...]` -- routes Codex through the AI Gateway

Not yet documented in adp-docs.

## Common errors

| Message | Cause | Fix |
|---------|-------|-----|
| `no token available (run rpai auth login)` | Not signed in (no cached credentials, no `--token`/`RPAI_TOKEN`) | Run `rpk ai auth login` |
| `is not a local environment and you are not logged in` | `env use <name>` with no matching local env and no credentials | Run `rpk ai auth login`, then `rpk ai env use <environment>` |
| ADP environment not ready (no AI Gateway URL) | Selected environment has no AI Gateway endpoint yet | Choose a ready environment with `rpk ai env list` / `rpk ai env use` |
| `The Redpanda AI CLI is already installed` | `install` without `--force` | Use `rpk ai upgrade` or add `--force` |
| `found a self-managed Redpanda AI CLI` | Binary outside `~/.local/bin` | Run `rpk ai uninstall && rpk ai install` |
