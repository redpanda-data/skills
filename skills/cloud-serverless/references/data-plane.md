# Data Plane API for Serverless Clusters

Once your ServerlessCluster is in `STATE_READY`, use the `dataplane_api.url`
returned by `GetServerlessCluster` as the base URL. The same bearer token you
used for the Control Plane is valid here.

All data plane services use base path `/v1`. The API follows ConnectRPC/REST
conventions with JSON bodies.

**Grounding**: service client names are derived from
`publicapi/dataplane.go` (`DataPlaneClientSet`). Endpoint paths, HTTP methods,
request/response body schemas, and field names are grounded in the generated
OpenAPI spec at
`cloudv2/proto/gen/openapi/openapi.dataplane.yaml`.

---

## Getting the Data Plane URL

```bash
# Get cluster and extract data-plane URL:
CLUSTER=$(curl -s "https://api.redpanda.com/v1/serverless/clusters/${CLUSTER_ID}" \
  -H "Authorization: Bearer ${TOKEN}")

DP_URL=$(echo "${CLUSTER}" | jq -r '.serverless_cluster.dataplane_api.url')
echo "Data plane URL: ${DP_URL}"
# The exact URL is returned by the API; do not hard-code it.
# Real pattern (from API examples): https://<cluster-id>.any.<region>.mpx.prd.cloud.redpanda.com
# e.g. https://d1d9risv0c3i7qbbeoc0.any.us-east-1.mpx.prd.cloud.redpanda.com
```

All examples below use `${DP_URL}` and `${TOKEN}`.

---

## Topics

Create, list, describe, and delete topics.

### Create a Topic

```bash
curl -s -X POST "${DP_URL}/v1/topics" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "topic": {
      "name": "orders",
      "partition_count": 6,
      "replication_factor": 3,
      "configs": [
        {"name": "retention.ms",  "value": "86400000"},
        {"name": "cleanup.policy", "value": "delete"}
      ]
    }
  }' | jq .
# Note: use "configs" (not "configurations") inside the topic create body.
# "configurations" is only the field name on the GET/PATCH/PUT .../configurations endpoints.
```

### List Topics

```bash
curl -s "${DP_URL}/v1/topics" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.topics[].name'
```

### Get Topic Configurations

```bash
curl -s "${DP_URL}/v1/topics/orders/configurations" \
  -H "Authorization: Bearer ${TOKEN}" | jq .configurations
```

### Update Topic Configurations (incremental)

Use **PATCH** (`TopicService_UpdateTopicConfigurations`) to update one or more
keys while leaving all other configs unchanged:

```bash
curl -s -X PATCH "${DP_URL}/v1/topics/orders/configurations" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"configurations": [{"name": "retention.ms", "value": "172800000"}]}' | jq .
```

### Set Topic Configurations (full replace)

Use **PUT** (`TopicService_SetTopicConfigurations`) only when you want to
**replace the entire configuration set**. Any key not listed will revert to
the cluster default — a common foot-gun when you only intend to change one
setting:

```bash
# WARNING: this resets ALL other topic configs to their cluster defaults.
curl -s -X PUT "${DP_URL}/v1/topics/orders/configurations" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "configurations": [
      {"name": "retention.ms",  "value": "172800000"},
      {"name": "cleanup.policy", "value": "delete"}
    ]
  }' | jq .
```

### Delete a Topic

```bash
curl -s -X DELETE "${DP_URL}/v1/topics/orders" \
  -H "Authorization: Bearer ${TOKEN}"
# Returns 204 No Content
```

---

## ACLs

Manage Kafka Access Control Lists.

### Create an ACL

The ACL fields are top-level in the request body (no `"acl"` wrapper).
Use `permission_type` (not `permission`):

```bash
curl -s -X POST "${DP_URL}/v1/acls" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "resource_type": "RESOURCE_TYPE_TOPIC",
    "resource_name": "orders",
    "resource_pattern_type": "RESOURCE_PATTERN_TYPE_LITERAL",
    "principal": "User:my-service-account",
    "host": "*",
    "operation": "OPERATION_READ",
    "permission_type": "PERMISSION_TYPE_ALLOW"
  }' | jq .
```

### List ACLs

```bash
# List all ACLs:
curl -s "${DP_URL}/v1/acls" \
  -H "Authorization: Bearer ${TOKEN}" | jq .acls

# Filter by principal:
curl -s "${DP_URL}/v1/acls?filter.principal=User:my-service-account" \
  -H "Authorization: Bearer ${TOKEN}" | jq .
```

### Delete ACLs

Delete uses **query parameters** (not a request body) to specify the filter
(`ACLService_DeleteACLs`):

