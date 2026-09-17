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
| `skills/cloud-byoc/references/networks.md` | `controlplane/v1/network.proto` (NetworkCreate incl. `cloud_provider_access_id` field 9 PREVIEW ~419-430, `egress_spec` field 8/13 PREVIEW + `Network.EgressSpec` oneof: AWS `transit_gateway_id`, GCP `hub_vpc_project`/`hub_vpc_name`, Azure `hub_vnet_id`/`firewall_private_ip`), `network_peering.proto` (NetworkPeeringService, AWS/GCP/Azure peering specs, states), `cloud_provider_access.proto` (CloudProviderAccessService PREVIEW AWS-only, `role_arn`/`external_id`), `cluster.proto` (`AWSPrivateLinkSpec`/`GCPPrivateServiceConnectSpec`/`AzurePrivateLinkSpec` ~1045-1116), `common.proto`, `operation.proto` (peering Types 13/14); **AWS `public_subnets`** (verified 2026-09-17): `network.proto` (`Network.UpdatableCustomerManagedResources`, `CustomerManagedAWSSubnets`), `apps/public-api-go/internal/services/network/v1/network_service.go` (`isUpdatableCustomerManagedResourcesMaskPath` — the three legal mask spellings; `unsupportedCustomerManagedResourcesMaskPath` → `INVALID_ARGUMENT` "not updatable"; the per-organization enablement guard on `customer_managed_resources.aws.public_subnets`), `apps/public-api-go/internal/services/network/v1/mapper.go` (`UpdateNetworkPublicToPrivate` collapsing every legal spelling to the settable leaf) | https://docs.redpanda.com/cloud-data-platform/networking/ , https://docs.redpanda.com/redpanda-cloud/networking/cidr-ranges/ |
| `skills/cloud-byoc/references/clusters-and-agent.md` | `controlplane/v1/cluster.proto` (ClusterCreate/ClusterUpdate fields incl. `redpanda_connect` (Create field 30 / Update field 22) + `Cluster.RedpandaConnect.allowed_destination_cidr_ports` and `Cluster.CidrPort` `{cidr, port_start, port_end}` max 16, `UpdateCluster` RPC ~141-152, `CustomerManagedResources` AWS/GCP/Azure, `Cluster.State` enum), `openapi.controlplane.yaml` (PATCH `/v1/clusters/{cluster.id}` body=ClusterUpdate, update_mask omitted), `shadow_link.proto` (ShadowLinkService control-plane paths, ShadowLinkCreate, states, Types 15/16/17, and the Cloud-only Schema Registry API-mode CEL rules: `sr_api_source_url_required` on Create, `sr_api_auth_options_only_basic_supported`, `sr_api_password_must_reference_secret`, `sr_api_tls_key_must_reference_secret`, `sr_api_tls_key_cert_both_or_neither`, `sr_api_tls_file_settings_not_supported`), public `redpanda` repo `proto/redpanda/core/admin/v2/shadow_link.proto` (`SchemaRegistrySyncOptions` shadowing-mode oneof, `ShadowSchemaRegistryApi` fields + defaults, `SchemaRegistrySourceFilter`, `SchemaRegistryContextDestination`, `UnsupportedSchemaFeaturePolicy`) and `proto/redpanda/core/common/v1/tls.proto` (nested `TLSSettings` / `TLSPEMSettings` / `TLSFileSettings`), private `docs` repo `modules/manage/pages/disaster-recovery/shadowing/migrate-schemas-confluent.adoc` (Confluent migration workflow, prerequisites, limitations, monitoring, Cloud configuration paths), `scheduled_operation.proto` (ScheduledOperationService PREVIEW list-only), `operation.proto` (Type enum numbers), `pkg/cli/cloud/byoc/` (rpk plugin, version pinning, `BYOCPluginService.ListArtifactsByRedpandaID`), `apps/cloud-ui/src/utils/rpk.utils.ts` (`--project-id`/`--subscription-id` per provider), `proto/public/cloud/redpanda/api/byocplugin/v1alpha1/byoc_plugin.proto` (BYOCPluginService); **dual listener mode** (verified 2026-09-17): `cluster.proto` (`ConnectionSpec` `{type, auth}`, `AuthSpec.mode`, `AuthMode` `AUTH_MODE_SASL`/`AUTH_MODE_MTLS`, `ConnectionStatus` `{config, endpoint}`, `KafkaAPISpec`/`HTTPProxySpec`/`SchemaRegistrySpec` `connections` field 3 + their `<service>_spec.connections.unique_type_auth_mode` CEL rules, deprecation comments on `connection_type` and on the `seed_brokers`/`url`/`mtls` endpoint fields), `apps/public-api-go/internal/services/cluster/v1/dual_mode_connections.go` (`validateConnections` all-three-services + same-topology + `connection_type`/`sasl` exclusivity, `validateConnectionSpecs` duplicate `(type, auth.mode)` reject, `validateConnectionsUpdate` mask-gating of in-play connections + no-clear rule, `validateConnectionsSemanticsForUpdate` kafka public-presence refusal wording, `crossesDualPublic` + the `migrate_connectivity` permission check, `validateServiceConnectionsMTLS`/`…ForUpdate` mtls block rules, `connectionsNotSupportedOnAzureErr`, and the per-organization enablement guard returning `REASON_FEATURE_NOT_ENABLED`); `cloud-docs` `modules/networking/pages/byoc/aws/dual-listener-mode.adoc` (published how-to: beta + AWS-only scope, max four connections per service, migration support matrix, BYOVPC public subnets) | https://docs.redpanda.com/redpanda-cloud/reference/tiers/byoc-tiers/ ; published page "Configure Dual Listener Mode" (Redpanda Cloud networking docs) |
| `skills/cloud-byoc/references/enterprise-features.md` | `docs` repo: `modules/get-started/pages/licensing/overview.adoc`, per-feature pages under `modules/manage/` and `modules/develop/`, property partials under `modules/reference/partials/properties/` (incl. `topic-properties.adoc` `redpanda.schema.registry.context` and `redpanda.storage.mode.impl`; `object-storage-properties.adoc` `default_redpanda_storage_mode_tiered_impl`), `modules/manage/partials/tiered-storage.adoc` (`tiered-storage-versions` tagged region: v1/v2 comparison, create-time-only version selection, restrictions), public `redpanda` repo `src/v/model/metadata.h` (`redpanda_storage_mode_tiered_impl` enum `tiered_v1`/`tiered_v2`) + `src/v/config/configuration.{h,cc}` (property definition), `modules/manage/pages/iceberg/specify-iceberg-schema.adoc` (section-based `redpanda.iceberg.mode` `key`/`value`/`headers` syntax + shorthand equivalents, `redpanda.schema.registry.context`); `cluster.proto` (`cluster_configuration.custom_properties`); `shadow_link.proto` (rpk shadow / control-plane DR) | https://docs.redpanda.com/cloud-data-platform/security/cloud-encryption/ (BYOK/CMK not offered), https://docs.redpanda.com/ (licensing, Tiered Storage, Iceberg, Audit Logging, Leadership Pinning, Shadow Linking, Kafka Connect defaults) |

