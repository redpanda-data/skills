---
name: sql-admin-api
description: >-
  Administers Redpanda SQL on a Redpanda Cloud BYOC cluster: enabling, scaling,
  and disabling the SQL engine through the Cloud Console, the Cloud API, or the
  Terraform provider, finding connection details, and managing authentication
  and access. Use when a user wants to turn Redpanda SQL on or off, change its
  compute size, set it up on a BYOVPC cluster, find the SQL endpoint, connect
  with an OIDC token or a SCRAM password, assign the SQL Manage or SQL Access
  roles, or understand how grants gate access to topics. For writing queries
  and GRANT syntax, see `/redpanda:sql`. For diagnosing errors and slow
  queries, see `/redpanda:sql-debugging`. For catalogs, topic-backed tables,
  and Iceberg, see `/redpanda:sql-federated-queries`. For general BYOC cluster
  operations, see `/redpanda:cloud-byoc`.
---

# Redpanda SQL: Administration on Redpanda Cloud

Redpanda SQL is a PostgreSQL-compatible analytical (OLAP) query engine that runs inside a Redpanda Cloud BYOC cluster (AWS or GCP, including BYOVPC). It turns Redpanda topics, and their history in Apache Iceberg, into SQL tables. Redpanda manages the engine: users administer it only through the surfaces below.

| Task | Surface |
|------|---------|
| Enable, scale, disable | Cloud Console (*Dataplane settings*), Cloud API (`rpsql` on the cluster), Terraform (`rpsql` block on `redpanda_cluster`) |
| Find the endpoint | Cloud Console cluster overview, *How to connect* panel, *SQL* tab |
| Authenticate | Redpanda Cloud OIDC (bearer token or client credentials), or SCRAM for legacy clients |
| Authorize | Cloud data-plane RBAC (*SQL: Manage* / *SQL: Access*) plus SQL `GRANT` / `REVOKE` |
| Check status | *Redpanda SQL* card on the cluster overview, plus `SHOW NODES;` and related commands |
| Node-level diagnostics | Redpanda Support |

There is no engine configuration file, environment variable, admin port, or metrics endpoint for users to set or reach. Do not suggest tuning engine settings. Route those requests to Redpanda Support.

## Prerequisites

