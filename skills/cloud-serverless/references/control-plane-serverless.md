# Control Plane: Serverless Cluster Management

This reference covers ResourceGroup, ServerlessRegion, ServerlessCluster, and
Operations. All endpoint paths and field names are grounded in the proto files
at `cloudv2/proto/public/cloud/redpanda/api/controlplane/v1/` and the rpk Go
client in `publicapi/controlplane.go`.

Base URL for all calls: `https://api.redpanda.com`
Auth: `Authorization: Bearer <token>` (see `auth.md`)

---

## ResourceGroup

A ResourceGroup is the billing and organizational container. Every
ServerlessCluster must belong to a ResourceGroup.

### Create

```bash
curl -s -X POST https://api.redpanda.com/v1/resource-groups \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"resource_group": {"name": "production"}}' | jq .resource_group
```

Returns `201` with the `ResourceGroup` object.

**Name constraints** (from `resource_group.proto`):
- 3–253 characters
- Pattern: `^[a-zA-Z0-9-]+$` (alphanumeric + hyphens only)

### List

```bash
curl -s "https://api.redpanda.com/v1/resource-groups" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.resource_groups[] | {id, name}'

# Filter by name substring:
curl -s "https://api.redpanda.com/v1/resource-groups?filter.name_contains=prod" \
  -H "Authorization: Bearer ${TOKEN}" | jq .
```

### Get

```bash
curl -s "https://api.redpanda.com/v1/resource-groups/${RG_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq .resource_group
```

### Update

```bash
curl -s -X PATCH "https://api.redpanda.com/v1/resource-groups/${RG_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"resource_group\": {\"id\": \"${RG_ID}\", \"name\": \"staging\"}}" | jq .
```

### Delete

```bash
curl -s -X DELETE "https://api.redpanda.com/v1/resource-groups/${RG_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
# Returns 204 No Content on success
```

**ResourceGroup fields** (output-only):

| Field | Type | Notes |
|---|---|---|
| `id` | string | UUID |
| `name` | string | 3–253 chars, alphanumeric + hyphens |
| `created_at` | Timestamp | RFC3339 |
| `updated_at` | Timestamp | RFC3339 |

---

## ServerlessRegion

Regions represent cloud-provider geographic areas where Serverless clusters can
be placed. The `placement.enabled` field indicates if new clusters can currently
be placed in that region.

### List Regions

```bash
# List all AWS regions:
curl -s "https://api.redpanda.com/v1/serverless/regions?cloud_provider=CLOUD_PROVIDER_AWS" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.serverless_regions[] | {name, placement_enabled: .placement.enabled}'

# Only regions accepting new clusters:
curl -s "https://api.redpanda.com/v1/serverless/regions?cloud_provider=CLOUD_PROVIDER_AWS&filter.placement_enabled_only=true" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.serverless_regions[].name'

# GCP regions:
curl -s "https://api.redpanda.com/v1/serverless/regions?cloud_provider=CLOUD_PROVIDER_GCP" \
  -H "Authorization: Bearer ${TOKEN}" | jq .
```

### Get a Specific Region

```bash
curl -s "https://api.redpanda.com/v1/serverless/region?cloud_provider=CLOUD_PROVIDER_AWS&name=us-east-1" \
  -H "Authorization: Bearer ${TOKEN}" | jq .serverless_region
```

**cloud_provider values** (from `common.proto`):

| Value | Provider |
|---|---|
| `CLOUD_PROVIDER_AWS` | Amazon Web Services |
| `CLOUD_PROVIDER_GCP` | Google Cloud Platform |
| `CLOUD_PROVIDER_AZURE` | Microsoft Azure |

**ServerlessRegion fields**:

| Field | Notes |
|---|---|
| `name` | Region name string used in CreateServerlessCluster (e.g. `"us-east-1"`) |
| `cloud_provider` | One of the CloudProvider enum values |
| `placement.enabled` | `true` if new clusters can currently be placed here |
| `default_timezone` | The default timezone for the region |

---

## ServerlessCluster

### Create

Create returns `202 Accepted` with a `CreateServerlessClusterOperation`
containing an `operation.id`. The cluster is not ready until the operation
reaches `STATE_COMPLETED`.

