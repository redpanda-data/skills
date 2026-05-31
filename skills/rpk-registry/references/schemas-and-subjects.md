# Schemas and Subjects

Detailed reference for `rpk registry schema` and `rpk registry subject` — registering schemas, fetching by version or ID, listing all schemas, soft and hard deletion, metadata properties, and schema references.

## Core Concepts

### Subjects and TopicNameStrategy

A **subject** is the named slot in the registry where a lineage of schema versions is stored. The most common naming convention (TopicNameStrategy) is:

- Value schemas: `<topic-name>-value`
- Key schemas: `<topic-name>-key`

You are not required to use TopicNameStrategy; you can use any string as the subject name.

### Schema Types

Supported schema types and their auto-detected file extensions:

| Type | File extensions | `--type` flag value |
|---|---|---|
| Avro | `.avsc`, `.avro` | `avro` or `avsc` (both accepted; equivalent) |
| Protobuf | `.proto`, `.protobuf` | `protobuf` or `proto` |
| JSON | `.json` | `json` |

The `--type` flag overrides extension detection.

### Schema ID vs Version

- **ID** — a globally unique integer assigned by the registry when a schema is first created (its bytes are new). IDs never reuse across subjects in the same context.
- **Version** — a per-subject monotonically increasing integer (1, 2, 3…). `latest` is a shorthand for the highest version in the subject.
- Registering the same bytes under a new subject gives you a **new version** in that subject but returns the **existing ID** (deduplication).

### Wire Format

Producers using the registry prepend:

```
[0x00][schema_id_big_endian_4_bytes][serialized_payload...]
```

Consumers read the magic byte (`0x00`) then the 4-byte schema ID, fetch the schema, and deserialize.

The internal topic `_schemas` persists all registry state. Do not edit it directly.

---

## rpk registry schema create

Register a new schema version for a subject.

```
rpk registry schema create SUBJECT --schema {filename} [flags]
```

The schema file extension determines the type automatically. Use `--type` to override.

### Key Flags

| Flag | Type | Description |
|---|---|---|
| `--schema` | string | **Required.** Path to schema file (`.avsc`, `.avro`, `.proto`, `.protobuf`, `.json`) |
| `--type` | string | Schema type: `avro`, `protobuf`, `json` — overrides file extension |
| `--references` | string | Comma-separated `name:subject:version` list, or path to a reference file |
| `--id` | int | Import mode: assign a specific schema ID (default `-1` = auto-assign) |
| `--schema-version` | int | Import mode: assign a specific version (requires `--id`; default `-1` = auto-assign) |
| `-p, --metadata-properties` | stringArray | Metadata as `key=value` pairs or JSON; can be repeated |
| `--format` | string | (Persistent, inherited from `rpk registry`) Output: `json`, `yaml`, `text`, `wide`, `help` (default `text`) |

### Examples

```bash
# Register an Avro schema for the "sensor" topic's value subject
rpk registry schema create sensor-value --schema sensor.avsc

# Explicit Avro type (no extension)
rpk registry schema create sensor-value --schema schema_file --type avro

# Register a Protobuf schema with a cross-subject reference
rpk registry schema create order-value \
  --schema order.proto \
  --references "google/protobuf/timestamp.proto:google-timestamp:1"

# Import mode: assign specific ID and version (for schema migration)
rpk registry schema create sensor-value \
  --schema sensor.avsc --id 42 --schema-version 3

# Attach metadata properties (owner, env)
rpk registry schema create sensor-value --schema sensor.avsc \
  --metadata-properties owner=platform-team \
  --metadata-properties env=prod

# Metadata as JSON (useful when values contain special characters)
rpk registry schema create sensor-value --schema sensor.avsc \
  -p '{"owner":"platform-team","application.version":"2.1.0"}'
```

### Output columns (text format)

`subject  version  id  type`

If `--metadata-properties` were supplied, a second table shows `key  value` pairs.

### Deduplication behavior

If the schema bytes you submit already exist in the registry (possibly under a different subject), the registry returns the existing schema ID but creates a new version entry in the specified subject. Registering the same schema definition with different metadata properties creates a new schema version.

---

## rpk registry schema get

Look up a schema by version, ID, or by comparing to an existing schema file. Exactly one of `--schema-version`, `--id`, or `--schema` is required.

```
rpk registry schema get [SUBJECT] [flags]
```

### Key Flags

