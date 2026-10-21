# sql-admin-api Skill Source Map

Maps each file in `skills/sql-admin-api/` to the published-docs sources its claims derive from.

**Scope gate: the published Redpanda Cloud docs. The engine source is used only to confirm the behavior of documented surfaces, never to add undocumented ones.** Redpanda SQL is offered only as a managed engine on Redpanda Cloud BYOC (including BYOVPC). This skill covers only what a user can do: enable, scale, and disable the engine (Console, Cloud API, Terraform), connect and authenticate, and manage access. Engine configuration, environment variables, admin and metrics ports, deployment, and node-level diagnostics are not user surfaces. Do not re-add them.

Read the docs from the private `redpanda-data/cloud-docs` repo at `origin/main` (Redpanda-Github-Read connector or a local clone with `git show origin/main:<path>`), or from the live site at https://docs.redpanda.com/cloud-data-platform/. The rpk reference partials are in the private `redpanda-data/docs` repo.

## File-to-source table

| Skill file | Published-docs sources (cloud-docs unless noted) |
|---|---|
| `SKILL.md` | `modules/sql/pages/get-started/deploy-sql-cluster.adoc`, `modules/sql/pages/get-started/enable-sql-byovpc.adoc`, `modules/sql/pages/get-started/enable-sql-byovpc-aws.adoc`, `modules/sql/pages/get-started/enable-sql-byovpc-gcp.adoc`, `modules/manage/pages/terraform-provider.adoc` (Redpanda SQL section), `modules/get-started/pages/cluster-overview.adoc` (Health and warnings, How to connect, Product cards), `modules/sql/pages/connect-to-sql/authenticate.adoc`, `modules/sql/pages/manage/manage-access.adoc`, `modules/billing/pages/billing.adoc` (Redpanda SQL billing metrics: link only), `modules/reference/pages/rpk/rpk-sql/rpk-sql-debug-bundle.adoc` and docs `modules/reference/partials/rpk-sql/rpk-sql-debug-bundle.adoc` (Support runs it from inside the SQL pods) |
| `references/api-and-terraform.md` | `modules/sql/pages/get-started/deploy-sql-cluster.adoc`, `modules/sql/pages/get-started/enable-sql-byovpc-aws.adoc`, `modules/sql/pages/get-started/enable-sql-byovpc-gcp.adoc`, `modules/manage/pages/terraform-provider.adoc` ("Enable Redpanda SQL on a BYOC cluster" and "Configuration changes that replace a cluster"), `modules/shared/partials/feature-flag-rpcn.adoc` (BYOVPC Premium-support note) |
| `references/access-and-authentication.md` | `modules/sql/pages/connect-to-sql/authenticate.adoc`, `modules/sql/pages/manage/manage-access.adoc`, `modules/reference/pages/sql/sql-statements/alter-user.adoc` (Cloud user sync note), `modules/sql/pages/get-started/deploy-sql-cluster.adoc` (bearer-token connect), `modules/sql/pages/get-started/sql-quickstart.adoc` (prerequisites), `modules/get-started/pages/cluster-overview.adoc` (How to connect) |

## Deferred to live surfaces (do not pin)

- Prices, the RPU-to-hardware mapping, and instance types: link the billing page.
- Minimum versions (`rpk`, `psql`, Terraform, the Terraform provider, and the BYOVPC module) and the `replicas` maximum: the skill says "see the docs". The module minimum differs per cloud and is on each BYOVPC enable page; the provider minimum is on the Terraform page.
- The cluster-creation cutoff dates for refreshing agent permissions (`rpk cloud byoc ... apply`): link the enable page.

## Open items for human review

- The SQL availability-zone rule is inconsistent across pages. The BYOC enable page and the Terraform page say "locked when first enabled, cannot be changed". The BYOVPC pages say "locked while enabled; disable and re-enable to move". The default zone is also inconsistent: "cluster's first zone" on the enable and BYOVPC pages, "chosen automatically" on the Terraform page. Both are flagged in `api-and-terraform.md` with a TODO.
- The Console row label differs between pages: *RP SQL* on the BYOC enable page, *Redpanda SQL* on the BYOVPC pages. The skill names both labels.
- The connection-string placeholders differ between pages: `authenticate.adoc` uses `host=<sql-host> port=<sql-port>`, while `deploy-sql-cluster.adoc` and `sql-quickstart.adoc` use `host=<sql-external-endpoint> port=5432`. The SQL skills follow the authenticate page.

Verified 2026-10-21.