## PREVIEW / beta markers to re-verify

These are gated by `(google.api.api_visibility).restriction = "PREVIEW"` or
`(google.api.field_visibility).restriction = "PREVIEW"` in the protos; confirm the marker
still exists before describing the feature as GA:

- `CloudProviderAccessService` — service-level PREVIEW (`cloud_provider_access.proto`).
- `ScheduledOperationService` — service-level PREVIEW, list-only (`scheduled_operation.proto`).
- `NetworkCreate.cloud_provider_access_id`, `NetworkCreate.egress_spec`, `Network.egress_spec` — field-level PREVIEW (`network.proto`).
- AWS Transit Gateway centralized egress for BYOC — beta, May 2026 (per docs/release notes; verify in `network.proto` `EgressSpec.AWS.transit_gateway_id`).
- GCP hub-VPC centralized egress for BYOC — beta, June 2026 (per Cloud changelog; verify in `network.proto` `EgressSpec.GCP.hub_vpc_project`/`hub_vpc_name`).
- Azure hub-VNet centralized egress for BYOC — beta, July 2026 (announced in the Cloud changelog). Proto fields `EgressSpec.Azure.hub_vnet_id`/`firewall_private_ip` remain field-level PREVIEW in `network.proto`; describe the customer-facing feature as beta (parity with AWS/GCP), not GA.
- BYOVPC on AWS — GA, March 2026 (per docs).
- Dual listener mode (per-service `connections`) — **beta**, AWS only, announced in the Cloud
  changelog in September 2026. `ConnectionSpec`, `AuthSpec`, `AuthMode`, and `ConnectionStatus`
  carry message/enum-level visibility restrictions in `cluster.proto`, and none of them appear in
  the generated `openapi.controlplane.yaml` (checked 2026-09-17) — so the skill describes the
  request shapes from the proto and the published how-to, and must not call the feature GA. Also
  per-organization enablement; re-verify both before changing the maturity wording.
- `Network.customer_managed_resources.aws.public_subnets` — beta, per-organization enablement
  (`network_service.go` guard). Required only for a dual-listener BYOVPC cluster.

## Usage

For each skill file being reviewed or updated, open the listed source paths in `cloudv2`
first and confirm every claim still matches. Operation `Type` enum numbers, field numbers,
state enum values, and exact endpoint paths are the most fragile facts — always re-check
them against the proto rather than from memory.
