# Model and Auth: Dedicated Clusters

## What is a Dedicated Cluster?

A Redpanda Cloud **Dedicated** cluster runs entirely in **Redpanda's cloud account** — AWS, GCP, or Azure. Redpanda provisions and manages the VPC (or VNet), Kubernetes control plane and data plane, agent, storage buckets, and all associated IAM resources. You interact only with the public Control Plane API; no cloud-provider credentials or Terraform execution on your side is required.

Internally, Dedicated clusters are labelled `CLUSTER_TYPE_FMC` (Fully-Managed Cloud) in the internal proto (`common.proto`). In the **public API** proto (`controlplane/v1/cluster.proto`), they surface as `Cluster.Type.TYPE_DEDICATED = 1`. This is the value you set in `ClusterCreate.type` and the value returned in `Cluster.type`.

## Dedicated vs BYOC vs Serverless

| Dimension | Dedicated | BYOC | Serverless |
|---|---|---|---|
| Cloud account | Redpanda's | Customer's | Redpanda's (shared pool) |
| Tenancy | Single-tenant | Single-tenant | Multi-tenant |
| VPC ownership | Redpanda | Customer | Redpanda |
| Network resource | Required (`TYPE_DEDICATED`) | Required (`TYPE_BYOC`) | Not required |
| Agent installation | None — fully managed | `rpk cloud byoc apply` required | None |
| Customer-managed cloud resources | Not required | IAM roles, buckets, subnets required | Not applicable |
| Enterprise features | Included | Included | Limited subset |
| Throughput tiers | Yes | Yes | Not applicable (pay-per-use) |
| Pricing | Throughput tier + Redpanda fee | Throughput tier + your own cloud bill | Per-message/storage |
| API service | `ClusterService` | `ClusterService` | `ServerlessClusterService` |
| Cluster type enum | `TYPE_DEDICATED` | `TYPE_BYOC` | N/A (separate resource) |
| Data Plane URL | In `Cluster.dataplane_api.url` | In `Cluster.dataplane_api.url` | In `ServerlessCluster.dataplane_api.url` |

**Key distinctions:**
- Dedicated and BYOC both use the same `ClusterService` (not `ServerlessClusterService`). They both require a `Network` resource first. The difference is infra ownership and the `customer_managed_resources` requirement.
- BYOC requires you to pre-create AWS instance profiles, security groups, GCP service accounts, storage buckets, etc. Dedicated does not; Redpanda creates all cloud infrastructure.
- Serverless is served by a completely separate `ServerlessClusterService` with its own endpoints and no Network dependency.

Source: `controlplane.go` (`CloudClientSet.Cluster` for Dedicated/BYOC, `CloudClientSet.Serverless` for Serverless); `cloudv2/proto/public/cloud/redpanda/api/controlplane/v1/cluster.proto` enum `Cluster.Type`.

## Enterprise Capabilities

Dedicated clusters include enterprise-grade capabilities by default under the Redpanda Cloud subscription. These do not require a separate license key:

- **Tiered Storage** — offload segments to cloud object storage (S3/GCS/Azure Blob); configure `remote.read`, `remote.write`, and retention policies per topic.
- **Remote Read Replicas** — cross-cluster read-only topic mirroring.
- **Continuous Data Balancing** — `partition_autobalancing_mode=continuous` with disk/availability thresholds.
- **RBAC / GBAC** — role-based and group-based access control via Redpanda roles.
- **OIDC / OAuthBearer** — external identity provider integration.
- **mTLS** — mutual TLS on Kafka, HTTP Proxy, and Schema Registry endpoints.
- **Audit Logging** — `audit_enabled` cluster configuration with `audit_*` keys.
- **Schema Registry** — built-in schema registry with SASL and mTLS support.
- **HTTP Proxy (Pandaproxy)** — REST-based Kafka API.

To set cluster configuration properties, use `cluster_configuration.custom_properties` in `ClusterCreate` or `ClusterUpdate`.

## OAuth2 Client-Credentials Auth

The Control Plane API uses **OAuth2 client credentials flow** (RFC 6749 §4.4). The token endpoint is Auth0-backed.

### Token Endpoint

```
POST https://auth.prd.cloud.redpanda.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=<YOUR_CLIENT_ID>
&client_secret=<YOUR_CLIENT_SECRET>
&audience=cloudv2-production.redpanda.cloud
```

Obtain a client ID and secret from the **Clients tab of the Users section** in the Redpanda Cloud console. Source: `auth0/api.go` (`getToken` function, line `path := host + "/oauth/token"`); `auth0/auth0.go` (`prodAuth0Endpoint.URL = "https://auth.prd.cloud.redpanda.com"`, `Audience = "cloudv2-production.redpanda.cloud"`); `cli/cloud/login.go` ("in the Clients tab of the Users section in the Redpanda Cloud online interface").

### Example

