# connect-cdc-postgres Skill Source Map

Maps each claim in `skills/connect-cdc-postgres/SKILL.md` to the source it derives from, so syncs
and human maintainers know where to verify it. The skill is thin: it keeps only the "How to
work" procedures below, each backed by a behavioral eval case in
`evals/suites/connect-cdc-postgres.eval.json`, and sends the agent to the docs for everything
else. This file maps only the claims the skill still makes.

The `postgres_cdc` input is Go source in the **public** repo `redpanda-data/connect` under
`internal/impl/postgresql/`. Its reference page is generated from the Go config spec into the
**private** repo `redpanda-data/rp-connect-docs` (`modules/components/pages/inputs/postgres_cdc.adoc`,
with descriptions from `docs-data/overrides.json`), and published at
https://docs.redpanda.com/connect/components/inputs/postgres_cdc/. Read source with
`gh api repos/redpanda-data/connect/contents/internal/impl/postgresql/<path>`. Verified against
`main` on 2026-10-21.

## How to work: line, source, eval case

| How to work line | Source (`redpanda-data/connect`) | Eval case |
|---|---|---|
| Backfill with a signal, never by dropping the slot: `stream_snapshot` runs only when the slot does not exist; the `snapshot-execute` signal with `{"tables": [...]}` and no schema prefix; incremental snapshots are incompatible with `stream_snapshot` | `pglogicalstream/logical_stream.go` (existing-slot branch resumes from `confirmed_flush_lsn` and returns before the snapshotter), `input_pg_stream.go` (input description); `internal/replication/signalling.go` (`SnapshotSignalType`), `input_pg_stream.go` (`signal_table_name` description and example); `internal/impl/postgresql/config.go` (`parseIncrementalSnapshotCfg`) | `backfill-table-via-signal-not-slot-drop` |
| Before signaling, or when a signal was rejected, check the table in order: in `tables`, primary key without a rejected key type, `publish_via_partition_root` on `pglog_stream_<slot_name>` for a partitioned table, `REPLICA IDENTITY FULL` for TOASTable columns; a finished table is re-read by changing or clearing `checkpoint_cache_key` | `pglogicalstream/incremental_snapshot.go` (`incrementalPKColumns`, `checkKeyTypesBindable`, `checkDedupReachable`, `warnUndedupableTables`); `input_pg_stream.go` (`incremental_snapshot.enabled` description); `pglogicalstream/logical_stream.go` (`pubName := "pglog_stream_" + config.ReplicationSlotName`, `publication_names` plugin arg); `pglogicalstream/incremental_snapshot.go` (`warnToastFidelity`); `input_pg_stream.go` (`incremental_snapshot.checkpoint_cache_key` and `signal_table_name` descriptions) | `rejected-backfill-check-key-type` |
| Choose `batch_transactions` or a `batching` policy, never both (verified 2026-10-27) | `input_pg_stream.go` (`resolveBatchingPolicy` error "batch_transactions cannot be combined with a batching policy", field `Version("4.115.0")`). Published in the field description on the postgres_cdc page | `batch-transactions-without-batching-policy` |

## Other claims in SKILL.md

| Claim | Source (`redpanda-data/connect`) |
|---|---|
| Enterprise connector, license required | `internal/impl/postgresql/input_pg_stream.go` (imports `internal/license`; file is under the Redpanda Community License) |
| `pg_stream` is the deprecated former name (frontmatter description) | `input_pg_stream.go` (`MustRegisterBatchInput("pg_stream", ...).Deprecated()`) |
| `get_connect_component` looks up `postgres_cdc` and its fields | Live `tools/list` from `https://docs.redpanda.com/mcp` (checked 2026-10-30; see `skills/redpanda-docs/references/SOURCES.md`) |

## Docs gaps reported (not skill claims; do not re-verify here)

- The heartbeat message prefix and payload (`redpanda_connect_<slot_name>`,
  `{"type":"heartbeat"}`, from `pglogicalstream/logical_stream.go`) are not on the published
  page. The fix belongs in the connect field description for `heartbeat_interval`. The suite
  still carries the behavioral case `heartbeat-prefix-per-slot` (baseline fails, docs fail),
  but the skill has no line for it; it stays a docs gap.
- The connector reconciles the publication's table list to `tables` on every start
  (`pglogicalstream/pglogrepl.go` `CreatePublication`), and a top-level
  `heartbeat_interval: 0s` is rejected at startup with incremental snapshots (`config.go`).

## TODO / re-verify

- The published prerequisites say "PostgreSQL version 14 or later", while `stream_snapshot` needs
  only PostgreSQL 12 for `pg_copy_logical_replication_slot` (`pglogicalstream/pglogrepl.go`) and the
  code branches on versions below 13. Whether 14 is support policy or a docs error is a product
  decision. Flag for a human.
