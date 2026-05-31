# Compatibility Levels, Registry Mode, and Schema Contexts

Detailed reference for `rpk registry compatibility-level`, `rpk registry mode`, and `rpk registry context` — controlling schema evolution rules, registry operating mode, and namespace isolation.

---

## Compatibility Levels

Compatibility levels define what kinds of schema changes are allowed when registering a new version. The registry enforces the configured level when a `schema create` call is made.

### Level Reference

| Level | Who it protects | Scope |
|---|---|---|
| `BACKWARD` (default) | New schema consumers can read data written with the **previous** version | Single prior version |
| `BACKWARD_TRANSITIVE` | New schema consumers can read data written with **all** previous versions | All prior versions |
| `FORWARD` | Old schema consumers can read data written with the **new** version | Single prior version |
| `FORWARD_TRANSITIVE` | Old schema consumers (any prior version) can read new-version data | All prior versions |
| `FULL` | New and previous versions are mutually backward- and forward-compatible | Previous version only |
| `FULL_TRANSITIVE` | New version is backward- and forward-compatible with **all** registered versions | All prior versions |
| `NONE` | No compatibility checks; any schema change is accepted | — |

#### BACKWARD — Adding optional fields (safe for Avro/Protobuf/JSON)

A new schema reader can read old data because the new fields are absent in old records and fall back to defaults. Old schema readers do not need to change. Use this when consumers update before producers.

#### FORWARD — Adding optional fields (safe for consumers that lag behind)

An old schema reader can read new data because new fields are ignored. Use this when producers update before consumers.

#### FULL / FULL_TRANSITIVE — Both directions

Useful when you cannot coordinate producer and consumer rollouts.

#### NONE — Migration or bulk import only

No checks are enforced. Use only in controlled migrations or when you own all producers and consumers.

---

## rpk registry compatibility-level get

Get the global compatibility level, or per-subject levels.

```
rpk registry compatibility-level get [SUBJECT...] [flags]
```

| Flag | Description |
|---|---|
| `--global` | Return the global level **in addition** to per-subject levels |
| `--format` | (Persistent, inherited from `rpk registry`) Output format: `json`, `yaml`, `text`, `wide`, `help` |

### Examples

```bash
# Get the global level (no subjects = returns global)
rpk registry compatibility-level get

# Get the level for a specific subject
rpk registry compatibility-level get sensor-value

# Get multiple subjects
rpk registry compatibility-level get sensor-value order-value

# Get per-subject levels AND the global level simultaneously
rpk registry compatibility-level get sensor-value --global

# JSON output
rpk registry compatibility-level get sensor-value --format json
```

### Output columns

`subject  level  error`

The global level appears with subject shown as `{GLOBAL}`.

---

## rpk registry compatibility-level set

Set the global compatibility level, or per-subject levels.

```
rpk registry compatibility-level set [SUBJECT...] [flags]
```

| Flag | Description |
|---|---|
| `--level string` | **Required.** One of: `NONE`, `BACKWARD`, `BACKWARD_TRANSITIVE`, `FORWARD`, `FORWARD_TRANSITIVE`, `FULL`, `FULL_TRANSITIVE` |
| `--global` | Set the global level **in addition** to per-subject levels |

Running with no subjects sets the **global** level. Specifying subjects sets only those subjects' levels. Use `--global` to set both.

### Examples

```bash
# Set the global level to BACKWARD
rpk registry compatibility-level set --level BACKWARD

# Set FULL_TRANSITIVE on a specific subject
rpk registry compatibility-level set sensor-value --level FULL_TRANSITIVE

# Set BACKWARD on multiple subjects
rpk registry compatibility-level set sensor-value order-value --level BACKWARD

# Set NONE on subject AND reset global to NONE
rpk registry compatibility-level set sensor-value --global --level NONE
```

---

## Checking Compatibility Before Registering

Use `rpk registry schema check-compatibility` to test whether a new schema version satisfies the subject's current compatibility rules **without** registering it. This is a safe pre-flight check.

