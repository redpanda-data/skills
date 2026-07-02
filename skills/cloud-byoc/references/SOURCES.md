# cloud-byoc Skill Source Map

Maps each file in `skills/cloud-byoc/` to the `cloudv2` source paths and docs URLs it
derives from, so future syncs and human maintainers know exactly where to verify claims.

All proto/OpenAPI paths are relative to the `redpanda-data/cloudv2` repository root. The
`cloudv2` repo is private; read it via the Redpanda-Github-Read MCP connector
(`search_code`, `get_file_contents`, `list_commits`, `get_commit`) or a local checkout,
not by guessing. Before writing or changing any fact, re-open the cited source and confirm
exact spelling, field numbers, enum values, and endpoint paths.

## Control-plane proto/OpenAPI root

- Protos: `proto/public/cloud/redpanda/api/controlplane/v1/*.proto`
- Generated OpenAPI: `proto/gen/openapi/openapi.controlplane.yaml`
- Operation envelope + operation `Type` enum (numbers): `proto/public/cloud/redpanda/api/controlplane/v1/operation.proto`

## File-to-source table

| Skill file | cloudv2 source paths | Docs URLs |
|---|---|---|
| `skills/cloud-byoc/SKILL.md` | `controlplane/v1/cluster.proto` (ClusterService RPCs incl. `UpdateCluster` `patch:/v1/clusters/{cluster.id}` + `body:"cluster"` + top-level `update_mask`), `network.proto`, `network_peering.proto`, `cloud_provider_access.proto`, `shadow_link.proto`, `scheduled_operation.proto`, `operation.proto`, `resource_group.proto`, `region.proto`; `openapi.controlplane.yaml` (PATCH `/v1/clusters/{cluster.id}` ~5623-5711); `apps/cloud-ui/src/utils/rpk.utils.ts` (rpk byoc per-provider flags) | https://docs.redpanda.com/redpanda-cloud/ , https://docs.redpanda.com/redpanda-cloud/reference/tiers/byoc-tiers/ , https://docs.redpanda.com/cloud-data-platform/networking/ |
| `skills/cloud-byoc/references/byoc-model-and-auth.md` | `pkg/publicapi/controlplane.go` (`CloudClientSet`, `ControlPlaneProdURL`), `controlplane/v1/operation.proto`, `cluster.proto`, `network.proto` | https://cloud.redpanda.com , https://docs.redpanda.com/redpanda-cloud/ |
| `skills/cloud-byoc/references/networks.md` | `controlplane/v1/network.proto` (NetworkCreate incl. `cloud_provider_access_id` field 9 PREVIEW ~419-430, `egress_spec` field 8/13 PREVIEW + `EgressSpec` AWS `transit_gateway_id` / GCP hub-VPC ~772-831, Azure CMR subnets), `network_peering.proto` (NetworkPeeringService, AWS/GCP/Azure peering specs, states), `cloud_provider_access.proto` (CloudProviderAccessService PREVIEW AWS-only, `role_arn`/`external_id`), `cluster.proto` (`AWSPrivateLinkSpec`/`GCPPrivateServiceConnectSpec`/`AzurePrivateLinkSpec` ~1045-1116), `common.proto`, `operation.proto` (peering Types 13/14) | https://docs.redpanda.com/cloud-data-platform/networking/ , https://docs.redpanda.com/redpanda-cloud/networking/cidr-ranges/ |
| `skills/cloud-byoc/references/clusters-and-agent.md` | `controlplane/v1/cluster.proto` (ClusterCreate/ClusterUpdate fields incl. `redpanda_connect` (Create field 30 / Update field 22) + `Cluster.RedpandaConnect.allowed_destination_cidr_ports` and `Cluster.CidrPort` `{cidr, port_start, port_end}` max 16, `UpdateCluster` RPC ~141-152, `CustomerManagedResources` AWS/GCP/Azure, `Cluster.State` enum), `openapi.controlplane.yaml` (PATCH `/v1/clusters/{cluster.id}` body=ClusterUpdate, update_mask omitted), `shadow_link.proto` (ShadowLinkService control-plane paths, ShadowLinkCreate, states, Types 15/16/17), `scheduled_operation.proto` (ScheduledOperationService PREVIEW list-only), `operation.proto` (Type enum numbers), `pkg/cli/cloud/byoc/` (rpk plugin, version pinning, `BYOCPluginService.ListArtifactsByRedpandaID`), `apps/cloud-ui/src/utils/rpk.utils.ts` (`--project-id`/`--subscription-id` per provider), `proto/public/cloud/redpanda/api/byocplugin/v1alpha1/byoc_plugin.proto` (BYOCPluginService) | https://docs.redpanda.com/redpanda-cloud/reference/tiers/byoc-tiers/ |
| `skills/cloud-byoc/references/enterprise-features.md` | `docs` repo: `modules/get-started/pages/licensing/overview.adoc`, per-feature pages under `modules/manage/` and `modules/develop/`, property partials under `modules/reference/partials/properties/`; `cluster.proto` (`cluster_configuration.custom_properties`); `shadow_link.proto` (rpk shadow / control-plane DR) | https://docs.redpanda.com/cloud-data-platform/security/cloud-encryption/ (BYOK/CMK not offered), https://docs.redpanda.com/ (licensing, Tiered Storage, Iceberg, Audit Logging, Leadership Pinning, Shadow Linking, Kafka Connect defaults) |

## PREVIEW / beta markers to re-verify

These are gated by `(google.api.api_visibility).restriction = "PREVIEW"` or
`(google.api.field_visibility).restriction = "PREVIEW"` in the protos; confirm the marker
still exists before describing the feature as GA:

- `CloudProviderAccessService` — service-level PREVIEW (`cloud_provider_access.proto`).
- `ScheduledOperationService` — service-level PREVIEW, list-only (`scheduled_operation.proto`).
- `NetworkCreate.cloud_provider_access_id`, `NetworkCreate.egress_spec`, `Network.egress_spec` — field-level PREVIEW (`network.proto`).
- AWS Transit Gateway centralized egress for BYOC — beta, May 2026 (per docs/release notes; verify in `network.proto` `EgressSpec.AWS.transit_gateway_id`).
- BYOVPC on AWS — GA, March 2026 (per docs).

## Usage

For each skill file being reviewed or updated, open the listed source paths in `cloudv2`
first and confirm every claim still matches. Operation `Type` enum numbers, field numbers,
state enum values, and exact endpoint paths are the most fragile facts — always re-check
them against the proto rather than from memory.