```bash
TOKEN=$(curl -s -X POST "https://auth.prd.cloud.redpanda.com/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "client_id=${CLIENT_ID}" \
  --data-urlencode "client_secret=${CLIENT_SECRET}" \
  --data-urlencode "audience=cloudv2-production.redpanda.cloud" \
  | jq -r '.access_token')
```

The response is `{"access_token":"eyJ...","token_type":"Bearer","expires_in":86400}`. Use `access_token` as the Bearer value.

### Using rpk

```bash
# Interactive login (opens browser)
rpk cloud login

# Headless / CI login with client credentials
rpk cloud login --client-id "${CLIENT_ID}" --client-secret "${CLIENT_SECRET}" --save

# Print the current token (useful for piping into curl)
TOKEN=$(rpk cloud auth token)
```

Source: `cli/cloud/login.go` (references `oauth.LoadFlow` and `auth0.NewClient`); `cli/cloud/auth/token.go`.

### Token Lifecycle

- Tokens are JWTs signed by Auth0 and validated by `authtoken.ValidateToken` in rpk.
- `expires_in` is typically 86400 seconds (24 hours).
- rpk caches the token in the rpk profile and automatically refreshes it using the stored `client_secret` when expired.
- Every control-plane HTTP request carries `Authorization: Bearer <token>` (set by `newReloadingAuthInterceptor` in `publicapi.go`).

Source: `publicapi.go` (`newReloadingAuthInterceptor`, `newAuthInterceptor`); `oauth/oauth.go` (`ClientCredentialFlow`).

## Control Plane API

- **Base URL:** `https://api.redpanda.com` (constant `ControlPlaneProdURL` in `publicapi.go`)
- **Protocol:** ConnectRPC over HTTP/1.1 or HTTP/2 with JSON encoding (the HTTP-JSON gateway maps REST paths to gRPC methods)
- **Content-Type:** `application/json` for JSON requests
- **Authentication:** `Authorization: Bearer <token>`

Source: `publicapi.go` (`ControlPlaneProdURL = "https://api.redpanda.com"`).

## End-to-End Provisioning Flow

```
1. POST /oauth/token  -> bearer token

2. POST /v1/resource-groups  -> ResourceGroup.id

3. POST /v1/networks          -> Operation.id
   (cluster_type: TYPE_DEDICATED, cidr_block, region, cloud_provider)
   GET  /v1/operations/{id}  [poll until STATE_COMPLETED]
   -> network_id from operation.resource_id

4. POST /v1/clusters          -> Operation.id
   (type: TYPE_DEDICATED, network_id, throughput_tier, zones, ...)
   GET  /v1/operations/{id}  [poll until STATE_COMPLETED; takes 20-40 min]
   -> cluster_id from operation.resource_id

5. GET  /v1/clusters/{cluster_id}
   -> dataplane_api.url (e.g. https://api-ab1234l0.cjb69...fmc.prd.cloud.redpanda.com)
   -> kafka_api.seed_brokers[0] (bootstrap server)
   -> http_proxy.url, schema_registry.url

6. Use dataplane_api.url as base for Data Plane API calls:
   POST {dp_url}/v1/topics       -> create topics
   POST {dp_url}/v1/acls         -> create ACLs
   POST {dp_url}/v1/users        -> create Kafka users
   POST {dp_url}/v1/secrets      -> store secrets
```

### Note on Network and Dedicated Clusters

Unlike what one might assume, Dedicated clusters **do** require a `Network` resource, just like BYOC. The `network.cluster_type` field must be set to `TYPE_DEDICATED` (value `1`). The validation rule in `network.proto` confirms: `"network.cluster_type must be either TYPE_DEDICATED or TYPE_BYOC"`.

For Dedicated, you set `cidr_block` (at least a /21) and do **not** set `customer_managed_resources` — Redpanda provisions the VPC for you. For BYOC, you either provide the CIDR (Redpanda-managed VPC) or provide `customer_managed_resources` (your own VPC/subnets/buckets).

Source: `cloudv2/proto/public/cloud/redpanda/api/controlplane/v1/network.proto` (validation rule on `cluster_type`, field 10).

## Resource Groups

Every cluster and network must belong to a **ResourceGroup** (a logical namespace within your organization). A single resource group can hold multiple clusters.

```bash
# Create
curl -s -X POST "https://api.redpanda.com/v1/resource-groups" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"resource_group": {"name": "production"}}'

# List
curl -s "https://api.redpanda.com/v1/resource-groups" \
  -H "Authorization: Bearer ${TOKEN}"

# Get by ID
curl -s "https://api.redpanda.com/v1/resource-groups/${RG_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
```

Source: `cloudv2/proto/public/cloud/redpanda/api/controlplane/v1/resource_group.proto` (HTTP paths `/v1/resource-groups`); `controlplane.go` (`ResourceGroupForID`, `ResourceGroups`).
