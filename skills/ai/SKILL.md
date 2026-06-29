---
name: adp
description: >-
  Expert guide for Redpanda's Agentic Data Plane (ADP): the managed platform on
  Redpanda Cloud for building, running, and governing AI agents and MCP servers.
  Use when: creating or managing ADP AI agents (managed or self-managed) via
  rpk ai agent or the AgentRegistryService API; configuring MCP servers on ADP
  (remote or managed catalog types, code mode, auth variants); setting up LLM
  providers or querying available models via rpk ai llm / rpk ai model or the
  LLMProviderService / ModelService API; working with the AI Gateway proxy
  (provider config, per-provider URLs, credential injection); configuring
  budgets, guardrails, or Cedar access-control policies via the governance APIs
  (BudgetService, GuardrailService, PolicyService); reading agent transcripts or
  spending insights via TranscriptsService or InsightsService; running rpk ai
  (install, upgrade, agent, mcp, llm, model, oauth-client, oauth-provider, run);
  wiring OAuth clients or providers to the aigw Authorization Server; or
  understanding what ADP does and does not provide (routing/rate limits are out
  of scope). For the separate rpk cloud mcp control-plane MCP server, see
  /redpanda:rpk-cloud.
---

# ADP: Agentic Data Plane

The Agentic Data Plane (ADP) is the AI-native layer of Redpanda Cloud. It provides a managed runtime for AI agents and MCP servers, a proxying AI Gateway for LLM providers, and governance surfaces (budgets, guardrails, Cedar access-control policies) to operate those workloads safely. This skill is written for an AI agent operating ADP programmatically via `rpk ai` and the ADP API or MCP tools. Optimize for correct field names and service names; confirm the live surface before acting.

## Component overview

### AI agents (Beta)

Managed agents run inside the ADP platform. Self-managed (user-hosted) agents are registered as metadata-only records. Both are managed through `AgentRegistryService` (proto) or the `AIAgentService` MCP tool group (v1alpha3). Key fields: `model`, `llm_provider`, `system_prompt`, `max_iterations` (0-200), `mcp_servers` (max 32 refs), `subagents` (max 16). A2A agent cards are published at `/.well-known/agent-card.json`. Triggers (Teams, Cron) fire agents on external events.

See [references/agents.md](references/agents.md).

### MCP servers (Beta)

Each MCP server is either `REMOTE` (you own the upstream) or `MANAGED` (a pre-integrated catalog entry). The managed catalog covers 7 categories (AI, AWS, Communication, Database, Google, Streaming, Utility) with 44+ types; use `ListManagedMCPTypes` for the live list. Enabling `code_mode` on a server adds `{name}_search` and `{name}_execute` tools, reducing token usage by 80-90% for large tool sets. Two API layers exist: `adp.v1alpha1.MCPServerService` (management plane, 7 RPCs) and `dataplane.v1alpha3.MCPServerService` (public Cloud API, 9 RPCs including Start/Stop/Lint). Knowledge bases are a separate `v1alpha3` resource, not a sub-resource of MCP servers.

See [references/mcp-servers.md](references/mcp-servers.md).

### AI Gateway and LLM providers (Beta)

The AI Gateway is a managed HTTP proxy. It stores upstream API keys in the Redpanda secret store and injects them on outbound requests; calling applications never see the raw keys. Per-provider URL pattern: `<gateway-base>/llm/v1/providers/<provider-name>/<upstream-path>`. Manage providers via `LLMProviderService` (CreateLLMProvider, UpdateLLMProvider, CheckConnection) and discover available models via `ModelService` (ListModels, GetModel). Supported provider types: OpenAI, Anthropic, Google/Gemini, AWS Bedrock, OpenAI-compatible. Pricing overrides use microcents per million tokens on the `provider_models` field.

**Out of scope:** routing/failover, cross-provider load balancing, and per-second/minute/day rate limits are explicitly not part of the AI Gateway. To cap spend rather than request rate, use budgets.

See [references/gateway-and-providers.md](references/gateway-and-providers.md).

### Governance: budgets, guardrails, and policies (Experimental)

- **Budgets** (`BudgetService`): per-agent or tenant-wide spend caps. All cost fields use microcents (`limit_microcents`, `warn_at_microcents`). No `limit_cents` or `current_spend_cents` fields exist.
- **Spending analysis** (`SpendingService`): GetSpendingSummary, GetSpendingTimeSeries, GetSpendingBreakdown, GetSpendingTimeSeriesByDimension. `start_time` and `end_time` are required.
- **Guardrails** (`GuardrailService`): Bedrock-backed content safety. Six content filter categories: `hate`, `insults`, `sexual`, `violence`, `misconduct`, `prompt_attack`. Word filters, denied topics, PII filters, and grounding policies are additional sub-policies. Provider is always AWS Bedrock.
- **Access control** (`PolicyService`, `PolicyTemplateService`, `SystemPolicyService`, `EffectivePolicySetService`): Cedar policy dialect. No `ValidatePolicy`, `EvaluateAccess`, or `ListPolicyVersions` RPCs exist.
- **OAuth / identity** (`OAuthClientService`, `OAuthProviderService`, `OAuthConnectionService`): manage OAuth clients (for external tools calling the aigw Authorization Server) and OAuth providers (third-party identity sources).

Services absent from the ADP v1alpha1 surface: `SpendLimitService`, `RateLimitService`, `RoutingService`, `BackendPoolService`, `AccessControlService`, `AuditService` (OCSF), `SSOService`. The names exist only in the legacy `aigateway/v1` generated tree used by `rpk cloud mcp`.

See [references/governance.md](references/governance.md).

### Observability: transcripts and insights

