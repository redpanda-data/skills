# connect-cdc-salesforce Skill Source Map

Maps each claim in `skills/connect-cdc-salesforce/SKILL.md` to the source it derives from, so
syncs and human maintainers know where to verify it. The skill is thin: it keeps only the "How to
work" procedures below, each backed by a behavioral eval case in
`evals/suites/connect-cdc-salesforce.eval.json`, and sends the agent to the docs for everything
else. This file maps only the claims the skill still makes.

The `salesforce_cdc` input is Go source in the **public** repo `redpanda-data/connect` under
`internal/impl/salesforce/`. Its reference page is generated from the Go config spec into the
**private** repo `redpanda-data/rp-connect-docs` (`modules/components/pages/inputs/salesforce_cdc.adoc`,
with descriptions from `docs-data/overrides.json`), and published at
https://docs.redpanda.com/connect/components/inputs/salesforce_cdc/. Read source with
`gh api repos/redpanda-data/connect/contents/internal/impl/salesforce/<path>?ref=<tag>`. Verified
against tag `v4.117.0` on 2026-11-10.

## How to work: line, source, eval case

Pass rates are baseline / skill / installed, 3 runs each, 2026-11-10. The baseline rate is from
the full suite run; the skill and installed rates are from re-runs on the thin skill.

| How to work line | Source (`redpanda-data/connect`) | Eval case |
|---|---|---|
| Never delete, reset, or rewrite a running pipeline's checkpoint, or change its `checkpoint_cache_key`, without asking: each topic then resubscribes from `replay_preset` and with `latest` skips the changes in between. Keep the checkpoint when a topic stopped on an undecodable event; backfill a later-added sObject with a separate one-off pipeline, because the snapshot runs once per checkpoint. Safety guardrail (data loss): the baseline passed `backfill-added-sobject-keep-checkpoint` 3/3 and `terminal-topic-failure-keep-checkpoint` 2/3 (one baseline run overwrote the checkpoint with `SET`); the line and both cases stay as regression guards. | `input_salesforce_cdc.go` (`executorState`, `loadState`, `saveStateLocked`; `runSnapshotIfNeeded` returns early when `SnapshotComplete`; `handleStreamErr` returns early on `salesforcegrpc.TerminalStreamError`; `replay_preset` description), `salesforcegrpc/subscription.go` (`connect` uses a custom replay when a replay ID is stored; `failDecode`, `failTerminal`, `maxDeterministicPositionFailures`), `input_salesforce.go` (one-off SOQL input) | `backfill-added-sobject-keep-checkpoint` (baseline 3/3, skill 3/3, installed 3/3), `terminal-topic-failure-keep-checkpoint` (baseline 2/3, skill 3/3, installed 3/3) |
| Give each `salesforce_cdc` input its own `checkpoint_cache_key` when inputs share a cache; set the new input's key, not the running one's | `input_salesforce_cdc.go` (`checkpoint_cache_key` field, `Default("salesforce_cdc")`; `saveStateLocked` writes the whole state document under that key) | `second-input-own-checkpoint-key` (baseline 0/3, skill 2/2 with 1 errored run, installed 3/3) |
| With the firehose, set `stream_snapshot: false` unless the user asked for existing records: the snapshot is on by default and with the firehose reads every queryable sObject in the org | `input_salesforce_cdc.go` (`stream_snapshot` `Default(true)`; `snapshotSObjects` returns no filter for `/data/ChangeEvents`, so `SetRestObjects` is not called), `salesforcehttp/client.go` (`loadSObjectList` keeps every `Queryable` sObject not in the skip list when no filter is set) | `firehose-without-org-snapshot` (baseline 0/3, skill 3/3, installed 3/3) |

## Other claims in SKILL.md

| Claim | Source (`redpanda-data/connect`) |
|---|---|
| Enterprise connector, license required | `input_salesforce_cdc.go` (`license.CheckRunningEnterprise` in `newSalesforceCDCInput`; file is under the Redpanda Community License), `internal/license/shared_service.go` (error text) |
| Pub/Sub API streaming, optional REST snapshot, replay positions kept in a cache resource (intro) | `input_salesforce_cdc.go` (component summary and description) |
| `get_connect_component` looks up `salesforce_cdc` and its fields | Live `tools/list` from `https://docs.redpanda.com/mcp` (see `skills/redpanda-docs/references/SOURCES.md`) |
| When the Docs MCP server refuses for quota and no page fetch is possible, tell the user to sign in through `/mcp` rather than answering from memory | `skills/redpanda-docs/references/SOURCES.md` (anonymous quota row) |

