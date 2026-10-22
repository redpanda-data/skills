Source: cloudv2 `proto/public/cloud/redpanda/api/controlplane/v1/cluster.proto` (field names and constraints, incl. `Cluster.RedpandaConnect`, `Cluster.CidrPort`), cloudv2 `apps/public-api-go/internal/services/cluster/v1/dual_mode_connections.go` (dual-listener `connections` rules, verified 2026-09-17), cloudv2 `apps/cloud-ui/src/utils/rpk.utils.ts` (per-provider `rpk cloud byoc` account flags); redpanda `src/go/rpk/pkg/cli/cloud/byoc/` (`byoc.go`, `install.go`); shadow-link source-cluster scope, auth arms and role sync (verified 2026-10-01): cloudv2 `controlplane/v1/shadow_link.proto`, api-docs `cloud-controlplane/cloud-controlplane.yaml` (`AuthenticationConfiguration`, `PlainConfig`, `ScramConfig`, `RoleSyncOptions`, `NameFilter`), docs `modules/manage/pages/disaster-recovery/shadowing/setup.adoc` + `overview.adoc` (`env-cloud` variants). Self-service cluster scaling and cloud-provider-tag semantics (verified 2026-10-15): cloudv2 `apps/controlplane-api/internal/services/redpanda/redpanda_service.go` (`nodesCountTooLowErr`, the tier-migration-path and reserved-tag-key errors), `apps/public-api-go/internal/services/cluster/v1/user_scaling_gate.go` (the usage-based-billing gate and its PERMISSION_DENIED message), `proto/public/cloud/redpanda/api/controlplane/v1beta2/error.proto` (`Reason` enum; the skill body names only the two values the published `scale-cluster.adoc` names, `REASON_SCALING_REDPANDA_NODE_COUNT_TOO_HIGH` and `REASON_SCALING_UNSUPPORTED_THROUGHPUT_TIER_MIGRATION_PATH`), `apps/controlplane-api/internal/services/redpanda/validate_test.go` (`TestValidateCloudTagKeysOnCreate` presence check vs `TestValidateCloudTagKeysOnUpdate` delta check, verified 2026-10-15), `cluster.proto` (`cloud_provider_tags` on `ClusterCreate`/`ClusterUpdate` capped at 16 pairs and uncapped on the `Cluster` response), api-docs `cloud-controlplane/cloud-controlplane.yaml` (published `redpanda_node_count`, `throughput_tier`, `STATE_UPGRADING`), cloud-docs `modules/manage/pages/cluster-maintenance/scale-cluster.adoc` (published how-to: scaling axes, preconditions, preflight checks, error table, behavior during the operation) and `modules/get-started/partials/custom-tags-{gcp,aws,azure}.adoc` (published reserved keys, replace-the-map PATCH semantics, the GCP-only lowercase key rule, AWS `Name`/`aws:` and Azure case-insensitivity/overwrite/create-time-only rules, and the Google Cloud Marketplace consumption-tracking label; verified 2026-10-15). Read-only managed-tag map (verified 2026-10-22): api-docs `cloud-controlplane/cloud-controlplane.yaml` (published read-only `Cluster.redpanda_cloud_provider_tags` and the `cloud_provider_tags` note that it includes those keys), cloudv2 `cluster.proto` (`Cluster.redpanda_cloud_provider_tags`, OUTPUT_ONLY, absent from `ClusterCreate`/`ClusterUpdate`). File-by-file mapping in [SOURCES.md](SOURCES.md).

# Clusters and Agent

This reference covers creating and managing BYOC clusters via the Control Plane API, plus the full `rpk cloud byoc` agent plugin flow.

---

## Creating a BYOC Cluster

**Endpoint:** `POST /v1/clusters`

Returns a `CreateClusterOperation`. The `operation.metadata.cluster_id` field holds the new cluster's ID even before the operation completes.

### Required Fields (ClusterCreate)

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | Yes | 3–128 chars, pattern `^[A-Za-z0-9-:_]+$` |
| `resource_group_id` | string (UUID) | Yes | Must exist |
| `type` | enum | Yes | `TYPE_BYOC` |
| `cloud_provider` | enum | Yes | `CLOUD_PROVIDER_AWS`, `CLOUD_PROVIDER_GCP`, or `CLOUD_PROVIDER_AZURE` |
| `region` | string | Yes | Must match the network's region |
| `zones` | []string | Yes | Availability zones within the region (unique, non-empty) |
| `throughput_tier` | string | Yes | Tier identifier (see Redpanda Cloud tiers docs) |
| `network_id` | string | Yes | 20-char ID from a READY Network resource |

### Optional Fields

