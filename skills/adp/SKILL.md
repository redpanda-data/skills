---
name: adp
description: >-
  Redpanda's Agentic Data Plane: governance infrastructure for building, running,
  and governing AI agents and MCP servers, plus a proxying AI Gateway for LLM providers,
  operated via `rpk ai` and the ADP API. Use when creating or managing AI agents (managed
  or self-managed) via `rpk ai agent` or `AgentRegistryService`; configuring MCP servers
  (remote or managed catalog, code mode, auth); setting up LLM providers or querying
  models via `rpk ai llm`/`rpk ai model` or the AI Gateway proxy; or configuring budgets,
  guardrails, or Cedar access-control policies through the governance APIs. Also covers
  reading agent transcripts and spending insights, and wiring OAuth clients or providers
  to the aigw Authorization Server. For the separate rpk cloud mcp control-plane MCP
  server, see `/redpanda:rpk-cloud`.
---

# Agentic Data Plane

The Agentic Data Plane is Redpanda's governance infrastructure for AI agents and MCP servers. It is its own product surface: it runs on Redpanda and provisions its own environment when you add it. It provides a managed runtime for AI agents and MCP servers, a proxying AI Gateway for LLM providers, and governance surfaces (budgets, guardrails, Cedar access-control policies) to operate those workloads safely. This skill is written for an AI agent operating the platform programmatically via `rpk ai` and the Agentic Data Plane API or MCP tools. Optimize for correct field names and service names; confirm the live surface before acting.

## Component overview

Maturity note: Redpanda Agentic Data Plane is generally available. Its APIs are on the `v1alpha1` version path and carry no `LaunchStage` annotation in the protos, so treat field-level details as still evolving and confirm them live. The `rpk ai` CLI is in Preview; `InsightsService` is Experimental.

### AI agents

Managed agents run inside the Agentic Data Plane platform. Self-managed (user-hosted) agents are registered as metadata-only records. Both are managed through `AgentRegistryService` (proto) or the `AIAgentService` MCP tool group (v1alpha3). Key fields: `model`, `llm_provider`, `system_prompt`, `max_iterations` (0-200), `mcp_servers` (max 32 refs), `subagents` (max 16). A2A agent cards are published at `/.well-known/agent-card.json`. Triggers (Teams, Cron) fire agents on external events; a trigger can be paused and resumed via `Trigger.enabled` (toggled through `UpdateTrigger` with `update_mask = ["enabled"]`) without deleting it or losing its run history. From the CLI, triggers are a top-level `rpk ai trigger` group.

See [references/agents.md](references/agents.md).

### MCP servers

Each MCP server is either `REMOTE` (you own the upstream) or `MANAGED` (a pre-integrated catalog entry). The managed catalog covers 7 categories (AI, AWS, Communication, Database, Google, Streaming, Utility) with ~50 managed types; the exact set is gated per cluster, so use `ListManagedMCPTypes` for the live list. Enabling `code_mode` on a server adds `{name}_search` and `{name}_execute` tools, reducing token usage by 80-90% for large tool sets. Two API layers exist: `adp.v1alpha1.MCPServerService` (management plane, 9 RPCs) and `dataplane.v1alpha3.MCPServerService` (public Cloud API, 9 RPCs including Start/Stop/Lint). Knowledge bases are a separate `v1alpha3` resource, not a sub-resource of MCP servers.

See [references/mcp-servers.md](references/mcp-servers.md).

### AI Gateway and LLM providers

The AI Gateway is a managed HTTP proxy. It stores upstream API keys in the Redpanda secret store and injects them on outbound requests; calling applications never see the raw keys. Per-provider URL pattern: `<gateway-base>/llm/v1/providers/<provider-name>/<upstream-path>`. Manage providers via `LLMProviderService` (CreateLLMProvider, UpdateLLMProvider, CheckConnection) and discover available models via `ModelService` (ListModels, GetModel). `CheckConnection` probes either a saved provider by name or an unpersisted connection config, so you can verify credentials before creating the provider; it carries its own `dataplane_adp_llmprovider_check_connection` permission. Supported provider types: OpenAI, Anthropic, Google/Gemini, AWS Bedrock, OpenAI-compatible. Pricing overrides use microcents per million tokens on the `provider_models` field. Transcript content capture (`transcripts.record_input_messages` / `record_output_messages`) is **enabled by default** when you create a provider without setting the `transcripts` message.

