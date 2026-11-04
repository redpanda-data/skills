# sql-debugging Skill Source Map

Maps each file in `skills/sql-debugging/` to the published Redpanda Cloud docs it
derives from.

**Scope gate: the published Redpanda Cloud docs; the engine source is used only to
confirm behavior of documented surfaces, never to add undocumented ones.** The skill
serves Redpanda Cloud users only: anything a user cannot reach from the SQL endpoint,
the Cloud Console, the Cloud API, or Redpanda Support (engine admin API, raw metrics
endpoint, node logs, engine config, env vars, memory settings) is out of scope.

Read the docs from the local clones without checking them out:
`git -C <cloud-docs clone> show origin/main:<path>` (private repo
`redpanda-data/cloud-docs`) and, for single-sourced and rpk pages,
`git -C <docs clone> show origin/main:<path>` (private repo `redpanda-data/docs`;
honor the `env-cloud` conditionals). Live site:
https://docs.redpanda.com/cloud-data-platform/.

## File-to-source table

| Skill file | Published sources |
|---|---|
| `SKILL.md` | cloud-docs `modules/reference/pages/sql/system-virtual-tables.adoc`; `modules/reference/pages/sql/sql-statements/{show-nodes,show-queries,show-execs}.adoc`; `modules/sql/pages/manage/manage-access.adoc` (*SQL: Manage* = superuser); `modules/sql/pages/troubleshoot/{degraded-state-handling,query-out-of-memory}.adoc`; `modules/sql/pages/get-started/{sql-quickstart,deploy-sql-cluster}.adoc` (connection string, *Redpanda SQL* card); `modules/sql/pages/connect-to-sql/authenticate.adoc`; docs `modules/reference/partials/rpk-sql/rpk-sql-debug-bundle.adoc` (Support-run bundle) |
| `references/system-tables.md` | cloud-docs `modules/reference/pages/sql/system-virtual-tables.adoc` (column names, types, visibility); `modules/reference/pages/sql/sql-statements/{show-nodes,show-queries,show-execs,show-tables,show-catalogs,describe}.adoc`; `modules/sql/pages/troubleshoot/degraded-state-handling.adoc` (`SHOW NODES` readiness requirement); `modules/reference/pages/sql/sql-data-types/time-type/time-operators.adoc` (`TIMESTAMP - TIMESTAMP`) |
| `references/troubleshooting.md` | cloud-docs `modules/sql/pages/troubleshoot/{degraded-state-handling,query-out-of-memory}.adoc`; `modules/reference/pages/sql/sql-statements/explain.adoc` (planning-time step in Playbook 2); `modules/sql/pages/connect-to-sql/authenticate.adoc`; `modules/sql/pages/get-started/{sql-quickstart,deploy-sql-cluster}.adoc`; `modules/sql/pages/manage/manage-access.adoc`; `modules/sql/pages/query-data/query-streaming-topics.adoc`; `modules/reference/pages/sql/sql-statements/{create-table,set-show,grant,revoke,show-tables,describe}.adoc`; `modules/reference/pages/sql/system-virtual-tables.adoc` (`system.kafka_sources`); docs `modules/reference/partials/rpk-sql/rpk-sql-debug-bundle.adoc` |
| `references/redpanda-iceberg-source.md` | cloud-docs `modules/sql/pages/query-data/query-iceberg-topics.adoc`; `modules/manage/pages/iceberg/{about-iceberg-topics,iceberg-troubleshooting}.adoc` (single-sourced from docs `modules/manage/pages/iceberg/`, Cloud rendering); `modules/reference/pages/properties/{cluster-properties,topic-properties}.adoc` (only properties in the `redpanda-cloud` tag of docs `modules/reference/partials/properties/cluster-properties.adoc` and the `category-iceberg-integration` tag of `topic-properties.adoc`); `modules/manage/pages/monitor-cloud.adoc` (broker metrics endpoint); `modules/reference/pages/sql/system-virtual-tables.adoc` (`system.kafka_connections`) |

## Deferred to live introspection (not drift)

- Property defaults: the Cloud reference shows "Available in the Redpanda Cloud
  Console" for Iceberg defaults. Do not pin them.
- System-table rows and `state` value strings: runtime; read them live.
- Engine version, node count, sizing: Cloud Console and `SHOW NODES`.

## Re-verify on each sync

- The published statement list (`modules/reference/pages/sql/sql-statements/`). `EXPLAIN`
  joined it on 2026-10-23; the statement itself is documented by `/redpanda:sql`, and
  this skill only uses `EXPLAIN TIMING`/`EXPLAIN CONFIG` as a triage step. The
  planner options `EXPLAIN CONFIG` lists are runtime output: never enumerate them.
- The `SET`/`SHOW` option list in `set-show.adoc`; only listed options are used.
- Connection strings follow `authenticate.adoc` (`host=<sql-host> port=<sql-port>`),
  matching the sibling SQL skills; the quickstart and enable pages use
  `<sql-external-endpoint> port=5432` instead.
- Only functions and operators on the published reference are used in examples
  (`EXTRACT(EPOCH ...)` is not documented, so phase waits are shown as
  `TIMESTAMP - TIMESTAMP` intervals and queries are ordered by `created`).
- Whether `query-out-of-memory.adoc` still tells users to read engine Prometheus
  metrics; the skill omits that because the engine metrics endpoint is not
  user-reachable.
