# sql-admin-api Skill Source Map

The skill is thin: it keeps only the "How to work" procedures below, each backed by a behavioral
eval case in `evals/suites/sql-admin-api.eval.json`, and sends the agent to the docs for
everything else. This file maps only the claims the skill still makes.

**Scope gate: the published Redpanda Cloud docs. The engine source is used only to confirm the
behavior of documented surfaces, never to add undocumented ones.** Redpanda SQL is offered only
as a managed engine on Redpanda Cloud BYOC (including BYOVPC). Engine configuration, environment
variables, admin and metrics ports, deployment, and node-level diagnostics are not user surfaces.

Docs that cover this skill: the SQL pages and the Terraform provider page of the Cloud docs,
served at https://docs.redpanda.com/cloud-data-platform/ from the private
`redpanda-data/cloud-docs` repo (read it at `origin/main` with the Redpanda-Github-Read connector
or `git show origin/main:<path>`). In the Docs MCP, use `platform: "cloud"`. Paths below are in
cloud-docs unless noted.

## How to work: line, source, eval case

Pass rates are baseline / skill / installed, 3 runs each, from the eval archive run folder
`sql-admin-api` (2026-11-10). The docs-arm results are from the conversion run and were not rerun.

| How to work line | Source | Eval case |
|---|---|---|
| Save the SQL state before disabling: disabling deletes catalogs, table mappings, and roles and grants, and re-enabling restores none of them; the `SHOW REDPANDA CATALOGS`, `SHOW ICEBERG CATALOGS`, `SHOW REDPANDA TABLES` commands and the two `information_schema` grant views. 0/3 / 3/3 / 3/3 (conversion-run docs arm 0/3: it read that state is lost and disabled anyway). Also a safety guardrail: the disable irreversibly deletes the engine's metadata. | `modules/sql/pages/get-started/deploy-sql-cluster.adoc` (Disable section, Verify section), `modules/sql/pages/get-started/enable-sql-byovpc-aws.adoc` (Disable section), `modules/sql/pages/manage/manage-access.adoc` (inspecting grants) | `disable-sql-saves-definitions-first` |
| Don't disable SQL to reach another goal, such as moving the zone; tell the user what is deleted and leave the decision to them or Support. Safety guardrail: the disable irreversibly deletes the engine's metadata. 1/3 / 3/3 / 3/3. The baseline did not disable SQL in these runs; its two failures only hedged on whether disabling deletes the state. The line and case stay as a regression guard. | `deploy-sql-cluster.adoc` (zone sentence, Disable section), `enable-sql-byovpc-aws.adoc` (zone sentence) | `move-sql-zone-without-silent-disable` |
| On AWS BYOVPC, detach the Glue policy from `redpanda-<cluster-id>-redpanda-oxla-cluster` before disabling; Redpanda deletes that role on disable and AWS cannot delete a role with a policy attached; leave `redpanda-cloud-storage-manager-<cluster-id>` alone. 0/3 / 3/3 / 3/3 (conversion-run docs arm 1/3). Verified against the product's Terraform for the SQL engine role (2026-11-10). | `enable-sql-byovpc-aws.adoc` (Grant Glue access, Disable section); public module `redpanda-data/terraform-aws-redpanda-byovpc` `iam_glue_iceberg.tf` | `glue-policy-detached-before-sql-disable` |

## Other claims in SKILL.md

| Claim | Source |
|---|---|
| Redpanda SQL runs only on Redpanda Cloud BYOC, including BYOVPC | `modules/sql/pages/get-started/deploy-sql-cluster.adoc`, `enable-sql-byovpc.adoc` |
| Docs URLs | served at https://docs.redpanda.com/cloud-data-platform/ from cloud-docs |
| When the Docs MCP server refuses for quota and no page fetch is possible, tell the user to sign in through `/mcp` rather than answering from memory | `skills/redpanda-docs/references/SOURCES.md` (anonymous quota row) |

## Docs gaps (not skill claims; do not re-verify here)

Found by the evals (2026-11-10) and handed to the docs team. They live in the docs once fixed,
never in the skill.

- **What a user does when a SQL node needs diagnostics.** `rpk sql debug bundle` (docs
  `modules/reference/partials/rpk-sql/rpk-sql-debug-bundle.adoc`, single-sourced to cloud-docs
  `modules/reference/pages/rpk/rpk-sql/rpk-sql-debug-bundle.adoc`) says Redpanda Support runs it
  from inside a SQL pod, but not that a BYOC user cannot reach the pods and should open a support
  ticket with the cluster ID, the time, and the error. The docs arm told the user to
  `kubectl exec` into a pod and run it (0/3). This is an rpk reference page, so the fix is in
  rpk's help text (`rpk sql debug bundle --help`). The help says to run it "from inside a
  Redpanda SQL pod ... or against a remote cluster" and does not say Support runs it; the
  sentence about Support comes from the docs override in docs `docs-data/rpk-overrides.json`
  (`rpk sql debug bundle`). Neither the help nor the override tells a Cloud user what to do
  instead. Case: `support-collects-sql-debug-bundle`.