| Field | Type | Notes |
|---|---|---|
| `connection_type` | enum | `CONNECTION_TYPE_PUBLIC` or `CONNECTION_TYPE_PRIVATE`. Set explicitly — the proto zero-value is `CONNECTION_TYPE_UNSPECIFIED` (0). **Deprecated** in favour of the per-service `connections` list; the two are mutually exclusive. See [Dual Listener Mode](#dual-listener-mode-public--private-listeners-per-service-beta-aws). |
| `kafka_api.connections[]` / `http_proxy.connections[]` / `schema_registry.connections[]` | []ConnectionSpec | One entry per listener: `{"type": CONNECTION_TYPE_PUBLIC\|PRIVATE, "auth": {"mode": AUTH_MODE_SASL\|AUTH_MODE_MTLS}}`. Replaces `connection_type` and the per-service `sasl` block. Beta, AWS only. See [Dual Listener Mode](#dual-listener-mode-public--private-listeners-per-service-beta-aws). |
| `redpanda_version` | string | `major.minor` semver, e.g. `24.2` |
| `customer_managed_resources` | object | Provider-specific IAM/storage resources you pre-created. See below. |
| `kafka_api.mtls` / `kafka_api.sasl` | object | mTLS or SASL configuration |
| `http_proxy` | object | HTTP Proxy API settings |
| `schema_registry` | object | Schema Registry settings |
| `aws_private_link` | object | AWS PrivateLink (AWS only) |
| `gcp_private_service_connect` | object | GCP PSC (GCP only) |
| `azure_private_link` | object | Azure Private Link (Azure only) |
| `cloud_provider_tags` | map[string]string | Tags/labels placed on cloud resources; create and update accept at most 16 pairs. GCP: prefix `gcp.network-tag.` creates GKE network tags. See [Cloud provider tags](#with-cloud-provider-tags) for reserved and Redpanda-managed keys |
| `maintenance_window_config` | object | Scheduled maintenance window (`day_hour` or `anytime`) |
| `cluster_configuration.custom_properties` | Struct | Custom Redpanda cluster config properties (integers must be strings) |
| `redpanda_node_count` | int32 | Starting node count |
| `api_gateway_access` | enum | `NETWORK_ACCESS_MODE_PUBLIC` or `NETWORK_ACCESS_MODE_PRIVATE` |
| `redpanda_connect` | object | Redpanda Connect pipeline settings. `allowed_destination_cidr_ports[]` allowlists custom outbound destinations pipelines may reach. See [Redpanda Connect pipeline egress](#redpanda-connect-pipeline-egress-allowed_destination_cidr_ports) below. |

### Minimal AWS BYOC Cluster (Redpanda-managed network)

```bash
curl -s -X POST "${BASE}/v1/clusters" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "cluster": {
      "name": "my-byoc-cluster",
      "resource_group_id": "a0b40af9-0250-48ca-9417-783ed127ce42",
      "type": "TYPE_BYOC",
      "cloud_provider": "CLOUD_PROVIDER_AWS",
      "region": "us-east-1",
      "zones": ["use1-az1", "use1-az2", "use1-az3"],
      "throughput_tier": "tier-1-aws-v2-arm",
      "network_id": "cjcuq79c4vs94fcufc2g",
      "connection_type": "CONNECTION_TYPE_PUBLIC"
    }
  }' | jq .
```

### GCP BYOC Cluster

```bash
curl -s -X POST "${BASE}/v1/clusters" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "cluster": {
      "name": "my-byoc-gcp",
      "resource_group_id": "a0b40af9-0250-48ca-9417-783ed127ce42",
      "type": "TYPE_BYOC",
      "cloud_provider": "CLOUD_PROVIDER_GCP",
      "region": "us-central1",
      "zones": ["us-central1-a", "us-central1-b", "us-central1-c"],
      "throughput_tier": "tier-1-gcp-v2-x86",
      "network_id": "dk2xq89c4vs94fcufc3h"
    }
  }' | jq .
```

### With Cloud Provider Tags

```bash
# Tags placed on cloud resources; GCP network tags use "gcp.network-tag." prefix
-d '{
  "cluster": {
    ...
    "cloud_provider_tags": {
      "environment": "production",
      "team": "platform",
      "gcp.network-tag.allow-redpanda": ""
    }
  }
}'
```

**A tag PATCH replaces the whole map.** `cloud_provider_tags` is not merged key by key: the map you
send becomes the cluster's tag set, so include every tag you want to keep, drop a tag by omitting
it, and clear them all with `{"cloud_provider_tags": {}}`. Redpanda's own managed labels survive
the replacement either way.

**Reserved keys are rejected.** `redpanda-org`, `redpanda-id`, `network-id`, and `redpanda-client`
are reserved and matched exactly. A create that carries one fails with `INVALID_ARGUMENT` and the
message `cloud tags cannot contain the reserved key "<key>"`, reported as a field violation on
`cluster.cloud_provider_tags`. A PATCH is checked against what the cluster already stores: it is
rejected only when it introduces a reserved key or changes a stored reserved key's value. Echoing
a stored reserved key back unchanged — which a read-modify-write of the tag map does — is accepted,
as is leaving it out. So there is no need to strip Redpanda's keys from a map you read back before
sending it again.

**Provider-specific key rules.** Matching is exact and case-sensitive on every provider, but each
provider adds its own rules:

- **GCP:** label keys must start with a lowercase letter and contain only lowercase letters,
  numbers, underscores, and dashes, except for keys with the `gcp.network-tag.` prefix.
  `goog-partner-solution` is also reserved (see the Marketplace label below).
- **AWS:** keys may use mixed case (`Environment`, `CostCenter`). Avoid `Name`, which Redpanda sets
  on the resources it creates and AWS shows as the resource name, and the `aws:` prefix, which AWS
  reserves.
- **Azure:** keys may use mixed case, but Azure treats tag keys as case-insensitive, so a variant
  such as `Redpanda-Id` collides with Redpanda's `redpanda-id` tag. Custom tags on the nodepool
  Application Security Groups and on the Private Link network interfaces are set only at cluster
  creation and cannot be changed later.

**Other keys are accepted but don't take effect**, which is the quieter failure mode. Anything under
the `redpanda-` prefix is Redpanda's own namespace: on AWS such tags aren't applied to EC2
instances, EBS volumes, or network interfaces; on GCP the agent ignores such labels on GCE
instances and disks; on Azure, where a custom tag uses one of Redpanda's own keys, Redpanda's
value overwrites yours; and the Redpanda Terraform provider drops them from state. On GCP the
`goog-gke-` and `goog-k8s-` prefixes belong to GKE and are ignored too. Don't use any of these for
your own tags.

**Managed labels come back on read.** Redpanda applies labels of its own, and they appear in
`cloud_provider_tags` alongside yours. On GCP, an organization subscribed through a Google Cloud
Marketplace private offer gets a `goog-partner-solution` consumption-tracking label on the
resources Redpanda creates for its BYOC clusters: a create that includes the key has its value
ignored, a PATCH that adds or changes it is rejected, and leaving it out of a PATCH keeps the
label rather than clearing it. So read the cluster back for the authoritative tag set instead of
assuming the response mirrors your request — the response is not capped at the 16-pair request
limit, and a round trip can legitimately return keys you never sent.

**`redpanda_cloud_provider_tags` names the managed ones.** The `Cluster` response carries a second,
read-only tag map beside `cloud_provider_tags`, holding just the tags Redpanda applies and you
cannot change. Every key in it also appears in `cloud_provider_tags`, so the two overlap rather than
partition: subtract `redpanda_cloud_provider_tags` from `cloud_provider_tags` to get the tags your
organization owns. Read it rather than matching `redpanda-` and `goog-` prefixes by hand — it is the
cluster's own statement of which keys are managed, so it stays correct as Redpanda adds labels. A
tag editor should hide those keys, and a read-modify-write PATCH should echo them back unchanged (or
omit them). The field is output only: `ClusterCreate` and `ClusterUpdate` do not accept it.

---

## Dual Listener Mode: public + private listeners per service (beta, AWS)

A cluster is normally either public or private for all of its APIs (`connection_type`). Dual
listener mode replaces that single choice with a **`connections` list on each cluster service** —
`kafka_api`, `http_proxy`, and `schema_registry` — so VPC-internal clients reach the cluster over a
private listener (no internet-gateway data-processing charges) while external clients keep using the
public one.

Each entry enables one listener and carries two fields:

| Field | Values | Notes |
|---|---|---|
| `type` | `CONNECTION_TYPE_PUBLIC`, `CONNECTION_TYPE_PRIVATE` | Public = internet-facing load balancer; private = internal load balancer, reachable only from inside the VPC. Required. |
| `auth.mode` | `AUTH_MODE_SASL`, `AUTH_MODE_MTLS` | SASL/SCRAM or mTLS, chosen per listener. Required. OIDC is not available on a connection. |

Availability and gating:

- **AWS only.** Setting `connections` on an Azure cluster is rejected with `INVALID_ARGUMENT` on
  both create and update.
- **Beta, enabled per organization.** A request that sets `connections` for an organization without
  it returns `PERMISSION_DENIED` with reason `REASON_FEATURE_NOT_ENABLED`; contact Redpanda Support
  to have it enabled. These fields are not listed in the published Cloud API reference yet, so
  treat the shapes below as the contract.
- Not configurable in the Cloud UI.

### Configuration rules

The API validates the whole request, not one service at a time:

1. If any service sets `connections`, **all three must** (`kafka_api`, `http_proxy`,
   `schema_registry`) — on create, and for any request that introduces the model.
2. All three services must use the **same topology**: all public, all private, or both. Auth mode
   may differ per service and per connection. On update this is checked against the effective
   post-update state, so a single-service update on a cluster already using `connections` is
   legitimate as long as its topology matches the other two services.
3. Each `(type, auth.mode)` pair may appear **at most once per service**, so a service has at most
   four connections: public SASL, public mTLS, private SASL, private mTLS. A duplicate pair is
   rejected rather than deduplicated.
4. `connections` cannot be combined with `connection_type` (cluster level) or with a per-service
   `sasl` block — omit both on create. A set `connection_type` is rejected even when it agrees
   with the connections you sent. On **update** the check is mask-driven: `connection_type` is not
   evaluated at all (it is not updatable), and the `sasl` reject fires only when the mask names
   `<service>.sasl` (or the whole `<service>` object). A read-back body that still carries the
   `sasl` block `GET` always projects is fine as long as the mask is the `<service>.connections`
   leaf — the safe spelling for read-modify-write clients such as Terraform.
5. If any connection on a service uses mTLS, that service's `mtls` block must have
   `enabled: true` and a non-empty `ca_certificates_pem`; the public and private mTLS listeners of
   that service share the bundle. `mtls.enabled: false` alongside an mTLS connection is rejected.
6. Conversely, an `mtls` block on a service whose connections use **no** mTLS is rejected — drop
   the block instead of leaving it behind.

### Create a dual-listener cluster

```bash
curl -s -X POST "${BASE}/v1/clusters" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "cluster": {
      "name": "my-dual-listener-cluster",
      "resource_group_id": "a0b40af9-0250-48ca-9417-783ed127ce42",
      "type": "TYPE_BYOC",
      "cloud_provider": "CLOUD_PROVIDER_AWS",
      "region": "us-east-2",
      "zones": ["use2-az1", "use2-az2", "use2-az3"],
      "throughput_tier": "tier-1-aws-v3-arm",
      "network_id": "cjcuq79c4vs94fcufc2g",
      "kafka_api": {
        "connections": [
          {"type": "CONNECTION_TYPE_PUBLIC",  "auth": {"mode": "AUTH_MODE_SASL"}},
          {"type": "CONNECTION_TYPE_PRIVATE", "auth": {"mode": "AUTH_MODE_SASL"}}
        ]
      },
      "http_proxy": {
        "connections": [
          {"type": "CONNECTION_TYPE_PUBLIC",  "auth": {"mode": "AUTH_MODE_SASL"}},
          {"type": "CONNECTION_TYPE_PRIVATE", "auth": {"mode": "AUTH_MODE_SASL"}}
        ]
      },
      "schema_registry": {
        "connections": [
          {"type": "CONNECTION_TYPE_PUBLIC",  "auth": {"mode": "AUTH_MODE_SASL"}},
          {"type": "CONNECTION_TYPE_PRIVATE", "auth": {"mode": "AUTH_MODE_SASL"}}
        ]
      }
    }
  }' | jq .
```

For mTLS on the public listener and SASL on the private one, set `auth.mode` to `AUTH_MODE_MTLS` on
the public entry and add the service's `mtls` block (rule 5):

```json
"kafka_api": {
  "mtls": {
    "enabled": true,
    "ca_certificates_pem": ["-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----\n"]
  },
  "connections": [
    {"type": "CONNECTION_TYPE_PUBLIC",  "auth": {"mode": "AUTH_MODE_MTLS"}},
    {"type": "CONNECTION_TYPE_PRIVATE", "auth": {"mode": "AUTH_MODE_SASL"}}
  ]
}
```

On a **BYOVPC** network the public seed load balancer needs customer-managed public subnets — one
per availability zone that has a broker subnet. Register them on the network before creating the
cluster; see [Networks](networks.md#aws-customer-managed-resources-network).

Redpanda documents the Terraform provider as the primary path for this feature: the same list goes
on the `redpanda_cluster` resource's `kafka_api`, `http_proxy`, and `schema_registry` blocks, where
the values are lowercase (`type = "public"`, `auth = { mode = "sasl" }`) rather than the API's enum
spellings, and each connection's server-assigned `endpoint` is readable after apply. Check the
provider's own version constraints for the minimum release that carries `connections`, and the one
that accepts `public_subnets` on `redpanda_network`.

### Read each listener's endpoint

Endpoints are server-assigned, one per connection, and `GET /v1/clusters/{id}` is the only place
that reports them per listener. Each entry pairs the configuration under `config` with an
`endpoint` — the seed broker address for `kafka_api`, the service URL for `http_proxy` and
`schema_registry`:

```bash
curl -s "${BASE}/v1/clusters/${CLUSTER_ID}" -H "Authorization: Bearer ${TOKEN}" \
  | jq '.cluster.kafka_api.connections[] | {type: .config.type, auth: .config.auth.mode, endpoint}'
```

The legacy `seed_brokers`, `url`, and `mtls` endpoint fields on the service status are deprecated in
favour of `connections[].endpoint`. Give the private endpoint to in-VPC clients and the public
endpoint to external ones.

### Migrate an existing cluster

`PATCH /v1/clusters/{cluster.id}` with the service's full connections list. Name each service's
connections in `update_mask` (`kafka_api.connections`, or the whole `kafka_api` object) — a
`connections` list carried in the body but **not** named in an explicit mask is ignored and the
request falls back to the legacy listener path. The published how-to's Cloud API example sends the
same body with no `update_mask` at all; whether the API derives the mask from the body for a
cluster update is not documented, so pass the mask explicitly as below rather than relying on it.

```bash
# Add a private SASL listener to each service of a public cluster
curl -s -X PATCH "${BASE}/v1/clusters/${CLUSTER_ID}?update_mask=kafka_api.connections,http_proxy.connections,schema_registry.connections" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d '{
    "kafka_api": {"connections": [
      {"type": "CONNECTION_TYPE_PUBLIC",  "auth": {"mode": "AUTH_MODE_SASL"}},
      {"type": "CONNECTION_TYPE_PRIVATE", "auth": {"mode": "AUTH_MODE_SASL"}}]},
    "http_proxy": {"connections": [
      {"type": "CONNECTION_TYPE_PUBLIC",  "auth": {"mode": "AUTH_MODE_SASL"}},
      {"type": "CONNECTION_TYPE_PRIVATE", "auth": {"mode": "AUTH_MODE_SASL"}}]},
    "schema_registry": {"connections": [
      {"type": "CONNECTION_TYPE_PUBLIC",  "auth": {"mode": "AUTH_MODE_SASL"}},
      {"type": "CONNECTION_TYPE_PRIVATE", "auth": {"mode": "AUTH_MODE_SASL"}}]}
  }' | jq '.operation.id'
```

Semantics to plan around:

- **The list replaces the stored list.** Any connection you omit is removed, so send every
  connection you want to keep.
- **Public-only ↔ dual is self-service** on a standard BYOC cluster, but the caller's role needs the
  `controlplane_cluster_migrate_connectivity` permission on the cluster; without it the update
  fails with a permission error naming the direction.
- **Not on BYOVPC.** A BYOVPC cluster always keeps its private connection, so it is never
  public-only: every BYOVPC migration to or from dual listener mode goes through Redpanda Support.
  The Terraform provider rejects a configuration that removes the private connection from a BYOVPC
  cluster at plan time with a `Private Access Required` error.
- **Anything that changes the cluster between private-only and publicly reachable (public or dual)
  is refused by this API** — the error directs you to contact Redpanda Support. Adding or removing a
  public listener moves broker nodes between subnets, which the API cannot do; adding or removing a
  private listener only adds or removes an internal load balancer.
- A cluster created with `connection_type` adopts the model by setting `connections` on all three
  services in one request (with `connection_type` dropped). There is **no path back**:
  `connections` cannot be cleared, and each service must keep at least one connection.
- **Changing a connection's auth mode** is not a topology change: it needs no migrate permission,
  and on a cluster already using `connections` you can update one service at a time. A switched
  connection keeps its endpoint (same host and port); adding a second auth mode on the same type
  creates a new listener with its own endpoint. Because a switched listener keeps its port, read
  `config.auth.mode` rather than inferring auth from the port number.
- **The legacy `sasl`/`mtls` update path closes per service.** Once a service's listeners use
  `connections`, a PATCH that masks that service's `sasl` or `mtls` (or the whole `<service>`
  object) without a `connections` list in the body is rejected with `INVALID_ARGUMENT` — "cannot
  update legacy sasl/mtls on `<service>` for a cluster with public/private listeners; use the
  connections field instead". Change auth by editing `connections[].auth.mode`, and send the
  service's `mtls` block alongside its `connections` (rules 5 and 6). Services still on the legacy
  model are unaffected.

Every `connections` change runs as a long-running operation — poll `GET /v1/operations/{id}` until
`STATE_COMPLETED`, then re-read the endpoints.

---

## Customer-Managed Resources at Cluster Level

For full BYOVPC clusters, you can also provide customer-managed IAM resources at the **cluster level** (in addition to the network level). This is the `customer_managed_resources` object in `ClusterCreate`.

### AWS Cluster Customer-Managed Resources

Required fields for `customer_managed_resources.aws`:

| Field | Description |
|---|---|
| `agent_instance_profile.arn` | ARN of instance profile for the Redpanda agent |
| `connectors_node_group_instance_profile.arn` | ARN for connectors node group |
| `utility_node_group_instance_profile.arn` | ARN for utility broker node group |
| `redpanda_node_group_instance_profile.arn` | ARN for Redpanda broker nodes |
| `k8s_cluster_role.arn` | ARN of IAM role for EKS cluster |
| `redpanda_agent_security_group.arn` | ARN of security group for agent VM |
| `connectors_security_group.arn` | ARN of security group for connectors |
| `redpanda_node_group_security_group.arn` | ARN of security group for Redpanda nodes |
| `utility_security_group.arn` | ARN of security group for utility nodes |
| `cluster_security_group.arn` | ARN of security group for EKS cluster |
| `node_security_group.arn` | ARN of security group for all nodes |
| `cloud_storage_bucket.arn` | ARN of S3 bucket for tiered storage |
| `permissions_boundary_policy.arn` | ARN of IAM policy used as permissions boundary |

### GCP Cluster Customer-Managed Resources

Core fields for `customer_managed_resources.gcp` (see the `CustomerManagedResources.GCP` schema in the [Control Plane API reference](https://docs.redpanda.com/api/doc/cloud-controlplane/) for the authoritative and complete list, including optional/conditional fields):

| Field | Description |
|---|---|
| `subnet.name` | GCP subnet name |
| `subnet.secondary_ipv4_range_pods.name` | Secondary IP range for pods |
| `subnet.secondary_ipv4_range_services.name` | Secondary IP range for services |
| `subnet.k8s_master_ipv4_range` | GKE master CIDR (e.g. `10.0.0.0/24`) |
| `agent_service_account.email` | GCP SA email for the agent |
| `console_service_account.email` | GCP SA email for Redpanda Console |
| `connector_service_account.email` | GCP SA email for managed connectors |
| `redpanda_cluster_service_account.email` | GCP SA email for the Redpanda cluster |
| `gke_service_account.email` | GCP SA email for GKE |
| `tiered_storage_bucket.name` | GCS bucket name for tiered storage |
| `redpanda_connect_api_service_account.email` | GCP SA email for Connect API |
| `redpanda_connect_service_account.email` | GCP SA email for Connect |

Additional optional/conditional fields include `redpanda_operator_service_account.email` and PSC NAT subnet fields `psc_nat_subnet_name` (PSC v1) and `psc_v2_nat_subnet_name` (PSC v2).

### Azure Cluster Customer-Managed Resources

Required fields for `customer_managed_resources.azure`:

| Field | Description |
|---|---|
| `resource_groups.redpanda_resource_group.name` | RG holding AKS and core resources |
| `resource_groups.storage_resource_group.name` | RG holding tiered storage |
| `resource_groups.iam_resource_group.name` | RG holding workload identities |
| `user_assigned_identities.agent_user_assigned_identity.name` | UAI for the agent |
| `user_assigned_identities.aks_user_assigned_identity.name` | UAI for AKS |
| `user_assigned_identities.redpanda_cluster_assigned_identity.name` | UAI for the cluster |
| `user_assigned_identities.cert_manager_assigned_identity.name` | UAI for cert-manager |
| `user_assigned_identities.external_dns_assigned_identity.name` | UAI for external-dns |
| `user_assigned_identities.redpanda_console_assigned_identity.name` | UAI for Console |
| `user_assigned_identities.kafka_connect_assigned_identity.name` | UAI for Kafka Connect |
| `user_assigned_identities.redpanda_connect_assigned_identity.name` | UAI for Connect |
| `user_assigned_identities.redpanda_connect_api_assigned_identity.name` | UAI for Connect API |
| `user_assigned_identities.redpanda_operator_assigned_identity.name` | UAI for operator |
| `tiered_cloud_storage.storage_account_name` | Azure Storage Account name |
| `tiered_cloud_storage.storage_container_name` | Blob container name |
| `tiered_cloud_storage.resource_group.name` | RG for the storage account |
| `key_vaults.management_vault.name` | Azure Key Vault for deployment secrets |
| `key_vaults.console_vault.name` | Azure Key Vault for Console |
| `security_groups.redpanda_security_group.name` | NSG for the cluster |
| `cidrs.aks_service_cidr` | CIDR for AKS Kubernetes services |

---

## Redpanda Connect Pipeline Egress (allowed_destination_cidr_ports)

`redpanda_connect.allowed_destination_cidr_ports` — settable on `ClusterCreate` and `ClusterUpdate` — allowlists the custom outbound destinations that Redpanda Connect pipelines running on the cluster may reach (for example, an external database or API in a peered network). Each entry is a `Cluster.CidrPort`:

| Field | Type | Notes |
|---|---|---|
| `cidr` | string | IPv4 CIDR, pattern `^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$`, e.g. `10.5.0.0/16` |
| `port_start` | int32 | Start of the TCP/UDP port range, 1–65535 |
| `port_end` | int32 | Optional end of the port range, 0–65535. `0` (the default) means a single port (`port_start` only); when non-zero it must be ≥ `port_start` |

Maximum 16 entries; each `cidr:port_start:port_end` tuple must be unique. On read-back, `Cluster.redpanda_connect` is output-only and also reports the Connect engine `version`.

```json
{
  "redpanda_connect": {
    "allowed_destination_cidr_ports": [
      {"cidr": "10.5.0.0/16", "port_start": 5432},
      {"cidr": "10.6.0.0/16", "port_start": 8000, "port_end": 8100}
    ]
  }
}
```

---

## Cluster State Machine

States are the values of the `Cluster.State` enum in the [Control Plane API reference](https://docs.redpanda.com/api/doc/cloud-controlplane/):

| State | Meaning |
|---|---|
| `STATE_CREATING_AGENT` | Cluster created in control plane; waiting for `rpk cloud byoc apply` |
| `STATE_CREATING` | Agent installed; brokers provisioning |
| `STATE_READY` | Fully operational; data-plane URL available |
| `STATE_UPGRADING` | Version upgrade **or a scaling operation** in progress (see [Scaling a cluster](#scaling-a-cluster-broker-count-and-tier)) |
| `STATE_DELETING_AGENT` | Delete requested; waiting for `rpk cloud byoc destroy` |
| `STATE_DELETING` | Agent removed; cleaning up cluster resources |
| `STATE_FAILED` | An error occurred; check `state_description` |
| `STATE_SUSPENDED` | Cluster is suspended |

**Key insight:** The cluster enters `STATE_CREATING_AGENT` immediately after the CreateCluster operation reaches `STATE_COMPLETED`. You must run `rpk cloud byoc apply` while in this state; the cluster will not progress on its own.

---

## Polling Operations

Every mutating cluster/network call returns an `Operation`. Check it repeatedly:

```bash
# Wait for operation to complete
OP_ID="cjcuq79c4vs94fcufc2g"
while true; do
  RESULT=$(curl -s "${BASE}/v1/operations/${OP_ID}" \
    -H "Authorization: Bearer ${TOKEN}")
  STATE=$(echo "${RESULT}" | jq -r '.operation.state')
  echo "Operation state: ${STATE}"
  case "${STATE}" in
    "STATE_COMPLETED") echo "Done!"; break ;;
    "STATE_FAILED")
      echo "Failed: $(echo "${RESULT}" | jq '.operation.error')"
      exit 1 ;;
    *) sleep 15 ;;
  esac
done
```

The Operation object has:
- `id` — 20-char operation ID
- `state` — `STATE_IN_PROGRESS`, `STATE_COMPLETED`, `STATE_FAILED`
- `type` — e.g. `TYPE_CREATE_CLUSTER`, `TYPE_DELETE_CLUSTER`, `TYPE_CREATE_NETWORK`
- `metadata` — provider-specific metadata (e.g. `cluster_id` for create cluster)
- `resource_id` — the ID of the created/deleted resource (once available)
- `error` — set only if `state` is `STATE_FAILED`
- `started_at`, `finished_at` — RFC3339 timestamps

---

## Getting and Listing Clusters

```bash
# Get a specific cluster (includes dataplane_api.url)
curl -s "${BASE}/v1/clusters/${CLUSTER_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.cluster | {id, name, state, current_redpanda_version}'

# List clusters (NOTE: dataplane_api.url is NOT returned in list — use Get)
curl -s "${BASE}/v1/clusters" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.clusters[] | {id, name, state}'

# Filter by resource group
curl -s "${BASE}/v1/clusters?filter.resource_group_id=${RG_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.clusters[].name'
```

The data-plane URL for topic/ACL/user operations is in the response:
```bash
DP_URL=$(curl -s "${BASE}/v1/clusters/${CLUSTER_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq -r '.cluster.dataplane_api.url')
```

---

## Updating a Cluster

`PATCH /v1/clusters/{id}` with a `ClusterUpdate` body. Also returns an `UpdateClusterOperation`.

Updatable fields include: `name`, `kafka_api`, `http_proxy`, `schema_registry`, `aws_private_link`/`gcp_private_service_connect`/`azure_private_link`, `customer_managed_resources`, `cloud_provider_tags`, `maintenance_window_config`, `throughput_tier`, `redpanda_node_count`, `api_gateway_access`, `redpanda_connect`. `throughput_tier` and `redpanda_node_count` are how a cluster is scaled — see [Scaling a cluster](#scaling-a-cluster-broker-count-and-tier) for the preconditions the API enforces. `connection_type` is **not** updatable — changing a cluster's connectivity goes through the per-service `connections` list; see [Dual Listener Mode](#dual-listener-mode-public--private-listeners-per-service-beta-aws). On a service whose listeners already use `connections`, the `sasl`/`mtls` sub-fields can only be changed together with that service's `connections` list — a legacy-only PATCH is rejected (see [Migrate an existing cluster](#migrate-an-existing-cluster)).

**`update_mask` is a REQUIRED query parameter**, not a body field. `UpdateCluster` is `PATCH /v1/clusters/{cluster.id}`; the request body is the `ClusterUpdate` object itself, and `update_mask` is a separate top-level FieldMask that the live API requires even though the published spec does not list it. Two consequences:

- Pass `update_mask` as a query param: `?update_mask=<comma-separated snake_case field paths>` (the API uses proto field names — e.g. `throughput_tier`, `cluster_configuration.custom_properties` — verified against the live `ClusterService.UpdateCluster` contract). The generated OpenAPI omits this parameter — a known grpc-gateway quirk for top-level FieldMask fields — but it is still required.
- The JSON body maps directly to the `cluster` (`ClusterUpdate`) field. The body **is** the `ClusterUpdate` object — do **not** wrap it as `{"cluster":{...}}`, and do **not** put `update_mask` in the body.

```bash
# Upgrade throughput tier — update_mask in the query string, ClusterUpdate fields in the body
curl -s -X PATCH "${BASE}/v1/clusters/${CLUSTER_ID}?update_mask=throughput_tier" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"throughput_tier": "tier-2-aws-v3-arm"}' | jq .
```

### Scaling a cluster (broker count and tier)

Scaling a BYOC cluster is an ordinary `UpdateCluster` PATCH. Two fields carry the two axes, and
either or both can change in one request as long as `update_mask` names them:

| Field | Axis | When to reach for it |
|---|---|---|
| `redpanda_node_count` | Horizontal — adds or removes brokers of the current machine type | Changes in traffic within a day, such as business-hours peaks or nightly batch jobs |
| `throughput_tier` | Vertical — replaces the brokers with a larger or smaller machine type | Changes in throughput that last days or longer, such as steady growth or a weekday/weekend pattern |

In the Cloud UI you describe a workload and Redpanda recommends a configuration. Over the API the
surface is just these two fields: the machine type is selected through the cluster's usage tier,
and the broker count through `redpanda_node_count`.

```bash
# Horizontal: change the broker count within the current tier
curl -s -X PATCH "${BASE}/v1/clusters/${CLUSTER_ID}?update_mask=redpanda_node_count" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"redpanda_node_count": 6}' | jq .

# Both axes in one request — the broker count is validated against the target tier
curl -s -X PATCH "${BASE}/v1/clusters/${CLUSTER_ID}?update_mask=throughput_tier,redpanda_node_count" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"throughput_tier": "tier-3-aws-v3-arm", "redpanda_node_count": 9}' | jq .
```

The request returns `202` with an `UpdateClusterOperation` (`TYPE_UPDATE_CLUSTER`) — poll
`GET /v1/operations/{id}` as usual. While scaling runs the cluster reports `STATE_UPGRADING`, and
`GET /v1/clusters/{id}` already returns the new tier and broker count; it goes back to
`STATE_READY` when scaling completes. Scaling starts as soon as the request is accepted — unlike a
Redpanda-run tier migration, it does not wait for the maintenance window.

**Preconditions the API enforces.** A rejected scaling request fails synchronously, so the error
tells you what to fix instead of surfacing later on the operation:

- The cluster must be in `STATE_READY`. While another operation is running the update is rejected
  (`cannot be updated at this time`), and other cluster changes are refused until scaling finishes.
- `redpanda_node_count` must be a multiple of the cluster's zone count, so brokers spread evenly
  across availability zones. A three-zone cluster therefore moves in steps of three.
- Each tier enforces a minimum and a maximum broker count; a count below the minimum is rejected
  with an error that names the minimum for the tier, and a count above the maximum with
  `REASON_SCALING_REDPANDA_NODE_COUNT_TOO_HIGH`. Read the current range from the Cloud UI or the
  BYOC tiers docs rather than assuming one.
- A `throughput_tier` change must stay within the same cloud provider, machine family, and CPU
  architecture (for example, `tier-2-aws-v3-arm` to `tier-5-aws-v3-arm`). A cross-family or
  cross-architecture move is refused with `FAILED_PRECONDITION`
  (`REASON_SCALING_UNSUPPORTED_THROUGHPUT_TIER_MIGRATION_PATH`) and has to go through Redpanda
  Support.
- The target tier must be offered in the cluster's region. Otherwise the request fails with
  `FAILED_PRECONDITION` — "Product/tier '<tier>' is not available in region '<region>'" — so pick
  a configuration from the BYOC tiers and regions docs.
- A capacity-reducing change also runs preflight checks, and is refused when the cluster has
  firing alerts, when the remaining brokers would not have enough storage or partition capacity
  for the current data, when a topic's replication factor would exceed the new broker count, or
  when recent throughput or CPU usage is too high for the smaller configuration.
- Self-service scaling is available to BYOC clusters in organizations on usage-based billing.
  Elsewhere a broker-count change returns `PERMISSION_DENIED` — "User-defined node count changes
  are only available for organizations with usage-based billing" — and the change goes through
  Redpanda Support.
- Some older clusters don't support self-service scaling at all and return
  `cluster does not support product/node count change - contact support`; scale those through
  Redpanda Support.

Most scaling errors also carry a machine-readable `reason` in the error details, so branch on
`reason` rather than on the message text.

**During the operation** the cluster keeps serving traffic and its endpoints do not change.
Partition leadership moves as brokers are added, replaced, or removed, so clients see leader
elections and dropped connections and reconnect on their own. Horizontal scaling is the quicker of
the two; a vertical move replaces every broker and scales with the broker count, so plan for a
much longer run and raise any client or automation timeout to match. If the cloud provider cannot
supply the requested machines — a stockout or a quota limit — the operation pauses with the
brokers provisioned so far and the cluster stays in `STATE_UPGRADING`. The long-running operation
eventually times out, so a poller sees it end without the cluster returning to `STATE_READY`.
Further scaling requests are rejected with `FAILED_PRECONDITION` (`scaling is paused because the
cloud provider could not supply the requested capacity …`) until Redpanda Support resumes or rolls
back the change.

---

## Deleting a Cluster

```bash
curl -s -X DELETE "${BASE}/v1/clusters/${CLUSTER_ID}" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.operation.id'
```

Returns a `DeleteClusterOperation`. After the operation starts, the cluster moves to `STATE_DELETING_AGENT`. Run `rpk cloud byoc destroy` to tear down Terraform resources.

---

## Shadow Linking (control-plane API)

Shadow Linking is Redpanda's enterprise cross-cluster DR: asynchronous, offset-preserving replication from a source cluster — another Redpanda cluster, or any Kafka API-compatible cluster such as Apache Kafka, Confluent Cloud, or Confluent Platform — to a Redpanda shadow cluster. It can be driven entirely through the **control-plane** `ShadowLinkService` — a first-class API complementary to the `rpk shadow` CLI flow documented in [Enterprise Features](enterprise-features.md#shadow-linking-cross-cluster-disaster-recovery).

These are **control-plane** paths under `api.redpanda.com` (not the per-cluster data-plane URL):

| Operation | Endpoint | Returns |
|---|---|---|
| Create | `POST /v1/shadow-links` | `Operation` (202 Accepted) |
| Get | `GET /v1/shadow-links/{id}` | `ShadowLink` |
| List | `GET /v1/shadow-links` | `ShadowLinkListItem[]` |
| Update | `PATCH /v1/shadow-links/{shadow_link.id}` | `Operation` (202 Accepted) |
| Delete | `DELETE /v1/shadow-links/{id}` | `Operation` (202 Accepted) |

### ShadowLinkCreate fields

| Field | Required | Notes |
|---|---|---|
| `shadow_redpanda_id` | Yes | The target (shadow) cluster where the link is created. Immutable. |
| `name` | Yes | DNS-1123 subdomain, max 63 chars, pattern `^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`. Unique. |
| `source_redpanda_id` **XOR** `client_options.bootstrap_servers` | Yes | Mutually exclusive — supply exactly one. `source_redpanda_id` auto-derives bootstrap servers from a known cluster; `bootstrap_servers` points at an external source. |
| `client_options` | No | Kafka client config: `bootstrap_servers`, `tls_settings`, `authentication_configuration`, fetch/retry timing. `authentication_configuration` takes one of two arms — `scram_configuration` (`username`, `password`, `scram_mechanism`) or `plain_configuration` (`username`, `password`), the latter being what a Confluent Cloud source usually needs with its API key and secret. In both arms the password must reference a data-plane secret as `${secrets.<SECRET_ID>}` and is never read back; responses carry `password_set` and `password_set_at` instead. |
| `topic_metadata_sync_options` | No | What topic metadata to mirror. |
| `consumer_offset_sync_options` | No | Consumer group offset replication. |
| `security_sync_options` | No | ACL / security-settings replication. |
| `schema_registry_sync_options` | No | Schema Registry replication — a oneof of `shadow_schema_registry_topic` or `shadow_schema_registry_api`. See [Schema Registry replication modes](#schema-registry-replication-modes). |
| `role_sync_options` | No | RBAC role replication: `interval` (defaults to 30s when 0), `paused`, `role_name_filters[]`. Nothing syncs until at least one INCLUDE filter is present; a single `PATTERN_TYPE_LITERAL`/`FILTER_TYPE_INCLUDE` filter with `name: "*"` covers every role. Requires a Redpanda source cluster. |

`PATCH` uses an `UpdateShadowLinkRequest` with a required `update_mask` and a `shadow_link` (`ShadowLinkUpdate`) body; updatable fields are the sync-options groups (`topic_metadata_sync_options`, `consumer_offset_sync_options`, `security_sync_options`, `schema_registry_sync_options`, `role_sync_options`) plus `client_options`. Masks reach into nested fields, so a targeted credential rotation such as `update_mask=schema_registry_sync_options.shadow_schema_registry_api.auth_options.basic.password` is valid.

```bash
# Create a shadow link from a known source cluster (control plane)
curl -s -X POST "${BASE}/v1/shadow-links" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d '{
    "shadow_link": {
      "shadow_redpanda_id": "cjcuq79c4vs94fcufc2g",
      "name": "dr-link",
      "source_redpanda_id": "dk2xq89c4vs94fcufc3h"
    }
  }' | jq '.operation.id'
```

**Operation types:** `TYPE_CREATE_SHADOW_LINK` = 15, `TYPE_UPDATE_SHADOW_LINK` = 16, `TYPE_DELETE_SHADOW_LINK` = 17.

**States:** `STATE_CREATING`, `STATE_CREATION_FAILED`, `STATE_DELETING`, `STATE_DELETION_FAILED`, `STATE_ACTIVE`, `STATE_PAUSED`.

### Schema Registry replication modes

`schema_registry_sync_options` is a oneof — a link uses **one** mode, never both:

- `shadow_schema_registry_topic: {}` — byte-for-byte shadowing of the `_schemas` topic. Use when the source is another Redpanda cluster and you want an exact replica; it does not filter, remap, or validate schemas. Only takes effect if `_schemas` exists on the source and is absent or empty on the shadow cluster, and unsetting it later does **not** remove an already-added `_schemas` shadow topic — fail that topic over or delete it.
- `shadow_schema_registry_api: {...}` — the shadow cluster polls a Schema Registry over its HTTP API and imports subjects, versions, compatibility settings, and modes, preserving subject names and schema IDs. Use it when the source registry is a **Confluent Schema Registry** (migrating off Confluent), or when you need to replicate only selected contexts/subjects, remap contexts, or control how unsupported schema features are handled.

**`shadow_schema_registry_api` keys:**

| Key | Notes |
|---|---|
| `source_url` | Source Schema Registry HTTP endpoint. **Required on create**; omit it on a masked `PATCH` that rotates only a credential. |
| `auth_options.basic.{username,password}` | HTTP basic auth; `basic` is the only accepted arm. `password` must reference a data-plane secret as `${secrets.<SECRET_ID>}` — inline plaintext is rejected. For Confluent Cloud, username/password are the Schema Registry API key and secret. Omit `auth_options` for mTLS or an unauthenticated source registry. |
| `tls_settings` | **Nested** shape here, unlike the flat `client_options.tls_settings`: `enabled`, `do_not_set_sni_hostname`, and a oneof of `tls_pem_settings` (`ca`, `key`, `cert`) or `tls_file_settings`. Cloud **rejects** `tls_file_settings`; in `tls_pem_settings`, `key` must be a `${secrets.<SECRET_ID>}` reference and `key`/`cert` are both-or-neither (mTLS to the source registry). |
| `tail_interval` / `full_sync_interval` | Incremental poll interval and full-scan interval. Cluster defaults apply when unset or zero (10s and 5m). |
| `max_source_requests_per_second` | Request-rate cap against the source registry; cluster default applies when unset or zero (30/s). |
| `source_filter.{contexts,subjects}` | Literal names only — no wildcards or prefixes. `contexts` selects whole contexts (default context is `.`); `subjects` uses qualified syntax (`orders-value`, `:.prod:orders-value`). The lists are a **union**; a subject in both replicates once. Unset or empty replicates the whole source registry. |
| `destination` | Oneof: `identity: {}` keeps source context names; `exact.mappings[]` of `{source, destination}` renames them. With `exact`, every source context in scope needs exactly one mapping, so scope `source_filter.contexts` to the mapped set or a new source context will fail the sync task. |
| `unsupported_schema_feature_policy` | Handling for source schemas using features the Redpanda Schema Registry lacks (rule sets, metadata tags; subject-config override/default metadata and rule sets, compatibility groups — compatibility *levels* do replicate). `UNSUPPORTED_SCHEMA_FEATURE_POLICY_FAIL` (default) skips the schema and records an error; `..._REMOVE` strips the unsupported fields and imports the rest. |
| `paused` | Pauses the Schema Registry sync task and **lifts** the destination-context write protection — the cutover step. |

Migration rules worth stating up front:

- While the link is active, the destination contexts it owns are **read-only**; contexts outside the filter stay writable. Pause the sync task (or fail the link over) before pointing applications at the shadow cluster.
- Those destination contexts must be **empty** before the link starts; the rest of the shadow cluster's registry need not be.
- Requires a shadow cluster on Redpanda 26.2 or later and network reachability from the cluster to the source registry. Replicating a context other than the default one requires `schema_registry_enable_qualified_subjects` (on by default).
- Schema arrival can lag topic data by up to `tail_interval`, so consumers may briefly fail to resolve schema IDs on records that already arrived. Not a replication error.
- API-mode Schema Registry replication is rolling out to Redpanda Cloud; if the options are not yet available for a cluster, the customer should contact Redpanda Support.

```bash
# Migrate schemas from a Confluent Schema Registry alongside topic data.
# A link carrying only schema_registry_sync_options replicates schemas and nothing else —
# keep the topic/offset/ACL sync options in the same request for a full migration.
curl -s -X POST "${BASE}/v1/shadow-links" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d '{
    "shadow_link": {
      "shadow_redpanda_id": "cjcuq79c4vs94fcufc2g",
      "name": "confluent-migration",
      "client_options": {
        "bootstrap_servers": ["<source-broker>:9092"],
        "tls_settings": {"enabled": true}
      },
      "schema_registry_sync_options": {
        "shadow_schema_registry_api": {
          "source_url": "https://<source-schema-registry-host>",
          "auth_options": {"basic": {"username": "<sr-api-key>", "password": "${secrets.<SECRET_ID>}"}},
          "tls_settings": {"enabled": true},
          "source_filter": {"contexts": ["."], "subjects": []},
          "destination": {"identity": {}},
          "unsupported_schema_feature_policy": "UNSUPPORTED_SCHEMA_FEATURE_POLICY_FAIL"
        }
      }
    }
  }' | jq '.operation.id'
```

The same settings are available in the Cloud UI create-shadow-link wizard, in the `rpk shadow create --config-file` YAML (keys match the API field names), and in the Terraform provider's `redpanda_shadow_link` resource. Monitor with `rpk shadow status <link-name> --print-registry` (selected source vs destination subject/version inventory, current and last full sync counters, last error) and read back stored settings with `rpk shadow describe <link-name> --print-registry`.

---

## rpk cloud byoc Plugin: Full Reference

The byoc plugin is a downloaded binary managed by rpk. It wraps Terraform calls to provision/destroy the agent infrastructure in your cloud account.

Source: rpk `src/go/rpk/pkg/cli/cloud/byoc/` (`byoc.go`, `install.go`) in the public `redpanda` repo.

### Commands

```bash
# Install the plugin for a specific cluster version
rpk cloud byoc install --redpanda-id <cluster-id>
# Output: "BYOC plugin installed successfully!"
# If already up to date: "Your BYOC plugin is currently up to date, avoiding reinstalling!"
# Note: RPK_CLOUD_SKIP_VERSION_CHECK only bypasses the check when a plugin is already installed.

# Uninstall the local plugin binary
rpk cloud byoc uninstall

# Provider-specific apply/destroy/validate subcommands
# (these are handled by the downloaded plugin binary)
# GCP apply/destroy require --project-id; Azure apply/destroy require --subscription-id.
rpk cloud byoc aws apply     --redpanda-id <cluster-id>
rpk cloud byoc aws destroy   --redpanda-id <cluster-id>
rpk cloud byoc aws validate

rpk cloud byoc gcp apply     --redpanda-id <cluster-id> --project-id <gcp-project-id>
rpk cloud byoc gcp destroy   --redpanda-id <cluster-id> --project-id <gcp-project-id>
rpk cloud byoc gcp validate

rpk cloud byoc azure apply   --redpanda-id <cluster-id> --subscription-id <azure-sub-id>
rpk cloud byoc azure destroy --redpanda-id <cluster-id> --subscription-id <azure-sub-id>
# Note: aws and gcp validate are confirmed; azure validate is not separately attested.
```

The per-provider account flags (`--project-id` for GCP, `--subscription-id` for Azure) identify the target cloud account for the Terraform run. The Cloud console builds the destroy command with these flags, and apply takes the same flags.

### Plugin Version Pinning

The plugin binary version is pinned to what the control plane specifies for your cluster. This ensures the Terraform version matches the cluster's agent requirements. The pinning flow:

1. rpk calls `BYOCPluginService.ListArtifactsByRedpandaID` with your cluster ID
2. The API returns the required artifact URL with an embedded SHA256 checksum
3. rpk checks if the installed binary matches that SHA
4. If not (or no plugin installed), it downloads and verifies the new binary
5. The binary is stored in rpk's managed plugin path (e.g. `~/.local/bin/`)

**Bypass version check (dev/CI only):**
```bash
export RPK_CLOUD_SKIP_VERSION_CHECK=1
rpk cloud byoc aws apply --redpanda-id <cluster-id>
```

For `validate`, rpk always downloads the **latest** plugin version (no cluster ID required).

### Authentication for rpk byoc

The plugin receives the Bearer token automatically from rpk. You never pass it manually. Auth options, in order of preference:

```bash
# 1. Already logged in (token in rpk.yaml)
rpk cloud byoc aws apply --redpanda-id <id>

# 2. Client credentials via -X flags
rpk cloud byoc aws apply --redpanda-id <id> \
  -X cloud.client_id="${CLIENT_ID}" \
  -X cloud.client_secret="${CLIENT_SECRET}"

# 3. Environment variables
export RPK_CLOUD_CLIENT_ID="${CLIENT_ID}"
export RPK_CLOUD_CLIENT_SECRET="${CLIENT_SECRET}"
rpk cloud byoc aws apply --redpanda-id <id>

# 4. Direct flags
rpk cloud byoc aws apply --redpanda-id <id> \
  --client-id "${CLIENT_ID}" \
  --client-secret "${CLIENT_SECRET}"
```

Note: `--cloud-api-token` is a hidden flag used internally by the plugin — never set it manually.

### Complete BYOC Provisioning Script

```bash
#!/usr/bin/env bash
set -euo pipefail

CLIENT_ID="${RPK_CLOUD_CLIENT_ID}"
CLIENT_SECRET="${RPK_CLOUD_CLIENT_SECRET}"
BASE="https://api.redpanda.com"
REGION="us-east-1"
PROVIDER="aws"

# Authenticate
TOKEN=$(curl -s -X POST "https://auth.prd.cloud.redpanda.com/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "client_id=${CLIENT_ID}" \
  --data-urlencode "client_secret=${CLIENT_SECRET}" \
  --data-urlencode "audience=cloudv2-production.redpanda.cloud" \
  | jq -r '.access_token')

auth_header() { echo "Authorization: Bearer ${TOKEN}"; }

# Create resource group (body must use the "resource_group" wrapper key)
RG=$(curl -s -X POST "${BASE}/v1/resource-groups" \
  -H "$(auth_header)" -H "Content-Type: application/json" \
  -d '{"resource_group": {"name": "byoc-rg"}}')
RG_ID=$(echo "${RG}" | jq -r '.resource_group.id')
echo "Resource group: ${RG_ID}"

# Create network
NET_OP=$(curl -s -X POST "${BASE}/v1/networks" \
  -H "$(auth_header)" -H "Content-Type: application/json" \
  -d "{\"network\": {
    \"name\": \"byoc-network\",
    \"resource_group_id\": \"${RG_ID}\",
    \"cloud_provider\": \"CLOUD_PROVIDER_AWS\",
    \"region\": \"${REGION}\",
    \"cidr_block\": \"10.0.0.0/20\",
    \"cluster_type\": \"TYPE_BYOC\"
  }}")
NET_OP_ID=$(echo "${NET_OP}" | jq -r '.operation.id')
echo "Network operation: ${NET_OP_ID}"

# Wait for network
until [ "$(curl -s "${BASE}/v1/operations/${NET_OP_ID}" \
    -H "$(auth_header)" | jq -r '.operation.state')" = "STATE_COMPLETED" ]; do
  sleep 10; echo "Waiting for network..."
done

NET_ID=$(curl -s "${BASE}/v1/networks?filter.name_contains=byoc-network" \
  -H "$(auth_header)" | jq -r '.networks[0].id')
echo "Network ID: ${NET_ID}"

# Create cluster
CLUSTER_OP=$(curl -s -X POST "${BASE}/v1/clusters" \
  -H "$(auth_header)" -H "Content-Type: application/json" \
  -d "{\"cluster\": {
    \"name\": \"byoc-cluster\",
    \"resource_group_id\": \"${RG_ID}\",
    \"type\": \"TYPE_BYOC\",
    \"cloud_provider\": \"CLOUD_PROVIDER_AWS\",
    \"region\": \"${REGION}\",
    \"zones\": [\"use1-az1\", \"use1-az2\", \"use1-az3\"],
    \"throughput_tier\": \"tier-1-aws-v2-arm\",
    \"network_id\": \"${NET_ID}\"
  }}")
CLUSTER_OP_ID=$(echo "${CLUSTER_OP}" | jq -r '.operation.id')

# Extract cluster ID from operation metadata
until CLUSTER_ID=$(curl -s "${BASE}/v1/operations/${CLUSTER_OP_ID}" \
    -H "$(auth_header)" | jq -r '.operation.metadata.cluster_id // empty'); \
    [ -n "${CLUSTER_ID}" ]; do
  sleep 5
done
echo "Cluster ID: ${CLUSTER_ID}"

# Wait for CREATING_AGENT state
until [ "$(curl -s "${BASE}/v1/clusters/${CLUSTER_ID}" \
    -H "$(auth_header)" | jq -r '.cluster.state')" = "STATE_CREATING_AGENT" ]; do
  sleep 15; echo "Waiting for CREATING_AGENT state..."
done

# Install and apply the byoc agent
rpk cloud byoc install --redpanda-id "${CLUSTER_ID}" \
  -X cloud.client_id="${CLIENT_ID}" \
  -X cloud.client_secret="${CLIENT_SECRET}"

rpk cloud byoc "${PROVIDER}" apply --redpanda-id "${CLUSTER_ID}" \
  -X cloud.client_id="${CLIENT_ID}" \
  -X cloud.client_secret="${CLIENT_SECRET}"

# Wait for READY
until [ "$(curl -s "${BASE}/v1/clusters/${CLUSTER_ID}" \
    -H "$(auth_header)" | jq -r '.cluster.state')" = "STATE_READY" ]; do
  sleep 30; echo "Waiting for cluster to be READY..."
done

# Get the data-plane URL
DP_URL=$(curl -s "${BASE}/v1/clusters/${CLUSTER_ID}" \
  -H "$(auth_header)" | jq -r '.cluster.dataplane_api.url')

echo "Cluster READY. Data plane URL: ${DP_URL}"
```
