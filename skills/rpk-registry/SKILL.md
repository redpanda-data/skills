---
name: rpk-registry
description: >-
  Manages schemas, subjects, compatibility levels, modes, and contexts in the
  Redpanda Schema Registry via the rpk registry CLI (alias: rpk sr). Covers
  registering Avro/Protobuf/JSON schemas, fetching schemas by version or ID,
  listing/deleting subjects and schemas, setting BACKWARD/FORWARD/FULL/NONE
  compatibility levels, controlling registry mode (READONLY/READWRITE/IMPORT),
  and using schema contexts for namespace isolation. Also covers the
  Enterprise-licensed registry features: Schema Registry Authorization
  (schema_registry_enable_authorization, registry/subject ACLs via
  rpk security acl with --registry-global/--registry-subject) and
  Server-Side Schema ID Validation (enable_schema_id_validation,
  redpanda.key/value.schema.id.validation, subject name strategies), plus
  registry authentication (HTTP Basic, OIDC/OAUTHBEARER, mTLS).
  Use when: registering or fetching schemas, managing schema subjects and
  versions, setting or checking compatibility levels, checking schema
  compatibility before registration, administering Schema Registry mode,
  working with schema contexts (--schema-context flag), securing the registry
  with ACLs/RBAC, enabling schema ID validation, authenticating to the
  registry, or using rpk topic produce/consume with schema registry
  encoding/decoding.
---

# rpk registry: Schema Registry

The `rpk registry` command group (alias `rpk sr`) is the CLI front-end to the Redpanda Schema Registry running on port **8081** by default. It lets you register Avro, Protobuf, and JSON schemas, manage subjects and versions, enforce compatibility rules, control registry operating mode, and isolate schemas into named contexts.

The Schema Registry is built directly into the Redpanda broker binary — no separate service is required. Schemas are stored in a compacted internal topic (`_schemas`). Every broker accepts mutating calls; there is no single leader to configure.

The registry endpoint is configurable via `-X registry.hosts=<host>:<port>` or in an rpk profile.

## Quickstart

```bash
# 1. Point rpk at your cluster (skip if you already have a profile)
rpk profile create local --set brokers=localhost:9092 \
  --set registry.hosts=localhost:8081

# 2. Save an Avro schema to a file
cat > sensor.avsc << 'EOF'
{
  "type": "record",
  "name": "sensor_sample",
  "fields": [
    {"name": "timestamp", "type": {"type": "long",   "logicalType": "timestamp-millis"}},
    {"name": "identifier","type": {"type": "string", "logicalType": "uuid"}},
    {"name": "value",      "type": "long"}
  ]
}
EOF

# 3. Register the schema under the TopicNameStrategy subject for topic "sensor"
rpk registry schema create sensor-value --schema sensor.avsc

# 4. List all versions for that subject
rpk registry schema list sensor-value

# 5. Get schema metadata (subject, version, ID, type)
rpk registry schema get sensor-value --schema-version latest

# 6. Print the actual schema text
rpk registry schema get sensor-value --schema-version latest --print-schema

# 7. List all subjects
rpk registry subject list

# 8. Check global compatibility level
rpk registry compatibility-level get

# 9. Set BACKWARD compatibility globally
rpk registry compatibility-level set --level BACKWARD

# 10. Set FULL_TRANSITIVE compatibility on a specific subject
rpk registry compatibility-level set sensor-value --level FULL_TRANSITIVE

# 11. Check whether a new candidate schema is compatible before registering
rpk registry schema check-compatibility sensor-value \
  --schema sensor-v2.avsc --schema-version latest

# 12. Soft-delete a subject (recoverable)
rpk registry subject delete sensor-value

# 13. Hard-delete a subject (permanent — soft-delete must run first)
rpk registry subject delete sensor-value --permanent

# 14. One-off override of registry endpoint
rpk registry subject list -X registry.hosts=my-broker:8081
```

## Command Group Map

| Subcommand | What it does |
|---|---|
| `schema create` | Register a new schema version for a subject |
| `schema get` | Look up a schema by version, ID, or by matching an existing file |
| `schema list` | List all schema versions across subjects (or for given subjects) |
| `schema delete` | Soft- or hard-delete a specific schema version |
| `schema check-compatibility` | Test a candidate schema against the subject's compatibility rules |
| `schema references` | List schemas that reference a given subject/version |
| `subject list` | List all subjects |
| `subject delete` | Soft- or hard-delete an entire subject and all its versions |
| `compatibility-level get` | Get global or per-subject compatibility level |
| `compatibility-level set` | Set global or per-subject compatibility level |
| `mode get` | Get global or per-subject registry mode |
| `mode set` | Set global or per-subject registry mode |
| `mode reset` | Reset per-subject mode back to the global default |
| `context list` | List all materialized schema contexts |
| `context delete` | Delete an (empty) context |