```bash
curl -s -X DELETE \
  "${DP_URL}/v1/acls?filter.resource_type=RESOURCE_TYPE_TOPIC\
&filter.resource_name=orders\
&filter.resource_pattern_type=RESOURCE_PATTERN_TYPE_LITERAL\
&filter.principal=User:my-service-account\
&filter.operation=OPERATION_READ\
&filter.permission_type=PERMISSION_TYPE_ALLOW" \
  -H "Authorization: Bearer ${TOKEN}" | jq .
```

---

## Users (SASL/SCRAM)

Create broker-level users for SASL/SCRAM authentication. These are distinct from
IAM service accounts — they are Kafka-level users that clients authenticate with
when connecting to Kafka brokers.

### Create a User

```bash
curl -s -X POST "${DP_URL}/v1/users" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "user": {
      "name": "kafka-producer",
      "password": "str0ng-p@ssword!",
      "mechanism": "SASL_MECHANISM_SCRAM_SHA_256"
    }
  }' | jq .user
```

### List Users

```bash
curl -s "${DP_URL}/v1/users" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.users[].name'
```

### Update User Password

The update path uses `{user.name}` as the path parameter (distinct from the
delete path `/v1/users/{name}`). The request body wrapper `{"user": {...}}`
is correct here:

```bash
curl -s -X PUT "${DP_URL}/v1/users/kafka-producer" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"user": {"mechanism": "SASL_MECHANISM_SCRAM_SHA_256", "password": "new-p@ssword!"}}' | jq .
# Path: /v1/users/{user.name}  (operationId: UserService_UpdateUser)
# Note: delete uses /v1/users/{name} — same segment value, different routing.
```

### Delete a User

```bash
curl -s -X DELETE "${DP_URL}/v1/users/kafka-producer" \
  -H "Authorization: Bearer ${TOKEN}"
```

---

## Secrets

Secrets are named, encrypted key-value pairs stored in the cluster. They can
be referenced by name in Connect pipelines and other configurations.

### Create a Secret

The secret fields are top-level in the request body (no `"secret"` wrapper).
Include `scopes` so the secret is usable by Connect pipelines and other
services — a secret with no scope cannot be referenced:

```bash
curl -s -X POST "${DP_URL}/v1/secrets" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "DATABASE_PASSWORD",
    "secret_data": "bXktc3VwZXItc2VjcmV0",
    "scopes": ["SCOPE_REDPANDA_CONNECT"]
  }' | jq .
# secret_data must be base64-encoded.
# Scope enum values: SCOPE_REDPANDA_CONNECT, SCOPE_REDPANDA_CLUSTER,
#   SCOPE_MCP_SERVER, SCOPE_AI_AGENT, SCOPE_AI_GATEWAY
```

### List Secrets

```bash
curl -s "${DP_URL}/v1/secrets" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.secrets[].id'
```

### Get a Secret

```bash
curl -s "${DP_URL}/v1/secrets/DATABASE_PASSWORD" \
  -H "Authorization: Bearer ${TOKEN}" | jq .
# Note: secret_data is not returned; only metadata
```

### Delete a Secret

```bash
curl -s -X DELETE "${DP_URL}/v1/secrets/DATABASE_PASSWORD" \
  -H "Authorization: Bearer ${TOKEN}"
```

---

## Pipelines (Redpanda Connect)

Pipelines are Redpanda Connect (formerly Benthos) streaming pipelines
managed server-side. They run inside the cluster.

All pipeline endpoints are under `/v1/redpanda-connect/pipelines`
(operationId prefix `PipelineService_`). There is no `/v1/pipelines` path.

### Create a Pipeline

The pipeline fields are sent under the `"pipeline"` key (x-originalParamName):

```bash
curl -s -X POST "${DP_URL}/v1/redpanda-connect/pipelines" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "pipeline": {
      "display_name": "my-transform",
      "description": "Reads from orders, maps to enriched-orders",
      "config_yaml": "input:\n  kafka_franz:\n    seed_brokers: [\"${SEED_BROKERS}\"]\n    topics: [\"orders\"]\n    consumer_group: \"pipeline-consumer\"\n\noutput:\n  kafka_franz:\n    seed_brokers: [\"${SEED_BROKERS}\"]\n    topic: \"enriched-orders\"\n"
    }
  }' | jq .pipeline
```

### List Pipelines

```bash
curl -s "${DP_URL}/v1/redpanda-connect/pipelines" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.pipelines[] | {id, display_name, state}'
```

### Start/Stop a Pipeline

Start and Stop use **PUT** (`PipelineService_StartPipeline` /
`PipelineService_StopPipeline`):

```bash
# Start:
curl -s -X PUT "${DP_URL}/v1/redpanda-connect/pipelines/${PIPELINE_ID}/start" \
  -H "Authorization: Bearer ${TOKEN}"

# Stop:
curl -s -X PUT "${DP_URL}/v1/redpanda-connect/pipelines/${PIPELINE_ID}/stop" \
  -H "Authorization: Bearer ${TOKEN}"
```

