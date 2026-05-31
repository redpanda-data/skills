---
name: rpk-security
description: >-
  Manages Redpanda authentication and authorization from the CLI using the
  `rpk security` command group (user, acl, role, secret subcommands). Use when:
  creating or deleting SASL/SCRAM users; changing user passwords; listing SASL
  users; granting or revoking Kafka ACLs (topics, consumer groups, cluster,
  transactional IDs, Schema Registry subjects); listing or deleting ACLs;
  creating or deleting RBAC roles (Enterprise); assigning or unassigning roles
  to principals; describing a role's members and ACL bindings; managing secrets
  for Redpanda Cloud clusters; setting up authentication on a self-hosted or
  cloud cluster; configuring SASL/SCRAM, SASL/PLAIN, OAUTHBEARER/OIDC
  (Enterprise), GSSAPI/Kerberos (Enterprise), mTLS principal mapping, or HTTP
  Basic/OIDC auth; configuring enterprise security features and their config
  keys — Audit Logging (`audit_enabled`), GBAC with OIDC `Group:` principals
  (`oidc_group_claim_path`), server-side Schema ID Validation
  (`enable_schema_id_validation`), Schema Registry Authorization
  (`schema_registry_enable_authorization`), FIPS mode (`fips_mode`); managing
  the Enterprise license (`rpk cluster license info/set`, `rpk generate
  license`); bootstrapping a new cluster with a superuser; understanding the
  relationship between SASL users (authn) and ACLs (authz); using prefixed
  resource patterns; using `RedpandaRole:` and `Group:` principals in ACLs;
  `rpk acl` (deprecated alias).
---

# rpk security: ACLs, Users, Roles & Secrets

`rpk security` is the primary CLI command group for managing authentication and authorization on Redpanda. It replaces the deprecated `rpk acl` command. The group contains four subcommands — `user`, `acl`, `role`, and `secret` — that together cover the full security lifecycle: creating credentials, granting permissions, grouping permissions into roles, and storing secrets for Cloud clusters.

Redpanda security has two layers: **authentication** (who are you? — handled by SASL/SCRAM users) and **authorization** (what can you do? — handled by ACLs and RBAC roles). A freshly created SASL user has no access until ACLs are granted.

The alias `rpk sec` also works: `rpk sec user list`, `rpk sec acl list`, etc.

## Quickstart

```bash
# 1. Enable SASL + ACL authorization on the broker (redpanda.yaml, requires restart)
#    redpanda:
#      enable_sasl: true            # authentication: clients must present credentials
#      kafka_enable_authorization: true  # authorization: enforce ACLs (default-deny)
#      superusers: ["admin"]

# 2. Create a superuser first (using an existing superuser or bootstrap)
rpk security user create admin --password 'S3cur3Pass!' --mechanism scram-sha-256

# 3. Create an application user (password auto-generated if -p omitted)
rpk security user create app-user --password 'AppPass123'

# 4. List users to confirm
rpk security user list

# 5. Grant app-user read + describe on topic "events" and read on group "app-group"
rpk security acl create \
  --allow-principal app-user \
  --operation read,describe \
  --topic events

rpk security acl create \
  --allow-principal app-user \
  --operation read,describe \
  --group app-group

# 6. Also grant produce permission on "events"
rpk security acl create \
  --allow-principal app-user \
  --operation write,describe \
  --topic events

# 7. Confirm the ACLs
rpk security acl list --allow-principal app-user

# 8. (Optional) Create a role for a team
rpk security role create data-engineers
rpk security acl create --allow-role data-engineers --operation read,describe --topic 'logs-' --resource-pattern-type prefixed
rpk security role assign data-engineers --principal alice,bob
rpk security role describe data-engineers
```

## Users (Authentication)

SASL/SCRAM users authenticate clients to Redpanda. Redpanda supports two mechanisms: **SCRAM-SHA-256** (default) and **SCRAM-SHA-512**.

