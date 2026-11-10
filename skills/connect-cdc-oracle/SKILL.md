---
name: connect-cdc-oracle
description: >-
  Streams change data capture from Oracle Database into Redpanda or Kafka with
  the Redpanda Connect oracledb_cdc input, which reads redo logs through
  LogMiner. Use when configuring or troubleshooting oracledb_cdc: ARCHIVELOG
  mode, supplemental logging, LogMiner grants, snapshot_mode and the SCN
  checkpoint, a pluggable database (CDB/PDB), LOB capture, large transactions,
  or errors such as ORA-01291 and "no user tables found".
---

# Redpanda Connect CDC: Oracle

`oracledb_cdc` streams row changes from Oracle through LogMiner, optionally after a snapshot of
existing rows, and tracks its position with an SCN checkpoint. It is an Enterprise connector and
needs a Redpanda Enterprise license. The source is public: `internal/impl/oracledb/` in
github.com/redpanda-data/connect.

## How to work

**On ORA-01291, find the cause before you change anything.** The same error has two causes. Check
`V$DATABASE_INCARNATION` (or `RESETLOGS_TIME` in `V$DATABASE`). If the database was flashed back
and opened with `RESETLOGS` after the last checkpoint, more retention cannot help. The checkpoint
must be cleared, and with the default Oracle-based checkpoint cache the flashback rolled that row
back, so delete it explicitly. Set `snapshot_mode: snapshot_and_stream` in the same change: clearing
the checkpoint alone loses every change since it, and `snapshot_mode` alone does nothing while a
checkpoint exists. Tell the user what deleting the checkpoint does and confirm before you run it.

**When the input finds no user tables, check who owns the tables before grants or patterns.**
Table discovery skips every owner whose name starts with `C##`, so no grant, `include` pattern, or
`pdb_name` change makes a common user's tables capturable. They must live in a local (non-`C##`)
schema inside the PDB. Moving them is a schema change: explain it and leave it to the user.

**When large transactions run the pipeline out of memory, move the buffer; don't cap it.** Point
`logminer.transaction_cache` at a Redis or Memcached cache resource. Do not set
`logminer.max_transaction_events` to bound memory: a transaction over the cap is discarded and its
rows are never emitted. Offer it only with that warning, and only if the user accepts the loss.

## Use the docs for everything else

For config fields, defaults, metadata keys, Oracle setup and grants, snapshot behavior, and
tuning, follow `/redpanda:redpanda-docs`. Use `get_connect_component` for `oracledb_cdc` and its
fields, and `ask_redpanda_question` for setup and procedures. If the Docs MCP server is not
available, fetch the Markdown twin of the page:

- https://docs.redpanda.com/connect/components/inputs/oracledb_cdc.md

If the server refuses for quota and you can't fetch the page, tell the user to sign in through
`/mcp` rather than answering from memory.
