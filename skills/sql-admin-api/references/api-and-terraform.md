Source: cloud-docs `modules/sql/pages/get-started/deploy-sql-cluster.adoc`, `modules/sql/pages/get-started/enable-sql-byovpc.adoc`, `modules/sql/pages/get-started/enable-sql-byovpc-aws.adoc`, `modules/sql/pages/get-started/enable-sql-byovpc-gcp.adoc`, `modules/manage/pages/terraform-provider.adoc` (section "Enable Redpanda SQL on a BYOC cluster"). Verified 2026-10-18. File-by-file mapping in [SOURCES.md](SOURCES.md).

# Enable, Scale, and Disable Redpanda SQL: Cloud API and Terraform

All examples use the Redpanda Cloud Control Plane API at `https://api.redpanda.com`. Get a bearer token first: [Authenticate to the Cloud API](https://docs.redpanda.com/api/doc/cloud-controlplane/authentication). The cluster ID is shown in the page header of the cluster overview in the Cloud Console.

Published guides:
- [Enable Redpanda SQL on a BYOC cluster](https://docs.redpanda.com/cloud-data-platform/sql/get-started/deploy-sql-cluster/)
- [Enable Redpanda SQL on a BYOVPC cluster](https://docs.redpanda.com/cloud-data-platform/sql/get-started/enable-sql-byovpc/) (AWS and GCP subpages)
- [Terraform provider: Enable Redpanda SQL](https://docs.redpanda.com/cloud-data-platform/manage/terraform-provider/#enable-redpanda-sql-on-a-byoc-cluster)

---

## The `rpsql` object

| Field | Meaning |
|-------|---------|
| `rpsql.enabled` | `true` to run the engine, `false` to tear it down |
| `rpsql.replicas` | Number of SQL compute nodes, minimum 1. The BYOVPC pages also state a maximum: read it there instead of assuming one. |
| `rpsql.zones` | Optional. A list holding one zone from the cluster's `zones` list. See [Availability zone](#availability-zone). |

The Console expresses compute size as RPUs with a slider. For how RPUs relate to cost, see [Redpanda SQL billing metrics](https://docs.redpanda.com/cloud-data-platform/billing/billing/#redpanda-sql-billing-metrics). Do not quote prices or instance types.

---

## Enable on a new BYOC cluster

```bash
curl -X POST "https://api.redpanda.com/v1/clusters" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cluster": {
      "name": "<cluster-name>",
      "cloud_provider": "<CLOUD_PROVIDER_AWS | CLOUD_PROVIDER_GCP>",
      "type": "TYPE_BYOC",
      "region": "<region>",
      "zones": [ <zones> ],
      "throughput_tier": "<tier>",
      "resource_group_id": "<resource-group-id>",
      "rpsql": {
        "enabled": true,
        "replicas": <compute-nodes>,
        "zones": ["<sql-az>"]
      }
    }
  }'
```

For the rest of the BYOC cluster creation flow (network, agent, `rpk cloud byoc ... apply`), see `/redpanda:cloud-byoc`.

## Enable on an existing BYOC cluster

```bash
curl -X PATCH "https://api.redpanda.com/v1/clusters/<cluster-id>?update_mask=rpsql.enabled,rpsql.replicas,rpsql.zones" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rpsql":{"enabled":true,"replicas":<compute-nodes>,"zones":["<sql-az>"]}}'
```

`update_mask` must list every `rpsql` field in the body. If you leave out `zones`, also remove `rpsql.zones` from the mask.

Older clusters may need their agent permissions refreshed first. Rerun `rpk cloud byoc aws apply --redpanda-id=<cluster-id>` on AWS, or `rpk cloud byoc gcp apply --redpanda-id=<cluster-id> --project-id=<project-id>` on GCP. The enable page gives the cluster-creation cutoff dates.

## Scale

```bash
curl -X PATCH "https://api.redpanda.com/v1/clusters/<cluster-id>?update_mask=rpsql.replicas" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rpsql":{"replicas":<compute-nodes>}}'
```

Redpanda SQL scales horizontally. `replicas` has a minimum of 1. To remove the engine from a cluster, disable it.

## Disable

```bash
curl -X PATCH "https://api.redpanda.com/v1/clusters/<cluster-id>?update_mask=rpsql.enabled" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rpsql":{"enabled":false}}'
```

Disabling removes the engine and clears its catalog metadata, table mappings, and roles and grants. In-flight queries fail. Topic data, Schema Registry subjects, and Iceberg-committed history are not affected. **Re-enabling provisions a fresh engine. No catalogs, tables, or grants are restored**, so you must re-create them.

## Poll the long-running operation

Every create or update returns an operation ID. Poll it until it completes:

```bash
curl -X GET "https://api.redpanda.com/v1/operations/<operation-id>" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json"
# done when the response shows "state": "STATE_COMPLETED"
```

Provisioning the SQL nodes can keep the operation in `STATE_IN_PROGRESS` for roughly 15 to 30 minutes. In the Console, the engine is ready when the *Nodes* indicator on the *Redpanda SQL* card shows all nodes ready.

---

## Availability zone

Redpanda SQL deploys to a single availability zone, even on a multi-AZ cluster. Set `rpsql.zones` to one of the cluster's zones. If you omit it, the BYOC and BYOVPC pages say Redpanda uses the cluster's first zone. The Terraform page says a zone is chosen automatically.

The zone is locked once SQL is enabled. The pages disagree on what happens next:
- The BYOC enable page and the Terraform page say the zone is locked when SQL is first enabled and cannot be changed afterward.
- The BYOVPC pages say the zone is locked while SQL is enabled, and that you can move it by disabling and re-enabling SQL.

If a user needs a different zone, tell them that disabling clears all SQL state, and have them confirm with Redpanda Support before relying on a disable and re-enable to move it.

<!-- TODO(human): the published BYOC/Terraform pages ("cannot be changed afterward") and BYOVPC pages ("disable and re-enable to move") disagree on whether the SQL AZ can be changed by disable/re-enable; confirm and align. -->

---

## Terraform provider

Use the `rpsql` block on a `redpanda_cluster` resource. It needs a recent provider version: the Terraform guide gives the minimum, and BYOVPC needs a later minimum than BYOC.

| Attribute | Type | Notes |
|-----------|------|-------|
| `enabled` | Boolean | Default `false` |
| `replicas` | Number | SQL compute replicas. Scales in place. Default `1`. |
| `zones` | List of String | One zone from the cluster's `zones`. Locked once set. |
| `url` | String (computed) | SQL endpoint URL. Empty while disabled. |

```hcl
resource "redpanda_cluster" "example" {
  # ... existing BYOC cluster configuration ...
  rpsql = {
    enabled  = true
    replicas = 3
    zones    = ["<sql-az>"]
  }
}

output "sql_url" {
  value = redpanda_cluster.example.rpsql.url
}
```

To scale, change `replicas` and run `terraform apply`. To disable, set `enabled = false`. Both update the cluster in place. Adding `rpsql`, or the SQL customer-managed resources on BYOVPC, to an existing cluster does not force a replacement on supported provider versions. On older versions, adding the SQL customer-managed resources to a BYOVPC cluster replaces the cluster. Always check `terraform plan` for `forces replacement`.

---

## BYOVPC

On BYOVPC, Redpanda does not create resources in your cloud account. Provision the SQL resources with the Redpanda BYOVPC Terraform module, then pass them to the cluster as customer-managed resources (CMRs).

1. In the `redpanda-data/redpanda-byovpc/aws` or `redpanda-data/redpanda-byovpc/gcp` module, set `enable_redpanda_sql = true` and run `terraform apply`.
2. Enable SQL, passing the module outputs as the CMR fields below.
   - New cluster: use Terraform or the Cloud API.
   - Existing cluster: use Terraform, the Cloud API, or the Console (*Dataplane settings* > *Cluster* > Redpanda SQL row > *Edit*, then enter the values and set the *RPU* slider).

### AWS

| Module output | CMR field (`customer_managed_resources.aws.*`) |
|---------------|-----------------------------------------------|
| `rpsql_node_group_instance_profile_arn` | `rpsql_node_group_instance_profile.arn` |
| `rpsql_cloud_storage_bucket_arn` | `rpsql_cloud_storage_bucket.arn` |
| `rpsql_security_group_arn` | `rpsql_security_group.arn` |

```bash
curl -X PATCH "https://api.redpanda.com/v1/clusters/<cluster-id>?update_mask=rpsql.enabled,rpsql.replicas,rpsql.zones,customer_managed_resources.aws.rpsql_node_group_instance_profile.arn,customer_managed_resources.aws.rpsql_security_group.arn,customer_managed_resources.aws.rpsql_cloud_storage_bucket.arn" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customer_managed_resources": {
      "aws": {
        "rpsql_node_group_instance_profile": {"arn": "<rpsql_node_group_instance_profile_arn>"},
        "rpsql_cloud_storage_bucket": {"arn": "<rpsql_cloud_storage_bucket_arn>"},
        "rpsql_security_group": {"arn": "<rpsql_security_group_arn>"}
      }
    },
    "rpsql": {"enabled": true, "replicas": <compute-nodes>, "zones": ["<sql-az>"]}
  }'
```

For Iceberg queries against an AWS Glue catalog on BYOVPC, set `enable_glue_iceberg_catalog = true` on the module. After the cluster is running, attach the exported `glue_iceberg_policy_arn` to both `redpanda-cloud-storage-manager-<cluster-id>` and `redpanda-<cluster-id>-redpanda-oxla-cluster`. Without both attachments, `REFRESH` of the Glue-backed catalog fails with a permissions error. Catalog setup itself is covered by `/redpanda:sql-federated-queries`.

### GCP

| Module output | CMR field (`customer_managed_resources.gcp.*`) |
|---------------|-----------------------------------------------|
| `redpanda_sql_service_account_email` | `rpsql_service_account.email` |
| `redpanda_sql_api_service_account_email` | `rpsql_api_service_account.email` |
| `redpanda_sql_storage_bucket_name` | `rpsql_cloud_storage_bucket.name` |
| `redpanda_sql_secret_manager_prefix` | `rpsql_secret_manager_prefix` (a plain string) |

```bash
curl -X PATCH "https://api.redpanda.com/v1/clusters/<cluster-id>?update_mask=rpsql.enabled,rpsql.replicas,rpsql.zones,customer_managed_resources.gcp.rpsql_service_account.email,customer_managed_resources.gcp.rpsql_api_service_account.email,customer_managed_resources.gcp.rpsql_cloud_storage_bucket.name,customer_managed_resources.gcp.rpsql_secret_manager_prefix" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customer_managed_resources": {
      "gcp": {
        "rpsql_service_account": {"email": "<rpsql-service-account-email>"},
        "rpsql_api_service_account": {"email": "<rpsql-api-service-account-email>"},
        "rpsql_cloud_storage_bucket": {"name": "<rpsql-storage-bucket-name>"},
        "rpsql_secret_manager_prefix": "<rpsql-secret-manager-prefix>"
      }
    },
    "rpsql": {"enabled": true, "replicas": <compute-nodes>, "zones": ["<sql-az>"]}
  }'
```

On GCP, the module also grants the access needed to query Iceberg topics backed by a GCP Lakehouse (BigLake) REST catalog. No extra IAM step is needed.

### On a new BYOVPC cluster

Add the same `rpsql` object and SQL CMR fields to a `POST /v1/clusters` payload, or to the `redpanda_cluster` resource. Include them alongside the full set of BYOVPC CMRs the cluster already requires, or the request fails. For the base BYOVPC cluster, see `/redpanda:cloud-byoc`.

### BYOVPC rules

- **Explicit leaf-path masks only.** A `PATCH` must list each field you set in `update_mask`, including each SQL CMR leaf. A grouped mask such as `customer_managed_resources` is silently ignored: the operation returns `STATE_COMPLETED`, but SQL stays disabled.
- **The SQL CMRs cannot be changed while SQL is enabled.** Disable SQL first to change them.
- **Disabling with Terraform:** set `rpsql.enabled = false` and remove the `rpsql_*` CMR fields from `customer_managed_resources`. The control plane clears them, so leaving them in place causes permanent drift.
- **Cloud resources survive a disable.** The SQL resources stay in your account, and you can reuse them on re-enable. To delete them, wait for the disable operation to complete, then set `enable_redpanda_sql = false` in the module and run `terraform apply`. Removing them while the cluster still references them can make the apply fail.
- **Private connectivity.** BYOVPC clusters are private, so run SQL clients from a host inside the cluster's VPC.
- BYOVPC itself is an add-on that requires Premium support. Contact your Redpanda account team to unlock it.