- A Redpanda Cloud organization on usage-based billing.
- Admin permissions in the organization, to enable or change the engine.
- For the Cloud API, a bearer token. See [Authenticate to the Cloud API](https://docs.redpanda.com/api/doc/cloud-controlplane/authentication).
- Older BYOC clusters may need their agent permissions refreshed before enabling SQL. Rerun `rpk cloud byoc aws apply --redpanda-id=<cluster-id>` (AWS) or `rpk cloud byoc gcp apply --redpanda-id=<cluster-id> --project-id=<project-id>` (GCP). The [enable page](https://docs.redpanda.com/cloud-data-platform/sql/get-started/deploy-sql-cluster/) gives the cluster-creation cutoff dates.

You pay for the engine while it is enabled, even when it is idle. Do not quote prices or hardware sizes. Point users to [Redpanda SQL billing metrics](https://docs.redpanda.com/cloud-data-platform/billing/billing/#redpanda-sql-billing-metrics).

## Enable, scale, and disable

Compute size is set in RPUs in the Console, or as `replicas` (SQL compute nodes, minimum 1) in the API and Terraform.

### Cloud Console

- **New cluster:** in the BYOC cluster creation form, toggle the *Redpanda SQL engine* card on and set the *RPU* slider.
- **Existing cluster:** open the cluster, go to *Dataplane settings*, then the *Cluster* tab. Find the SQL row (labeled *RP SQL* or *Redpanda SQL*), click *Edit*, set the *RPU* slider, and click *Enable Redpanda SQL engine*. The *Redpanda SQL* card on the cluster overview can also offer *Enable Redpanda SQL*.
- **Scale:** same row, *Edit*, drag the *RPU* slider, *Save changes*.
- **Disable:** same row, *Edit*, *Disable*.

### Cloud API

```bash
# Enable on an existing cluster. update_mask must list every rpsql field in the body.
curl -X PATCH "https://api.redpanda.com/v1/clusters/<cluster-id>?update_mask=rpsql.enabled,rpsql.replicas,rpsql.zones" \
  -H "Authorization: Bearer $AUTH_TOKEN" -H "Content-Type: application/json" \
  -d '{"rpsql":{"enabled":true,"replicas":1,"zones":["<sql-az>"]}}'

# Scale
curl -X PATCH "https://api.redpanda.com/v1/clusters/<cluster-id>?update_mask=rpsql.replicas" \
  -H "Authorization: Bearer $AUTH_TOKEN" -H "Content-Type: application/json" \
  -d '{"rpsql":{"replicas":3}}'

# Disable
curl -X PATCH "https://api.redpanda.com/v1/clusters/<cluster-id>?update_mask=rpsql.enabled" \
  -H "Authorization: Bearer $AUTH_TOKEN" -H "Content-Type: application/json" \
  -d '{"rpsql":{"enabled":false}}'

# Each call returns a long-running operation. Poll it until "state": "STATE_COMPLETED".
curl -X GET "https://api.redpanda.com/v1/operations/<operation-id>" \
  -H "Authorization: Bearer $AUTH_TOKEN"
```

On a new cluster, add the same `rpsql` object to the `cluster` body of `POST /v1/clusters`. If you omit `zones`, also drop `rpsql.zones` from `update_mask`. The full payloads are in [api-and-terraform.md](references/api-and-terraform.md).

### Terraform

Set the `rpsql` block (`enabled`, `replicas`, `zones`; computed `url`) on the `redpanda_cluster` resource. Scaling and disabling update the cluster in place. See [api-and-terraform.md](references/api-and-terraform.md#terraform-provider).

### Single availability zone

Redpanda SQL runs in one availability zone, even on a multi-AZ cluster. Set `rpsql.zones` to one zone from the cluster's `zones` list. If you omit it, Redpanda picks the zone. The zone is locked while SQL is enabled. The published docs disagree on whether you can move it by disabling and re-enabling: see [api-and-terraform.md](references/api-and-terraform.md#availability-zone).

### BYOVPC clusters

On BYOVPC, Redpanda does not create resources in your cloud account. Before you enable SQL, you provision the SQL resources yourself with the Redpanda BYOVPC Terraform module (`enable_redpanda_sql = true`). Then you pass the module outputs to the cluster as customer-managed resources (`rpsql_*` fields). Points to know:

- On a new BYOVPC cluster, enable SQL with Terraform or the Cloud API. On an existing one, you can also use the Console.
- The SQL customer-managed resources cannot be changed while SQL is enabled.
- A `PATCH` must use an explicit leaf-path `update_mask` for each customer-managed resource field. A grouped mask such as `customer_managed_resources` is silently ignored: the operation completes but SQL stays disabled.
- Disabling SQL does not delete the SQL cloud resources. With Terraform, also remove the `rpsql_*` fields, or you get permanent drift.
- BYOVPC clusters are private, so connect from a host inside the VPC.

Field names and steps for each cloud are in [api-and-terraform.md](references/api-and-terraform.md#byovpc).

### Disabling clears SQL state

Disabling Redpanda SQL removes the engine and its state: catalog metadata, table mappings, and roles and grants. In-flight queries fail. Topic data, Schema Registry subjects, Iceberg history, and the Redpanda cluster itself are not affected.

**Re-enabling provisions a fresh engine. Catalogs, tables, and grants are not restored.** Before you disable, record what you need to rebuild (`SHOW REDPANDA CATALOGS;`, `SHOW REDPANDA TABLES;`, and the grant queries in [access-and-authentication.md](references/access-and-authentication.md#inspect-grants)).

## Verify and monitor

After you enable SQL, a *Redpanda SQL* card appears on the cluster overview. It shows engine status, active sessions, queries per minute, and node count. When the *Nodes* indicator shows all nodes ready (for example *1/1*), the engine accepts connections. Provisioning can take up to about 30 minutes. If something is wrong, the cluster health indicator shows *Needs attention*, and the card can show badges such as *Unavailable* or *Metrics unavailable*. On private clusters, live stats load only when you open the page from inside the private network.

The cluster's metrics endpoint (*How to connect* > *Prometheus* tab) exports metrics for brokers and connectors, and the Cloud metrics reference lists no SQL engine metrics. Do not point users at a Prometheus endpoint for the SQL engine. Use the *Redpanda SQL* card and the `SHOW` commands below.

Inspect the engine from SQL:

```sql
SHOW NODES;              -- SQL compute nodes and their status
SHOW REDPANDA CATALOGS;  -- Redpanda catalogs
SHOW ICEBERG CATALOGS;   -- Iceberg catalogs
SHOW REDPANDA TABLES;    -- SQL tables mapped to Redpanda topics
SHOW QUERIES;            -- currently running queries
```

## Connect

Connection details are on the cluster overview, in the *How to connect* panel, on the *SQL* tab. With Terraform, the `rpsql.url` attribute gives the endpoint. You can also query in the Console with SQL Studio. Quick check with a bearer token:

```bash
rpk cloud login
PGPASSWORD=$(rpk cloud auth token) \
  psql "host=<sql-host> port=<sql-port> dbname=oxla user=ignored options='auth_method=bearer' sslmode=require"
```

The SQL endpoint requires TLS (`sslmode=require`). `dbname=oxla` is the database name the published docs use. Auth modes, client credentials, SCRAM setup, and token expiry are in [access-and-authentication.md](references/access-and-authentication.md).

## Access model in brief

- Assigning a Cloud role with *SQL: Manage* (SQL superuser) or *SQL: Access* (regular user) provisions the user in the engine. No `CREATE USER` is needed.
- A *SQL: Access* user owns nothing by default. A *SQL: Manage* user grants `SELECT` on specific topics, catalogs, or schemas.
- Every query reaches the topics through one internal SASL credential, so **Kafka ACLs do not gate query-time access. `GRANT` / `REVOKE` inside Redpanda SQL do.**

Details: [access-and-authentication.md](references/access-and-authentication.md). GRANT/REVOKE syntax: `/redpanda:sql`.

## Getting help

Node-level diagnostics (logs, configuration, crash reports, resource usage) are collected by Redpanda Support. Support runs `rpk sql debug bundle` from inside the SQL pods. Users cannot run it usefully from outside the cluster, so do not tell them to run it. Open a ticket at [Redpanda Support](https://support.redpanda.com/hc/en-us/requests/new) with the cluster ID, the time of the problem, and the failing query or error text. For query errors, slow queries, out-of-memory errors, and degraded states, use `/redpanda:sql-debugging` first.

## Reference Directory

- [api-and-terraform.md](references/api-and-terraform.md): Full Cloud API payloads for enabling on new and existing clusters, long-running operation polling, the Terraform `rpsql` block, the availability-zone rule, and BYOVPC customer-managed resources for AWS and GCP.
- [access-and-authentication.md](references/access-and-authentication.md): Authentication modes (bearer token, client credentials, SCRAM), connection strings, TLS, token expiry, the *SQL: Manage* / *SQL: Access* roles, automatic user provisioning, the internal SASL credential, schema-level privileges, and inspecting grants.
- [SOURCES.md](references/SOURCES.md): Published-docs source map for this skill.
