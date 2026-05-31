# BYOC Model and Auth

## What is BYOC?

BYOC (Bring Your Own Cloud) is a Redpanda Cloud deployment model where the Kafka cluster runs **inside your own cloud account** (AWS, GCP, or Azure). The key distinction from Serverless:

| Aspect | BYOC | Serverless |
|---|---|---|
| Infra location | Your VPC/VNet | Redpanda's account |
| Cloud bill | Your AWS/GCP/Azure account | Redpanda invoices you |
| Network isolation | Fully isolated — your VPC | Shared multi-tenant |
| IAM/Security Groups | You create and own them | Redpanda manages |
| Data residency | Fully in your account | Redpanda's account |
| Agent | Required — Terraform-provisioned | None |
| Cluster type string | `TYPE_BYOC` | `TYPE_SERVERLESS` |
| Network resource | Must be created first | Not needed |
| `throughput_tier` | BYOC tiers (e.g. `tier-1-aws-v2-arm`, `tier-1-gcp-v2-x86`). Tier names are version-dependent; authoritative list at https://docs.redpanda.com/redpanda-cloud/reference/tiers/byoc-tiers/ | Serverless tiers |

Redpanda operates the **control plane** (cluster lifecycle, upgrades, monitoring) and you operate the **data plane** (your VPC, your storage, your IAM). An agent process runs Terraform in your account to manage Kubernetes and the Redpanda brokers.

### Architecture Summary

```
[Redpanda Control Plane]          [Customer Cloud Account]
  api.redpanda.com          ─────►  VPC / VNet / Network
  Manages lifecycle                 IAM Roles / Identities
  Pushes config to agent            S3/GCS/Azure Storage
                                    EKS/GKE/AKS Cluster
                                    Redpanda Broker Pods
                                    Redpanda Agent (Terraform)
```

## OAuth2 Client Credentials Auth

All Control Plane API calls require a Bearer token obtained via the OAuth2 client-credentials grant. This is the same auth used by Serverless.

### Getting Client Credentials

1. Log in to [cloud.redpanda.com](https://cloud.redpanda.com)
2. Go to **Clients** in the Users/Security section
3. Create a new service account client — you will receive a `client_id` and `client_secret`

### Token Exchange

```bash
TOKEN=$(curl -s -X POST \
  "https://auth.prd.cloud.redpanda.com/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "client_id=${CLIENT_ID}" \
  --data-urlencode "client_secret=${CLIENT_SECRET}" \
  --data-urlencode "audience=cloudv2-production.redpanda.cloud" \
  | jq -r '.access_token')
```

Tokens are JWTs and expire after a period; refresh by re-running the exchange. The `rpk` CLI handles refresh automatically when using `rpk cloud login` or `-X cloud.client_id/secret` flags.

### Using the Token

```bash
# Every request: set Authorization header
curl -H "Authorization: Bearer ${TOKEN}" \
     -H "Content-Type: application/json" \
     "https://api.redpanda.com/v1/clusters"
```

### rpk Equivalents

```bash
# Interactive SSO login (browser)
rpk cloud login

# Non-interactive client credentials login
rpk cloud login \
  --client-id "${CLIENT_ID}" \
  --client-secret "${CLIENT_SECRET}"

# Or via environment variables (no login needed)
export RPK_CLOUD_CLIENT_ID="${CLIENT_ID}"
export RPK_CLOUD_CLIENT_SECRET="${CLIENT_SECRET}"
rpk cloud cluster select

# Or via -X flags on any command
rpk cloud byoc aws apply --redpanda-id <id> \
  -X cloud.client_id="${CLIENT_ID}" \
  -X cloud.client_secret="${CLIENT_SECRET}"
```

The token is stored in `rpk.yaml` under the active cloud auth profile. See the `rpk-cloud` skill for auth profile management.

## End-to-End Provisioning Flow

The full BYOC lifecycle has a strict order:

```
1. Obtain OAuth2 Token
        │
        ▼
2. Create Resource Group (if needed)
        │
        ▼
3. POST /v1/networks  →  returns Operation
        │
        ▼
4. Poll GET /v1/operations/{id} → STATE_COMPLETED
        │
        ▼
5. POST /v1/clusters (type=TYPE_BYOC, network_id=<net_id>)
        │  returns Operation
        ▼
6. Cluster reaches STATE_CREATING_AGENT
        │  Control plane waits for agent
        ▼
7. rpk cloud byoc aws apply --redpanda-id <cluster_id>
        │  Terraform runs in your account:
        │    - Provisions EKS/GKE/AKS
        │    - Installs Redpanda operator
        │    - Agent reconciles broker pods
        ▼
8. Cluster transitions STATE_CREATING → STATE_READY
        │
        ▼
9. Use data-plane URL from GET /v1/clusters/{id}
   (cluster.dataplane_api.url) to create topics/ACLs/users
```

### Tearing Down

```
1. DELETE /v1/clusters/{id}  →  returns Operation
        │
        ▼
2. Cluster reaches STATE_DELETING_AGENT
        │
        ▼
3. rpk cloud byoc aws destroy --redpanda-id <cluster_id>
        │  Terraform destroys EKS/GKE/AKS and associated resources
        ▼
4. Poll GET /v1/operations/{id} → STATE_COMPLETED
        │
        ▼
5. DELETE /v1/networks/{id}  →  returns Operation
        │
        ▼
6. Poll until STATE_COMPLETED
```

## Control Plane Base URL and Client

**Base URL:** `https://api.redpanda.com` (the `ControlPlaneProdURL` constant in `publicapi.go`)

**SDK:** The Go client set is `CloudClientSet` in `pkg/publicapi/controlplane.go`. It wraps each service client with Bearer token, logging, and User-Agent interceptors. For raw HTTP/curl, all endpoints accept `application/json`.

**Timeout:** The default HTTP client timeout is 30 seconds per request. Long-running operations are tracked asynchronously — poll the Operation endpoint.

**Pagination:** List endpoints return `next_page_token`; supply it as `page_token` in subsequent requests. Up to 100 items per page. Empty `next_page_token` means no more pages.

```bash
# Paginating clusters
PAGE=""
while true; do
  RESP=$(curl -s "${BASE}/v1/clusters?page_size=100&page_token=${PAGE}" \
    -H "Authorization: Bearer ${TOKEN}")
  echo "${RESP}" | jq '.clusters[].name'
  PAGE=$(echo "${RESP}" | jq -r '.next_page_token // empty')
  [ -z "${PAGE}" ] && break
done
```