```
rpk registry schema check-compatibility SUBJECT \
  --schema {candidate-file} \
  --schema-version {version-to-check-against}
```

The command uses `sr.Verbose` mode, so the response includes the specific incompatibility messages when the check fails.

### Examples

```bash
# Check backward compatibility against the latest version
rpk registry schema check-compatibility sensor-value \
  --schema sensor-v2.avsc --schema-version latest

# Check against a specific version
rpk registry schema check-compatibility order-value \
  --schema order-v3.proto --schema-version 2

# Check a JSON schema
rpk registry schema check-compatibility user-value \
  --schema user-v2.json --schema-version latest
```

### Exit codes and output

- Exits `0` and prints `Schema is compatible.` on success.
- Exits non-zero and prints `Schema is not compatible.` plus reason messages on failure.
- JSON format: `{"compatible": true, "messages": []}` or `{"compatible": false, "messages": ["<reason>", ...]}`

---

## Registry Mode

Mode controls whether the registry accepts write operations globally or for individual subjects.

### Supported Modes

| Mode | Writes allowed | Notes |
|---|---|---|
| `READWRITE` | Yes | Normal operation |
| `READONLY` | No | All mutating requests are rejected |
| `IMPORT` | Yes (with explicit IDs) | For schema migration only; requires empty registry/subject unless `--force` |

`IMPORT` mode lets you register schemas with specific IDs and versions (using `schema create --id` and `--schema-version`). This is used when migrating from another Schema Registry instance. `IMPORT` can only be set on an empty registry (globally) or empty subject (per-subject). "Empty" means no schemas have **ever** been registered — soft deletes are not sufficient; you must hard-delete all schemas first. Use `--force` to override the emptiness check.

---

## rpk registry mode get

Get the current mode.

```
rpk registry mode get [SUBJECT...] [flags]
```

| Flag | Description |
|---|---|
| `--global` | Return the global mode **in addition** to per-subject modes |

With no subjects, returns the global mode. The underlying request uses `defaultToGlobal=true` to resolve the effective value after fallback.

### Examples

```bash
# Get global mode
rpk registry mode get

# Get mode for a subject
rpk registry mode get sensor-value

# Get per-subject mode AND the global mode
rpk registry mode get sensor-value --global
```

### Output columns

`subject  mode  error`

The global mode appears with subject shown as `{GLOBAL}`. If an error is returned, the mode column shows `-` to avoid displaying a misleading default value.

---

## rpk registry mode set

Set the registry mode globally or per-subject.

```
rpk registry mode set [SUBJECT...] [flags]
```

| Flag | Description |
|---|---|
| `--mode string` | **Required.** `READONLY`, `READWRITE`, or `IMPORT` (case-insensitive) |
| `--global` | Set the global mode **in addition** to per-subject modes |
| `--force` | Override the emptiness check for `IMPORT` mode |

### Examples

```bash
# Go read-only globally
rpk registry mode set --mode READONLY

# Restore normal operation
rpk registry mode set --mode READWRITE

# Set a subject to read-only
rpk registry mode set sensor-value --mode READONLY

# Set multiple subjects to READONLY
rpk registry mode set sensor-value order-value --mode READONLY

# Enable IMPORT mode globally (requires empty registry)
rpk registry mode set --mode IMPORT

# Enable IMPORT mode, overriding emptiness check
rpk registry mode set --mode IMPORT --force

# Set IMPORT for a subject, set both subject and global
rpk registry mode set sensor-value --global --mode IMPORT --force
```

---

## rpk registry mode reset

Reset per-subject mode back to the global default. Also prints the mode before reverting.

```
rpk registry mode reset [SUBJECT...] [flags]
```

### Example

```bash
# Revert sensor-value's mode to the global default
rpk registry mode reset sensor-value

# Revert multiple subjects
rpk registry mode reset sensor-value order-value
```

---

## Schema Contexts

Schema contexts are namespaces that isolate schemas, subjects, and configuration within a single Schema Registry instance. Each context has its own:

