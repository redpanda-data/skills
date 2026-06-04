---
name: ai
description: "Manages the rpk ai plugin lifecycle (install, upgrade, uninstall) and the MCP server for AI agents (rpk cloud mcp). Use when: installing or upgrading rpk ai; setting up MCP for Claude Desktop or Claude Code; wiring rpk cloud mcp stdio or install; configuring MCP proxy to dataplane; understanding MCP tools (clusters, topics, ACLs, AI Gateway); passing RPAI_TOKEN/RPAI_ENDPOINT; resolving cloud auth errors; or choosing between rpk ai and rpk cloud mcp. Also covers AI Gateway governance (guardrails, rate limits, RBAC, audit logging) and dataplane AI resources (Agents, Knowledge Bases)."
metadata:
  version: "1.0.0"
---

# rpk ai: AI CLI & MCP Integration

Redpanda exposes two related AI surfaces under `rpk`:

1. **`rpk ai`** — a managed plugin (binary slug `rpai`) that gives a rich CLI for the Redpanda **AI Gateway**. `rpk` downloads it on first use and manages its lifecycle (install / upgrade / uninstall). The plugin receives cloud auth automatically from the active rpk profile.

2. **`rpk cloud mcp`** — an MCP (Model Context Protocol) server built directly into `rpk` that exposes Redpanda Cloud control-plane, IAM, dataplane, and AI Gateway operations as LLM-callable tools. Wire it into Claude Desktop or Claude Code and let an AI agent create topics, list clusters, manage ACLs, configure the AI Gateway, and more — all through natural language.

## Quickstart

### 1. Install the rpk ai plugin

```bash
# Install the latest version (auto-downloaded on first subcommand too)
rpk ai install

# Pin a specific version
rpk ai install --ai-version 0.2.0

# Force reinstall
rpk ai install --force

# Check the installed version
rpk ai --version

# Upgrade to latest
rpk ai upgrade

# Uninstall
rpk ai uninstall
```

The plugin binary is installed to `~/.local/bin/.rpk.managed-rpai`.

### 2. Wire the MCP server into Claude Code (one command)

```bash
# Log in to Redpanda Cloud first
rpk cloud login

# Auto-install: writes the mcpServers.redpandaCloud entry into ~/.claude.json
rpk cloud mcp install --client claude-code

# With delete operations enabled (off by default)
rpk cloud mcp install --client claude-code --allow-delete
```

After running this command, restart Claude Code. The `redpandaCloud` MCP server is immediately available.

### 3. Wire the MCP server into Claude Desktop

```bash
rpk cloud mcp install --client claude
```

Writes the entry into `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent `AppData` path on Windows.

### 4. Run the MCP server manually (stdio)

```bash
# Start the stdio MCP server — used directly by MCP clients
rpk cloud mcp stdio

# With delete RPCs enabled
rpk cloud mcp stdio --allow-delete
```

### 5. Proxy to a remote dataplane MCP server

```bash
# Proxy to an MCP server running inside a specific cluster
rpk cloud mcp proxy \
  --cluster-id <cluster-id> \
  --mcp-server-id <mcp-server-id>

# Or for a serverless cluster
rpk cloud mcp proxy \
  --serverless-cluster-id <serverless-cluster-id> \
  --mcp-server-id <mcp-server-id>

# Install the proxy config into Claude Code instead of serving live
rpk cloud mcp proxy \
  --cluster-id <cluster-id> \
  --mcp-server-id <mcp-server-id> \
  --install --client claude-code
