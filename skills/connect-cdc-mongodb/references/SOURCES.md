# connect-cdc-mongodb Skill Source Map

Maps each claim in `skills/connect-cdc-mongodb/SKILL.md` to the source it derives from, so syncs
and human maintainers know where to verify it. The skill is thin: it keeps only the "How to work"
procedures below, each backed by a behavioral eval case in
`evals/suites/connect-cdc-mongodb.eval.json`, and sends the agent to the docs for everything else.
This file maps only the claims the skill still makes.

The `mongodb_cdc` input is Go source in the **public** repo `redpanda-data/connect` under
`internal/impl/mongodb/cdc/`, with the shared connection and `aws` block in
`internal/impl/mongodb/common.go`. Its reference page is generated from the Go config spec into the
**private** repo `redpanda-data/rp-connect-docs` (`modules/components/pages/inputs/mongodb_cdc.adoc`,
with descriptions from `docs-data/overrides.json`), and published at
https://docs.redpanda.com/connect/components/inputs/mongodb_cdc/. Read source with
`gh api repos/redpanda-data/connect/contents/internal/impl/mongodb/cdc/<file>?ref=<tag>`. Verified
against tag `v4.117.0` on 2026-11-10.

## How to work: line, source, eval case

Pass rates are baseline / skill / installed, 3 runs each, on 2026-11-10. The skill and installed
rates were measured with this thin SKILL.md.

| How to work line | Source (`redpanda-data/connect`, `internal/impl/mongodb/cdc/`) | Eval case |
|---|---|---|
| Backfill a collection with a signal, never by clearing the checkpoint: `stream_snapshot` runs only with no stored position; enabling `incremental_snapshot.enabled` with a stored position reads nothing; the signal collection must not be in `collections`; the `snapshot-execute` signal with `{collections: [...]}` works in every snapshot mode | `input.go` (input description, sections "Snapshot and streaming modes", "Incremental snapshots" and "Signals"; `parseIncrementalSnapshot` rejects a signal collection that is also streamed); `signalling.go` (`parseSnapshotCollections`, `handleSignal`); `internal/replication/signalling.go` (`SnapshotSignalType = "snapshot-execute"`) | `backfill-added-collection-via-signal` (baseline 0/3, skill 3/3, installed 3/3; docs 3/3) |
| When the stored position can no longer be resumed and no snapshot is enabled, do not set `on_unresumable_position: reset` or delete the checkpoint on your own; enable a snapshot mode or ask the user. Safety guardrail (data loss): the baseline passed its case 3/3 on 2026-11-10, and the line and case stay as a regression guard. | `input.go` (`on_unresumable_position` field description; `errUnresumableGapRefused` and the log line before it) | `unresumable-position-no-silent-reset` (baseline 3/3, skill 3/3, installed 3/3) |
| When a parallel snapshot is slow, read the logs first: the split-points warning means the input fell back to a sequential scan, and on Atlas `snapshot_auto_bucket_sharding: true` fixes it | `input.go` (`readSnapshot` logs "unable to determine split points ... falling back to sequential scan"; `getParallelRanges`, `computeSplitPoints`; `snapshot_auto_bucket_sharding` description) | `slow-atlas-snapshot-check-split-fallback` (baseline 0/3, skill 3/3 scored with 3 of 6 attempts timing out at 600s, installed 3/3; docs 3/3) |

## Other claims in SKILL.md

| Claim | Source (`redpanda-data/connect`) |
|---|---|
| Enterprise connector, license required | `internal/impl/mongodb/cdc/input.go` (`license.CheckRunningEnterprise` in `newMongoCDC`; file is under the Redpanda Community License) |
| `get_connect_component` looks up `mongodb_cdc` and its fields | Live `tools/list` from `https://docs.redpanda.com/mcp` (see `skills/redpanda-docs/references/SOURCES.md`) |
| When the Docs MCP server refuses for quota and no page fetch is possible, tell the user to sign in through `/mcp` rather than answering from memory | `skills/redpanda-docs/references/SOURCES.md` (anonymous quota row) |

## Docs gaps reported (not skill claims; do not re-verify here)

Each is fixed at source, in the `mongodb_cdc` spec in `internal/impl/mongodb/cdc/input.go`, because
the reference page is generated from it. Checked against the published page on 2026-11-10.

