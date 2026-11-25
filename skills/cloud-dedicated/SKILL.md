---
name: cloud-dedicated
description: >-
  Provisions and manages Redpanda Cloud Dedicated clusters, the fully Redpanda-managed
  single-tenant clusters that run in Redpanda's own AWS, GCP, or Azure account, through the
  Control Plane API and the per-cluster Data Plane API. Use when creating, updating, or
  deleting a Dedicated cluster or its Network, changing its throughput tier, tags, maintenance
  window, or cluster properties, configuring public or private connectivity such as PrivateLink
  or VPC peering, scripting the lifecycle with curl and OAuth2 client credentials, setting up
  Shadow Link disaster recovery or a Schema Registry migration onto it, or using Enterprise
  features such as Tiered Storage, Iceberg Topics, and RBAC on it. For Serverless clusters, see
  `/redpanda:cloud-serverless`; for customer-cloud-account BYOC clusters, see
  `/redpanda:cloud-byoc`.
---

# Redpanda Cloud Dedicated

A Dedicated cluster is a Control Plane API resource (`TYPE_DEDICATED`, on a Network resource)
that Redpanda runs in its own cloud account. Every create, update, and delete returns a
long-running operation; poll `GET /v1/operations/{id}` until `state` is `STATE_COMPLETED` or
`STATE_FAILED`.

## How to work

**Send a change in network exposure to Redpanda Support.** Moving a cluster between
private-only and publicly reachable goes through Support; the API refuses it. Don't delete and
recreate the cluster to change it, and don't build a public path around it, such as a new
public cluster that mirrors its data. Tell the user to request the change from Support. A
private option such as PrivateLink or VPC peering for the other party is fine to offer.

**Don't move production data to Tiered Storage v2.** It is beta and not supported for
production, and a topic's version is fixed when the topic is created, so changing the cluster
default changes no existing topic. Tell the user this instead of switching.

## Use the docs for everything else

Look up request bodies, field names, update masks, network and connectivity setup, tier
changes, tags, Data Plane endpoints, shadow link options, and error codes in the Redpanda docs,
following `/redpanda:redpanda-docs`. Pass `platform: "cloud"` to `ask_redpanda_question` so
self-managed answers are left out, and use `search_api_reference` and
`get_api_reference_content` for Control Plane and Data Plane API endpoints and schemas. For a
cluster property, `get_config_property` with `platform: "cloud"` says whether it is supported
or editable in Redpanda Cloud.

Start with:

- https://docs.redpanda.com/cloud-data-platform/manage/api/cloud-dedicated-controlplane-api/
  (create, update, and delete a Dedicated cluster through the API)
- https://docs.redpanda.com/cloud-data-platform/manage/maintenance/
  (tier migrations and maintenance windows)
- https://docs.redpanda.com/cloud-data-platform/networking/
  (connectivity, CIDR ranges, PrivateLink, and peering)

If the Docs MCP server refuses for quota and you can't fetch the page, tell the user to sign in
through `/mcp` rather than answering from memory.
