---
name: connect-cdc-salesforce
description: >-
  Streams change data capture and Platform Events from Salesforce into Redpanda
  or Kafka with the Redpanda Connect salesforce_cdc input, which reads the
  Salesforce Pub/Sub API and can snapshot existing records first. Use when
  configuring or troubleshooting salesforce_cdc, the CDC firehose or per-object
  change channels, custom or standard Platform Events, a Connected App with
  OAuth Client Credentials, replay IDs and the checkpoint cache, an initial
  snapshot, or a topic that stopped streaming.
---

# Redpanda Connect CDC: Salesforce

`salesforce_cdc` streams Salesforce change events and Platform Events over the Pub/Sub API,
optionally after a REST snapshot of existing records, and keeps its replay positions in a cache
resource. It is an Enterprise connector and needs a Redpanda Enterprise license. The source is
public: `internal/impl/salesforce/` in github.com/redpanda-data/connect.

## How to work

**Never delete, reset, or rewrite a running pipeline's checkpoint, or change its
`checkpoint_cache_key`, without asking the user first.** The checkpoint holds every topic's replay
position. Without it, each topic resubscribes from `replay_preset`, and with `latest` the changes
made in between are never delivered. This applies when a topic stopped on an event it cannot
decode: keep the checkpoint, explain that skipping the event loses every change since it, and ask
or escalate. To backfill an sObject added to `topics` later (the snapshot runs only once per
checkpoint), read it with a separate one-off pipeline instead.

**Give each `salesforce_cdc` input its own `checkpoint_cache_key` when inputs share a cache.**
The key has a default, so two inputs on one cache overwrite each other's checkpoint unless you set
it. Set the new input's key; don't change the key of an input that is already running.

**With the firehose (`/data/ChangeEvents`), set `stream_snapshot: false` unless the user asked
for existing records.** The snapshot is on by default, and with the firehose it reads every
queryable sObject in the org, not only the CDC-enabled ones. If the user wants a snapshot, list
the sObjects in `topics` instead, or ask.

## Use the docs for everything else

For config fields, defaults, metadata keys, topic forms, Salesforce setup, and Redpanda
destination features, follow `/redpanda:redpanda-docs`. Use `get_connect_component` for
`salesforce_cdc` and its fields, and `ask_redpanda_question` for setup and procedures. If the Docs
MCP server is not available, fetch the Markdown twin of the page:

- https://docs.redpanda.com/connect/components/inputs/salesforce_cdc.md

If the server refuses for quota and you can't fetch the page, tell the user to sign in through
`/mcp` rather than answering from memory.