SASL must be enabled in `redpanda.yaml` with `enable_sasl: true` (controls authentication — clients must present credentials). ACL authorization enforcement is controlled separately by `kafka_enable_authorization: true` (when enabled, clients without a matching allow ACL are denied). Both are typically enabled together for a fully secured cluster. Superusers are defined in the `superusers` list and bypass all ACL checks.

### user create

```bash
# Create with explicit password, default mechanism (SCRAM-SHA-256)
rpk security user create alice --password 'MyPass!'

# Create with SCRAM-SHA-512
rpk security user create alice --password 'MyPass!' --mechanism scram-sha-512

# Auto-generate a 30-character password (printed on creation)
rpk security user create alice
```

Flags:
- `--password <string>` — user's password (auto-generated if omitted)
- `--mechanism <string>` — `scram-sha-256` (default) or `scram-sha-512`, case-insensitive

### user list

```bash
rpk security user list
# Alias: rpk security user ls
```

### user delete

```bash
rpk security user delete alice
```

Note: deleting a user does **not** delete its ACLs.

### user update

Update password and/or mechanism (both `--new-password` and `--mechanism` are required):

```bash
rpk security user update alice --new-password 'NewPass!' --mechanism scram-sha-256
```

## ACLs (Authorization)

ACLs define permissions. Each ACL has five components: principal, host, resource, operation, and permission (allow/deny). Flags on `rpk security acl create` are multiplicative: principals, resources, hosts, and operations all multiply together — for example, two principals × two topics × two operations = eight ACLs.

Resources: `--topic`, `--group`, `--cluster`, `--transactional-id`, `--registry-global`, `--registry-subject`.

Operations: `all`, `read`, `write`, `create`, `delete`, `alter`, `describe`, `describe_configs`, `alter_configs`.

Pattern types (for `--resource-pattern-type`): `literal` (exact match, default for create), `prefixed` (prefix match).

### acl create

```bash
# Allow alice to produce and consume on topic "orders"
rpk security acl create --allow-principal alice \
  --operation write,read,describe --topic orders

# Allow a role (RBAC) to read all topics with prefix "logs-"
rpk security acl create --allow-role analytics \
  --operation read,describe \
  --topic 'logs-' --resource-pattern-type prefixed

# Allow alice to use consumer group "my-group"
rpk security acl create --allow-principal alice \
  --operation read,describe --group my-group

# Grant cluster-level ALTER to allow creating ACLs
rpk security acl create --allow-principal admin \
  --operation alter --cluster

# Allow alice to use transactional ID "txn-1"
rpk security acl create --allow-principal User:alice \
  --operation write --transactional-id txn-1

# Deny alice from a specific host
rpk security acl create --deny-principal alice \
  --deny-host 192.168.1.100 \
  --operation all --topic sensitive-data
```

### acl list

```bash
# List all ACLs (Kafka + Schema Registry)
rpk security acl list

# Filter by principal
rpk security acl list --allow-principal alice

# Filter by topic
rpk security acl list --topic orders

# Only Schema Registry ACLs
rpk security acl list --subsystem registry

# Print filter details alongside matches
rpk security acl list --print-filters
```

### acl delete

Delete works on a filter basis, like list. It prompts for confirmation by default (>10 matches double-confirms).

```bash
# Delete all ACLs for alice on topic "orders"
rpk security acl delete --allow-principal alice --topic orders

# Dry run first
rpk security acl delete --allow-principal alice --topic orders --dry

# Skip confirmation
rpk security acl delete --allow-principal alice --topic orders --no-confirm
```

## Roles (RBAC)

RBAC (Role-Based Access Control) is an Enterprise feature on self-hosted clusters. Roles let you attach a bundle of ACL permissions to a name, then assign that name to many principals. The prefix `RedpandaRole:` is used in ACL principals for role-bound ACLs.

