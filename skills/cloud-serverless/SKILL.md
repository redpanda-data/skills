---
name: cloud-serverless
description: >-
  Provision and manage Redpanda Cloud Serverless clusters via the public Control
  Plane API (https://api.redpanda.com). Covers OAuth2 client-credentials
  authentication, ResourceGroup management, ServerlessRegion discovery,
  ServerlessCluster lifecycle (create/get/list/update/delete), the async
  Operation state machine (STATE_PLACING → STATE_CREATING → STATE_READY), and
  calling the per-cluster Data Plane API for topics, ACLs, users, secrets, and
  pipelines. Also covers the Enterprise differentiators configurable on
  Serverless via topic configs and roles: Iceberg Topics
  (redpanda.iceberg.mode/target.lag.ms/partition.spec/invalid.record.action/delete),
  Server-Side Schema ID Validation (redpanda.key|value.schema.id.validation,
  subject.name.strategy), Leadership Pinning (redpanda.leaders.preference), and
  Role-Based Access Control (/v1/roles) — all Enterprise-licensed (license
  included on Cloud). Also covers AWS PrivateLink for private connectivity to a
  Serverless cluster (ServerlessPrivateLinkService and the private_link_id field).
  Use when: creating, listing, updating, or deleting Redpanda Cloud Serverless
  clusters via the public API; authenticating with OAuth client credentials for
  api.redpanda.com; choosing a serverless region; tracking a create/delete
  Operation until it completes; calling the data-plane URL returned by
  GetServerlessCluster to manage topics, ACLs, users, or secrets; enabling
  Iceberg Topics, schema ID validation, leader pinning, or RBAC on a Serverless
  cluster; setting up AWS PrivateLink / private networking
  (ServerlessPrivateLinkService, private_link_id); or distinguishing Serverless
  from BYOC provisioning.
---

# Redpanda Cloud API: Serverless Clusters

Redpanda Cloud Serverless clusters are fully managed Kafka-compatible clusters
provisioned through the public Control Plane API at `https://api.redpanda.com`.
You authenticate once with OAuth2 client credentials, then create a
`ResourceGroup`, pick a `ServerlessRegion`, and call `POST /v1/serverless/clusters`.
The API returns an async `Operation`; when the Operation reaches
`STATE_COMPLETED`, the cluster has reached `STATE_READY` and its
`dataplane_api.url` is live for Kafka workloads and the Data Plane REST API.
(`STATE_COMPLETED` is the Operation state; `STATE_READY` is the cluster state —
they are distinct state machines.)

This skill does **not** cover BYOC (Bring Your Own Cloud) clusters — see the
`cloud-byoc` skill for those. For the CLI equivalent, see the `rpk-cloud` skill.

## Quickstart

Copy-paste these commands. Replace `CLIENT_ID` and `CLIENT_SECRET` with the
credentials from your Redpanda Cloud service account.

```bash
# ── 1. Get a bearer token ─────────────────────────────────────────────────────
TOKEN=$(curl -s -X POST https://auth.prd.cloud.redpanda.com/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=${CLIENT_ID}" \
  -d "client_secret=${CLIENT_SECRET}" \
  -d "audience=cloudv2-production.redpanda.cloud" \
  | jq -r .access_token)

# ── 2. List available serverless regions ──────────────────────────────────────
curl -s -X GET "https://api.redpanda.com/v1/serverless/regions?cloud_provider=CLOUD_PROVIDER_AWS" \
  -H "Authorization: Bearer ${TOKEN}" | jq .

# ── 3. Create a resource group (billing/org container) ───────────────────────
RG_ID=$(curl -s -X POST https://api.redpanda.com/v1/resource-groups \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"resource_group": {"name": "my-dev-group"}}' \
  | jq -r .resource_group.id)

# ── 4. Create a serverless cluster ────────────────────────────────────────────
OP_ID=$(curl -s -X POST https://api.redpanda.com/v1/serverless/clusters \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"serverless_cluster\": {
      \"name\": \"my-cluster\",
      \"resource_group_id\": \"${RG_ID}\",
      \"serverless_region\": \"us-east-1\"
    }
  }" | jq -r .operation.id)

# ── 5. Poll the operation until STATE_COMPLETED ───────────────────────────────
watch -n 5 "curl -s https://api.redpanda.com/v1/operations/${OP_ID} \
  -H 'Authorization: Bearer ${TOKEN}' | jq '{state: .operation.state}'"

# ── 6. Get the cluster and its data-plane URL ─────────────────────────────────
# Read the cluster ID directly from the completed operation (resource_id or
# metadata.serverless_cluster_id) — more reliable than listing by name.
OP_RESP=$(curl -s "https://api.redpanda.com/v1/operations/${OP_ID}" \
  -H "Authorization: Bearer ${TOKEN}")
CLUSTER_ID=$(echo "${OP_RESP}" | jq -r '.operation.resource_id')

CLUSTER=$(curl -s "https://api.redpanda.com/v1/serverless/clusters/${CLUSTER_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.serverless_cluster')
echo "${CLUSTER}" | jq '{id: .id, state: .state, dataplane_url: .dataplane_api.url}'

DP_URL=$(echo "${CLUSTER}" | jq -r '.dataplane_api.url')

# ── 7. Create a topic via the data-plane URL ──────────────────────────────────
curl -s -X POST "${DP_URL}/v1/topics" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"topic": {"name": "events", "partition_count": 3, "replication_factor": 3}}'
```

## Authentication

The Control Plane API and Data Plane API both use the same OAuth2 bearer token.
See [Authentication Reference](references/auth.md) for full details.

| Field | Value |
|---|---|
| Token endpoint | `https://auth.prd.cloud.redpanda.com/oauth/token` |
| Audience | `cloudv2-production.redpanda.cloud` |
| Grant type | `client_credentials` |
| Control Plane base URL | `https://api.redpanda.com` |

Credentials come from a **ServiceAccount** created in the Redpanda Cloud console
or via `POST /v1/service-accounts`. The response includes a `client_id` and
`client_secret` (the secret is only shown once on creation; save it securely).

## Control Plane Resources

### ResourceGroup

A ResourceGroup is the billing and organizational container for clusters. It
must exist before you can create a ServerlessCluster.

```
POST   /v1/resource-groups
GET    /v1/resource-groups/{id}
GET    /v1/resource-groups          # list with optional filter.name_contains
PATCH  /v1/resource-groups/{resource_group.id}
DELETE /v1/resource-groups/{id}
```

Name constraints: 3–253 alphanumeric characters and hyphens (`^[a-zA-Z0-9-]+$`).

### ServerlessRegion

Regions represent the cloud-provider geographic areas where Serverless clusters
can be placed. List them before creating a cluster to confirm `placement.enabled`.

```
GET /v1/serverless/regions?cloud_provider=CLOUD_PROVIDER_AWS
GET /v1/serverless/regions?cloud_provider=CLOUD_PROVIDER_GCP
GET /v1/serverless/region?cloud_provider=CLOUD_PROVIDER_AWS&name=us-east-1
```

`cloud_provider` accepts `CLOUD_PROVIDER_AWS`, `CLOUD_PROVIDER_GCP`, or
`CLOUD_PROVIDER_AZURE`. Use `filter.placement_enabled_only=true` to skip
regions that cannot currently accept new clusters.

### ServerlessCluster Lifecycle

Full CRUD plus the Operation pattern:

```
POST   /v1/serverless/clusters           → 202 CreateServerlessClusterOperation
GET    /v1/serverless/clusters/{id}      → ServerlessCluster
GET    /v1/serverless/clusters           → ListServerlessClustersResponse (paginated)
PATCH  /v1/serverless/clusters/{id}      → 202 UpdateServerlessClusterOperation
DELETE /v1/serverless/clusters/{id}      → 202 DeleteServerlessClusterOperation
GET    /v1/serverless/clusters/{id}/prometheus/credentials
```

**State machine** (from the proto):

| State | Meaning |
|---|---|
| `STATE_PLACING` | Finding a cell with sufficient resources |
| `STATE_CREATING` | Creating control-plane state |
| `STATE_READY` | Running and accepting requests |
| `STATE_SUSPENDED` | Running but blocking external requests |
| `STATE_DELETING` | Removal in progress |
| `STATE_FAILED` | Could not reach READY from PLACING or CREATING |

**Create request fields** (grounded in `serverless.proto`):

| Field | Required | Notes |
|---|---|---|
| `name` | yes | 3–128 chars, `^[A-Za-z0-9-_:]+$` |
| `resource_group_id` | yes | UUID of an existing ResourceGroup |
| `serverless_region` | yes | Region name string, e.g. `"us-east-1"` |
| `tags` | no | `map<string,string>`, max 50 pairs |
| `networking_config` | no | Both fields default to `STATE_UNSPECIFIED` (0); resolved as public enabled, private disabled |

**Response fields on GET** (output-only):

| Field | Notes |
|---|---|
| `id` | 20-char opaque ID |
| `state` | One of the states above |
| `kafka_api.seed_brokers[]` | Public bootstrap servers |
| `kafka_api.private_seed_brokers[]` | Private bootstrap (when private networking enabled) |
| `dataplane_api.url` | Base URL for the per-cluster Data Plane REST API |
| `schema_registry.url` | Schema Registry public endpoint |
| `console_url` | Redpanda Console web UI URL |
| `prometheus.url` | Prometheus scrape endpoint |

### Operations

Create and Delete return an `Operation`. Update also returns an `Operation`,
but there is no `TYPE_UPDATE_SERVERLESS_CLUSTER` in the `Operation.Type` enum
(only `TYPE_CREATE_SERVERLESS_CLUSTER` and `TYPE_DELETE_SERVERLESS_CLUSTER`
exist). Poll at `GET /v1/operations/{id}`.

```
GET /v1/operations/{id}
GET /v1/operations               # list with filter.type_in / filter.state / filter.resource_id
```

Operation states: `STATE_IN_PROGRESS`, `STATE_COMPLETED`, `STATE_FAILED`.
When `state == STATE_COMPLETED`, the `response` field contains the final
resource. When `state == STATE_FAILED`, the `error` field contains a
`google.rpc.Status`.

### ServerlessPrivateLink (AWS PrivateLink)

The `private_link_id` field on a cluster refers to a **ServerlessPrivateLink**
resource, managed by its own control-plane service (**AWS only**). Create the
private link first, then pass its 20-char `id` as `private_link_id` when you
create a cluster with private networking enabled. Serverless on AWS went GA in
Feb 2026 with PrivateLink support.

```
POST   /v1/serverless/private-links       → 202 Operation (TYPE_CREATE_SERVERLESS_PRIVATE_LINK)
GET    /v1/serverless/private-links/{id}
GET    /v1/serverless/private-links        # list (paginated, filterable)
PATCH  /v1/serverless/private-links/{id}   → 202 Operation
DELETE /v1/serverless/private-links/{id}   → 202 Operation
```

Required create fields: `name`, `resource_group_id`, `cloudprovider`
(`CLOUD_PROVIDER_AWS` only — CEL-enforced with `aws_config`),
`aws_config.allowed_principals` (min 1 AWS principal ARN), and
`serverless_region`. See
[Control Plane: Serverless](references/control-plane-serverless.md#serverlessprivatelink)
for the full field-level reference and the private-networking workflow.

## Data Plane API

Once your cluster is `STATE_READY`, use `dataplane_api.url` as the base URL.
The same bearer token is valid. Base path is `/v1`. Always read the URL from
the API response — do not construct it manually. The real DNS pattern (from
`openapi.controlplane.yaml` examples) is
`https://<cluster-id>.any.<region>.mpx.prd.cloud.redpanda.com`.

Available services (grounded in `dataplane.go` and `openapi.dataplane.yaml`):

| Service | Endpoint prefix |
|---|---|
| Topic | `/v1/topics` |
| ACL | `/v1/acls` |
| User | `/v1/users` |
| Secret | `/v1/secrets` |
| Pipeline (Redpanda Connect) | `/v1/redpanda-connect/pipelines` |
| Security (RBAC roles) | `/v1/roles` |
| Quota | `/v1/quotas` |
| KafkaConnect | `/v1/kafka-connect/clusters/{cluster_name}/connectors` |

See [Data Plane Reference](references/data-plane.md) for examples and
availability notes on Serverless clusters.

## Enterprise Features on Serverless

Redpanda Cloud is a managed deployment of **Redpanda Enterprise Edition** — the
license is included, so there is no `rpk cluster license` step for tenants. The
enterprise differentiators you configure on Serverless are exposed as **topic
configuration keys** (via `${DP_URL}/v1/topics`) and **RBAC roles** (via
`${DP_URL}/v1/roles`), not cluster/node config:

| Feature (Enterprise) | How to set on Serverless | Key(s) |
|---|---|---|
| Iceberg Topics | Topic config | `redpanda.iceberg.mode` (`disabled`/`key_value`/`value_schema_id_prefix`/`value_schema_latest`), `redpanda.iceberg.target.lag.ms`, `redpanda.iceberg.partition.spec`, `redpanda.iceberg.invalid.record.action` (`drop`/`dlq_table`), `redpanda.iceberg.delete` |
| Server-Side Schema ID Validation | Topic config | `redpanda.key.schema.id.validation`, `redpanda.value.schema.id.validation`, `redpanda.key.subject.name.strategy`, `redpanda.value.subject.name.strategy` (`TopicNameStrategy`/`RecordNameStrategy`/`TopicRecordNameStrategy`) |
| Leadership Pinning | Topic config | `redpanda.leaders.preference` (inherits cluster `default_leaders_preference`) |
| RBAC | Data Plane SecurityService | `${DP_URL}/v1/roles` |

Cluster/node-level enterprise features (Tiered Storage internals, FIPS,
Continuous Data Balancing thresholds, Audit Logging, Remote Read Replicas,
Cloud Topics, Shadow Linking / cross-cluster DR, Whole Cluster Restore) are
**managed by Redpanda** on Serverless and are not tenant-configurable — use a
BYOC/Dedicated or self-managed cluster for those. See
[Enterprise Features Reference](references/enterprise-features.md) for the full
key tables, accepted values, defaults, mode semantics, and self-managed mappings.

## Serverless vs BYOC

| | Serverless | BYOC |
|---|---|---|
| Infra ownership | Redpanda manages everything | Customer's cloud account |
| Network resources | Not required | Requires creating a `Network` resource |
| Cluster type | Serverless (shared infrastructure) | Dedicated (`TYPE_DEDICATED`) |
| Provisioning agent | None | `rpk cloud byoc apply` runs Terraform |
| Billing | Redpanda bills per-use | Customer pays cloud provider directly |

## Reference Directory

- [Authentication](references/auth.md): OAuth2 client-credentials flow, token endpoint, audience, Authorization header, service-account creation, and token refresh.
- [Control Plane: Serverless](references/control-plane-serverless.md): ResourceGroup, ServerlessRegion, and ServerlessCluster field-level reference, the async Operation pattern, state machine, and list filtering.
- [Data Plane](references/data-plane.md): Using the per-cluster Data Plane API URL, Topic/ACL/User/Secret/Pipeline endpoints with curl examples.
- [Enterprise Features](references/enterprise-features.md): Enterprise differentiators configurable on Serverless — Iceberg Topics, Server-Side Schema ID Validation, Leadership Pinning, and RBAC — with every topic config key, accepted values, defaults, Iceberg mode semantics, license-requirement notes, and which cluster-level features are managed by Redpanda (not tenant-configurable).
