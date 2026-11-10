---
name: connect-cdc-mongodb
description: >-
  Streams change data capture from MongoDB into Redpanda or Kafka with the
  Redpanda Connect mongodb_cdc input, which reads MongoDB change streams on a
  replica set or sharded cluster. Use when configuring or troubleshooting
  mongodb_cdc, its initial or incremental snapshot, backfilling a collection
  with a signal, resume positions in the checkpoint cache, a position that aged
  out of the oplog, document modes, or AWS IAM authentication to Atlas.
---

# Redpanda Connect CDC: MongoDB

`mongodb_cdc` streams document changes from MongoDB change streams, optionally after a snapshot of
existing documents. It is an Enterprise connector and needs a Redpanda Enterprise license. The
source is public: `internal/impl/mongodb/cdc/` in github.com/redpanda-data/connect.

## How to work

**Backfill a collection with a signal, never by clearing the checkpoint.** `stream_snapshot` runs
only when no stream position is stored, so a collection added to `collections` later streams its
new changes but not its existing documents. Turning on `incremental_snapshot.enabled` in a pipeline
that already has a stored position reads nothing. Do not delete the checkpoint cache entry, change
`checkpoint_key`, or rewrite the documents to force change events. Instead, set
`signal_collection_name` to a collection that is not in `collections`, keep the collection to read
in `collections`, and insert a signal into the signal collection:

```javascript
db.<signal_collection>.insertOne({ type: "snapshot-execute", data: { collections: ["<collection>"] } })
```

This works in every snapshot mode.

**When the stored position can no longer be resumed and no snapshot is enabled, don't skip the gap
on your own.** Setting `on_unresumable_position: reset`, or deleting the checkpoint while both
snapshot modes are off, restarts streaming from the current oplog position and silently drops every
change made in between. Enable `stream_snapshot` (or `incremental_snapshot.enabled`) so recovery
re-reads the documents, or ask the user to choose.

**When a parallel snapshot is slow, read the logs before raising `snapshot_parallelism`.** If the
input logs that it could not determine split points and fell back to a sequential scan, the split
command was refused, as it is on MongoDB Atlas. Set `snapshot_auto_bucket_sharding: true` there.

## Use the docs for everything else

For config fields, defaults, metadata, schema detection, signals, incremental snapshots, AWS IAM
authentication, and MongoDB setup, follow `/redpanda:redpanda-docs`. Use `get_connect_component`
for `mongodb_cdc` and its fields, and `ask_redpanda_question` for setup and procedures. If the Docs
MCP server is not available, fetch the Markdown twin of the page:

- https://docs.redpanda.com/connect/components/inputs/mongodb_cdc.md

If the server refuses for quota and you can't fetch the page, tell the user to sign in through
`/mcp` rather than answering from memory.
