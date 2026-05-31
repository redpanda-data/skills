# Enterprise Schema Registry Features: Authorization, Schema ID Validation, and Authentication

Reference for the Schema Registry **enterprise differentiators** that are relevant to `rpk registry`:

- **Schema Registry Authorization** — fine-grained ACLs on registry/subject resources (`schema_registry_enable_authorization`). **Requires an Enterprise license.**
- **Server-Side Schema ID Validation** — brokers detect and drop records with unregistered schema IDs (`enable_schema_id_validation`). **Requires an Enterprise license.**
- **Registry authentication** — HTTP Basic and OIDC/OAUTHBEARER access to the Schema Registry API (the gate that Authorization sits behind).

> All keys, flags, and values below are taken from the Redpanda docs/source. Behavior on license expiration is summarized from the licensing overview.

---

## Server-Side Schema ID Validation (Enterprise)

Validates that the schema ID encoded in a produced record's wire-format header is registered in the Schema Registry, and that it matches the subject derived by the configured subject name strategy. Misconfigured producers (wrong schema or wrong strategy) are detected and **dropped by the broker** instead of by a downstream consumer.

> Schema ID validation only checks that the encoded schema ID is registered. It does **not** verify that the payload bytes actually conform to that schema.

**License behavior on expiration:** Topics with schema validation settings cannot be created or modified.

### Enable globally: `enable_schema_id_validation` (cluster property)

Default `none`. Set to `redpanda` or `compat`:

| Value | Meaning |
|---|---|
| `none` | Disabled. No schema ID checks. Associated topic properties cannot be modified. |
| `redpanda` | Enabled. Only the Redpanda topic properties (`redpanda.*`) are accepted. |
| `compat` | Enabled. Both Redpanda (`redpanda.*`) and Confluent-compatible (`confluent.*`) topic properties are accepted. |

```bash
rpk cluster config set enable_schema_id_validation redpanda \
  -X admin.hosts=<admin-api-IP>:9644

# Disable (return to Community-compliant state)
rpk cluster config set enable_schema_id_validation none
```

When enabled, Redpanda uses `TopicNameStrategy` by default.

### Per-topic properties

Validation is opt-in per topic, separately for keys and values. Redpanda properties and their Confluent-compatible equivalents (both can be set; they are compatible):

| Redpanda property | Confluent property | Purpose |
|---|---|---|
| `redpanda.key.schema.id.validation` | `confluent.key.schema.validation` | Enable key validation (`true`/`false`) |
| `redpanda.key.subject.name.strategy` | `confluent.key.subject.name.strategy` | Subject name strategy for keys (default `TopicNameStrategy`) |
| `redpanda.value.schema.id.validation` | `confluent.value.schema.validation` | Enable value validation (`true`/`false`) |
| `redpanda.value.subject.name.strategy` | `confluent.value.subject.name.strategy` | Subject name strategy for values (default `TopicNameStrategy`) |

### Subject name strategies

| Strategy | Subject name source | Key format | Value format |
|---|---|---|---|
| `TopicNameStrategy` (default) | Topic name | `<topic>-key` | `<topic>-value` |
| `RecordNameStrategy` | Fully-qualified record name | `<record-name>` | `<record-name>` |
| `TopicRecordNameStrategy` | Topic + record name | `<topic>-<record-name>` | `<topic>-<record-name>` |

If a `subject.name.strategy` is prefixed with `confluent.`, the strategy value must use the Confluent class path prefix `io.confluent.kafka.serializers.subject.`, e.g. `io.confluent.kafka.serializers.subject.TopicNameStrategy`.

### Configure validation on a topic (via rpk topic)

Schema ID validation is applied through **topic** properties, so the commands live under `rpk topic` (see the `rpk-topic` skill), but they pair directly with the registry workflow:

```bash
# Create a topic with value validation using RecordNameStrategy
rpk topic create topic_foo \
  --topic-config redpanda.value.schema.id.validation=true \
  --topic-config redpanda.value.subject.name.strategy=RecordNameStrategy \
  -X brokers=<broker-addr>:9092

# Alter an existing topic to enable value validation
rpk topic alter-config topic_foo \
  --set redpanda.value.schema.id.validation=true \
  --set redpanda.value.subject.name.strategy=RecordNameStrategy \
  -X brokers=<broker-addr>:9092
```