- **Decimal128 output.** Every Decimal128 value is emitted as a plain decimal string (for example
  `"19.90"`) in both `json_marshal_mode` values, never as `{"$numberDecimal": ...}`. The page does
  not say so. Source: `cdc/schema.go` (`normaliseDecimal128`), applied in `newMongoDBCDCMessage` in
  `input.go`. Spec fix: the `json_marshal_mode` field description. Eval case
  `decimal128-output-format` (docs 0/3, both 1/3, installed 0/3).
- **Sequential fallback when split points fail.** With `snapshot_parallelism` above 1 and no
  `snapshot_auto_bucket_sharding`, a refused `splitVector` (as on Atlas) is logged as a warning and
  the collection is read with one sequential scan; the pipeline does not fail. The page says only
  that `splitVector` is unavailable on Atlas. Source: `input.go` (`readSnapshot`). Spec fix: the
  `snapshot_parallelism` or `snapshot_auto_bucket_sharding` field description. Eval case
  `atlas-parallel-snapshot-setting` (docs 0/3).
- **`snapshot_parallelism` bounds all collections together.** One semaphore of size
  `snapshot_parallelism` is shared by every snapshot read across all collections, so with the
  default of 1 the collections are read one at a time. The field description says only "the number
  of connections". Source: `input.go` (`snapshotSemaphore`, `readSnapshotRange`). Spec fix: the
  `snapshot_parallelism` field description. Eval case `snapshot-parallelism-across-collections`
  (baseline 3/3, so not counted as evidence; listed because the pre-thin skill stated the opposite).
- **`incremental_snapshot.chunk_size` above `checkpoint_limit` is a startup error.** The field
  description says the chunk "must not exceed `checkpoint_limit`" but not that the config is
  rejected, so agents read it as a tuning hint. Source: `input.go` (`parseIncrementalSnapshot`).
  Spec fix: the `incremental_snapshot.chunk_size` field description. Eval case
  `chunk-size-above-checkpoint-limit` (docs 0/3, installed 0/3).
- **The signal collection must not be in `collections`.** The input rejects that config at
  startup. The page does not say so, and agents call the overlap harmless. Source: `input.go`
  (`parseIncrementalSnapshot`, "field signal_collection_name must not name one of the streamed
  collections"). Spec fix: the `signal_collection_name` field description. Eval case
  `signal-collection-also-streamed` (docs 0/3, installed 0/3).

Findability, not a gap: the `mongodb` processor and cache reject `aws.role`, `aws.roles` and session
tokens. The parent `aws` description on each MongoDB page says so, but the docs arm missed it 3/3
in `aws-role-mongodb-cache` because the `aws.role` and `aws.roles` field descriptions do not repeat
it. A one-line note on those fields in `AWSIAMAuthField` (`internal/impl/mongodb/common.go`) would fix it.

## Lines removed for lack of a failing baseline, or covered by the docs

The pre-thin skill carried a config reference, MongoDB setup, pipeline examples, and an Enterprise
destination section. They were removed; the docs cover them. From the 2026-11-10 run:

- Recovery after an aged-out position re-reads current state but misses deletes in the gap: baseline
  3/3 (`resnapshot-recovery-misses-deletes`).
- `aws.enabled` rejects credentials in `url`: baseline 3/3 (`aws-iam-url-credentials`).
- Schema re-inference only on a top-level field-set change, unresumable-position handling without a
  snapshot, the single change stream scaling ceiling, enabling incremental snapshots on a running
  pipeline, `parquet_encode` and the `Any` type, and incremental snapshot pace on a quiet sharded
  cluster: the docs arm passed each 3/3.
- The pre-thin claim that collections are always snapshotted concurrently regardless of
  `snapshot_parallelism` was wrong (see the docs gap above) and is gone.

## TODO / re-verify

- The skill arm of `slow-atlas-snapshot-check-split-fallback` timed out in 3 of 6 attempts with
  this thin SKILL.md (no failed answers). Check whether the subject loops on the mock before
  relying on that rate. Re-run the behavioral cases with
  `node evals/run-evals.mjs --suite connect-cdc-mongodb --arms baseline,skill,installed` after any
  change to a line.
