# rpk cloud mcp: MCP Server Reference

`rpk cloud mcp` runs a local **Model Context Protocol (MCP) server** that exposes Redpanda Cloud operations as LLM-callable tools. Wire it into Claude Desktop or Claude Code and an AI agent can create topics, list clusters, manage ACLs, configure the AI Gateway, and more.

Source: `redpanda/src/go/rpk/pkg/cli/cloud/mcp/mcp.go`

---

## Subcommands

| Command | Description |
|---------|-------------|
| `rpk cloud mcp stdio` | Run the MCP server on stdio (the transport used by MCP clients) |
| `rpk cloud mcp install` | Write MCP config into Claude Desktop or Claude Code automatically |
| `rpk cloud mcp proxy` | Proxy stdio to a remote dataplane MCP server in a cluster |

---

## `rpk cloud mcp stdio`

Starts the MCP server and communicates over stdin/stdout. This is the transport an MCP client (Claude Desktop, Claude Code, any MCP-compatible client) calls as a subprocess.

```bash
rpk cloud mcp stdio

# Enable delete operations (disabled by default)
rpk cloud mcp stdio --allow-delete
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--allow-delete` | bool | false | Allow delete RPCs. When false, any tool call whose name contains `delete` (case-insensitive) returns an error instructing the user to re-run with `--allow-delete` and restart their MCP client. |

**How it works:**
1. Reads the active rpk profile to find the cloud auth token.
2. Validates the token on each tool call (`maybeReloadToken`). If expired, the tool returns an error message telling the user to run `rpk cloud login --no-profile`.
3. Registers tool handlers for all exposed service groups (see below).
4. Serves via `server.ServeStdio` (from the `mark3labs/mcp-go` library).

Token refresh behavior: rpk does not automatically refresh OAuth tokens during stdio. If the token expires mid-session, the next tool call returns a human-readable error instructing the user to re-login and retry. No silent refresh occurs.

---

## `rpk cloud mcp install`

Writes the MCP server configuration into the appropriate client config file. You do not need to edit JSON by hand.

```bash
# Claude Code — writes to ~/.claude.json
rpk cloud mcp install --client claude-code

# Claude Desktop — writes to ~/Library/Application Support/Claude/claude_desktop_config.json (macOS)
#                  or %APPDATA%\Claude\claude_desktop_config.json (Windows)
rpk cloud mcp install --client claude

# Enable delete operations in the installed config
rpk cloud mcp install --client claude-code --allow-delete
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--client` | string | (required) | MCP client to configure. Accepted values: `claude` (Claude Desktop), `claude-code`. The flag is marked required even though the binary registers an internal default of `"claude"`; you must always pass it explicitly. |
| `--allow-delete` | bool | false | Include `--allow-delete` in the installed args. |

**What gets written:**

The install command sets `mcpServers.<serverName>.command = "rpk"` and `mcpServers.<serverName>.args = [...]` in the target JSON file. The args always include `--config <rpk.yaml path>` plus the subcommand path. If the active profile has a `cloud_environment` override, `-X cloud_environment=<value>` is prepended. The server name is `redpandaCloud`.

The `--config` value is the path returned by `config.DefaultRpkYamlPath()` (`os.UserConfigDir()` + `rpk/rpk.yaml`). This is **OS-specific**:
- Linux/XDG: `~/.config/rpk/rpk.yaml` (or `$XDG_CONFIG_HOME/rpk/rpk.yaml`)
- macOS: `~/Library/Application Support/rpk/rpk.yaml`
- Windows: `%AppData%\rpk\rpk.yaml`

Using `rpk cloud mcp install` is recommended because it always writes the correct path for the current OS. If you hand-edit, make sure to use the correct path for your platform.

Example result in `~/.claude.json` on **Linux**:
```json
{
  "mcpServers": {
    "redpandaCloud": {
      "command": "rpk",
      "args": [
        "--config", "/home/you/.config/rpk/rpk.yaml",
        "cloud", "mcp", "stdio"
      ]
    }
  }
}
```

Example result on **macOS**:
```json
{
  "mcpServers": {
    "redpandaCloud": {
      "command": "rpk",
      "args": [
        "--config", "/Users/you/Library/Application Support/rpk/rpk.yaml",
        "cloud", "mcp", "stdio"
      ]
    }
  }
}
```