| Flag | Description |
|---|---|
| `--schema-version string` | Look up by version (`latest`, `0`, `1`…); subject required |
| `--id int` | Look up all subjects using the schema by ID; subject optional (filters to that subject) |
| `--schema string` | Check whether this file's bytes exist in the given subject; subject required |
| `--type string` | Schema type for `--schema` lookup — overrides file extension |
| `--deleted` | Include soft-deleted schemas in the result |
| `--print-schema` | Print the schema definition text (JSON-pretty for Avro/JSON, plain for Protobuf) |
| `--print-metadata` | Print the schema's metadata properties |

`--print-schema` and `--print-metadata` are mutually exclusive.

### Examples

```bash
# Get metadata for the latest version
rpk registry schema get sensor-value --schema-version latest

# Get metadata for a specific version
rpk registry schema get sensor-value --schema-version 2

# Print the actual schema text
rpk registry schema get sensor-value --schema-version latest --print-schema

# Print metadata properties
rpk registry schema get sensor-value --schema-version latest --print-metadata

# Look up all subjects that use schema ID 7
rpk registry schema get --id 7

# Look up within a specific subject only
rpk registry schema get sensor-value --id 7

# Check if a file's schema has already been registered in a subject
rpk registry schema get sensor-value --schema sensor.avsc

# Include soft-deleted schemas
rpk registry schema get sensor-value --schema-version 1 --deleted
```

---

## rpk registry schema list

List all schema versions for one or more subjects. With no arguments, lists every subject and every version.

```
rpk registry schema list [SUBJECT...] [flags]
```

### Key Flags

| Flag | Description |
|---|---|
| `--deleted` | Include soft-deleted schemas |

### Examples

```bash
# List all schemas in the registry
rpk registry schema list

# List all versions for specific subjects
rpk registry schema list sensor-value order-value

# Include soft-deleted schemas
rpk registry schema list --deleted
```

### Output columns (text format)

`subject  version  id  type  error`

When schema contexts are enabled and you have not scoped to a specific context, an additional `context` column is prepended.

---

## rpk registry schema delete

Delete a specific schema version from a subject. A **soft delete** (default) marks the version as deleted but retains the bytes; a **hard delete** (`--permanent`) removes the bytes permanently. Hard delete requires a soft delete to have been performed first — the command does this automatically.

```
rpk registry schema delete SUBJECT --schema-version {version} [flags]
```

### Key Flags

| Flag | Description |
|---|---|
| `--schema-version string` | **Required.** Version to delete (`latest`, `0`, `1`…) |
| `--permanent` | Perform a hard (permanent) delete; soft-deletes first if needed |

### Examples

```bash
# Soft-delete version 2
rpk registry schema delete sensor-value --schema-version 2

# Permanently delete version 2 (irreversible)
rpk registry schema delete sensor-value --schema-version 2 --permanent

# Permanently delete the latest version
rpk registry schema delete sensor-value --schema-version latest --permanent
```

---

## rpk registry schema check-compatibility

Test whether a candidate schema file is compatible with the current compatibility rules for a subject, without actually registering it.

```
rpk registry schema check-compatibility SUBJECT [flags]
```

### Key Flags

| Flag | Description |
|---|---|
| `--schema string` | **Required.** Path to candidate schema file |
| `--schema-version string` | **Required.** Which registered version to check against (`latest`, `0`, `1`…) |
| `--type string` | Schema type — overrides file extension |
| `--references string` | References the candidate schema relies on |

### Examples

```bash
# Is sensor-v2.avsc backward-compatible with the latest registered version?
rpk registry schema check-compatibility sensor-value \
  --schema sensor-v2.avsc --schema-version latest

# Check against a specific version
rpk registry schema check-compatibility sensor-value \
  --schema sensor-v2.avsc --schema-version 3
```

### Output

```
Schema is compatible.
```
or
```
Schema is not compatible.
<reason messages>
```

In JSON/YAML format the response is `{"compatible": true/false, "messages": [...]}`.

---

## rpk registry schema references

List schemas that reference a given subject/version. Useful for understanding the dependency graph before deleting a schema.

```
rpk registry schema references SUBJECT --schema-version {version} [flags]
```

### Key Flags

| Flag | Description |
|---|---|
| `--schema-version string` | **Required.** Version to check for references (`latest`, `0`, `1`…) |
| `--deleted` | Include soft-deleted schemas in the results |

### Example

```bash
rpk registry schema references common-types --schema-version 1
```

---

## rpk registry subject list

List all subjects in the registry.

```
rpk registry subject list [flags]
```

| Flag | Description |
|---|---|
| `--deleted` | Include subjects that have been soft-deleted |

