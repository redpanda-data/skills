# cloud-dedicated Skill Source Map

The skill is thin: it keeps only the "How to work" procedure below, backed by behavioral eval
cases in `evals/suites/cloud-dedicated.eval.json`, and sends the agent to the docs for
everything else. This file maps only the claims the skill still makes.

The source repo for the intro and guardrail claims is private. Read it through the GitHub API
or the Redpanda-Github-Read MCP connector; do not clone it.

- `redpanda-data/cloudv2`: paths below are relative to the repo root.

## How to work: line, source, eval case

| How to work line | Source | Eval case |
|---|---|---|
| Send a change in network exposure (private-only to or from publicly reachable) to Redpanda Support; don't delete and recreate the cluster, and don't build a public path around it such as a new public cluster that mirrors its data (verified 2026-11-10). Safety guardrail: guards a change to a cluster's network exposure. | cloudv2 `apps/public-api-go/internal/services/cluster/v1/dual_mode_connections.go` (the connectivity-migration refusal on the shared cluster API, with no cluster-type exception) | `dedicated-private-to-public-goes-through-support` |
| Don't move production data to Tiered Storage v2: it is beta and not for production, and a topic's version is fixed at create time (verified 2026-11-10) | https://docs.redpanda.com/cloud-data-platform/manage/tiered-storage-versions/ | `dedicated-tiered-storage-v2-not-for-production` |

Eval results (3 runs per arm, 2026-11-10), as baseline / skill / installed, with the thin skill:

- `dedicated-private-to-public-goes-through-support`: 0/3, 3/3, 3/3 (the full pre-thin skill, which lacked this line, scored 0/3 in both skill arms). The line passes on its failing baseline and is also a safety guardrail, so it stays even if a later baseline passes.
- `dedicated-tiered-storage-v2-not-for-production`: 0/3, 3/3, 3/3.

## Other claims in SKILL.md

| Claim | Source |
|---|---|
| A Dedicated cluster is a Control Plane API resource of type `TYPE_DEDICATED` on a Network resource | cloudv2 `proto/public/cloud/redpanda/api/controlplane/v1/cluster.proto` (`Cluster.Type`), `network.proto` (`cluster_type` validation) |
| Create, update, and delete return a long-running operation; poll `GET /v1/operations/{id}` until `STATE_COMPLETED` or `STATE_FAILED` | cloudv2 `proto/public/cloud/redpanda/api/controlplane/v1/cluster.proto` (`CreateCluster`, `UpdateCluster`, `DeleteCluster` return operations), `operation.proto` (`Operation.State`) |
| Docs URLs | served at https://docs.redpanda.com/cloud-data-platform/ |
| When the Docs MCP server refuses for quota and no page fetch is possible, tell the user to sign in through `/mcp` rather than answering from memory | `skills/redpanda-docs/references/SOURCES.md` (anonymous quota row) |
| `get_config_property` with `platform: "cloud"` says whether a cluster property is supported or editable in Redpanda Cloud | Live `tools/list` from `https://docs.redpanda.com/mcp` (see `skills/redpanda-docs/references/SOURCES.md`) |

## Docs gaps reported (not skill claims; do not re-verify here)

Found by the evals (the skill arm passed and the docs arm mostly failed) and handed to the docs team:

- **`update_mask` on UpdateCluster.** `PATCH /v1/clusters/{cluster.id}` needs a required
  `update_mask` query parameter listing the changed field paths, and the body is the
  `ClusterUpdate` object itself. Pages that lack it: the API reference operation page
  https://docs.redpanda.com/api/doc/cloud-controlplane/operation/operation-clusterservice_updatecluster
  (no `update_mask` parameter), and
  https://docs.redpanda.com/cloud-data-platform/manage/api/cloud-dedicated-controlplane-api/
  ("Update cluster configuration" example sends no `update_mask`). Source: cloudv2
  `proto/public/cloud/redpanda/api/controlplane/v1/cluster.proto` (`UpdateClusterRequest.update_mask`,
  `buf.validate` required; HTTP rule `body: "cluster"`). Case: `cluster-patch-update-mask`.