- **SQL engine metrics on the cluster metrics endpoint (needs a human decision).** The docs
  conflict. `modules/manage/pages/monitor-cloud.adoc` says the endpoint exports metrics for
  brokers and connectors. `modules/sql/pages/troubleshoot/query-out-of-memory.adoc` ("Monitor
  memory usage") tells users to track the Prometheus gauge `query_memory_consumption_total`
  without saying where to scrape it. The docs arm named that gauge and `oxla_process_memory_total`
  as metrics to scrape (0/3). The full skill said the endpoint has no SQL engine metrics.
  Whether the customer-facing endpoint serves SQL engine metrics was not confirmed against
  product source. Confirm, then fix whichever page is wrong. Until then the case's expected
  answer is unverified. Case: `no-prometheus-metrics-for-sql-engine`.
- **The grouped-mask warning overstates the silent case.** `enable-sql-byovpc-aws.adoc` and
  `enable-sql-byovpc-gcp.adoc` (IMPORTANT block before the PATCH step) say a grouped mask such as
  `customer_managed_resources` is silently ignored and the operation completes with SQL disabled.
  In the product, the Cloud API drops any grouped path. When the SQL fields are grouped too
  (`rpsql`), nothing is applied and SQL stays disabled. When `rpsql.enabled` is a leaf path, the
  update is rejected because the SQL customer-managed resources are missing. The pages also don't
  say that leaving `update_mask` out works: the REST gateway then derives leaf paths from the body.
  Source: the Cloud API's public update mapper and REST gateway (product source).
- **The SQL availability zone can be moved.** `deploy-sql-cluster.adoc` and
  `modules/manage/pages/terraform-provider.adoc` say the zone is locked when SQL is first enabled
  and cannot be changed afterward. In the product, the zone is locked only while SQL is enabled:
  disabling clears it, and re-enabling accepts a new zone, as `enable-sql-byovpc-aws.adoc` says.
  The Terraform page also says an omitted zone is "chosen automatically"; the product uses the
  cluster's first zone, as the enable pages say. Source: the control plane's SQL zone validation
  and defaulting (product source).

## Lines removed for lack of a failing baseline

The full skill's other content was facts, not procedures, so no other line was tested as a
behavioral case. Its facts were sampled as fact cases instead; every other fact case scored docs 3/3: the agent permission refresh for older clusters, the
`rpsql` fields in `update_mask`, the single SQL zone, `enable_redpanda_sql` on the BYOVPC module,
the grouped-mask failure, the state lost on disable, `rpsql.url`, superuser through the
*SQL: Manage* role, the Glue read-only policy and role, `glue_iceberg_namespaces`, and bearer
tokens checked only at connect. Those facts were dropped from the skill and stay in the docs.
`older-byoc-agent-permissions-refresh` (3/3) and `bearer-token-checked-at-connect` (2/3) also
pass in the baseline.

- **"On BYOVPC, list every field you set in `update_mask` by its full leaf path."** Removed on
  2026-11-10. After the case fix under "Corrections after the eval run", the baseline passed
  `byovpc-enable-leaf-path-masks`: it left `update_mask` out, which the REST gateway accepts.
  Baseline 3/3, skill 0/3, installed 3/3 (eval archive run folder `sql-admin-api-leaf-rerun2`).
  The skill arm, which has no docs server, stopped without sending the request. Not a safety
  guardrail: a wrong mask loses no data and changes no network exposure.

## Corrections after the eval run

Re-verified against product source on 2026-11-10.

- The leaf-path line said a grouped mask is always ignored without an error. That holds only when
  the SQL fields are grouped too; with `rpsql.enabled` as a leaf path, the update is rejected. The
  line was removed (above); the docs pages carry the same claim, listed under "Docs gaps".
- `byovpc-enable-leaf-path-masks` failed an agent that left `update_mask` out, which works because
  the REST gateway derives leaf paths from the body. It also passed agents that wrapped the body
  in `cluster` and `update_mask` keys, which the gateway rejects. The case now accepts the omitted
  mask, forbids the wrapped body, and matches escaped quotes in the body. With those fixes the
  baseline passes, so the line was removed (see "Lines removed for lack of a failing baseline").
  Runs: `sql-admin-api` (before the fix: 2/3 / 2/3 / 3/3), `sql-admin-api-leaf-rerun` (partial
  fix: 2/3 / 1/3 / 3/3), `sql-admin-api-leaf-rerun2` (final: 3/3 / 0/3 / 3/3).
- The open item on the availability-zone rule is resolved: the product matches
  `enable-sql-byovpc-aws.adoc`, and the other two pages are listed under "Docs gaps".
