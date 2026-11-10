# connect-cdc-oracle Skill Source Map

Maps each claim in `skills/connect-cdc-oracle/SKILL.md` to the source it derives from, so syncs
and human maintainers know where to verify it. The skill is thin: it keeps only the "How to
work" procedures below, each backed by a behavioral eval case in
`evals/suites/connect-cdc-oracle.eval.json`, and sends the agent to the docs for everything
else. This file maps only the claims the skill still makes.

The `oracledb_cdc` input is Go source in the **public** repo `redpanda-data/connect` under
`internal/impl/oracledb/`. Its reference page is generated from the Go config spec into the
**private** repo `redpanda-data/rp-connect-docs` (`modules/components/pages/inputs/oracledb_cdc.adoc`,
with descriptions from `docs-data/overrides.json`), and published at
https://docs.redpanda.com/connect/components/inputs/oracledb_cdc/. Read source with
`gh api repos/redpanda-data/connect/contents/internal/impl/oracledb/<path>?ref=<tag>`. Verified
against tag `v4.117.0` on 2026-11-10.

## How to work: line, source, eval case

Pass rates are from the 2026-11-10 run (3 runs per arm; `docs`, `both` and `installed` for
`ora-01291-checkpoint-reset-with-snapshot` from a rerun after errored runs). The first skill and
installed rates are for the pre-thin skill; the thin rates are a rerun of the `skill` and
`installed` arms against this `SKILL.md` (one run per arm of `no-user-tables-common-user-owner`
timed out).

| How to work line | Source (`redpanda-data/connect`) | Eval case | baseline / skill / installed (pre-thin) | skill / installed (thin) |
|---|---|---|---|---|
| On ORA-01291, find the cause first; after a flashback and `OPEN RESETLOGS`, more retention cannot help, the checkpoint row must be deleted explicitly (a flashback rolls it back), and `snapshot_mode: snapshot_and_stream` must be set in the same change; confirm with the user before deleting the checkpoint. **Safety guardrail** (data loss): the baseline passed its case 3/3, and the line and case stay as a regression guard. | `logminer/logminer.go` (`errCodeMissingLogFile` message; `GetLogsBySCNRange` joins `V$ARCHIVED_LOG` to `V$DATABASE` on `RESETLOGS_CHANGE#` and `RESETLOGS_TIME`); `input_oracledb_cdc.go` (Performance section, flashback paragraph; `Connect` skips the snapshot when a cached SCN exists) | `ora-01291-checkpoint-reset-with-snapshot` | 3/3 / 3/3 / 3/3 | 3/3 / 3/3 |
| When the input finds no user tables, check the table owner first: discovery skips owners matching `C##%`, so a common user's tables cannot be captured by any config and must live in a local schema in the PDB | `replication/stream.go` (`VerifyUserTables`: `AND OWNER NOT LIKE 'C##%'`, error "no user tables found for given include and exclude filters") | `no-user-tables-common-user-owner` | 0/3 / 3/3 / 3/3 | 2/2 / 2/2 |
| When large transactions run the pipeline out of memory, use `logminer.transaction_cache` on Redis or Memcached, not `logminer.max_transaction_events`, which discards a transaction over the cap; offer the cap only with that warning. Also a data-loss guardrail. | `input_oracledb_cdc.go` (`logminer.max_transaction_events` and `logminer.transaction_cache` descriptions); `logminer/cache.go` (`InMemoryCache.AddEvent` adds the transaction to `discardedTxns` once it exceeds `maxTransactionEvents`) | `oom-large-transaction-no-event-cap` | 0/3 / 3/3 / 3/3 | 3/3 / 3/3 |

## Other claims in SKILL.md