- Independent schema ID counter
- Mode settings
- Compatibility settings

Contexts are compatible with the Confluent Schema Registry Contexts API.

### When to Use Contexts

- **Multi-team deployments on a shared cluster** — teams register schemas independently without naming collisions or configuration drift.
- **Schema migration from Confluent Schema Registry** — Confluent uses contexts to namespace schemas; Redpanda's implementation is compatible.

> **Serverless note**: On Serverless clusters, Redpanda uses contexts internally for per-tenant isolation. Contexts are not exposed to end users on Serverless. Available on BYOC and Dedicated clusters.

### Prerequisites

1. Redpanda v26.1 or later.
2. Set the cluster property `schema_registry_enable_qualified_subjects = true` and **restart all brokers**.

```bash
rpk cluster config set schema_registry_enable_qualified_subjects true
# Then restart all brokers
```

Context names must start with `.` and must not contain `:`. Example valid names: `.staging`, `.production`, `.shared`.

Qualified subject syntax: `:<context>:<subject>`

Examples:
- `user-events-value` — subject in the default context (`.`)
- `:.staging:user-events-value` — subject in the `.staging` context
- `:.staging:` — empty subject, used for context-level config/mode operations

### Configuration Resolution Order

After enabling contexts:

```
Subject → Context → Global (.:.__GLOBAL:) → Built-in defaults
```

- `.__GLOBAL` is the reserved lowest-priority fallback for all contexts. In configuration/mode paths it appears as `.:.__GLOBAL:`.
- Use `rpk registry compatibility-level get` with the `--schema-context` flag to resolve effective values.

### Schema ID Isolation

Each context has its own ID counter. Schema ID `1` in `.staging` is a **different** schema from ID `1` in `.production`. When fetching a schema by ID, the registry searches the **default context** only unless you scope the request with a `subject` hint.

---

## rpk registry context list

List all materialized contexts (those that have had at least one schema registered).

```
rpk registry context list
```

Output columns: `name  mode  compatibility`

A context only appears after at least one schema has been registered in it. Pre-configuring mode or compatibility alone does not materialize a context.

```bash
rpk registry context list
```

---

## rpk registry context delete

Delete an (empty) context. All subjects within the context must be hard-deleted first; soft-deleted subjects still count toward non-empty. The default context (`.`) cannot be deleted.

```
rpk registry context delete CONTEXT [flags]
```

| Flag | Description |
|---|---|
| `--no-confirm` | Skip the confirmation prompt |

```bash
# First: hard-delete all subjects in the context
rpk registry --schema-context .staging subject delete --permanent my-topic-value

# Then delete the context
rpk registry context delete .staging
```

---

## Using --schema-context on rpk registry

The `--schema-context` flag is a **persistent** flag on the parent `rpk registry` command. It scopes all operations to the specified context automatically by qualifying every subject name.

```bash
# Register a schema in .staging
rpk registry --schema-context .staging schema create \
  my-topic-value --schema schema.avsc

# List schemas in .staging
rpk registry --schema-context .staging schema list

# Check compatibility in .staging
rpk registry --schema-context .staging schema check-compatibility \
  my-topic-value --schema schema-v2.avsc --schema-version latest

# Set compatibility for the .staging context
rpk registry --schema-context .staging compatibility-level set --level BACKWARD

# Get mode for the .staging context
rpk registry --schema-context .staging mode get

# Delete a subject in .staging (soft)
rpk registry --schema-context .staging subject delete my-topic-value
```

`--skip-context-check` bypasses the admin API verification of context support (useful when Admin API access is unavailable).

### Qualified Subject Names (Alternative)

Instead of `--schema-context`, you can use qualified subject names directly:

```bash
rpk registry schema create ":.staging:my-topic-value" --schema schema.avsc
rpk registry schema list  # returns qualified names for non-default contexts
```

Both approaches are equivalent and interchangeable.

---

## Context-Scoped Compatibility and Mode

You can set mode and compatibility at the **context** level. All subjects in the context inherit the context-level setting unless they have a subject-level override.