**Scope:** spend is capped by budgets (hard per-agent caps), and the gateway is a credential-injecting proxy, not a routing or load-balancing layer. Routing/failover, cross-provider load balancing, and per-second/minute/day rate limits are not part of the AI Gateway. To cap spend rather than request rate, use budgets.

See [references/gateway-and-providers.md](references/gateway-and-providers.md).

### Governance: budgets, guardrails, and policies

- **Budgets** (`BudgetService`): per-agent or tenant-wide spend caps. All cost fields use microcents (`limit_microcents`, `warn_at_microcents`). No `limit_cents` or `current_spend_cents` fields exist.
- **Spending analysis** (`SpendingService`): GetSpendingSummary, GetSpendingTimeSeries, GetSpendingBreakdown, GetSpendingTimeSeriesByDimension. `start_time` and `end_time` are required.
- **Guardrails** (`GuardrailService`): Bedrock-backed content safety. Six content filter categories: `hate`, `insults`, `sexual`, `violence`, `misconduct`, `prompt_attack`. Word filters, denied topics, PII filters, and grounding policies are additional sub-policies. Provider is always AWS Bedrock.
- **Access control** (`PolicyService`, `PolicyTemplateService`, `SystemPolicyService`, `EffectivePolicySetService`): Cedar policy dialect. No `ValidatePolicy`, `EvaluateAccess`, or `ListPolicyVersions` RPCs exist.
- **Data policies** (preview): per-MCP-server data shaping (`MCPServer.data_policies`) that masks, redacts, drops, or clamps fields and filters response rows before the model sees them. Cedar decides *whether* a call runs; data policies decide *how* the data is shaped and *to whom*.
- **OAuth / identity** (`OAuthClientService`, `OAuthProviderService`, `OAuthConnectionService`): manage OAuth clients (for external tools calling the aigw Authorization Server) and OAuth providers (third-party identity sources).

Services absent from the Agentic Data Plane v1alpha1 surface: `SpendLimitService`, `RateLimitService`, `RoutingService`, `BackendPoolService`, `AccessControlService`, `SSOService`. The names exist only in the legacy `aigateway/v1` generated tree used by `rpk cloud mcp`. OCSF-based authorization-decision accountability is served by the preview `AuditLogService` on `v1alpha1` — see the observability section.

See [references/governance.md](references/governance.md).

### Observability: transcripts, audit log, and insights

- **TranscriptsService**: `ListTranscripts`, `GetTranscript`. Execution-level observability of an agent conversation. Conversations are grouped by OTel `gen_ai.conversation.id`. `TranscriptSummary` includes token counts and `estimated_cost_usd`. Supports managed and self-managed (BYOA) agents.
- **AuditLogService** (Preview): `ListAuditLogEntries`, `GetAuditLogEntry`, `QueryAuditLog`. Read-only OCSF audit trail across the Agentic Data Plane (management API, LLM proxy, MCP gateway, A2A, spending). Entries carry a call-level `outcome` (`ALLOWED` / `DENIED` / `PARTIAL` / `MASKED`, where `DENIED` folds a guardrail block and a denial always outranks a mask), the attributed policies with their Cedar or guardrail decision, server-minted `correlation_id` for grouping a collection-filtered call's per-resource decisions, on-behalf-of fields (`invoked_by`, `agent_name`, `agent_uid`, `actor_type`), and redacted `entity_before`/`entity_after` diffs on config changes. Filtering goes through one shared `AuditLogFilter` whose per-field predicates are a `terms` list (negatable; an unfilterable field errors rather than being ignored), and `QueryAuditLog` answers entries, the verdict timeline and facet counts in one request against one snapshot. Reading the audit log is itself audited.
- **InsightsService** (Experimental): single `GetInsights` RPC returning `active_agents`, `total_requests`, `total_cost_microcents` over a time window. May change or be removed without a version bump.

Use `TranscriptsService` for what an agent *did* in a conversation, and `AuditLogService` for what any principal was *allowed or refused* to do against the platform's APIs.

See [references/observability.md](references/observability.md).

## Operating the Agentic Data Plane: CLI and API

The primary CLI is `rpk ai`, delivered as an rpk managed plugin: rpk downloads and manages the `rpai` binary (install path `~/.local/bin/.rpk.managed-rpai`), so `rpk ai install`, `rpk ai upgrade`, and `rpk ai uninstall` manage that binary's lifecycle. You invoke it as `rpk ai`. There is no FIPS build of `rpai`.

