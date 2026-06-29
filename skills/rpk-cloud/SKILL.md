---
name: rpk-cloud
description: >-
  Authenticate and manage Redpanda Cloud from the CLI using the `rpk cloud`
  command group. Covers login (SSO browser flow and client credentials),
  logout, cloud auth management (list/use/delete/token), cluster selection
  (rpk cloud cluster select), resource group management, BYOC plugin
  provisioning (install/apply/destroy/validate), and the MCP server
  (stdio/install/proxy) that exposes Redpanda Cloud to AI agents.
  Use when: logging in to Redpanda Cloud with SSO or --client-id/--client-secret;
  setting RPK_CLOUD_CLIENT_ID or RPK_CLOUD_CLIENT_SECRET; creating or switching
  an rpk profile that points at a Cloud cluster; running rpk cloud cluster select;
  managing resource groups in Redpanda Cloud; running rpk cloud byoc apply or
  rpk cloud byoc install; configuring the rpk MCP server for Claude Desktop or
  Claude Code; running rpk cloud mcp stdio or rpk cloud mcp install; printing
  the current auth token with rpk cloud auth token; listing or switching cloud
  auths across multiple Redpanda Cloud organizations. Also covers the enterprise
  data features you drive against a Cloud cluster after cluster select: Tiered
  Storage Mountable Topics (rpk cluster storage mount/unmount/list-mountable),
  Iceberg Topics (redpanda.iceberg.mode/delete/partition.spec/target.lag.ms/
  invalid.record.action and iceberg_enabled), Cloud Topics
  (redpanda.cloud_topic.enabled / redpanda.storage.mode), Tiered Storage
  topic-level retention (redpanda.remote.read/write/delete), and RBAC/IAM
  (control-plane roles and role bindings, data-plane SecurityService).
  Use when: mounting or unmounting Cloud topics from object storage; enabling
  Iceberg or Cloud Topics on a Redpanda Cloud cluster; managing Cloud RBAC roles,
  role bindings, or service accounts. These are Redpanda Enterprise features,
  licensed by the managed Cloud platform.
---

# rpk cloud: Authenticate & Manage Redpanda Cloud

`rpk cloud` is the command group that connects rpk to Redpanda Cloud. It handles authentication (SSO and client credentials), profile creation, cluster selection, resource-group management, BYOC agent provisioning, and the MCP server integration for AI agents.

The seven top-level subgroups are:

| Subcommand | What it does |
|---|---|
| `rpk cloud login` | Authenticate to Redpanda Cloud (SSO or client credentials) |
| `rpk cloud logout` | Clear the stored auth token |
| `rpk cloud auth` | Manage named cloud authentications in rpk.yaml |
| `rpk cloud cluster` | Select a Cloud cluster (wires a profile to it) |
| `rpk cloud resource-group` | Create/list/delete resource groups (billing containers) |
| `rpk cloud byoc` | Install and run the BYOC agent plugin (Terraform) |
| `rpk cloud mcp` | Run or install the MCP server for AI agent integration |

## Quickstart

```bash
# 1. Log in via SSO (opens browser automatically)
rpk cloud login

# 1b. Log in with client credentials (headless / CI)
rpk cloud login \
  --client-id "abc123" \
  --client-secret "secret456" \
  --save                        # persist to rpk.yaml for token refresh

# 1c. Same, via environment variables (no flags needed)
export RPK_CLOUD_CLIENT_ID=abc123
export RPK_CLOUD_CLIENT_SECRET=secret456
rpk cloud login --no-profile   # skip interactive cluster-select

# 2. Select a Cloud cluster — wires your rpk profile to it
rpk cloud cluster select                  # interactive prompt
rpk cloud cluster select my-cluster-name  # by name
rpk cloud cluster select my-cluster-name --serverless-network public

# 3. Verify the profile is active and talk to the cluster
rpk topic list   # uses the profile set by cluster select

# 4. Print the current bearer token (useful for API calls)
rpk cloud auth token

# 5. List all stored cloud authentications
rpk cloud auth list

# 6. Manage resource groups
rpk cloud resource-group list
rpk cloud resource-group create my-rg
rpk cloud resource-group delete my-rg --no-confirm

# 7. BYOC: install the plugin and apply for a cluster
rpk cloud byoc install --redpanda-id <cluster-id>
rpk cloud byoc aws apply --redpanda-id <cluster-id>
rpk cloud byoc gcp apply --redpanda-id <cluster-id>
rpk cloud byoc azure apply --redpanda-id <cluster-id>

# 8. MCP: install into Claude Code (so the AI can manage your cloud)
rpk cloud login --no-profile
rpk cloud mcp install --client claude-code

# 8b. MCP: run the stdio server directly (MCP client calls this)
rpk cloud mcp stdio
rpk cloud mcp stdio --allow-delete   # also expose destructive RPCs
```

## Authentication Model

Redpanda Cloud uses **Auth0** under the hood. `rpk cloud login` runs either:

