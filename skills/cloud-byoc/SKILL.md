---
name: cloud-byoc
description: >-
  Provisions, changes, and tears down Redpanda Cloud BYOC (Bring Your Own Cloud) clusters
  through the Control Plane API and the `rpk cloud byoc` plugin, where the VPC, IAM roles,
  and storage stay in your own AWS, GCP, or Azure account. Use when creating or deleting a
  BYOC cluster or its Network, running `rpk cloud byoc` apply, destroy, or validate,
  scaling a BYOC cluster, editing its cloud provider tags or cluster properties,
  configuring its private connectivity and listeners, or setting up Shadow Link disaster
  recovery, cross-account AWS access, or Enterprise features such as Tiered Storage on it.
  For Serverless clusters, see `/redpanda:cloud-serverless`; for fully Redpanda-managed
  Dedicated clusters, see `/redpanda:cloud-dedicated`.
---

# Redpanda Cloud BYOC

A BYOC cluster is a Control Plane API resource (`TYPE_BYOC`, on a Network resource) plus an
agent that `rpk cloud byoc <aws|gcp|azure>` installs in your cloud account with Terraform.
Every create, update, and delete returns a long-running operation; poll
`GET /v1/operations/{id}` until `state` is `STATE_COMPLETED` or `STATE_FAILED`.

## How to work

**Create a BYOVNet cluster on Azure with Terraform alone.** Use the Redpanda BYOVNet module and
the Redpanda Terraform provider in one configuration, as in
https://docs.redpanda.com/cloud-data-platform/get-started/cluster-types/byoc/azure/vnet-azure/.
Do not call the Cloud API or run `rpk cloud byoc azure apply` to create it.

**Never pass `--cloud-api-token`, and keep `RPK_CLOUD_SKIP_VERSION_CHECK` to developer testing.**
rpk hands the Cloud API token to the BYOC plugin itself. The skip-check variable makes
`rpk cloud byoc` run whatever plugin is installed instead of the version pinned for the cluster,
so take it out of production jobs.

**Don't move production data to Tiered Storage v2.** It is beta and not supported for
production, and a topic's version is fixed when the topic is created, so changing the cluster
default changes no existing topic. Tell the user this instead of switching.

## Use the docs for everything else

Look up request bodies, field names, flags, network and connectivity setup, tier names,
error codes, and per-provider steps in the Redpanda docs, following `/redpanda:redpanda-docs`.
Pass `platform: "cloud"` to `ask_redpanda_question` so self-managed answers are left out, and
use `search_api_reference` and `get_api_reference_content` for Control Plane API endpoints and
schemas. For a cluster property, `get_config_property` with `platform: "cloud"` says whether it is
supported or editable in Redpanda Cloud.

Start with:

- https://docs.redpanda.com/cloud-data-platform/manage/api/cloud-byoc-controlplane-api/
  (create, update, and delete a BYOC cluster through the API)
- https://docs.redpanda.com/cloud-data-platform/manage/cluster-maintenance/scale-cluster/
  (scaling rules and errors)

If the Docs MCP server refuses for quota and you can't fetch the page, tell the user to sign in
through `/mcp` rather than answering from memory.