| Claim | Source (`redpanda-data/connect`) |
|---|---|
| Enterprise connector, license required | `internal/impl/oracledb/input_oracledb_cdc.go` (`license.CheckRunningEnterprise`; file is under the Redpanda Community License), `internal/license/shared_service.go` (`errEnterpriseLicenseRequired`) |
| Reads redo through LogMiner and tracks position with an SCN checkpoint, optionally after a snapshot | `input_oracledb_cdc.go` (component description, `snapshot_mode`, `checkpoint_cache` descriptions) |
| `get_connect_component` looks up `oracledb_cdc` and its fields | Live `tools/list` from `https://docs.redpanda.com/mcp` (see `skills/redpanda-docs/references/SOURCES.md`) |
| When the Docs MCP server refuses for quota and no page fetch is possible, tell the user to sign in through `/mcp` rather than answering from memory | `skills/redpanda-docs/references/SOURCES.md` (anonymous quota row) |

## Docs gaps reported (not skill claims; do not re-verify here)

Each is fixed at source, in the connect component spec, not in rp-connect-docs. The published page
checked is https://docs.redpanda.com/connect/components/inputs/oracledb_cdc/ (2026-11-10).

- **Tables owned by `C##` common users are never captured.** The page does not say it; the
  `include` and `pdb_name` descriptions are silent. Source: `replication/stream.go`
  (`VerifyUserTables`). Spec fix: `include` or `pdb_name` description in `input_oracledb_cdc.go`.
  Case `no-user-tables-common-user-owner` (docs 0/3).
- **`window_strategy: redo_volume` rejects a non-default `scn_window_size` or
  `max_scn_window_size` at startup** (and `scn_window` rejects non-default `redo_volume_*`). The
  page says only which fields apply to which strategy. Source: `input_oracledb_cdc.go` (the
  "has no effect" errors in the config parse). Spec fix: `logminer.window_strategy` description.
  Case `cdb-quiet-pdb-window-strategy` (docs 0/3).
- **Snapshot rows of a table without a `snapshot_filters` entry arrive in no guaranteed order;
  only filtered tables are paged in primary-key order.** The page mentions the unordered cursor
  only inside the `snapshot_max_batch_size` description, and agents did not find it. Source:
  `replication/snapshot.go` (`snapshotTableFullScan`, `querySnapshotTable`). Spec fix:
  `snapshot_mode` description or the component description. Case `unfiltered-snapshot-row-order`
  (docs 0/3).
- **The `schema` metadata declares milliseconds for `DATE` and microseconds for every `TIMESTAMP`
  variant.** The page's `schema` metadata bullet does not say. Source: `schema.go`
  (`oracleTimestampLogical`). Spec fix: the `schema` bullet in the Metadata section of the
  component description. Case `schema-timestamp-units` (docs 0/3).

## Lines removed for lack of a failing baseline

- Large committed transactions arriving late: a `PREFETCH_ROWS` query parameter on
  `connection_string` overrides `prefetch_rows`. Case `late-transactions-prefetch-precedence`:
  baseline 3/3, skill 3/3, installed 3/3. Not a safety guardrail. Published in the `prefetch_rows`
  description and the Performance section.
- Fact cases the baseline already answers (no line): `added-table-no-snapshot-on-restart`,
  `include-pattern-overmatch`, `scale-capture-throughput`, `license-required` (all baseline 3/3).
- Fact cases the docs cover (docs 3/3): `snapshot-table-without-primary-key`,
  `default-checkpoint-privileges`, `identify-rows-of-bulk-delete`, `transaction-cache-backend`,
  `pdb-name-connection-service`, `ora-04036-session-age`, `snapshot-row-scn-and-commit-ts`.

## Drift found in the pre-thin skill (not carried forward)

- The pre-thin `SKILL.md` said a stale checkpoint fails with ORA-01292 and that the checkpoint
  advances only when messages are delivered. At `v4.117.0` the input's Performance section says the
  checkpoint advances about every 10 seconds, also while tables are idle (it can trail the current
  SCN by up to `logminer.min_scn_window_size`), that `batching.count` without `batching.period` can
  hold it back, and that a missing checkpointed SCN fails with ORA-01291. The thin skill makes none
  of these claims.