```

### 6. Manual JSON config (if you prefer not to use `rpk cloud mcp install`)

Using `rpk cloud mcp install` is recommended because it writes the correct OS-specific config path automatically. If you hand-edit, the `--config` value must match the path returned by `os.UserConfigDir()` on your OS:

- **Linux/XDG**: `~/.config/rpk/rpk.yaml` (or `$XDG_CONFIG_HOME/rpk/rpk.yaml` if `$XDG_CONFIG_HOME` is set)
- **macOS**: `~/Library/Application Support/rpk/rpk.yaml`
- **Windows**: `%AppData%\rpk\rpk.yaml`

```json
{
  "mcpServers": {
    "redpandaCloud": {
      "command": "rpk",
      "args": [
        "--config", "<path from os.UserConfigDir()/rpk/rpk.yaml>",
        "cloud", "mcp", "stdio"
      ]
    }
  }
}
```

For Claude Code place this in `~/.claude.json`; for Claude Desktop place it in the `claude_desktop_config.json` shown above.

### 7. Auth for the rpk ai plugin

```bash
# rpk auto-injects RPAI_TOKEN from the active cloud profile
rpk cloud login          # sets the cached token in rpk.yaml
rpk ai <subcommand>      # rpk exports RPAI_TOKEN + RPAI_ENDPOINT automatically

# Override the AI Gateway endpoint explicitly
rpk ai <subcommand> --rpai-endpoint https://my-aigw.example.com

