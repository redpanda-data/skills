# RBAC and IAM on Redpanda Cloud

Redpanda Cloud is a managed deployment of **Redpanda Enterprise Edition**, so **Role-Based Access Control (RBAC)** — an Enterprise feature — is available without applying your own license key. RBAC on Cloud spans two layers, and the `rpk cloud mcp` server exposes both:

1. **Organization / control-plane IAM** — who can manage clusters, networks, resource groups, and other org-level resources, via roles and role bindings (`redpanda/api/iam/v1`).
2. **Cluster / data-plane security** — roles and ACL-style permissions inside a specific Redpanda cluster (`redpanda/api/dataplane/v1` `SecurityService`), plus Kafka users and ACLs.

> License: RBAC is an Enterprise feature. On self-managed Redpanda, without a valid license you cannot create or modify roles or role-associated ACLs (role deletion is still allowed). On Cloud the managed platform supplies the license. See `get-started/licensing/overview.adoc`.

---

## Control-plane IAM (organization scope)

The Cloud MCP server forwards these IAM services (confirmed in the `rpk cloud mcp stdio` registration). These operate at the **organization** level over the control-plane API (`api.redpanda.com`), not against a specific cluster's data plane:

| IAM service | Typical operations |
|---|---|
| `OrganizationService` | Get / update the current organization |
| `PermissionService` | List the permissions available to assign |
| `RoleService` | Create / get / list / update / delete IAM roles |
| `RoleBindingService` | Create / get / list / delete role bindings (bind a role to a principal) |
| `ServiceAccountService` | Create / get / list / update / delete service accounts (and rotate secrets) |
| `UserService` | Get / list / delete org users |
| `UserInviteService` | Create / get / list / update / delete user invites |

A **role binding** ties an IAM **role** (a set of permissions) to a **principal** (a user or service account). Create the role, then bind it.

Because rpk does not yet ship first-class `rpk cloud role` / `rpk cloud role-binding` subcommands, you drive control-plane IAM either through:

- the **MCP server** (an AI agent calls `RoleService_CreateRole`, `RoleBindingService_CreateRoleBinding`, etc. — see [SKILL.md](../SKILL.md) MCP section), or
- the **Cloud control-plane REST API** directly, using a bearer token from `rpk cloud auth token`:

```bash
TOKEN=$(rpk cloud auth token)
curl -H "Authorization: Bearer $TOKEN" https://api.redpanda.com/v1/...   # IAM endpoints
```

> Delete RPCs (including `DeleteRole`, `DeleteRoleBinding`, `DeleteServiceAccount`) are **disabled by default** in the MCP server. Re-install with `rpk cloud mcp install --client <claude|claude-code> --allow-delete` and restart the MCP client to enable them.

---

## Data-plane security (cluster scope)

Once a profile is wired to a cluster (`rpk cloud cluster select`), cluster-internal RBAC and authorization are managed against the data plane. The Cloud MCP server forwards the data-plane `SecurityService` (cluster roles), the `ACLService`, and the `UserService`:

| Data-plane service | Purpose |
|---|---|
| `SecurityService` | Create / get / list / update / delete cluster roles; list and update role membership |
| `ACLService` | Create / list / delete Kafka ACLs |
| `UserService` | Create / list / update / delete SASL/Kafka users |

You can manage the same cluster-level RBAC with `rpk` once the profile points at the Cloud cluster:

```bash
rpk security role list
rpk security role create <role-name>
rpk security role delete <role-name>     # role deletion is allowed even without a license
rpk security acl create ...              # bind permissions to roles/principals
rpk security user create ...             # SASL users
```

The licensing reference documents that, to bring a self-managed cluster back into Community-edition compliance, you delete all configured roles:

```bash
rpk security role list
rpk security role delete <role-name>
```

(On Cloud this is not required — the platform license keeps RBAC active.)

---

## How RBAC relates to Cloud auth

- `rpk cloud login` authenticates you (a user or a service-account client-credential identity) to the **organization**; what you can then do is governed by your control-plane **role bindings**.
- `rpk cloud auth token` prints the bearer token that carries that identity; the control-plane API authorizes each call against your IAM permissions.
- After `rpk cloud cluster select`, your Kafka/Admin operations against the cluster are authorized by the cluster's **data-plane** ACLs and roles, which are separate from org-level IAM.

See [login-and-auth.md](login-and-auth.md) for the authentication flows and [clusters-and-resourcegroups.md](clusters-and-resourcegroups.md) for resource-group scoping.
