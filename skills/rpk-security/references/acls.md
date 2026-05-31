# rpk security acl: Access Control Lists

`rpk security acl` creates, lists, and deletes ACLs that authorize principals to perform operations on Redpanda resources. This supersedes the deprecated `rpk acl` command (both still work; `rpk acl` forwards to `rpk security acl`).

ACLs are stored internally in Redpanda, replicated via Raft.

## ACL Model

Each ACL consists of five components:

| Component | What it is | Example |
|-----------|-----------|---------|
| **Principal** | Who the ACL applies to (user, role, or group) | `User:alice`, `RedpandaRole:data-engineers`, `Group:engineering` |
| **Host** | Where the principal connects from | `*` (any, default), `192.168.1.100` |
| **Resource** | What is being accessed | topic `orders`, group `app-group`, cluster |
| **Operation** | What action is allowed or denied | `read`, `write`, `describe` |
| **Permission** | Allow or Deny | `allow`, `deny` |

By default all permissions are **denied**. You only need explicit deny ACLs to narrow down a wildcard allow. This default-deny behavior only takes effect when `kafka_enable_authorization: true` is set in `redpanda.yaml`. Superusers (defined in `redpanda.superusers`) bypass all ACL checks regardless of ACL configuration.

### Principals

rpk automatically prefixes `User:` if the prefix is missing. You can use:
- `alice` or `User:alice` — a specific SASL user
- `RedpandaRole:data-engineers` — an RBAC role (Enterprise feature on self-hosted)
- `Group:engineering` — an OIDC group; the `Group:` prefix is preserved as-is by rpk
- `'*'` — wildcard, matches all users

The `RedpandaRole:` prefix is set by rpk when using `--allow-role`/`--deny-role`; you do not need to add it manually. The `Group:` prefix must be provided explicitly when using `--allow-principal`/`--deny-principal`.

### Operations

```
ALL              Grants all operations below.
READ             Read data from a resource.
WRITE            Write data to a resource.
CREATE           Create resources (topics, or cluster-level).
DELETE           Delete resources or records.
ALTER            Alter non-configuration settings.
DESCRIBE         Query non-configuration metadata.
DESCRIBE_CONFIGS Query configuration values.
ALTER_CONFIGS    Modify configuration values.
```

Run `rpk security acl --help-operations` for the full mapping of which Kafka requests require which operations.

### Resources

| Flag | Resource type | Notes |
|------|-------------|-------|
| `--topic <name>` | TOPIC | A specific topic name or pattern |
| `--group <name>` | GROUP | A consumer group ID |
| `--cluster` | CLUSTER | The Kafka cluster itself (name is `kafka-cluster`) |
| `--transactional-id <id>` | TRANSACTIONAL_ID | A transactional producer ID |
| `--registry-global` | REGISTRY | Schema Registry global config/mode |
| `--registry-subject <name>` | SUBJECT | A specific Schema Registry subject |

### Pattern Types

`--resource-pattern-type` controls how resource names are matched:

- `literal` — exact name match (default for `create`)
- `prefixed` — any resource whose name starts with the given string

For `list` and `delete`, additionally:
- `any` — matches both literal and prefixed ACLs (default for `list`/`delete`)
- `match` — wildcard matches, plus prefix patterns that match your input, plus literals

The special resource name `'*'` (literal) matches any name of that resource type.

## acl create

```
rpk security acl create [flags]
```

Creates ACLs. Flags are multiplicative: two principals × two topics × two operations = eight ACLs.

**Flags:**

