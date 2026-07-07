# Enterprise Security Features & License Management

This reference covers the Enterprise security/authorization differentiators that fall within the `rpk security` domain, their nested cluster/topic config keys, and how to manage the Enterprise license that gates them. Every feature below **requires a valid Enterprise license**; behavior upon license expiration is noted per feature.

For authentication mechanisms (OIDC, Kerberos, mTLS), see [authentication.md](authentication.md). For RBAC roles and the `Group:` principal, see [roles.md](roles.md) and the GBAC section below.

## Enterprise security feature map

| Feature | Gate (config key) | License | On expiration |
|---------|-------------------|---------|---------------|
| Audit Logging | `audit_enabled` | Enterprise | Read access to audit log topic denied; logging continues |
| RBAC | `rpk security role *` | Enterprise (self-hosted) | Roles/role-ACLs can't be created or modified; deletion allowed |
| GBAC (OIDC groups) | `Group:` ACL principals + OIDC | Enterprise | `Group:` ACLs can't be created; existing evaluated/deletable |
| Server-side Schema ID Validation | `enable_schema_id_validation` | Enterprise | Topics with validation settings can't be created/modified |
| Schema Registry Authorization | `schema_registry_enable_authorization` | Enterprise | Can't enable, can't create/modify schema ACLs |
| FIPS Compliance | `fips_mode` (broker) | Enterprise | No change |
| Kerberos auth | `sasl_mechanisms` includes `GSSAPI` | Enterprise | No change |
| OAUTHBEARER/OIDC auth | `sasl_mechanisms`/`http_authentication` includes `OIDC` | Enterprise | No change |

Check whether any enterprise security feature is in violation:

```bash
rpk cluster license info
# license violation = true means an enterprise feature is enabled without a valid license
```

## Audit Logging (Enterprise)

Records detailed logs of cluster activity for compliance. When `audit_enabled` is set to `true`, Redpanda checks for the topic `_redpanda.audit_log` and creates it if absent. Configure the topic-shaping properties (`audit_log_num_partitions`, `audit_log_replication_factor`) **before** enabling, because Redpanda blocks altering them on the existing audit topic directly.

### Audit logging cluster properties

| Property | Description | Default |
|----------|-------------|---------|
| `audit_enabled` | Enable audit logging; auto-creates `_redpanda.audit_log`. Setting `true` requires an Enterprise license | `false` |
| `audit_log_num_partitions` | Partitions of the newly created audit topic (cannot be altered later) | `12` |
| `audit_log_replication_factor` | Replication factor of the new audit topic (cannot be altered later; falls back to `internal_topic_replication_factor`) | `null` |
| `audit_enabled_event_types` | JSON list of event categories to log | `'["management","authenticate","admin"]'` |
| `audit_excluded_topics` | JSON list of topics to ignore (cannot include `_redpanda.audit_log`) | `null` |
| `audit_excluded_principals` | JSON list of principals to ignore (`User:name` or `name`) | `null` |
| `audit_client_max_buffer_size` | Bytes the internal audit client allocates; toggle audit off/on to apply | `16777216` |
| `audit_queue_max_buffer_size_per_shard` | Max audit buffer memory per shard, in bytes; requires restart to change | `1048576` |

The cluster property `audit_enabled` defaults to `false` (per `reference:properties/cluster-properties.adoc`); the value `true` is what requires an Enterprise license. The Helm value `auditLogging.enabled` also defaults to `false`.

Valid `audit_enabled_event_types` values: `management`, `produce`, `consume`, `describe`, `heartbeat`, `authenticate`, `schema_registry`, `admin`. Keep the list as restrictive as your compliance needs allow.

```bash
# Configure topic shaping first, then event types/exclusions, then enable
rpk cluster config set audit_log_num_partitions 6
rpk cluster config set audit_log_replication_factor 5
rpk cluster config set audit_enabled_event_types '["management","describe","authenticate"]'
rpk cluster config set audit_excluded_topics '["topic1","topic2"]'
rpk cluster config set audit_excluded_principals '["User:principal1","principal2"]'
rpk cluster config set audit_enabled true

# Disable for compliance
rpk cluster config set audit_enabled false
```

On expiration: read access to the audit log topic is denied, but logging continues.

