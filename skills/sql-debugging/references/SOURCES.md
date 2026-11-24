# sql-debugging Skill Source Map

Scope gate: what a Redpanda Cloud user can diagnose in Redpanda SQL from the SQL endpoint, the
Cloud Console, and Redpanda Support. Anything a user cannot reach (engine admin API, raw
engine metrics, node logs, engine config) is out of scope. The skill is thin: it keeps only
the "How to work" procedures below, each backed by a behavioral eval case in
`evals/suites/sql-debugging.eval.json`, and sends the agent to the docs for everything else.
This file maps only the claims the skill still makes.

Read the docs from the local clones without checking them out:
`git -C <cloud-docs clone> show origin/main:<path>` (private repo
`redpanda-data/cloud-docs`) and, for single-sourced pages,
`git -C <docs clone> show origin/main:<path>` (private repo `redpanda-data/docs`; honor the
`env-cloud` conditionals). Live site: https://docs.redpanda.com/cloud-data-platform/.

## Docs that cover this skill

The 2026-11-10 eval run found the docs arm answered every sampled and targeted fact case it
was given (14 cases; 13 at 3/3, one at 2/3). These pages carry what the full skill used to:

- Troubleshoot: cloud-docs `modules/sql/pages/troubleshoot/{degraded-state-handling,query-out-of-memory}.adoc`
- Runtime and catalog tables: cloud-docs `modules/reference/pages/sql/system-virtual-tables.adoc`,
  `modules/reference/pages/sql/sql-statements/{show-nodes,show-queries,show-execs}.adoc`
- Access (*SQL: Manage* is the superuser): cloud-docs `modules/sql/pages/manage/manage-access.adoc`
- Topic mapping options: cloud-docs `modules/reference/pages/sql/sql-statements/create-table.adoc`
- Planning time: cloud-docs `modules/reference/pages/sql/sql-statements/explain.adoc`
- Iceberg-enabled topics: cloud-docs `modules/sql/pages/query-data/query-iceberg-topics.adoc`,
  `modules/manage/pages/iceberg/about-iceberg-topics.adoc` (single-sourced from docs
  `modules/manage/pages/iceberg/`), `modules/reference/pages/properties/topic-properties.adoc`

## How to work: line, source, eval case

Rates are from the eval archive run folder `sql-debugging` (3 runs per arm, 2026-11-10).

| How to work line | Source | Eval case |
|---|---|---|
| When a topic-backed table returns fewer rows than the topic holds, or decode errors, read the table's mapping in `system.kafka_sources` first; `DROP_RECORD` skips undecodable records with no error; a `FILL_NULL` mapping keeps them with the payload in `redpanda_raw`, and the `redpanda` column locates each one (verified against the engine source 2026-11-10). Baseline 0/3, skill 3/3, installed 3/3 with the thin skill (run `sql-debugging`, 2026-11-10). | cloud-docs `modules/reference/pages/sql/system-virtual-tables.adoc` (`system.kafka_sources` columns), `modules/reference/pages/sql/sql-statements/create-table.adoc` (`error_handling_policy` values, `redpanda` and `redpanda_raw` columns) | `missing-rows-traced-to-mapping-policy` |
| Before deleting an Iceberg-enabled topic, set `redpanda.iceberg.delete=false` if the history must stay; by default deleting the topic also deletes its Iceberg table (verified 2026-11-10). Safety guardrail (data loss): baseline 3/3, skill 3/3, installed 3/3 with the thin skill (run `sql-debugging`, 2026-11-10); the line and case stay as a regression guard. | redpanda `src/v/config/configuration.cc` at tag v26.2.2 (`iceberg_delete` defaults to `true`); cloud-docs `modules/manage/pages/iceberg/about-iceberg-topics.adoc` (single-sourced), `modules/reference/pages/properties/topic-properties.adoc` | `delete-iceberg-topic-keep-history` |

## Other claims in SKILL.md

| Claim | Source |
|---|---|
| Node logs, engine configuration, and engine metrics are collected by Redpanda Support, not users; a case includes the cluster ID, time window, error text, and query IDs | docs `modules/reference/partials/rpk-sql/rpk-sql-debug-bundle.adoc` (Support-run bundle); cloud-docs `modules/sql/pages/troubleshoot/query-out-of-memory.adoc` |
| `get_config_property` looks up one property; pass `platform: "cloud"` for Redpanda SQL | Live `tools/list` from `https://docs.redpanda.com/mcp` (see `skills/redpanda-docs/references/SOURCES.md`) |
| Docs URLs | served at https://docs.redpanda.com/cloud-data-platform/ from cloud-docs |
| When the Docs MCP server refuses for quota and no page fetch is possible, tell the user to sign in through `/mcp` rather than answering from memory | `skills/redpanda-docs/references/SOURCES.md` (anonymous quota row) |

## Docs gaps (not skill claims; do not re-verify here)

- Degraded State Handling
  (https://docs.redpanda.com/cloud-data-platform/sql/troubleshoot/degraded-state-handling/)
  says a permanently degraded node "requires a reboot" but not who performs it on Redpanda
  Cloud or that the user should contact Redpanda Support with the `degradation_error` text.
  In `degraded-node-escalate-not-restart` the docs arm passed 2/3 (2026-11-10); the failing
  run told the user to delete the SQL pod with kubectl. Source: cloud-docs
  `modules/sql/pages/troubleshoot/degraded-state-handling.adoc` (no escalation step). TODO
  for human review: confirm with the SQL team whether a BYOC user may restart a SQL pod
  themselves, since the full skill said users cannot and no public source confirms it.

## Lines removed for lack of a failing baseline

- "Find a stuck query in `system.queries` (which phase it waits in) and `system.execs` (memory
  per task); Redpanda SQL has no `pg_stat_activity`" was not kept. Its behavioral case,
  `stuck-queries-find-memory-holder`, passed in the baseline again on the rerun (baseline 3/3,
  skill 3/3, installed 3/3, run `sql-debugging`, 2026-11-10): when
  `pg_stat_activity` failed, the agent listed the system tables and found the query holding
  the memory.
- The fact sections of the full skill (who can see what, the runtime table columns, degraded
  nodes, query out-of-memory recovery, mapping options, Iceberg planning errors, properties,
  and metrics) were removed: the docs arm answered each sampled and targeted case about them.
  Two cases, `oom-prevention-cancel-is-different` and `iceberg-table-deleted-with-topic`, were
  uninformative (baseline 3/3).
