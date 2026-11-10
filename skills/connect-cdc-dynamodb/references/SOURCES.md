# connect-cdc-dynamodb Skill Source Map

Maps each claim in `skills/connect-cdc-dynamodb/SKILL.md` to the source it derives from, so syncs
and human maintainers know where to verify it. The skill is thin: it keeps only the "How to
work" lines below, each backed by a behavioral eval case in
`evals/suites/connect-cdc-dynamodb.eval.json`, and sends the agent to the docs for everything
else. This file maps only the claims the skill still makes.

The `aws_dynamodb_cdc` input is Go source in the **public** repo `redpanda-data/connect` under
`internal/impl/aws/dynamodb/`. Its reference page is generated from the Go config spec into
`redpanda-data/rp-connect-docs` (`modules/components/pages/inputs/aws_dynamodb_cdc.adoc`, with
descriptions from `docs-data/overrides.json`), and published at
https://docs.redpanda.com/connect/components/inputs/aws_dynamodb_cdc/. Read source with
`gh api repos/redpanda-data/connect/contents/internal/impl/aws/dynamodb/<path>?ref=<tag>`.
Verified against tag `v4.117.0` on 2026-11-10.

## How to work: line, source, eval case

Pass rates are baseline / skill / installed, 3 runs each, recorded 2026-11-10.

| How to work line | Source (`redpanda-data/connect`) | Eval case |
|---|---|---|
| Ask before changing or removing `checkpoint_namespace`: a new or empty namespace has no checkpoints, so the pipeline starts from `start_from`, skipping unread changes under `latest` or replaying the 24-hour stream under `trim_horizon`. Baseline 0/3, skill 3/3, installed 3/3. | `input_cdc.go` (`checkpoint_namespace` and `start_from` field descriptions, Checkpointing section of the input description) | `namespace-rename-resets-position` |
| Never set `auto_replay_nacks: false` to save memory unless the user accepts losing data: rejected messages are then deleted. Safety guardrail (data loss): the baseline passed its case 3/3 on 2026-11-10 (skill 3/3, installed 3/3), and the line and case stay as a regression guard. | `input_cdc.go` (`service.NewAutoRetryNacksToggleField()`; the snapshot ack comment calls disabling it "a documented opt-in to DROP rejected messages"); the field description comes from `redpanda-data/benthos` `public/service` | `memory-tuning-keep-nack-replay` |

## Other claims in SKILL.md

| Claim | Source (`redpanda-data/connect`) |
|---|---|
| Redpanda classifies the input as an Enterprise connector | `internal/plugins/info.csv` (`aws_dynamodb_cdc` row, support level `enterprise`); `input_cdc.go` carries the Enterprise-file header under the Redpanda Community License. The input has no runtime license check (no `license.CheckRunningEnterprise` call), so the skill does not say a license is enforced |
| Reads DynamoDB Streams, optional Scan snapshot, checkpoint table | `input_cdc.go` (input description), `snapshot.go`, `checkpoint.go` |
| `get_connect_component` looks up `aws_dynamodb_cdc` and its fields | Live `tools/list` from `https://docs.redpanda.com/mcp` (see `skills/redpanda-docs/references/SOURCES.md`) |
| When the Docs MCP server refuses for quota and no page fetch is possible, tell the user to sign in through `/mcp` rather than answering from memory | `skills/redpanda-docs/references/SOURCES.md` (anonymous quota row) |

## Docs gaps reported (not skill claims; do not re-verify here)

The reference page is generated from the component spec, so each gap is a spec fix in
`internal/impl/aws/dynamodb/input_cdc.go`, not an `rp-connect-docs` edit. Checked against the
published page on 2026-11-10.

- **Tag discovery always counts as multi-table for snapshots.** Any `snapshot_mode` other than
  `none` with `table_discovery_mode: tag` is rejected at startup, even if the filter matches one
  table; `includelist` with exactly one table is allowed. The page says only "Snapshots are
  supported only when streaming from a single table." Source: `validateDynamoDBCDCConfig`
  (`isMultiTable`). Fix: the Snapshots section of the input description and the `snapshot_mode`
  field description. Case `tag-mode-snapshot-single-match` (docs 0/3).
- **`snapshot_and_cdc` re-runs the snapshot when checkpoints are stale.** After a completed
  snapshot, if a stored shard checkpoint points at trimmed stream data, the input re-runs the full
  snapshot rather than resuming at `TRIM_HORIZON`. The page's Checkpointing section says only that
  a trimmed checkpoint resumes from `TRIM_HORIZON` with a warning, which agents apply to
  `snapshot_and_cdc` too. Source: `connectWithSnapshot` and `isCDCCheckpointStale`. Fix: the
  Checkpointing or Snapshots section of the input description. Case
  `snapshot-and-cdc-after-long-outage` (docs 0/3, both 0/3).
- **Snapshot records do not set `dynamodb_shard_id`, `dynamodb_sequence_number`, or
  `dynamodb_approximate_creation_time`.** The page's Metadata section says they are "empty for
  snapshot records", so an agent compares them with `""`, which never matches. Snapshot records
  set `dynamodb_event_name` (`READ`), `dynamodb_table`, and `dynamodb_snapshot_segment`, which the
  Metadata section does not list. Source: the snapshot message construction in `input_cdc.go`
  (only those three `MetaSetMut` calls). Fix: the Metadata section of the input description. Case
  `snapshot-record-shard-id-absent` (docs 0/3).
- **Tag discovery IAM.** Discovery calls `ListTables`, then `DescribeTable` and
  `ListTagsOfResource` on every table it lists, so those actions need every table in the region,
  not only the tables that match. The page does not list the permissions tag discovery needs.
  Source: the tag discovery loop in `input_cdc.go` (`ListTables`, `DescribeTable`,
  `ListTagsOfResource`). Fix: the Table discovery modes section of the input description. Case
  `tag-mode-describe-every-table` (all arms 0/3 to 1/3).

## Lines removed for lack of a failing baseline

These behavioral cases stay in the suite, but the skill has no line for them, because the
baseline passed (2026-11-10):

- A second pipeline on the same stream needs its own `checkpoint_namespace` or `checkpoint_table`,
  and the first pipeline's checkpoint settings stay unchanged. Case
  `second-pipeline-own-checkpoints`: baseline 3/3, skill 3/3, installed 3/3. Arguably a data-loss
  guardrail (shared checkpoints skip or duplicate events), but not kept as one.
- Snapshot several tables with one single-table input each, never one input with several tables
  and a snapshot mode. Case `multi-table-backfill-split`: baseline 3/3, skill 3/3, installed 3/3.

## TODO / re-verify

- **Status:** the source registers the input as `Stable()`. Check that the published page's
  status matches.
- **`auto_replay_nacks: false` on the CDC shard path:** whether a nack pins or advances the shard
  checkpoint was flagged as contradictory at v4.106.0 (release notes vs a source comment). The
  skill no longer states either; the guardrail holds whichever is true. Needs Connect-team
  confirmation before any docs change.