### role create / delete / list

```bash
rpk security role create data-engineers
rpk security role list
rpk security role list --prefix "data-"     # filter by name prefix
rpk security role list --principal alice    # roles assigned to alice
rpk security role delete data-engineers     # prompts for confirmation; use --no-confirm to skip
```

### role assign / unassign

```bash
# Assign a single user
rpk security role assign data-engineers --principal alice

# Assign multiple users (comma-separated)
rpk security role assign data-engineers --principal alice,bob

# Assign a group
rpk security role assign data-engineers --principal Group:engineering

# Unassign
rpk security role unassign data-engineers --principal alice
```

The `--principal` flag accepts `<PrincipalPrefix>:<name>` or bare name (defaults to `User:`).

### role describe

Shows the role's ACL bindings and members.

```bash
rpk security role describe data-engineers
rpk security role describe data-engineers --print-permissions   # ACLs only
rpk security role describe data-engineers --print-members       # members only
```

### Binding ACLs to a role

After creating a role, attach ACLs using `--allow-role` in `rpk security acl create`:

```bash
rpk security role create data-engineers
rpk security acl create \
  --allow-role data-engineers \
  --operation read,describe \
  --topic 'events-' --resource-pattern-type prefixed
```

## Secrets (Cloud Only)

`rpk security secret` manages secrets for Redpanda Cloud clusters. Secret names must start with an uppercase letter and contain only uppercase letters, digits, and underscores (max 255 chars). The `secret` subcommand is only available for cloud clusters.

Available scopes: `redpanda_connect`, `redpanda_cluster`.

```bash
# Create a secret
rpk security secret create \
  --name MY_DB_PASSWORD \
  --value 'secret-value-here' \
  --scopes redpanda_connect

# List secrets (optionally filter by substring)
rpk security secret list
rpk security secret list --name-contains DB

# Update a secret (overwrites value and scopes)
rpk security secret update \
  --name MY_DB_PASSWORD \
  --value 'new-secret-value' \
  --scopes redpanda_connect,redpanda_cluster

# Delete a secret
rpk security secret delete --name MY_DB_PASSWORD
```

## Authentication Mechanisms

Beyond SASL/SCRAM, Redpanda supports several authentication mechanisms. SCRAM, PLAIN, and mTLS are Community Edition; **OAUTHBEARER/OIDC and GSSAPI (Kerberos) require an Enterprise license**.

- **SASL/SCRAM** (Community) — default; `sasl_mechanisms` includes `SCRAM`. See [users.md](references/users.md).
- **SASL/PLAIN** (Community) — `sasl_mechanisms` includes `PLAIN`.
- **SASL/OAUTHBEARER (OIDC)** (Enterprise) — `sasl_mechanisms` includes `OAUTHBEARER`; configured via `oidc_discovery_url`, `oidc_token_audience`, `oidc_principal_mapping` (default `$.sub`), `oidc_clock_skew_tolerance`, `oidc_token_expire_disconnect`, `oidc_keys_refresh_interval`.
- **SASL/GSSAPI (Kerberos)** (Enterprise) — `sasl_mechanisms` includes `GSSAPI`; configured via `sasl_kerberos_keytab`, `sasl_kerberos_config`, `sasl_kerberos_principal`, `sasl_kerberos_principal_mapping`.
- **mTLS** (Community) — listener `authentication_method: mtls_identity`; principal extracted via `kafka_mtls_principal_mapping_rules`.
- **HTTP APIs** — `http_authentication` cluster property: `BASIC` (Community) and `OIDC` (Enterprise); `admin_api_require_auth` gates Admin API auth.

`enable_sasl` toggles Kafka API authentication; `kafka_enable_authorization` toggles ACL enforcement. See [authentication.md](references/authentication.md) for full config keys, principal-mapping rule syntax, and connecting rpk with OIDC.

## Enterprise Security Features

