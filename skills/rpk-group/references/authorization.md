# Authorizing rpk group Operations (ACLs, RBAC, GBAC)

Every `rpk group` subcommand maps to one or more Kafka API requests, each of which the broker authorizes against an ACL on the `GROUP` resource (plus, for some operations, the `TOPIC` resource). This reference documents exactly which permissions each `rpk group` operation requires, and how to grant them via plain ACLs, **Role-Based Access Control (RBAC)**, or **Group-Based Access Control (GBAC)**.

**License:** Plain ACLs are a core (free) feature. **RBAC** (roles) and **GBAC** (OIDC `Group:` principals) are **Enterprise** features. On license expiration: roles and role-bound ACLs cannot be created or modified (role deletion is still allowed); ACLs with `Group:` principals cannot be created, though existing ones continue to be evaluated and can be deleted.

## Permission required per rpk group subcommand

The Kafka API → ACL operation mapping (resource is `GROUP` unless noted):

| `rpk group` subcommand | Kafka API(s) | Required permission |
|---|---|---|
| `rpk group list` | `ListGroups` | `DESCRIBE` on `GROUP` for the groups, **or** `DESCRIBE` on `CLUSTER` |
| `rpk group describe` | `FindCoordinator`, `DescribeGroup`, `OffsetFetch` | `DESCRIBE` on `GROUP` for the groups; `DESCRIBE` on `TOPIC` for the topics (OffsetFetch) |
| `rpk group seek` | `FindCoordinator`, `OffsetFetch`, `OffsetCommit` | `DESCRIBE` on `GROUP` (find coordinator / fetch) **and** `READ` on `GROUP` (commit) for the groups; `READ`/`DESCRIBE` on `TOPIC` for the topics |
| `rpk group offset-delete` | `FindCoordinator`, `OffsetDelete` | `DELETE` on `GROUP` for the groups; `READ` on `TOPIC` for the topics |
| `rpk group delete` | `FindCoordinator`, `DeleteGroups` | `DELETE` on `GROUP` for the groups |

Notes grounded in the broker authorization spec:

- `FindCoordinator` → `DESCRIBE` on `GROUP`.
- `OffsetFetch` (used by `describe` and the read side of `seek`) → `DESCRIBE` on `GROUP` + `DESCRIBE` on `TOPIC`.
- `OffsetCommit` (the write side of `seek`) → `READ` on `GROUP` + `READ` on `TOPIC`.
- `OffsetDelete` → `DELETE` on `GROUP` + `READ` on `TOPIC`.
- `DescribeGroup` / `ListGroups` → `DESCRIBE` on `GROUP` (ListGroups also accepts `DESCRIBE` on `CLUSTER`).
- `DeleteGroups` → `DELETE` on `GROUP`.

A "consumer group admin" persona therefore needs `READ` + `DESCRIBE` + `DELETE` on the consumer groups (and `READ` + `DESCRIBE` on the target topics).

## Granting with plain ACLs (core / free)

```bash
# Read-only group inspection (rpk group list / describe)
rpk security acl create --allow-principal User:viewer \
  --operation describe --group '*'

# Full group admin: list, describe, seek, offset-delete, delete
rpk security acl create --allow-principal User:group-admin \
  --operation read,describe,delete --group my-consumer-group

# Seek/offset-delete also touch the topic resource
rpk security acl create --allow-principal User:group-admin \
  --operation read,describe --topic orders
```

The `--group` flag names the consumer-group resource. Operations are case-insensitive and comma-separated. Use `--resource-pattern-type prefixed` with a prefix name to grant over a group-name prefix.

## Granting with RBAC roles (Enterprise)

RBAC lets you bind these same ACLs to a named role, then assign the role to principals at scale. Two steps:

1. **Create the role and bind group ACLs to it** using `--allow-role` on `rpk security acl create`:

```bash
rpk security role create group-admin

# Bind GROUP permissions to the role (note: --allow-role, not --allow-principal)
rpk security acl create --allow-role group-admin \
  --operation read,describe,delete --group my-consumer-group

# Grant-all example over a topic + group in one call
rpk security acl create --allow-role group-admin \
  --operation all --topic orders --group my-consumer-group
```

The wildcard role name `*` is **not** permitted in `--allow-role` / `--deny-role`.

2. **Assign the role to principals** with `rpk security role assign`:

```bash
# Assign to a user (User: prefix is the default if omitted)
rpk security role assign group-admin --principal alice

# Assign to multiple principals at once
rpk security role assign group-admin --principal alice,bob
```

Inspect and manage roles with `rpk security role list`, `rpk security role describe <role>`, `rpk security role unassign`, and `rpk security role delete`.

## Granting with GBAC (OIDC groups, Enterprise)

GBAC manages permissions using OIDC group memberships. The `--principal` flag accepts a `<PrincipalPrefix>:<Principal>` form; use the `Group:` prefix to target an OIDC group. You can assign an RBAC role to an OIDC group, or create a group-based ACL directly.

```bash
# Assign an RBAC role to an OIDC group
rpk security role assign group-admin --principal Group:sre

# Mix user and group principals
rpk security role assign group-admin --principal alice,Group:sre

# Direct group-based ACL on the GROUP resource
rpk security acl create --allow-principal Group:analytics \
  --operation read,describe --group prod-consumer-orders
```

On license expiration, ACLs with `Group:` principals cannot be created; existing group ACLs continue to be evaluated and can be deleted.

## Disabling RBAC to return to compliance

If a cluster is in license violation due to RBAC usage, delete all configured roles:

```bash
rpk security role list
rpk security role delete <role-name>
```
