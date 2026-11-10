# cloud-byoc Skill Source Map

The skill is thin: it keeps only the "How to work" procedure below, backed by a behavioral
eval case in `evals/suites/cloud-byoc.eval.json`, and sends the agent to the docs for
everything else. This file maps only the claims the skill still makes.

The source repos for the intro claims are private. Read them through the GitHub API or the
Redpanda-Github-Read MCP connector; do not clone them.

- `redpanda-data/cloudv2`: paths below are relative to the repo root.
- `redpanda-data/streaming-enterprise`: `rpk cloud byoc` lives in
  `src/go/rpk/pkg/cli/cloud/byoc/`.

## How to work: line, source, eval case

| How to work line | Source | Eval case |
|---|---|---|
| Create a BYOVNet cluster on Azure with Terraform alone: the BYOVNet module plus the Redpanda provider, which runs the agent bootstrap, with no Cloud API calls or `rpk cloud byoc azure apply` (verified 2026-10-27) | `redpanda-data/terraform-provider-redpanda` `redpanda/utils/byoc.go` (`RunByoc`, Azure preflight in `CheckCloudConfig`), `examples/byovpc/azure/main.tf`. Published: https://docs.redpanda.com/cloud-data-platform/get-started/cluster-types/byoc/azure/vnet-azure/ | `byovnet-azure-terraform-only` |
| Send a change in network exposure (private-only to or from publicly reachable, and BYOVPC migrations to or from dual listener mode) to Redpanda Support; don't build a public path in the customer's account (verified 2026-10-31). Safety guardrail: the baseline passed its case 3/3 on 2026-10-31 and 1/3 on 2026-11-10, and the line and case stay as a regression guard. | cloudv2 `apps/public-api-go/internal/services/cluster/v1/dual_mode_connections.go` (`validateConnectionsSemanticsForUpdate` refuses a change in public presence; `crossesDualPublic` lets only public-only to and from dual through) | `private-to-public-goes-through-support` |
| Never pass `--cloud-api-token`; keep `RPK_CLOUD_SKIP_VERSION_CHECK` to developer testing, because it runs the installed plugin instead of the pinned version (verified 2026-10-31) | streaming-enterprise `src/go/rpk/pkg/cli/cloud/byoc/byoc.go`, `install.go` | `byoc-apply-script-no-dev-overrides` (grades the skip-check part; the rpk error already makes the baseline drop the token flag) |
| Don't move production data to Tiered Storage v2: it is beta and not for production, and a topic's version is fixed at create time (verified 2026-10-31) | https://docs.redpanda.com/cloud-data-platform/manage/tiered-storage-versions/ | `tiered-storage-v2-not-for-production` |

## Eval rates

Rerun on 2026-11-10 against this `SKILL.md`, 3 runs per arm. Archive run folder:
`2026-11-10T20-28-18-815Z`.

| Eval case | baseline | skill | installed |
|---|---|---|---|
| `byovnet-azure-terraform-only` | 0/3 | 3/3 | 3/3 |
| `private-to-public-goes-through-support` | 1/3 | 3/3 | 3/3 |
| `byoc-apply-script-no-dev-overrides` | 0/3 | 3/3 | 3/3 |
| `tiered-storage-v2-not-for-production` | 0/3 | 2/3 | 3/3 |

## Other claims in SKILL.md

| Claim | Source |
|---|---|
| A BYOC cluster is a Control Plane API resource of type `TYPE_BYOC` on a Network resource, plus an agent that `rpk cloud byoc <aws\|gcp\|azure>` installs with Terraform | cloudv2 `proto/public/cloud/redpanda/api/controlplane/v1/cluster.proto` (`Cluster.Type`); streaming-enterprise `src/go/rpk/pkg/cli/cloud/byoc/` (`byoc.go`, `install.go`) |
| Create, update, and delete return a long-running operation; poll `GET /v1/operations/{id}` until `STATE_COMPLETED` or `STATE_FAILED` | cloudv2 `proto/public/cloud/redpanda/api/controlplane/v1/cluster.proto` (`UpdateCluster` returns `UpdateClusterOperation`, `patch: "/v1/clusters/{cluster.id}"`, `body: "cluster"`), `operation.proto` (`Operation.State`) |
| Docs URLs | served at https://docs.redpanda.com/cloud-data-platform/ |
| When the Docs MCP server refuses for quota and no page fetch is possible, tell the user to sign in through `/mcp` rather than answering from memory | `skills/redpanda-docs/references/SOURCES.md` (anonymous quota row) |
| `get_config_property` with `platform: "cloud"` says whether a cluster property is supported or editable in Redpanda Cloud | Live `tools/list` from `https://docs.redpanda.com/mcp` (checked 2026-10-30; see `skills/redpanda-docs/references/SOURCES.md`) |

## Docs gaps reported (not skill claims; do not re-verify here)

Found by the evals and handed to the docs team:

- `redpanda_cloud_provider_tags` is not backfilled and can be empty on older clusters while
  `cloud_provider_tags` carries `redpanda-managed` (cloudv2
  `apps/controlplane-api/internal/services/redpanda/redpanda_service.go`,
  `syncRedpandaCloudProviderTags` keeps `redpanda-managed` only if the stored field already had
  it); the API reference does not say so.

## Lines removed for lack of a failing baseline

The removed line has no committed eval case, so it was not rerun on 2026-11-10.

- "Confirm with the user before any change that deletes, scales, or reconfigures a cluster or
  its Network" was removed on 2026-10-30. Its behavioral case (a throttled cluster at its tier's
  ingress limit, with the Control Plane API mocked) passed 3/3 in the baseline: without the
  skill, the agent proposed a larger tier and asked before changing anything. Under the thin
  format the line is general practice, so the case was not kept.

## Corrections to the pre-thin references

- The 2026-11-01 drift audit corrected the `connection_type` row in the pre-thin
  `references/clusters-and-agent.md`: the published API reference lists only
  `CONNECTION_TYPE_PUBLIC` and `CONNECTION_TYPE_PRIVATE` (api-docs
  `cloud-controlplane/cloud-controlplane.yaml`, `ConnectionType`), not the proto zero-value. The
  thin skill does not carry the row; the API reference is the source for the field.
- Main's tier-only scaling rule (2026-11-05, #124) went into the pre-thin
  `references/clusters-and-agent.md`: a request that changes only `throughput_tier` keeps the
  cluster's current broker count, which is checked against the target tier. The thin skill does
  not carry it. The published scale-cluster page states the rule and its error-table row:
  https://docs.redpanda.com/cloud-data-platform/manage/cluster-maintenance/scale-cluster/

## Corrections after the eval run

- 2026-11-10: three docs gaps listed here are no longer gaps, so they were removed. The
  published docs now say that `custom_properties` integer and number values are sent as JSON
  strings (https://docs.redpanda.com/cloud-data-platform/manage/cluster-maintenance/config-cluster/),
  that a tags update may send the reserved tags back unchanged (the reserved tag keys section of
  https://docs.redpanda.com/cloud-data-platform/get-started/cluster-types/byoc/aws/create-byoc-cluster-aws/),
  and that `rpk cloud byoc <provider> validate` needs no `--redpanda-id` and
  `RPK_CLOUD_SKIP_VERSION_CHECK` runs the installed plugin as is
  (https://docs.redpanda.com/cloud-data-platform/reference/rpk/rpk-cloud/rpk-cloud-byoc/).
- 2026-11-10: the `redpanda_cloud_provider_tags` gap cited `mapper.go`, which only copies the
  field; the source that decides what the field holds is cited instead.
