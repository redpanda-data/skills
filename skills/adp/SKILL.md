---
name: adp
description: >-
  Redpanda's Agentic Data Plane: governance infrastructure for building, running,
  and governing AI agents and MCP servers behind a credential-injecting AI Gateway for
  LLM providers, operated through the `rpk ai` CLI and the ADP UI at ai.redpanda.com.
  Use when creating or managing managed or self-managed AI agents and their triggers
  with `rpk ai agent` and `rpk ai trigger`, configuring remote or managed MCP servers
  with `rpk ai mcp-server` (including code mode and user-delegated OAuth), setting up
  LLM providers or discovering models with `rpk ai llm-provider` and `rpk ai model`,
  writing Cedar access policies with `rpk ai policy`, or working with budgets,
  guardrails, cost reporting, transcripts, and the audit log in the ADP UI. For the
  separate rpk cloud mcp control-plane MCP server, see `/redpanda:rpk-cloud`.
---

# Agentic Data Plane

The Agentic Data Plane (ADP) is Redpanda's governance infrastructure for AI agents and MCP servers. It provides a managed runtime for AI agents and MCP servers, an AI Gateway that proxies LLM provider traffic, and governance controls (budgets, guardrails, Cedar access policies, data policies) to operate those workloads safely.

**How to operate it.** ADP has two supported operator surfaces: the **`rpk ai` CLI** and the **ADP UI** (ai.redpanda.com). Applications and agents then call the endpoints ADP exposes: the AI Gateway's per-provider LLM URLs, each MCP server's URL, and each agent's A2A endpoint. Operate ADP with `rpk ai`, and send the user to the UI for tasks the CLI does not cover. Confirm the live surface with `--help` before acting.

**Maturity.** The Agentic Data Plane is generally available. The `rpk ai` CLI is in Preview. Individual features carry their own markers where the product docs state them; for example, guardrails, data policies, and MCP output format are Preview. Each reference file names these markers.

## Where each task lives

| Task | CLI | UI |
|---|---|---|
| Agents (managed and self-managed), credentials, A2A | `rpk ai agent` | Agents |
| Agent triggers (Microsoft Teams, cron schedule) | `rpk ai trigger` | Agent → Triggers tab |
| MCP servers, managed catalog, tool listing and calls | `rpk ai mcp-server` | MCP servers |
| LLM providers, connection test, pricing overrides | `rpk ai llm-provider` | LLM providers |
| Model catalog | `rpk ai model` | LLM provider → Models tab |
| Cedar access policies | `rpk ai policy` | Access (when enabled for your organization) |
| Roles and permissions (RBAC) | role bindings via `/redpanda:rpk-cloud` | Access → Roles (read-only view) |
| Data policies on an MCP server | `rpk ai mcp-server create/update --data-policies` | MCP server → Data Policies tab |
| OAuth clients (inbound) and providers (outbound) | `rpk ai oauth-client`, `rpk ai oauth-provider` | Integrations setup |
| Your own OAuth connections | `rpk ai connection` | Connections |
| Budgets, cost and usage, guardrail authoring | none | Budgets, Cost and usage, Guardrails |
| Transcripts | `rpk ai agent transcript` | Agent → Transcripts |
| Audit log, agent network, conversation sessions | none | Audit log, Agents → Agent network, Agent Playground history |
| Coding tools through the gateway | `rpk ai run claude`, `rpk ai run codex` | — |

## Components

### AI agents

A **managed** agent runs on ADP: you configure a model, an LLM provider, a system prompt, MCP servers, and optional subagents. A **self-managed** agent (`rpk ai agent create --self-managed`) is a metadata-only record for an agent you host yourself. Richer spec fields (subagents, reasoning effort, agent card) go in a manifest applied with `rpk ai agent apply -f` or `--spec-file`. Agents publish an A2A agent card at `/.well-known/agent-card.json`, and `rpk ai agent a2a` talks to a running agent. Triggers fire an agent from Microsoft Teams or on a cron schedule, and can be paused and resumed without losing their configuration or run history.

See [references/agents.md](references/agents.md).

### MCP servers

Each MCP server is either **remote** (you own the upstream and pick an auth mode) or **managed** (a pre-integrated catalog type). The catalog changes, so list it live with `rpk ai mcp-server types` rather than assuming it. **Code mode** serves a second `-code` endpoint that exposes just `search` and `execute` tools in place of the full tool list, which cuts tokens for servers with many tools. **Output format** (Preview) can re-encode tabular tool results into a denser form. **Data policies** (Preview) mask, drop, or clamp data in tool calls before the model sees it.