- **SSO flow (OAuth device-authorization flow)**: opens your browser to the Redpanda Cloud login page (Auth0 device flow). The CLI polls for the device code to be authorized; once approved, Auth0 issues a bearer token that is stored in `rpk.yaml`. When `--no-browser` is used, the URL and device code are printed to the terminal so you can complete the flow manually on another machine.
- **Client credentials flow**: exchanges a `client_id` + `client_secret` for a bearer token without a browser. Client credentials are created in the **Clients** tab of the Users section in the Redpanda Cloud UI.

Token and client ID are always persisted to `rpk.yaml`. The client secret is only persisted when you pass `--save`.

Priority order for client credentials (highest to lowest):

1. `client_id` / `client_secret` fields in the active `rpk cloud auth` entry in `rpk.yaml`
2. `RPK_CLOUD_CLIENT_ID` / `RPK_CLOUD_CLIENT_SECRET` environment variables
3. `--client-id` / `--client-secret` flags

When no credentials are provided, rpk falls back to SSO.

## Flags Available on `rpk cloud login`

| Flag | Type | Description |
|---|---|---|
| `--client-id` | string | Client ID from Redpanda Cloud |
| `--client-secret` | string | Client secret from Redpanda Cloud |
| `--no-browser` | bool | Disable auto-opening the browser for SSO |
| `--save` | bool | Persist client secret to rpk.yaml |
| `--no-profile` | bool | Skip the automatic cloud-profile creation/prompt |

## Cloud Auth Subcommands

`rpk cloud auth` stores multiple named authentications in `rpk.yaml` for users who have multiple Cloud organizations or want to switch between SSO and client-credential auth. Subcommands:

- `list` (`ls`) — list all cloud auths (current is marked with `*`)
- `use <NAME>` — switch the active cloud auth
- `delete <NAME>` — remove a cloud auth from rpk.yaml
- `token` — print the current bearer token to stdout

> `rpk cloud auth create`, `rpk cloud auth rename-to`, and `rpk cloud auth edit` are deprecated/hidden no-ops; use `rpk cloud login` instead.

## Cluster Select & Profile Wiring

`rpk cloud cluster select [NAME]` is equivalent to `rpk profile create --from-cloud=NAME`. It calls the Redpanda Cloud control-plane API, retrieves the cluster's data-plane URL, and writes the broker/admin/registry endpoints into the active rpk profile (default profile name: `rpk-cloud`). After this, plain `rpk topic list` (no flags) talks to the Cloud cluster.

For Serverless clusters that offer both public and private networking, use `--serverless-network public|private` to avoid an interactive prompt.

## Resource Groups

Resource groups are organizational containers (the billing/account boundary) in Redpanda Cloud. The `rpk cloud resource-group` command (aliases: `namespace`, `ns`) lets you manage them:

```bash
rpk cloud resource-group create prod-rg staging-rg   # create multiple
rpk cloud resource-group list
rpk cloud resource-group delete prod-rg --no-confirm  # --no-confirm skips the interactive prompt
```

## BYOC Agent Provisioning

For BYOC clusters, Redpanda runs an agent in your cloud account that provisions the full cluster via Terraform. The `rpk cloud byoc` plugin wraps that Terraform invocation:

1. Create the cluster in the Redpanda Cloud UI → get a `--redpanda-id`
2. `rpk cloud byoc install --redpanda-id <id>` — download the pinned plugin version
3. `rpk cloud byoc <aws|gcp|azure> apply --redpanda-id <id>` — run Terraform to create the agent
4. `rpk cloud byoc <aws|gcp|azure> destroy --redpanda-id <id>` — tear it down
5. `rpk cloud byoc validate` — validate credentials/prerequisites (uses latest plugin)

The plugin version is pinned to what the control plane specifies for your cluster. Set `RPK_CLOUD_SKIP_VERSION_CHECK=1` to skip the version enforcement (development use only).

## MCP Server for AI Agents

`rpk cloud mcp` runs an MCP (Model Context Protocol) server that exposes Redpanda Cloud management tools to AI assistants such as Claude Desktop and Claude Code.

Three subcommands:

| Subcommand | Description |
|---|---|
| `stdio` | Run the MCP server on stdio (the transport an MCP client calls) |
| `install` | Write the MCP config entry into Claude Desktop or Claude Code (`--client` is required; accepted values: `claude`, `claude-code`) |
| `proxy` | Proxy MCP requests to a remote MCP server inside a cluster (`--mcp-server-id` required; one of `--cluster-id` or `--serverless-cluster-id` required) |

The `stdio` server exposes tools across the full Redpanda Cloud API surface:
- Control Plane: clusters, serverless clusters, networks, resource groups, regions, IAM (roles, role bindings, service accounts, users)
- Data Plane (per cluster): topics, ACLs, users, secrets, pipelines, quotas, transforms, AI agents, MCP servers, knowledge bases
- AI Gateway (the legacy `aigateway/v1` control-plane surface): gateways, backend pools, models, model providers, guardrails, rate limits, spend limits, routing rules, OAuth2 clients and keys, SSO, access control, MCP tools, organizations, teams, roles, audit, analytics, and workspace management. The current ADP data-plane gateway (budgets instead of spend limits, no routing/rate-limit surface) is covered by `/redpanda:adp`.

