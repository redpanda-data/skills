---
name: cloud-byoc
description: >-
  Provisions, changes, and tears down Redpanda Cloud BYOC (Bring Your Own Cloud) clusters
  through the Control Plane API and the `rpk cloud byoc` plugin, where the VPC, IAM roles,
  and storage stay in your own AWS, GCP, or Azure account. Use when creating or deleting a
  BYOC cluster or its Network, running `rpk cloud byoc` apply, destroy, or validate,
  scaling a BYOC cluster, editing its cloud provider tags or cluster properties, or
  configuring its private connectivity and listeners. For Serverless clusters, see
  `/redpanda:cloud-serverless`; for fully Redpanda-managed Dedicated clusters, see
  `/redpanda:cloud-dedicated`.
---

# Redpanda Cloud BYOC

A BYOC cluster is a Control Plane API resource (`TYPE_BYOC`, on a Network resource) plus an
agent that `rpk cloud byoc <aws|gcp|azure>` installs in your cloud account with Terraform.
Every create, update, and delete returns a long-running operation; poll
`GET /v1/operations/{id}` until `state` is `STATE_COMPLETED` or `STATE_FAILED`.

## How to work

No BYOC-specific procedure has yet proven to change an agent's outcome over the docs
alone, so this skill carries none. Follow `/redpanda:redpanda-docs`, and confirm with the user
before any change that deletes, scales, or reconfigures a cluster or its Network.

## Use the docs for everything else

Look up request bodies, field names, flags, network and connectivity setup, tier names,
error codes, and per-provider steps in the Redpanda docs, following `/redpanda:redpanda-docs`.
Pass `platform: "cloud"` to `ask_redpanda_question` so self-managed answers are left out, and
use `search_api_reference` and `get_api_reference_content` for Control Plane API endpoints and
schemas.

Start with:

- https://docs.redpanda.com/cloud-data-platform/manage/api/cloud-byoc-controlplane-api/
  (create, update, and delete a BYOC cluster through the API)
- https://docs.redpanda.com/cloud-data-platform/manage/cluster-maintenance/scale-cluster/
  (scaling rules and errors)