Global flags available on every `rpk registry` subcommand:

- `--schema-context <name>` — scope all operations to a named context (names start with `.`)
- `--skip-context-check` — bypass admin API verification of context support
- `-X registry.hosts=<host>:<port>` — override the registry endpoint
- `--format json|yaml|text|wide|help` — persistent flag inherited by all subcommand groups (`schema`, `subject`, `compatibility-level`, `mode`, `context`); controls output format

## Schema Registry Concepts

**Subject** — a logical grouping for schemas. By default rpk topic produce/consume uses the **TopicNameStrategy**: `<topic>-value` for value schemas and `<topic>-key` for key schemas. One subject can hold many versions.

**Version** — an integer (1, 2, 3…). `latest` is accepted anywhere a version is required. Each version has a unique **schema ID** that is globally unique across all subjects (in the default context; within a context, IDs are context-scoped).

**Wire format** — producers prepend a magic byte (`0x00`) + 4-byte big-endian schema ID before the serialized payload. Consumers read the ID and fetch the schema from the registry to deserialize.

**Schema types** — `AVRO`, `PROTOBUF`, `JSON`. The type is auto-detected from the file extension (`.avsc`/`.avro` → Avro, `.proto`/`.protobuf` → Protobuf, `.json` → JSON). Override with `--type`.

**_schemas topic** — the internal compacted Kafka topic that persists all registry state. Do not edit it directly.

## Compatibility Levels

Compatibility governs which schema versions can coexist. The default is `BACKWARD`. Set globally (no subject arg) or per-subject.

| Level | Guarantee |
|---|---|
| `BACKWARD` | New schema readers can read old schema data (previous version only) |
| `BACKWARD_TRANSITIVE` | New schema readers can read data from all previous versions |
| `FORWARD` | Old schema readers can read new schema data (previous version only) |
| `FORWARD_TRANSITIVE` | Old schema readers can read data from all future versions |
| `FULL` | BACKWARD + FORWARD with the immediately preceding version |
| `FULL_TRANSITIVE` | BACKWARD_TRANSITIVE + FORWARD_TRANSITIVE with all versions |
| `NONE` | No compatibility checks performed |

```bash
# Set globally
rpk registry compatibility-level set --level BACKWARD

# Set for a subject
rpk registry compatibility-level set my-topic-value --level FULL_TRANSITIVE

# Set for multiple subjects plus global in one call
rpk registry compatibility-level set subjectA subjectB --global --level BACKWARD

# Read back
rpk registry compatibility-level get              # global
rpk registry compatibility-level get my-topic-value --global  # subject + global
```

## Registry Mode

Mode controls whether the registry accepts writes. Supported values: `READONLY`, `READWRITE`, `IMPORT`.

- **READWRITE** (normal operation) — allows schema registration and deletion.
- **READONLY** — accepts reads; rejects all writes.
- **IMPORT** — allows registering schemas with explicit IDs and versions (for migration). Can only be set on an empty registry/subject (or use `--force` to override the emptiness check).

```bash
rpk registry mode get                        # get global mode
rpk registry mode set --mode READONLY        # go read-only globally
rpk registry mode set --mode READWRITE       # restore normal operation
rpk registry mode set my-subject --mode READONLY  # per-subject
rpk registry mode reset my-subject          # revert subject to global default
```

## Schema Contexts

Contexts provide namespace isolation within a single registry instance. Each context has its own independent schema ID counter, mode settings, and compatibility settings. Requires `schema_registry_enable_qualified_subjects = true` (cluster config) and a broker restart.

Context names must start with `.` and must not contain `:`. Qualified subjects use the syntax `:<context>:<subject>`.

```bash
# Enable contexts (requires broker restart)
rpk cluster config set schema_registry_enable_qualified_subjects true

# Use --schema-context to scope all registry operations to a context
rpk registry --schema-context .staging schema create my-topic-value --schema schema.avsc
rpk registry --schema-context .staging schema list
rpk registry --schema-context .staging compatibility-level set --level FULL

# Alternatively, use qualified subject names directly
rpk registry schema create ":.staging:my-topic-value" --schema schema.avsc

# List and delete contexts
rpk registry context list
rpk registry context delete .staging   # all subjects must be hard-deleted first
```