See [references/mcp-servers.md](references/mcp-servers.md).

### AI Gateway and LLM providers

The AI Gateway is a managed HTTP proxy. It stores upstream credentials in the Redpanda secret store and injects them on outbound requests, so calling applications never see raw keys. Per-provider URL: `<gateway-base>/llm/v1/providers/<provider-name>/<upstream-path>`. Manage providers with `rpk ai llm-provider`, and discover models with `rpk ai model list`. Provider types include OpenAI, Anthropic, Google, AWS Bedrock, and OpenAI-compatible endpoints; confirm the current set with `rpk ai llm-provider create --help`.

**Scope:** the gateway injects credentials. It does not do routing, failover, cross-provider load balancing, or request rate limiting. To cap spend, use budgets.

See [references/gateway-and-providers.md](references/gateway-and-providers.md).

### Governance

- **Budgets** (UI): per-agent spend caps over a daily, weekly, or monthly period, with a warning threshold. A capped agent's LLM calls get `HTTP 429` until the period resets.
- **Cost and usage** (UI): spend and token reporting, groupable by cost-allocation tags taken from agent tags.
- **Guardrails** (Preview; UI to author, `rpk ai llm-provider update --guardrail` to attach): content safety backed by AWS Bedrock Guardrails. Policy types are content filters, word filters, denied topics, sensitive information (PII), contextual grounding, and automated reasoning.
- **Access policies** (`rpk ai policy`, UI): Cedar policies that decide *whether* a call runs.
- **Roles and permissions**: every operation checks one fine-grained permission (`dataplane_adp_*`, `dataplane_aigateway_*`). Among built-in roles only Admin carries ADP permissions; everyone else gets access through policies, which name action IDs such as `Action::"LLMProvider.invoke"`, not permission strings.
- **Data policies** (Preview): shape *what data* a permitted MCP call exposes, and to whom.
- **OAuth**: inbound clients (including Dynamic Client Registration), outbound providers, and per-user connections.

See [references/governance.md](references/governance.md).

### Observability

- **Transcripts** (`rpk ai agent transcript list|get`, UI): what an agent did in a conversation: turns, tool calls, models, timing.
- **Audit log** (UI): who was allowed or refused what across ADP, which policy decided, and on whose behalf an agent acted.
- **Home, Agent network, Playground history** (UI): headline metrics, agent-to-resource topology, and per-agent conversation sessions.

See [references/observability.md](references/observability.md).

## Auth model

`rpk ai` owns its own credentials and ADP environment selection. It does not ride the `rpk cloud` session.

```bash
rpk ai auth login             # OAuth device-authorization flow; always runs a fresh grant
rpk ai env list               # list local and live ADP environments
rpk ai env use <environment>  # select the environment whose AI Gateway becomes the target
rpk ai agent list             # now works
```

`rpk ai auth status` shows token state; `rpk ai env show` prints the resolved environment. For headless use, pass `--token <bearer>`. Under `rpk ai` an ambient `RPAI_TOKEN` environment variable is **ignored**. To override the gateway endpoint for one invocation, pass `--rpai-endpoint <url>`; it is flag-only. Define a local gateway with `rpk ai env add <name> --ai-gateway-url <url> --auth-mode none`.

See [references/rpk-ai.md](references/rpk-ai.md).

## Discover the live surface

Reference files are a point-in-time snapshot. Command groups, catalogs, and defaults change, so confirm live:

```bash
rpk ai --help                          # top-level command tree and global flags
rpk ai agent --help
rpk ai mcp-server --help
rpk ai llm-provider --help
rpk ai mcp-server types                # managed MCP catalog
rpk ai mcp-server tools list <server>  # tools on one server
rpk ai model list                      # model catalog (optionally --provider-type)
```

`llm-provider` and `mcp-server` are the canonical group names; `llm` and `mcp` still work as aliases. For feature and version history, read the ADP product documentation rather than relying on this skill.

## Key patterns and gotchas

