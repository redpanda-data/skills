# cloud-serverless Skill Source Map

The skill is thin: it keeps only the "How to work" procedures below, each backed by a
behavioral eval case in `evals/suites/cloud-serverless.eval.json`, and sends the agent to the
docs for everything else. This file maps only the claims the skill still makes.

All proto paths are relative to the `redpanda-data/cloudv2` repository root. Control Plane
protos live under `proto/public/cloud/redpanda/api/controlplane/v1/`; the Data Plane surface is
the generated OpenAPI at `proto/gen/openapi/openapi.dataplane.yaml`. The `cloudv2` repo is
private; read it through the GitHub API or the Redpanda-Github-Read MCP connector, not by
cloning.

## How to work: line, source, eval case

Pass rates are from the 2026-11-10 run (3 runs per arm, subject claude-sonnet-5-5).

| How to work line | Source | Eval case |
|---|---|---|
| The add-partitions request (PATCH) takes the number to add, not the total; read the current count first, or use the set-partitions request (PUT) with the total. Partitions can't be removed (verified 2026-11-10). Baseline 0/3, skill 3/3, installed 3/3. | `proto/gen/openapi/openapi.dataplane.yaml` (`TopicService_AddTopicPartitions`, `AddTopicPartitionsBody.partition_count` "number of partitions to add"; `TopicService_SetTopicPartitions`, `SetTopicPartitionsBody.partition_count` "number of partitions to set"; same pair on `/v1/topics-partitions`) | `add-partitions-to-reach-total` |
| Change one topic config with PATCH, not PUT: PUT replaces the whole set and resets every config left out to its default (verified 2026-11-10). Safety guardrail (data loss on a compacted or custom-retention topic): the baseline passed its case 3/3 on 2026-11-10, and the line and case stay as a regression guard. Skill 3/3, installed 3/3. | `proto/gen/openapi/openapi.dataplane.yaml` (`TopicService_SetTopicConfigurations`: "Config entries that are not provided in the request are removed and will fall back to their default values"; `TopicService_UpdateTopicConfigurations`) | `topic-config-change-keeps-others` |
| Set up PrivateLink as two resources: create a Serverless private link allowing the user's AWS account, wait for its operation, then update the cluster to enable private networking with the link's ID; give the user the endpoint service name; leave public access on unless asked (verified 2026-11-10). Baseline 0/3, skill 3/3, installed 3/3. | `controlplane/v1/serverless_private_link.proto` (`CreateServerlessPrivateLink`, `ServerlessPrivateLinkCreate` AWS-only CEL rule and `allowed_principals`, `ServerlessPrivateLinkStatus.AWS.vpc_endpoint_service_name`), `controlplane/v1/serverless.proto` (`ServerlessClusterUpdate` CEL rules `private_link_id_required` and `network_must_not_have_both_private_public_disabled`). Published: https://docs.redpanda.com/cloud-data-platform/networking/serverless/aws/privatelink-api/ | `serverless-privatelink-setup` |
| When a cluster is at its pipeline limit, list drafts too: drafts use slots but are left out of the pipeline list by default; don't delete or start one without asking (verified 2026-11-10). Baseline 0/3, skill 3/3, installed 3/3. | `proto/gen/openapi/openapi.dataplane.yaml` (`ListPipelinesRequest.Filter.include_drafts`: drafts excluded by default even when `states` names `STATE_DRAFT`; `Pipeline.State` `STATE_DRAFT`; `PipelineCreate.draft`: "Drafts count against the cluster's pipeline limit") | `pipeline-slots-hidden-drafts` |

## Other claims in SKILL.md

| Claim | Source |
|---|---|
| A Serverless cluster is its own Control Plane API resource, separate from BYOC and Dedicated clusters; create, update, and delete return a long-running operation | `controlplane/v1/serverless.proto` (`ServerlessClusterService`; `CreateServerlessClusterOperation`, `UpdateServerlessClusterOperation`, `DeleteServerlessClusterOperation`), `controlplane/v1/operation.proto` |
| Each cluster reports its own Data Plane API URL, which takes the same bearer token | `controlplane/v1/serverless.proto` (`ServerlessCluster.dataplane_api.url`); redpanda `src/go/rpk/pkg/publicapi/dataplane.go` |
| Docs URLs | served at https://docs.redpanda.com/cloud-data-platform/ |
| When the Docs MCP server refuses for quota and no page fetch is possible, tell the user to sign in through `/mcp` rather than answering from memory | `skills/redpanda-docs/references/SOURCES.md` (anonymous quota row) |
| `get_config_property` with `platform: "cloud"` says whether a property is supported or editable in Redpanda Cloud | Live `tools/list` from `https://docs.redpanda.com/mcp` (see `skills/redpanda-docs/references/SOURCES.md`) |

## Docs gaps reported (not skill claims; do not re-verify here)

Found by the evals and handed to the docs team:

- When a Serverless cluster is at its topic or partition limit, the Data Plane API returns the
  Kafka `POLICY_VIOLATION` as HTTP 400 `INVALID_ARGUMENT` (the same status as a malformed
  request), with the Kafka error in the error details, and it is not retriable. The usage-limits
  section of https://docs.redpanda.com/cloud-data-platform/get-started/cluster-types/serverless/
  names `POLICY_VIOLATION` but not the HTTP status, so docs-arm agents argued the 400 was not the
  limit (case `topic-ceiling-policy-violation`: docs 1/3, both 3/3). Source: console
  `backend/pkg/api/connect/errors/kafka.go` (`connectCodeFromKafkaError` maps `PolicyViolation`
  to `CodeInvalidArgument`; `newKafkaErrorInfo`).
- Draft pipelines count against the cluster's pipeline limit and are left out of
  `ListPipelines` unless `filter.include_drafts` is set. The Data Plane API spec served at
  https://docs.redpanda.com/api/doc/cloud-dataplane.yaml (checked 2026-11-10) has no
  `STATE_DRAFT` or `include_drafts`, and docs-arm agents found it nowhere in the docs (case
  `pipeline-slots-hidden-drafts`: docs 0/3). Source: cloudv2
  `proto/gen/openapi/openapi.dataplane.yaml` (`ListPipelinesRequest.Filter.include_drafts`,
  `PipelineCreate.draft`).

## Lines removed for lack of a failing baseline

- "Cluster tags on an update are a full replacement, so send the existing tags with the new
  one" was not kept. Its behavioral case (add one tag to a cluster that carries three) passed
  3/3 in the baseline on 2026-11-10: without the skill, the agent read the cluster and sent all
  four tags. The case was not kept.
- The pre-thin skill's facts on authentication (token endpoint and audience, lost secrets need
  a rotation), cluster create prerequisites, private-only networking, Data Plane request shapes
  for topics, ACLs and secrets, draft promotion, and Shadow Link eligibility were dropped. Their
  fact cases passed in the baseline (2/3 or 3/3) and in the docs arms; they stay in the suite
  as coverage measures.

## TODO / re-verify

- Quota entity types: the Data Plane spec marks `ENTITY_TYPE_USER` "Not supported in Redpanda",
  while the `rpk cluster quotas alter` help in redpanda v26.2.2
  (`src/go/rpk/pkg/cli/cluster/quotas/alter.go`) says user, client ID, and client ID prefix
  entities are supported (its `--name` flag help lists only `client-id` and
  `client-id-prefix`). The pre-thin skill said user quotas are unsupported; its eval case was
  removed until a maintainer confirms which is true.