## Docs gaps reported (not skill claims; do not re-verify here)

The reference page is generated from the connector spec, so each fix belongs in the spec in
`redpanda-data/connect`, not in rp-connect-docs. Checked against the published page on
2026-11-10.

- **Snapshot rows have no `topic` or `replay_id`.** The Metadata section says "Every emitted
  message has: `topic`". Rows read by the snapshot carry only `sobject` and `operation`
  (`read`). Spec fix: the `== Metadata` section of the component description in
  `internal/impl/salesforce/input_salesforce_cdc.go`. Source: `eventToMessage` (sets `topic` and
  `replay_id` only for Pub/Sub events), `runSnapshot` (sets `operation`), and
  `salesforcehttp/client.go` `GetNextBatchParallel` (sets only `sobject`). Case
  `snapshot-rows-metadata`: docs arm 0/3.
- **A stored replay ID that Salesforce rejects is cleared automatically.** The page does not say
  that when Salesforce rejects a stored replay ID (gRPC `InvalidArgument`, for example after an
  outage longer than retention), the connector deletes it, logs a warning, and resubscribes from
  `replay_preset`, so with `latest` the changes from the gap are not delivered and the pipeline
  does not fail. Spec fix: the `replay_preset` field description in `input_salesforce_cdc.go`.
  Source: `handleStreamErr`. Case `stale-replay-id-after-long-outage`: docs arm 0/3.
- **With the firehose, the snapshot reads every queryable sObject in the org.** The
  `stream_snapshot` description says it snapshots "every CDC sObject in `topics`". With
  `/data/ChangeEvents` no filter is set, so the snapshot pages through every queryable sObject in
  the org (minus a fixed skip list), not only the CDC-enabled ones. Spec fix: the
  `stream_snapshot` field description in `input_salesforce_cdc.go`. Source: `snapshotSObjects`
  and `Connect` (no `SetRestObjects` call for the firehose), `salesforcehttp/client.go`
  `loadSObjectList`. Case `firehose-snapshot-scope`: docs arm 0/3.
- **A full `grpc.buffer_size` buffer applies backpressure.** The field says only "Size of the
  internal gRPC event receive buffer." It does not say that a full buffer blocks the receive
  loop rather than dropping events. Spec fix: `buffer_size` in `grpcFieldSpec` in
  `internal/impl/salesforce/config.go`. Source: `salesforcegrpc/subscription.go` (blocking send
  to `eventBuffer`). Case `buffer-full-behavior`: docs arm 1/3 (the baseline passed 3/3, so the
  case is uninformative about the skill, but the page still lacks the fact).

## Lines removed for lack of a failing baseline

The full skill was mostly facts, which the evals left to the docs. Two procedures had their own
behavioral or fact case and get no separate line, because the baseline already handled them:

- Backfill an sObject added to `topics` later without resetting the checkpoint:
  `backfill-added-sobject-keep-checkpoint` baseline 3/3 and `added-sobject-not-snapshotted`
  baseline 3/3. It survives only as one clause of the checkpoint guardrail above.
- Re-read history by changing `replay_preset` on a pipeline that already has a checkpoint:
  `replay-preset-ignored-with-checkpoint` baseline 3/3.

Facts the docs cover (docs arm at least 2/3): `reconnect-max-attempts-scope`,
`undecodable-event-stops-topic`, `license-required`, `snapshot-page-size-limits`,
`two-inputs-one-cache`, `firehose-plus-object-channel`, `default-batch-of-one`. The broker-side
enterprise features the full skill listed for the destination topics (Iceberg Topics, Tiered
Storage, Cloud Topics, Schema ID Validation) are Redpanda facts in the Redpanda docs; the thin
skill does not restate them. Salesforce org setup (Connected App, Change Data Capture, Platform
Events) is Salesforce product behavior, covered by the published page's Authentication and
Prerequisites sections and by Salesforce's own docs.

## TODO / re-verify

- None open. The pre-thin TODOs (line-number citations, `docs/` path prefixes, broker
  enterprise property values) were about claims the thin skill no longer makes.
