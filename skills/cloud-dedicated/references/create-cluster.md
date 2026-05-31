# Create Cluster: Dedicated Cluster Lifecycle

## Overview

Creating a Dedicated cluster involves two asynchronous operations: (1) create a Network, (2) create a Cluster of `type: TYPE_DEDICATED`. Both calls immediately return an `Operation` message. Poll `GET /v1/operations/{id}` until `state` is `STATE_COMPLETED` before proceeding to the next step.

Source: `cloudv2/proto/public/cloud/redpanda/api/controlplane/v1/cluster.proto` (`ClusterCreate`, `Cluster`, `ClusterService`); `controlplane.go` (`ClusterForID`, `Clusters`).

## Step 1: Create a Network

Dedicated clusters need a `Network` resource with `cluster_type: TYPE_DEDICATED`. Redpanda provisions the VPC for you — provide only the CIDR block.

**Endpoint:** `POST https://api.redpanda.com/v1/networks`

**Request fields (NetworkCreate):**

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | Yes | Unique within the org |
| `resource_group_id` | string (UUID) | Yes | Resource group this network belongs to |
| `cloud_provider` | enum | Yes | `CLOUD_PROVIDER_AWS`, `CLOUD_PROVIDER_GCP`, `CLOUD_PROVIDER_AZURE` |
| `region` | string | Yes | e.g. `us-east-1`, `us-central1`, `eastus` |
| `cidr_block` | string | Yes (for Dedicated) | At least a /21 CIDR; e.g. `10.0.0.0/20` |
| `cluster_type` | enum | Yes | Must be `TYPE_DEDICATED` |

```bash
NET_OP=$(curl -s -X POST "https://api.redpanda.com/v1/networks" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "network": {
      "name": "prod-network",
      "resource_group_id": "'"${RG_ID}"'",
      "cloud_provider": "CLOUD_PROVIDER_AWS",
      "region": "us-east-1",
      "cidr_block": "10.0.0.0/20",
      "cluster_type": "TYPE_DEDICATED"
    }
  }')

NET_OP_ID=$(echo "${NET_OP}" | jq -r '.operation.id')
echo "Network operation ID: ${NET_OP_ID}"

# Poll until STATE_COMPLETED
until [ "$(curl -s "https://api.redpanda.com/v1/operations/${NET_OP_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq -r '.operation.state')" = "STATE_COMPLETED" ]; do
  echo "Waiting for network..."; sleep 15
done

NET_ID=$(curl -s "https://api.redpanda.com/v1/operations/${NET_OP_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq -r '.operation.resource_id')
```

Source: `cloudv2/proto/public/cloud/redpanda/api/controlplane/v1/network.proto` (HTTP annotation `post: "/v1/networks"`, `NetworkCreate` message, `cluster_type` field with validation `"network.cluster_type must be either TYPE_DEDICATED or TYPE_BYOC"`).

## Step 2: List Regions and Zones

Before creating a cluster, list available regions and the zones/tiers for your cloud provider. The region service returns the available throughput tiers per region.

```bash
# List all AWS regions
curl -s "https://api.redpanda.com/v1/regions/CLOUD_PROVIDER_AWS" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.regions[] | {name, zones}'

# Get specific region detail (includes available tiers)
curl -s "https://api.redpanda.com/v1/regions/CLOUD_PROVIDER_AWS/us-east-1" \
  -H "Authorization: Bearer ${TOKEN}" | jq .
```

Source: `cloudv2/proto/public/cloud/redpanda/api/controlplane/v1/region.proto` (HTTP paths `get: "/v1/regions/{cloud_provider}"` and `get: "/v1/regions/{cloud_provider}/{name}"`).

## Step 3: Create a Dedicated Cluster

**Endpoint:** `POST https://api.redpanda.com/v1/clusters`

### ClusterCreate Fields

