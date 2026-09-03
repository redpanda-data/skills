# rpk security user: SASL User Management

`rpk security user` manages SASL/SCRAM users — the authentication identities for connecting to Redpanda. This command interfaces with the Redpanda Admin API (self-hosted) or the Dataplane API (Cloud clusters).

> **Authentication vs Authorization**: Users authenticate clients. ACLs authorize what authenticated users can do. A freshly created user has zero permissions until ACLs are granted via `rpk security acl create`.

## Prerequisites

SASL must be enabled on the broker. `enable_sasl`,
`kafka_enable_authorization`, and `superusers` are all **cluster configuration**
properties (not node properties in `redpanda.yaml`), and all three have
`needs_restart: no`:

```bash
rpk cluster config set enable_sasl true                    # clients must present SASL credentials
rpk cluster config set kafka_enable_authorization true     # enforce ACLs (default-deny for non-superusers)
rpk cluster config set superusers '["admin"]'              # these users bypass all ACL checks
```

`enable_sasl` and `kafka_enable_authorization` are independent settings. `enable_sasl` controls whether clients must authenticate; `kafka_enable_authorization` controls whether ACL authorization is enforced. Both are typically enabled together for a fully secured cluster. `kafka_enable_authorization` is nullable: left unset (`null`), authorization follows `enable_sasl`; set explicitly, it wins.

On a cluster that is not up yet, seed the same properties in the cluster
bootstrap file `/etc/redpanda/.bootstrap.yaml`:

```yaml
enable_sasl: true
kafka_enable_authorization: true
superusers:
  - "admin"
```

A superuser connection is required to manage other users. Pass credentials to rpk via profile or `-X` flags:

```bash
rpk security user list -X brokers=localhost:9092 \
  -X sasl.mechanism=SCRAM-SHA-256 \
  -X user=admin \
  -X pass='AdminPass!'
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

`superusers` is a **cluster configuration** property, not a node property in
`redpanda.yaml`. Principals in the list bypass all ACL checks. It has
`needs_restart: no`, so you can change it with rpk and the brokers pick it up
live:

```bash
# Replace the superuser list (array-valued: pass a YAML/JSON list)
rpk cluster config set superusers '["admin", "replication-user"]'

# Read it back
rpk cluster config get superusers
```

`rpk cluster config set` YAML-parses the value for array-typed properties, so
quote the list — a bare `rpk cluster config set superusers admin` would be
accepted as a one-element list, which is easy to do by accident when you meant
to append.

To seed superusers before the cluster is up, put them in the cluster bootstrap
file `/etc/redpanda/.bootstrap.yaml` (cluster properties, applied at first
boot), not in `redpanda.yaml`:

```yaml
superusers:
  - "admin"
```

A superuser can manage other users, create ACLs, and access any topic.

## Bootstrapping a Cluster

When enabling SASL for the first time on a self-hosted cluster, create the
superuser **before** you turn authentication on — otherwise you lock yourself
out of the cluster you were about to secure. None of these steps needs a broker
restart.

1. Create the admin user, using whatever auth the Admin API listener currently
   requires (none, basic auth, or mTLS):
   ```bash
   rpk security user create admin --password 'AdminPass!'
   ```
2. Put it in the superuser list:
   ```bash
   rpk cluster config set superusers '["admin"]'
   ```
3. Turn on authentication and ACL enforcement:
   ```bash
   rpk cluster config set enable_sasl true
   rpk cluster config set kafka_enable_authorization true
   ```
4. Create application users and grant them ACLs — from here on, pass the admin
   credentials (`-X user=admin -X pass=...`, or a profile).

For a cluster being provisioned from scratch, seed steps 2–3 in
`/etc/redpanda/.bootstrap.yaml` instead and create the admin user on first
contact.

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