### Get a Pipeline

```bash
curl -s "${DP_URL}/v1/redpanda-connect/pipelines/${PIPELINE_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq .pipeline
```

### Delete a Pipeline

```bash
curl -s -X DELETE "${DP_URL}/v1/redpanda-connect/pipelines/${PIPELINE_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
```

---

## Security Roles (RBAC)

Manage Redpanda broker-level RBAC roles. The path is `/v1/roles`
(not `/v1/security/roles`):

### Create a Role

```bash
curl -s -X POST "${DP_URL}/v1/roles" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"role": {"name": "topic-reader"}}' | jq .role
```

### List Roles

```bash
curl -s "${DP_URL}/v1/roles" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.roles[].name'
```

### Get Role Members

```bash
curl -s "${DP_URL}/v1/roles/topic-reader/members" \
  -H "Authorization: Bearer ${TOKEN}" | jq .
```

---

## Client Quotas

Set per-client throughput quotas. Use **POST** `/v1/quotas`
(`QuotaService_SetQuota`). The entity and value are top-level fields — no
`"quota"` wrapper. Use `entity_type` / `entity_name` and `value_type` /
`value` enums.

Note: `ENTITY_TYPE_USER` and `ENTITY_TYPE_IP` are **not supported in
Redpanda**; use `ENTITY_TYPE_CLIENT_ID` or `ENTITY_TYPE_CLIENT_ID_PREFIX`.

### Set a Quota

```bash
curl -s -X POST "${DP_URL}/v1/quotas" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": {
      "entity_type": "ENTITY_TYPE_CLIENT_ID",
      "entity_name": "my-client"
    },
    "value": {
      "value_type": "VALUE_TYPE_PRODUCER_BYTE_RATE",
      "value": 10485760
    }
  }' | jq .
# entity_type values (Redpanda-supported): ENTITY_TYPE_CLIENT_ID, ENTITY_TYPE_CLIENT_ID_PREFIX
# value_type values: VALUE_TYPE_PRODUCER_BYTE_RATE, VALUE_TYPE_CONSUMER_BYTE_RATE,
#   VALUE_TYPE_CONTROLLER_MUTATION_RATE
# (VALUE_TYPE_REQUEST_PERCENTAGE is not supported in Redpanda)
```

---

## Complete End-to-End Example

This example creates a cluster, waits for it to be ready, then sets up a
topic with a user and an ACL:

```bash
#!/usr/bin/env bash
set -euo pipefail

BASE="https://api.redpanda.com"

# 1. Auth
TOKEN=$(curl -s -X POST https://auth.prd.cloud.redpanda.com/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "client_id=${CLIENT_ID}" \
  --data-urlencode "client_secret=${CLIENT_SECRET}" \
  --data-urlencode "audience=cloudv2-production.redpanda.cloud" \
  | jq -r .access_token)

AUTH="-H 'Authorization: Bearer ${TOKEN}'"

# 2. Get or create resource group
RG_ID=$(curl -s "${BASE}/v1/resource-groups?filter.name_contains=default-rg" \
  -H "Authorization: Bearer ${TOKEN}" | jq -r '.resource_groups[0].id // empty')
if [[ -z "${RG_ID}" ]]; then
  RG_ID=$(curl -s -X POST "${BASE}/v1/resource-groups" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"resource_group": {"name": "default-rg"}}' | jq -r .resource_group.id)
fi
echo "ResourceGroup: ${RG_ID}"

# 3. Create cluster
OP_ID=$(curl -s -X POST "${BASE}/v1/serverless/clusters" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"serverless_cluster\": {
      \"name\": \"prod-cluster\",
      \"resource_group_id\": \"${RG_ID}\",
      \"serverless_region\": \"us-east-1\"
    }
  }" | jq -r .operation.id)
echo "Create operation: ${OP_ID}"

# 4. Wait for cluster
until [[ "$(curl -s "${BASE}/v1/operations/${OP_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq -r .operation.state)" == "STATE_COMPLETED" ]]; do
  echo "Waiting..."
  sleep 10
done

# 5. Get cluster ID and data-plane URL from the completed operation
# The operation carries the cluster ID directly in resource_id and metadata.
OP_RESP=$(curl -s "${BASE}/v1/operations/${OP_ID}" \
  -H "Authorization: Bearer ${TOKEN}")
CLUSTER_ID=$(echo "${OP_RESP}" | jq -r .operation.resource_id)

CLUSTER=$(curl -s "${BASE}/v1/serverless/clusters/${CLUSTER_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.serverless_cluster')
DP_URL=$(echo "${CLUSTER}" | jq -r .dataplane_api.url)
BROKERS=$(echo "${CLUSTER}" | jq -r '.kafka_api.seed_brokers | join(",")')
echo "Cluster ${CLUSTER_ID} ready at ${DP_URL}"
echo "Bootstrap: ${BROKERS}"

# 6. Create topic
curl -s -X POST "${DP_URL}/v1/topics" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"topic": {"name": "events", "partition_count": 6, "replication_factor": 3}}' | jq .topic.name

# 7. Create user
curl -s -X POST "${DP_URL}/v1/users" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "user": {
      "name": "app-producer",
      "password": "change-me-123!",
      "mechanism": "SASL_MECHANISM_SCRAM_SHA_256"
    }
  }' | jq .user.name

# 8. Grant ACL: app-producer can write to events
# Fields are top-level (no "acl" wrapper); use "permission_type" not "permission".
curl -s -X POST "${DP_URL}/v1/acls" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "resource_type": "RESOURCE_TYPE_TOPIC",
    "resource_name": "events",
    "resource_pattern_type": "RESOURCE_PATTERN_TYPE_LITERAL",
    "principal": "User:app-producer",
    "host": "*",
    "operation": "OPERATION_WRITE",
    "permission_type": "PERMISSION_TYPE_ALLOW"
  }' | jq .
```