## GBAC — Group-Based Access Control (Enterprise)

GBAC extends OIDC authentication: grant Redpanda permissions to IdP groups instead of individual users. Two independent (or combined) patterns: create ACLs with `Group:<name>` principals, or assign groups as members of RBAC roles. When a user authenticates with OIDC, Redpanda reads a configurable claim from the JWT and matches the group names against `Group:` ACL principals and role assignments.

### GBAC cluster properties

| Property | Description | Default |
|----------|-------------|---------|
| `oidc_group_claim_path` | JSONPath to the group claim in the OIDC token | `$.groups` |
| `nested_group_behavior` | How to handle path-style group names (`/dept/eng`): `none` = full path, `suffix` = last segment | `none` |

Changes take effect immediately (no restart).

```bash
rpk cluster config get oidc_group_claim_path
# Auth0/Okta top-level groups claim (default):
rpk cluster config set oidc_group_claim_path '$.groups'
# Keycloak nests roles:
rpk cluster config set oidc_group_claim_path '$.realm_access.roles'
rpk cluster config set nested_group_behavior suffix
```

### Group-based ACLs and role assignment

`Group:` principal matching uses literal string comparison only — no wildcard `Group:` ACLs.

```bash
# Grant directly to a group via ACL
rpk security acl create --allow-principal Group:engineering --operation describe --cluster
rpk security acl create \
  --allow-principal Group:engineering \
  --operation read,describe \
  --topic 'analytics-' --resource-pattern-type prefixed

# Assign a group to an RBAC role
rpk security role assign DataEngineers --principal Group:engineering
rpk security role unassign DataEngineers --principal Group:engineering

# View
rpk security role describe DataEngineers --print-members   # Group:<name> entries appear
rpk security role list --principal Group:engineering
```

On expiration: ACLs with `Group:` principals cannot be created; existing group ACLs continue to be evaluated and can be deleted.

## Server-Side Schema ID Validation (Enterprise)

Validates schema IDs server-side using Confluent SerDes format. Records with schema IDs not valid for the configured subject-name strategy (and not registered with the Schema Registry) are detected and dropped by the broker rather than the consumer.

### Cluster property

`enable_schema_id_validation` — default `none`:

- `none` — disabled (no checks); associated topic properties cannot be modified.
- `redpanda` — enabled; only Redpanda topic properties accepted.
- `compat` — enabled; both Redpanda and Confluent-compatible topic properties accepted.

```bash
rpk cluster config set enable_schema_id_validation redpanda -X admin.hosts=<admin-api-IP>:9644
# Disable for compliance
rpk cluster config set enable_schema_id_validation false
```

### Per-topic properties

| Redpanda property | Confluent equivalent | Description |
|-------------------|----------------------|-------------|
| `redpanda.key.schema.id.validation` | `confluent.key.schema.validation` | Enable key schema ID validation (`true`/`false`) |
| `redpanda.key.subject.name.strategy` | `confluent.key.subject.name.strategy` | Subject-name strategy for keys |
| `redpanda.value.schema.id.validation` | `confluent.value.schema.validation` | Enable value schema ID validation (`true`/`false`) |
| `redpanda.value.subject.name.strategy` | `confluent.value.subject.name.strategy` | Subject-name strategy for values |

Subject-name strategies: `TopicNameStrategy` (default), `RecordNameStrategy`, `TopicRecordNameStrategy`. `redpanda.*` and `confluent.*` are compatible and can be set together. For `confluent.*` strategies, the value must be prefixed `io.confluent.kafka.serializers.subject.` (e.g. `io.confluent.kafka.serializers.subject.TopicNameStrategy`).

```bash
# Create a topic with value validation using RecordNameStrategy
rpk topic create topic_foo \
  --topic-config redpanda.value.schema.id.validation=true \
  --topic-config redpanda.value.subject.name.strategy=RecordNameStrategy

# Alter an existing topic
rpk topic alter-config topic_foo \
  --set redpanda.value.schema.id.validation=true \
  --set redpanda.value.subject.name.strategy=RecordNameStrategy
```

On expiration: topics with schema validation settings cannot be created or modified.

## Schema Registry Authorization (Enterprise)

