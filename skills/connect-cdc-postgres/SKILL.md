---
name: connect-cdc-postgres
description: >-
  Streams change data capture from PostgreSQL into Redpanda or Kafka with the
  Redpanda Connect postgres_cdc input, which reads the WAL through logical
  replication. Use when configuring or troubleshooting postgres_cdc (formerly
  pg_stream), its replication slot and publication, an initial or incremental
  snapshot, control signals, or WAL that PostgreSQL cannot reclaim.
---

# Redpanda Connect CDC: PostgreSQL

`postgres_cdc` streams row changes from PostgreSQL over logical replication (`pgoutput`), optionally
after a snapshot of existing rows. It is an Enterprise connector and needs a Redpanda Enterprise
license. The source is public: `internal/impl/postgresql/` in github.com/redpanda-data/connect.

## How to work

**Backfill with a signal, never by dropping the slot.** `stream_snapshot` runs only when the slot
does not exist yet, so adding a table to `tables` and restarting streams its new changes but not its
existing rows. Do not drop the slot to force a re-snapshot: that discards the stream position and
re-reads every table. Instead, with `incremental_snapshot.enabled`, a `signal_table_name`, and the
table in `tables`, insert a signal row:

```sql
INSERT INTO <schema>.<signal_table> (type, data)
VALUES ('snapshot-execute', '{"tables": ["shipments"]}');
```

Table names in `data` have no schema prefix; they resolve against `schema`. The type is
`snapshot-execute`, not Debezium's `execute-snapshot`, and the key is `tables`, not
`data-collections`. If the config lacks incremental snapshots, propose that change; it is
incompatible with `stream_snapshot: true`.

**Before signaling, or when a signal was rejected, check the table in this order.** A rejected
signal is only logged; replication continues and nothing else reports it.

1. It is in `tables`, or `tables` is empty.
2. It has a primary key, and no key column is `bytea`, `interval`, `bit`, `bit varying`, or a range
   or multirange type (check `format_type` of the key columns, not just that a key exists). No
   setting works around a rejected key type; changing the key is a schema change, so stop and ask
   the user.
3. If it is partitioned, `pglog_stream_<slot_name>` has `publish_via_partition_root = true`.
4. If it has large (TOASTable) columns, set `REPLICA IDENTITY FULL` for the backfill, or updates
   during the backfill can deliver only the `unchanged_toast_value` placeholder.

A table that already finished is skipped. To read it again, point
`incremental_snapshot.checkpoint_cache_key` at a fresh key or clear that entry in the checkpoint
cache; the signal payload has no force option.

**Choose `batch_transactions` or a `batching` policy, never both.** The input rejects the
combination at startup.

## Use the docs for everything else

For config fields, defaults, metadata keys, signal table columns, PostgreSQL setup, and cloud
provider steps, follow `/redpanda:redpanda-docs`. Use `get_connect_component` for `postgres_cdc`
and its fields, and `ask_redpanda_question` for setup and procedures. If the Docs MCP server is not
available, fetch the Markdown twin of the page:

- https://docs.redpanda.com/connect/components/inputs/postgres_cdc.md
