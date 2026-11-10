---
name: connect-cdc-sqlserver
description: >-
  Streams change data capture from Microsoft SQL Server into Redpanda or Kafka with
  the Redpanda Connect microsoft_sql_server_cdc input, which polls SQL Server's
  native CDC change tables in LSN order. Use when configuring or troubleshooting
  microsoft_sql_server_cdc, enabling SQL Server CDC capture instances for it, an
  initial snapshot before streaming, its LSN checkpoint cache, running more than one
  pipeline against a database, or changes that stall, go missing, or replay.
---

# Redpanda Connect CDC: Microsoft SQL Server

`microsoft_sql_server_cdc` streams row changes from SQL Server's CDC change tables, optionally
after a snapshot of existing rows, and stores the last delivered LSN as a checkpoint. It is an
Enterprise connector and needs a Redpanda Enterprise license. The source is public:
`internal/impl/mssqlserver/` in github.com/redpanda-data/connect.

## How to work

**Give each pipeline's built-in checkpoint its own schema.** Without `checkpoint_cache`, the
input keeps its checkpoint in one fixed row of `checkpoint_cache_table_name` and writes it
through a stored procedure, `<schema>.CdcCheckpointCacheUpdate`, that every start re-creates to
point at its own table. Two pipelines whose checkpoint tables share a schema (the default is
`rpcn`) therefore overwrite each other's checkpoints, even with different table names, and
`checkpoint_cache_key` does not help: the built-in cache ignores it. For a second pipeline on
the same database, put its checkpoint table in a different schema (create the schema first and
grant the login rights in it), or in another database with `checkpoint_cache_connection_string`,
or use an external `checkpoint_cache` resource with its own key. Leave the existing pipeline's
checkpoint where it is: moving it discards that pipeline's position.

**Ask before disabling CDC on a table.** SQL Server rejects `TRUNCATE TABLE` on a CDC-enabled
table, and the usual workaround (disable CDC on the table, truncate, re-enable) drops the capture
instance and its change table. Changes the pipeline has not read yet are lost, the pipeline fails
while the change table is missing, and the truncate never reaches Redpanda, so downstream keeps
the old rows. `DELETE` instead streams one delete event per row. Explain both and let the user
choose.

## Use the docs for everything else

For config fields, defaults, metadata keys, ordering, permissions, snapshot isolation, and the
SQL Server setup steps, follow `/redpanda:redpanda-docs`. Use `get_connect_component` for
`microsoft_sql_server_cdc` and its fields, and `ask_redpanda_question` for setup and procedures.
If the Docs MCP server is not available, fetch the Markdown twin of the page:

- https://docs.redpanda.com/connect/components/inputs/microsoft_sql_server_cdc.md

If the server refuses for quota and you can't fetch the page, tell the user to sign in through
`/mcp` rather than answering from memory.
