# rpk security user: SASL User Management

`rpk security user` manages SASL/SCRAM users — the authentication identities for connecting to Redpanda. This command interfaces with the Redpanda Admin API (self-hosted) or the Dataplane API (Cloud clusters).

> **Authentication vs Authorization**: Users authenticate clients. ACLs authorize what authenticated users can do. A freshly created user has zero permissions until ACLs are granted via `rpk security acl create`.

## Prerequisites

SASL must be enabled on the broker. In `redpanda.yaml`:

```yaml
redpanda:
  enable_sasl: true              # authentication: clients must present SASL credentials
  kafka_enable_authorization: true  # authorization: enforce ACLs (default-deny for non-superusers)
  superusers:
    - "admin"   # these users bypass all ACL checks
```

`enable_sasl` and `kafka_enable_authorization` are independent settings. `enable_sasl` controls whether clients must authenticate; `kafka_enable_authorization` controls whether ACL authorization is enforced. Both are typically enabled together for a fully secured cluster.

A superuser connection is required to manage other users. Pass credentials to rpk via profile or `-X` flags:

```bash
rpk security user list -X brokers=localhost:9092 \
  -X sasl.mechanism=SCRAM-SHA-256 \
  -X sasl.username=admin \
  -X sasl.password='AdminPass!'
```

## SCRAM Mechanisms

Redpanda supports two SASL/SCRAM mechanisms:

| Mechanism | Flag value | Notes |
|-----------|-----------|-------|
| SCRAM-SHA-256 | `scram-sha-256` | Default. Use for most clients. |
| SCRAM-SHA-512 | `scram-sha-512` | Same flow, SHA-512 hash. |

Flag values are case-insensitive: `SCRAM-SHA-256`, `scram-sha-256`, and `Scram-Sha-256` all work.

The mechanism is stored per-user and must match what the Kafka client uses in its SASL config.

## Commands

### user create

```
rpk security user create [USER] -p [PASS] [flags]
```

Creates a single SASL user.

**Flags:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--password` | string | (auto-generate) | New user's password. If omitted AND no auth creds are supplied, a 30-character random password is auto-generated and printed. |
| `--mechanism` | string | `scram-sha-256` | SASL mechanism (`scram-sha-256` or `scram-sha-512`, case-insensitive). |

**Examples:**

```bash
# Explicit password, default mechanism
rpk security user create alice --password 'MySecretPass!'

# Explicit password, SHA-512
rpk security user create alice --password 'MySecretPass!' --mechanism scram-sha-512

# Auto-generate password (printed to stdout; record it)
rpk security user create alice
# Output:
#   Created user "alice".
#   Automatically generated password:
#   aB3kLmNpQrSt7uVwXy2mPdRqFgHjKcEn  (30 characters)

# JSON output
rpk security user create alice --password 'Pass!' --format json
```

**Notes:**
- The auto-generated password is 30 characters: lowercase + uppercase + digits.
- User creation does not automatically create ACLs. The user cannot access any Kafka resource until ACLs are granted.
- On Cloud (non-serverless) clusters, this uses the Dataplane API; on self-hosted it uses the Admin API.

### user list

```
rpk security user list [flags]
# Alias: rpk security user ls
```

Lists all SASL users. Returns a `Username` column.

```bash
rpk security user list

# JSON output
rpk security user list --format json
```

### user delete

```
rpk security user delete [USER] [flags]
```

Deletes a SASL user from Redpanda. **Does not delete the user's ACLs.** After deletion, existing ACLs for `User:<name>` remain in the ACL store but have no effect until a new user with the same name is created.

```bash
rpk security user delete alice
```

### user update

```
rpk security user update [USER] --new-password [PW] --mechanism [MECHANISM] [flags]
```

Updates a SASL user's password and/or mechanism. Both `--new-password` and `--mechanism` are required.

**Flags:**

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--new-password` | string | yes | New password for the user. |
| `--mechanism` | string | yes | New mechanism (`scram-sha-256` or `scram-sha-512`). |

```bash
rpk security user update alice \
  --new-password 'BrandNewPass!' \
  --mechanism scram-sha-256
```

## Superusers

Superusers are defined in `redpanda.yaml` under `redpanda.superusers`. They bypass all ACL checks. You cannot create or remove superusers with rpk — edit `redpanda.yaml` and restart the broker.

```yaml
redpanda:
  superusers:
    - "admin"
    - "replication-user"
```

A superuser can manage other users, create ACLs, and access any topic.

## Bootstrapping a Cluster

When enabling SASL for the first time on a self-hosted cluster:

1. Edit `redpanda.yaml` and add `enable_sasl: true` plus the admin user to `superusers`.
2. Restart the broker.
3. Create the admin user via rpk using whatever auth the Admin API listener is configured for (no auth if the listener has no auth requirements, basic auth, or mTLS):
   ```bash
   rpk security user create admin --password 'AdminPass!'
   ```
4. Create application users and grant them ACLs.

On Redpanda Cloud clusters, users are managed via the Cloud UI or the Dataplane API (rpk uses the API automatically when a cloud profile is active).

## Output Formats

All `rpk security user` commands support `--format text|json|yaml|wide|help`.

JSON structure for `user create`:
```json
{"user":"alice","mechanism":"scram-sha-256"}
```
The `password` field is only included in JSON output if the password was auto-generated.

## Relationship to ACLs

After creating a user, grant it permissions with `rpk security acl create`. Minimum permissions for a produce+consume client:

```bash
# Allow production
rpk security acl create --allow-principal alice \
  --operation write,describe --topic my-topic

# Allow consumption (topic + group)
rpk security acl create --allow-principal alice \
  --operation read,describe --topic my-topic
rpk security acl create --allow-principal alice \
  --operation read,describe --group my-group
```

See [acls.md](acls.md) for the full ACL reference.
