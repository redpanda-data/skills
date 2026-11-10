---
name: connect-cdc-dynamodb
description: >-
  Streams change data capture from AWS DynamoDB into Redpanda or Kafka with the
  Redpanda Connect aws_dynamodb_cdc input, which reads DynamoDB Streams. Use when
  configuring or troubleshooting aws_dynamodb_cdc, enabling DynamoDB Streams, IAM
  permissions, the checkpoint table and checkpoint_namespace, snapshot_and_cdc or
  snapshot_only backfills, tag-based or multi-table discovery, start_from, rejected
  messages and auto_replay_nacks, or the 24-hour stream retention window.
---

# Redpanda Connect CDC: AWS DynamoDB

`aws_dynamodb_cdc` reads item changes from DynamoDB Streams, optionally after a Scan snapshot of
existing items, and keeps its position in a DynamoDB checkpoint table. Redpanda classifies it as an
Enterprise connector. The source is public: `internal/impl/aws/dynamodb/` in
github.com/redpanda-data/connect.

## How to work

**Ask before changing or removing `checkpoint_namespace`.** The namespace is part of the checkpoint
key, so a new or empty namespace has no checkpoints and the pipeline starts fresh from
`start_from`. With `start_from: latest`, it skips every change it has not read yet; with
`trim_horizon`, it replays the whole 24-hour stream. A rename is never cosmetic. Explain this and
get the user's go-ahead first, or keep the existing namespace.

**Never set `auto_replay_nacks: false` to save memory unless the user accepts losing data.** With
it off, messages the output rejects are deleted. To cut memory, tune other settings and leave nack
replay on.

## Use the docs for everything else

For config fields, defaults, IAM permissions, snapshot modes, table discovery, metadata, metrics,
and DynamoDB Streams setup, follow `/redpanda:redpanda-docs`. Use `get_connect_component` for
`aws_dynamodb_cdc` and its fields, and `ask_redpanda_question` for procedures. If the Docs MCP
server is not available, fetch the Markdown twin of the page:

- https://docs.redpanda.com/connect/components/inputs/aws_dynamodb_cdc.md

If the server refuses for quota and you can't fetch the page, tell the user to sign in through
`/mcp` rather than answering from memory.
