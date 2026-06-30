# Networks

A **Network** resource registers your VPC or VNet with Redpanda's control plane so a BYOC cluster can be placed inside it. The network must exist and be in `STATE_READY` before you create a cluster.

All field names and constraints in this document are grounded in `cloudv2/proto/public/cloud/redpanda/api/controlplane/v1/network.proto` and `common.proto`.

## Network States

```
STATE_CREATING → STATE_READY
STATE_DELETING → (deleted)
STATE_FAILED
```

## Creating a Network

**Endpoint:** `POST /v1/networks`

Returns a `CreateNetworkOperation` with an `operation.id` (20-char alphanumeric). Poll `GET /v1/operations/{id}` until `state` is `STATE_COMPLETED`.

### Required Fields (NetworkCreate)

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | Yes | Unique within your org |
| `resource_group_id` | string (UUID) | Yes | Billing/org container ID |
| `cloud_provider` | enum | Yes | `CLOUD_PROVIDER_AWS`, `CLOUD_PROVIDER_GCP`, or `CLOUD_PROVIDER_AZURE` |
| `region` | string | Yes | Cloud provider region (e.g. `us-east-1`, `us-central1`, `eastus`) |
| `cluster_type` | enum | Yes | `TYPE_BYOC` (or `TYPE_DEDICATED` for dedicated clusters) |
| `cidr_block` | string | Yes* | Min /21 CIDR. Required unless `customer_managed_resources` is set |
| `customer_managed_resources` | object | Conditional | Set this instead of `cidr_block` if using BYOVPC (customer-owned VPC) |
| `cloud_provider_access_id` | string (20-char) | Conditional | **PREVIEW.** Reference to a `CloudProviderAccess` for cross-account provisioning. Valid only with `cluster_type=TYPE_BYOC` and `cloud_provider=CLOUD_PROVIDER_AWS`. Mutually exclusive with `customer_managed_resources`. See [Cloud Provider Access](#cloud-provider-access-preview-aws-only). |
| `egress_spec` | object | Conditional | **PREVIEW.** Configures how outbound traffic leaves the network (e.g. AWS Transit Gateway centralized egress). See [Centralized egress](#centralized-egress-transit-gateway--hub-vpc-preview). |

### Option A: Redpanda-Managed Network (CIDR-based)

Redpanda creates the VPC/VNet in your account using the agent. You supply a CIDR block; Redpanda creates subnets within it.

```bash
curl -s -X POST "${BASE}/v1/networks" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "network": {
      "name": "my-byoc-network",
      "resource_group_id": "a0b40af9-0250-48ca-9417-783ed127ce42",
      "cloud_provider": "CLOUD_PROVIDER_AWS",
      "region": "us-east-1",
      "cidr_block": "10.0.0.0/20",
      "cluster_type": "TYPE_BYOC"
    }
  }' | jq .
```

**CIDR constraint:** Minimum /21 (2048 addresses). See [Choose CIDR Ranges](https://docs.redpanda.com/redpanda-cloud/networking/cidr-ranges/).

### Option B: Customer-Managed VPC (BYOVPC)

You pre-create the VPC and all required IAM/storage resources. Pass `customer_managed_resources` instead of `cidr_block`. The exact sub-fields depend on cloud provider.

---

## AWS Customer-Managed Resources (Network)

When creating an AWS network with BYOVPC, the `customer_managed_resources.aws` object requires:

| Field | Description |
|---|---|
| `management_bucket.arn` | ARN of pre-created S3 bucket storing Terraform state |
| `dynamodb_table.arn` | ARN of pre-created DynamoDB table for Terraform locks |
| `vpc.arn` | ARN of your pre-created VPC (pattern: `arn:aws:ec2:<region>:<account>:vpc/<vpc-id>`) |
| `private_subnets.arns` | List of private subnet ARNs (pattern: `arn:aws:ec2:<region>:<account>:subnet/<subnet-id>`) |

```bash
curl -s -X POST "${BASE}/v1/networks" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "network": {
      "name": "my-byovpc-aws",
      "resource_group_id": "a0b40af9-0250-48ca-9417-783ed127ce42",
      "cloud_provider": "CLOUD_PROVIDER_AWS",
      "region": "us-east-1",
      "cluster_type": "TYPE_BYOC",
      "customer_managed_resources": {
        "aws": {
          "management_bucket": {
            "arn": "arn:aws:s3:::my-redpanda-tf-state"
          },
          "dynamodb_table": {
            "arn": "arn:aws:dynamodb:us-east-1:123456789012:table/redpanda-tf-locks"
          },
          "vpc": {
            "arn": "arn:aws:ec2:us-east-1:123456789012:vpc/vpc-0abc1234"
          },
          "private_subnets": {
            "arns": [
              "arn:aws:ec2:us-east-1:123456789012:subnet/subnet-0111aaaa",
              "arn:aws:ec2:us-east-1:123456789012:subnet/subnet-0222bbbb",
              "arn:aws:ec2:us-east-1:123456789012:subnet/subnet-0333cccc"
            ]
          }
        }
      }
    }
  }' | jq .
```

---

## GCP Customer-Managed Resources (Network)

For GCP BYOVPC, `customer_managed_resources.gcp` requires:

| Field | Type | Description |
|---|---|---|
| `network_name` | string | Name of your pre-created GCP network (max 62 chars, `^[a-z]([-a-z0-9]*[a-z0-9])?$`) |
| `network_project_id` | string | GCP project ID where the network lives (max 30 chars, same pattern) |
| `management_bucket.name` | string | GCS bucket name storing Terraform state (3–63 chars, `^[a-z]([-_a-z0-9]*[a-z0-9])?$`) |

```bash
curl -s -X POST "${BASE}/v1/networks" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "network": {
      "name": "my-byovpc-gcp",
      "resource_group_id": "a0b40af9-0250-48ca-9417-783ed127ce42",
      "cloud_provider": "CLOUD_PROVIDER_GCP",
      "region": "us-central1",
      "cluster_type": "TYPE_BYOC",
      "customer_managed_resources": {
        "gcp": {
          "network_name": "my-redpanda-vpc",
          "network_project_id": "my-gcp-project",
          "management_bucket": {
            "name": "my-redpanda-tf-state"
          }
        }
      }
    }
  }' | jq .
```

---

## Azure Customer-Managed Resources (Network)

For Azure BYOVPC, `customer_managed_resources.azure` requires:

| Field | Description |
|---|---|
| `management_bucket.storage_account_name` | Azure storage account name (3–24 chars, lowercase alphanumeric) |
| `management_bucket.storage_container_name` | Blob container name (3–63 chars) |
| `management_bucket.resource_group.name` | Resource group holding the storage account |
| `vnet.name` | Azure VNet name (2–64 chars) |
| `vnet.resource_group.name` | Resource group holding the VNet |

Azure also requires a set of named subnets for different workload types. Each subnet must be pre-created:

| Subnet field | Purpose |
|---|---|
| `rp_agent` | Redpanda Agent |
| `rp_0_pods`, `rp_1_pods`, `rp_2_pods` | Redpanda broker pod subnets |
| `rp_0_vnet`, `rp_1_vnet`, `rp_2_vnet` | Redpanda broker VNet subnets |
| `rp_connect_pods`, `rp_connect_vnet` | Redpanda Connect |
| `kafka_connect_pods`, `kafka_connect_vnet` | Kafka Connect |
| `sys_pods`, `sys_vnet` | System workloads |
| `rp_egress_vnet` | Egress |

```bash
# Azure network creation (abbreviated — all subnets required)
curl -s -X POST "${BASE}/v1/networks" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "network": {
      "name": "my-byovpc-azure",
      "resource_group_id": "a0b40af9-0250-48ca-9417-783ed127ce42",
      "cloud_provider": "CLOUD_PROVIDER_AZURE",
      "region": "eastus",
      "cluster_type": "TYPE_BYOC",
      "customer_managed_resources": {
        "azure": {
          "management_bucket": {
            "storage_account_name": "myredpandastate",
            "storage_container_name": "tf-state",
            "resource_group": { "name": "rp-storage-rg" }
          },
          "vnet": {
            "name": "my-redpanda-vnet",
            "resource_group": { "name": "rp-network-rg" }
          },
          "subnets": {
            "rp_agent":        { "name": "rp-agent-subnet" },
            "rp_0_pods":       { "name": "rp-0-pods-subnet" },
            "rp_0_vnet":       { "name": "rp-0-vnet-subnet" },
            "rp_1_pods":       { "name": "rp-1-pods-subnet" },
            "rp_1_vnet":       { "name": "rp-1-vnet-subnet" },
            "rp_2_pods":       { "name": "rp-2-pods-subnet" },
            "rp_2_vnet":       { "name": "rp-2-vnet-subnet" },
            "rp_connect_pods": { "name": "rp-connect-pods-subnet" },
            "rp_connect_vnet": { "name": "rp-connect-vnet-subnet" },
            "sys_pods":        { "name": "sys-pods-subnet" },
            "sys_vnet":        { "name": "sys-vnet-subnet" },
            "rp_egress_vnet":  { "name": "rp-egress-vnet-subnet" },
            "kafka_connect_pods": { "name": "kc-pods-subnet" },
            "kafka_connect_vnet": { "name": "kc-vnet-subnet" }
          }
        }
      }
    }
  }' | jq .
```

---

## Listing and Getting Networks

```bash
# List all networks (paginated, up to 100 per page)
curl -s "${BASE}/v1/networks" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.networks[] | {id, name, state, region}'

# Filter by resource group
curl -s "${BASE}/v1/networks?filter.resource_group_id=${RG_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq .

# Filter by region and cloud provider
curl -s "${BASE}/v1/networks?filter.region=us-east-1&filter.cloud_provider=CLOUD_PROVIDER_AWS" \
  -H "Authorization: Bearer ${TOKEN}" | jq .

# Get a specific network by ID
curl -s "${BASE}/v1/networks/${NET_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.network | {id, name, state, cidr_block, zones}'
```

## Deleting a Network

A network can only be deleted after all clusters using it have been deleted.

```bash
curl -s -X DELETE "${BASE}/v1/networks/${NET_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.operation.id'
```

Returns a `DeleteNetworkOperation`. Poll until `STATE_COMPLETED`.

## Network Response Fields

The `Network` object returned by Get/List contains:

| Field | Notes |
|---|---|
| `id` | 20-char ID assigned by the API (output only) |
| `name` | Name you provided |
| `resource_group_id` | UUID of the resource group |
| `state` | `STATE_CREATING`, `STATE_READY`, `STATE_DELETING`, `STATE_FAILED` |
| `cloud_provider` | Enum: `CLOUD_PROVIDER_AWS/GCP/AZURE` |
| `region` | Cloud region |
| `cidr_block` | The CIDR you provided (if Redpanda-managed) |
| `cluster_type` | `TYPE_BYOC` or `TYPE_DEDICATED` |
| `zones` | Availability zones populated after creation |
| `customer_managed_resources` | The CMR object if BYOVPC |
| `created_at`, `updated_at` | RFC3339 timestamps |

---

## Network Peering (VPC/VNet peering)

`NetworkPeeringService` connects a Redpanda BYOC network to one of your own VPCs/VNets via cloud-provider peering. Grounded in `network_peering.proto`. Note these endpoints are nested under `/v1/network/...` (singular `network`).

| Operation | Endpoint | Returns |
|---|---|---|
| Create | `POST /v1/network/{network_peering.network_id}/network-peerings` | `Operation` (202 Accepted) |
| Get | `GET /v1/network/{network_id}/network-peerings/{id}` | `NetworkPeering` |
| List | `GET /v1/network/{network_id}/network-peerings` | `NetworkPeering[]` |
| Delete | `DELETE /v1/network/{network_id}/network-peerings/{id}` | `Operation` (202 Accepted) |

There is **no Update RPC** — to change a peering, delete and recreate it.

### NetworkPeeringCreate fields

| Field | Required | Notes |
|---|---|---|
| `network_id` | Yes | The Redpanda network this peering applies to (also in the URL path). |
| `display_name` | Yes | Max 128 chars, pattern `^[A-Za-z0-9-_: ]+$`. Unique within the org. |
| `cloud_provider` | Yes | `CLOUD_PROVIDER_AWS/GCP/AZURE` (non-zero). |
| `cloud_provider_spec` (oneof) | Yes | Exactly one provider block, matching `cloud_provider` (CEL-enforced). |

Provider spec blocks:

| Provider | `cloud_provider_spec` field | Sub-fields |
|---|---|---|
| AWS | `aws` (`AWSPeeringSpec`) | `peer_owner_id`, `peer_vpc_id` |
| GCP | `gcp` (`GCPPeeringSpec`) | `peer_project_id` (req, 6–30 chars), `peer_vpc_name` (req, 1–63 chars) |
| Azure | `azure` (`AzurePeeringSpec`) | `peer_tenant_id`, `peer_subscription_id`, `peer_resource_group`, `peer_vnet_name` |

```bash
# Create an AWS VPC peering on a Redpanda network
curl -s -X POST "${BASE}/v1/network/${NET_ID}/network-peerings" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d "{
    \"network_peering\": {
      \"network_id\": \"${NET_ID}\",
      \"display_name\": \"my-vpc-peering\",
      \"cloud_provider\": \"CLOUD_PROVIDER_AWS\",
      \"aws\": {
        \"peer_owner_id\": \"123456789012\",
        \"peer_vpc_id\": \"vpc-0abc1234\"
      }
    }
  }" | jq '.operation.id'
```

**Operation types:** `TYPE_CREATE_NETWORK_PEERING` = 13, `TYPE_DELETE_NETWORK_PEERING` = 14.

**Peering states:** `STATE_CREATING` → `STATE_PENDING_ACCEPTANCE` → `STATE_READY`; plus `STATE_DELETING` and `STATE_FAILED`. AWS peerings sit in `STATE_PENDING_ACCEPTANCE` until you accept the peering connection in your own account.

---

## Cloud Provider Access (PREVIEW, AWS-only)

`CloudProviderAccessService` is a **PREVIEW** alternative to `customer_managed_resources` for cross-account AWS provisioning. A `CloudProviderAccess` is a reusable credential — an AWS IAM role Redpanda assumes (via STS) to provision infrastructure in your account. One access config can back multiple BYOC networks in the same AWS account. Grounded in `cloud_provider_access.proto`.

Unlike most control-plane mutations, **create/delete here are synchronous** — they return the resource (or 204) directly, not an `Operation`.

| Operation | Endpoint | Returns |
|---|---|---|
| Create | `POST /v1/cloud-provider-accesses` | `CloudProviderAccess` (201, synchronous) |
| Get | `GET /v1/cloud-provider-accesses/{id}` | `CloudProviderAccess` |
| List | `GET /v1/cloud-provider-accesses` | `CloudProviderAccess[]` |
| Delete | `DELETE /v1/cloud-provider-accesses/{id}` | 204; **409** if still referenced by a network |

### CloudProviderAccessCreate fields

| Field | Required | Notes |
|---|---|---|
| `name` | Yes | Max 128 chars, pattern `^[A-Za-z0-9-_: ]+$`. |
| `cloud_provider` | Yes | **AWS only** this release. |
| `config.aws.role_arn` | Yes | ARN of the IAM role Redpanda assumes. Pattern `^arn:aws:iam::\d{12}:role/.+$`. |

The server populates `config.aws.external_id` (output-only, derived from your organization ID). You **must** add this External ID to the IAM role's trust policy — it provides STS confused-deputy protection.

```bash
# Register a cross-account AWS access (PREVIEW)
curl -s -X POST "${BASE}/v1/cloud-provider-accesses" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d '{
    "cloud_provider_access": {
      "name": "prod-aws-account",
      "cloud_provider": "CLOUD_PROVIDER_AWS",
      "aws": { "role_arn": "arn:aws:iam::123456789012:role/redpanda-provisioner" }
    }
  }' | jq '.cloud_provider_access | {id, state, aws: .aws.external_id}'
```

**States:** `STATE_PENDING` → `STATE_ACTIVE`; plus `STATE_FAILED` and `STATE_DELETED`.

### Tie-in: referencing it from a network

Set `NetworkCreate.cloud_provider_access_id` (PREVIEW) to the 20-char access ID. It is valid only when `cluster_type=TYPE_BYOC` and `cloud_provider=CLOUD_PROVIDER_AWS`, and is **mutually exclusive** with `customer_managed_resources`. When set, Redpanda provisions the network infrastructure in your AWS account using the referenced role instead of customer-managed IAM resources.

---

## Private connectivity and egress

BYOC supports a range of private-connectivity options. Most are configured as cluster-level fields on `ClusterCreate`/`ClusterUpdate` (see `clusters-and-agent.md`); VPC peering and centralized egress are network-level.

| Mechanism | Where configured | Notes |
|---|---|---|
| AWS PrivateLink | cluster `aws_private_link` (`AWSPrivateLinkSpec`) | `enabled`, `allowed_principals`, `connect_console`, `supported_regions` (cross-region PrivateLink — list of allowed AWS regions). |
| GCP Private Service Connect | cluster `gcp_private_service_connect` (`GCPPrivateServiceConnectSpec`) | `enabled`, `global_access_enabled`, `consumer_accept_list`. |
| Azure Private Link | cluster `azure_private_link` (`AzurePrivateLinkSpec`) | `enabled`, `allowed_subscriptions`, `connect_console`. |
| VPC / VNet peering | network `NetworkPeeringService` | See [Network Peering](#network-peering-vpcvnet-peering) above. |
| Centralized egress | network `egress_spec` (PREVIEW) | AWS Transit Gateway / GCP hub-VPC peering — see below. |

See the [Redpanda Cloud networking docs](https://docs.redpanda.com/cloud-data-platform/networking/) for the full guidance, including **BYOVPC on AWS (GA, March 2026)** as a fully customer-managed networking variant.

### Centralized egress (Transit Gateway / hub VPC, PREVIEW)

`NetworkCreate.egress_spec` (PREVIEW, `Network.EgressSpec`) controls how outbound internet traffic leaves the network. Exactly one provider block is set, matching the network's `cloud_provider` (CEL-enforced):

| Provider | `egress_spec` field | Key field | Behavior |
|---|---|---|---|
| AWS | `aws` | `transit_gateway_id` (req, pattern `^tgw-[0-9a-f]{8,}$`) | **AWS Transit Gateway centralized egress for BYOC (beta, May 2026).** The spoke VPC attaches to your existing TGW; no NAT Gateway / IGW is created and all internet-bound traffic routes through your hub VPC via the TGW. |
| GCP | `gcp` | `hub_vpc_project`, `hub_vpc_name` (both req) | Peers the Redpanda VPC to your hub/egress VPC; Cloud Router / Cloud NAT creation is skipped. The hub owner must create the mirror peering with `export_custom_routes=true` for the default route to be advertised. |
| Azure | `azure` | (placeholder) | Not yet specified. |