All fields below are sourced from `cloudv2/proto/public/cloud/redpanda/api/controlplane/v1/cluster.proto` (`ClusterCreate` message, fields 1–29).

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | Yes | 3–128 chars, pattern `^[A-Za-z0-9-:_]+$` |
| `resource_group_id` | string (UUID) | Yes | Must match network's resource group |
| `type` | enum | Yes | `TYPE_DEDICATED` (value 1) |
| `network_id` | string (20-char XID) | Yes | ID of the Network created above |
| `cloud_provider` | enum | Yes | `CLOUD_PROVIDER_AWS` / `CLOUD_PROVIDER_GCP` / `CLOUD_PROVIDER_AZURE` |
| `region` | string | Yes | Must match network's region |
| `zones` | repeated string | Yes | At least 1; use 3 for multi-AZ |
| `throughput_tier` | string | Yes | e.g. `tier-1-aws-v2-arm` — see Regions API |
| `connection_type` | enum | No | `CONNECTION_TYPE_PUBLIC` (default) or `CONNECTION_TYPE_PRIVATE` |
| `redpanda_version` | string | No | `major.minor` semver only (e.g. `24.1`); per proto comment: "Only major.minor semver is supported" |
| `kafka_api` | KafkaAPISpec | No | SASL and mTLS settings |
| `http_proxy` | HTTPProxySpec | No | mTLS settings for HTTP Proxy |
| `schema_registry` | SchemaRegistrySpec | No | mTLS settings for Schema Registry |
| `aws_private_link` | AWSPrivateLinkSpec | No | AWS PrivateLink (AWS only) |
| `gcp_private_service_connect` | GCPPrivateServiceConnectSpec | No | GCP PSC (GCP only) |
| `azure_private_link` | AzurePrivateLinkSpec | No | Azure Private Link (Azure only) |
| `cloud_provider_tags` | map<string,string> | No | Tags on cloud resources; max 16 pairs |
| `maintenance_window_config` | MaintenanceWindowConfig | No | `day_hour`, `anytime`, or `unspecified` |
| `cluster_configuration` | ClusterConfiguration | No | Custom Redpanda cluster config properties |
| `api_gateway_access` | NetworkAccessMode | No | Controls console/API Gateway exposure: `NETWORK_ACCESS_MODE_PUBLIC` or `NETWORK_ACCESS_MODE_PRIVATE` |
| `redpanda_node_count` | int32 | No | Override starting node count |
| `gcp_enable_global_access` | bool | No | GCP only: enable global access on seed LB |
| `read_replica_cluster_ids` | repeated string | No | IDs of clusters that may read-replicate this cluster |

### Minimal AWS Dedicated Cluster

```bash
CLUSTER_OP=$(curl -s -X POST "https://api.redpanda.com/v1/clusters" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "cluster": {
      "name": "prod-dedicated",
      "resource_group_id": "'"${RG_ID}"'",
      "network_id": "'"${NET_ID}"'",
      "type": "TYPE_DEDICATED",
      "cloud_provider": "CLOUD_PROVIDER_AWS",
      "region": "us-east-1",
      "zones": ["use1-az1", "use1-az2", "use1-az4"],
      "throughput_tier": "tier-1-aws-v2-arm",
      "connection_type": "CONNECTION_TYPE_PUBLIC"
    }
  }')

CLUSTER_OP_ID=$(echo "${CLUSTER_OP}" | jq -r '.operation.id')
```

### Full-Featured AWS Cluster with PrivateLink and mTLS

```bash
curl -s -X POST "https://api.redpanda.com/v1/clusters" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "cluster": {
      "name": "prod-secure",
      "resource_group_id": "'"${RG_ID}"'",
      "network_id": "'"${NET_ID}"'",
      "type": "TYPE_DEDICATED",
      "cloud_provider": "CLOUD_PROVIDER_AWS",
      "region": "us-east-1",
      "zones": ["use1-az1", "use1-az2", "use1-az4"],
      "throughput_tier": "tier-3-aws-v2-arm",
      "connection_type": "CONNECTION_TYPE_PRIVATE",
      "redpanda_version": "24.1",
      "kafka_api": {
        "sasl": {"enabled": true},
        "mtls": {"enabled": false}
      },
      "aws_private_link": {
        "enabled": true,
        "allowed_principals": ["arn:aws:iam::123456789012:root"],
        "connect_console": true
      },
      "cloud_provider_tags": {
        "environment": "production",
        "team": "platform"
      },
      "maintenance_window_config": {
        "day_hour": {
          "hour_of_day": 2,
          "day_of_week": "SUNDAY"
        }
      }
    }
  }'
```

### GCP with Private Service Connect

