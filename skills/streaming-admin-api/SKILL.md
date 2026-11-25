---
name: streaming-admin-api
description: >-
  Operate a self-managed Redpanda cluster through its HTTP Admin API (port 9644)
  and its ConnectRPC services, and look up endpoints, request bodies and auth
  levels in the Redpanda docs. Use when calling the Admin API directly with curl
  or a script instead of rpk: brokers and decommissioning, maintenance mode and
  restarts, partitions and replica moves, cluster config, health, licensing and
  enterprise features, security users and RBAC roles, debug endpoints and debug
  bundles, and Shadow Linking (ShadowLinkService create, update, failover) for
  disaster recovery. For the same tasks with rpk, see /redpanda:rpk-cluster,
  and for troubleshooting, see /redpanda:streaming-debugging.
---

# Redpanda Admin API

The Admin API is the HTTP management interface every Redpanda broker serves,
with the legacy `/v1` REST endpoints and the newer ConnectRPC services on the
same port. rpk uses it for cluster operations. This skill keeps only the
product-specific procedure below. Look up everything else in the docs (last
section).

## How to work

**Before you restart a broker, run the pre-restart probe on that broker.** Send
`GET /v1/broker/pre_restart_probe` to the broker you will restart, not to another
broker or a load balancer, because it reports the risks of restarting the broker
that answers. If it lists any partition (for example replication-factor-1
partitions that go offline, which maintenance mode can't drain), tell the user
which partitions and what happens to them, and get their go-ahead before the
restart, even when they asked for the restart.

**When failing over a shadow link, name the scope exactly.** A `FailOver` request
without `shadow_topic_name` fails over the whole link, and the Admin API ignores a
JSON field it doesn't recognize, so a misspelled field also fails over the whole
link and still returns 200. Failover can't be undone: a failed-over topic stops
replicating. Check the field name in the reference, and if the user hasn't said
which topics to fail over, ask.

**To remove an entry from a list in a shadow link, don't name the list in
`update_mask`.** An `UpdateShadowLink` whose mask names a repeated field, such as a
topic filter list, appends what you send to the existing entries. Read the link
with `GetShadowLink` first, then send the whole parent message with the mask on
the parent (for example `configurations.topic_metadata_sync_options`), or the
full configuration with no mask. Fields you leave out are reset. Check the
returned link to confirm the list.

## Use the docs for everything else

Look up endpoints, methods, request and response bodies, auth levels, cluster
properties, and procedures in the Redpanda docs instead of from memory:

- Follow `/redpanda:redpanda-docs`. Use `search_api_reference`,
  `list_api_reference_pages` and `get_api_reference_content` for the Admin API
  reference, `get_config_property` for one cluster property, and
  `ask_redpanda_question` for everything else.
- Most useful pages: the Admin API reference at
  https://docs.redpanda.com/api/doc/admin/ (legacy `/v1` endpoints) and
  https://docs.redpanda.com/api/doc/admin/v2/ (ConnectRPC services), the Admin
  API guide at
  https://docs.redpanda.com/streaming/current/manage/use-admin-api/, and the
  cluster properties reference at
  https://docs.redpanda.com/streaming/current/reference/properties/cluster-properties/.
  Swap `current` for the user's version.

If the Docs MCP server refuses for quota and you can't fetch the page, tell the
user to sign in through `/mcp` rather than answering from memory.

The cluster itself is the live check for its version: `GET /v1/cluster_config/schema`
describes every cluster property it accepts.