```bash
# Set the .staging context's compatibility (using --schema-context)
rpk registry --schema-context .staging compatibility-level set --level FULL

# Set READONLY mode for the .staging context
rpk registry --schema-context .staging mode set --mode READONLY
```

Via the HTTP API, context-level settings use the qualified subject with an empty subject part (`:.staging:`):

```bash
curl -s -X PUT http://localhost:8081/config/:.staging: \
  -H "Content-Type: application/vnd.schemaregistry.v1+json" \
  -d '{"compatibility": "BACKWARD"}'

curl -s -X PUT http://localhost:8081/mode/:.staging: \
  -H "Content-Type: application/vnd.schemaregistry.v1+json" \
  -d '{"mode": "READONLY"}'
```

---

## Context Limitations

- **Non-Java SerDe clients** — not supported (workaround: point the client's base URL to `http://<host>:8081/contexts/<context>`).
- **Server-side schema ID validation** with Kafka record headers does not support contexts. Magic byte and prefix validation are supported.
- **Iceberg topics** — cannot use schemas within a context for Iceberg Topics.
- **`referencedby` endpoint** — returns bare IDs with no context information; ambiguous when references span contexts.
- **Cross-context isolation** — contexts isolate IDs and configuration, but do not prevent cross-context schema references.
- **Default context (`.`) cannot be deleted.**
- **Breaking change on upgrade** — existing subjects whose names match the qualified subject pattern (`:.ctx:name`) are reinterpreted as context-qualified subjects when the flag is enabled. Audit with:

  ```bash
  rpk registry subject list | grep '^\.'
  ```

---

## ACL Authorization for Contexts

When Schema Registry ACLs are enabled, contexts integrate with the existing `sr_subject` and `sr_registry` ACL resource types:

| Operation | ACL resource | Permission |
|---|---|---|
| Context-level config/mode | `sr_registry` | `alter_configs` |
| Read context config/mode | `sr_registry` | `describe_configs` |
| List subjects / contexts | `sr_subject` (filtered) | `describe` |
| Delete a context | `sr_registry` | `delete` |
| Schema CRUD on a subject | `sr_subject` (specific) | `read` / `write` / `delete` |

Grant access to all subjects in a context using a prefix ACL:

```bash
rpk security acl create \
  --registry-subject ":.staging:" \
  --resource-pattern-type prefixed \
  --operation read \
  --allow-principal User:alice \
  --brokers localhost:9092
```

---

## Metrics with Contexts

When contexts are enabled, these Schema Registry metrics gain a `context` label:

- `*_schema_registry_cache_schema_count`
- `*_schema_registry_cache_subject_count`
- `*_schema_registry_cache_subject_version_count`

---

## Quick Reference: Common Patterns

```bash
# --- Compatibility workflow ---
# 1. Check what level is currently set
rpk registry compatibility-level get my-topic-value

# 2. Pre-flight: will this new schema version pass?
rpk registry schema check-compatibility my-topic-value \
  --schema my-schema-v2.avsc --schema-version latest

# 3. If compatible, register it
rpk registry schema create my-topic-value --schema my-schema-v2.avsc

# --- Safe migration with IMPORT mode ---
# 1. Hard-delete existing schemas (if any)
rpk registry subject delete my-topic-value --permanent

# 2. Enable IMPORT mode
rpk registry mode set --mode IMPORT

# 3. Import schemas with specific IDs
rpk registry schema create my-topic-value \
  --schema original.avsc --id 1001 --schema-version 1

# 4. Restore READWRITE mode
rpk registry mode set --mode READWRITE

# --- Context isolation for staging ---
# Enable contexts (one-time setup)
rpk cluster config set schema_registry_enable_qualified_subjects true
# Restart brokers, then:
rpk registry --schema-context .staging schema create \
  my-topic-value --schema schema.avsc
rpk registry --schema-context .staging compatibility-level set --level FULL
rpk registry --schema-context .staging mode set --mode READONLY
```