```bash
curl -s -X POST "https://api.redpanda.com/v1/clusters" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "cluster": {
      "name": "prod-gcp",
      "resource_group_id": "'"${RG_ID}"'",
      "network_id": "'"${GCP_NET_ID}"'",
      "type": "TYPE_DEDICATED",
      "cloud_provider": "CLOUD_PROVIDER_GCP",
      "region": "us-central1",
      "zones": ["us-central1-a", "us-central1-b", "us-central1-c"],
      "throughput_tier": "tier-1-gcp-um4g",
      "connection_type": "CONNECTION_TYPE_PRIVATE",
      "gcp_private_service_connect": {
        "enabled": true,
        "global_access_enabled": false,
        "consumer_accept_list": [
          {"source": "my-gcp-project-1"}
        ]
      },
      "gcp_enable_global_access": false
    }
  }'
```

## Connection Types

| `connection_type` | Description |
|---|---|
| `CONNECTION_TYPE_PUBLIC` | Kafka, HTTP Proxy, Schema Registry, Console are reachable over the public internet |
| `CONNECTION_TYPE_PRIVATE` | Endpoints not exposed to the internet; use VPC peering or PrivateLink to connect |

For private access, pair `CONNECTION_TYPE_PRIVATE` with a PrivateLink spec:
- AWS: `aws_private_link.enabled = true` with `allowed_principals`
- GCP: `gcp_private_service_connect.enabled = true` with `consumer_accept_list`
- Azure: `azure_private_link.enabled = true` with `allowed_subscriptions`

Source: `cluster.proto` (`ConnectionType` enum, `AWSPrivateLinkSpec`, `GCPPrivateServiceConnectSpec`, `AzurePrivateLinkSpec`).

## Operation Polling

Every mutating call (Create, Update, Delete) returns an `Operation`. The Operation message:

```json
{
  "operation": {
    "id": "cjb69h1c4vs42pca89s0",
    "state": "STATE_IN_PROGRESS",
    "type": "TYPE_CREATE_CLUSTER",
    "started_at": "2024-11-01T00:00:00Z",
    "resource_id": "cjb69h1c4vs42pca89t0"
  }
}
```

States (from `operation.proto`, `Operation.State` enum):
- `STATE_IN_PROGRESS = 1` — still running
- `STATE_COMPLETED = 2` — succeeded; `resource_id` is the cluster/network ID
- `STATE_FAILED = 3` — failed; `error` field contains the `google.rpc.Status`

```bash
poll_operation() {
  local op_id="$1"
  while true; do
    STATE=$(curl -s "https://api.redpanda.com/v1/operations/${op_id}" \
      -H "Authorization: Bearer ${TOKEN}" | jq -r '.operation.state')
    case "${STATE}" in
      STATE_COMPLETED) echo "Done"; break ;;
      STATE_FAILED)    echo "Failed!"; exit 1 ;;
      *)               echo "State: ${STATE}"; sleep 30 ;;
    esac
  done
}
poll_operation "${CLUSTER_OP_ID}"
```

Operation types (from `operation.proto`, `Operation.Type` enum):
- `TYPE_CREATE_CLUSTER = 1`
- `TYPE_UPDATE_CLUSTER = 2`
- `TYPE_DELETE_CLUSTER = 3`
- `TYPE_CREATE_NETWORK = 4`
- `TYPE_DELETE_NETWORK = 5`

Source: `cloudv2/proto/public/cloud/redpanda/api/controlplane/v1/operation.proto`.

## Cluster State Machine

The `Cluster.state` field (`Cluster.State` enum) tracks the cluster lifecycle:

| State | Description |
|---|---|
| `STATE_CREATING_AGENT = 1` | Agent VM is being provisioned |
| `STATE_CREATING = 2` | Kubernetes and Redpanda are being deployed |
| `STATE_READY = 3` | Cluster is operational |
| `STATE_DELETING = 4` | Deletion in progress |
| `STATE_DELETING_AGENT = 5` | Agent is being removed |
| `STATE_UPGRADING = 6` | Redpanda version upgrade in progress |
| `STATE_FAILED = 7` | Cluster is in a failed state |
| `STATE_SUSPENDED = 8` | Cluster is suspended (typically due to billing) |

Source: `cloudv2/proto/public/cloud/redpanda/api/controlplane/v1/cluster.proto` (`Cluster.State` enum).

## Get Cluster

After the create operation completes, fetch the cluster to get endpoints:

