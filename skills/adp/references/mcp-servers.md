Source: `cloudv2/proto/public/cloud/redpanda/api/adp/v1alpha1/mcp_server.proto` (MCPServerService RPCs, MCPServer fields, code-mode comment, tool-naming comment), `cloudv2/proto/public/cloud/redpanda/mcps/v1/auth.proto` (auth mode messages), `cloudv2/apps/aigw/internal/mcp/managed/defaults.go` (managed catalog registrations). Evidence date: 2026-06-29.

# ADP MCP Servers Reference

**Maturity:** ADP is generally available. The services in this file are on the `v1alpha1` version path and carry no `LaunchStage` annotation in the protos, so treat field-level details as still evolving and confirm them live via `--help` and live introspection. Individual managed-catalog entries carry their own per-type maturity badges; see the managed catalog section below. Audience: an AI agent operating ADP MCP servers via `rpk ai mcp` and the ADP API.

Related references: [SKILL.md](../SKILL.md), [agents.md](agents.md), [gateway-and-providers.md](gateway-and-providers.md), [governance.md](governance.md), [rpk-ai.md](rpk-ai.md), [observability.md](observability.md).

For the separate `rpk cloud mcp` control-plane server, see /redpanda:rpk-cloud.

## Discover the live surface

Before acting, confirm the available operations and fields:

```bash
# See all rpk ai mcp subcommands and flags
rpk ai mcp --help

# List MCP servers on the cluster
rpk ai mcp list

# List tools exposed by a specific server
rpk ai mcp tools list <server-name>
```

The sections below document the proto-verified surface. For exact field lists and current limits, confirm live via `--help` and by listing or describing MCP tools on the cluster.

## API layers

There are two `MCPServerService` definitions in the cloudv2 service tree. Know which layer you are targeting:

| Layer | Package | Description |
|-------|---------|-------------|
| ADP management plane | `redpanda.api.adp.v1alpha1.MCPServerService` | 7 RPCs; the aigw app implements this directly. Use this layer to create, update, and manage MCP server records. |
| Cloud dataplane (public API) | `redpanda.api.dataplane.v1alpha3.MCPServerService` | 9 RPCs (adds `StartMCPServer`, `StopMCPServer`, `GetMCPServerServiceConfigSchema`, `LintMCPConfig`); exposed via the public Cloud data-plane API and Cloud UI MCP tools. |

The skill operates against the `v1alpha1` ADP management-plane layer unless the context explicitly targets the `v1alpha3` public API.

## `MCPServerService` RPCs (`adp.v1alpha1`)

| RPC | Purpose |
|-----|---------|
| `CreateMCPServer` | Create a new MCP server record (remote or managed) |
| `GetMCPServer` | Fetch a single server by name |
| `ListMCPServers` | List all servers in the namespace |
| `UpdateMCPServer` | Update a server's mutable fields |
| `DeleteMCPServer` | Delete a server record |
| `ListManagedMCPTypes` | List available managed integration types |
| `ListMCPServerTools` | List the tools exposed by a server (live call; proxies upstream for remote servers when OAuth connection exists; returns `FAILED_PRECONDITION` with `OAuthConnectionRequired` detail when no OAuth connection is present) |

## Key `MCPServer` fields

| Field | Type | Notes |
|-------|------|-------|
| `name` | `string` | AIP-122 identifier; 1-63 chars; pattern `^[a-z][a-z0-9-]*$`; immutable after create |
| `type` | `MCPServerType` | `REMOTE` or `MANAGED`; immutable after create |
| `backend` | oneof | `RemoteMCPConfig` or `ManagedMCPConfig` |
| `enabled` | `bool` | Whether the server is active |
| `description` | `string` | Max 256 chars |
| `code_mode` | `bool` | When true, adds `{name}_search` and `{name}_execute` tools alongside the server's existing tools |
| `url` | `string` | OUTPUT_ONLY; computed server URL, not persisted |
| `code_mode_url` | `string` | OUTPUT_ONLY; computed URL for the code-mode endpoint (`-code` suffix convention); not persisted |
| `tools` | `repeated MCPTool` | OUTPUT_ONLY; populated by a live `tools/list` call |
| `created_at`, `updated_at`, `created_by`, `updated_by` | OUTPUT_ONLY | Audit fields |

`MCPServerType` enum values: `MCP_SERVER_TYPE_UNSPECIFIED` (0), `MCP_SERVER_TYPE_REMOTE` (1), `MCP_SERVER_TYPE_MANAGED` (2).

Transport options (`MCPTransport`): `MCP_TRANSPORT_SSE` (1), `MCP_TRANSPORT_STREAMABLE_HTTP` (2).

## Remote auth modes