Top-level subcommands: `agent`, `auth`, `connection`, `env`, `llm`, `mcp`, `model`, `oauth-client`, `oauth-provider`, `policy`, `run`, `trigger`, `version`.

Programmatic access uses the Agentic Data Plane API directly (gRPC/Connect) or via the MCP tools exposed on the cluster.

See [references/rpk-ai.md](references/rpk-ai.md).

## Auth model

`rpk ai` is self-contained: it owns its own credentials and Agentic Data Plane environment selection, rather than riding the `rpk cloud` session. Sign in and pick a target:

```bash
rpk ai auth login          # OAuth device-authorization flow; caches creds in ~/.rpai/credentials (0600)
rpk ai env list            # list local + live Agentic Data Plane environments
rpk ai env use <environment>  # select the Agentic Data Plane environment whose AI Gateway becomes the active target
rpk ai agent list          # now works
```

`rpk ai auth status` shows the current token state, and `rpk ai env show` prints the resolved environment. Selecting an Agentic Data Plane environment with `rpk ai env use` replaces the old `rpk cloud cluster select` step; the connection target is an Agentic Data Plane environment, not a cluster.

Auth modes are `device|rpk|token|none` (default `device`). The `rpk cloud` token is one selectable fallback (`--auth-mode rpk`), not the primary path. Define a local or manual gateway with `rpk ai env add <name> --ai-gateway-url <url> --auth-mode none`.

For headless or CI use, pass a static token via `--token` or the `RPAI_TOKEN` env var. To override the gateway endpoint for a single invocation, pass `--rpai-endpoint <url>`; this flag is intentionally not bound to any environment variable. Confirm available auth flows via `rpk ai auth --help`.

## Discover the live surface

Before acting on the Agentic Data Plane, confirm the live API surface. Reference files document a point-in-time snapshot; the catalog and field defaults evolve:

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

When using the Agentic Data Plane MCP tools: list the available tools for the target service, then describe the tool before calling it to confirm current field names.

For **what changed / which release introduced a feature**, read the user-facing changelog at `adp/RELEASE_NOTES.md` in `cloudv2` (one section per release, e.g. `v0.2.9`) rather than relying on this skill — version and feature history is volatile and intentionally not duplicated here.

## Key patterns and gotchas

