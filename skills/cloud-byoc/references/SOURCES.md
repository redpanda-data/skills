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

## Other claims in SKILL.md

| Claim | Source |
|---|---|
| A BYOC cluster is a Control Plane API resource of type `TYPE_BYOC` on a Network resource, plus an agent that `rpk cloud byoc <aws\|gcp\|azure>` installs with Terraform | cloudv2 `proto/public/cloud/redpanda/api/controlplane/v1/cluster.proto` (`Cluster.Type`); streaming-enterprise `src/go/rpk/pkg/cli/cloud/byoc/` (`byoc.go`, `install.go`) |
| Create, update, and delete return a long-running operation; poll `GET /v1/operations/{id}` until `STATE_COMPLETED` or `STATE_FAILED` | cloudv2 `proto/public/cloud/redpanda/api/controlplane/v1/cluster.proto` (`UpdateCluster` returns `UpdateClusterOperation`, `patch: "/v1/clusters/{cluster.id}"`, `body: "cluster"`), `operation.proto` (`Operation.State`) |
| Docs URLs | served at https://docs.redpanda.com/cloud-data-platform/ |
| `get_config_property` with `platform: "cloud"` says whether a cluster property is supported or editable in Redpanda Cloud | Live `tools/list` from `https://docs.redpanda.com/mcp` (checked 2026-10-30; see `skills/redpanda-docs/references/SOURCES.md`) |

## Docs gaps reported (not skill claims; do not re-verify here)

Found by the evals and handed to the docs team:

- `custom_properties` integer and number values are sent as JSON strings (cloudv2
  `cluster.proto`, comment on `cluster_configuration`).
- A tags PATCH may echo stored reserved keys unchanged (cloudv2 `redpanda_service.go`,
  `validateCloudTagKeysOnUpdate`); the published reserved-keys section says they are rejected.
- `redpanda_cloud_provider_tags` is not backfilled and can be empty on older clusters while
  `cloud_provider_tags` carries `redpanda-managed` (cloudv2
  `apps/public-api-go/internal/services/cluster/v1/mapper.go`); the API reference does not say so.
- `rpk cloud byoc <provider> validate` runs without `--redpanda-id`, and
  `RPK_CLOUD_SKIP_VERSION_CHECK` runs the installed plugin as is (streaming-enterprise
  `src/go/rpk/pkg/cli/cloud/byoc/byoc.go`, `install.go`).

## Lines removed for lack of a failing baseline

- "Confirm with the user before any change that deletes, scales, or reconfigures a cluster or
  its Network" was removed on 2026-10-30. Its behavioral case (a throttled cluster at its tier's
  ingress limit, with the Control Plane API mocked) passed 3/3 in the baseline: without the
  skill, the agent proposed a larger tier and asked before changing anything. Under the thin
  format the line is general practice, so the case was not kept.
