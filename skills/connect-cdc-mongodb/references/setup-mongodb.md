# Setting Up MongoDB for CDC

This page covers everything you need to do on the MongoDB side before running
`mongodb_cdc`. All requirements are grounded in
`connect/internal/impl/mongodb/cdc/input.go`.

---

## Topology Requirement: Replica Set or Sharded Cluster

**MongoDB Change Streams require a replica set or sharded cluster.** A standalone
`mongod` instance does not support Change Streams. The connector enforces this:
it runs `db.runCommand({hello: 1})` on startup and checks for
`lastWrite.majorityOpTime.ts` (replica set) or `msg == "isdbgrid"` (sharded
mongos). If the `hello` command itself fails (e.g. auth error or wrong topology):

```
unable to determine replication info (is your mongodb instance running as a replication set?)
```

If `hello` succeeds but neither `lastWrite.majorityOpTime.ts` nor the `isdbgrid`
marker is present (e.g. a standalone `mongod`):

```
unable to get oplog last commit timestamp, got <server response>
```

### Initiate a replica set (self-managed)

```bash
# Start mongod with replica set name
mongod --replSet rs0 --port 27017 --dbpath /var/lib/mongodb

# Initiate (run once on primary)
mongosh --port 27017
rs.initiate({
  _id: "rs0",
  members: [
    { _id: 0, host: "mongo1:27017" },
    { _id: 1, host: "mongo2:27017" },
    { _id: 2, host: "mongo3:27017" }
  ]
})

# Verify
rs.status()
```

### Docker Compose: single-node replica set (development)

```yaml
# docker-compose.yml
services:
  mongo:
    image: mongo:7
    command: ["--replSet", "rs0", "--bind_ip_all"]
    ports:
      - "27017:27017"
    healthcheck:
      test: echo 'rs.initiate()' | mongosh --quiet
      interval: 5s
      retries: 5
      start_period: 10s

  mongo-init:
    image: mongo:7
    depends_on:
      mongo:
        condition: service_healthy
    command: >
      mongosh --host mongo:27017 --eval '
        rs.status().ok || rs.initiate({
          _id: "rs0",
          members: [{ _id: 0, host: "mongo:27017" }]
        })'
    restart: "no"
```

Connect with: `mongodb://localhost:27017/?replicaSet=rs0`

---

## MongoDB Version

The connector checks the server version at startup:

```go
if version.Major() < 4 {
    return fmt.Errorf("`mongodc_cdc` requires MongoDB version 4 or higher - current version: %v", version.String())
}
```

**Minimum: MongoDB 4.0.** For `pre_and_post_images` document mode, MongoDB 6.0+
is required — the `changeStreamPreAndPostImages` collection option that drives
`FullDocumentBeforeChange(Required)` was introduced in 6.0. Use
`document_mode: update_lookup` on MongoDB 4.x–5.x instead.
For `partial_update` with `showExpandedEvents`, MongoDB 6.1+ is required.

---

## User Privileges

The minimum grant required for the default (single-collection, sequential
snapshot) path is the built-in `read` role on the target database. This role
covers all actions the connector needs:

| Action / Role | Why needed | How to grant |
|---|---|---|
| `read` role on the target database | Covers `find` (snapshot), `listCollections` (schema discovery), and the `changeStream` action (`db.watch()`) | `{ role: "read", db: "mydb" }` |
| `clusterManager` role on `admin` (**optional**, parallel snapshots only) | Required for the `splitVector` command used when `snapshot_parallelism > 1` on self-managed clusters. Not needed when `snapshot_auto_bucket_sharding: true` (uses `$bucketAuto` instead). | `{ role: "clusterManager", db: "admin" }` |
| `clusterMonitor` role on `admin` (**optional**) | The `hello` and `buildInfo` commands used at startup are available to all authenticated users and do not require this role. Add it only if your hardened config explicitly denies `hello` to normal users. | `{ role: "clusterMonitor", db: "admin" }` |

**The `changeStream` action is not a separate role** — it is an action already
included in the `read` built-in role on MongoDB 4.0+.

### Create a CDC user (default path)

```javascript
// Connect as admin
use admin

// read on the target DB covers find + listCollections + changeStream action
db.createUser({
  user: "cdc_user",
  pwd:  "strong_password",
  roles: [
    { role: "read", db: "mydb" }
  ]
})
```

### Create a CDC user (parallel snapshot with splitVector)

