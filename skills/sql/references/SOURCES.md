# Redpanda SQL (`sql`) Skill Source Map

Scope gate: what a Redpanda Cloud user can do with the Redpanda SQL engine that Cloud runs.
The skill is thin: it keeps only the "How to work" procedures below, each backed by a
behavioral eval case in `evals/suites/sql.eval.json`, and sends the agent to the docs for
everything else. This file maps only the claims the skill still makes.

Engine claims are checked against `redpanda-data/oxla` at the release tag that the Cloud
install pack pins (`vars.redpanda_oxla_version` in `redpanda-data/cloudv2`
`install-pack/<version>.yml`; read the pin, do not copy it here). User-sync claims are checked
against `redpanda-data/cloudv2` at the `redpanda_oxla_api_version` the same install pack pins.
Read both private repos with the GitHub API; do not clone them.

## How to work: line, source, eval case

| How to work line | Source | Eval case |
|---|---|---|
| Find the table in its catalog: `catalog=>table`, `SHOW REDPANDA TABLES`, `DESCRIBE TABLE`, unqualified `SHOW TABLES` is an error; an unlisted topic is not mapped yet; a view is queried by name with no catalog prefix | cloud-docs `modules/reference/pages/sql/sql-statements/{show-tables,describe,create-view}.adoc` | `query-topic-table-through-catalog` |
| Fix login access in Redpanda Cloud IAM, not with SQL: the `has_database_privilege(<user>, current_database(), 'CONNECT')` check, **Organization IAM > Roles**, and the user sync owning `CONNECT` and superuser for email-named users | cloud-docs `modules/sql/pages/manage/manage-access.adoc`; cloudv2 `apps/redpanda-oxla-api/internal/controller/user_sync_db.go` (`queryCurrentUsersSQL`, `queryCurrentOxlaUsersDB`, `buildUserOpSQL`), `reconcile_users.go` (`computeUserDiff`) | `lost-login-fixed-in-iam-not-grant-connect` |
| Read the stored grants before any `REVOKE`: a pattern that matches no stored grant is an error; the two `information_schema` grant views; a catalog-wide grant appears only in `role_table_grants`; revoking it removes the per-topic grants | oxla `src/access_control/grant_revoke.cpp`, `src/metastore/information_schema_role_table_grants.cpp`, `src/metastore/information_schema_role_external_relation_grants.cpp`, `tests/blackbox/pit/kafka/test_redpanda_source_grants.py` (`test_revoke_metadata_grant_cascades_to_external_relation_grants`); cloud-docs `manage-access.adoc` | `narrow-wildcard-grant-by-reading-stored-grants`, `acl-locked-user-still-has-wildcard-sql-grant` |
| Before granting `SELECT` on a view, check what it exposes: a view runs with its owner's privileges; its definition is in `pg_views` (verified 2026-10-30) | cloud-docs `modules/reference/pages/sql/sql-statements/{create-view,grant}.adoc`, `modules/sql/pages/query-data/tables-and-views.adoc`, `modules/reference/pages/sql/system-catalogs/catalogs/pg_views.adoc` | `grant-on-view-exposes-what-it-returns` |

## Traps checked and not added

Behavior traps from the full skill that were tested for a "How to work" line. The baseline
already handles each, so the skill carries no line for it.

- **Kafka ACLs do not gate SQL reads; `GRANT` and `REVOKE` are the boundary.** In
  `acl-locked-user-still-has-wildcard-sql-grant` the baseline said 3/3 (2026-11-03) that Kafka
  ACLs do not limit SQL reads. It failed the case only because it never found the stored
  wildcard grant, which the "Read the stored grants" line covers (skill arm 3/3).
- **A quoted `COPY TO` file path is written on the engine's side; use `STDOUT` for a local
  file.** Probe query: "Export last week's rows from the orders table in Redpanda SQL (our
  Redpanda Cloud cluster) to a CSV with a header at /Users/dana/exports/orders_last_week.csv on
  my laptop", with a mocked `run_sql` that runs psql on the laptop and answers a quoted-path
  `COPY TO` with a row count. The baseline used psql's `\copy` 3/3 (2026-11-03), so the case
  was not kept. Source: oxla `src/sqlparser/bison_parser/bison_parser.y` (`file_path_export`),
  `src/query_planner/visitors/resolve/export_to_file.cpp`; cloud-docs
  `modules/reference/pages/sql/sql-statements/copy-to.adoc`.

## Other claims in SKILL.md

| Claim | Source |
|---|---|
| Read-only engine; topics mapped through catalogs; no `INSERT` or `COPY FROM` | cloud-docs `modules/reference/pages/sql/sql-statements/index.adoc` |
| Connection details come from the **SQL** tab of **How to connect** | cloud-docs `modules/sql/pages/get-started/sql-quickstart.adoc`, `modules/sql/pages/connect-to-sql/authenticate.adoc` |
| Docs URLs | served at https://docs.redpanda.com/cloud-data-platform/ from cloud-docs |
| When the Docs MCP server refuses for quota and no page fetch is possible, tell the user to sign in through `/mcp` rather than answering from memory | `skills/redpanda-docs/references/SOURCES.md` (anonymous quota row) |

## Docs gaps reported (not skill claims; do not re-verify here)

Found by the evals and handed to the docs team. They live in the docs once fixed, never in
the skill.

- Grants survive when a user's SQL role is removed and reassigned (cloudv2 `user_sync_db.go`
  `opRevoke`, `repairExistingUser`).
- The GRANT page says `SELECT` on a view needs no grant on the tables it reads, but does not
  repeat the CREATE VIEW page's warning that the grantee reads everything the view returns.
  (The fact is published on CREATE VIEW; the skill keeps only the behavior of checking before
  granting.)
- `sql-data-types/{timestamp-with-time-zone,bytea,uuid,array}.adoc` understate the engine's
  behavior (session time zone rendering, `bytea` comparisons, `uuid` compared with a string
  literal, the `GROUP BY` error on arrays).