> To support validation on compressed topics, the broker decompresses each batch to read the schema ID.

### Interaction with schema contexts

Server-side schema ID validation **with Kafka record headers does not support contexts**. Magic-byte and prefix (wire-format) validation are supported with contexts. Schema ID validation with JSON schemas does not work when the subject name strategy is not `TopicNameStrategy`.

---

## Schema Registry Authorization (Enterprise)

Available starting in **v25.2**. Before v25.2, an authenticated registry user had full access to all operations. Authorization adds fine-grained ACLs scoped to specific subjects and operations, by user or role.

**License behavior on expiration:** You can no longer enable `schema_registry_enable_authorization`, nor create or modify schema ACLs.

> On Redpanda Cloud BYOC and Dedicated clusters, Schema Registry Authorization is enabled by default (`schema_registry_enable_authorization=true` is set at provisioning, and the predefined Admin/Writer/Reader roles include registry permissions). On Self-Managed clusters you enable it explicitly.

### Prerequisites (Self-Managed)

1. A valid Redpanda Enterprise license.
2. `rpk` v25.2+.
3. Authentication enabled on the Schema Registry listener via the broker property `schema_registry_api.authentication_method: http_basic` (see [Registry authentication](#registry-authentication-basic--oidc) below). Authorization sits behind authentication.
4. The rpk Schema Registry address must use the correct scheme/host/port for the **same cluster** as the Kafka brokers (HTTP vs HTTPS must match the listener).

### Enable: `schema_registry_enable_authorization` (cluster property)

```bash
rpk cluster config set schema_registry_enable_authorization true

# Disable (return to Community-compliant state)
rpk cluster config set schema_registry_enable_authorization false
```

### ACL resource types

In addition to the standard Kafka ACL resource types (`topic`, `group`, `cluster`, `transactional_id`), Schema Registry Authorization adds two:

| Resource type | rpk flag | Scope |
|---|---|---|
| `registry` | `--registry-global` | Global / top-level registry operations (no resource name — applies to all of Schema Registry) |
| `subject` | `--registry-subject <name>` | A specific subject (or prefix with `--resource-pattern-type prefixed`) |

ACLs are created with the same `rpk security acl create` command used for Kafka ACLs (see the `rpk-security` skill).

### Operation definitions

| Operation | Grants |
|---|---|
| `read` | Read schema content / fetch versions / read schema by ID (required to consume with SR) |
| `write` | Register new schemas and schema versions (required to produce with new schemas) |
| `delete` | Delete schema versions and subjects |
| `describe` | List and describe subjects, list versions, view metadata |
| `describe_configs` | Read compatibility settings and mode (global or per-subject) |
| `alter_configs` | Change compatibility levels, set IMPORT mode, update configs |

### Endpoint → operation → resource mapping (selected)

| Endpoint | HTTP method | Operation | Resource |
|---|---|---|---|
| `/config` | GET / PUT | `describe_configs` / `alter_configs` | `registry` |
| `/config/{subject}` | GET / PUT / DELETE | `describe_configs` / `alter_configs` / `alter_configs` | `subject` |
| `/mode` | GET / PUT | `describe_configs` / `alter_configs` | `registry` |
| `/mode/{subject}` | GET / PUT / DELETE | `describe_configs` / `alter_configs` / `alter_configs` | `subject` |
| `/schemas/ids/{id}` | GET | `read` | `subject` |
| `/schemas/ids/{id}/versions` | GET | `describe` | `registry` |
| `/schemas/ids/{id}/subjects` | GET | `describe` | `registry` |
| `/subjects` | GET | `describe` | `subject` |
| `/subjects/{subject}` | POST / DELETE | `read` / `delete` | `subject` |
| `/subjects/{subject}/versions` | GET / POST | `describe` / `write` | `subject` |
| `/subjects/{subject}/versions/{version}` | GET / DELETE | `read` / `delete` | `subject` |
| `/subjects/{subject}/versions/referencedby` | GET | `describe` | `registry` |
| `/compatibility/subjects/{subject}/versions/{version}` | POST | `read` | `subject` |
| `/security/acls` | GET / POST / DELETE | `describe` / `alter` / `alter` | `cluster` |
| `/schemas/types`, `/status/ready` | GET | none/open | — |

> `/security/acls` (the ACL management endpoint itself) is gated by the `cluster` resource: `describe` to read ACLs, `alter` to create/delete them. Only superusers or principals with `alter` on `cluster` can manage registry ACLs. Only superusers or principals with `alter_configs` on the `registry` resource can change the **global** mode (required for IMPORT-mode migrations).

### Pattern-based (prefixed) ACLs

When using subject prefixes, you **must** pass `--resource-pattern-type prefixed`. Without it the string (including any `*`) is treated as a literal subject name. With `prefixed`, matching uses the string **without** the asterisk.

```bash
# Correct: matches all subjects starting with "orders-"
rpk security acl create \
  --allow-principal User:app \
  --operation read \
  --registry-subject "orders-" \
  --resource-pattern-type prefixed

# Incorrect: "orders-*" treated as a literal subject name
rpk security acl create \
  --allow-principal User:app \
  --operation read \
  --registry-subject "orders-*"
```

With TopicNameStrategy, a single prefixed ACL (`--registry-subject "orders-" --resource-pattern-type prefixed`) covers both `orders-key` and `orders-value`.

### Common ACL patterns

```bash
# Read-only consumer (read schema by ID + specific versions; no listing/modifying)
rpk security acl create \
  --allow-principal consumer-app \
  --operation read \
  --registry-subject "orders-" --resource-pattern-type prefixed

# Producer (check existence, read existing versions, register new versions)
rpk security acl create \
  --allow-principal producer-app \
  --operation read,write,describe \
  --registry-subject "orders-" --resource-pattern-type prefixed

# Schema administrator (all global operations: config, mode, delete, list)
rpk security acl create \
  --allow-principal schema-admin \
  --operation all \
  --registry-global

# Combined Kafka topic + registry subject access in one command
rpk security acl create --allow-principal panda --operation read \
  --topic bar --registry-subject bar-value
```

### Registry ACLs via roles (RBAC)

Schema Registry ACLs combine with RBAC. Roles require an Enterprise license (see the licensing overview).

```bash
rpk security role create SoftwareEng
rpk security acl create \
  --operation read,write \
  --topic private \
  --registry-subject private-key,private-value \
  --allow-role SoftwareEng
rpk security role assign SoftwareEng --principal User:john,User:jane
```

### Migration ACLs (source read-only, target read-write)

For migrating schemas between clusters with IMPORT mode on the target:

```bash
# Source cluster: read schemas + list subjects
rpk security acl create \
  --allow-principal User:migrator-user \
  --operation read,describe,describe_configs \
  --registry-global \
  --brokers <source-brokers>

# Target cluster: write schemas + manage IMPORT mode
rpk security acl create \
  --allow-principal User:migrator-user \
  --operation write,describe,alter_configs,describe_configs \
  --registry-global \
  --brokers <target-brokers>
```

Schema Registry ACLs cover **only** registry operations. Full data migration also needs Kafka ACLs (topic READ on source; WRITE/CREATE/DESCRIBE/ALTER on target; consumer-group and cluster permissions).

---

## Registry authentication (Basic / OIDC)

Authorization requires authentication first. The Schema Registry listener authentication is set via the broker (node) property:

```yaml
schema_registry:
  schema_registry_api:
    address: 0.0.0.0
    port: 8081
    authentication_method: http_basic   # or "none" for anonymous
```

`authentication_method` accepted values:

- `none` — anonymous access (default).
- `http_basic` — authentication required. The actual method (Basic vs OIDC) depends on the cluster property `http_authentication` and the client's `Authorization` header.

The cluster property `http_authentication` controls which methods are globally available: `["BASIC"]`, `["OIDC"]`, or `["BASIC", "OIDC"]`. (OIDC authentication is an Enterprise feature; see the licensing overview.)

### Authenticating rpk to the registry

`rpk registry` uses the same `user`/`pass` credentials as the rest of rpk for HTTP Basic auth to the Schema Registry API:

```bash
# HTTP Basic auth to the registry
rpk registry subject list \
  -X registry.hosts=<host>:8081 \
  -X user=<username> -X pass=<password>

# OAUTHBEARER / OIDC: set sasl.mechanism and pass an OIDC access token as `pass`
# (leave user unset). Token may be raw or prefixed with "token:".
rpk registry subject list \
  -X registry.hosts=<host>:8081 \
  -X sasl.mechanism=OAUTHBEARER \
  -X pass=token:<oidc-access-token>
```

OAUTHBEARER support in rpk was added in v26.1.7 (backported to v25.3.x and v25.2.x).

### Registry TLS / mTLS X-options

| X-option | Env var | Purpose |
|---|---|---|
| `registry.hosts` | `RPK_REGISTRY_HOSTS` | Comma-separated `host:port` list of registry endpoints |
| `registry.tls.enabled` | `RPK_REGISTRY_TLS_ENABLED` | Use TLS to the registry (auto-enabled if mTLS cert paths are set) |
| `registry.tls.insecure_skip_verify` | `RPK_REGISTRY_TLS_INSECURE_SKIP_VERIFY` | Skip server-cert verification |
| `registry.tls.ca` | `RPK_REGISTRY_TLS_CA` | CA cert filepath |
| `registry.tls.cert` | `RPK_REGISTRY_TLS_CERT` | Client cert filepath (mTLS) |
| `registry.tls.key` | `RPK_REGISTRY_TLS_KEY` | Client key filepath (mTLS) |

```bash
rpk registry schema list \
  -X registry.hosts=my-broker:8081 \
  -X registry.tls.enabled=true \
  -X registry.tls.ca=/path/to/ca.pem \
  -X registry.tls.cert=/path/to/cert.pem \
  -X registry.tls.key=/path/to/key.pem
```

### Schema Registry internal Kafka client (SASL)

When SASL is enabled on the Kafka cluster, the registry's own internal Kafka client must also be given SASL credentials, or registry operations that write to Kafka fail with `broker_not_available` (error_code 50302). Set via node-level properties:

```bash
rpk cluster config set schema_registry_client.scram_username <username>
rpk cluster config set schema_registry_client.scram_password <password>
rpk cluster config set schema_registry_client.sasl_mechanism SCRAM-SHA-256
# then restart the Schema Registry service
```

(These can also be set as node config: `--set schema_registry_client.scram_username=...`, etc.)

---

## License compliance quick checks

```bash
# Report whether enterprise features are enabled without a valid license
rpk cluster license info

# Inspect / set the registry enterprise toggles
rpk cluster config get schema_registry_enable_authorization
rpk cluster config get enable_schema_id_validation
```

To stay within Community Edition (no license), disable these features:

```bash
rpk cluster config set schema_registry_enable_authorization false
rpk cluster config set enable_schema_id_validation none
# Remove OIDC from http_authentication if used:
rpk cluster config set http_authentication '["BASIC"]'
```

---

## Enterprise-feature summary (registry domain)

| Feature | Config key | License required | Expiration behavior |
|---|---|---|---|
| Schema Registry Authorization | `schema_registry_enable_authorization` (cluster) | Yes | Cannot enable; cannot create/modify schema ACLs |
| Server-Side Schema ID Validation | `enable_schema_id_validation` (cluster) + `redpanda.{key,value}.schema.id.validation`, `redpanda.{key,value}.subject.name.strategy` (topic) | Yes | Topics with validation settings cannot be created/modified |
| OIDC / OAUTHBEARER authentication | `http_authentication` (cluster), `schema_registry_api.authentication_method` (broker) | Yes (OIDC) | No change |
| RBAC roles for registry ACLs | `rpk security role` + `--allow-role` | Yes | Roles/ACLs cannot be created or modified; deletion allowed |