Manages ACLs for Schema Registry resources. Enabled with the `schema_registry_enable_authorization` cluster property. On BYOC and Dedicated Cloud clusters it is `true` by default. ACLs are created with the same `rpk security acl create` command as Kafka ACLs.

### Resource types / flags

- `--registry-global` — global/top-level Schema Registry operations (resource type `registry`).
- `--registry-subject <name>` — a specific subject (resource type `subject`); supports `--resource-pattern-type prefixed`.

```bash
# Enable authorization (requires a superuser / cluster ALTER on the registry)
rpk security acl create --allow-principal schema_registry_admin --cluster --operation alter
rpk cluster config set schema_registry_enable_authorization true

# Grant subject-level access
rpk security acl create --allow-principal panda --operation read --topic bar --registry-subject bar-value

# Grant global read+write (covers all global SR operations)
rpk security acl create --allow-principal jane --operation read,write --topic private --registry-global

# Prefixed subject access (matches orders-key and orders-value)
rpk security acl create --allow-principal alice \
  --operation read --registry-subject 'orders-' --resource-pattern-type prefixed

# Disable for compliance
rpk cluster config set schema_registry_enable_authorization false
```

Schema Registry ACL operations map: `RegisterSchema` -> WRITE on SUBJECT; `GetSchemaByVersion` -> READ on SUBJECT; `ListSubjects` -> DESCRIBE on SUBJECT; `DeleteSubject` -> DELETE on SUBJECT; global config/mode read -> DESCRIBE_CONFIGS on REGISTRY; global config/mode update -> ALTER_CONFIGS on REGISTRY. Use `--subsystem registry` on `rpk security acl list` to view only Schema Registry ACLs.

On expiration: you can no longer enable `schema_registry_enable_authorization`, nor create or modify schema ACLs.

## FIPS Compliance (Enterprise)

FIPS 140-3-compliant cipher enforcement using a validated OpenSSL module. FIPS is a **broker (node) property**, not a cluster property, so it is set with `rpk redpanda config set redpanda.fips_mode <value>` (or in `redpanda.yaml` under the `redpanda` object; rpk has no `node` command group).

### Broker properties

| Property | Description |
|----------|-------------|
| `fips_mode` | `disabled` / `enabled` / `permissive` |
| `openssl_config_file` | Path to OpenSSL config (typically `/opt/redpanda/openssl/openssl.cnf`) |
| `openssl_module_directory` | Directory with the `fips.so` provider (typically `/opt/redpanda/lib/ossl-modules/`) |

`fips_mode` values:

- `disabled` — not FIPS-compliant.
- `enabled` — at startup Redpanda requires `1` in `/proc/sys/crypto/fips_enabled`; otherwise it logs an error and exits.
- `permissive` — safety-valve only (not for production); logs a WARNING and continues even if the OS is not FIPS-configured. The instance is *not* FIPS-compliant in this mode.

```yaml
redpanda:
  fips_mode: enabled
  openssl_config_file: /opt/redpanda/openssl/openssl.cnf
  openssl_module_directory: /opt/redpanda/lib/ossl-modules/
```

```bash
# Disable FIPS for compliance/troubleshooting
rpk redpanda config set redpanda.fips_mode disabled
```

Notes: when FIPS mode is `enabled` or `permissive`, SASL/SCRAM passwords must be at least 14 characters. PKCS#12 TLS keys are not supported under FIPS — use PEM. On expiration: no change.

## Managing the Enterprise license

All security enterprise features above are gated by a license. New clusters (24.3+) get a 30-day trial automatically. Extend or generate a trial with `rpk generate license`, then apply it.

```bash
# Generate a 30-day trial and apply it (one trial per email/business domain)
rpk generate license --apply
# Generate to a path without applying
rpk generate license --path /path/to/redpanda.license

# Apply an existing license file or string
rpk cluster license set --path /home/organization/redpanda.license
rpk cluster license set <license-string>

# Inspect license + violation status (Organization, Type, Expires, license violation)
rpk cluster license info
rpk cluster license info --format json
```

If `license violation` is `true`, either apply a valid license or disable the offending enterprise feature using the per-feature commands above. Upon expiration the cluster keeps running without data loss; enterprise-feature configuration is preserved so applying a new license restores functionality.