```bash
rpk registry subject list
rpk registry subject list --deleted
```

When schema contexts are enabled without `--schema-context`, non-default context subjects appear in the `context` column.

---

## rpk registry subject delete

Delete one or more subjects. Default is a soft delete (recoverable); use `--permanent` for a hard (irreversible) delete. A hard delete always runs a soft delete first.

```
rpk registry subject delete [SUBJECT...] [flags]
```

| Flag | Description |
|---|---|
| `--permanent` | Perform a hard (permanent) delete |

### Examples

```bash
# Soft-delete subject (marks all versions as deleted)
rpk registry subject delete sensor-value

# Permanently delete subject (irreversible)
rpk registry subject delete sensor-value --permanent

# Delete multiple subjects at once
rpk registry subject delete sensor-value order-value --permanent
```

### Output columns

`subject  versions-deleted  error`

---

## Metadata Properties

Schemas can carry arbitrary `key=value` metadata properties (e.g. `owner`, `team`, `application.version`). Metadata travels with the schema version through its lifecycle.

- Register with `-p / --metadata-properties` on `schema create`.
- Inspect with `--print-metadata` on `schema get`.
- When registering a new version without metadata, the new version **automatically inherits** properties from the most recent version of that subject.
- To register a schema with **no** metadata (clearing inherited properties), pass an empty JSON object via the HTTP API: `"metadata": {}`.
- Registering the same schema definition with **different** metadata properties creates a new schema version.

```bash
# Register with metadata
rpk registry schema create sensor-value --schema sensor.avsc \
  --metadata-properties owner=platform-team \
  --metadata-properties env=prod

# View metadata
rpk registry schema get sensor-value --schema-version latest --print-metadata
```

Only `metadata.properties` from the Confluent Data Contracts specification is supported. `metadata.tags`, `ruleSet`, `defaultMetadata`, `overrideMetadata`, `defaultRuleSet`, `overrideRuleSet`, and `compatibilityGroup` are **not** supported.

---

## Schema References

Schema references allow one schema to refer to another schema registered under a different subject. Supported for Protobuf and Avro.

### Reference format for `--references`

Pass a comma-separated list of `name:subject:version` triples, or a path to a file:

```
name:subject:version[,name:subject:version,...]
```

File format (tab/space separated, or JSON/YAML):

```
google/protobuf/timestamp.proto  google-timestamp  1
```

JSON/YAML file:
```json
[
  {"name": "google/protobuf/timestamp.proto", "subject": "google-timestamp", "version": 1}
]
```

### Example: Protobuf with a standard reference

```bash
# 1. Register the shared type first
rpk registry schema create google-timestamp \
  --schema timestamp.proto --type protobuf

# 2. Register the main schema referencing it
rpk registry schema create order-value \
  --schema order.proto \
  --references "google/protobuf/timestamp.proto:google-timestamp:1"
```

### Finding what references a schema

```bash
rpk registry schema references google-timestamp --schema-version 1
```

---

## Soft Delete vs Hard Delete

| Operation | Command | Recoverable | Effect |
|---|---|---|---|
| Soft delete (schema version) | `schema delete --schema-version N` | Yes (until hard-deleted) | Version is hidden but schema bytes are retained |
| Hard delete (schema version) | `schema delete --schema-version N --permanent` | No | Bytes removed; schema ID is freed |
| Soft delete (subject) | `subject delete subject-name` | Yes | All versions marked deleted |
| Hard delete (subject) | `subject delete subject-name --permanent` | No | All versions and bytes removed |

Hard delete requires the soft delete to have been performed first. `rpk registry subject delete --permanent` handles both steps automatically.

To see soft-deleted items, add `--deleted` to any `list` or `get` command.

---

## JSON Schema Limitations

- All CRUD operations and compatibility modes are supported for JSON Schema.
- Supported JSON Schema drafts: draft-04, draft-06, draft-07, 2019-09, 2020-12.
- Internal references (`$ref` using JSON Pointer fragments like `#/definitions/...`) and bundled schemas (`$id`) are supported.
- **External references** (where `$ref` points to a different registered subject) are **not supported** for JSON schemas. Use `definitions` / `$defs` within the same document.
- Schema ID validation with JSON schemas does not work when the subject name strategy is not `TopicNameStrategy`.

---

## Schema Size Best Practice

Schema Registry works best with schemas of **128 KB** or less. Large schemas consume significant memory and may cause instability in memory-constrained environments. For Protobuf and Avro, use schema references to split large schemas into smaller constituent parts.
