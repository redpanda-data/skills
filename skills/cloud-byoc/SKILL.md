---
name: cloud-byoc
description: >-
  Provision and manage Redpanda Cloud BYOC (Bring Your Own Cloud) clusters via
  the Control Plane API (https://api.redpanda.com) and the rpk cloud byoc agent
  plugin. Covers OAuth2 client-credentials auth, creating Network resources per
  cloud provider (AWS VPC/subnets/IAM, GCP network/project/bucket, Azure
  VNet/subnets/identities), creating TYPE_BYOC clusters (network_id,
  throughput_tier, cloud_provider_tags, customer_managed_resources), polling
  long-running Operations until READY, and running the Terraform-backed rpk
  cloud byoc apply/destroy/validate flow with --redpanda-id. Use when: creating
  BYOC clusters in AWS/GCP/Azure via the public API; provisioning or tearing
  down BYOC networks; wiring customer-managed IAM roles/buckets/subnets into a
  Redpanda cluster; setting up private connectivity (AWS PrivateLink, GCP Private
  Service Connect, Azure Private Link, VPC/network peering via NetworkPeeringService,
  and AWS Transit Gateway centralized egress); registering cross-account AWS access
  (CloudProviderAccessService, cloud_provider_access_id); managing Shadow Link
  cross-cluster DR via the control-plane ShadowLinkService; running `rpk cloud byoc
  apply`; understanding BYOC vs Serverless; or scripting the full BYOC provisioning
  lifecycle end-to-end.
  Also covers enabling Redpanda Enterprise features on a BYOC cluster (the
  enterprise license is included with the Cloud subscription) via
  cluster_configuration.custom_properties and topic properties: Tiered Storage
  (redpanda.remote.*), Cloud Topics (redpanda.cloud_topic.enabled /
  redpanda.storage.mode), Iceberg Topics (iceberg_enabled,
  redpanda.iceberg.mode/delete/partition.spec/target.lag.ms/invalid.record.action),
  Continuous Data Balancing (partition_autobalancing_mode=continuous and
  disk/availability thresholds), Shadow Linking cross-cluster DR (rpk shadow
  create/status/failover --for-cloud), Remote Read Replicas, Audit Logging
  (audit_enabled and audit_* keys), RBAC/GBAC, OIDC/OAuthBearer/Kerberos auth,
  FIPS, Server-Side Schema ID Validation, and Leadership Pinning
  (default_leaders_preference / redpanda.leaders.preference).
---

# Redpanda Cloud API: BYOC Clusters

BYOC (Bring Your Own Cloud) lets you run Redpanda in your own AWS, GCP, or Azure account: Redpanda manages the control plane and agent lifecycle, while your VPC, IAM roles, and storage buckets stay under your cloud account. You pay cloud infrastructure costs directly. This is the primary alternative to Serverless, which runs entirely in Redpanda's account.

The provisioning workflow has three phases: (1) create a **Network** resource that registers your VPC/VNet with Redpanda, (2) create a **Cluster** resource of `TYPE_BYOC` referencing that network, and (3) run `rpk cloud byoc apply --redpanda-id <id>` to execute the Terraform that installs the agent in your cloud account.

Both the Network and Cluster create calls return an `Operation` object — poll `GET /v1/operations/{id}` until `state` is `STATE_COMPLETED` before proceeding.

## Quickstart

```bash
# 1. Get an OAuth2 bearer token (client credentials flow)
TOKEN=$(curl -s -X POST "https://auth.prd.cloud.redpanda.com/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=${CLIENT_ID}" \
  -d "client_secret=${CLIENT_SECRET}" \
  -d "audience=cloudv2-production.redpanda.cloud" \
  | jq -r '.access_token')

BASE="https://api.redpanda.com"

# 2. Create (or identify) a Resource Group
curl -s -X POST "${BASE}/v1/resource-groups" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"resource_group": {"name": "my-byoc-rg"}}' | jq .

RG_ID="<resource_group_id from response>"

# 3. Create a Network (AWS example — Redpanda-managed VPC, CIDR-based)
NET_OP=$(curl -s -X POST "${BASE}/v1/networks" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"network\": {
      \"name\": \"my-byoc-network\",
      \"resource_group_id\": \"${RG_ID}\",
      \"cloud_provider\": \"CLOUD_PROVIDER_AWS\",
      \"region\": \"us-east-1\",
      \"cidr_block\": \"10.0.0.0/20\",
      \"cluster_type\": \"TYPE_BYOC\"
    }
  }" | jq .)

NET_OP_ID=$(echo "${NET_OP}" | jq -r '.operation.id')

# 4. Poll the network operation until STATE_COMPLETED
until [ "$(curl -s "${BASE}/v1/operations/${NET_OP_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq -r '.operation.state')" = "STATE_COMPLETED" ]; do
  echo "Waiting for network…"; sleep 10
done

NET_ID=$(curl -s "${BASE}/v1/networks?filter.name_contains=my-byoc-network" \
  -H "Authorization: Bearer ${TOKEN}" | jq -r '.networks[0].id')

# 5. Create the BYOC cluster
CLUSTER_OP=$(curl -s -X POST "${BASE}/v1/clusters" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"cluster\": {
      \"name\": \"my-byoc-cluster\",
      \"resource_group_id\": \"${RG_ID}\",
      \"type\": \"TYPE_BYOC\",
      \"cloud_provider\": \"CLOUD_PROVIDER_AWS\",
      \"region\": \"us-east-1\",
      \"zones\": [\"use1-az1\", \"use1-az2\", \"use1-az3\"],
      \"throughput_tier\": \"tier-1-aws-v2-arm\",
      \"network_id\": \"${NET_ID}\",
      \"connection_type\": \"CONNECTION_TYPE_PUBLIC\"
    }
  }" | jq .)

# Note: tier names are version-dependent. Authoritative list:
#   GET /v1/regions?cloud_provider=CLOUD_PROVIDER_AWS  (or GCP/AZURE)
#   or see https://docs.redpanda.com/redpanda-cloud/reference/tiers/byoc-tiers/
# Real AWS examples: tier-1-aws-v2-arm, tier-1-aws-v2-x86, tier-1-aws-v3-arm
# Real GCP examples: tier-1-gcp-v2-x86, tier-1-gcp-um4g

CLUSTER_OP_ID=$(echo "${CLUSTER_OP}" | jq -r '.operation.id')

# Poll until cluster_id is available in operation metadata (may not be populated on first poll)
until CLUSTER_ID=$(curl -s "${BASE}/v1/operations/${CLUSTER_OP_ID}" \
    -H "Authorization: Bearer ${TOKEN}" \
    | jq -r '.operation.metadata.cluster_id // .operation.resource_id // empty'); \
    [ -n "${CLUSTER_ID}" ]; do
  echo "Waiting for cluster ID…"; sleep 5
done

# 6. Poll until CREATING_AGENT state — the control plane is waiting for the agent
until [ "$(curl -s "${BASE}/v1/clusters/${CLUSTER_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq -r '.cluster.state')" = "STATE_CREATING_AGENT" ]; do
  echo "Waiting for cluster to reach CREATING_AGENT…"; sleep 15
done

# 7. Run the rpk byoc agent (install + apply)
rpk cloud byoc install --redpanda-id "${CLUSTER_ID}" \
  -X cloud.client_id="${CLIENT_ID}" \
  -X cloud.client_secret="${CLIENT_SECRET}"

# AWS provider — runs Terraform in your account
rpk cloud byoc aws apply --redpanda-id "${CLUSTER_ID}" \
  -X cloud.client_id="${CLIENT_ID}" \
  -X cloud.client_secret="${CLIENT_SECRET}"

# 8. Poll until STATE_READY
until [ "$(curl -s "${BASE}/v1/clusters/${CLUSTER_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq -r '.cluster.state')" = "STATE_READY" ]; do
  echo "Waiting for cluster to be ready…"; sleep 30
done

echo "Cluster is READY"
```

## BYOC vs Serverless

| Dimension | BYOC | Serverless |
|---|---|---|
| Infra ownership | Customer VPC / account | Redpanda's account |
| Cloud bill | Customer pays AWS/GCP/Azure directly | Redpanda charges per usage |
| Network isolation | Fully isolated VPC | Shared multi-tenant |
| Agent required | Yes — `rpk cloud byoc apply` | No |
| Cluster type | `TYPE_BYOC` | `TYPE_SERVERLESS` |
| Network resource | Required | Not required |
| Customer-managed IAM | Optional (`customer_managed_resources`) | Not supported |
| Throughput tiers | Dedicated tiers | Serverless tiers |

## Control Plane API Overview

**Base URL:** `https://api.redpanda.com`

**Auth:** Bearer token obtained via OAuth2 client credentials. Set `Authorization: Bearer <token>` on every request.

**Protocol:** ConnectRPC (also accepts standard HTTP/JSON via the REST gateway).

All mutating operations (CreateNetwork, CreateCluster, DeleteCluster, DeleteNetwork) return an `Operation` object with a 20-character ID. Poll `GET /v1/operations/{id}` to track progress.

| Resource | Endpoints |
|---|---|
| Networks | `POST /v1/networks`, `GET /v1/networks/{id}`, `GET /v1/networks`, `DELETE /v1/networks/{id}` |
| Clusters | `POST /v1/clusters`, `GET /v1/clusters/{id}`, `GET /v1/clusters`, `PATCH /v1/clusters/{id}?update_mask=...`, `DELETE /v1/clusters/{id}` |
| Network Peerings | `POST /v1/network/{network_id}/network-peerings`, `GET`/`DELETE /v1/network/{network_id}/network-peerings/{id}`, `GET /v1/network/{network_id}/network-peerings` |
| Cloud Provider Access (PREVIEW) | `POST /v1/cloud-provider-accesses`, `GET`/`DELETE /v1/cloud-provider-accesses/{id}`, `GET /v1/cloud-provider-accesses` |
| Shadow Links | `POST /v1/shadow-links`, `GET`/`DELETE /v1/shadow-links/{id}`, `GET /v1/shadow-links`, `PATCH /v1/shadow-links/{id}?update_mask=...` |
| Operations | `GET /v1/operations/{id}`, `GET /v1/operations` |
| Scheduled Operations (PREVIEW) | `GET /v1/scheduled-operations` (list only) |
| Resource Groups | `POST /v1/resource-groups`, `GET /v1/resource-groups/{id}`, `GET /v1/resource-groups` |
| Regions | `GET /v1/regions`, `GET /v1/regions/{id}` |

## Cluster State Machine

BYOC clusters move through these states (grounded in `cluster.proto`):

```
STATE_CREATING_AGENT → STATE_CREATING → STATE_READY
                                       ↗
STATE_UPGRADING ──────────────────────
STATE_DELETING_AGENT → STATE_DELETING → (deleted)
STATE_FAILED
STATE_SUSPENDED
```

The cluster enters `STATE_CREATING_AGENT` after the API accepts the create request. This is when you must run `rpk cloud byoc apply` to install the agent Terraform. Once the agent completes provisioning, the cluster transitions to `STATE_CREATING`, then `STATE_READY`.

## rpk cloud byoc Commands

```bash
# Install the byoc plugin (pinned to the cluster's required version)
rpk cloud byoc install --redpanda-id <cluster-id>

# Apply (provision) agent infra — cloud-provider subcommand is required.
# GCP also requires --project-id; Azure also requires --subscription-id.
rpk cloud byoc aws apply   --redpanda-id <cluster-id>
rpk cloud byoc gcp apply   --redpanda-id <cluster-id> --project-id <gcp-project-id>
rpk cloud byoc azure apply --redpanda-id <cluster-id> --subscription-id <azure-sub-id>

# Destroy agent infra (same per-provider account flags as apply)
rpk cloud byoc aws destroy   --redpanda-id <cluster-id>
rpk cloud byoc gcp destroy   --redpanda-id <cluster-id> --project-id <gcp-project-id>
rpk cloud byoc azure destroy --redpanda-id <cluster-id> --subscription-id <azure-sub-id>

# Validate prerequisites without a cluster ID (uses latest plugin version)
rpk cloud byoc aws validate
rpk cloud byoc gcp validate
# Note: only aws/gcp validate are confirmed; azure validate is not separately attested.

# Uninstall the local plugin binary
rpk cloud byoc uninstall
```

The `--redpanda-id` flag is required for `apply` and `destroy`. The plugin is automatically pinned to the version the control plane specifies for the given cluster ID. Set `RPK_CLOUD_SKIP_VERSION_CHECK=1` to use the currently installed plugin binary as-is (dev/CI use only).

Authentication for `rpk cloud byoc` uses the same client credentials as `rpk cloud login`:

```bash
# Via -X flags (not persisted)
rpk cloud byoc aws apply --redpanda-id <id> \
  -X cloud.client_id=<id> \
  -X cloud.client_secret=<secret>

# Via environment variables
export RPK_CLOUD_CLIENT_ID=<id>
export RPK_CLOUD_CLIENT_SECRET=<secret>
rpk cloud byoc aws apply --redpanda-id <id>
```

## Enterprise Features on BYOC

Redpanda Cloud BYOC is a managed deployment of **Redpanda Enterprise Edition** — the enterprise license is included in your Cloud subscription, so you never apply a license key. Every enterprise differentiator is available; you turn it on through cluster config and topic properties, not a license workflow.

Two surfaces:

1. **Cluster-config properties** (e.g. `iceberg_enabled`, `audit_enabled`, `partition_autobalancing_mode`, `default_leaders_preference`, `enable_schema_id_validation`) — set via the Control Plane API under `cluster_configuration.custom_properties` at `POST /v1/clusters` (create) or `PATCH /v1/clusters/{id}?update_mask=cluster_configuration.custom_properties` (update), or via `rpk cluster config set` on the data plane. Integer values must be strings in `custom_properties`.
2. **Topic properties** (e.g. `redpanda.iceberg.mode`, `redpanda.remote.write`, `redpanda.cloud_topic.enabled`, `redpanda.leaders.preference`) — set with `rpk topic create -c ...` / `rpk topic alter-config` on the data plane after the cluster is `STATE_READY`.

```bash
# Enable an enterprise cluster property after the cluster exists.
# update_mask is a REQUIRED query parameter (comma-separated snake_case field paths —
# the API uses proto field names); the JSON body IS the ClusterUpdate object directly
# (no "cluster" wrapper, no update_mask in body).
curl -s -X PATCH "${BASE}/v1/clusters/${CLUSTER_ID}?update_mask=cluster_configuration.custom_properties" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d '{"cluster_configuration":{"custom_properties":{"iceberg_enabled":"true"}}}' | jq '.operation.id'
```

Key features and their nested keys (full detail in [Enterprise Features](references/enterprise-features.md)):

| Feature | Where | Primary keys |
|---|---|---|
| Tiered Storage (always on) | topic | `redpanda.remote.write/read/delete/recovery`, `redpanda.storage.mode` |
| Cloud Topics | topic | `redpanda.cloud_topic.enabled`, `redpanda.storage.mode=cloud` |
| Iceberg Topics | cluster + topic | `iceberg_enabled`, `iceberg_default_catalog_namespace`; `redpanda.iceberg.mode/delete/invalid.record.action/partition.spec/target.lag.ms` |
| Continuous Data Balancing | cluster | `partition_autobalancing_mode=continuous`, `partition_autobalancing_max_disk_usage_percent`, `partition_autobalancing_node_availability_timeout_sec`, `partition_autobalancing_node_autodecommission_timeout_sec`, `core_balancing_continuous` |
| Shadow Linking (DR) | rpk | `rpk shadow config generate --for-cloud` / `create` / `status` / `failover` |
| Remote Read Replicas | topic + cluster | `redpanda.remote.readreplica`, `cloud_storage_enable_remote_read` |
| Audit Logging | cluster | `audit_enabled`, `audit_log_num_partitions`, `audit_enabled_event_types`, `audit_excluded_topics/principals`, `audit_queue_drain_interval_ms` |
| RBAC / GBAC | rpk / ACLs | `rpk security role ...`; `Group:` principals |
| OIDC / OAuthBearer / Kerberos | cluster | `sasl_mechanisms` (`OAUTHBEARER`, `GSSAPI`), `http_authentication` (`OIDC`) |
| Schema ID Validation | cluster + topic | `enable_schema_id_validation`; `redpanda.{key,value}.schema.id.validation`, `redpanda.{key,value}.subject.name.strategy` |
| Leadership Pinning | cluster + topic | `default_leaders_preference`, `redpanda.leaders.preference` (`none` / `racks:` / `ordered_racks:`) |
| FIPS | provisioning | request a FIPS-enabled cluster (`fips_mode`) |

## Reference Directory

- [BYOC Model and Auth](references/byoc-model-and-auth.md): What BYOC is vs Serverless, OAuth2 client-credentials flow, and the end-to-end provisioning sequence.
- [Networks](references/networks.md): Creating the Network resource per cloud provider — AWS (VPC/subnet/IAM ARNs), GCP (network name, project, GCS bucket), Azure (VNet, subnets, resource groups). Plus VPC/VNet peering (NetworkPeeringService), Cloud Provider Access cross-account AWS provisioning (PREVIEW), and private connectivity / centralized egress (AWS PrivateLink incl. cross-region, GCP PSC, Azure Private Link, Transit Gateway egress). Field-level reference grounded in network.proto, network_peering.proto, cloud_provider_access.proto, and common.proto.
- [Clusters and Agent](references/clusters-and-agent.md): ClusterCreate fields for BYOC (TYPE_BYOC, network_id, throughput_tier, customer_managed_resources, zones, cloud_provider_tags), the cluster PATCH/update_mask form, Operation lifecycle, Scheduled Operations (PREVIEW), control-plane Shadow Linking (ShadowLinkService), and the full rpk cloud byoc install/apply/destroy/validate flow.
- [Enterprise Features](references/enterprise-features.md): Enabling Redpanda Enterprise differentiators on a BYOC cluster (license included with the Cloud subscription) via `cluster_configuration.custom_properties` and topic properties — Tiered Storage, Cloud Topics, Iceberg Topics, Continuous Data Balancing, Shadow Linking DR, Remote Read Replicas, Audit Logging, RBAC/GBAC, OIDC/OAuthBearer/Kerberos, FIPS, Server-Side Schema ID Validation, and Leadership Pinning — with their nested config keys and license-expiration behavior, grounded in the licensing overview and per-feature docs.