Remote MCP servers (`type = REMOTE`) configure auth via the `RemoteMCPConfig.auth` oneof. There are exactly 5 wired modes:

| Mode | Field in oneof | Description |
|------|---------------|-------------|
| No auth | `none` | Unauthenticated; empty message |
| Token passthrough | `token_passthrough` | Forwards the caller's inbound bearer token upstream unchanged |
| Static key | `static_key` | Sends a static secret as the auth header; field name is `key_secret_ref` (UPPER_SNAKE_CASE secret-store reference) with an optional `header_name` that defaults to `"Authorization"` |
| Service-account OAuth | `service_account_oauth` | Client-credentials OAuth flow; fields: `client_id`, `client_secret_ref`, `token_url`, `scopes` |
| User-delegated OAuth | `user_oauth` | Per-user OAuth delegation; fields: `provider_name`, `required_scopes`, `injection` (TokenInjection) |

**Important:** The static-key field is named `key_secret_ref` in the proto source (`auth.proto:26`). Published docs in some places incorrectly call it `key_ref`. The proto is authoritative; use `key_secret_ref`.

Two additional auth message types (`BasicAuth` and `APIKeyAuth`) are defined in the shared `auth.proto` package but are NOT wired into the `RemoteMCPConfig` oneof. They are not valid options for remote MCP server auth.

## Code mode

When `code_mode = true` on a server, the ADP gateway adds two additional tools:

| Tool name (in full endpoint) | Tool name (in code-mode endpoint) | Description |
|------------------------------|-----------------------------------|-------------|
| `{name}_search` | `search` | Find tools in the server's catalog; accepts an optional `query` (Go RE2 regex) |
| `{name}_execute` | `execute` | Run JavaScript in a sandbox with `call_tool({name, arguments})` and `search_tools(query)` host functions |

The `{name}_` prefix is the namespaced form when the tools are served alongside other tools in the full endpoint. In the dedicated code-mode endpoint (`code_mode_url`, which uses a `-code` suffix), the same tools appear as bare `search` and `execute`.

Code mode is a token-reduction technique for a single server with many tools. It is not a way to combine multiple servers behind one endpoint. Each code-mode server has exactly one `code_mode_url`; there is no multi-server aggregation endpoint.

### Token reduction

Integration guides report that deferred tool loading (code mode) reduces token usage by 80-90% for configurations with many tools (source: `adp-docs/modules/connect/partials/integrations/continue-admin.adoc`, `cursor-admin.adoc`, `cline-admin.adoc`). The canonical code-mode page (`code-mode.adoc`) states the technique "cuts the token cost" but does not give a percentage. Use 80-90% as the documented figure; treat it as an approximation from integration-specific guides.

### Tool name truncation

The MCP protocol enforces a 64-character limit on tool names. For managed types whose generated names exceed this limit, ADP truncates the prefix and replaces it with a hash (for example, `64ghux5adn_github_read_v1_GitHubReadService_GetAuthenticatedUser`). The version, service, and method suffix is always preserved, so the short tool name an agent sees (for example, `get_authenticated_user`) remains stable across truncations.

## Managed catalog

The `type = MANAGED` backend connects to a pre-integrated service. The catalog is organized into 7 categories (the example lists below are illustrative, not exhaustive):

| Category | Examples |
|----------|---------|
| AI | AWS Bedrock, Cohere, OpenAI |
| AWS | AWS S3, AWS SNS, AWS SQS |
| Communication | Discord, Freshservice, GitHub Read (GA), Jira, Pylon, ServiceNow, Slack, Zendesk |
| Database | Elasticsearch, Metabase, MongoDB, Qdrant, Redis, SQL |
| Google | GCP Pub/Sub, Gmail, Google Calendar (GA), Google Drive (GA) |
| Streaming | Kafka, NATS |
| Utility | Azure AD, BambooHR (GA), BILL, DocuSign, Grafana, Greenhouse, Ironclad, NetSuite, Okta, OpenAPI, Ramp, Salesforce (GA), Sentry, SharePoint, Text Chunker, Workday, and others |

There are ~50 managed types across these 7 categories; the exact set is gated per cluster, so use `ListManagedMCPTypes` to get the live list of available types for your cluster.

Items without a maturity badge are GA. Items marked `badge:beta` are Beta. Confirm the current maturity of any specific type live via the API or UI.

## Knowledge bases

Knowledge bases are a separate resource at the Cloud dataplane `v1alpha3` layer (`redpanda.api.dataplane.v1alpha3.KnowledgeBaseService`). They are NOT part of the `adp.v1alpha1` MCP server management API and are not a sub-resource of `MCPServer`. Manage knowledge bases via the `v1alpha3` API, not via `MCPServerService`.
