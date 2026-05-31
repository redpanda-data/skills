# Dataplane AI Resources: Agents, MCP Servers, Knowledge Bases

These are the AI-native dataplane resources in Redpanda Cloud (Enterprise Edition managed). They are exposed both as MCP tool groups (under a per-cluster `dataplane_api_url`) and as REST/Connect APIs. The config keys below are grounded in the proto definitions.

Source (proto):
- `cloudv2/proto/public/cloud/redpanda/api/adp/v1alpha1/agent.proto`
- `cloudv2/proto/public/cloud/redpanda/api/adp/v1alpha1/mcp_server.proto`
- `cloudv2/proto/public/cloud/redpanda/mcps/v1/auth.proto`

> License note: Redpanda Cloud is a managed deployment of Redpanda Enterprise Edition; these AI dataplane resources are Cloud features.

---

## AI Agents (`AIAgentService`, v1alpha3 MCP tools)

MCP tools: `CreateAIAgent`, `GetAIAgent`, `ListAIAgents`, `UpdateAIAgent`, `DeleteAIAgent`, `StartAIAgent`, `StopAIAgent`.

### `Agent` (resource shape)

| Field | Notes |
|-------|-------|
| `name` | Immutable identifier. DNS-1123 label, lowercase, 1–63 chars, pattern `^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$` |
| `display_name` | Max 128 chars |
| `description` | Max 1024 chars |
| `tags` | `map<string,string>`, up to 50 pairs, values max 256 chars |
| `email` | Output-only; agent service-account email `<name>@<domain>` |
| `created_at`, `updated_at` | Output-only timestamps |
| `agent_type.managed` (`ManagedAgent`) | The one populated agent-type variant (`spec` + output-only `status`) |

Lifecycle states: `AgentState` and the requested `AgentDesiredState` (used by `StartAgent`/`StopAgent`).

### `ManagedAgentSpec` (writable config)

| Field | Required | Notes |
|-------|----------|-------|
| `model` | yes | Exact model id the agent invokes, e.g. `gpt-4o-mini`, `claude-sonnet-4-20250514`, `gemini-2.0-flash`. Max 128 chars |
| `llm_provider` | yes | Slug reference to an aigw-owned `LLMProvider` in the same tenant. Pattern `^[a-z][a-z0-9-]*$`, max 63 |
| `system_prompt` | no | Max 16384 chars |
| `max_iterations` | no | Upper bound on agent iterations per request, `0` = runtime default, range 0–200 |
| `mcp_servers` | no | Up to 32 references to aigw-owned `MCPServer` resources (each name pattern `^[a-z][a-z0-9-]*$`, max 63) |
| `subagents` | no | `map<string, Subagent>`, up to 16 delegation targets |
| `agent_card` | no | A2A agent-card metadata served at `/agent.json` |

`Subagent` fields: `system_prompt` (required, max 16384), `description` (required, non-empty, max 1024 — surfaced as the tool description), `mcp_servers` (must be a **subset** of the parent agent's `mcp_servers` — enforced at submit time), `skills` (with `tags`, `examples`, `input_modes`, `output_modes`).

### Agent credentials (`AgentCredential`)

`CreateAgentCredential`, `ListAgentCredentials`, `DeleteAgentCredential` manage credentials issued to an agent.

---

## MCP Servers (`MCPServerService`, v1alpha3 MCP tools)

MCP tools: `CreateMCPServer`, `GetMCPServer`, `ListMCPServers`, `UpdateMCPServer`, `DeleteMCPServer`, `StartMCPServer`, `StopMCPServer`, `LintMCPConfig`.

### `MCPServer` config

| Field | Notes |
|-------|-------|
| `name` | DNS-1123 label, max 63 |
| `description` | Max 256 chars |
| `enabled` | Toggle |
| `tools` | Output-only `MCPTool[]` (each `name`, `description`, `input_schema` JSON schema string) |
| `url` | Server URL |
| `code_mode`, `code_mode_url` | Code-execution mode toggle + URL |
| `config.remote` (`RemoteMCPConfig`) | Remote-MCP variant: `url` + an auth oneof |
| `config.managed` (`ManagedMCPConfig`) | Managed-MCP variant (typed `config` payload + `ManagedMCPCategory`) |

Server type / transport enums: `MCPServerType`, `MCPTransport`.

### MCP auth variants (`config.remote` auth oneof)

| Auth type | Key fields |
|-----------|-----------|
| `NoAuth` (`none`) | — |
| `TokenPassthroughAuth` (`token_passthrough`) | — (forwards caller token) |
| `StaticKeyAuth` (`static_key`) | `key_secret_ref`, `header_name` |
| `BasicAuth` | `username`, `password_secret_ref` |
| `APIKeyAuth` | `key_secret_ref`, `name` |
| `ServiceAccountOAuthAuth` (`service_account_oauth`) | `client_id`, `client_secret_ref`, `token_url`, `scopes` |
| `UserOAuthAuth` (`user_oauth`) | `provider_name`, `required_scopes` |

`TokenInjection` config: `header_name`, `header_prefix`.

> Secret values are referenced indirectly via `*_secret_ref` (never inline secrets).

`ListManagedMCPTypes` enumerates the available managed MCP server types (`type_url`, `display_name`, `description`, `category`, `icon_id`, `tags`, `docs_url`).

---

## Knowledge Bases (`KnowledgeBaseService`, v1alpha3 MCP tools)

MCP tools: `CreateKnowledgeBase`, `GetKnowledgeBase`, `ListKnowledgeBases`, `UpdateKnowledgeBase`, `DeleteKnowledgeBase`. These back retrieval for AI Agents. Use `LintMCPConfig` / `LintPipelineConfig` (PipelineService) to validate the supporting Redpanda Connect pipeline configs before deploying.

---

## Connecting these resources

- An **AI Agent** references an `LLMProvider` (model provider, see `references/ai-gateway-governance.md`) and zero or more **MCP Servers** by name.
- **MCP Servers** expose tools (remote or managed) that agents call; auth to upstreams uses the auth variants above with secret refs.
- A local AI assistant (Claude) can drive a remote dataplane MCP server via `rpk cloud mcp proxy --cluster-id <id> --mcp-server-id <id>` (see `references/mcp.md`).