```bash
OP=$(curl -s -X POST https://api.redpanda.com/v1/serverless/clusters \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"serverless_cluster\": {
      \"name\": \"my-cluster\",
      \"resource_group_id\": \"${RG_ID}\",
      \"serverless_region\": \"us-east-1\"
    }
  }")

echo "${OP}" | jq .operation.id
OP_ID=$(echo "${OP}" | jq -r .operation.id)
```

**Create request fields** (grounded in `serverless.proto` `ServerlessClusterCreate`):

| Field | Required | Constraints |
|---|---|---|
| `name` | yes | 3–128 chars, `^[A-Za-z0-9-_:]+$` |
| `resource_group_id` | yes | Valid UUID of an existing ResourceGroup |
| `serverless_region` | yes | Region name string, e.g. `"us-east-1"` |
| `tags` | no | `map<string,string>`, max 50 pairs, keys/values max 256 chars |
| `networking_config.public` | no | `STATE_UNSPECIFIED` (enabled), `STATE_ENABLED`, or `STATE_DISABLED` |
| `networking_config.private` | no | `STATE_UNSPECIFIED` (disabled), `STATE_ENABLED`, or `STATE_DISABLED` |
| `private_link_id` | conditional | Required if `networking_config.private == STATE_ENABLED`; 20-char |

**Networking constraint**: public and private cannot both be `STATE_DISABLED`.
By default, both fields are `STATE_UNSPECIFIED` (wire value 0). The proxy
plane resolves unspecified as: public enabled, private disabled. Do not
expect the API to return `STATE_ENABLED` / `STATE_DISABLED` when you have not
explicitly set those values.

### Get

```bash
curl -s "https://api.redpanda.com/v1/serverless/clusters/${CLUSTER_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq .serverless_cluster
```

**ServerlessCluster output fields** (grounded in `serverless.proto`):

| Field | Notes |
|---|---|
| `id` | 20-char opaque ID (`^[a-v0-9]{20}`) |
| `name` | Cluster name |
| `resource_group_id` | UUID of parent ResourceGroup |
| `state` | See state machine below |
| `serverless_region` | Region name |
| `kafka_api.seed_brokers[]` | Public bootstrap servers for Kafka clients |
| `kafka_api.private_seed_brokers[]` | Private bootstrap (when private networking enabled) |
| `dataplane_api.url` | Base URL for the Data Plane REST API |
| `dataplane_api.private_url` | Private URL (when private networking enabled) |
| `schema_registry.url` | Schema Registry public endpoint |
| `schema_registry.private_url` | Schema Registry private endpoint |
| `console_url` | Redpanda Console web UI |
| `console_private_url` | Redpanda Console private URL |
| `prometheus.url` | Prometheus scrape endpoint for `/public_metrics` |
| `tags` | User-defined tags |
| `planned_deletion.delete_after` | Set when cluster is scheduled for deletion |

### State Machine

From `ServerlessCluster.State` in `serverless.proto`:

```
  POST /v1/serverless/clusters
           │
           ▼
     STATE_PLACING          (finding a cell with sufficient resources)
           │
           ▼
    STATE_CREATING          (creating control-plane state)
           │
           ▼
      STATE_READY           ──── accepts Kafka + Data Plane API calls
           │
     (on delete)
           │
           ▼
    STATE_DELETING          (removing control-plane state + releasing resources)

  If creation fails at any step → STATE_FAILED
  Can also enter STATE_SUSPENDED (running but blocking external requests)
```

Poll the operation to wait for completion rather than polling the cluster state
directly (see the Operations section below).

### List

```bash
# List all clusters:
curl -s "https://api.redpanda.com/v1/serverless/clusters" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.serverless_clusters[] | {id, name, state}'

# Filter by state:
curl -s "https://api.redpanda.com/v1/serverless/clusters?filter.state_in=STATE_READY" \
  -H "Authorization: Bearer ${TOKEN}" | jq .

# Filter by resource group:
curl -s "https://api.redpanda.com/v1/serverless/clusters?filter.resource_group_id=${RG_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq .

# Filter by name substring:
curl -s "https://api.redpanda.com/v1/serverless/clusters?filter.name_contains=prod" \
  -H "Authorization: Bearer ${TOKEN}" | jq .
```

**List filter parameters** (from `ListServerlessClustersRequest.Filter`):

| Parameter | Description |
|---|---|
| `filter.state_in` | Filter by one or more cluster states |
| `filter.resource_group_id` | Filter by resource group UUID |
| `filter.name_contains` | Partial match on cluster name |
| `filter.serverless_region` | Filter by region name |
| `page_size` | 1–100, default unset |
| `page_token` | Next-page token from previous response |

