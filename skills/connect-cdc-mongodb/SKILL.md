---
name: connect-cdc-mongodb
description: >-
  Streams change data capture (CDC) from MongoDB into Redpanda or Kafka using
  Redpanda Connect's mongodb_cdc input — Change Streams over a replica set or
  sharded cluster, resume-token checkpointing, optional initial snapshot, and
  three document modes (update_lookup, pre_and_post_images, partial_update).
  Use when: capturing inserts/updates/deletes/replaces from MongoDB into
  Redpanda or Kafka; configuring the mongodb_cdc input; setting up MongoDB
  Change Streams (requires replica set or sharded cluster); enabling
  stream_snapshot to back-fill existing documents before streaming live changes;
  routing per-collection CDC events to separate Redpanda topics with Bloblang;
  configuring a cache resource for resume-token checkpointing; choosing between
  update_lookup and pre_and_post_images document modes; tuning snapshot_parallelism
  or snapshot_auto_bucket_sharding for Atlas environments; understanding the
  operation/collection/operation_time/schema message metadata emitted by the
  connector; resuming after restarts with resume tokens; troubleshooting oplog
  window expiry; landing CDC events as Iceberg Topics (redpanda.iceberg.mode/
  delete/invalid.record.action/partition.spec/target.lag.ms); enabling server-side
  Schema ID Validation (enable_schema_id_validation, redpanda.value.schema.id.validation);
  long-term CDC retention via Tiered Storage (redpanda.remote.read/write,
  retention.local.target.*); securing the Redpanda sink with TLS and SASL
  (SCRAM/OAUTHBEARER/Kerberos); RBAC, Connect secrets management, FIPS, and
  allow/deny component lists; or asking about the Enterprise license requirement
  for this connector and the surrounding enterprise features.
---

# Redpanda Connect CDC: MongoDB

The `mongodb_cdc` input in Redpanda Connect streams change data capture (CDC) from a MongoDB database into Redpanda or any Kafka-compatible topic. It uses MongoDB Change Streams (requires MongoDB 4.0+ running as a **replica set** or **sharded cluster**), and optionally snapshots all existing documents before switching to live change streaming. This is an **Enterprise feature** — a Redpanda Enterprise license is required.

The connector tracks its position in the change stream using a **resume token**, which is stored in a configured cache resource. On restart, it resumes from the last stored token rather than replaying from the beginning.

## Quickstart

### 1. Verify your MongoDB topology

Change Streams require a replica set or sharded cluster — they are not available on standalone `mongod` instances.

```bash
# Connect via mongosh and check replication status
mongosh "mongodb://localhost:27017"
rs.status()   # must show a replica set configuration

# Create a user with read on the target DB
# (covers find + listCollections + changeStream action)
use admin
db.createUser({
  user: "cdc_user",
  pwd:  "secret",
  roles: [
    { role: "read", db: "mydb" }
  ]
})
```

### 2. Full pipeline YAML (snapshot + stream, two collections)

```yaml
# mongodb-cdc-pipeline.yaml
cache_resources:
  - label: mongo_checkpoint
    memory:
      compaction_interval: "" # disable compaction/expiry (token persists for process lifetime)

input:
  label: "mongo_cdc"
  mongodb_cdc:
    url:      "mongodb://cdc_user:secret@localhost:27017/?replicaSet=rs0"
    database: mydb
    collections:
      - orders
      - customers
    checkpoint_cache:    mongo_checkpoint
    checkpoint_key:      mongodb_cdc_checkpoint   # default
    checkpoint_interval: 5s                        # default
    checkpoint_limit:    1000                      # default
    stream_snapshot:     true
    snapshot_parallelism: 2
    read_batch_size: 1000                          # default
    read_max_wait:   1s                            # default
    document_mode:   update_lookup                 # default
    json_marshal_mode: canonical                   # default

pipeline:
  processors:
    - mapping: |
        # Route each event to a per-collection topic
        meta topic = "mongo.cdc." + meta("collection")
        # Tag the key with the document _id.
        # In canonical json_marshal_mode (the default) _id is an ExtJSON
        # object like {"$oid":"..."}, so extract the inner string:
        meta msg_key = this._id."$oid" | this._id.string() | ""

output:
  redpanda:
    seed_brokers: ["localhost:9092"]
    topic:        ${! meta("topic") }
    key:          ${! meta("msg_key") }
    max_in_flight: 256
```

