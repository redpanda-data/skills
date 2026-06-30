# Data Plane API: Topics, ACLs, Users, and Secrets

## Overview

After a Dedicated cluster reaches `STATE_READY`, call `GET /v1/clusters/{id}` to retrieve the per-cluster **Data Plane API URL** (`cluster.dataplane_api.url`). This URL is unique to each cluster and is used for all data-plane operations: creating topics, setting ACLs, managing users, and storing secrets.

The Data Plane API is a ConnectRPC/HTTP service at the cluster-specific URL. All calls use the same Bearer token obtained from the Auth0 client-credentials flow.

Source: `dataplane.go` (the shared `DataPlaneClientSet` struct, used by Dedicated, BYOC, and Serverless clusters, with `ACL`, `Topic`, `User`, `Secret`, `Security`, `Pipeline`, etc. clients); `cluster.proto` (`Cluster.DataplaneAPI.url`, example: `"https://api-ab1234l0.cjb69h1c4vs42pca89s0.fmc.prd.cloud.redpanda.com"`).

## Getting the Data Plane URL

```bash
CLUSTER=$(curl -s "https://api.redpanda.com/v1/clusters/${CLUSTER_ID}" \
  -H "Authorization: Bearer ${TOKEN}")

DP_URL=$(echo "${CLUSTER}" | jq -r '.cluster.dataplane_api.url')
echo "Data Plane URL: ${DP_URL}"
# Example: https://api-ab1234l0.cjb69h1c4vs42pca89s0.fmc.prd.cloud.redpanda.com
```

**Note:** `dataplane_api.url` is not returned in `ListClusters`. Use `GetCluster` to retrieve it.

## Authentication

The same Bearer token used for control-plane calls works for data-plane calls. The token is sent as `Authorization: Bearer <token>` on every request.

```bash
# Reuse the same TOKEN variable from auth
curl -s "${DP_URL}/v1/topics" \
  -H "Authorization: Bearer ${TOKEN}" | jq .
```

Source: `dataplane.go` (`newReloadingAuthInterceptor` and `newAuthInterceptor` used for data-plane clients; `DataPlaneClientSet.authToken`).

## Base Path

All Data Plane API endpoints use the path prefix `/v1`. The base is the `dataplane_api.url` value.

```
${DP_URL}/v1/topics
${DP_URL}/v1/acls
${DP_URL}/v1/users
${DP_URL}/v1/secrets
${DP_URL}/v1/roles
${DP_URL}/v1/quotas
```

## Available Services

The shared `DataPlaneClientSet` in `dataplane.go` (used by Dedicated, BYOC, and Serverless clusters) exposes these services:

| Service | Client Field | Base Path |
|---|---|---|
| `TopicService` | `Topic` | `/v1/topics` |
| `ACLService` | `ACL` | `/v1/acls` |
| `UserService` | `User` | `/v1/users` |
| `SecretService` | `Secret` | `/v1/secrets` |
| `SecurityService` | `Security` | `/v1/roles` (RBAC roles) |
| `QuotaService` | `Quota` | `/v1/quotas` |
| `TransformService` | `Transform` | `/v1/transforms`, `/v1/transforms/{name}` (Wasm data transforms; available on Dedicated) |
| `PipelineService` | `Pipeline` | `/v1/redpanda-connect/pipelines`, `/v1/redpanda-connect/pipelines/{id}` (+ `/start`, `/stop`) |
| `CloudStorageService` | `CloudStorage` | `/v1/cloud-storage/topics/mountable`, `/topics/mount`, `/topics/unmount`, `/v1/cloud-storage/mount-tasks`, `/mount-tasks/{id}` |
| `MonitoringService` | `Monitoring` | `/v1/monitoring/kafka/connections` |
| `KafkaConnectService` | `KafkaConnect` | `/v1/kafka-connect/clusters/{cluster_name}/...` (disabled by default on new clusters) |

Topic partition management is also under `TopicService`: `GET/POST /v1/topics/{topic_name}/partitions`. Redpanda Connect component metadata is exposed at `/v1/redpanda-connect/components` and `/v1/redpanda-connect/config-schema`.

