# Cloud Dedicated Skill Source Map

Maps each file in `skills/cloud-dedicated/` to the authoritative `cloudv2` source
paths and docs URLs it derives from, so future syncs and human maintainers know
exactly where to verify claims.

All cloudv2 paths are relative to the `redpanda-data/cloudv2` repository root.
Control-plane protos live under
`proto/public/cloud/redpanda/api/controlplane/v1/`; generated OpenAPI specs under
`proto/gen/openapi/`. Doc-source `.adoc` paths are in the `redpanda-data/docs`
(self-managed) and `redpanda-data/cloud-docs` (cloud) repositories.

## File-to-source table

| Skill file | cloudv2 source paths | Docs sources |
|---|---|---|
| `SKILL.md` | `controlplane/v1/cluster.proto` (`ClusterService`, `ClusterCreate`, `Cluster`), `network.proto`, `network_peering.proto`, `shadow_link.proto`, `operation.proto`, `region.proto`, `resource_group.proto`; `proto/gen/openapi/openapi.controlplane.yaml` | docs.redpanda.com Cloud API overview; `cloud-data-platform/networking/` |
| `references/model-and-auth.md` | `controlplane.go`, `publicapi.go` (auth flow, base URL, audience); `controlplane/v1/cluster.proto`, `serverless.proto` (Dedicated vs BYOC vs Serverless) | Auth0 client-credentials flow; Cloud console Clients tab |
| `references/create-cluster.md` | `controlplane/v1/cluster.proto` (`ClusterCreate` fields incl. `redpanda_connect` field 30, `ClusterUpdate` incl. `redpanda_connect` field 22, `Cluster.RedpandaConnect.allowed_destination_cidr_ports` + `Cluster.CidrPort` `{cidr, port_start, port_end}` max 16, `UpdateCluster` RPC `patch: "/v1/clusters/{cluster.id}"` + `body: "cluster"` + required top-level `update_mask`, `Cluster.State`, `AWSPrivateLinkSpec`/`GCPPrivateServiceConnectSpec`/`AzurePrivateLinkSpec`), `network.proto` (`NetworkCreate`, `cluster_type` validation), `network_peering.proto` (`NetworkPeeringService`, `NetworkPeeringCreate`, `AWS/GCP/AzurePeeringSpec`, `NetworkPeering.State`), `region.proto` (`/v1/regions/{cloud_provider}[/{name}]`), `operation.proto` (`Operation.Type`/`State` enums); `proto/gen/openapi/openapi.controlplane.yaml:~5623` (PATCH `/v1/clusters/{cluster.id}`, `ClusterUpdate` body, omitted `update_mask`) | `cloud-data-platform/networking/` |
| `references/data-plane.md` | `proto/gen/openapi/openapi.dataplane.yaml` (verified `/v1` paths: topics + `/v1/topics/{topic_name}/partitions`, acls, users, secrets, roles, quotas, transforms, `/v1/redpanda-connect/pipelines`, `/v1/cloud-storage/...`, `/v1/monitoring/kafka/connections`, `/v1/redpanda-connect/mcp-servers`, `/v1/redpanda-connect/components`, `/v1/redpanda-connect/config-schema`); `dataplane.go` (`DataPlaneClientSet` struct fields); `controlplane/v1/cluster.proto` (`Cluster.DataplaneAPI.url`) | — |
| `references/enterprise-features.md` | `controlplane/v1/shadow_link.proto` (control-plane `ShadowLinkService` paths, `ShadowLinkCreate`, `ShadowLinkClientOptions`, flat `TLSSettings`, `ShadowLink.State`), `operation.proto` (`TYPE_CREATE/UPDATE/DELETE_SHADOW_LINK = 15/16/17`); `proto/gen/openapi/openapi.dataplane.yaml` (data-plane `ShadowLinkService` `/v1/shadow-links/{name}`, `CloudStorageService` mount paths) | `docs` repo: `reference/partials/properties/topic-properties.adoc` (Iceberg `redpanda.iceberg.invalid.record.action` values `drop`/`dlq_table`, default `dlq_table`), `manage/partials/tiered-storage.adoc`, `develop/pages/manage-topics/cloud-topics.adoc`, `manage/pages/iceberg/*.adoc`, `manage/pages/cluster-maintenance/continuous-data-balancing.adoc`, `manage/pages/disaster-recovery/shadowing/setup.adoc`, `manage/partials/remote-read-replicas.adoc`, `manage/pages/mountable-topics.adoc`, `develop/pages/produce-data/leader-pinning.adoc`, `manage/pages/schema-reg/schema-id-validation.adoc`, `manage/partials/audit-logging.adoc`, `get-started/pages/licensing/overview.adoc`, `get-started/pages/licensing/disable-enterprise-features.adoc`; `cloud-docs` repo: `security/pages/cloud-encryption.adoc` (no BYOK/CMK; SSE-S3 Redpanda-managed key), `develop/pages/managed-connectors/disable-kc.adoc` + `get-started/pages/cloud-overview.adoc` (Kafka Connect disabled by default, Jul 2025) |

## Usage

For each file being reviewed or updated, open the listed source paths in `cloudv2`
first and confirm that every claim in the skill file still matches. Re-open the
exact cited proto/OpenAPI line before changing any endpoint path, field name, or
enum value.

The `cloudv2` repo is private; read it via the Redpanda-Github-Read MCP connector
(`search_code`, `get_file_contents`) or a local checkout at
`/Users/miche/projects/cloudv2`. Docs `.adoc` sources are in the local
`/Users/miche/projects/docs` and `/Users/miche/projects/cloud-docs` checkouts.
