---
name: cloud-dedicated
description: >-
  Provision and manage Redpanda Cloud Dedicated clusters via the Control Plane
  API (https://api.redpanda.com). Covers OAuth2 client-credentials auth
  (Auth0, audience cloudv2-production.redpanda.cloud), creating a Network
  resource (cluster_type TYPE_DEDICATED, Redpanda-managed VPC, cidr_block),
  creating a TYPE_DEDICATED cluster (cloud_provider, region, zones,
  throughput_tier, connection_type, redpanda_version, tags), polling
  long-running Operations (STATE_IN_PROGRESS -> STATE_COMPLETED), and using
  the per-cluster Data Plane API URL returned by GetCluster for Topic/ACL/User/
  Secret management. Use when: creating, listing, updating, or deleting
  Redpanda Cloud Dedicated clusters via the public API; choosing a region,
  zones, or throughput tier for a Dedicated cluster; configuring connectivity
  (CONNECTION_TYPE_PUBLIC, CONNECTION_TYPE_PRIVATE, PrivateLink on AWS/GCP/Azure,
  GCP Private Service Connect, or VPC/network peering via NetworkPeeringService);
  comparing Dedicated vs BYOC vs Serverless; scripting the full
  provisioning lifecycle end-to-end with curl; or using rpk cloud with a
  Dedicated cluster (rpk cloud login, rpk cloud cluster select). Also covers
  the Enterprise differentiators included on Dedicated and their nested config
  keys: Tiered Storage (redpanda.storage.mode, redpanda.remote.read/write/
  recovery), Cloud Topics (cloud_topics_enabled), Iceberg Topics
  (redpanda.iceberg.mode/delete/partition.spec/target.lag.ms, iceberg_enabled),
  Continuous Data Balancing (partition_autobalancing_mode=continuous + disk/
  availability thresholds), Shadow Linking cross-cluster DR (rpk shadow,
  ShadowLinkConfig, /v1/shadow-links, failover), Remote Read Replicas
  (redpanda.remote.readreplica), Mountable Topics, Leadership Pinning
  (redpanda.leaders.preference, default_leaders_preference), Server-side Schema
  ID Validation (enable_schema_id_validation), Audit Logging (audit_* keys),
  RBAC/GBAC, OIDC/OAuthBearer/Kerberos auth, and FIPS mode.
---

# Redpanda Cloud API: Dedicated Clusters

Dedicated clusters are fully Redpanda-managed, single-tenant Kafka clusters that run in **Redpanda's own cloud account** (AWS, GCP, or Azure). Redpanda provisions the VPC, Kubernetes, storage, and agent — you provide only the region, availability zones, throughput tier, and connectivity preferences. Enterprise capabilities (Tiered Storage, Remote Read Replicas, RBAC, OIDC, and more) are included by default.

The provisioning workflow has three phases: (1) create a **Network** resource scoped to `cluster_type: TYPE_DEDICATED`, (2) create a **Cluster** of `type: TYPE_DEDICATED` referencing that network, and (3) poll the returned `Operation` until `state: STATE_COMPLETED`. After the cluster reaches `STATE_READY`, call `GetCluster` to retrieve the per-cluster `dataplane_api.url` and connect to topics, ACLs, and users.

All API calls go to `https://api.redpanda.com` (ConnectRPC/HTTP-JSON gateway) and require a Bearer token from the Auth0 client-credentials flow. The same token and base URL work for Dedicated, BYOC, and Serverless control-plane calls.

## Quickstart

```bash
# 1. Get an OAuth2 bearer token (client credentials)
TOKEN=$(curl -s -X POST "https://auth.prd.cloud.redpanda.com/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=${CLIENT_ID}" \
  -d "client_secret=${CLIENT_SECRET}" \
  -d "audience=cloudv2-production.redpanda.cloud" \
  | jq -r '.access_token')

BASE="https://api.redpanda.com"

# 2. Create (or reuse) a Resource Group
RG=$(curl -s -X POST "${BASE}/v1/resource-groups" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"resource_group": {"name": "prod-dedicated"}}')
RG_ID=$(echo "${RG}" | jq -r '.resource_group.id')

# 3. List available regions for AWS
curl -s "${BASE}/v1/regions/CLOUD_PROVIDER_AWS" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.regions[].name'

# 4. Create a Dedicated Network (Redpanda manages the VPC)
NET_OP=$(curl -s -X POST "${BASE}/v1/networks" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"network\": {
      \"name\": \"prod-dedicated-net\",
      \"resource_group_id\": \"${RG_ID}\",
      \"cloud_provider\": \"CLOUD_PROVIDER_AWS\",
      \"region\": \"us-east-1\",
      \"cidr_block\": \"10.0.0.0/20\",
      \"cluster_type\": \"TYPE_DEDICATED\"
    }
  }")
NET_OP_ID=$(echo "${NET_OP}" | jq -r '.operation.id')
echo "Network operation: ${NET_OP_ID}"

# 5. Poll until the network is ready
until [ "$(curl -s "${BASE}/v1/operations/${NET_OP_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq -r '.operation.state')" = "STATE_COMPLETED" ]; do
  echo "Waiting for network..."; sleep 15
done
NET_ID=$(curl -s "${BASE}/v1/operations/${NET_OP_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq -r '.operation.resource_id')

# 6. Create a TYPE_DEDICATED cluster
CLUSTER_OP=$(curl -s -X POST "${BASE}/v1/clusters" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"cluster\": {
      \"name\": \"prod-dedicated\",
      \"resource_group_id\": \"${RG_ID}\",
      \"network_id\": \"${NET_ID}\",
      \"type\": \"TYPE_DEDICATED\",
      \"cloud_provider\": \"CLOUD_PROVIDER_AWS\",
      \"region\": \"us-east-1\",
      \"zones\": [\"use1-az1\", \"use1-az2\", \"use1-az4\"],
      \"throughput_tier\": \"tier-1-aws-v2-arm\",
      \"connection_type\": \"CONNECTION_TYPE_PUBLIC\"
    }
  }")
CLUSTER_OP_ID=$(echo "${CLUSTER_OP}" | jq -r '.operation.id')
echo "Cluster operation: ${CLUSTER_OP_ID}"

# 7. Poll until the cluster is ready (can take 20–40 minutes)
until [ "$(curl -s "${BASE}/v1/operations/${CLUSTER_OP_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq -r '.operation.state')" = "STATE_COMPLETED" ]; do
  echo "Waiting for cluster..."; sleep 30
done
CLUSTER_ID=$(curl -s "${BASE}/v1/operations/${CLUSTER_OP_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq -r '.operation.resource_id')

# 8. Get cluster details including the Data Plane URL
CLUSTER=$(curl -s "${BASE}/v1/clusters/${CLUSTER_ID}" \
  -H "Authorization: Bearer ${TOKEN}")
DP_URL=$(echo "${CLUSTER}" | jq -r '.cluster.dataplane_api.url')
BROKER=$(echo "${CLUSTER}" | jq -r '.cluster.kafka_api.seed_brokers[0]')
echo "Data Plane URL: ${DP_URL}"
echo "Kafka bootstrap: ${BROKER}"

# 9. Create a topic via the Data Plane API
curl -s -X POST "${DP_URL}/v1/topics" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"topic": {"name": "events", "partition_count": 12, "replication_factor": 3}}'
```

## Authentication

The control plane uses OAuth2 client credentials. Obtain a client ID and secret from the **Clients tab of the Users section** in the Redpanda Cloud console, then:

```bash
curl -s -X POST "https://auth.prd.cloud.redpanda.com/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&audience=cloudv2-production.redpanda.cloud"
```

The token goes in `Authorization: Bearer <token>` on every request. With rpk:
```bash
rpk cloud login --client-id "${CLIENT_ID}" --client-secret "${CLIENT_SECRET}" --save
TOKEN=$(rpk cloud auth token)
```

## Dedicated vs BYOC vs Serverless

| Dimension | Dedicated | BYOC | Serverless |
|---|---|---|---|
| Cloud account | Redpanda's | Customer's | Redpanda's (shared) |
| Tenancy | Single-tenant | Single-tenant | Multi-tenant |
| VPC ownership | Redpanda | Customer | Redpanda |
| Network resource needed | Yes (`TYPE_DEDICATED`) | Yes (`TYPE_BYOC`) | No (separate `ServerlessCluster` service) |
| Agent installation | None (Redpanda-managed) | `rpk cloud byoc apply` required | None |
| Customer-managed resources | Not required | Required (IAM, buckets, subnets) | Not applicable |
| Enterprise features | Included | Included | Limited subset |
| Pricing model | Throughput tier + cloud infra | Throughput tier + own cloud bill | Pay-per-use |
| API service used | `ClusterService` | `ClusterService` | `ServerlessClusterService` |
| Cluster type field | `TYPE_DEDICATED` | `TYPE_BYOC` | N/A |

## Key API Endpoints

All paths are under `https://api.redpanda.com`:

| Method | Path | Description |
|---|---|---|
| POST | `/v1/resource-groups` | Create resource group |
| GET | `/v1/resource-groups` | List resource groups |
| POST | `/v1/networks` | Create network (Redpanda-managed VPC) |
| GET | `/v1/networks` | List networks |
| POST | `/v1/clusters` | Create Dedicated cluster |
| GET | `/v1/clusters/{id}` | Get cluster (includes `dataplane_api.url`) |
| PATCH | `/v1/clusters/{cluster.id}?update_mask=<fields>` | Update cluster (path param is `cluster.id`; `update_mask` query param required; body is the `ClusterUpdate` object directly) |
| DELETE | `/v1/clusters/{id}` | Delete cluster |
| GET | `/v1/operations/{id}` | Poll long-running operation |
| GET | `/v1/regions/{cloud_provider}` | List available regions |
| POST/GET/DELETE | `/v1/network/{network_id}/network-peerings` | VPC network peering (returns Operation on create/delete) |
| POST/GET/PATCH/DELETE | `/v1/shadow-links` | Shadow Linking control-plane service (returns Operation on create/update/delete) |

## rpk Cloud CLI

```bash
# Login (interactive or headless)
rpk cloud login
rpk cloud login --client-id ${CLIENT_ID} --client-secret ${CLIENT_SECRET} --save

# List clusters (shows both Dedicated and BYOC)
rpk cloud cluster select   # interactive cluster picker

# Print the current auth token
rpk cloud auth token
```

## Cluster States

The `Operation.state` and `Cluster.state` are distinct state machines that progress concurrently.

Poll `GET /v1/operations/{op_id}` to track the operation:
- `STATE_IN_PROGRESS` — the create/update/delete is still running
- `STATE_COMPLETED` — the operation finished successfully; `resource_id` is the cluster ID
- `STATE_FAILED` — the operation failed

The cluster's own `Cluster.state` field progresses **during** the in-progress operation (not after it completes):

```
STATE_CREATING_AGENT -> STATE_CREATING -> STATE_READY
```

The operation reaches `STATE_COMPLETED` roughly when the cluster reaches `STATE_READY`. Other cluster states: `STATE_UPGRADING`, `STATE_SUSPENDED`, `STATE_FAILED`. See the [Create Cluster reference](references/create-cluster.md) for the full state machine.

## Enterprise Features

Redpanda Cloud is a managed deployment of Redpanda **Enterprise Edition**, so on a Dedicated cluster the enterprise differentiators are part of the subscription — **no separate license key is applied**. You enable and tune them with **topic properties** (Data Plane `TopicService`, `rpk topic`, or Kafka `AlterConfigs`) and **cluster configuration properties** (`ClusterCreate.cluster_configuration.custom_properties`, `PATCH /v1/clusters/{id}` with `cluster_configuration`, or `rpk cluster config set`). Numeric cluster-config values must be JSON strings; some changes require a restart that runs as a long-running Operation.

| Feature | Key config (nested keys in the reference) |
|---|---|
| Tiered Storage | `redpanda.storage.mode`, `redpanda.remote.read/write/recovery`, `retention.local.target.{ms,bytes}`; cluster `cloud_storage_enabled`, `cloud_storage_enable_remote_{read,write}`, `default_redpanda_storage_mode` |
| Cloud Topics | cluster `cloud_topics_enabled`; topic `redpanda.storage.mode=cloud` |
| Iceberg Topics | `redpanda.iceberg.mode` (`disabled`/`key_value`/`value_schema_id_prefix`/`value_schema_latest`), `redpanda.iceberg.delete`, `redpanda.iceberg.invalid.record.action`, `redpanda.iceberg.partition.spec`, `redpanda.iceberg.target.lag.ms`; cluster `iceberg_enabled`, `iceberg_default_catalog_namespace`, `iceberg_catalog_type`, `iceberg_rest_catalog_endpoint`, `iceberg_target_lag_ms` |
| Continuous Data Balancing | `partition_autobalancing_mode=continuous`, `partition_autobalancing_node_availability_timeout_sec`, `partition_autobalancing_node_autodecommission_timeout_sec`, `partition_autobalancing_max_disk_usage_percent`, `core_balancing_continuous` |
| Shadow Linking (DR) | Control-plane `ShadowLinkService` (`POST/GET/PATCH/DELETE /v1/shadow-links`, returns Operations); `ShadowLinkCreate` (`shadow_redpanda_id`, `name`, `source_redpanda_id` XOR `client_options.bootstrap_servers`, `topic_metadata_sync_options`, `consumer_offset_sync_options`, `security_sync_options`, `schema_registry_sync_options`); `rpk shadow create/status/failover` |
| Remote Read Replicas | topic `redpanda.remote.readreplica`; cluster `cloud_storage_enable_remote_read` |
| Mountable Topics | Data Plane `CloudStorageService` mount/unmount tasks |
| Leadership Pinning | topic `redpanda.leaders.preference` (`racks:`/`ordered_racks:`); cluster `default_leaders_preference` |
| Schema ID Validation | cluster `enable_schema_id_validation` (`none`/`redpanda`/`compat`); topic `redpanda.{key,value}.schema.id.validation`, `redpanda.{key,value}.subject.name.strategy` |
| Audit Logging | `audit_enabled`, `audit_log_num_partitions`, `audit_log_replication_factor`, `audit_enabled_event_types`, `audit_excluded_{topics,principals}`, `audit_client_max_buffer_size`, `audit_queue_drain_interval_ms`, `audit_queue_max_buffer_size_per_shard` |
| RBAC / GBAC | Data Plane `/v1/roles`; `Group:` ACL principals (GBAC) |
| OIDC / OAuthBearer / Kerberos | `sasl_mechanisms` (`OAUTHBEARER`, `GSSAPI`), `http_authentication` (`OIDC`), `oidc_*` |
| FIPS mode | node `fips_mode` (`disabled`/`enabled`/`permissive`) |

See the [Enterprise Features reference](references/enterprise-features.md) for full per-feature key tables, defaults, curl/rpk examples, and license-expiration behavior.

## Reference Directory

- [Model and Auth](references/model-and-auth.md): What Dedicated is vs BYOC vs Serverless (infrastructure ownership, tenancy, networking, cost, control); OAuth2 client-credentials auth and the bearer token; the end-to-end provisioning flow; grounded in controlplane.go and publicapi.go.
- [Create Cluster](references/create-cluster.md): Creating a Dedicated cluster via the Cluster service — all `ClusterCreate` fields: `type=TYPE_DEDICATED`, `cloud_provider`, `region`, `zones`, `throughput_tier`, `connection_type`, PrivateLink specs (AWS/GCP/Azure), `redpanda_version`, `cloud_provider_tags`, `cluster_configuration`; get/list/update (PATCH `/v1/clusters/{cluster.id}` with required `update_mask` query param, body is `ClusterUpdate` directly)/delete; `NetworkPeeringService` VPC peering; Operation lifecycle and cluster state machine; grounded in the public cluster.proto, network_peering.proto, operation.proto, and openapi.controlplane.yaml.
- [Data Plane](references/data-plane.md): Using the per-cluster Data Plane API URL returned by `GetCluster` for a Dedicated cluster: Topic, ACL, User, and Secret endpoints with curl examples; verified `/v1` service paths (pipelines under `/v1/redpanda-connect/pipelines`, cloud-storage mount tasks, monitoring); base path `/v1`; bearer auth; grounded in openapi.dataplane.yaml and dataplane.go.
- [Enterprise Features](references/enterprise-features.md): The Enterprise differentiators included on Dedicated and their nested settings/config keys — Tiered Storage, Cloud Topics, Iceberg Topics (`redpanda.iceberg.*`, `iceberg_*`), Continuous Data Balancing (`partition_autobalancing_*`, `core_balancing_continuous`), Shadow Linking cross-cluster DR (control-plane `ShadowLinkService` at `/v1/shadow-links`, `rpk shadow` failover), Remote Read Replicas, Mountable Topics, Leadership Pinning, Server-side Schema ID Validation, Audit Logging (`audit_*`), RBAC/GBAC, OIDC/OAuthBearer/Kerberos, FIPS, and Whole Cluster Restore. Each entry lists topic vs cluster scope, values/defaults, curl + rpk examples, and license-expiration behavior; grounded in the upstream feature docs and licensing overview.