The following authorization/security differentiators **require a valid Enterprise license**. Verify license/violation status with `rpk cluster license info`.

- **RBAC** — `rpk security role` (Enterprise on self-hosted). See [roles.md](references/roles.md).
- **GBAC** — grant permissions to OIDC groups via `Group:<name>` ACL principals or role assignments; `oidc_group_claim_path` (default `$.groups`), `nested_group_behavior` (`none`/`suffix`).
- **Audit Logging** — `audit_enabled`; topic-shaping (`audit_log_num_partitions`, `audit_log_replication_factor`) must be set before enabling; `audit_enabled_event_types`, `audit_excluded_topics`, `audit_excluded_principals`, `audit_client_max_buffer_size`, `audit_queue_max_buffer_size_per_shard`.
- **Server-side Schema ID Validation** — `enable_schema_id_validation` (`none`/`redpanda`/`compat`); per-topic `redpanda.{key,value}.schema.id.validation` and `redpanda.{key,value}.subject.name.strategy`.
- **Schema Registry Authorization** — `schema_registry_enable_authorization`; ACLs via `--registry-global` / `--registry-subject`.
- **FIPS Compliance** — broker property `fips_mode` (`disabled`/`enabled`/`permissive`) with `openssl_config_file`, `openssl_module_directory`.

See [enterprise-security.md](references/enterprise-security.md) for the full config-key tables, enable/disable commands, license management (`rpk generate license`, `rpk cluster license set`), and expiration behavior per feature.

## SASL + ACL Bootstrapping Flow

When enabling SASL on a new cluster:

1. Add `enable_sasl: true` (authentication), `kafka_enable_authorization: true` (ACL enforcement), and `superusers: ["admin"]` to `redpanda.yaml`.
2. Restart the broker.
3. Create the `admin` user via `rpk security user create admin --password '...'` using whatever auth the Admin API listener is configured for.
4. Create application users with `rpk security user create`.
5. Grant ACLs to each application user with `rpk security acl create`.
6. Connect clients using SASL credentials.

Without ACLs, newly created users cannot access any resource.

## Common ACL Recipes

| Use case | Command |
|----------|---------|
| Producer to one topic | `--operation write,describe --topic <t>` |
| Consumer on topic + group | `--operation read,describe --topic <t>` + `--operation read,describe --group <g>` |
| Transactional producer | `--operation write,describe --topic <t>` + `--operation write --transactional-id <id>` |
| Admin (create topics) | `--operation create --cluster` or `--operation create --topic '*'` |
| All permissions | `--operation all --topic '*'` |
| Schema Registry read/write | `--operation describe_configs,describe --registry-global` + `--operation read,write --registry-subject <subject>` |

## Reference Directory

- [users.md](references/users.md): `rpk security user` command reference — create/list/delete/update, SCRAM mechanisms, superusers, and the authn/authz distinction.
- [acls.md](references/acls.md): `rpk security acl` command reference — create/list/delete in depth, all flags, principal formats, resource types, operations, pattern types, and common grant recipes.
- [roles.md](references/roles.md): `rpk security role` RBAC reference (Enterprise) — create/list/describe/delete, assign/unassign, binding ACLs to roles, and `rpk security secret` overview.
- [authentication.md](references/authentication.md): authentication mechanisms — SASL/SCRAM, SASL/PLAIN, OAUTHBEARER/OIDC (Enterprise), GSSAPI/Kerberos (Enterprise), mTLS principal mapping, and HTTP Basic/OIDC. Full cluster/broker config keys, principal-mapping rule syntax, and connecting rpk with OIDC.
- [enterprise-security.md](references/enterprise-security.md): Enterprise security differentiators and their nested config keys — Audit Logging, GBAC, server-side Schema ID Validation, Schema Registry Authorization, FIPS Compliance — plus Enterprise license management (`rpk cluster license info/set`, `rpk generate license`) and per-feature expiration behavior.