With `--allow-delete` (Linux example):
```json
{
  "mcpServers": {
    "redpandaCloud": {
      "command": "rpk",
      "args": [
        "--config", "/home/you/.config/rpk/rpk.yaml",
        "cloud", "mcp", "stdio",
        "--allow-delete"
      ]
    }
  }
}
```

After running `rpk cloud mcp install`, **restart your MCP client** for the change to take effect. To turn off delete operations later, re-run without `--allow-delete` and restart the client again.

---

## `rpk cloud mcp proxy`

Proxies MCP requests from stdio to a **remote MCP server running inside a Redpanda Cloud cluster** (a dataplane `MCPServer` resource). Useful when a cluster hosts its own MCP server and you want to expose it to a local AI agent.

```bash
# Proxy to an MCP server in a regular (BYOC/dedicated) cluster
rpk cloud mcp proxy \
  --cluster-id <cluster-id> \
  --mcp-server-id <mcp-server-id>

# Proxy to an MCP server in a serverless cluster
rpk cloud mcp proxy \
  --serverless-cluster-id <serverless-cluster-id> \
  --mcp-server-id <mcp-server-id>

# Install the proxy config into Claude Code (instead of serving live)
rpk cloud mcp proxy \
  --cluster-id <cluster-id> \
  --mcp-server-id <mcp-server-id> \
  --install --client claude-code
```

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--cluster-id` | string | — | Regular (BYOC/dedicated) cluster ID. Mutually exclusive with `--serverless-cluster-id`. |
| `--serverless-cluster-id` | string | — | Serverless cluster ID. Mutually exclusive with `--cluster-id`. |
| `--mcp-server-id` | string | (required) | ID of the `MCPServer` resource inside the cluster to proxy to. |
| `--install` | bool | false | Write proxy config into the MCP client config file instead of serving stdio. Requires `--client`. |
| `--client` | string | — | MCP client to configure (required with `--install`). Values: `claude`, `claude-code`. |

**How the proxy works:**
1. Calls `GetCluster` (or `GetServerlessCluster`) to obtain the dataplane API URL.
2. Calls `GetMCPServer` on the dataplane to obtain the remote MCP server URL.
3. Creates a `StreamableHttpClient` connected to the remote URL, authenticating each request with `Authorization: Bearer <token>`.
4. Registers all remote tools into a local stdio MCP server.
5. Forwards incoming tool calls to the remote server and returns results to the local client.

Note: The tool list is populated once at startup and does not update dynamically during a session.

---

## MCP Tool Groups Exposed by `stdio`

The stdio server registers tools from these service layers. Each tool corresponds to one RPC in the underlying ConnectRPC API.

### Control Plane (api.redpanda.com)

| Service | Tools include |
|---------|---------------|
| RegionService | ListRegions, GetRegion |
| ResourceGroupService | CreateResourceGroup, GetResourceGroup, ListResourceGroups, UpdateResourceGroup, DeleteResourceGroup |
| ClusterService | CreateCluster, GetCluster, ListClusters, UpdateCluster, DeleteCluster |
| NetworkService | CreateNetwork, GetNetwork, ListNetworks, DeleteNetwork |
| ServerlessClusterService | CreateServerlessCluster, GetServerlessCluster, ListServerlessClusters, UpdateServerlessCluster, DeleteServerlessCluster |
| ServerlessRegionService | ListServerlessRegions, GetServerlessRegion |
| OperationService | GetOperation, ListOperations |

### IAM (api.redpanda.com)

| Service | Tools include |
|---------|---------------|
| OrganizationService | GetCurrentOrganization, UpdateOrganization |
| PermissionService | ListPermissions |
| RoleService | CreateRole, GetRole, ListRoles, UpdateRole, DeleteRole |
| RoleBindingService | CreateRoleBinding, GetRoleBinding, ListRoleBindings, DeleteRoleBinding |
| ServiceAccountService | CreateServiceAccount, GetServiceAccount, ListServiceAccounts, UpdateServiceAccount, DeleteServiceAccount |
| UserService | GetUser, ListUsers, DeleteUser |
| UserInviteService | CreateUserInvite, GetUserInvite, ListUserInvites, UpdateUserInvite, DeleteUserInvite |

### Dataplane (per-cluster dataplane URL)

Dataplane tools require a `dataplane_api_url` parameter — obtain it from `GetCluster` or `GetServerlessCluster`.

| Service | Tools include |
|---------|---------------|
| TopicService | CreateTopic, ListTopics, DeleteTopic, GetTopicConfigurations, SetTopicConfigurations, UpdateTopicConfigurations, AddTopicPartitions |
| PipelineService | CreatePipeline, GetPipeline, ListPipelines, UpdatePipeline, DeletePipeline, StartPipeline, StopPipeline, LintPipelineConfig |
| ACLService | CreateACL, ListACLs, DeleteACLs |
| CloudStorageService | MountTopics, UnmountTopics, ListMountTasks, GetMountTask, DeleteMountTask, UpdateMountTask |
| QuotaService | ListQuotas, SetQuota, DeleteQuota, BatchSetQuota, BatchDeleteQuota |
| SecretService | CreateSecret, GetSecret, ListSecrets, UpdateSecret, DeleteSecret |
| SecurityService (RBAC) | CreateRole, GetRole, ListRoles, DeleteRole, ListRoleMembers, UpdateRoleMembership |
| TransformService | GetTransform, ListTransforms, DeleteTransform |
| UserService | CreateUser, ListUsers, UpdateUser, DeleteUser |
| AIAgentService (v1alpha3) | CreateAIAgent, GetAIAgent, ListAIAgents, UpdateAIAgent, DeleteAIAgent, StartAIAgent, StopAIAgent |
| KnowledgeBaseService (v1alpha3) | CreateKnowledgeBase, GetKnowledgeBase, ListKnowledgeBases, UpdateKnowledgeBase, DeleteKnowledgeBase |
| MCPServerService (v1alpha3) | CreateMCPServer, GetMCPServer, ListMCPServers, UpdateMCPServer, DeleteMCPServer, StartMCPServer, StopMCPServer, LintMCPConfig |

### AI Gateway (per-gateway URL)

AI Gateway tools require an `ai_gateway_url` parameter.

| Service | Key tools |
|---------|-----------|
| AccessControlService | CreatePolicy, GetPolicy, ListPolicies, UpdatePolicy, DeletePolicy, ValidatePolicy, EvaluateAccess, GetPolicyEntities, ListPolicyVersions |
| AccountService | CreateAccount, GetAccount, ListAccounts, UpdateAccount, DeleteAccount, GetAccountLicense, SetAccountLicense |
| AnalyticsService | GetSpendingSummary, GetSpendingBreakdown, GetSpendingTimeSeries, GetTopSpenders |
| AuditService | GetAuditLog, ListAuditLogs |
| AuthService | Login, Logout, Register, InviteUser, ChangePassword, GetCurrentUser, AcceptInvite, ListInvites, RefreshToken, RequestPasswordReset, ResetPassword, RevokeInvite, VerifyEmail |
| BackendPoolService | CreateBackendPool, GetBackendPool, ListBackendPools, UpdateBackendPool, DeleteBackendPool |
| ConfigService | GetActiveConfiguration, GetConfiguration, ListConfigurations, StageConfiguration, PublishConfiguration, DeployConfiguration, ReleaseConfiguration, RollbackConfiguration |
| GatewayConfigService | FetchConfig |
| GatewayService | CreateGateway, GetGateway, ListGateways, UpdateGateway, DeleteGateway |
| GuardrailService | CreateGuardrail, GetGuardrail, ListGuardrails, UpdateGuardrail, DeleteGuardrail |
| IAMSettingsService | GetIAMSetting, ListIAMSettings, UpdateIAMSetting, DeleteIAMSetting, BatchUpdateIAMSettings |
| MCPToolsService | ListMCPTools |
| ModelPricingService | GetStandardPrice, ListStandardPrices, UpdateStandardPrice, CreateStandardPrice, DeleteStandardPrice, CreateCustomPrice, GetCustomPrice, ListCustomPrices, UpdateCustomPrice, DeleteCustomPrice, GetEffectivePrice, ListPriceHistory |
| ModelProvidersService | GetModelProvider, ListModelProviders, EnableModelProvider, DisableModelProvider, UpdateModelProvider |
| ModelsService | CreateModel, GetModel, ListModels, UpdateModel, DeleteModel, EnableModel, DisableModel, ListDisabledModels |
| OAuth2ClientService | CreateOAuth2Client, GetOAuth2Client, ListOAuth2Clients, UpdateOAuth2Client, DeleteOAuth2Client, DisableOAuth2Client, RotateOAuth2ClientSecret, ValidateClientCredentials |
| OAuth2KeyService | CreateOAuth2Key, GetOAuth2Key, ListOAuth2Keys, RotateOAuth2Keys, DeactivateOAuth2Key, DeleteOAuth2Key, GetJWKS |
| OrganizationService | CreateOrganization, GetOrganization, ListOrganizations, UpdateOrganization, DeleteOrganization |
| ProviderConfigService | CreateProviderConfig, GetProviderConfig, ListProviderConfigs, UpdateProviderConfig, DeleteProviderConfig, TestProviderConfig |
| RateLimitService | CreateRateLimit, GetRateLimit, ListRateLimits, UpdateRateLimit, DeleteRateLimit |
| RoleService | CreateRole, GetRole, ListRoles, UpdateRole, DeleteRole, AssignTeamRole, UnassignTeamRole, ListTeamRoles, ListRoleTeams |
| RoutingService | CreateRoutingRule, GetRoutingRule, ListRoutingRules, UpdateRoutingRule, DeleteRoutingRule |
| SettingsService | GetSettings, UpdateSettings |
| SpendLimitService | CreateSpendLimit, GetSpendLimit, ListSpendLimits, UpdateSpendLimit, DeleteSpendLimit, GetSpendLimitUsage |
| SSOService | CreateIdentityProvider, GetIdentityProvider, ListIdentityProviders, UpdateIdentityProvider, DeleteIdentityProvider, AddDomain, ListDomains, RemoveDomain, VerifyDomain, LookupIdPByEmail, TestCredentials |
| TeamService | CreateTeam, GetTeam, ListTeams, UpdateTeam, DeleteTeam, AddTeamMember, GetTeamMember, ListTeamMembers, RemoveTeamMember, UpdateTeamMember |
| UserService | CreateUser, GetUser, ListUsers, UpdateUser, DeleteUser, AddUserToOrganization, RemoveUserFromOrganization, ListUserOrganizations, ListUserTeams, UpdateUserOrganizationRole, GetPersonalTokenInfo, RevealPersonalToken, RotatePersonalToken |
| VisualMetadataService | SaveVisualMetadata, GetVisualMetadata, DeleteVisualMetadata |
| WorkspaceService | CreateWorkspace, GetWorkspace, ListWorkspaces, UpdateWorkspace, DeleteWorkspace |

---

## Auth and Token Management

The MCP stdio server performs a token validity check (`maybeReloadToken`) before every tool call. It does **not** silently refresh tokens via OAuth. If the token is expired or was never set:

- If never logged in: returns an error: `failed to validate Cloud token ... Instruct the user to run 'rpk cloud login --no-profile'`
- If expired: returns an error: `the Redpanda Cloud token is expired. Instruct the user to run 'rpk cloud login --no-profile'`

After the user runs `rpk cloud login --no-profile`, they can ask the AI to retry the operation.

---

## Delete Protection

By default, any tool call whose name contains `delete` (case-insensitive) is rejected with:

> `deletes are forbidden. Tell the user that they can enable deletes by running rpk cloud mcp install --allow-delete. This will permanently turn on deletes via MCP, which is off by default. Then, they must restart their MCP client. It is important that you tell them to restart their client. To turn it back off, they can run it without the --allow-delete flag`

Note: the error message shows the bare command `rpk cloud mcp install --allow-delete` without `--client`. That exact command will fail because `--client` is a required flag. The user must run `rpk cloud mcp install --client claude` or `rpk cloud mcp install --client claude-code --allow-delete` depending on their client.

To turn on delete operations:

```bash
# Re-run install with the flag, then restart your MCP client
rpk cloud mcp install --client claude-code --allow-delete
```

To turn it back off:

```bash
rpk cloud mcp install --client claude-code   # no --allow-delete
# restart your MCP client
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Tools not available after install | Restart the MCP client (Claude Desktop or Claude Code) |
| `the Redpanda Cloud token is expired` tool error | Run `rpk cloud login --no-profile`, then retry |
| `deletes are forbidden` tool error | Re-run `rpk cloud mcp install --client <name> --allow-delete` and restart client |
| `--client flag is required when using --install` | Pass `--client claude` or `--client claude-code` alongside `--install` |
| `must specify either --cluster-id or --serverless-cluster-id` | Pass exactly one of these flags to `rpk cloud mcp proxy` |
| Dataplane tool fails with missing `dataplane_api_url` | Get the URL first by calling `GetCluster` or `GetServerlessCluster`, then pass it to the dataplane tool |
| AI Gateway tool fails with missing `ai_gateway_url` | Obtain the AI Gateway URL from the cluster details and pass it to the AI Gateway tool |