### Update

Update currently supports: `networking_config`, `private_link_id`, and `tags`
(tags are fully replaced on update).

```bash
# Update tags:
curl -s -X PATCH "https://api.redpanda.com/v1/serverless/clusters/${CLUSTER_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"id\": \"${CLUSTER_ID}\",
    \"tags\": {\"env\": \"production\", \"team\": \"platform\"}
  }"
```

Returns `202 Accepted` with an `UpdateServerlessClusterOperation`.

### Delete

```bash
curl -s -X DELETE "https://api.redpanda.com/v1/serverless/clusters/${CLUSTER_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq .operation.id
```

Returns `202 Accepted` with a `DeleteServerlessClusterOperation`. The cluster
enters `STATE_DELETING`; when the operation completes the cluster is gone.

### Prometheus Credentials

```bash
curl -s "https://api.redpanda.com/v1/serverless/clusters/${CLUSTER_ID}/prometheus/credentials" \
  -H "Authorization: Bearer ${TOKEN}" | jq .prometheus_credentials
# Returns: {username: "...", password: "..."}
```

---

## Operations

Create and Delete return an `Operation` with an `id`. Update also returns an
`Operation`, but there is no `TYPE_UPDATE_SERVERLESS_CLUSTER` in the
`Operation.Type` enum — only `TYPE_CREATE_SERVERLESS_CLUSTER` and
`TYPE_DELETE_SERVERLESS_CLUSTER` exist. You cannot filter operations by an
update-serverless type.

Use the Operations API to poll or list operations.

### Get Operation

```bash
curl -s "https://api.redpanda.com/v1/operations/${OP_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq '{state: .operation.state, error: .operation.error}'
```

**Operation fields** (from `operation.proto`):

| Field | Notes |
|---|---|
| `id` | 20-char opaque ID |
| `state` | `STATE_IN_PROGRESS`, `STATE_COMPLETED`, or `STATE_FAILED` |
| `type` | e.g. `TYPE_CREATE_SERVERLESS_CLUSTER`, `TYPE_DELETE_SERVERLESS_CLUSTER` (no update type exists) |
| `resource_id` | ID of the associated cluster |
| `error` | Present when `state == STATE_FAILED`; contains `google.rpc.Status` |
| `response` | Present when `state == STATE_COMPLETED`; contains the created/updated resource |
| `started_at` | Timestamp |
| `finished_at` | Timestamp |

### Poll Until Completed

```bash
wait_for_op() {
  local OP_ID="$1"
  while true; do
    STATE=$(curl -s "https://api.redpanda.com/v1/operations/${OP_ID}" \
      -H "Authorization: Bearer ${TOKEN}" | jq -r .operation.state)
    echo "Operation ${OP_ID}: ${STATE}"
    case "${STATE}" in
      STATE_COMPLETED) echo "Done."; return 0 ;;
      STATE_FAILED)    echo "Operation failed!"; return 1 ;;
    esac
    sleep 5
  done
}

wait_for_op "${OP_ID}"
```

### List Operations

```bash
# List all operations:
curl -s "https://api.redpanda.com/v1/operations" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.operations[] | {id, type, state}'

# Filter by type:
curl -s "https://api.redpanda.com/v1/operations?filter.type_in=TYPE_CREATE_SERVERLESS_CLUSTER" \
  -H "Authorization: Bearer ${TOKEN}" | jq .

# Filter by resource ID:
curl -s "https://api.redpanda.com/v1/operations?filter.resource_id=${CLUSTER_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq .
```

---

## Pagination

All list endpoints return a `next_page_token`. Pass it as `page_token` to fetch
the next page. An empty `next_page_token` means you've seen all results.

```bash
# First page:
RESP=$(curl -s "https://api.redpanda.com/v1/serverless/clusters?page_size=10" \
  -H "Authorization: Bearer ${TOKEN}")
echo "${RESP}" | jq '.serverless_clusters[].name'
NEXT=$(echo "${RESP}" | jq -r .next_page_token)

# Second page (if NEXT is non-empty):
curl -s "https://api.redpanda.com/v1/serverless/clusters?page_size=10&page_token=${NEXT}" \
  -H "Authorization: Bearer ${TOKEN}" | jq .
```

The rpk client caps pagination at 500 pages (`maxPages = 500` in `publicapi.go`).
