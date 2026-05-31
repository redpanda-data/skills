# rpk security role: RBAC Roles & rpk security secret

## Roles (RBAC)

`rpk security role` implements Role-Based Access Control (RBAC). Roles are named groups to which ACLs are bound. You assign principals (users) to roles, and those users inherit all the role's ACL permissions.

The `role` command group has aliases: `rpk security access` and `rpk security roles` are equivalent to `rpk security role`.

**RBAC is an Enterprise feature on self-hosted clusters.** On Redpanda Cloud (non-serverless) clusters, RBAC is available through the Dataplane API.

When a role is created, it has no permissions. ACLs are bound to a role using `--allow-role <rolename>` in `rpk security acl create`. Internally, Redpanda uses the principal `RedpandaRole:<rolename>` in the ACL store.

### How Roles Work

```
                   +------------------+
  Principal ───►   │   Role           │  ───► ACLs (permissions)
  User:alice        │  data-engineers  │
  User:bob     ──►  │                  │  --allow-role data-engineers
                   +------------------+      --operation read,describe
                                             --topic 'events-'
```

A user can be a member of multiple roles. The effective permissions are the union of all role ACLs plus any direct user ACLs.

### role create

```
rpk security role create [ROLE] [flags]
```

Creates a named role with no permissions. After creation, attach ACLs using `rpk security acl create --allow-role`.

```bash
rpk security role create data-engineers
# Output:
#   Successfully created role "data-engineers"
#
#   ACLs can now be added to this role using
#     rpk security acl create --allow-role "RedpandaRole:data-engineers" [acl-flags]
```

The command prints a reminder showing the full `RedpandaRole:data-engineers` principal form for reference.

### role list

```
rpk security role list [flags]
# Aliases: rpk security role ls
```

**Flags:**

| Flag | Type | Description |
|------|------|-------------|
| `--prefix` | string | Return roles whose names start with this prefix |
| `--principal` | string | Return roles assigned to this principal; bare name defaults to `User:` |

```bash
# All roles
rpk security role list

# Roles with prefix "agent-"
rpk security role list --prefix "agent-"

# Roles assigned to user alice
rpk security role list --principal alice

# Roles assigned to a group
rpk security role list --principal Group:engineering
```

### role describe

```
rpk security role describe [ROLE] [flags]
# Aliases: rpk security role info
```

Prints the role's ACL permissions and the list of principals (members) assigned to it. By default, prints both sections.

**Flags:**

| Flag | Short | Description |
|------|-------|-------------|
| `--print-permissions` | `-p` | Print the ACL permissions section only |
| `--print-members` | `-m` | Print the members section only |
| `--print-all` | `-a` | Print all sections (default behavior) |

```bash
# Show everything
rpk security role describe data-engineers

# Only the ACLs bound to the role
rpk security role describe data-engineers --print-permissions

# Only the members
rpk security role describe data-engineers --print-members

# JSON output
rpk security role describe data-engineers --format json
```

Output for permissions section: `Principal`, `Host`, `Resource-Type`, `Resource-Name`, `Resource-Pattern-Type`, `Operation`, `Permission`.

Output for members section: `NAME`, `TYPE` (User or Group).

### role delete

```
rpk security role delete [ROLE] [flags]
```

Deletes a role. This removes all ACLs bound to the role (`RedpandaRole:<name>` principal) and unassigns all members. Prompts for confirmation by default.

**Flags:**

| Flag | Description |
|------|-------------|
| `--no-confirm` | Skip the confirmation prompt |

```bash
# With confirmation prompt (shows role contents first)
rpk security role delete data-engineers

# Without prompt
rpk security role delete data-engineers --no-confirm
```

### role assign

```
rpk security role assign [ROLE] --principal [PRINCIPALS...] [flags]
```

Assigns one or more principals to a role. The `--principal` flag accepts `<PrincipalPrefix>:<name>` or bare name (defaults to `User:`).

**Flags:**

| Flag | Required | Description |
|------|----------|-------------|
| `--principal` | yes | Comma-separated principals to assign (repeatable) |

```bash
# Assign one user
rpk security role assign data-engineers --principal alice

# Assign multiple users (comma-separated)
rpk security role assign data-engineers --principal alice,bob

# Assign explicitly typed
rpk security role assign data-engineers --principal User:alice

# Assign a group
rpk security role assign data-engineers --principal Group:engineering
```

### role unassign

```
rpk security role unassign [ROLE] --principal [PRINCIPALS...] [flags]
# Aliases: rpk security role remove
```

Removes one or more principals from a role.

```bash
rpk security role unassign data-engineers --principal alice
rpk security role unassign data-engineers --principal alice,bob
rpk security role unassign data-engineers --principal Group:engineering
```

### Binding ACLs to a Role

After creating a role, use `rpk security acl create` with `--allow-role` or `--deny-role`:

