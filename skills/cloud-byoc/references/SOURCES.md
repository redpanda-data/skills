# cloud-byoc Skill Source Map

Maps each claim in `skills/cloud-byoc/SKILL.md` to the source it was verified against, so
syncs and maintainers know where to re-check it. Everything else the skill defers to the
published docs.

Both source repos are private. Read them through the GitHub API or the Redpanda-Github-Read
MCP connector; do not clone them.

- `redpanda-data/cloudv2`: paths below are relative to the repo root.
- `redpanda-data/streaming-enterprise`: `rpk cloud byoc` lives in
  `src/go/rpk/pkg/cli/cloud/byoc/`.

## Claim-to-source table

All claims verified 2026-10-21.

| Claim in SKILL.md | Source |
|---|---|
| Create, update, and delete return a long-running operation; operation states `STATE_IN_PROGRESS`/`STATE_COMPLETED`/`STATE_FAILED` | cloudv2 `proto/public/cloud/redpanda/api/controlplane/v1/cluster.proto` (`UpdateCluster` returns `UpdateClusterOperation`, `patch: "/v1/clusters/{cluster.id}"`, `body: "cluster"`), `operation.proto` (`Operation.State`) |
| Multi-zone broker count must be a multiple of the zone count | cloudv2 `apps/controlplane-api/internal/services/redpanda/redpanda_service.go` (`validateUserNodesCountZones`, `nodesCountNotZoneMultipleErr`: `INVALID_ARGUMENT`, "node count %d must be a multiple of the cluster's %d zones"; a single-zone cluster takes any count). Published: https://docs.redpanda.com/cloud-data-platform/manage/cluster-maintenance/scale-cluster/ |
| Integer and number `custom_properties` values are sent as JSON strings | cloudv2 `cluster.proto`: the comment on `cluster_configuration` in `ClusterCreate`, `ClusterUpdate`, and `Cluster` ("Properties of type integer and number from redpanda config schema needs to be provided as strings to avoid precision loss"); `custom_properties` is a `google.protobuf.Struct` |
| A tags PATCH may echo stored reserved keys unchanged; rejected only on an added or changed reserved key, with `INVALID_ARGUMENT` "cloud tags cannot contain the reserved key" | cloudv2 `apps/controlplane-api/internal/services/redpanda/redpanda_service.go` (`validateCloudTagKeysOnUpdate` delta check vs `validateCloudTagKeysOnCreate` presence check, `reservedTagKeyErr`, `reservedTagKeys`); `validate_test.go` (`TestValidateCloudTagKeysOnUpdate`) |
| `RPK_CLOUD_SKIP_VERSION_CHECK=1` or `true` runs the installed plugin as is, only when one is already installed; rpk still loads a Cloud token first | streaming-enterprise `src/go/rpk/pkg/cli/cloud/byoc/install.go` (`ensurePluginVersion`: `pluginExists && (BYOCSkipVersionCheck == "1" \|\| == "true")`; `loginAndEnsurePluginVersion` calls `getTokenOrLogin` before it), `src/go/rpk/pkg/config/config.go` (`BYOCSkipVersionCheck` `env:"RPK_CLOUD_SKIP_VERSION_CHECK"`), `src/go/rpk/pkg/plugin/plugin.go` (`UserPaths`: managed plugin dir plus `$PATH`) |
| `validate` needs no `--redpanda-id` and downloads the latest plugin; `apply` and `destroy` require `--redpanda-id` | streaming-enterprise `src/go/rpk/pkg/cli/cloud/byoc/byoc.go` (`isValidate` path, "required --redpanda-id flag cannot be empty" for apply/destroy), `install.go` (`fetchBYOCArtifact` `ListLatestArtifacts` when `isLatest`) |

## Dropped after behavioral screening

These procedures were drafted for "How to work" and removed because a model with no skill
already followed them in a mocked run (2026-10-21). They remain true and are covered by the
published docs:

- Teardown order: `DELETE /v1/clusters/{id}`, wait for `STATE_DELETING_AGENT`, then
  `rpk cloud byoc <provider> destroy`, then delete the network (cloudv2
  `redpanda_service.go` `validTransitions`; published in the BYOC Control Plane API page).
- Read-modify-write for `cloud_provider_tags`, because a masked update replaces the whole map
  (cloudv2 `redpanda_service.go`, comment on `restoreRedpandaManagedTag`).
- Do not re-send a scaling PATCH while a paused scale leaves the cluster in
  `STATE_UPGRADING`; Redpanda Support resumes or rolls back (published scale-cluster page).

## TODO / unresolved (do not state in the skill until confirmed)

- Whether `update_mask` is required on every cluster PATCH. The published examples omit it,
  and the gateway may derive a mask from the body. Settle with one live call.
- Whether `rpk cloud byoc azure destroy` needs `--subscription-id`. The published delete
  example omits it; the plugin's own flags are not in the rpk source.
- The error code returned for a tier not offered in a region.
- Whether `ListClusters` returns `dataplane_api.url`.