- **Cost unit is microcents throughout.** `limit_microcents`, `warn_at_microcents`, `total_cost_microcents`: 1 cent = 1,000,000 microcents; $1.00 = 100,000,000 microcents. Never use `limit_cents`.
- **Static-key auth field is `key_secret_ref`.** Some earlier docs called it `key_ref`. The proto (`auth.proto:26`) is authoritative: `key_secret_ref`.
- **Guardrail content filter has 6 categories, not 14.** The 14-category taxonomy (`violent_crimes`, etc.) is an RFC draft; the shipped API has `hate`, `insults`, `sexual`, `violence`, `misconduct`, `prompt_attack`.
- **Routing and rate limits do not exist in the Agentic Data Plane AI Gateway.** The docs explicitly call these out of scope. Do not attempt to configure `RoutingService`, `BackendPoolService`, or `RateLimitService` via the Agentic Data Plane; those are legacy `aigateway/v1` names.
- **A2A agent card path.** The canonical path is `/.well-known/agent-card.json`. There is no bare `/agent.json` route.
- **`subagents.mcp_servers` is independent, not a subset.** Each subagent's `mcp_servers` list is independent of the parent agent's list; a subagent may reference servers the parent does not.
- **`tools` field does not exist on `ManagedAgentSpec`.** Agents access tools through `mcp_servers` references only. The `tools` field is on `mcp_server.proto`.
- **MCP tool name truncation.** The MCP protocol enforces a 64-character limit on tool names. The Agentic Data Plane truncates long managed-catalog names with a hash prefix while preserving the method suffix.
- **No `RPAI_ENDPOINT` env var.** `--rpai-endpoint` is flag-only and applies to one invocation only. Binding it to an env var would silently override the selected Agentic Data Plane environment.
- **Creating an LLM provider turns transcript content capture ON.** Omitting the `transcripts` message on `CreateLLMProvider` makes the server stamp `record_input_messages` and `record_output_messages` to `true`, so prompts and completions are captured verbatim. A supplied `false` is honoured, so send the message explicitly to opt out. Existing providers are not backfilled. See [references/gateway-and-providers.md](references/gateway-and-providers.md).
- **Agent writes are model-checked against the catalog.** `CreateAgent` / `UpdateAgent` reject a `(model, llm_provider)` pairing whose model the agent runtime could not build, with `InvalidArgument` and a field violation, for **every catalog provider** (Anthropic, OpenAI, Google, Bedrock) — exact IDs, aliases and dated snapshots all resolve. The additional "enabled on this provider" gate over `provider_models` is **Bedrock-only** (and skipped when that list is empty), and **OpenAI-compatible** providers have no catalog, so they are not model-checked at all. See [references/agents.md](references/agents.md).
- **Reasoning effort is a provider-owned string, persisted on the agent and validated at write time.** Set `ManagedAgentSpec.reasoning.effort` (a string in the provider's own spelling), not the deprecated `reasoning_effort` enum — the enum is still accepted and kept in sync, but its value set is frozen. The setting applies to every run, not just the playground, and subagents inherit it. The write is rejected unless every effective model lists the value in `ModelCapabilities.reasoning_efforts` — so read that live per model, use the intersection across the agent's and its subagents' models, and never assume a level exists. On an OpenAI-compatible provider any explicit effort is rejected; leave it unset. See [references/agents.md](references/agents.md).
- **`response_format` fails open and is whole-server.** Token-optimized output applies to remote and managed servers alike (a code-mode endpoint inherits the parent's setting), but any result it cannot losslessly re-encode is forwarded unchanged, and an opted-in server's `tools/list` no longer advertises `outputSchema`. Never treat the encoded form as a guaranteed wire format.
- **A `user_oauth` MCP server's tool list is not proof of access.** The gateway gates per method, not per session: a caller with no connection can still open the session and list capabilities (forwarded token-less once resolution fails on something signing in would fix), but `tools/call`, `resources/read` and `prompts/get` stay gated. The refusal arrives as the tool result's **text**, carrying the authorize URL — read it from there, not from an error status. A capability list that fails *hard* is an infrastructure or configuration problem, not a missing user connection. See [references/mcp-servers.md](references/mcp-servers.md).
- **The audit log records calls, not MCP session traffic.** On the MCP gateway, `initialize`, `ping`, `tools/list` and the `notifications/` family are recorded only when denied or errored, so a session that opens, lists tools and is kept alive leaves no entries until its first `tools/call`. Never count sessions or infer "no session" from the audit log. See [references/observability.md](references/observability.md).
- **`connection` manages your own OAuth grants.** `rpk ai connection list` lists your personal OAuth connections to third-party providers and `rpk ai connection revoke <provider>` revokes one. Connections are created through the browser consent flow, not by these commands.
- **A GitOps manifest is the complete desired state.** Every `rpk ai <resource> apply` / `diff` compares every writable field, including the ones the manifest omits: an omitted field is compared as its proto zero (what a `create` from that manifest would produce), so trimming a field out of a manifest is drift, not "leave it alone". Round-trip `get -o yaml` for a complete manifest. Neither command prunes resources absent from the manifests. See [references/rpk-ai.md](references/rpk-ai.md).

## Control-plane MCP server

For the `rpk cloud mcp` control-plane server (manages Redpanda Cloud clusters, networks, IAM, and legacy AI Gateway `aigateway/v1` surfaces), see /redpanda:rpk-cloud.

## Reference files

- [references/agents.md](references/agents.md): `AgentRegistryService` RPCs, `ManagedAgentSpec` fields, subagents, A2A agent card, triggers, agent credentials.
- [references/mcp-servers.md](references/mcp-servers.md): `MCPServerService` API layers, `MCPServer` fields, remote auth modes, code mode, managed catalog, knowledge bases.
- [references/gateway-and-providers.md](references/gateway-and-providers.md): `LLMProviderService` RPCs, provider types and auth schemes, `ModelService`, pricing overrides, AI Gateway proxy behavior, explicit out-of-scope list.
- [references/governance.md](references/governance.md): `BudgetService`, `SpendingService`, `GuardrailService` (Bedrock, 6 categories), Cedar access-control services, OAuth/identity services, absent service names.
- [references/rpk-ai.md](references/rpk-ai.md): `rpk ai` subcommand tree, lifecycle management, global flags, common errors, per-group subcommand details including the `trigger` group, GitOps `apply`/`diff` semantics.
- [references/observability.md](references/observability.md): `TranscriptsService` RPCs and fields, `AuditLogService` (Preview) RPCs, filters, verdicts, grouped-call semantics and delegation fields, `InsightsService` (Experimental), transcripts-vs-audit-log framing.
