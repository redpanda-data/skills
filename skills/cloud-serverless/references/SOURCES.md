# cloud-serverless Skill Source Map

Maps each file in `skills/cloud-serverless/` to the `cloudv2` source paths and
docs URLs it derives from, so future syncs and human maintainers know exactly
where to verify claims.

All proto paths are relative to the `redpanda-data/cloudv2` repository root.
Control-plane protos live under
`proto/public/cloud/redpanda/api/controlplane/v1/`; the data-plane surface is
the generated OpenAPI at `proto/gen/openapi/openapi.dataplane.yaml`. The
`cloudv2` repo is private; read it via the Redpanda-Github-Read MCP connector
(`search_code`, `get_file_contents`), not by cloning.

## File-to-source table

| Skill file | cloudv2 source paths | Docs URLs verified against |
|---|---|---|
| `SKILL.md` | `controlplane/v1/serverless.proto` (ServerlessClusterCreate fields, state machine, `private_link_id`, `networking_config`), `controlplane/v1/resource_group.proto`, `controlplane/v1/serverless_region.proto`, `controlplane/v1/operation.proto` (Operation.Type enum), `controlplane/v1/serverless_private_link.proto` (private-link service + create fields), `controlplane/v1/common.proto` (CloudProvider enum), `proto/gen/openapi/openapi.dataplane.yaml` (8-service data-plane table), `proto/gen/openapi/openapi.controlplane.yaml` (data-plane URL DNS pattern examples), `publicapi/controlplane.go`, `publicapi/dataplane.go` | https://docs.redpanda.com/redpanda-cloud/ , https://docs.redpanda.com/redpanda-cloud/networking/serverless |
| `references/auth.md` | rpk source: `auth0.go` (token URL, audience), `oauth.go` (Token struct, ClientCredentialFlow), `publicapi.go` (control-plane base URL, auth interceptors), `controlplane.go` / `dataplane.go` (reloading vs fixed-host interceptors), `service_account.proto` (ServiceAccount IAM fields) | https://docs.redpanda.com/redpanda-cloud/manage/api/cloud-api-overview/ |
| `references/control-plane-serverless.md` | `controlplane/v1/resource_group.proto` (name constraints, fields), `controlplane/v1/serverless_region.proto` (List/Get, filter.placement_enabled_only), `controlplane/v1/serverless.proto` (ServerlessClusterCreate, output fields, state machine, list filters, update, `private_link_id` `^[a-v0-9]{20}` + len 20, networking CEL rules), `controlplane/v1/serverless_private_link.proto` (paths, ServerlessPrivateLinkCreate fields, AWS-only CEL `cloudprovider==1 && has(aws_config)`, `allowed_principals` min 1, `allowed_regions` PREVIEW/max_items=0, State enum), `controlplane/v1/operation.proto` (Operation fields, Type enum incl. 10/11/12 private-link types), `controlplane/v1/common.proto` (CloudProvider), `publicapi/controlplane.go`, `publicapi.go` (`maxPages = 500`) | https://docs.redpanda.com/redpanda-cloud/networking/serverless |
| `references/data-plane.md` | `proto/gen/openapi/openapi.dataplane.yaml` (all endpoint paths, methods, body schemas, field names: `/v1/topics`, `/v1/acls`, `/v1/users`, `/v1/secrets`, `/v1/redpanda-connect/pipelines`, `/v1/roles`, `/v1/quotas`, `/v1/kafka-connect/clusters/{cluster_name}/connectors`, `/v1/monitoring/kafka/connections`, `/v1/cloud-storage/topics/mountable` + mount/unmount/mount-tasks, `/v1/transforms`, `/v1/redpanda-connect/mcp-servers`, `/v1/shadow-links/{name}/...` data-plane shadow-topic surface), `publicapi/dataplane.go` (`DataPlaneClientSet` service names); control-plane `controlplane/v1/shadow_link.proto` (`/v1/shadow-links`, `/v1/shadow-links/{id}`) for the Shadow Linking pointer | https://docs.redpanda.com/redpanda-cloud/develop/managed-connectors/ (Kafka Connect disabled by default since Jul 2025) |
| `references/enterprise-features.md` | `docs/modules/reference/partials/properties/topic-properties.adoc` (topic property keys, defaults, accepted values), `docs/modules/get-started/pages/licensing/overview.adoc` (enterprise-license requirement, license-expiry behavior), `docs` `about-iceberg-topics.adoc` (Iceberg mode semantics); `controlplane/v1/serverless_private_link.proto` (AWS PrivateLink); BYOK/CMK fact from cloud docs | https://docs.redpanda.com/cloud-data-platform/security/cloud-encryption/ (BYOK/CMK not offered; SSE-S3 / AES-256 Redpanda-managed) |

## Usage

For each file being reviewed or updated, open the listed `cloudv2` source paths
first and confirm that every claim in the skill file still matches. Re-confirm
exact field/enum/path spelling against the proto or OpenAPI before writing any
new fact.