By default, **delete operations are disabled**. Pass `--allow-delete` to enable them.

Quick install to Claude Code:

```bash
rpk cloud login --no-profile      # authenticate first
rpk cloud mcp install --client claude-code
# writes to ~/.claude.json
```

Quick install to Claude Desktop:

```bash
rpk cloud mcp install --client claude
# writes to ~/Library/Application Support/Claude/claude_desktop_config.json (macOS)
```

## Enterprise Data Features on Cloud Clusters

Redpanda Cloud is a managed deployment of **Redpanda Enterprise Edition** — the license is supplied by the platform, so the enterprise differentiators are available without applying your own key. After `rpk cloud cluster select` wires a profile to the cluster, you drive these enterprise data-plane features with the normal `rpk topic`, `rpk cluster config`, and `rpk cluster storage` commands:

| Feature | How to use it | Key config / commands |
|---|---|---|
| **Mountable Topics** (Tiered Storage mount/unmount — migration & DR) | `rpk cluster storage` commands route to the Cloud `CloudStorageService` | `list-mountable`, `mount [TOPIC] --to NS/NAME`, `unmount`, `list-mount --filter`, `status-mount <ID>`, `cancel-mount <ID>`. Cloud allows only the `kafka` namespace |
| **Iceberg Topics** | Enable on cluster, then set per-topic mode | Cluster: `iceberg_enabled`, `iceberg_default_catalog_namespace`. Topic: `redpanda.iceberg.mode` (`key_value`/`value_schema_id_prefix`/`value_schema_latest`/`disabled`), `redpanda.iceberg.delete`, `redpanda.iceberg.partition.spec`, `redpanda.iceberg.target.lag.ms`, `redpanda.iceberg.invalid.record.action` (`dlq_table`/`drop`) |
| **Cloud Topics** | Object-storage-native topic mode | `redpanda.cloud_topic.enabled`, or `redpanda.storage.mode` = `local`/`tiered`/`cloud`/`unset` |
| **Tiered Storage retention** | Per-topic Tiered Storage / local retention | `redpanda.remote.read`, `redpanda.remote.write`, `redpanda.remote.delete`, `initial.retention.local.target.bytes`/`.ms` |
| **RBAC / IAM** | Org roles/bindings + cluster roles/ACLs | Control plane: `RoleService`, `RoleBindingService`, `ServiceAccountService`. Data plane: `rpk security role`, `rpk security acl`, `rpk security user` |

All of the above are **Enterprise** features (licensed by the Cloud platform). The MCP server (`rpk cloud mcp`) exposes the same `CloudStorageService`, `TopicService`, IAM `RoleService`/`RoleBindingService`, and data-plane `SecurityService`/`ACLService` RPCs to AI agents; delete RPCs require `--allow-delete`. See [enterprise-data-features.md](references/enterprise-data-features.md) and [rbac-and-iam.md](references/rbac-and-iam.md).

## Reference Directory

- [login-and-auth.md](references/login-and-auth.md): `rpk cloud login` flags, SSO vs client-credentials flow, `rpk cloud auth` subcommands (list/use/delete/token), RPK_CLOUD_CLIENT_ID/SECRET env vars, and token storage in rpk.yaml.
- [clusters-and-resourcegroups.md](references/clusters-and-resourcegroups.md): `rpk cloud cluster select` mechanics, how the profile is wired, `--serverless-network` flag, and full `rpk cloud resource-group` subcommand reference.
- [byoc.md](references/byoc.md): BYOC plugin install/apply/destroy/validate lifecycle, `--redpanda-id`, provider subcommands (aws/gcp/azure), `RPK_CLOUD_SKIP_VERSION_CHECK`, and how the plugin downloads and pins to the cluster's Terraform version.
- [enterprise-data-features.md](references/enterprise-data-features.md): Enterprise data-plane features driven against a Cloud cluster — Mountable Topics (`rpk cluster storage mount/unmount/list-mountable/list-mount/status-mount/cancel-mount`, Cloud `CloudStorageService`, kafka-namespace restriction, migration IDs), Iceberg Topics (`iceberg_enabled`, `redpanda.iceberg.mode/delete/partition.spec/target.lag.ms/invalid.record.action` with values and defaults), Cloud Topics (cluster prerequisite `cloud_topics_enabled=true`, topic-level `redpanda.cloud_topic.enabled`, `redpanda.storage.mode`), and Tiered Storage topic-level retention (`redpanda.remote.read/write/delete`, `initial.retention.local.target.*`). All Enterprise features, licensed by the Cloud platform.
- [rbac-and-iam.md](references/rbac-and-iam.md): RBAC on Cloud — control-plane IAM (`OrganizationService`, `PermissionService`, `RoleService`, `RoleBindingService`, `ServiceAccountService`, `UserService`, `UserInviteService`) vs data-plane security (`SecurityService` cluster roles, `ACLService`, `UserService`; `rpk security role/acl/user`), how RBAC relates to `rpk cloud login` / `auth token`, and the MCP `--allow-delete` requirement for delete RPCs. Enterprise feature.