- **Shadow link Schema Registry API-mode credentials.** In
  `schema_registry_sync_options.shadow_schema_registry_api.auth_options`, only `basic` is
  accepted, and `basic.password` must reference a Data Plane secret as `${secrets.<SECRET_ID>}`;
  an inline password is rejected. Pages that lack it: the API reference operation page
  https://docs.redpanda.com/api/doc/cloud-controlplane/operation/operation-shadowlinkservice_createshadowlink
  (no mention of the secret reference), and
  https://docs.redpanda.com/cloud-data-platform/manage/disaster-recovery/shadowing/migrate-schemas-confluent/
  (its Cloud API example sends `"password": "<sr-api-secret>"`; only the Terraform example uses a
  secret reference). Source: cloudv2
  `proto/public/cloud/redpanda/api/controlplane/v1/shadow_link.proto` (CEL rules
  `sr_api_password_must_reference_secret`, `sr_api_auth_options_only_basic_supported`). Case:
  `shadow-sr-api-password-secret`.

- **Private-only to public on Dedicated goes through Support.** Moving a Dedicated cluster
  between private-only and publicly reachable connectivity is refused by the Control Plane API
  and is done by Redpanda Support. The only published statement is on the BYOC page
  https://docs.redpanda.com/cloud-data-platform/networking/byoc/aws/dual-listener-mode/; the
  Dedicated pages (https://docs.redpanda.com/cloud-data-platform/networking/ and
  https://docs.redpanda.com/cloud-data-platform/manage/api/cloud-dedicated-controlplane-api/) do
  not say it. Source: cloudv2
  `apps/public-api-go/internal/services/cluster/v1/dual_mode_connections.go` (refusal with no
  cluster-type check). Case: `dedicated-private-to-public-goes-through-support` (docs arm 1/3).

Weak coverage, not a gap: `no-customer-managed-keys` passed 2/3 in the docs arm. The fact is on
https://docs.redpanda.com/cloud-data-platform/security/cloud-encryption/, but one docs run did
not find it.

## Lines removed for lack of a failing baseline

- "A `cloud_provider_tags` PATCH replaces the whole map, so read the current tags and send the
  full map" was not kept. Its behavioral case `tags-patch-keeps-existing-tags` passed 3/3 in the
  baseline: without the skill, the agent read the cluster first and sent the existing tags with
  the new one. The case stays in the suite.

## Corrections to the pre-thin references

The thin skill does not carry these claims; they are recorded so they are not reintroduced.

- The pre-thin `references/data-plane.md` and `create-cluster.md` said `dataplane_api.url` is
  returned only by `GetCluster`, not `ListClusters`. cloudv2
  `apps/public-api-go/internal/services/cluster/v1/cluster_service.go` builds both responses with
  the same mapper (`mapper.go`, `RedpandaToCluster`), which sets `DataplaneApi`, so the list
  response carries it too.
- The pre-thin `references/data-plane.md` said an empty `DeleteACLs` filter matches broadly. The
  public Data Plane proto marks the filter's `resource_type`, `resource_pattern_type`,
  `operation`, and `permission_type` as required
  (https://github.com/redpanda-data/console/blob/master/proto/redpanda/api/dataplane/v1/acl.proto,
  `DeleteACLsRequest.Filter`), so a request without them is rejected.
- The pre-thin `references/create-cluster.md` said self-service tier changes are not offered on
  Dedicated. In cloudv2, a `throughput_tier` update is allowed or refused by organization
  settings and usage-based billing (`cluster_service.go`) and by whether the target tier is
  enabled for the cluster's type and region (`apps/controlplane-api/internal/services/redpanda/redpanda_service.go`,
  `validateDesiredScaling`), with no blanket Dedicated refusal. The published maintenance and
  scale-cluster pages describe a Dedicated tier change as a migration run by Redpanda Support;
  the thin skill defers to those pages.
