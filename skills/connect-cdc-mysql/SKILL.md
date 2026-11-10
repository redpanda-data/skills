---
name: connect-cdc-mysql
description: >-
  Streams change data capture from MySQL or MariaDB into Redpanda or Kafka with the
  Redpanda Connect mysql_cdc input, which reads the binlog. Use when configuring or
  troubleshooting mysql_cdc, its initial snapshot and table lock, its checkpoint_cache
  and checkpoint_key, binlog retention or a purged binlog (error 1236), a primary
  failover, AWS RDS or Aurora with IAM auth, or routing per-table changes to topics.
---

# Redpanda Connect CDC: MySQL

`mysql_cdc` streams row changes from MySQL and MariaDB through the binlog, optionally after a
snapshot of existing rows. It is an Enterprise connector and needs a Redpanda Enterprise license.
The source is public: `internal/impl/mysql/` in github.com/redpanda-data/connect.

## How to work

**Before starting a pipeline that will snapshot, check for open transactions on its tables.** The
snapshot runs when `stream_snapshot` is `true` and the checkpoint cache holds no position. It starts
with `FLUSH TABLES <tables> WITH READ LOCK`, which waits for every transaction that has one of those
tables open, and while it waits, other sessions' queries on those tables queue behind it. On a live
primary, first look for long-running transactions and the locks they hold
(`information_schema.innodb_trx`, `performance_schema.metadata_locks`, the process list). If one
touches a listed table, don't start the pipeline. Tell the user, and let them choose: wait for it to
finish, approve ending that session, or start at a quieter time. Never kill another session
yourself.

**When the stored binlog position is gone, let the user choose how to recover.** After downtime
longer than the server keeps binlogs (MySQL error 1236), or after a failover to a server with other
binlog files, the input does not recover on its own. It does not fall back to a snapshot or to the
current position, and the changes in purged files cannot be streamed any more. Do not clear,
overwrite, or re-key the checkpoint yourself. Confirm the cause (compare the stored position with
`SHOW BINARY LOGS`), then explain the two choices and ask:

- Clear the checkpoint with `stream_snapshot: true`: a new snapshot re-sends every row.
- Clear it with `stream_snapshot: false`: streaming starts at the current position and skips the gap.

## Use the docs for everything else

For config fields, defaults, metadata keys, type mapping, MySQL setup, and IAM auth, follow
`/redpanda:redpanda-docs`. Use `get_connect_component` for `mysql_cdc` and its fields, and
`ask_redpanda_question` for setup and procedures. If the Docs MCP server is not available, fetch
the Markdown twin of the page:

- https://docs.redpanda.com/connect/components/inputs/mysql_cdc.md

If the server refuses for quota and you can't fetch the page, tell the user to sign in through
`/mcp` rather than answering from memory.
