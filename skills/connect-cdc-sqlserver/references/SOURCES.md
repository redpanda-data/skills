# connect-cdc-sqlserver Skill Source Map

Maps each claim in `skills/connect-cdc-sqlserver/SKILL.md` to the source it derives from, so syncs
and human maintainers know where to verify it. The skill is thin: it keeps only the "How to
work" procedures below, each backed by a behavioral eval case in
`evals/suites/connect-cdc-sqlserver.eval.json`, and sends the agent to the docs for everything
else. This file maps only the claims the skill still makes.

The `microsoft_sql_server_cdc` input is Go source in the **public** repo `redpanda-data/connect`
under `internal/impl/mssqlserver/`. Its reference page is generated from the Go config spec into
the **private** repo `redpanda-data/rp-connect-docs`
(`modules/components/pages/inputs/microsoft_sql_server_cdc.adoc`, with descriptions from
`docs-data/overrides.json`), and published at
https://docs.redpanda.com/connect/components/inputs/microsoft_sql_server_cdc/. Read source with
`gh api repos/redpanda-data/connect/contents/internal/impl/mssqlserver/<path>?ref=<tag>`.
Verified against tag `v4.117.0` on 2026-11-10.

## How to work: line, source, eval case

| How to work line | Source (`redpanda-data/connect`, `internal/impl/mssqlserver/`) | Eval case |
|---|---|---|
| Give each pipeline's built-in checkpoint its own schema: the built-in cache writes one fixed row through `<schema>.CdcCheckpointCacheUpdate`, which every start re-creates over its own table, so pipelines sharing a schema overwrite each other's checkpoints; `checkpoint_cache_key` is ignored by the built-in cache; isolate with another schema, another database (`checkpoint_cache_connection_string`), or an external `checkpoint_cache`; don't move the existing pipeline's checkpoint | `checkpoint_cache.go` (`defaultCacheKey = "max_lsn"`; `Get` and `Set` ignore the key argument; `createUpsertStoredProc` runs `CREATE OR ALTER PROCEDURE [schema].[CdcCheckpointCacheUpdate]` over the configured table; `newCheckpointCache` runs it on every start), `input_mssqlserver_cdc.go` (`checkpoint_cache_key` read only when `checkpoint_cache` names a cache resource; `checkpoint_cache_connection_string` used for the built-in cache) | `second-pipeline-checkpoint-isolation` (2026-11-10: baseline 0/3; thin skill: skill 4/4, both 3/3, installed 3/3; docs 0/3) |
| Ask before disabling CDC on a table: `TRUNCATE TABLE` is rejected on a CDC-enabled table; disabling CDC drops the capture instance and change table, unread changes are lost and the pipeline fails while the change table is missing; `DELETE` streams a delete per row. Safety guardrail (irreversible loss of change data): the baseline passed its case 3/3 on 2026-11-10, and the line and case stay as a regression guard. | `input_mssqlserver_cdc.go` (Performance section, `TRUNCATE TABLE` note), `replication/stream.go` (`VerifyUserDefinedTables` needs the capture instance; `ReadChangeTables` queries `cdc.<schema>_<table>_CT`) | `truncate-cdc-table-ask-first` (2026-11-10: baseline 3/3; thin skill: skill 3/3, both 3/3, installed 3/3) |

## Other claims in SKILL.md

| Claim | Source (`redpanda-data/connect`) |
|---|---|
| Enterprise connector, license required | `internal/impl/mssqlserver/input_mssqlserver_cdc.go` (`license.CheckRunningEnterprise`; file is under the Redpanda Community License) |
| Polls the CDC change tables in LSN order and stores the last delivered LSN as a checkpoint (description and intro) | `input_mssqlserver_cdc.go` (Performance and Ordering sections, `checkpoint_cache` description), `replication/stream.go` (`ReadChangeTables`) |
| `get_connect_component` looks up `microsoft_sql_server_cdc` and its fields | Live `tools/list` from `https://docs.redpanda.com/mcp` (see `skills/redpanda-docs/references/SOURCES.md`) |
| When the Docs MCP server refuses for quota and no page fetch is possible, tell the user to sign in through `/mcp` rather than answering from memory | `skills/redpanda-docs/references/SOURCES.md` (anonymous quota row) |

