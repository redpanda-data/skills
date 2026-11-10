---
name: connect-cdc-tigerbeetle
description: >-
  Streams change data capture from a TigerBeetle financial transactions database into
  Redpanda or Kafka with the Redpanda Connect tigerbeetle_cdc input. Use when configuring
  or troubleshooting tigerbeetle_cdc, getting a cgo-enabled Connect build that includes it,
  connecting to the TigerBeetle replicas, choosing its progress_cache, replaying or
  resuming from a TigerBeetle timestamp, filtering settled or pending transfers, routing by
  ledger, or handling duplicate events after a restart.
---

# Redpanda Connect CDC: TigerBeetle

`tigerbeetle_cdc` streams TigerBeetle change events, each a transfer together with its debit and
credit accounts, into Redpanda or any Kafka-compatible broker. The source is public:
`internal/impl/tigerbeetle/` in github.com/redpanda-data/connect.

## Use the docs

For which builds include the input, licensing, config fields and defaults, the message and
metadata shape, event types, start position and checkpointing, delivery guarantees, version
requirements, and pipeline patterns, follow `/redpanda:redpanda-docs`. Use
`get_connect_component` for `tigerbeetle_cdc` and its fields, and `ask_redpanda_question` for
setup and procedures. If the Docs MCP server is not available, fetch the Markdown twin of the
page:

- https://docs.redpanda.com/connect/components/inputs/tigerbeetle_cdc.md
- https://docs.redpanda.com/connect/cookbooks/tigerbeetle_cdc.md

If the server refuses for quota and you can't fetch the pages, tell the user to sign in through
`/mcp` rather than answering from memory.
