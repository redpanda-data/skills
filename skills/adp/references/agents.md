Source: `cloudv2/proto/public/cloud/redpanda/api/adp/v1alpha1/agent.proto` (lines 16–699), `managed_agent_runtime.proto` (lines 18–114). Service registration confirmed at `cloudv2/apps/adp-api/internal/server/server.go:340–341`. A2A routing confirmed at `cloudv2/apps/aigw/internal/server/server.go:988–989`. Subagent `model`/`llm_provider` override fields re-verified against `agent.proto` `message Subagent` on 2026-07-06. Evidence date: 2026-07-06.

# ADP Agents Reference

**Maturity:** ADP is generally available. The services in this file are on the `v1alpha1` version path and carry no `LaunchStage` annotation in the protos, so treat field-level details as still evolving and confirm them live via `--help` and live introspection. Triggers (Teams, Cron) are newer fast-follow features.

Audience: an AI agent operating ADP via `rpk ai` and ADP MCP tools. Optimize for correct programmatic use.

Related references: [SKILL.md](../SKILL.md), [mcp-servers.md](mcp-servers.md), [gateway-and-providers.md](gateway-and-providers.md), [governance.md](governance.md), [rpk-ai.md](rpk-ai.md), [observability.md](observability.md).

## Discover the live surface

Before acting, confirm the available operations and fields:

```bash
# See all rpk ai agent subcommands and flags
rpk ai agent --help

# List MCP tool groups served on the cluster
# (use the ADP MCP tools for the authoritative tool list)
```

The sections below document the proto-verified surface. For exact field lists and current limits, confirm live via `--help` and by calling the relevant MCP describe or schema tools.

## `AgentRegistryService` RPCs

Both managed and self-managed agents share this unified service (`agent.proto:15`).

| RPC | IAM permission |
|-----|----------------|
| `CreateAgent` | `dataplane_adp_agent_create` |
| `GetAgent` | `dataplane_adp_agent_get` |
| `ListAgents` | `dataplane_adp_agent_list` |
| `UpdateAgent` | `dataplane_adp_agent_update` |
| `DeleteAgent` | `dataplane_adp_agent_delete` |
| `StartAgent` | `dataplane_adp_agent_update` |
| `StopAgent` | `dataplane_adp_agent_update` |
| `CreateAgentCredential` | `dataplane_adp_agent_credential_create` |
| `ListAgentCredentials` | `dataplane_adp_agent_credential_list` |
| `DeleteAgentCredential` | `dataplane_adp_agent_credential_delete` |
| `CreateTrigger` | `dataplane_adp_agent_trigger_create` |
| `GetTrigger` | `dataplane_adp_agent_trigger_get` |
| `ListTriggers` | `dataplane_adp_agent_trigger_list` |
| `UpdateTrigger` | `dataplane_adp_agent_trigger_update` |
| `DeleteTrigger` | `dataplane_adp_agent_trigger_delete` |

`TriggerInternalService` (`ReportTriggerHealth`, permission `dataplane_adp_agent_trigger_report_health`) is registered on an internal-listener only and is never a public API.

## Agent types: managed vs. self-managed

ADP supports two agent types through a single service.

**Managed agent** (`agent_type.managed` oneof): ADP runs the agent container. Set the `managed` arm of the `agent_type` oneof on `AgentCreate` to register a managed agent. The agent runtime, scaling, and lifecycle are handled by the platform.

**Self-managed (user-hosted) agent**: leave the `agent_type` oneof unset on `AgentCreate`. The registry creates a metadata-only record that the platform does not run. Use this to track user-hosted agents alongside managed ones in the same registry. Read responses for self-managed agents return a nil (unset) `agent_type` oneof, not a stub `managed` field. Self-managed agents are a first-class feature with a full UI and documentation (`self-managed-agents.adoc`).

There is no separate proto arm for self-managed agents; the explicit oneof variant is future work. The functional capability (omit the oneof) is current.

## `ManagedAgentSpec` fields

These are the fields a builder sets when creating or updating a managed agent (`agent.proto:448–666`).

| Field | Required | Constraint |
|-------|----------|------------|
| `model` | yes | min 1 char, max 128 chars |
| `llm_provider` | yes | min 1 char, max 63 chars, pattern `^[a-z][a-z0-9-]*$` |
| `system_prompt` | no | max 16,384 chars |
| `max_iterations` | no | 0 to 200 (inclusive) |
| `mcp_servers` | no | max 32 items; each min 1 char, max 63 chars, pattern `^[a-z][a-z0-9-]*$` |
| `subagents` | no | max 16 pairs; key pattern `^[a-z][a-z0-9-]*$` |
| `agent_card` | no | see A2A agent card section below |