## Schema References

Schemas can reference other schemas registered under different subjects (supported for Protobuf and Avro). Pass references at registration time with `--references`.

```bash
# Reference format: name:subject:version (comma-separated for multiple)
rpk registry schema create my-topic-value \
  --schema my-schema.proto \
  --references "google/protobuf/timestamp.proto:google-timestamp:1"

# Find schemas that reference a given subject/version
rpk registry schema references common-types --schema-version 1
```

## Producing and Consuming with Schema Registry

`rpk topic produce` and `rpk topic consume` can encode/decode using the registry automatically.

```bash
# Produce with Avro encoding (registry encodes the value)
rpk topic produce sensor \
  --schema-id topic \
  --format "%v\n" <<'EOF'
{"timestamp": 1700000000000, "identifier": "abc-123", "value": 42}
EOF

# Consume and decode Avro
rpk topic consume sensor --use-schema-registry -f "%v\n"
```

For full produce/consume flag details, see the `rpk-topic` skill.

## Enterprise Security Features

Two Schema Registry capabilities require a **Redpanda Enterprise license** and are key differentiators. See [enterprise-security.md](references/enterprise-security.md) for full detail.

**Schema Registry Authorization** (Enterprise, v25.2+) — fine-grained ACLs on registry resources, scoped by subject and operation, managed with the same `rpk security acl` command used for Kafka ACLs.

```bash
# Enable (Self-Managed; on Cloud BYOC/Dedicated it is on by default)
rpk cluster config set schema_registry_enable_authorization true

# Global registry ACL (--registry-global has no resource name)
rpk security acl create --allow-principal jane --operation read,write --registry-global

# Per-subject ACL (use prefixed pattern for topic-name-strategy coverage)
rpk security acl create --allow-principal User:app --operation read,write,describe \
  --registry-subject "orders-" --resource-pattern-type prefixed
```

Two new ACL resource types: `registry` (`--registry-global`) and `subject` (`--registry-subject`). Operations: `read`, `write`, `delete`, `describe`, `describe_configs`, `alter_configs`. On license expiration you can no longer enable authorization or create/modify schema ACLs. Requires registry authentication first (`schema_registry_api.authentication_method: http_basic`).

**Server-Side Schema ID Validation** (Enterprise) — brokers reject records whose encoded schema ID is not registered for the subject derived by the configured strategy.

```bash
# Cluster: none (off) | redpanda (redpanda.* props) | compat (redpanda.* + confluent.*)
rpk cluster config set enable_schema_id_validation redpanda

# Topic: opt in per key/value
rpk topic create topic_foo \
  --topic-config redpanda.value.schema.id.validation=true \
  --topic-config redpanda.value.subject.name.strategy=RecordNameStrategy
```

Per-topic keys: `redpanda.key.schema.id.validation`, `redpanda.key.subject.name.strategy`, `redpanda.value.schema.id.validation`, `redpanda.value.subject.name.strategy` (each has a `confluent.*` equivalent). Strategies: `TopicNameStrategy` (default), `RecordNameStrategy`, `TopicRecordNameStrategy`. On license expiration, topics with validation settings cannot be created/modified.

**Authenticating rpk to the registry**: use `-X user=`/`-X pass=` for HTTP Basic, or `-X sasl.mechanism=OAUTHBEARER -X pass=token:<oidc-token>` for OIDC. TLS/mTLS via `registry.tls.*` X-options. (OIDC authentication is Enterprise.)

## Reference Directory

- [schemas-and-subjects.md](references/schemas-and-subjects.md): Registering, fetching, listing, and deleting schemas and subjects; TopicNameStrategy; soft vs hard delete; metadata properties; schema references.
- [compatibility.md](references/compatibility.md): All compatibility levels (BACKWARD/FORWARD/FULL/NONE + TRANSITIVE variants), get/set at global and subject scope, checking a candidate schema, registry mode, and schema contexts.
- [enterprise-security.md](references/enterprise-security.md): Enterprise-licensed registry features — Schema Registry Authorization (`schema_registry_enable_authorization`, `registry`/`subject` ACL resource types, `--registry-global`/`--registry-subject`, operation mapping, RBAC roles, migration ACLs) and Server-Side Schema ID Validation (`enable_schema_id_validation`, per-topic `redpanda.*`/`confluent.*` validation + subject-name-strategy keys), plus registry authentication (HTTP Basic, OIDC/OAUTHBEARER, mTLS X-options) and license-compliance checks.
