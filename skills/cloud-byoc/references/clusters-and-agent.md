# Clusters and Agent

This reference covers creating and managing BYOC clusters via the Control Plane API, plus the full `rpk cloud byoc` agent plugin flow.

All field names and constraints are grounded in `cloudv2/proto/public/cloud/redpanda/api/controlplane/v1/cluster.proto` and `pkg/cli/cloud/byoc/`.

---

## Creating a BYOC Cluster

**Endpoint:** `POST /v1/clusters`

Returns a `CreateClusterOperation`. The `operation.metadata.cluster_id` field holds the new cluster's ID even before the operation completes.

### Required Fields (ClusterCreate)

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | Yes | 3–128 chars, pattern `^[A-Za-z0-9-:_]+$` |
| `resource_group_id` | string (UUID) | Yes | Must exist |
| `type` | enum | Yes | `TYPE_BYOC` |
| `cloud_provider` | enum | Yes | `CLOUD_PROVIDER_AWS`, `CLOUD_PROVIDER_GCP`, or `CLOUD_PROVIDER_AZURE` |
| `region` | string | Yes | Must match the network's region |
| `zones` | []string | Yes | Availability zones within the region (unique, non-empty) |
| `throughput_tier` | string | Yes | Tier identifier (see Redpanda Cloud tiers docs) |
| `network_id` | string | Yes | 20-char ID from a READY Network resource |

### Optional Fields