```bash
# Create the role
rpk security role create data-engineers

# Bind read access to all topics starting with "events-"
rpk security acl create \
  --allow-role data-engineers \
  --operation read,describe \
  --topic 'events-' \
  --resource-pattern-type prefixed

# Bind read access to consumer groups starting with "events-"
rpk security acl create \
  --allow-role data-engineers \
  --operation read,describe \
  --group 'events-' \
  --resource-pattern-type prefixed

# Assign users to the role
rpk security role assign data-engineers --principal alice,bob,carol

# Verify
rpk security role describe data-engineers
```

To deny a role access, use `--deny-role`:

```bash
rpk security acl create \
  --deny-role untrusted \
  --operation all \
  --topic sensitive-data
```

### Full RBAC Workflow Example

```bash
# 1. Create roles
rpk security role create producer-role
rpk security role create consumer-role
rpk security role create admin-role

# 2. Attach ACLs to roles
# producer-role: write to all topics
rpk security acl create --allow-role producer-role \
  --operation write,describe --topic '*'

# consumer-role: read from events* topics, use any consumer group
rpk security acl create --allow-role consumer-role \
  --operation read,describe \
  --topic 'events-' --resource-pattern-type prefixed
rpk security acl create --allow-role consumer-role \
  --operation read,describe --group '*'

# admin-role: full cluster admin
rpk security acl create --allow-role admin-role \
  --operation all --topic '*'
rpk security acl create --allow-role admin-role \
  --operation all --group '*'
rpk security acl create --allow-role admin-role \
  --operation alter,describe --cluster

# 3. Create users and assign roles
rpk security user create producer-svc --password 'ProdPass!'
rpk security user create consumer-svc --password 'ConsPass!'
rpk security role assign producer-role --principal producer-svc
rpk security role assign consumer-role --principal consumer-svc
```

---

## Secrets (Cloud Only)

`rpk security secret` manages secrets for Redpanda Cloud clusters. Secrets store sensitive values (API keys, passwords, tokens) that can be referenced by other cluster resources.

**This command is only available for cloud clusters** (both serverless and dedicated). It uses the Dataplane API.

### Secret Name Constraints

- Must start with an **uppercase letter** (`[A-Z]`)
- May contain **uppercase letters, digits, and underscores** only
- Maximum 255 characters
- Examples: `MY_API_KEY`, `DB_PASSWORD_PROD`, `CONNECT_SECRET1`

Invalid: `my_key` (lowercase), `1KEY` (starts with digit), `MY-KEY` (hyphen)

### Available Scopes

| Scope | Description |
|-------|-------------|
| `redpanda_connect` | Used by Redpanda Connect pipelines |
| `redpanda_cluster` | Used by Redpanda cluster resources |

A secret can have multiple scopes.

### secret create

```
rpk security secret create [flags]
```

**Flags (all required):**

| Flag | Type | Description |
|------|------|-------------|
| `--name` | string | Secret name (must match naming rules) |
| `--value` | string | Secret value to store |
| `--scopes` | strings | Scopes (comma-separated or repeated) |

```bash
# Create a secret for Redpanda Connect
rpk security secret create \
  --name MY_DB_PASSWORD \
  --value 'super-secret-db-pass' \
  --scopes redpanda_connect

# Create with multiple scopes
rpk security secret create \
  --name API_TOKEN \
  --value 'tok-abc123' \
  --scopes redpanda_connect,redpanda_cluster
```

### secret list

```
rpk security secret list [flags]
# Alias: (none; use full name)
```

**Flags:**

| Flag | Type | Description |
|------|------|-------------|
| `--name-contains` | string | Filter secrets whose names contain this substring (case-sensitive) |
| `--format` | string | Output format: `text`, `json`, `yaml` |

```bash
# List all secrets
rpk security secret list

# Filter by name substring
rpk security secret list --name-contains DB

# JSON output
rpk security secret list --format json
```

Output columns: `NAME`, `SCOPES`.

### secret update

```
rpk security secret update [flags]
```

Overwrites the secret value and scopes (full replacement). **All three flags are required.**

```bash
rpk security secret update \
  --name MY_DB_PASSWORD \
  --value 'new-super-secret-pass' \
  --scopes redpanda_connect
```

### secret delete

```
rpk security secret delete [flags]
```

Deletes a secret permanently.

```bash
rpk security secret delete --name MY_DB_PASSWORD
```

### Notes on Secrets

- Secrets are specific to a cloud cluster. They are not shared across clusters.
- Secret values are never returned in list or describe output — only the name and scope are shown.
- Attempting to create a secret with a name that already exists returns `AlreadyExists`.
- The `--name` flag value must already be uppercase and match `^[A-Z][A-Z0-9_]*$` — the CLI validates the name before sending and rejects lowercase or invalid characters with an error. No normalization is performed; lowercase input (e.g., `my_key`) is rejected, not silently uppercased. Note: `secret delete` also sends the name as-is without uppercasing, so the name must be provided in valid uppercase form.