```bash
CLUSTER=$(curl -s "https://api.redpanda.com/v1/clusters/${CLUSTER_ID}" \
  -H "Authorization: Bearer ${TOKEN}")

echo "State: $(echo "${CLUSTER}" | jq -r '.cluster.state')"
echo "Data Plane URL: $(echo "${CLUSTER}" | jq -r '.cluster.dataplane_api.url')"
echo "Kafka bootstrap: $(echo "${CLUSTER}" | jq -r '.cluster.kafka_api.seed_brokers[0]')"
echo "HTTP Proxy: $(echo "${CLUSTER}" | jq -r '.cluster.http_proxy.url')"
echo "Schema Registry: $(echo "${CLUSTER}" | jq -r '.cluster.schema_registry.url')"
echo "Console URL: $(echo "${CLUSTER}" | jq -r '.cluster.redpanda_console.url')"
```

Key output fields in the `Cluster` object:

| Field | Description |
|---|---|
| `id` | Cluster ID (20-char XID) |
| `state` | `STATE_READY` when operational |
| `current_redpanda_version` | Running Redpanda version |
| `desired_redpanda_version` | Target version during upgrade |
| `throughput_tier` | The tier name |
| `kafka_api.seed_brokers` | Bootstrap servers list |
| `kafka_api.all_seed_brokers.sasl` | SASL broker URL |
| `kafka_api.all_seed_brokers.mtls` | mTLS broker URL |
| `kafka_api.all_seed_brokers.private_link_sasl` | PrivateLink SASL URL |
| `http_proxy.url` | HTTP Proxy (Pandaproxy) URL |
| `http_proxy.all_urls.sasl` | HTTP Proxy SASL URL |
| `schema_registry.url` | Schema Registry URL |
| `schema_registry.all_urls.sasl` | Schema Registry SASL URL |
| `redpanda_console.url` | Redpanda Console API URL |
| `dataplane_api.url` | Data Plane API base URL |
| `prometheus.url` | Prometheus public metrics URL |
| `zones` | Deployed availability zones |

**Important:** `dataplane_api.url` is only populated in the `GetCluster` response, not in `ListClusters`. Always call `GetCluster` to retrieve it.

Source: `cluster.proto` (comment: `"Note: This endpoint does not return dataplane_api.url. Use the Get Cluster endpoint..."`).

## List Clusters

```bash
# List all clusters in your org (no dataplane_api.url returned)
curl -s "https://api.redpanda.com/v1/clusters" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.clusters[] | {id, name, type, state}'

# Filter by resource group
curl -s "https://api.redpanda.com/v1/clusters?filter.resource_group_id=${RG_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq .

# Filter by region
curl -s "https://api.redpanda.com/v1/clusters?filter.region=us-east-1" \
  -H "Authorization: Bearer ${TOKEN}" | jq .
```

Filter fields (`ListClustersRequest.Filter`): `resource_group_id`, `name_contains`, `region`, `cloud_provider`, `network_id`.

Source: `cluster.proto` (`ListClustersRequest.Filter`).

## Update Cluster

Updates use PATCH. The request body is decoded directly as a `ClusterUpdate` object (the gateway maps `body: "cluster"`). The `update_mask` is a separate top-level request field — pass it as a query parameter `?update_mask=<field>`. If omitted, the gateway auto-derives the mask from the fields present in the body.

Returns an Operation.

```bash
# Update throughput tier (scale up/down)
# Pass update_mask as a query parameter, body is the ClusterUpdate object directly
UPDATE_OP=$(curl -s -X PATCH "https://api.redpanda.com/v1/clusters/${CLUSTER_ID}?update_mask=throughput_tier" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "'"${CLUSTER_ID}"'",
    "throughput_tier": "tier-3-aws-v2-arm"
  }')

# Update maintenance window
curl -s -X PATCH "https://api.redpanda.com/v1/clusters/${CLUSTER_ID}?update_mask=maintenance_window_config" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "'"${CLUSTER_ID}"'",
    "maintenance_window_config": {
      "day_hour": {"hour_of_day": 3, "day_of_week": "SATURDAY"}
    }
  }'

# Update cluster configuration (Redpanda cluster properties)
curl -s -X PATCH "https://api.redpanda.com/v1/clusters/${CLUSTER_ID}?update_mask=cluster_configuration" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "'"${CLUSTER_ID}"'",
    "cluster_configuration": {
      "custom_properties": {
        "log_segment_size": "134217728",
        "partition_autobalancing_mode": "continuous"
      }
    }
  }'
```

Updatable `ClusterUpdate` fields include: `name`, `kafka_api`, `http_proxy`, `schema_registry`, `aws_private_link`, `gcp_private_service_connect`, `azure_private_link`, `read_replica_cluster_ids`, `cloud_provider_tags`, `maintenance_window_config`, `cluster_configuration`, `throughput_tier`, `redpanda_node_count`, `api_gateway_access`.

