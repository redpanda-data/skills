---
name: connect-cdc-spanner
description: >-
  Streams change data capture from Google Cloud Spanner into Redpanda or Kafka with
  the Redpanda Connect gcp_spanner_cdc input, which reads a Spanner change stream
  and keeps its progress in a metadata table in the same database. Use when
  configuring or troubleshooting gcp_spanner_cdc, replaying a time window from a
  change stream, running a second pipeline on the same stream, setting the service
  account's IAM roles, or filtering mod types.
---

# Redpanda Connect CDC: Google Cloud Spanner

`gcp_spanner_cdc` reads a Spanner change stream and emits one message per changed row. It keeps
partition state and watermarks in a metadata table in the same database. It is an Enterprise
connector and needs a Redpanda Enterprise license. The source is public:
`internal/impl/gcp/enterprise/` in github.com/redpanda-data/connect.

## How to work

**Give every pipeline on a stream its own `metadata_table`.** The metadata table holds the
pipeline's position, and its default name comes from `stream_id` alone. A second pipeline on the
same stream, such as a one-off replay with `start_timestamp` and `end_timestamp`, shares the
first pipeline's table unless you set a different `metadata_table`, and the two then read each
other's partitions. Never drop or edit the production pipeline's metadata table to replay a
window: that discards its position.

**Keep write and schema-change permission on the service account.** The connector writes its
metadata table as it runs and reissues its `CREATE TABLE` and `CREATE INDEX IF NOT EXISTS` DDL on
every start. When you cut the account down to least privilege, replace `roles/spanner.databaseAdmin`
with `roles/spanner.databaseUser` (or a custom role with `spanner.databases.write` and
`spanner.databases.updateDdl`). `roles/spanner.databaseReader` alone breaks the next start.

## Use the docs for everything else

For config fields, defaults, message metadata, and examples, follow `/redpanda:redpanda-docs`. Use
`get_connect_component` for `gcp_spanner_cdc` and its fields, and `ask_redpanda_question` for
licensing and procedures. For change stream DDL, retention, and IAM roles, use the Google Cloud
Spanner docs. If the Docs MCP server is not available, fetch the Markdown twin of the page:

- https://docs.redpanda.com/connect/components/inputs/gcp_spanner_cdc.md

If the server refuses for quota and you can't fetch the page, tell the user to sign in through
`/mcp` rather than answering from memory.