| Field | Type | Notes |
|---|---|---|
| `connection_type` | enum | `CONNECTION_TYPE_PUBLIC` or `CONNECTION_TYPE_PRIVATE`. Set explicitly — the proto zero-value is `CONNECTION_TYPE_UNSPECIFIED` (0). |
| `redpanda_version` | string | `major.minor` semver, e.g. `24.2` |
| `customer_managed_resources` | object | Provider-specific IAM/storage resources you pre-created. See below. |
| `kafka_api.mtls` / `kafka_api.sasl` | object | mTLS or SASL configuration |
| `http_proxy` | object | HTTP Proxy API settings |
| `schema_registry` | object | Schema Registry settings |
| `aws_private_link` | object | AWS PrivateLink (AWS only) |
| `gcp_private_service_connect` | object | GCP PSC (GCP only) |
| `azure_private_link` | object | Azure Private Link (Azure only) |
| `cloud_provider_tags` | map[string]string | Tags/labels placed on cloud resources (max 16 pairs). GCP: prefix `gcp.network-tag.` creates GKE network tags |
| `maintenance_window_config` | object | Scheduled maintenance window (`day_hour` or `anytime`) |
| `cluster_configuration.custom_properties` | Struct | Custom Redpanda cluster config properties (integers must be strings) |
| `redpanda_node_count` | int32 | Starting node count |
| `api_gateway_access` | enum | `NETWORK_ACCESS_MODE_PUBLIC` or `NETWORK_ACCESS_MODE_PRIVATE` |
| `redpanda_connect` | object | Redpanda Connect pipeline settings. `allowed_destination_cidr_ports[]` allowlists custom outbound destinations pipelines may reach. See [Redpanda Connect pipeline egress](#redpanda-connect-pipeline-egress-allowed_destination_cidr_ports) below. |

### Minimal AWS BYOC Cluster (Redpanda-managed network)

```bash
curl -s -X POST "${BASE}/v1/clusters" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "cluster": {
      "name": "my-byoc-cluster",
      "resource_group_id": "a0b40af9-0250-48ca-9417-783ed127ce42",
      "type": "TYPE_BYOC",
      "cloud_provider": "CLOUD_PROVIDER_AWS",
      "region": "us-east-1",
      "zones": ["use1-az1", "use1-az2", "use1-az3"],
      "throughput_tier": "tier-1-aws-v2-arm",
      "network_id": "cjcuq79c4vs94fcufc2g",
      "connection_type": "CONNECTION_TYPE_PUBLIC"
    }
  }' | jq .
```

### GCP BYOC Cluster

```bash
curl -s -X POST "${BASE}/v1/clusters" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "cluster": {
      "name": "my-byoc-gcp",
      "resource_group_id": "a0b40af9-0250-48ca-9417-783ed127ce42",
      "type": "TYPE_BYOC",
      "cloud_provider": "CLOUD_PROVIDER_GCP",
      "region": "us-central1",
      "zones": ["us-central1-a", "us-central1-b", "us-central1-c"],
      "throughput_tier": "tier-1-gcp-v2-x86",
      "network_id": "dk2xq89c4vs94fcufc3h"
    }
  }' | jq .
```

### With Cloud Provider Tags

```bash
# Tags placed on cloud resources; GCP network tags use "gcp.network-tag." prefix
-d '{
  "cluster": {
    ...
    "cloud_provider_tags": {
      "environment": "production",
      "team": "platform",
      "gcp.network-tag.allow-redpanda": ""
    }
  }
}'
```

---

## Customer-Managed Resources at Cluster Level

For full BYOVPC clusters, you can also provide customer-managed IAM resources at the **cluster level** (in addition to the network level). This is the `customer_managed_resources` object in `ClusterCreate`.

### AWS Cluster Customer-Managed Resources

Required fields for `customer_managed_resources.aws`:

| Field | Description |
|---|---|
| `agent_instance_profile.arn` | ARN of instance profile for the Redpanda agent |
| `connectors_node_group_instance_profile.arn` | ARN for connectors node group |
| `utility_node_group_instance_profile.arn` | ARN for utility broker node group |
| `redpanda_node_group_instance_profile.arn` | ARN for Redpanda broker nodes |
| `k8s_cluster_role.arn` | ARN of IAM role for EKS cluster |
| `redpanda_agent_security_group.arn` | ARN of security group for agent VM |
| `connectors_security_group.arn` | ARN of security group for connectors |
| `redpanda_node_group_security_group.arn` | ARN of security group for Redpanda nodes |
| `utility_security_group.arn` | ARN of security group for utility nodes |
| `cluster_security_group.arn` | ARN of security group for EKS cluster |
| `node_security_group.arn` | ARN of security group for all nodes |
| `cloud_storage_bucket.arn` | ARN of S3 bucket for tiered storage |
| `permissions_boundary_policy.arn` | ARN of IAM policy used as permissions boundary |

### GCP Cluster Customer-Managed Resources

Core fields for `customer_managed_resources.gcp` (see `cluster.proto` `CustomerManagedResources.GCP` for the authoritative and complete list, including optional/conditional fields):

| Field | Description |
|---|---|
| `subnet.name` | GCP subnet name |
| `subnet.secondary_ipv4_range_pods.name` | Secondary IP range for pods |
| `subnet.secondary_ipv4_range_services.name` | Secondary IP range for services |
| `subnet.k8s_master_ipv4_range` | GKE master CIDR (e.g. `10.0.0.0/24`) |
| `agent_service_account.email` | GCP SA email for the agent |
| `console_service_account.email` | GCP SA email for Redpanda Console |
| `connector_service_account.email` | GCP SA email for managed connectors |
| `redpanda_cluster_service_account.email` | GCP SA email for the Redpanda cluster |
| `gke_service_account.email` | GCP SA email for GKE |
| `tiered_storage_bucket.name` | GCS bucket name for tiered storage |
| `redpanda_connect_api_service_account.email` | GCP SA email for Connect API |
| `redpanda_connect_service_account.email` | GCP SA email for Connect |

Additional optional/conditional fields in the proto include `redpanda_operator_service_account.email` (proto field 11) and PSC NAT subnet fields `psc_nat_subnet_name` (PSC v1) and `psc_v2_nat_subnet_name` (PSC v2).

### Azure Cluster Customer-Managed Resources

Required fields for `customer_managed_resources.azure`:

| Field | Description |
|---|---|
| `resource_groups.redpanda_resource_group.name` | RG holding AKS and core resources |
| `resource_groups.storage_resource_group.name` | RG holding tiered storage |
| `resource_groups.iam_resource_group.name` | RG holding workload identities |
| `user_assigned_identities.agent_user_assigned_identity.name` | UAI for the agent |
| `user_assigned_identities.aks_user_assigned_identity.name` | UAI for AKS |
| `user_assigned_identities.redpanda_cluster_assigned_identity.name` | UAI for the cluster |
| `user_assigned_identities.cert_manager_assigned_identity.name` | UAI for cert-manager |
| `user_assigned_identities.external_dns_assigned_identity.name` | UAI for external-dns |
| `user_assigned_identities.redpanda_console_assigned_identity.name` | UAI for Console |
| `user_assigned_identities.kafka_connect_assigned_identity.name` | UAI for Kafka Connect |
| `user_assigned_identities.redpanda_connect_assigned_identity.name` | UAI for Connect |
| `user_assigned_identities.redpanda_connect_api_assigned_identity.name` | UAI for Connect API |
| `user_assigned_identities.redpanda_operator_assigned_identity.name` | UAI for operator |
| `tiered_cloud_storage.storage_account_name` | Azure Storage Account name |
| `tiered_cloud_storage.storage_container_name` | Blob container name |
| `tiered_cloud_storage.resource_group.name` | RG for the storage account |
| `key_vaults.management_vault.name` | Azure Key Vault for deployment secrets |
| `key_vaults.console_vault.name` | Azure Key Vault for Console |
| `security_groups.redpanda_security_group.name` | NSG for the cluster |
| `cidrs.aks_service_cidr` | CIDR for AKS Kubernetes services |

---

## Redpanda Connect Pipeline Egress (allowed_destination_cidr_ports)

`redpanda_connect.allowed_destination_cidr_ports` — settable on `ClusterCreate` and `ClusterUpdate` — allowlists the custom outbound destinations that Redpanda Connect pipelines running on the cluster may reach (for example, an external database or API in a peered network). Each entry is a `Cluster.CidrPort`:

| Field | Type | Notes |
|---|---|---|
| `cidr` | string | IPv4 CIDR, pattern `^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$`, e.g. `10.5.0.0/16` |
| `port_start` | int32 | Start of the TCP/UDP port range, 1–65535 |
| `port_end` | int32 | Optional end of the port range, 0–65535. `0` (the default) means a single port (`port_start` only); when non-zero it must be ≥ `port_start` |

Maximum 16 entries; each `cidr:port_start:port_end` tuple must be unique. On read-back, `Cluster.redpanda_connect` is output-only and also reports the Connect engine `version`.

```json
{
  "redpanda_connect": {
    "allowed_destination_cidr_ports": [
      {"cidr": "10.5.0.0/16", "port_start": 5432},
      {"cidr": "10.6.0.0/16", "port_start": 8000, "port_end": 8100}
    ]
  }
}
```

Source: `cluster.proto` (`Cluster.RedpandaConnect.allowed_destination_cidr_ports`, `Cluster.CidrPort`; `ClusterCreate.redpanda_connect`, `ClusterUpdate.redpanda_connect`).

---

## Cluster State Machine

States are defined in the `Cluster.State` enum in `cluster.proto`:

| State | Meaning |
|---|---|
| `STATE_CREATING_AGENT` | Cluster created in control plane; waiting for `rpk cloud byoc apply` |
| `STATE_CREATING` | Agent installed; brokers provisioning |
| `STATE_READY` | Fully operational; data-plane URL available |
| `STATE_UPGRADING` | Version upgrade in progress |
| `STATE_DELETING_AGENT` | Delete requested; waiting for `rpk cloud byoc destroy` |
| `STATE_DELETING` | Agent removed; cleaning up cluster resources |
| `STATE_FAILED` | An error occurred; check `state_description` |
| `STATE_SUSPENDED` | Cluster is suspended |

**Key insight:** The cluster enters `STATE_CREATING_AGENT` immediately after the CreateCluster operation reaches `STATE_COMPLETED`. You must run `rpk cloud byoc apply` while in this state; the cluster will not progress on its own.

---

## Polling Operations

Every mutating cluster/network call returns an `Operation`. Check it repeatedly:

```bash
# Wait for operation to complete
OP_ID="cjcuq79c4vs94fcufc2g"
while true; do
  RESULT=$(curl -s "${BASE}/v1/operations/${OP_ID}" \
    -H "Authorization: Bearer ${TOKEN}")
  STATE=$(echo "${RESULT}" | jq -r '.operation.state')
  echo "Operation state: ${STATE}"
  case "${STATE}" in
    "STATE_COMPLETED") echo "Done!"; break ;;
    "STATE_FAILED")
      echo "Failed: $(echo "${RESULT}" | jq '.operation.error')"
      exit 1 ;;
    *) sleep 15 ;;
  esac
done
```

The Operation object has:
- `id` — 20-char operation ID
- `state` — `STATE_IN_PROGRESS`, `STATE_COMPLETED`, `STATE_FAILED`
- `type` — e.g. `TYPE_CREATE_CLUSTER`, `TYPE_DELETE_CLUSTER`, `TYPE_CREATE_NETWORK`
- `metadata` — provider-specific metadata (e.g. `cluster_id` for create cluster)
- `resource_id` — the ID of the created/deleted resource (once available)
- `error` — set only if `state` is `STATE_FAILED`
- `started_at`, `finished_at` — RFC3339 timestamps

### Scheduled Operations (PREVIEW, read-only)

`GET /v1/scheduled-operations` lists scheduled cluster operations such as suspend/resume schedules and pending maintenance. This is **PREVIEW** and **read-only** — only `ListScheduledOperations` is enabled (the planned update RPC is not). Filters: `filter.cluster_id`, `filter.states[]` (`STATE_SCHEDULED/IN_PROGRESS/COMPLETED/FAILED`), and a `filter.schedule_time_start`/`filter.schedule_time_end` range. Source: `scheduled_operation.proto`.

---

## Getting and Listing Clusters

```bash
# Get a specific cluster (includes dataplane_api.url)
curl -s "${BASE}/v1/clusters/${CLUSTER_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.cluster | {id, name, state, current_redpanda_version}'

# List clusters (NOTE: dataplane_api.url is NOT returned in list — use Get)
curl -s "${BASE}/v1/clusters" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.clusters[] | {id, name, state}'

# Filter by resource group
curl -s "${BASE}/v1/clusters?filter.resource_group_id=${RG_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.clusters[].name'
```

The data-plane URL for topic/ACL/user operations is in the response:
```bash
DP_URL=$(curl -s "${BASE}/v1/clusters/${CLUSTER_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq -r '.cluster.dataplane_api.url')
```

---

## Updating a Cluster

`PATCH /v1/clusters/{id}` with a `ClusterUpdate` body. Also returns an `UpdateClusterOperation`.

Updatable fields include: `name`, `kafka_api`, `http_proxy`, `schema_registry`, `aws_private_link`/`gcp_private_service_connect`/`azure_private_link`, `customer_managed_resources`, `cloud_provider_tags`, `maintenance_window_config`, `throughput_tier`, `redpanda_node_count`, `api_gateway_access`, `redpanda_connect`.

**`update_mask` is a REQUIRED query parameter**, not a body field. From `cluster.proto` the `UpdateCluster` RPC is `patch: "/v1/clusters/{cluster.id}"` with `body: "cluster"`, plus a separate top-level required `update_mask` FieldMask. Two consequences:

- Pass `update_mask` as a query param: `?update_mask=<comma-separated snake_case field paths>` (the API uses proto field names — e.g. `throughput_tier`, `cluster_configuration.custom_properties` — verified against the live `ClusterService.UpdateCluster` contract). The generated OpenAPI omits this parameter — a known grpc-gateway quirk for top-level FieldMask fields — but it is still required.
- Because `body: "cluster"`, the JSON body maps directly to the `cluster` (`ClusterUpdate`) field. The body **is** the `ClusterUpdate` object — do **not** wrap it as `{"cluster":{...}}`, and do **not** put `update_mask` in the body.

```bash
# Upgrade throughput tier — update_mask in the query string, ClusterUpdate fields in the body
curl -s -X PATCH "${BASE}/v1/clusters/${CLUSTER_ID}?update_mask=throughput_tier" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"throughput_tier": "tier-2-aws-v2-arm"}' | jq .
```

---

## Deleting a Cluster

```bash
curl -s -X DELETE "${BASE}/v1/clusters/${CLUSTER_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.operation.id'
```

Returns a `DeleteClusterOperation`. After the operation starts, the cluster moves to `STATE_DELETING_AGENT`. Run `rpk cloud byoc destroy` to tear down Terraform resources.

---

## Shadow Linking (control-plane API)

Shadow Linking is Redpanda's enterprise cross-cluster DR (asynchronous, offset-preserving replication between two clusters). It can be driven entirely through the **control-plane** `ShadowLinkService` — a first-class API complementary to the `rpk shadow` CLI flow documented in [Enterprise Features](enterprise-features.md#shadow-linking-cross-cluster-disaster-recovery). Grounded in `shadow_link.proto`.

These are **control-plane** paths under `api.redpanda.com` (not the per-cluster data-plane URL):

| Operation | Endpoint | Returns |
|---|---|---|
| Create | `POST /v1/shadow-links` | `Operation` (202 Accepted) |
| Get | `GET /v1/shadow-links/{id}` | `ShadowLink` |
| List | `GET /v1/shadow-links` | `ShadowLinkListItem[]` |
| Update | `PATCH /v1/shadow-links/{shadow_link.id}` | `Operation` (202 Accepted) |
| Delete | `DELETE /v1/shadow-links/{id}` | `Operation` (202 Accepted) |

### ShadowLinkCreate fields

| Field | Required | Notes |
|---|---|---|
| `shadow_redpanda_id` | Yes | The target (shadow) cluster where the link is created. Immutable. |
| `name` | Yes | DNS-1123 subdomain, max 63 chars, pattern `^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`. Unique. |
| `source_redpanda_id` **XOR** `client_options.bootstrap_servers` | Yes | Mutually exclusive, CEL-enforced — supply exactly one. `source_redpanda_id` auto-derives bootstrap servers from a known cluster; `bootstrap_servers` points at an external source. |
| `client_options` | No | Kafka client config: `bootstrap_servers`, `tls_settings`, `authentication_configuration`, fetch/retry timing. SCRAM/PLAIN passwords must reference a data-plane secret as `${secrets.<SECRET_ID>}`. |
| `topic_metadata_sync_options` | No | What topic metadata to mirror. |
| `consumer_offset_sync_options` | No | Consumer group offset replication. |
| `security_sync_options` | No | ACL / security-settings replication. |
| `schema_registry_sync_options` | No | Schema Registry replication. |

`PATCH` uses an `UpdateShadowLinkRequest` with a required `update_mask` and a `shadow_link` (`ShadowLinkUpdate`) body; updatable fields are the five sync-options groups plus `client_options`.

```bash
# Create a shadow link from a known source cluster (control plane)
curl -s -X POST "${BASE}/v1/shadow-links" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d '{
    "shadow_link": {
      "shadow_redpanda_id": "cjcuq79c4vs94fcufc2g",
      "name": "dr-link",
      "source_redpanda_id": "dk2xq89c4vs94fcufc3h"
    }
  }' | jq '.operation.id'
```

**Operation types:** `TYPE_CREATE_SHADOW_LINK` = 15, `TYPE_UPDATE_SHADOW_LINK` = 16, `TYPE_DELETE_SHADOW_LINK` = 17.

**States:** `STATE_CREATING`, `STATE_CREATION_FAILED`, `STATE_DELETING`, `STATE_DELETION_FAILED`, `STATE_ACTIVE`, `STATE_PAUSED`.

---

## rpk cloud byoc Plugin: Full Reference

The byoc plugin is a downloaded binary managed by rpk. It wraps Terraform calls to provision/destroy the agent infrastructure in your cloud account.

Source: `pkg/cli/cloud/byoc/byoc.go` and `install.go`

### Commands

```bash
# Install the plugin for a specific cluster version
rpk cloud byoc install --redpanda-id <cluster-id>
# Output: "BYOC plugin installed successfully!"
# If already up to date: "Your BYOC plugin is currently up to date, avoiding reinstalling!"
# Note: RPK_CLOUD_SKIP_VERSION_CHECK only bypasses the check when a plugin is already installed.

# Uninstall the local plugin binary
rpk cloud byoc uninstall

# Provider-specific apply/destroy/validate subcommands
# (these are handled by the downloaded plugin binary)
# GCP apply/destroy require --project-id; Azure apply/destroy require --subscription-id.
rpk cloud byoc aws apply     --redpanda-id <cluster-id>
rpk cloud byoc aws destroy   --redpanda-id <cluster-id>
rpk cloud byoc aws validate

rpk cloud byoc gcp apply     --redpanda-id <cluster-id> --project-id <gcp-project-id>
rpk cloud byoc gcp destroy   --redpanda-id <cluster-id> --project-id <gcp-project-id>
rpk cloud byoc gcp validate

rpk cloud byoc azure apply   --redpanda-id <cluster-id> --subscription-id <azure-sub-id>
rpk cloud byoc azure destroy --redpanda-id <cluster-id> --subscription-id <azure-sub-id>
# Note: aws and gcp validate are confirmed; azure validate is not separately attested.
```

The per-provider account flags (`--project-id` for GCP, `--subscription-id` for Azure) identify the target cloud account for the Terraform run. Source: `apps/cloud-ui/src/utils/rpk.utils.ts` (the UI builds the destroy command with these flags; apply takes the same flags).

### Plugin Version Pinning

The plugin binary version is pinned to what the control plane specifies for your cluster. This ensures the Terraform version matches the cluster's agent requirements. The pinning flow:

1. rpk calls `BYOCPluginService.ListArtifactsByRedpandaID` with your cluster ID
2. The API returns the required artifact URL with an embedded SHA256 checksum
3. rpk checks if the installed binary matches that SHA
4. If not (or no plugin installed), it downloads and verifies the new binary
5. The binary is stored in rpk's managed plugin path (e.g. `~/.local/bin/`)

**Bypass version check (dev/CI only):**
```bash
export RPK_CLOUD_SKIP_VERSION_CHECK=1
rpk cloud byoc aws apply --redpanda-id <cluster-id>
```

For `validate`, rpk always downloads the **latest** plugin version (no cluster ID required).

### Authentication for rpk byoc

The plugin receives the Bearer token automatically from rpk. You never pass it manually. Auth options, in order of preference:

```bash
# 1. Already logged in (token in rpk.yaml)
rpk cloud byoc aws apply --redpanda-id <id>

# 2. Client credentials via -X flags
rpk cloud byoc aws apply --redpanda-id <id> \
  -X cloud.client_id="${CLIENT_ID}" \
  -X cloud.client_secret="${CLIENT_SECRET}"

# 3. Environment variables
export RPK_CLOUD_CLIENT_ID="${CLIENT_ID}"
export RPK_CLOUD_CLIENT_SECRET="${CLIENT_SECRET}"
rpk cloud byoc aws apply --redpanda-id <id>

# 4. Direct flags
rpk cloud byoc aws apply --redpanda-id <id> \
  --client-id "${CLIENT_ID}" \
  --client-secret "${CLIENT_SECRET}"
```

Note: `--cloud-api-token` is a hidden flag used internally by the plugin — never set it manually.

### Complete BYOC Provisioning Script

```bash
#!/usr/bin/env bash
set -euo pipefail

CLIENT_ID="${RPK_CLOUD_CLIENT_ID}"
CLIENT_SECRET="${RPK_CLOUD_CLIENT_SECRET}"
BASE="https://api.redpanda.com"
REGION="us-east-1"
PROVIDER="aws"

# Authenticate
TOKEN=$(curl -s -X POST "https://auth.prd.cloud.redpanda.com/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "client_id=${CLIENT_ID}" \
  --data-urlencode "client_secret=${CLIENT_SECRET}" \
  --data-urlencode "audience=cloudv2-production.redpanda.cloud" \
  | jq -r '.access_token')

auth_header() { echo "Authorization: Bearer ${TOKEN}"; }

# Create resource group (body must use the "resource_group" wrapper key)
RG=$(curl -s -X POST "${BASE}/v1/resource-groups" \
  -H "$(auth_header)" -H "Content-Type: application/json" \
  -d '{"resource_group": {"name": "byoc-rg"}}')
RG_ID=$(echo "${RG}" | jq -r '.resource_group.id')
echo "Resource group: ${RG_ID}"

# Create network
NET_OP=$(curl -s -X POST "${BASE}/v1/networks" \
  -H "$(auth_header)" -H "Content-Type: application/json" \
  -d "{\"network\": {
    \"name\": \"byoc-network\",
    \"resource_group_id\": \"${RG_ID}\",
    \"cloud_provider\": \"CLOUD_PROVIDER_AWS\",
    \"region\": \"${REGION}\",
    \"cidr_block\": \"10.0.0.0/20\",
    \"cluster_type\": \"TYPE_BYOC\"
  }}")
NET_OP_ID=$(echo "${NET_OP}" | jq -r '.operation.id')
echo "Network operation: ${NET_OP_ID}"

# Wait for network
until [ "$(curl -s "${BASE}/v1/operations/${NET_OP_ID}" \
    -H "$(auth_header)" | jq -r '.operation.state')" = "STATE_COMPLETED" ]; do
  sleep 10; echo "Waiting for network..."
done

NET_ID=$(curl -s "${BASE}/v1/networks?filter.name_contains=byoc-network" \
  -H "$(auth_header)" | jq -r '.networks[0].id')
echo "Network ID: ${NET_ID}"

# Create cluster
CLUSTER_OP=$(curl -s -X POST "${BASE}/v1/clusters" \
  -H "$(auth_header)" -H "Content-Type: application/json" \
  -d "{\"cluster\": {
    \"name\": \"byoc-cluster\",
    \"resource_group_id\": \"${RG_ID}\",
    \"type\": \"TYPE_BYOC\",
    \"cloud_provider\": \"CLOUD_PROVIDER_AWS\",
    \"region\": \"${REGION}\",
    \"zones\": [\"use1-az1\", \"use1-az2\", \"use1-az3\"],
    \"throughput_tier\": \"tier-1-aws-v2-arm\",
    \"network_id\": \"${NET_ID}\"
  }}")
CLUSTER_OP_ID=$(echo "${CLUSTER_OP}" | jq -r '.operation.id')

# Extract cluster ID from operation metadata
until CLUSTER_ID=$(curl -s "${BASE}/v1/operations/${CLUSTER_OP_ID}" \
    -H "$(auth_header)" | jq -r '.operation.metadata.cluster_id // empty'); \
    [ -n "${CLUSTER_ID}" ]; do
  sleep 5
done
echo "Cluster ID: ${CLUSTER_ID}"

# Wait for CREATING_AGENT state
until [ "$(curl -s "${BASE}/v1/clusters/${CLUSTER_ID}" \
    -H "$(auth_header)" | jq -r '.cluster.state')" = "STATE_CREATING_AGENT" ]; do
  sleep 15; echo "Waiting for CREATING_AGENT state..."
done

# Install and apply the byoc agent
rpk cloud byoc install --redpanda-id "${CLUSTER_ID}" \
  -X cloud.client_id="${CLIENT_ID}" \
  -X cloud.client_secret="${CLIENT_SECRET}"

rpk cloud byoc "${PROVIDER}" apply --redpanda-id "${CLUSTER_ID}" \
  -X cloud.client_id="${CLIENT_ID}" \
  -X cloud.client_secret="${CLIENT_SECRET}"

# Wait for READY
until [ "$(curl -s "${BASE}/v1/clusters/${CLUSTER_ID}" \
    -H "$(auth_header)" | jq -r '.cluster.state')" = "STATE_READY" ]; do
  sleep 30; echo "Waiting for cluster to be READY..."
done

# Get the data-plane URL
DP_URL=$(curl -s "${BASE}/v1/clusters/${CLUSTER_ID}" \
  -H "$(auth_header)" | jq -r '.cluster.dataplane_api.url')

echo "Cluster READY. Data plane URL: ${DP_URL}"
```