- **TranscriptsService** (Stable): `ListTranscripts`, `GetTranscript`. Conversations are grouped by OTel `gen_ai.conversation.id`. `TranscriptSummary` includes token counts and `estimated_cost_usd`. Supports managed and self-managed (BYOA) agents.
- **InsightsService** (Experimental): single `GetInsights` RPC returning `active_agents`, `total_requests`, `total_cost_microcents` over a time window. May change or be removed without a version bump.

There is no `AuditService` in the ADP public API. For request/response accountability, use `TranscriptsService`.

See [references/observability.md](references/observability.md).

## Operating ADP: CLI and API

The primary CLI is `rpk ai` (binary: `rpai`). It is a first-class command, not a third-party add-on. Manage the binary lifecycle with `rpk ai install`, `rpk ai upgrade`, `rpk ai uninstall`. There is no FIPS build of `rpai`.

Top-level subcommands: `agent`, `auth`, `connection` (stub), `env`, `llm`, `mcp`, `model`, `oauth-client`, `oauth-provider`, `run`, `version`.

Programmatic access uses the ADP API directly (gRPC/Connect) or via the ADP MCP tools exposed on the cluster.

See [references/rpk-ai.md](references/rpk-ai.md).

## Auth model

`rpk ai` authenticates via the active rpk cloud profile. Authenticate first:

```bash
rpk cloud login
rpk cloud cluster select   # select the cluster with an AI Gateway
rpk ai agent list          # now works
```

`rpk` injects `RPAI_TOKEN` (from the active cloud profile) and the AI Gateway endpoint before running the rpai binary. To override the endpoint for a single invocation, pass `--rpai-endpoint <url>`. This flag is intentionally not bound to a `RPAI_ENDPOINT` environment variable.

The ADP API uses OIDC user identity or service accounts for machine-to-machine access. Confirm available auth flows via `rpk ai auth --help`.

## Discover the live surface

Before acting on ADP, confirm the live API surface. Reference files document a point-in-time snapshot; the catalog and field defaults evolve:

```bash
# Confirm all rpk ai subcommands and global flags
rpk ai --help

# Per-group help
rpk ai agent --help
rpk ai mcp --help
rpk ai llm --help
rpk ai model --help

# Discover managed MCP catalog types
rpk ai mcp types

# List tools on a specific MCP server
rpk ai mcp tools list <server-name>

# List available models (optionally filter by provider type)
rpk ai model list
```

When using ADP MCP tools: list the available tools for the target service, then describe the tool before calling it to confirm current field names.

## Key patterns and gotchas

- **Cost unit is microcents throughout.** `limit_microcents`, `warn_at_microcents`, `total_cost_microcents`: 1 cent = 1,000,000 microcents; $1.00 = 100,000,000 microcents. Never use `limit_cents`.
- **Static-key auth field is `key_secret_ref`.** Some earlier docs called it `key_ref`. The proto (`auth.proto:26`) is authoritative: `key_secret_ref`.
- **Guardrail content filter has 6 categories, not 14.** The 14-category taxonomy (`violent_crimes`, etc.) is an RFC draft; the shipped API has `hate`, `insults`, `sexual`, `violence`, `misconduct`, `prompt_attack`.
- **Routing and rate limits do not exist in the ADP AI Gateway.** The docs explicitly call these out of scope. Do not attempt to configure `RoutingService`, `BackendPoolService`, or `RateLimitService` via ADP; those are legacy `aigateway/v1` names.
- **A2A agent card path.** The canonical path is `/.well-known/agent-card.json`. There is no bare `/agent.json` route.
- **`subagents.mcp_servers` is independent, not a subset.** Each subagent's `mcp_servers` list is independent of the parent agent's list; a subagent may reference servers the parent does not.
- **`tools` field does not exist on `ManagedAgentSpec`.** Agents access tools through `mcp_servers` references only. The `tools` field is on `mcp_server.proto`.
- **MCP tool name truncation.** The MCP protocol enforces a 64-character limit on tool names. ADP truncates long managed-catalog names with a hash prefix while preserving the method suffix.
- **No `RPAI_ENDPOINT` env var.** `--rpai-endpoint` is flag-only and applies to one invocation only. Binding it to an env var would silently override the selected ADP environment.
- **`connection` subcommand is a stub.** `rpk ai connection list` and `rpk ai connection revoke` print "coming soon" and exit 0.

## Control-plane MCP server

For the `rpk cloud mcp` control-plane server (manages Redpanda Cloud clusters, networks, IAM, and legacy AI Gateway `aigateway/v1` surfaces), see /redpanda:rpk-cloud.

## Reference files

- [references/agents.md](references/agents.md): `AgentRegistryService` RPCs, `ManagedAgentSpec` fields, subagents, A2A agent card, triggers, agent credentials.
- [references/mcp-servers.md](references/mcp-servers.md): `MCPServerService` API layers, `MCPServer` fields, remote auth modes, code mode, managed catalog, knowledge bases.
- [references/gateway-and-providers.md](references/gateway-and-providers.md): `LLMProviderService` RPCs, provider types and auth schemes, `ModelService`, pricing overrides, AI Gateway proxy behavior, explicit out-of-scope list.
- [references/governance.md](references/governance.md): `BudgetService`, `SpendingService`, `GuardrailService` (Bedrock, 6 categories), Cedar access-control services, OAuth/identity services, absent service names.
- [references/rpk-ai.md](references/rpk-ai.md): `rpk ai` subcommand tree, lifecycle management, global flags, common errors, per-group subcommand details.
- [references/observability.md](references/observability.md): `TranscriptsService` RPCs and fields, `InsightsService` (Experimental), accountability framing, no AuditService in ADP.
