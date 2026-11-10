---
name: sql-admin-api
description: >-
  Administers Redpanda SQL on a Redpanda Cloud BYOC cluster: enabling, scaling,
  and disabling the SQL engine through the Cloud Console, the Cloud API, or the
  Terraform provider, finding connection details, and managing authentication
  and access. Use when a user wants to turn Redpanda SQL on or off, change its
  compute size or availability zone, set it up on a BYOVPC cluster, find the
  SQL endpoint, connect with an OIDC token or a SCRAM password, assign the SQL
  Manage or SQL Access roles, or understand how grants gate access to topics.
  For writing queries and GRANT syntax, see `/redpanda:sql`. For diagnosing
  errors and slow queries, see `/redpanda:sql-debugging`. For catalogs,
  topic-backed tables, and Iceberg, see `/redpanda:sql-federated-queries`. For
  general BYOC cluster operations, see `/redpanda:cloud-byoc`.
---

# Redpanda SQL: administration on Redpanda Cloud

Redpanda SQL is the analytical SQL engine that Redpanda manages inside a Redpanda Cloud BYOC
cluster, including BYOVPC. Users turn it on, size it, and turn it off through the Cloud Console,
the Cloud API, or the Terraform provider. This skill keeps only the procedures below. Look up
everything else in the docs (last section).

## How to work

**Save the SQL state before you disable Redpanda SQL.** Disabling deletes the engine's catalogs,
table mappings, and roles and grants, and re-enabling starts a fresh engine with none of them.
Before you send the disable, record what the user needs to rebuild: run
`SHOW REDPANDA CATALOGS;`, `SHOW ICEBERG CATALOGS;`, `SHOW REDPANDA TABLES;`, and read the
grants from `information_schema.role_external_relation_grants` and
`information_schema.role_table_grants`. Then tell the user what was removed and where the record
is.

**Don't disable Redpanda SQL to reach another goal.** When a change such as moving SQL to another
availability zone is refused while SQL is enabled, don't disable and re-enable on your own. Tell
the user that this deletes every catalog, table mapping, and grant, and leave the decision to them
or to Redpanda Support.

**On BYOVPC, list every field you set in `update_mask` by its full leaf path.** That includes
`rpsql.enabled` and each SQL customer-managed resource, such as
`customer_managed_resources.aws.rpsql_node_group_instance_profile.arn`. A grouped mask such as
`customer_managed_resources` is ignored without an error: the operation completes and SQL stays
disabled.

**On AWS BYOVPC, detach the Glue policy from the SQL engine role before you disable SQL.** Check
the policies attached to `redpanda-<cluster-id>-redpanda-oxla-cluster` and detach any Glue policy
first. Redpanda deletes that role on disable, and AWS cannot delete a role that still has a policy
attached. Leave the brokers' `redpanda-cloud-storage-manager-<cluster-id>` role alone: the brokers
still use it to write Iceberg tables.

## Use the docs for everything else

Look up request bodies, Terraform attributes, BYOVPC module settings, connection strings,
authentication modes, roles, and grants in the Redpanda docs, following `/redpanda:redpanda-docs`.
Pass `platform: "cloud"` to `ask_redpanda_question`: Redpanda SQL runs only in Redpanda Cloud. Use
`search_api_reference` and `get_api_reference_content` for the Control Plane API. Start from:

- Enable on BYOC: https://docs.redpanda.com/cloud-data-platform/sql/get-started/deploy-sql-cluster/
- Enable on BYOVPC:
  https://docs.redpanda.com/cloud-data-platform/sql/get-started/enable-sql-byovpc/
- Terraform: https://docs.redpanda.com/cloud-data-platform/manage/terraform-provider/
- Authenticate:
  https://docs.redpanda.com/cloud-data-platform/sql/connect-to-sql/authenticate/
- Manage access: https://docs.redpanda.com/cloud-data-platform/sql/manage/manage-access/

If the Docs MCP server refuses for quota and you can't fetch the page, tell the user to sign in
through `/mcp` rather than answering from memory.
