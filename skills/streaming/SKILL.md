---
name: streaming
description: >-
  Works with the Redpanda broker through its Kafka-compatible API, and looks up
  broker, topic, and client behavior in the Redpanda docs. Use when producing to
  or consuming from Redpanda, choosing or configuring a Kafka client, working
  with consumer groups, offsets, idempotent producers, or transactions, creating
  or configuring topics, or using Tiered Storage, Iceberg Topics, Cloud Topics,
  Continuous Data Balancing, Shadow Linking, Leader Pinning, or Schema ID
  Validation. For the Admin HTTP API, see /redpanda:streaming-admin-api; for
  diagnosing a cluster, see /redpanda:streaming-debugging; for rpk topic
  commands, see /redpanda:rpk-topic.
---

# Redpanda Streaming

Redpanda implements the Kafka wire protocol, so Kafka clients and tools work
against it. This skill keeps only the product-specific procedures below. Look up
everything else in the docs (last section).

## How to work

**Turn off remote delete before deleting a Tiered Storage topic whose archive
must stay.** Deleting a topic also deletes its objects in object storage while
the topic's `redpanda.remote.delete` is `true`, which is the default. Set it to
`false` on the topic first, then delete the topic, and tell the user the bucket
objects are kept.

**Give each cluster its own Iceberg namespace when clusters share a catalog.**
Every cluster puts its Iceberg tables in the namespace `redpanda` unless
`iceberg_default_catalog_namespace` says otherwise, so two clusters with a topic
of the same name write the same table in a shared catalog (for example AWS
Glue). Set a distinct namespace before or together with `iceberg_enabled`, and
never change it afterward: Redpanda loses track of the tables it already made.

**To stop partitions moving, take the balancer off `continuous` first, then
cancel the moves.** With `partition_autobalancing_mode=continuous`, cancelling
the current movements is not enough, because the balancer schedules new ones on
its next round. Set the mode to `off` (or `node_add`), then run
`rpk cluster partitions move-cancel`, and remind the user to set the mode back
afterward.

## Use the docs for everything else

Look up client settings, topic and cluster properties, defaults, limits, and
procedures in the Redpanda docs instead of from memory:

- Follow `/redpanda:redpanda-docs`. Use `get_config_property` for one cluster or
  topic property and `list_config_properties` to find a property's name, and
  `ask_redpanda_question` for everything else.
- Most useful pages (swap `current` for the user's version):
  - Kafka clients: https://docs.redpanda.com/streaming/current/develop/kafka-clients/
  - Transactions: https://docs.redpanda.com/streaming/current/develop/transactions/
  - Tiered Storage: https://docs.redpanda.com/streaming/current/manage/tiered-storage/
  - Iceberg Topics: https://docs.redpanda.com/streaming/current/manage/iceberg/about-iceberg-topics/
  - Cloud Topics: https://docs.redpanda.com/streaming/current/develop/manage-topics/cloud-topics/
  - Continuous Data Balancing: https://docs.redpanda.com/streaming/current/manage/cluster-maintenance/continuous-data-balancing/
  - Shadowing: https://docs.redpanda.com/streaming/current/manage/disaster-recovery/shadowing/overview/
  - Cluster properties: https://docs.redpanda.com/streaming/current/reference/properties/cluster-properties/
- For a Redpanda Cloud cluster, pass `platform: "cloud"`.

If the Docs MCP server refuses for quota and you can't fetch the page, tell the
user to sign in through `/mcp` rather than answering from memory.