---

## Available Data Plane Services

The following services exist in the Data Plane API client set (grounded in
`DataPlaneClientSet` in `dataplane.go` and `openapi.dataplane.yaml`). Services
marked **[Serverless: confirmed]** are verified against the generated OpenAPI.
Services marked **[Serverless: availability unconfirmed]** exist in the API
surface but their availability on Serverless (shared-infrastructure) clusters
is not established by the source files — verify with the Redpanda Cloud
documentation or by inspecting cluster capabilities at runtime.

| Service | Endpoint prefix | Serverless |
|---|---|---|
| `TopicService` | `/v1/topics` | confirmed |
| `ACLService` | `/v1/acls` | confirmed |
| `UserService` | `/v1/users` | confirmed |
| `SecretService` | `/v1/secrets` | confirmed |
| `PipelineService` | `/v1/redpanda-connect/pipelines` | confirmed |
| `SecurityService` (RBAC roles) | `/v1/roles` | confirmed |
| `QuotaService` | `/v1/quotas` | confirmed |
| `KafkaConnectService` | `/v1/kafka-connect/clusters/{cluster_name}/connectors` | availability unconfirmed |
| `MonitoringService` | `/v1/monitoring/kafka/connections` | availability unconfirmed |
| `CloudStorageService` | `/v1/cloud-storage/topics/mountable` (+ `.../topics/mount`, `.../topics/unmount`, `/v1/cloud-storage/mount-tasks`, `/v1/cloud-storage/mount-tasks/{id}`) | availability unconfirmed |
| `TransformService` | `/v1/transforms`, `/v1/transforms/{name}` | availability unconfirmed |

**Note on KafkaConnect**: connectors require a named Kafka Connect cluster;
the path is `/v1/kafka-connect/clusters/{cluster_name}/connectors` — there is
no `/v1/connectors` path in the API. Kafka Connect is **disabled by default**
on new clusters (since Jul 2025); it must be enabled before use. Source:
Redpanda Cloud docs, `develop/managed-connectors/`.

**Note on Monitoring**: the only path in the public v1 data-plane OpenAPI is
`/v1/monitoring/kafka/connections` (active-Kafka-connections listing). There is
no `/v1/metrics` data-plane endpoint — cluster metrics are scraped from the
`prometheus.url` returned by `GetServerlessCluster`.

**Note on Transforms**: Wasm data transforms run on the broker and are
generally not offered to Serverless (shared-infrastructure) tenants; the paths
exist in the data-plane surface but Serverless availability is unconfirmed.

**Note on Shadow Linking**: Shadow Linking is a **control-plane** API, not a
data-plane one. Manage shadow links via `ShadowLinkService` at
`https://api.redpanda.com` (`POST /v1/shadow-links`, `GET /v1/shadow-links`,
`GET /v1/shadow-links/{id}`), not the per-cluster data-plane URL. (A separate
data-plane shadow-topic surface at `/v1/shadow-links/{name}/...` exists for
failover and per-topic operations, but link lifecycle is control-plane.) On
Serverless, DR is handled by the managed platform — see
[Enterprise Features Reference](enterprise-features.md).

**Note on AI Agents, Knowledge Bases, MCP Servers**: `AIAgentService` and
`KnowledgeBaseService` are **not** present in the public v1 data-plane OpenAPI
(they are part of the Agentic Data Platform — see the `adp` skill — and out of
scope here). `MCPServerService` does exist in the data-plane OpenAPI at
`/v1/redpanda-connect/mcp-servers`, but it is ADP-adjacent rather than a core
Kafka/Connect data-plane service; see the `adp` skill for MCP server coverage.