Source: `cluster.proto` (`ClusterUpdate` message, `UpdateClusterRequest` with `update_mask`); `cluster.pb.gw.go` (body decoded into `protoReq.Cluster`; `update_mask` populated via query parameters).

## Delete Cluster

```bash
DEL_OP=$(curl -s -X DELETE "https://api.redpanda.com/v1/clusters/${CLUSTER_ID}" \
  -H "Authorization: Bearer ${TOKEN}")
DEL_OP_ID=$(echo "${DEL_OP}" | jq -r '.operation.id')

until [ "$(curl -s "https://api.redpanda.com/v1/operations/${DEL_OP_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq -r '.operation.state')" = "STATE_COMPLETED" ]; do
  echo "Deleting..."; sleep 30
done
echo "Cluster deleted"
```

After cluster deletion, you may also delete the network:

```bash
curl -s -X DELETE "https://api.redpanda.com/v1/networks/${NET_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
```

## Custom Cluster Configuration

The `cluster_configuration.custom_properties` field lets you set Redpanda cluster configuration properties. Values of type integer or number must be passed as strings to avoid precision loss.

Common Dedicated cluster configuration properties:

```json
{
  "cluster_configuration": {
    "custom_properties": {
      "log_segment_size": "134217728",
      "log_compression_type": "producer",
      "partition_autobalancing_mode": "continuous",
      "partition_autobalancing_min_size_threshold": "1073741824",
      "kafka_connections_max": "32768",
      "kafka_sasl_mechanisms": "SCRAM-SHA-256,SCRAM-SHA-512",
      "audit_enabled": "true"
    }
  }
}
```

Source: `cluster.proto` (`ClusterCreate.ClusterConfiguration.custom_properties`, type `google.protobuf.Struct`; comment "Properties of type integer and number ... needs to be provided as strings").

## Tags

Cloud provider tags (resource labels) can be placed on cloud resources at cluster create or update time. Maximum 16 pairs. GCP network tags use the `gcp.network-tag.` prefix:

```json
{
  "cloud_provider_tags": {
    "environment": "production",
    "team": "platform",
    "gcp.network-tag.allow-internal": ""
  }
}
```

Source: `cluster.proto` (`ClusterCreate.cloud_provider_tags`, `max_pairs = 16`, annotation about GCP network tags). Note: the returned `Cluster` message has a lower `max_pairs` cap on `cloud_provider_tags`; round-tripped output may show fewer tag entries than the 16-pair create limit.

## PrivateLink Details

### AWS PrivateLink

```json
{
  "aws_private_link": {
    "enabled": true,
    "allowed_principals": [
      "arn:aws:iam::123456789012:root",
      "arn:aws:iam::123456789012:user/alice"
    ],
    "connect_console": true,
    "supported_regions": ["us-east-1", "us-west-2"]
  }
}
```

`allowed_principals`: ARNs of AWS principals that can create VPC endpoints. Use `"*"` to allow any principal.

### GCP Private Service Connect

```json
{
  "gcp_private_service_connect": {
    "enabled": true,
    "global_access_enabled": false,
    "consumer_accept_list": [
      {"source": "my-gcp-project-id"},
      {"source": "123456789012"}
    ]
  }
}
```

`consumer_accept_list[].source`: either the GCP project ID or project number.

### Azure Private Link

```json
{
  "azure_private_link": {
    "enabled": true,
    "allowed_subscriptions": ["4a73b02e-90c1-4d76-af36-5c935dd41e7c"],
    "connect_console": true
  }
}
```

Source: `cluster.proto` (`AWSPrivateLinkSpec`, `GCPPrivateServiceConnectSpec`, `AzurePrivateLinkSpec`).

## Listing Operations

To see all recent operations:

```bash
# List all operations
curl -s "https://api.redpanda.com/v1/operations" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.operations[] | {id, type, state}'

# Filter by type and state
curl -s "https://api.redpanda.com/v1/operations?filter.type_in=TYPE_CREATE_CLUSTER&filter.state=STATE_IN_PROGRESS" \
  -H "Authorization: Bearer ${TOKEN}" | jq .

# Filter by resource (cluster ID)
curl -s "https://api.redpanda.com/v1/operations?filter.resource_id=${CLUSTER_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq .
```

Source: `operation.proto` (`ListOperationsRequest.Filter` with `type_in`, `state`, `resource_id`; HTTP path `get: "/v1/operations"`).