## Docs gaps reported (not skill claims; do not re-verify here)

The reference page is generated from the connector spec, so each gap is a spec fix in
`redpanda-data/connect` `internal/impl/mssqlserver/input_mssqlserver_cdc.go`, not an edit to
rp-connect-docs. The published page checked is
https://docs.redpanda.com/connect/components/inputs/microsoft_sql_server_cdc/ (2026-11-10).

- **`checkpoint_cache_key`**: the description says "An alternative key can be provided if
  multiple CDC inputs share the same cache", but the built-in SQL Server cache ignores the key
  and always uses one `max_lsn` row (`checkpoint_cache.go`). Say the key applies only to an
  external `checkpoint_cache` resource. Case `checkpoint-key-ignored-by-builtin-cache`: docs 0/3,
  both 3/3.
- **`checkpoint_cache_table_name`**: does not say that the upsert procedure is named per schema
  (`<schema>.CdcCheckpointCacheUpdate`) and re-pointed at each start, so two inputs whose
  checkpoint tables share a schema overwrite each other's checkpoints. Say to use a separate
  schema per input (`checkpoint_cache.go` `createUpsertStoredProc`). Case
  `second-pipeline-checkpoint-isolation`: docs 0/3.
- **`include` and `exclude`**: do not say the patterns are matched unanchored
  (`regexp.MatchString` in `internal/confx/regexp.go`), so `dbo.orders` also matches
  `dbo.orders_archive`, and that every matched table must have a capture instance or the input
  fails at startup. Case `include-patterns-unanchored`: docs 0/3, both 3/3.
- **Snapshot primary key**: neither `stream_snapshot` nor the Permissions section says a table
  needs a primary key to be snapshotted (`replication/snapshot.go` `getTablePrimaryKeys`: "unable
  to find primary key for table ..."). Case `snapshot-needs-primary-key`: baseline 3/3, docs 0/3
  (the docs arm answered that the page is silent).
- **Capture instance name**: the page does not say the input finds a table's change table by a
  capture instance named `<schema>_<table>`, so an instance created with a custom
  `@capture_instance` is not found ("no change table found for table ..."; `replication/stream.go`
  `VerifyUserDefinedTables`). The baseline handled case `startup-no-change-table-found` 3/3, so the
  skill has no line for it.

## Lines removed: the baseline passed (2026-11-10, 3 runs per arm)

| Removed procedure | Case | baseline / skill / installed |
|---|---|---|
| After an outage, compare the checkpoint with `sys.fn_cdc_get_min_lsn` and re-snapshot by clearing the checkpoint | `outage-past-retention-resync` | 3/3 / 3/3 / 3/3 |
| On "no change table found", add a capture instance with the default `<schema>_<table>` name instead of disabling the existing one | `startup-no-change-table-found` | 3/3 / 3/3 / 4/4 |
| When changes stop with no error, check and start the CDC capture job before touching the pipeline | `silent-stall-capture-job` | 3/3 / 3/3 / 3/3 |

Every config, metadata, ordering, snapshot, permission and setup fact the full skill carried is
left to the docs. The fact cases in the suite measure coverage of a sample of them.

## Corrected while converting

The full skill had two claims that no longer matched source at `v4.117.0`: the built-in cache
table's `cache_val` column is `varbinary(10)`, not `varchar(100)`, and the table is created before
the procedure. It also said distinct `checkpoint_cache_table_name` values isolate two pipelines,
which is wrong within one schema (see the first line above). The thin skill carries none of these
facts except the corrected isolation rule.
