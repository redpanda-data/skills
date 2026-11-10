# connect-cdc-spanner Skill Source Map

Maps each claim in `skills/connect-cdc-spanner/SKILL.md` to the source it derives from, so syncs
and human maintainers know where to verify it. The skill is thin: it keeps only the "How to
work" procedures below, each backed by a behavioral eval case in
`evals/suites/connect-cdc-spanner.eval.json`, and sends the agent to the docs for everything
else. This file maps only the claims the skill still makes.

The `gcp_spanner_cdc` input is Go source in the **public** repo `redpanda-data/connect` under
`internal/impl/gcp/enterprise/` (the input and its `changestreams/` subpackage). Its reference page
is generated from the Go config spec into the **private** repo `redpanda-data/rp-connect-docs`
(`modules/components/pages/inputs/gcp_spanner_cdc.adoc`, with descriptions from
`docs-data/overrides.json`), and published at
https://docs.redpanda.com/connect/components/inputs/gcp_spanner_cdc/. Read source with
`gh api repos/redpanda-data/connect/contents/internal/impl/gcp/enterprise/<path>?ref=<tag>`.
Change stream DDL, retention, and IAM roles are Google Cloud behavior, documented at
https://cloud.google.com/spanner/docs/change-streams and https://cloud.google.com/spanner/docs/iam.
Verified against tag `v4.117.0` on 2026-11-10.

## How to work: line, source, eval case

| How to work line | Source (`redpanda-data/connect`) | Eval case |
|---|---|---|
| Give every pipeline on a stream its own `metadata_table`: the default name comes from `stream_id` alone, a second pipeline with the default shares the table and the two read each other's partitions; never drop or edit the production metadata table to replay a window | `input_spanner_cdc.go` (`defaultMetadataTableFormat = "cdc_metadata_%s"` filled from `StreamID`); `changestreams/subscriber.go` (`Run` resumes every SCHEDULED or RUNNING row from `GetInterruptedPartitions`; `detectNewPartitions` schedules rows from `GetPartitionsCreatedAfter`, whoever created them); `changestreams/metadata/metadata.go` (watermarks stored per partition row) | `replay-window-own-metadata-table` |
| Keep write and schema-change permission on the service account: the connector writes its metadata table and reissues its DDL on every start; use `roles/spanner.databaseUser` or a custom role with `spanner.databases.write` and `spanner.databases.updateDdl`; `roles/spanner.databaseReader` alone breaks the next start | `changestreams/subscriber.go` (`Setup` calls `createPartitionMetadataTableWithDatabaseAdminClient` on every start); `changestreams/metadata/metadata.go` (`UpdateDatabaseDdl` with `CREATE TABLE IF NOT EXISTS` and two `CREATE INDEX IF NOT EXISTS`; `Create`, `updatePartitionStatus`, `UpdateWatermark` write the table). Role contents: https://cloud.google.com/spanner/docs/iam (`databaseUser` has `write` and `updateDdl`; `databaseReader` has neither, checked 2026-11-10) | `least-privilege-keeps-write-and-ddl` |

Pass rates against the thin skill on 2026-11-10, 3 runs per arm, subject `claude-sonnet-5-5`, judge `claude-opus-5-5`, no errored runs. The docs arm also passes both, so the docs carry the facts; the lines stay because the baseline fails them:

| Case | baseline | skill | docs | both | installed |
|---|---|---|---|---|---|
| `replay-window-own-metadata-table` | 1/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| `least-privilege-keeps-write-and-ddl` | 1/3 | 3/3 | 3/3 | 3/3 | 3/3 |

## Other claims in SKILL.md

