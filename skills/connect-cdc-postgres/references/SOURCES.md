# connect-cdc-postgres Skill Source Map

Maps each claim in `skills/connect-cdc-postgres/SKILL.md` to the source it derives from, so syncs
and human maintainers know where to verify it. The skill is in the thin format: it keeps only
product-specific procedure ("How to work", each backed by a behavioral eval case), and sends the agent to the docs for everything else.

The `postgres_cdc` input is Go source in the **public** repo `redpanda-data/connect` under
`internal/impl/postgresql/`. Its reference page is generated from the Go config spec into the
**private** repo `redpanda-data/rp-connect-docs` (`modules/components/pages/inputs/postgres_cdc.adoc`,
with descriptions from `docs-data/overrides.json`), and published at
https://docs.redpanda.com/connect/components/inputs/postgres_cdc/. Read source with
`gh api repos/redpanda-data/connect/contents/internal/impl/postgresql/<path>`. Verified against
`main` on 2026-10-21.

## Claim-to-source table

| Claim in SKILL.md | Source (`redpanda-data/connect`) |
|---|---|
| Enterprise connector, license required | `internal/impl/postgresql/input_pg_stream.go` (imports `internal/license`; file is under the Redpanda Community License) |
| `pg_stream` is the deprecated former name | `input_pg_stream.go` (`MustRegisterBatchInput("pg_stream", ...).Deprecated()`) |
| Publication `pglog_stream_<slot_name>` | `pglogicalstream/logical_stream.go` (`pubName := "pglog_stream_" + config.ReplicationSlotName`, `publication_names` plugin arg) |
| `<slot_name>_tmp` during `stream_snapshot` | `pglogicalstream/logical_stream.go` (`stream.slotName+"_tmp"`, copied then dropped after the snapshot is acked) |
| `stream_snapshot` runs only when the slot does not exist | `pglogicalstream/logical_stream.go` (existing-slot branch resumes from `confirmed_flush_lsn` and returns before the snapshotter), `input_pg_stream.go` (input description) |
| `snapshot-execute` signal, `{"tables": [...]}` without schema prefix | `internal/replication/signalling.go` (`SnapshotSignalType`), `input_pg_stream.go` (`signal_table_name` description and example) |
| `incremental_snapshot` exclusive with `stream_snapshot`; needs `signal_table_name`, `checkpoint_cache`, non-zero top-level `heartbeat_interval` | `internal/impl/postgresql/config.go` (`parseIncrementalSnapshotCfg`) |
| Signal rejection checks: table replicated, primary key, rejected key types (`bytea`, `interval`, `bit`, `varbit`, range `r` and multirange `m` typtype), partitioned without `publish_via_partition_root` | `pglogicalstream/incremental_snapshot.go` (`incrementalPKColumns`, `checkKeyTypesBindable`, `checkDedupReachable`, `warnUndedupableTables`); `input_pg_stream.go` (`incremental_snapshot.enabled` description) |
| `REPLICA IDENTITY FULL` for TOASTable columns during a backfill | `pglogicalstream/incremental_snapshot.go` (`warnToastFidelity`) |
| Re-read a finished table by changing or clearing `checkpoint_cache_key` | `input_pg_stream.go` (`incremental_snapshot.checkpoint_cache_key` and `signal_table_name` descriptions) |
| Heartbeat prefix `redpanda_connect_<slot_name>` (`pg_logical_emit_message`) | `pglogicalstream/logical_stream.go` (`prefix := "redpanda_connect_" + stream.slotName`, `newHeartbeat(..., `{"type":"heartbeat"}`, stream.incSnapshot.backfilling.Load)`), `pglogicalstream/heartbeat.go` (`run`) |

## TODO / re-verify

- The heartbeat prefix and payload (`redpanda_connect_<slot_name>`, `{"type":"heartbeat"}`) are not
  on the published page (eval case `foreign-logical-messages`). The fix belongs in the connect field
  description for `heartbeat_interval`; the skill keeps the prefix only inside the per-slot mapping
  procedure (behavioral case `heartbeat-prefix-per-slot`).
- Dropped from the skill because no behavioral case backs them yet, though they are verified and
  absent from or understated in the docs: the connector reconciles the publication's table list to
  `tables` on every start (`pglogicalstream/pglogrepl.go` `CreatePublication`), so a table added by
  hand is removed at restart; a top-level `heartbeat_interval: 0s` is rejected at startup with
  incremental snapshots (`config.go`; case `incremental-snapshot-zero-heartbeat`, docs 2 of 3).
- The published prerequisites say "PostgreSQL version 14 or later", while `stream_snapshot` needs
  only PostgreSQL 12 for `pg_copy_logical_replication_slot` (`pglogicalstream/pglogrepl.go`) and the
  code branches on versions below 13. Whether 14 is support policy or a docs error is a product
  decision. Flag for a human.