The verified `/v1` data-plane OpenAPI does **not** include `AIAgentService` or `KnowledgeBaseService` — those are ADP-only services outside the core data plane (see the `adp` skill). `MCPServerService` exists at `/v1/redpanda-connect/mcp-servers` (Redpanda Connect MCP servers), and is also ADP-adjacent. **`ShadowLinkService` is a control-plane service** under `https://api.redpanda.com` (`/v1/shadow-links`, `/v1/shadow-links/{id}`) — see the [Enterprise Features reference](enterprise-features.md#shadow-linking--cross-cluster-disaster-recovery-enterprise).

This skill documents Topics, ACLs, Users, Secrets, Security Roles, and Quotas in detail. Other services follow the same Bearer-auth pattern.

Source: `openapi.dataplane.yaml` (verified `/v1` paths); `dataplane.go` (`DataPlaneClientSet` struct fields).

## Topics

### Create a Topic

```bash
curl -s -X POST "${DP_URL}/v1/topics" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "topic": {
      "name": "events",
      "partition_count": 12,
      "replication_factor": 3,
      "configs": [
        {"name": "retention.ms", "value": "604800000"},
        {"name": "cleanup.policy", "value": "delete"},
        {"name": "compression.type", "value": "snappy"}
      ]
    }
  }'
```

### List Topics

```bash
curl -s "${DP_URL}/v1/topics" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.topics[] | {name, partition_count}'
```

### Get Topic Configuration

```bash
curl -s "${DP_URL}/v1/topics/${TOPIC_NAME}/configurations" \
  -H "Authorization: Bearer ${TOKEN}" | jq .
```

### Update Topic Configuration

```bash
curl -s -X PATCH "${DP_URL}/v1/topics/${TOPIC_NAME}/configurations" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "configurations": [
      {"name": "retention.ms", "value": "86400000", "operation": "CONFIG_ALTER_OPERATION_SET"}
    ]
  }'
```

### Delete a Topic

```bash
curl -s -X DELETE "${DP_URL}/v1/topics/${TOPIC_NAME}" \
  -H "Authorization: Bearer ${TOKEN}"
```

### Tiered Storage Topic Configuration

For Dedicated clusters, Tiered Storage is included. Configure via topic properties:

```bash
curl -s -X POST "${DP_URL}/v1/topics" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "topic": {
      "name": "tiered-events",
      "partition_count": 12,
      "replication_factor": 3,
      "configs": [
        {"name": "redpanda.remote.write", "value": "true"},
        {"name": "redpanda.remote.read", "value": "true"},
        {"name": "retention.bytes", "value": "-1"},
        {"name": "retention.ms", "value": "2592000000"}
      ]
    }
  }'
```

## ACLs

ACLs control access to Kafka resources (topics, groups, cluster, transactional IDs).

### Create an ACL

```bash
curl -s -X POST "${DP_URL}/v1/acls" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "resource_type": "RESOURCE_TYPE_TOPIC",
    "resource_name": "events",
    "resource_pattern_type": "RESOURCE_PATTERN_TYPE_LITERAL",
    "principal": "User:alice",
    "host": "*",
    "operation": "OPERATION_ALL",
    "permission_type": "PERMISSION_TYPE_ALLOW"
  }'
```

### Common ACL Patterns

```bash
# Allow a user to produce to a topic
curl -s -X POST "${DP_URL}/v1/acls" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "resource_type": "RESOURCE_TYPE_TOPIC",
    "resource_name": "events",
    "resource_pattern_type": "RESOURCE_PATTERN_TYPE_LITERAL",
    "principal": "User:producer",
    "host": "*",
    "operation": "OPERATION_WRITE",
    "permission_type": "PERMISSION_TYPE_ALLOW"
  }'

# Allow a user to consume from all topics via prefix pattern
curl -s -X POST "${DP_URL}/v1/acls" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "resource_type": "RESOURCE_TYPE_TOPIC",
    "resource_name": "events-",
    "resource_pattern_type": "RESOURCE_PATTERN_TYPE_PREFIXED",
    "principal": "User:consumer",
    "host": "*",
    "operation": "OPERATION_READ",
    "permission_type": "PERMISSION_TYPE_ALLOW"
  }'

# Grant consumer group access
curl -s -X POST "${DP_URL}/v1/acls" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "resource_type": "RESOURCE_TYPE_GROUP",
    "resource_name": "my-consumer-group",
    "resource_pattern_type": "RESOURCE_PATTERN_TYPE_LITERAL",
    "principal": "User:consumer",
    "host": "*",
    "operation": "OPERATION_READ",
    "permission_type": "PERMISSION_TYPE_ALLOW"
  }'
```

### List ACLs

```bash
# List all ACLs
curl -s "${DP_URL}/v1/acls" \
  -H "Authorization: Bearer ${TOKEN}" | jq .

# Filter by principal
curl -s "${DP_URL}/v1/acls?filter.principal=User:alice" \
  -H "Authorization: Bearer ${TOKEN}" | jq .
```

### Delete ACLs

`DeleteACLs` takes its filter as **query parameters** (`filter.*`), not a request body — the gateway populates the filter via `PopulateQueryParameters`, so any JSON body is ignored. Always pass an explicit filter; an empty/unset filter matches broadly.

```bash
# Delete a specific ACL: every filter field is a filter.* query parameter
curl -s -G -X DELETE "${DP_URL}/v1/acls" \
  -H "Authorization: Bearer ${TOKEN}" \
  --data-urlencode "filter.resource_type=RESOURCE_TYPE_TOPIC" \
  --data-urlencode "filter.resource_name=events" \
  --data-urlencode "filter.resource_pattern_type=RESOURCE_PATTERN_TYPE_LITERAL" \
  --data-urlencode "filter.principal=User:alice" \
  --data-urlencode "filter.host=*" \
  --data-urlencode "filter.operation=OPERATION_ALL" \
  --data-urlencode "filter.permission_type=PERMISSION_TYPE_ALLOW"
```

Filter fields (`DeleteACLsRequest.Filter`, all optional/`filter.` query params): `resource_type`, `resource_name`, `resource_pattern_type`, `principal`, `host`, `operation`, `permission_type`.

## Users (SASL Kafka Users)

Create SASL users that authenticate to the Kafka API.

### Create a User

```bash
curl -s -X POST "${DP_URL}/v1/users" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "user": {
      "name": "alice",
      "password": "super-secret-password-123",
      "mechanism": "SASL_MECHANISM_SCRAM_SHA_256"
    }
  }'
```

Supported mechanisms: `SASL_MECHANISM_SCRAM_SHA_256`, `SASL_MECHANISM_SCRAM_SHA_512`.

### List Users

```bash
curl -s "${DP_URL}/v1/users" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.users[].name'
```

### Update User Password

```bash
curl -s -X PUT "${DP_URL}/v1/users/${USERNAME}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "user": {
      "password": "new-password-456",
      "mechanism": "SASL_MECHANISM_SCRAM_SHA_256"
    }
  }'
```

### Delete a User

```bash
curl -s -X DELETE "${DP_URL}/v1/users/${USERNAME}" \
  -H "Authorization: Bearer ${TOKEN}"
```

## Secrets

Secrets store sensitive values (passwords, API keys) that can be referenced by Redpanda Connect pipelines and other components.

### Create a Secret

The request body is flat (no wrapper object). The `scopes` field is required and controls where the secret can be referenced. Supported scope values: `SCOPE_REDPANDA_CONNECT`, `SCOPE_REDPANDA_CLUSTER`, `SCOPE_MCP_SERVER`, `SCOPE_AI_AGENT`, `SCOPE_AI_GATEWAY`.

```bash
curl -s -X POST "${DP_URL}/v1/secrets" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "DB_PASSWORD",
    "scopes": ["SCOPE_REDPANDA_CONNECT"],
    "secret_data": "bXlwYXNzd29yZA=="
  }'
```

`secret_data` must be base64-encoded.

```bash
# Encode your secret value
SECRET_B64=$(echo -n "my-actual-secret-value" | base64)
```

### List Secrets

```bash
curl -s "${DP_URL}/v1/secrets" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.secrets[] | {id, scopes}'
```

### Get a Secret

```bash
curl -s "${DP_URL}/v1/secrets/${SECRET_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq .
```

### Update a Secret

The request body is flat (no wrapper object). Include `scopes` when updating.

```bash
curl -s -X PUT "${DP_URL}/v1/secrets/${SECRET_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "scopes": ["SCOPE_REDPANDA_CONNECT"],
    "secret_data": "bmV3LXNlY3JldC12YWx1ZQ=="
  }'
```

### Delete a Secret

```bash
curl -s -X DELETE "${DP_URL}/v1/secrets/${SECRET_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
```

## Security Roles (RBAC)

Dedicated clusters support Redpanda RBAC (Role-Based Access Control). Create roles and assign users to them.

Role endpoints use `/v1/roles` (no `security/` prefix). Role membership items contain a single `principal` string (e.g. `"User:alice"`). The membership update uses `PUT /v1/roles/{role_name}`.

```bash
# Create a role
curl -s -X POST "${DP_URL}/v1/roles" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "role": {
      "name": "topic-producer"
    }
  }'

# List roles
curl -s "${DP_URL}/v1/roles" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.roles[].name'

# Get role members
curl -s "${DP_URL}/v1/roles/${ROLE_NAME}/members" \
  -H "Authorization: Bearer ${TOKEN}" | jq .

# Assign users to a role (PUT /v1/roles/{role_name})
curl -s -X PUT "${DP_URL}/v1/roles/${ROLE_NAME}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "add": [
      {"principal": "User:alice"}
    ],
    "remove": [],
    "create": true
  }'
```

Source: `dataplane.go` (`DataPlaneClientSet.Security` — `SecurityService` client).

## Quotas

Set Kafka quotas per user or client.

SetQuota uses POST (not PUT). The `entity` field is a single object (not an array). The quota value is a single `value` object (not an array) with `value_type` and `value`. Supported `entity_type` values: `ENTITY_TYPE_CLIENT_ID`, `ENTITY_TYPE_CLIENT_ID_PREFIX`. Supported `value_type` values: `VALUE_TYPE_PRODUCER_BYTE_RATE`, `VALUE_TYPE_CONSUMER_BYTE_RATE`, `VALUE_TYPE_CONTROLLER_MUTATION_RATE`.

```bash
# Set produce rate quota for a client ID
curl -s -X POST "${DP_URL}/v1/quotas" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "entity": {"entity_type": "ENTITY_TYPE_CLIENT_ID", "entity_name": "alice"},
    "value": {"value_type": "VALUE_TYPE_PRODUCER_BYTE_RATE", "value": 1048576}
  }'

# List quotas
curl -s "${DP_URL}/v1/quotas" \
  -H "Authorization: Bearer ${TOKEN}" | jq .
```

Source: `dataplane.go` (`DataPlaneClientSet.Quota`).

## Connecting with rpk

After selecting a cluster in rpk, you can use rpk commands directly against the Dedicated cluster:

```bash
# Select your Dedicated cluster
rpk cloud cluster select

# List topics
rpk topic list

# Create a topic
rpk topic create events --partitions 12 --replicas 3

# Produce
echo '{"key": "k1", "value": "hello"}' | rpk topic produce events

# Consume
rpk topic consume events --num 10
```

rpk reads the `dataplane_api.url` and Kafka bootstrap servers from the active profile set by `rpk cloud cluster select`.

## Connecting with kcat (kafkacat)

```bash
# Get bootstrap server from cluster
BROKER=$(curl -s "https://api.redpanda.com/v1/clusters/${CLUSTER_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq -r '.cluster.kafka_api.seed_brokers[0]')

# Produce (SASL/SCRAM)
echo "hello world" | kcat -P -b "${BROKER}" \
  -X security.protocol=SASL_SSL \
  -X sasl.mechanism=SCRAM-SHA-256 \
  -X sasl.username=alice \
  -X sasl.password=super-secret-password-123 \
  -t events

# Consume
kcat -C -b "${BROKER}" \
  -X security.protocol=SASL_SSL \
  -X sasl.mechanism=SCRAM-SHA-256 \
  -X sasl.username=alice \
  -X sasl.password=super-secret-password-123 \
  -t events -o beginning -e
```

## HTTP Proxy (Pandaproxy)

Use the HTTP Proxy URL from `cluster.http_proxy.url` to produce and consume without a Kafka client:

```bash
HTTP_PROXY=$(curl -s "https://api.redpanda.com/v1/clusters/${CLUSTER_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq -r '.cluster.http_proxy.url')

# Produce a message
curl -s -X POST "${HTTP_PROXY}/topics/events" \
  -H "Content-Type: application/vnd.kafka.json.v2+json" \
  -u "alice:super-secret-password-123" \
  -d '{"records": [{"value": {"hello": "world"}}]}'

# Consume (create consumer first)
curl -s -X POST "${HTTP_PROXY}/consumers/my-group" \
  -H "Content-Type: application/vnd.kafka.v2+json" \
  -u "alice:super-secret-password-123" \
  -d '{"name": "my-consumer", "format": "json", "auto.offset.reset": "earliest"}'
```

## Schema Registry

Use the Schema Registry URL from `cluster.schema_registry.url`:

```bash
SR_URL=$(curl -s "https://api.redpanda.com/v1/clusters/${CLUSTER_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq -r '.cluster.schema_registry.url')

# List schemas
curl -s "${SR_URL}/subjects" \
  -u "alice:super-secret-password-123" | jq .

# Register a schema
curl -s -X POST "${SR_URL}/subjects/events-value/versions" \
  -H "Content-Type: application/vnd.schemaregistry.v1+json" \
  -u "alice:super-secret-password-123" \
  -d '{
    "schema": "{\"type\":\"record\",\"name\":\"Event\",\"fields\":[{\"name\":\"id\",\"type\":\"string\"}]}"
  }'
```

## Prometheus Metrics

`cluster.prometheus.url` is the **full public_metrics endpoint URL** (already includes the path `/api/cloud/prometheus/public_metrics`). Scrape it directly with a Bearer token. The auth mechanism is the same control-plane Bearer token used for all API calls.

```bash
PROM_URL=$(curl -s "https://api.redpanda.com/v1/clusters/${CLUSTER_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq -r '.cluster.prometheus.url')

# PROM_URL is the full endpoint, e.g.:
# https://console-aa0000l0.cjb69h1c4vs42pca89s0.fmc.prd.cloud.redpanda.com/api/cloud/prometheus/public_metrics

# Scrape metrics (Bearer token auth)
curl -s "${PROM_URL}" \
  -H "Authorization: Bearer ${TOKEN}" | grep "redpanda_kafka"
```
