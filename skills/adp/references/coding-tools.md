Source: `cloudv2 apps/rpai/testdata/commands-snapshot.md` (`run`, `run claude`, `run codex`, `run agy`), `cloudv2 apps/rpai/internal/cmd/run/`, `adp-docs modules/connect/pages/coding-agents.adoc`, `modules/gateway/pages/connect-agent.adoc`. Full per-claim mapping and the dated verification log: the `references/rpk-ai.md` rows (now `cli.md` and `coding-tools.md`) of `SOURCES.md`.

# rpk ai run: Coding Tools Reference

## `run` subcommands

Routes a coding tool's model traffic through the AI Gateway for the active environment: the tool authenticates to the gateway, never directly to the upstream provider, and no upstream key is written to disk. `-L`/`-m` are command-local flags (not renamed under `rpk ai`); pass the tool's own flags after a literal `--`.

All three share `-L, --llmprovider` (the provider to route through), `-m, --model` (a model ID on the provider's allowlist) and `--api-key ask|yes|no` (see below). Each section lists only its own flags; confirm them with `rpk ai run <tool> --help`.

### The session credential is an ADP API key

**A sign-in token never authenticates the session itself.** Every `run` session authenticates to the gateway with an ADP API key (see `/redpanda:adp-governance`, *API keys*), so a long session keeps working after the sign-in that started it expires. Starting one still needs a valid sign-in, which `run` uses to read the provider and to create or check the key. There is **no fallback to the login token**: if no key can be obtained, the launch stops.

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
