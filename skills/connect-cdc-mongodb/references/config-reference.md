# mongodb_cdc Config Reference

Every field for the `mongodb_cdc` input, grounded in
`connect/internal/impl/mongodb/cdc/input.go` and the generated docs at
`connect/docs/modules/components/pages/inputs/mongodb_cdc.adoc`.

The component is registered as `"mongodb_cdc"` (a `BatchInput`). It is
**Enterprise-only**: `license.CheckRunningEnterprise` is called in `newMongoCDC`
and the input refuses to start without a valid license.

---

## Full config block (all fields with defaults)

```yaml
input:
  label: ""
  mongodb_cdc:
    # --- Connection ---
    url: "mongodb://localhost:27017"   # required
    database: ""                       # required
    username: ""                       # default ""
    password: ""                       # default "" (secret)
    app_name: "benthos"                # default "benthos" (advanced)

    # --- Collections ---
    collections: []                    # required; at least one entry

    # --- Checkpointing (resume token) ---
    checkpoint_cache: ""              # required — name of a cache resource
    checkpoint_key: "mongodb_cdc_checkpoint"  # default
    checkpoint_interval: "5s"         # default
    checkpoint_limit: 1000            # default

    # --- Streaming ---
    read_batch_size: 1000             # default
    read_max_wait: "1s"               # default

    # --- Snapshot ---
    stream_snapshot: false            # default
    snapshot_parallelism: 1           # default (advanced)
    snapshot_auto_bucket_sharding: false  # default (advanced)

    # --- Document format ---
    document_mode: "update_lookup"    # default (advanced)
    json_marshal_mode: "canonical"    # default (advanced)

    # --- Back-pressure ---
    auto_replay_nacks: true           # default
```

---

## Field-by-field reference

### `url`

**Type**: `string` | **Required**: yes | **Default**: none (example: `mongodb://localhost:27017`)

The MongoDB connection URI. Include replica set name for direct replica set
connections: `mongodb://host:27017/?replicaSet=rs0`. For Atlas, use the
`mongodb+srv://` SRV URI format.

The driver is configured with:
- `ConnectTimeout`: 10 seconds
- `ServerSelectionTimeout`: 30 seconds
- `Timeout` (operation): 30 seconds

```yaml
# Self-managed replica set
url: "mongodb://cdc_user:secret@mongo1:27017,mongo2:27017,mongo3:27017/?replicaSet=rs0"

# MongoDB Atlas (SRV)
url: "mongodb+srv://cdc_user:secret@cluster0.abc123.mongodb.net/?retryWrites=true"
```

---

### `database`

**Type**: `string` | **Required**: yes | **Default**: none

The name of the MongoDB database to watch. Change Streams are opened at the
database level, then filtered to the configured `collections`.

---

### `username`

**Type**: `string` | **Required**: no | **Default**: `""`

The username for MongoDB authentication. When both `username` and `password` are
non-empty, the driver applies credential-based auth. If your URI already includes
credentials in the `url` field, leave these fields empty.

---

### `password`

**Type**: `string` | **Required**: no | **Default**: `""` | **Secret**: yes

The password for MongoDB authentication. Mark as a secret (do not commit plain
text to config files; use `${MONGO_PASSWORD}` environment variable interpolation
or a Connect secret store).

---

### `app_name`

**Type**: `string` | **Required**: no | **Default**: `"benthos"` | **Advanced**

The MongoDB client application name sent in the `hello` handshake. Visible in
`db.currentOp()` and Atlas monitoring. Override to identify your pipeline.

---

### `collections`

**Type**: `array of string` | **Required**: yes | **Default**: none

A list of one or more collection names to stream changes from. The connector
returns an error if this list is empty.

The change stream is filtered server-side to only these collections:
```go
filter := []bson.M{{"$match": bson.M{
    "ns.coll": bson.M{"$in": slices.Clone(m.collections)},
}}}
```

```yaml
collections:
  - orders
  - customers
  - inventory
```

---

### `checkpoint_cache`

**Type**: `string` | **Required**: yes | **Default**: none

The name of a cache resource defined in `cache_resources`. The connector stores
the MongoDB **resume token** (BSON Extended JSON) in this cache under the
`checkpoint_key`. If the named cache does not exist at startup, the connector
returns an error.

The cache must outlive the process for restarts to resume correctly. Use a
persistent backend (Redis, MongoDB cache) in production. A `memory` cache resets
on process restart, forcing a full re-snapshot on the next start.

```yaml
cache_resources:
  - label: mongo_checkpoint
    redis:
      url: redis://localhost:6379
```

---

### `checkpoint_key`

**Type**: `string` | **Required**: no | **Default**: `"mongodb_cdc_checkpoint"`

The key name used within the cache to store the resume token. If you run
multiple `mongodb_cdc` pipelines against different databases or pipelines,
give each a unique key to avoid collisions.

---

### `checkpoint_interval`

**Type**: `string` (duration) | **Required**: no | **Default**: `"5s"`

How often the connector flushes the latest resume token to the cache. The token
is only written if it has changed since the last flush.

A shorter interval reduces the reprocessing window after an unclean restart (at
the cost of more cache writes). The connector always writes the token on clean
shutdown regardless of this interval.