| Flag | Type | Description |
|------|------|-------------|
| `--allow-principal` | strings | Principals to allow (repeatable) |
| `--allow-role` | strings | Roles to allow (adds `RedpandaRole:` prefix, repeatable) |
| `--allow-host` | strings | Hosts to allow from (repeatable; requires `--allow-principal`) |
| `--deny-principal` | strings | Principals to deny (repeatable) |
| `--deny-role` | strings | Roles to deny (repeatable) |
| `--deny-host` | strings | Hosts to deny from (repeatable; requires `--deny-principal`) |
| `--topic` | strings | Topics to grant ACLs for (repeatable) |
| `--group` | strings | Groups to grant ACLs for (repeatable) |
| `--cluster` | bool | Grant ACLs for the cluster |
| `--transactional-id` | strings | Transactional IDs (repeatable) |
| `--registry-global` | bool | Grant ACLs for Schema Registry global |
| `--registry-subject` | strings | Schema Registry subjects (repeatable) |
| `--operation` | strings | Operations to grant (repeatable) |
| `--resource-pattern-type` | string | `literal` (default) or `prefixed` |

**Examples:**

```bash
# Full produce+consume permissions for alice on topic "orders" and group "my-group"
rpk security acl create --allow-principal alice \
  --operation write,read,describe --topic orders

rpk security acl create --allow-principal alice \
  --operation read,describe --group my-group

# Allow all permissions via wildcard topic
rpk security acl create --allow-principal alice \
  --operation all --topic '*'

# Allow a role to read topics with prefix "logs-"
rpk security acl create --allow-role analytics \
  --operation read,describe \
  --topic 'logs-' --resource-pattern-type prefixed

# Allow transactional writes
rpk security acl create --allow-principal User:producer \
  --operation write,describe --topic events
rpk security acl create --allow-principal User:producer \
  --operation write --transactional-id 'txn-producer-'  \
  --resource-pattern-type prefixed

# Grant cluster-level ALTER (required to manage ACLs as non-superuser)
rpk security acl create --allow-principal admin \
  --operation alter --cluster

# Deny access from a specific host
rpk security acl create --deny-principal alice \
  --deny-host 10.0.1.50 \
  --operation all --topic sensitive

# Schema Registry: allow read on subject "orders-value"
rpk security acl create --allow-principal alice \
  --operation read --registry-subject orders-value

# Schema Registry: allow global describe/alter
rpk security acl create --allow-principal alice \
  --operation describe_configs,alter_configs --registry-global
```

## acl list

```
rpk security acl list [flags]
# Aliases: rpk security acl ls, rpk security acl describe
```

Lists ACLs matching the given filters. An unspecified flag matches everything.

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--allow-principal` | strings | (any) | Filter by allowed principals |
| `--allow-role` | strings | (any) | Filter by allowed roles |
| `--deny-principal` | strings | (any) | Filter by denied principals |
| `--deny-role` | strings | (any) | Filter by denied roles |
| `--topic` | strings | (any) | Filter by topic name |
| `--group` | strings | (any) | Filter by group name |
| `--cluster` | bool | false | Filter for cluster ACLs |
| `--transactional-id` | strings | (any) | Filter by transactional ID |
| `--registry-global` | bool | false | Filter for Schema Registry global ACLs |
| `--registry-subject` | strings | (any) | Filter by Schema Registry subject |
| `--operation` | strings | (any) | Filter by operation |
| `--resource-pattern-type` | string | `any` | `any`, `match`, `literal`, or `prefixed` |
| `--subsystem` | strings | `kafka,registry` | Limit to `kafka` or `registry` only (list only; not available on delete) |
| `--print-filters`, `-f` | bool | false | Print the filters used (always printed on error) |

**Examples:**

```bash
# List all ACLs
rpk security acl list

# All ACLs for a specific principal
rpk security acl list --allow-principal alice

# All ACLs on a specific topic
rpk security acl list --topic orders

# Only Schema Registry ACLs
rpk security acl list --subsystem registry

# Only Kafka ACLs
rpk security acl list --subsystem kafka

# All ACLs for a role
rpk security acl list --allow-role data-engineers

# JSON output
rpk security acl list --format json
```

Output columns: `Principal`, `Host`, `Resource-Type`, `Resource-Name`, `Resource-Pattern-Type`, `Operation`, `Permission`.

## acl delete

```
rpk security acl delete [flags]
```

Deletes ACLs matching the given filters. Works like `list` — filters match on empty = match all. Prompts for confirmation before deletion. Matching more than 10 ACLs prompts twice.

**Extra flags (vs list):**

| Flag | Type | Description |
|------|------|-------------|
| `--dry`, `-d` | bool | Dry run: show what would be deleted without deleting |
| `--no-confirm` | bool | Skip the confirmation prompt |
| `--print-filters`, `-f` | bool | Print the filters (always shown on error) |

```bash
# Preview deletions first
rpk security acl delete --allow-principal alice --topic orders --dry