There is no `tools` field on `ManagedAgentSpec`. Agents access tools exclusively through `mcp_servers` references. (The `tools` field exists on `mcp_server.proto`, not on the agent proto.)

## Subagents

`subagents` is `map<string, Subagent>` inside `ManagedAgentSpec`, keyed by a name matching `^[a-z][a-z0-9-]*$`, with a maximum of 16 pairs.

| Field | Required | Constraint |
|-------|----------|------------|
| `system_prompt` | yes | min 1 char, max 16,384 chars |
| `description` | yes | min 1 char, max 1,024 chars |
| `mcp_servers` | no | max 32 items; each min 1 char, max 63 chars |
| `model` | no | max 128 chars; empty = inherit the parent agent's `model` |
| `llm_provider` | no | max 63 chars, pattern `^[a-z][a-z0-9-]*$`; empty = inherit the parent agent's `llm_provider` |

Two important corrections from earlier documentation:

- **`mcp_servers` is independent, not a subset.** Each subagent runs under its own set of MCP servers, independent of the parent agent's set. There is no subset constraint. Referencing a server the parent does not have is valid (`agent.proto:511–513`; confirmed in `service_test.go:779`).
- **`skills` is not a field on `Subagent`.** The `Skill` message and the `skills` repeated field live on `ManagedAgentSpec.AgentCard` (`agent.proto:603–664`), not on `Subagent`. `Subagent` has only `system_prompt`, `description`, `mcp_servers`, `model`, and `llm_provider`.

**Per-subagent model and provider.** A subagent can override the parent agent's model and provider via its own `model` (field 4) and `llm_provider` (field 5) fields. Both are optional; an empty value means inherit the parent's. A message-level CEL constraint (`subagent.model_required_with_llm_provider`) requires `model` to be set whenever `llm_provider` is set: model names are provider-specific, so switching provider without also naming a model for it would only fail at request time. Overriding `model` alone (same provider — for example, a cheaper model) is allowed.

## A2A agent card

The `agent_card` field on `ManagedAgentSpec` populates A2A discovery metadata.

The canonical public path for an agent's card is:

```
https://<agent-url>/.well-known/agent-card.json
```

`/.well-known/agent.json` is also served as an alias from the same handler (`aigw/internal/server/server.go:988–989`). There is no bare `/agent.json` route registered; use the `.well-known` prefix.

The docs confirm: "ADP agents expose their agent cards at the `/.well-known/agent-card.json` subpath of the agent URL" (`a2a-concepts.adoc:44–46`).

The `skills` repeated field on `AgentCard` accepts `Skill` messages with `tags`, `examples`, `input_modes`, and `output_modes` (`agent.proto:618–664`).

## Agent credentials

`CreateAgentCredential`, `ListAgentCredentials`, and `DeleteAgentCredential` manage API credentials scoped to a single agent. Credentials allow external systems to authenticate as the agent without using user-level tokens.

## Triggers

Triggers attach to an agent and fire it on an external event. Two trigger types are supported.

**`TeamsTrigger`**: fires the agent from a Microsoft Teams event.

**`CronTrigger`**: fires the agent on a schedule (cron expression).

The trigger lifecycle RPCs (`CreateTrigger` through `DeleteTrigger`) operate as a sub-resource on the agent. The internal `ReportTriggerHealth` RPC is used by the runtime only and is never called by external clients.

## `ManagedAgentRuntime` (orchestrator-internal)

`ManagedAgentRuntime` is stored separately from the agent record and is never exposed directly via the API. It is projected onto `ManagedAgentStatus` in read responses. Status fields include: `state`, `state_reason`, `desired_state`, `url`, `retry_count`, `next_retry_at`, `last_error`, `container_id`, `config_hash`, `created_at`, `updated_at` (`managed_agent_runtime.proto:40–114`).

Two access contracts govern the runtime: a tenant pool (reads and desired-state writes) and an admin pool (cross-tenant orchestrator, observed-state writes).

## MCP tool group name vs. proto service name

The MCP tool group exposed to AI clients is named `AIAgentService` (v1alpha3). The underlying proto service is `AgentRegistryService`. Both names are correct in their respective contexts. When operating via MCP tools, use the `AIAgentService` tool names (for example, `CreateAIAgent`). When working with the raw API or proto, use `AgentRegistryService` RPC names.