### 3. Run the pipeline

```bash
rpk connect run mongodb-cdc-pipeline.yaml
```

### 4. Verify messages arrive

```bash
rpk topic consume mongo.cdc.orders --num 5 --brokers localhost:9092
```

## Prerequisites

- **MongoDB 4.0 or higher** — the connector checks the server version at startup and returns an error for < 4.0.
- **Replica set or sharded cluster** — Change Streams are not available on standalone instances.
- **User privileges**: at minimum the `read` role on the target database — this covers `find` (snapshot), `listCollections` (schema discovery), and the `changeStream` action (Change Streams). For parallel snapshots via `splitVector` on self-managed clusters, also grant `clusterManager` on `admin`; alternatively set `snapshot_auto_bucket_sharding: true` to avoid that requirement. The `hello`/`buildInfo` startup commands require no special role.
- **Redpanda Enterprise license** — the `mongodb_cdc` component is gated by `license.CheckRunningEnterprise`.

## Core Concepts

### Change Streams and Resume Tokens

`mongodb_cdc` opens a MongoDB Change Stream over the target database, filtered to the configured collections. MongoDB tracks position via an opaque **resume token** (not an integer offset). The connector stores the latest acknowledged token in the configured cache resource every `checkpoint_interval` (default `5s`), and also writes one final token on clean shutdown.

On startup, if no cached token is found, the connector:
1. Records the current oplog position.
2. If `stream_snapshot: true`, reads all existing documents (operation = `"read"`).
3. Opens the change stream starting just after the recorded oplog position.

If a token is found, the connector resumes directly from that position using `ResumeAfter`.

### Document Modes

The `document_mode` field controls what body is emitted for update and delete events:

| Mode | Updates | Deletes |
|------|---------|---------|
| `update_lookup` (default) | Full document after the update (via `UpdateLookup`). Falls back to `documentKey` if the document was deleted before lookup. | Only `_id` populated (documentKey). |
| `pre_and_post_images` | Full document before and after (requires MongoDB 6.0+ and `changeStreamPreAndPostImages` enabled on each collection). | Full document before deletion. |
| `partial_update` | A structured diff: `{_id, operations: [{path, type, value}]}` where `type` is `set`, `unset`, or `truncatedArray`. Enables `showExpandedEvents` on MongoDB 6.1+. | Only `documentKey`. |

### Message Metadata

Every message emitted by `mongodb_cdc` carries:

| Metadata key | Value |
|---|---|
| `operation` | `"read"` (snapshot), `"insert"`, `"update"`, `"replace"`, or `"delete"` |
| `collection` | Collection name (e.g., `"orders"`) |
| `operation_time` | BSON timestamp in JSON form: `{"$timestamp":{"t":<unix_sec>,"i":<ordinal>}}` |
| `schema` | Inferred or validator-derived schema in benthos common schema format (immutable; absent when no schema can be determined, e.g., deletes without pre-images) |

### Schema Detection

The connector uses a two-tier strategy to populate the `schema` metadata:

1. At startup, it queries each collection's `$jsonSchema` validator. If found, this provides accurate types and required/optional field classification.
2. When no validator exists, schema is inferred from the first document seen per collection. All fields are marked optional.

The schema is re-inferred when the top-level field set of a document changes. Type changes within existing fields and nested subdocument structural changes are not auto-detected — restart to force a full schema refresh.

**Recommendation**: for schema-registry targets with compatibility modes, configure a `$jsonSchema` validator on each watched collection to stabilize the schema.

### Snapshot Phase

When `stream_snapshot: true` and no resume token is cached, the connector snapshots all documents in each collection before streaming live changes.

- **Per-collection concurrency** (always): each collection is snapshotted in its own goroutine, so multiple collections are always snapshotted concurrently regardless of `snapshot_parallelism`.
- **Within-collection cursor scan** (`snapshot_parallelism: 1`, the default): each collection is read sequentially with a single cursor.
- **Within-collection parallel** (`snapshot_parallelism > 1`): each collection is split into `snapshot_parallelism` `_id`-range buckets read concurrently, using `splitVector` (self-managed, requires `clusterManager` role) or `$bucketAuto` (when `snapshot_auto_bucket_sharding: true`, for Atlas where `splitVector` is disallowed).

The `read_batch_size` field controls the MongoDB cursor batch size for both snapshot and streaming phases.

## Checkpoint Cache