# Delete all ACLs for alice
rpk security acl delete --allow-principal alice

# Delete a specific ACL without confirmation
rpk security acl delete \
  --allow-principal alice \
  --operation read --topic orders \
  --no-confirm
```

## Operation Reference for Common Kafka Requests

This is a subset of the full table (`rpk security acl --help-operations`):

### Producing / Consuming

| Request | Required ACL |
|---------|-------------|
| Produce | `WRITE on TOPIC for topics` |
| Fetch (consume) | `READ on TOPIC for topics` |
| ListOffsets | `DESCRIBE on TOPIC for topics` |
| Metadata | `DESCRIBE on TOPIC` (+ `CREATE on CLUSTER` if auto-create) |

### Consumer Groups

| Request | Required ACL |
|---------|-------------|
| JoinGroup / Heartbeat / LeaveGroup / SyncGroup | `READ on GROUP` |
| OffsetCommit | `READ on GROUP` + `READ on TOPIC` |
| OffsetFetch | `DESCRIBE on GROUP` + `DESCRIBE on TOPIC` |

### Admin Operations

| Request | Required ACL |
|---------|-------------|
| CreateTopics | `CREATE on TOPIC` or `CREATE on CLUSTER` |
| DeleteTopics | `DELETE on TOPIC` + `DESCRIBE on TOPIC` |
| CreateACLs / DeleteACLs / DescribeACLs | `ALTER on CLUSTER` / `ALTER on CLUSTER` / `DESCRIBE on CLUSTER` |
| DescribeConfigs | `DESCRIBE_CONFIGS on CLUSTER` (broker) or `DESCRIBE_CONFIGS on TOPIC` |
| AlterConfigs | `ALTER_CONFIGS on CLUSTER` (broker) or `ALTER_CONFIGS on TOPIC` |

### Schema Registry

| Request | Required ACL |
|---------|-------------|
| RegisterSchema | `WRITE on SUBJECT` |
| GetSchemaByVersion | `READ on SUBJECT` |
| ListSubjects | `DESCRIBE on SUBJECT` |
| DeleteSubject | `DELETE on SUBJECT` |
| GetGlobalConfig / Mode | `DESCRIBE_CONFIGS on REGISTRY` |
| UpdateGlobalConfig / Mode | `ALTER_CONFIGS on REGISTRY` |

## Common Recipe: Producer + Consumer

```bash
# User: app-user | Topic: events | Group: events-consumer

# --- PRODUCER permissions ---
rpk security acl create --allow-principal app-user \
  --operation write,describe --topic events

# --- CONSUMER permissions ---
rpk security acl create --allow-principal app-user \
  --operation read,describe --topic events
rpk security acl create --allow-principal app-user \
  --operation read,describe --group events-consumer

# --- Verify ---
rpk security acl list --allow-principal app-user
```

## Common Recipe: Admin User (non-superuser)

```bash
# Grant full admin capabilities without making a superuser
rpk security acl create --allow-principal admin-user \
  --operation all --topic '*'
rpk security acl create --allow-principal admin-user \
  --operation all --group '*'
rpk security acl create --allow-principal admin-user \
  --operation alter,describe,describe_configs,alter_configs --cluster
```

## Deprecated Flags

The following flags existed in old `rpk acl` and are still accepted for backward compatibility but emit deprecation warnings:

- `--resource` → use `--topic`, `--group`, `--transactional-id`, or `--cluster`
- `--resource-name` → use the resource-specific flag
- `--name-pattern` → use `--resource-pattern-type`
- `--permission`, `--principal`, `--host` (on list) → use `--allow-principal`, `--deny-principal`, etc.