# Or via env vars (take priority over profile lookup)
export RPAI_TOKEN=<bearer-token>
export RPAI_ENDPOINT=https://my-aigw.example.com
rpk ai <subcommand>
```

## rpk ai Subcommands

| Command | Description |
|---------|-------------|
| `rpk ai install` | Download and install the Redpanda AI CLI plugin |
| `rpk ai upgrade` | Upgrade the plugin to the latest version (managed installs only) |
| `rpk ai uninstall` | Remove the installed plugin |
| `rpk ai <anything>` | Delegates to the plugin binary after injecting cloud auth |

The plugin itself provides its own subcommands (for managing models, gateways, accounts, etc. in the AI Gateway). Run `rpk ai --help` after installing to see the current list.

## rpk cloud mcp Subcommands

| Command | Description |
|---------|-------------|
| `rpk cloud mcp stdio` | Run the MCP server on stdio (used by MCP clients) |
| `rpk cloud mcp install` | Write MCP config into Claude Desktop or Claude Code |
| `rpk cloud mcp proxy` | Proxy stdio to a remote dataplane MCP server |

## MCP Tool Groups

When an MCP client connects to `rpk cloud mcp stdio`, it receives tools from these service groups:

- **Control Plane** — Region, ResourceGroup, Cluster (BYOC/dedicated), Network, ServerlessCluster, ServerlessRegion, Operations
- **IAM** — Organization, Permission, Role, RoleBinding, ServiceAccount, User, UserInvite
- **Dataplane** — Topic, Pipeline, ACL, CloudStorage, Quota, Secret, Security (RBAC roles), Transform, User, AIAgent, KnowledgeBase, MCPServer
- **AI Gateway** — AccessControl, Account, Analytics, Audit, Auth, BackendPool, Config, Gateway, GatewayConfig, Guardrail, IAMSettings, MCPTools, ModelPricing, ModelProviders, Models, OAuth2Client, OAuth2Key, Organization, ProviderConfig, RateLimit, Role, Routing, Settings, SpendLimit, SSO, Team, User, VisualMetadata, Workspace

Delete operations are **disabled by default**. Pass `--allow-delete` to enable them.

## AI Gateway Governance and Security (Enterprise)

The AI Gateway runs on Redpanda Cloud — a managed **Redpanda Enterprise Edition** deployment — so its governance, security, and cost-control surfaces are first-class. An AI agent drives them via the `ai_gateway_url`-scoped MCP tool groups (or the `rpai` plugin):

- **Guardrails** — word filters (`words`, `regex`, `mask_replacement`, per-direction `action`/`DirectionConfig`) and content filters (per-category `violent_crimes`, `hate`, `privacy`, ... each with `strength`/`action`/`modalities`).
- **Rate Limits** — `requests_per_second` / `requests_per_minute` / `requests_per_day` keyed by `key_extractor`/`expression`.
- **Spend Limits** — `limit_cents`, `tokens_per_minute`/`tokens_per_day`, `window`/`size_seconds`, `alert_thresholds`, `action`; usage via `GetSpendLimitUsage`.
- **Routing rules** — `backend_pool` + `fallback_pool` + `priority` selected by `expression`.
- **Model Providers** — `base_url`, `auth_type`, `openai_compat`/`openai_native`, `data_policy`/`data_region`/`data_retention_days`; models via `ModelsService`, pricing via `ModelPricingService`.
- **Access Control / RBAC** — Cedar-style policies (`policy_text`, `principal`/`resource`/`action`/`effect`, `priority`) plus `RoleService` and `TeamService`; validate/evaluate with `ValidatePolicy`/`EvaluateAccess`.
- **Audit Logging** — OCSF-aligned `AuditService` (`GetAuditLog`, `ListAuditLogs`).
- **SSO / OIDC / OAuth2** — identity providers (`issuer_url`, `client_id`, `jwks_uri`, `claim_mappings`, `jit_provisioning`, domain binding), OAuth2 clients, and signing keys.

See [ai-gateway-governance.md](references/ai-gateway-governance.md) for every nested config key.

## Dataplane AI Resources (Agents, MCP Servers, Knowledge Bases)

Per-cluster (`dataplane_api_url`) AI resources, exposed as the v1alpha3 MCP tool groups:

- **AI Agents** — `ManagedAgentSpec` with `model`, `llm_provider`, `system_prompt`, `max_iterations` (0–200), `mcp_servers` (≤32 refs), and `subagents` (each restricted to a subset of the parent's MCP servers).
- **MCP Servers** — `RemoteMCPConfig`/`ManagedMCPConfig`, `code_mode`, and auth variants (`NoAuth`, `TokenPassthroughAuth`, `StaticKeyAuth`, `BasicAuth`, `APIKeyAuth`, `ServiceAccountOAuthAuth`, `UserOAuthAuth`) that reference secrets via `*_secret_ref`.
- **Knowledge Bases** — retrieval backing for agents.

See [ai-dataplane-resources.md](references/ai-dataplane-resources.md) for the full field set.

## Enterprise License Notes

Redpanda Cloud requires no separate license key. For **self-managed** Redpanda, the governance/security primitives the AI surface mirrors are gated behind a valid Enterprise license: Audit Logging (`audit_enabled`), RBAC (`rpk security role`), OAUTHBEARER/OIDC and Kerberos auth (`sasl_mechanisms`/`http_authentication`), FIPS (`fips_mode` — note `rpk ai`/`rpai` has no FIPS build), and Server-Side Schema ID Validation (`enable_schema_id_validation`). Check status with `rpk cluster license info`. See [enterprise-self-managed.md](references/enterprise-self-managed.md).

## Reference Directory

- [rpk-ai.md](references/rpk-ai.md): The `rpk ai` managed plugin — install/upgrade/uninstall lifecycle, the `rpai` plugin slug, auto-injection of `RPAI_TOKEN` and `RPAI_ENDPOINT`, and how the plugin is dispatched.
- [mcp.md](references/mcp.md): `rpk cloud mcp` in depth — stdio server, install command (Claude Desktop / Claude Code), proxy command, MCP tool groups exposed, auth/token refresh, and the allow-delete gate.
- [ai-gateway-governance.md](references/ai-gateway-governance.md): AI Gateway enterprise governance/security — guardrails (word + content filters), rate limits, spend limits, routing rules, model providers, access-control/RBAC policies, roles/teams, audit logging, and SSO/OIDC/OAuth2 — every nested proto field. Notes which map to Enterprise-licensed self-managed features.
- [ai-dataplane-resources.md](references/ai-dataplane-resources.md): Dataplane AI resources — AI Agents (`ManagedAgentSpec`), MCP servers (remote/managed config + auth variants), and Knowledge Bases, with their config keys grounded in the adp v1alpha1 proto.
- [enterprise-self-managed.md](references/enterprise-self-managed.md): The Enterprise-licensed self-managed config keys behind the AI surface's governance/security (Audit Logging, RBAC/GBAC, OIDC/OAuthBearer/Kerberos, FIPS, schema ID validation), plus the cluster/storage Enterprise features and `rpk cluster license info` verification.