- **Use `rpk ai` or the UI.** When a task has no CLI command (budgets, cost reporting, guardrail authoring, the audit log), direct the user to the UI instead of inventing a command. There is no `rpk ai budget`, `rpk ai spending`, or `rpk ai guardrail`.
- **Cost unit.** The UI shows dollars. Raw cost values in manifests or `-o yaml` output are **USD microcents** ($1 = 100,000,000 microcents). Never treat them as cents.
- **Creating an LLM provider turns transcript content capture ON.** If the create does not mention transcripts, prompts and completions are recorded verbatim. To opt out, pass `--transcripts.record-input-messages=false --transcripts.record-output-messages=false` (or set them in the manifest). Existing providers are not changed. See [gateway-and-providers.md](references/gateway-and-providers.md#transcript-recording-defaults-to-on).
- **A passthrough provider takes two credentials and cannot be health-checked.** With authorization passthrough, the caller's upstream credential goes in `Authorization` and the Redpanda Cloud token in `X-Redpanda-Cloud-Token`. On OpenAI-family providers, a call without the gateway header is refused with **HTTP 400**, and an upstream redirect becomes **HTTP 502**. A connection check reports it as not configured, which is expected; don't gate a create on it. See [gateway-and-providers.md](references/gateway-and-providers.md#authorization-passthrough).
- **Agent writes are model-checked.** Create and update reject a model the provider type does not know, and on Bedrock also a model not enabled on the provider. OpenAI-compatible providers are not model-checked. See [agents.md](references/agents.md#write-time-validation).
- **Reasoning effort is a provider-owned string, validated per model.** Set `reasoning.effort` in the agent manifest using the exact spelling the model catalog lists for every model the agent and its subagents use. Never assume a level exists, and leave it unset on OpenAI-compatible providers. See [agents.md](references/agents.md#reasoning-effort).
- **Subagent MCP servers are independent.** A subagent's MCP server list is not a subset of its parent's, and agents reach tools only through MCP server references.
- **Code mode is a separate endpoint.** The primary server URL is unchanged. The `-code` URL exposes only `search` and `execute`. Code mode is per server; it does not combine servers.
- **Output format fails open and applies to the whole server.** Results that can't be losslessly re-encoded are forwarded unchanged, and an opted-in server's tool list drops `outputSchema`. Never treat the encoded form as a guaranteed wire format.
- **A `user_oauth` MCP server's tool list is not proof of access.** A caller with no connection can still open a session and list tools. The first tool call returns a result whose **text** carries the sign-in URL; read it from there, not from an error status. A tool list that fails *hard* is a configuration or infrastructure problem, not a missing connection. See [mcp-servers.md](references/mcp-servers.md#what-a-caller-without-a-connection-can-do-user_oauth).
- **A per-user Slack connection can still act as the bot.** The acting identity comes from the OAuth provider's Slack token type, not from who owns the connection. Only a user-typed provider acts as the person who authorized. The setting can't be changed after creation, so serving both identities needs two providers. See [governance.md](references/governance.md#slack-whose-identity-the-connection-acts-as-slack_token_type).
- **The audit log records calls, not MCP session traffic.** MCP session setup and keep-alive messages are recorded only when denied or errored. Never count sessions, or conclude that no session happened, from the audit log.
- **A GitOps manifest is the complete desired state.** `rpk ai <group> apply` / `diff` compare every writable field. A field left out of the manifest is compared as its empty value, so removing it from the manifest counts as drift; it does not mean "leave it alone". Start from `get -o yaml`. Neither command prunes resources missing from the manifests. See [rpk-ai.md](references/rpk-ai.md#gitops-apply-and-diff).
- **`connection` manages your own OAuth grants.** `rpk ai connection list` / `revoke <provider>` act only on your connections. Connections are created through the browser consent flow, not the CLI.

## Control-plane MCP server

For the `rpk cloud mcp` control-plane server, which manages Redpanda Cloud clusters, networks, and IAM, see /redpanda:rpk-cloud.

## Reference files

- [references/agents.md](references/agents.md): agent commands, managed agent spec, validation, reasoning effort, subagents, A2A, sessions, credentials, triggers.
- [references/mcp-servers.md](references/mcp-servers.md): MCP server commands and fields, remote auth modes, `user_oauth` behavior, code mode, output format, data policies, managed catalog.
- [references/gateway-and-providers.md](references/gateway-and-providers.md): provider management, provider types and credentials, connection tests, failed-call investigation, transcript capture default, authorization passthrough, models, pricing overrides, gateway scope.
- [references/governance.md](references/governance.md): budgets, cost and usage, guardrails, Cedar access policies, roles and permissions, data policies, OAuth clients, providers, and connections.
- [references/observability.md](references/observability.md): transcripts (CLI and UI), audit log, and other monitoring views.
- [references/rpk-ai.md](references/rpk-ai.md): `rpk ai` install and lifecycle, authentication, global flags, command tree, per-group details, GitOps `apply`/`diff`, `run claude` / `run codex`, common errors.