```javascript
use admin

db.createUser({
  user: "cdc_user",
  pwd:  "strong_password",
  roles: [
    { role: "read",           db: "mydb" },
    { role: "clusterManager", db: "admin" }  // needed for splitVector
  ]
})
```

Alternatively, avoid `clusterManager` entirely by setting
`snapshot_auto_bucket_sharding: true` in the connector config — this switches
to `$bucketAuto` for range computation (supported by Atlas and self-managed).

### Sharded cluster users

On a sharded cluster (mongos), the connector uses `getCurrentResumeToken` to
determine the initial stream position instead of the oplog timestamp. The same
`read` privilege on the target database is sufficient.

---

## Atlas-Specific Notes

### Connection string

Use the `mongodb+srv://` SRV format provided by Atlas:

```yaml
url: "mongodb+srv://cdc_user:secret@cluster0.abc123.mongodb.net/?retryWrites=true&w=majority"
```

### Snapshot parallelism

Atlas does not expose the `splitVector` command. When using
`snapshot_parallelism > 1`, set `snapshot_auto_bucket_sharding: true` in
the connector config to use `$bucketAuto` aggregation instead:

```yaml
snapshot_parallelism: 4
snapshot_auto_bucket_sharding: true
```

### Built-in Atlas roles

| Atlas role | Sufficient for CDC? |
|---|---|
| `readAnyDatabase` | Yes — covers `find` + Change Streams on all databases |
| `read` (per database) | Yes — covers the target database |
| `atlasAdmin` | Yes (overkill for CDC) |

---

## Pre and Post Images (document_mode: pre_and_post_images)

To capture full documents on update and delete events without a lookup,
enable `changeStreamPreAndPostImages` on each watched collection:

```javascript
// Enable on a collection
db.runCommand({
  collMod: "orders",
  changeStreamPreAndPostImages: { enabled: true }
})

// Verify
db.getCollectionInfos({ name: "orders" })[0].options
// Should include: changeStreamPreAndPostImages: { enabled: true }
```

This feature requires **MongoDB 6.0+**. The `changeStreamPreAndPostImages`
collection option (which enables `FullDocumentBeforeChange`) was introduced in
MongoDB 6.0. On MongoDB 4.x–5.x, use `document_mode: update_lookup` instead.

---

## $jsonSchema Validators (recommended for schema stability)

When a collection has a `$jsonSchema` validator, `mongodb_cdc` uses it to
populate the `schema` message metadata with accurate type information. Without
a validator, schema is inferred from the first document seen per collection
(all fields marked optional).

For schema registry targets with compatibility checking, a validator prevents
frequent schema version bumps caused by documents with varying field sets:

```javascript
db.createCollection("orders", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["_id", "customer_id", "amount", "status", "created_at"],
      properties: {
        _id:         { bsonType: "objectId" },
        customer_id: { bsonType: "string" },
        amount:      { bsonType: "decimal" },
        status:      { bsonType: "string", enum: ["pending", "paid", "cancelled"] },
        created_at:  { bsonType: "date" }
      }
    }
  }
})
```

---

## Oplog Retention

The resume token references a position in the oplog. If the pipeline is
stopped for longer than the oplog retention window, the stored token becomes
stale and the connector will fail to resume.

Default oplog retention:
- **Atlas**: 24 hours (configurable via Atlas UI: Cluster → Additional Settings → Minimum Oplog Window)
- **Self-managed**: oplog is capped at 5% of available disk by default; set a minimum retention with `--oplogMinRetentionHours`:

```bash
mongod --replSet rs0 --oplogMinRetentionHours 72 ...
```

Or via `mongosh`:
```javascript
db.adminCommand({ replSetResizeOplog: 1, minRetentionHours: 72 })
```

If the token expires, delete the cache entry and restart with
`stream_snapshot: true` to re-snapshot.

---

## Connection URI Options

| Option | Purpose | Example |
|---|---|---|
| `replicaSet=<name>` | Direct replica set connection | `?replicaSet=rs0` |
| `authSource=<db>` | Auth database (default: `admin`) | `?authSource=admin` |
| `tls=true` | Enable TLS | `?tls=true` |
| `tlsCAFile=<path>` | CA certificate | `?tlsCAFile=/etc/ssl/ca.pem` |
| `retryWrites=true` | Enable retryable writes | `?retryWrites=true` |
| `w=majority` | Write concern | `?w=majority` |

Full example:
```yaml
url: "mongodb://cdc_user:secret@mongo1:27017,mongo2:27017/?replicaSet=rs0&authSource=admin&tls=true"
```