Set to `"0s"` to write the token synchronously on every acknowledged batch
(highest durability, highest write amplification).

---

### `checkpoint_limit`

**Type**: `int` | **Required**: no | **Default**: `1000`

Maximum number of in-flight (unacknowledged) messages before the connector
pauses reading from the change stream. This bounds memory usage. When all
`checkpoint_limit` slots are occupied, the connector blocks until downstream
acknowledges some messages.

---

### `read_batch_size`

**Type**: `int` | **Required**: no | **Default**: `1000`

The MongoDB cursor batch size — how many documents MongoDB returns per network
round trip on both the snapshot cursor and the change stream cursor. Larger
values reduce round trips but increase per-batch memory usage.

---

### `read_max_wait`

**Type**: `string` (duration) | **Required**: no | **Default**: `"1s"`

The `maxAwaitTimeMS` option on the change stream cursor. MongoDB waits up to
this duration to fill a batch of `read_batch_size` events before returning. A
longer value reduces empty round trips during low-activity periods. The
connector uses `TryNext` in a polling loop to avoid driver-level timeout
interference.

---

### `stream_snapshot`

**Type**: `bool` | **Required**: no | **Default**: `false`

When `true` and no resume token is found in the cache, the connector first
reads all existing documents from each configured collection (emitting them
with `operation = "read"`), then switches to live change streaming.

When `false` (default), only live changes after the connector starts are
captured — documents that existed before the pipeline started are skipped.

**Snapshot is skipped entirely** when a resume token exists in the cache,
regardless of this setting.

---

### `snapshot_parallelism`

**Type**: `int` | **Required**: no | **Default**: `1` | **Advanced**
**Lint rule**: must be ≥ 1.

Controls intra-collection snapshot parallelism. All configured collections are
always snapshotted concurrently (one goroutine per collection) regardless of
this setting. This field controls how each individual collection is read:

- `1` (default): a single sequential cursor scan per collection.
- `> 1`: each collection is split into `snapshot_parallelism` `_id`-range
  buckets, each read in parallel.

Parallel range splitting uses `splitVector` by default (self-managed clusters;
requires the `clusterManager` role). On Atlas (where `splitVector` is
unavailable), set `snapshot_auto_bucket_sharding: true` to use `$bucketAuto`
instead.

---

### `snapshot_auto_bucket_sharding`

**Type**: `bool` | **Required**: no | **Default**: `false` | **Advanced**

When `true`, parallel snapshot range computation uses `$bucketAuto` aggregation
instead of the `splitVector` command. Required for **MongoDB Atlas** where
`splitVector` requires privileged admin access that Atlas does not expose.

Only takes effect when `snapshot_parallelism > 1`.

---

### `document_mode`

**Type**: `string` (enum) | **Required**: no | **Default**: `"update_lookup"` | **Advanced**

Controls how update and delete events are emitted. Has no effect on `insert`
or `replace` events (which always carry the full document).

| Value | Updates | Deletes |
|---|---|---|
| `update_lookup` | Full post-update document (via MongoDB `UpdateLookup`). If the document is deleted before lookup completes, falls back to emitting only `documentKey`. | Only `_id` (documentKey). |
| `pre_and_post_images` | Full document before and after the change (requires MongoDB 6.0+ and `changeStreamPreAndPostImages` enabled on each collection). | Full document before deletion. |
| `partial_update` | Structured diff: `{"_id": ..., "operations": [{"path": [...], "type": "set"|"unset"|"truncatedArray", "value": ...}]}`. Uses `showExpandedEvents` on MongoDB 6.1+. | Only `documentKey`. |

**Note**: `pre_and_post_images` requires enabling this at the collection level:
```javascript
db.runCommand({ collMod: "orders", changeStreamPreAndPostImages: { enabled: true } })
```

---

### `json_marshal_mode`

**Type**: `string` (enum) | **Required**: no | **Default**: `"canonical"` | **Advanced**

Controls how BSON values are serialised to JSON in the message body.

| Value | Description |
|---|---|
| `canonical` | Type-preserving Extended JSON. BSON types like `ObjectId`, `Date`, `Binary`, and `Timestamp` are wrapped: `{"$oid": "..."}`, `{"$date": ...}`, etc. Roundtrip-safe back to BSON. **`Decimal128` is not wrapped — see note below.** |
| `relaxed` | Human-readable JSON. Numbers are plain JSON numbers, dates are ISO 8601 strings. May lose precision for 64-bit integers. |

**`Decimal128` in both modes**: `Decimal128` values are normalised to plain
decimal strings (e.g. `"99.95"`) before serialisation in both `canonical` and
`relaxed` modes. The `{"$numberDecimal": "..."}` ExtJSON wrapper is never
produced. This matches the `schema.BigDecimal` value contract in the connector
source (`normaliseDecimal128` in `schema.go`).

---

### `auto_replay_nacks`

**Type**: `bool` | **Required**: no | **Default**: `true`

When `true`, messages rejected (nacked) by the output are automatically
replayed indefinitely, applying back-pressure if the rejection is persistent.
Set to `false` to drop nacked messages instead (reduces memory usage in
high-throughput pipelines at the cost of potential data loss on transient
output errors).
