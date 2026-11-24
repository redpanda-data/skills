---
name: cloud-serverless
description: >-
  Provisions and manages Redpanda Cloud Serverless clusters through the Control Plane API
  and each cluster's Data Plane API. Serverless clusters are fully managed and
  Kafka-compatible, and run in Redpanda's own cloud account. Use when you create, update,
  or delete a Serverless cluster, authenticate to the Cloud API with a service account, or
  set up AWS PrivateLink for one. Also use it to add partitions or change topic configs
  through the Data Plane API, or to manage ACLs, users, secrets, quotas, roles, and Redpanda
  Connect pipelines there. For BYOC clusters, see `/redpanda:cloud-byoc`; for Dedicated
  clusters, see `/redpanda:cloud-dedicated`; for the rpk CLI equivalent, see
  `/redpanda:rpk-cloud`.
---

# Redpanda Cloud Serverless

A Serverless cluster is its own Control Plane API resource, separate from BYOC and Dedicated
clusters. Create, update, and delete return a long-running operation; poll it until it
completes. Each cluster reports its own Data Plane API URL, which serves topics, ACLs, users,
secrets, quotas, and pipelines with the same bearer token.

## How to work

**Adding partitions: work out the number to add first.** The add-partitions request (PATCH)
takes the number of partitions to add, not the new total. Read the topic's current count, then
send the difference (or use the set-partitions request, PUT, with the total). Partitions can't
be removed, so a wrong count is permanent.

**Change one topic config with PATCH, not PUT.** PUT on a topic's configurations replaces the
whole set, and every config you leave out goes back to its default. On a compacted topic or one
with custom retention, that can delete data. Use PATCH, or read the current configs and send
them all with the change.

**Set up PrivateLink as two resources, link first.** Create a Serverless private link that
allows the user's AWS account, wait for its operation to complete, then update the cluster to
enable private networking with that link's ID. Give the user the endpoint service name from
the link's status for their VPC endpoint. Leave public access on unless the user asks to turn
it off.

**When a cluster is at its pipeline limit, list drafts too.** Draft pipelines use slots but
are left out of the pipeline list by default. List with drafts included before you tell the
user what fills the limit. Don't delete or start a draft without asking.

## Use the docs for everything else

Look up request bodies, field names, endpoints, token settings, limits, error codes, and
networking steps in the Redpanda docs, following `/redpanda:redpanda-docs`. Pass
`platform: "cloud"` to `ask_redpanda_question` so self-managed answers are left out, and use
`search_api_reference` and `get_api_reference_content` for Control Plane and Data Plane API
endpoints and schemas. For a topic or cluster property, `get_config_property` with
`platform: "cloud"` says whether it is supported or editable in Redpanda Cloud.

Start with:

- https://docs.redpanda.com/cloud-data-platform/get-started/cluster-types/serverless/
  (what Serverless offers, and its usage limits)
- https://docs.redpanda.com/cloud-data-platform/networking/serverless/aws/privatelink-api/
  (PrivateLink through the Cloud API)

If the Docs MCP server refuses for quota and you can't fetch the page, tell the user to sign in
through `/mcp` rather than answering from memory.