The `checkpoint_cache` field is **required** — you must provide a named cache resource. This cache stores the resume token as BSON Extended JSON.

For development (non-persistent, resets on restart):

```yaml
cache_resources:
  - label: mongo_checkpoint
    memory:
      compaction_interval: "" # empty string disables compaction and expiry
```

For production (persistent across restarts), use Redis:

```yaml
cache_resources:
  - label: mongo_checkpoint
    redis:
      url: redis://localhost:6379
```

## Enabling Pre and Post Images (MongoDB 6+)

To use `document_mode: pre_and_post_images`, you must enable this feature on each collection:

```javascript
// Enable at collection level
db.runCommand({
  collMod: "orders",
  changeStreamPreAndPostImages: { enabled: true }
})
```

This requires **MongoDB 6.0+** — `changeStreamPreAndPostImages` was introduced in 6.0. Use `document_mode: update_lookup` on MongoDB 4.x–5.x.

## Operational Notes

### Oplog Window

The resume token references a position in the oplog. If the pipeline is stopped for longer than the oplog retention window (default 24 hours on Atlas; configurable with `--oplogMinRetentionHours` on self-managed clusters), the token becomes invalid and the connector will error. In this case, delete the cached token and restart with `stream_snapshot: true` to re-snapshot.

### Restart Behavior

On restart with a valid cached token, the connector immediately opens the change stream at the stored position — no snapshot is performed regardless of `stream_snapshot` setting. The snapshot only runs when no cached token exists.

### Atlas / Restricted Environments

On MongoDB Atlas, the `splitVector` command is not available. Set `snapshot_auto_bucket_sharding: true` to use `$bucketAuto` aggregation for parallel snapshots instead.

## Enterprise Features Around the CDC Topic

The `mongodb_cdc` input is itself an **Enterprise** connector, and the topics it
feeds pair with other Redpanda enterprise differentiators (all require a valid
Enterprise license — see [Enterprise Integration](references/enterprise-integration.md)
for nested keys and examples):

- **Iceberg Topics** — make the CDC output topic a queryable Iceberg table. Set
  cluster `iceberg_enabled=true`, then topic `redpanda.iceberg.mode`
  (`key_value` for raw CDC JSON, or `value_schema_id_prefix`/`value_schema_latest`
  for schema-serialized events), plus `redpanda.iceberg.delete`,
  `redpanda.iceberg.invalid.record.action` (`drop`/`dlq_table`),
  `redpanda.iceberg.partition.spec`, `redpanda.iceberg.target.lag.ms`.
- **Server-side Schema ID Validation** — cluster `enable_schema_id_validation`
  (`none`/`redpanda`/`compat`); topic `redpanda.value.schema.id.validation` +
  `redpanda.value.subject.name.strategy` (and key equivalents).
- **Tiered Storage** — long-term CDC retention: topic `redpanda.remote.write` +
  `redpanda.remote.read`, with `retention.local.target.ms`/`.bytes` bounding the
  local footprint.
- **Sink security** — TLS (`tls.client_certs[]`, `tls.root_cas_file`) and SASL
  (`sasl[].mechanism`: `SCRAM-SHA-512`/`PLAIN`/`OAUTHBEARER`); OAUTHBEARER/OIDC
  and Kerberos broker auth are Enterprise.
- **RBAC, Connect secrets management, FIPS, allow/deny component lists** — harden
  the pipeline and resolve the MongoDB/SASL passwords from a remote secret store.

## Reference Directory

- [Config Reference](references/config-reference.md): Every `mongodb_cdc` input field with type, default, and description grounded in source.
- [Setup MongoDB](references/setup-mongodb.md): Replica-set/sharded-cluster requirement, user privileges, Atlas specifics, and oplog configuration.
- [Pipeline and Output](references/pipeline-and-output.md): Full pipeline YAML examples, message/metadata shape, per-collection routing, cache options, and restart/resume semantics.
- [Enterprise Integration](references/enterprise-integration.md): Enterprise features around the CDC topic and their nested config keys — Iceberg Topics (`redpanda.iceberg.*`), Server-side Schema ID Validation (`enable_schema_id_validation`, `redpanda.{key,value}.schema.id.validation`), Tiered Storage (`redpanda.remote.*`, `retention.local.target.*`), sink TLS + SASL (SCRAM/OAUTHBEARER/Kerberos), RBAC, Connect secrets management, FIPS, and allow/deny lists. Notes which require an Enterprise license.