| Claim | Source (`redpanda-data/connect`) |
|---|---|
| Enterprise connector, license required | `input_spanner_cdc.go` (`license.CheckRunningEnterprise` in `newSpannerCDCReaderFromParsed`; file under the Redpanda Community License) |
| One message per changed row; metadata table in the same database | `input_spanner_partition_batcher.go` (one message per `Mod`); `changestreams/subscriber.go` and `changestreams/metadata/metadata.go` (table created in the stream's database) |
| `get_connect_component` looks up `gcp_spanner_cdc` and its fields | Live `tools/list` from `https://docs.redpanda.com/mcp` (see `skills/redpanda-docs/references/SOURCES.md`) |
| When the Docs MCP server refuses for quota and no page fetch is possible, tell the user to sign in through `/mcp` | `skills/redpanda-docs/references/SOURCES.md` (anonymous quota row) |

## Docs gaps reported (not skill claims; do not re-verify here)

Each is a spec fix in `internal/impl/gcp/enterprise/input_spanner_cdc.go` (the component
description or a field description), since the published page is generated from it. The page that
lacks each fact is https://docs.redpanda.com/connect/components/inputs/gcp_spanner_cdc/.

- **The connector reissues its metadata DDL on every start**, so the service account needs
  `spanner.databases.updateDdl` (and `spanner.databases.write`) for as long as the pipeline runs.
  Fix in the `metadata_table` field description or the component description. Source:
  `changestreams/subscriber.go` (`Setup`), `changestreams/metadata/metadata.go`. Case
  `ddl-permission-every-start`: docs 0/3.
- **The PostgreSQL dialect is detected automatically**; no setting is needed. Fix in the component
  description. Source: `changestreams/subscriber.go` (`detectDialect`), `changestreams/dialect.go`.
  Case `postgresql-dialect-no-config`: docs 0/3.
- **The connector creates two indexes on the metadata table with fixed names**
  (`WatermarkIdx_<database_id>_<suffix>` and `CreatedAtIdx_<database_id>_<suffix>`, the suffix a hash
  of the database id and table name). A pre-created table with other index names gets these two once,
  and later starts are no-ops. Fix in the `metadata_table` field description. Source:
  `changestreams/metadata/name.go` (`deterministicSuffix`, `TableNamesFromExistingTable`),
  `changestreams/metadata/metadata.go`. Case `precreated-metadata-index-names`: docs 1/3.
- **Finished partition rows expire a day after they finish** (GoogleSQL
  `ROW DELETION POLICY (OLDER_THAN(FinishedAt, INTERVAL 1 DAY))`, PostgreSQL
  `TTL INTERVAL '1 days' ON "FinishedAt"`), so the table needs no cleanup job. Fix in the
  `metadata_table` field description. Source: `changestreams/metadata/metadata.go`. Case
  `finished-partition-rows-expire`: docs 0/3.
- **A child partition is read only after all its parents finish**, so changes to one key keep
  commit order across splits and merges. Fix in the component description. Source:
  `changestreams/subscriber.go` (`waitForParentPartitionsToFinish`). Case `child-waits-for-parents`:
  docs 0/3. The thin skill does not carry this either (skill 0/3).
- **The component description misstates the message shape.** It says the payload "contains the
  change records" and the metadata has "details about the Spanner instance, database, and stream".
  The source emits one message per `Mod` (body `keys`, `new_values`, `old_values`) with metadata
  `table_name`, `mod_type`, `commit_timestamp`, `record_sequence`, `server_transaction_id`,
  `is_last_record_in_transaction_in_partition`, `value_capture_type`,
  `number_of_records_in_transaction`, `number_of_partitions_in_transaction`, `transaction_tag`, and
  `is_system_transaction`; no instance, database, or stream metadata. Source:
  `input_spanner_partition_batcher.go` (`spannerPartitionBatchIter.Iter`). Case
  `message-per-mod-payload` passed in the docs arm (3/3), so agents get the shape from elsewhere,
  but the description is wrong.

## Facts not carried in the thin skill (baseline or docs already answer them)

The full skill also covered these. The evals show the baseline or the docs already answer them, so
the thin skill leaves them out:

- Enterprise license (`spanner-cdc-license`: baseline 1/3, docs 3/3), one message per `Mod`
  (`message-per-mod-payload`: baseline 1/3, docs 3/3), inclusive `start_timestamp` and exclusive
  `end_timestamp` (`timestamp-bounds-inclusive-exclusive`: baseline 0/3, docs 3/3).
- Default metadata table name, that the change stream must already exist, heartbeats not emitted as
  messages, resume from stored watermarks after a restart, `databaseReader` not being enough, and
  case-sensitive `allowed_mod_types` values: baseline 3/3 on each (`metadata-table-default-name`,
  `change-stream-must-exist`, `heartbeat-records-not-emitted`, `restart-resumes-from-watermark`,
  `metadata-writes-need-more-than-reader`, `mod-types-case-sensitive`).
- The destination-side Enterprise features (Iceberg Topics, Tiered Storage, Cloud Topics, Remote
  Read Replicas, Shadowing, security) are Redpanda broker features documented in the Redpanda docs,
  not part of this connector.
- Metric names, metadata table columns, and pipeline examples are in the docs or the source.

## Lines removed for lack of a failing baseline

None. The full skill had no "How to work" section; its two procedures above are new and both
cases fail in the baseline.

## TODO / re-verify

- Re-run both behavioral cases monthly (`--arms baseline,installed`). Drop a line whose case the
  baseline starts to pass.
