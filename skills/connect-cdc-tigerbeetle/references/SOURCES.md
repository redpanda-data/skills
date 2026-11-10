# connect-cdc-tigerbeetle Skill Source Map

Maps each claim in `skills/connect-cdc-tigerbeetle/SKILL.md` to the source it derives from, so
syncs and human maintainers know where to verify it. The skill is thin and carries no "How to
work" lines: no behavioral case in `evals/suites/connect-cdc-tigerbeetle.eval.json` failed in the
baseline arm, so the skill sends the agent to the docs for everything. Whether to keep a skill
with no procedures is a maintainer decision.

The `tigerbeetle_cdc` input is Go source in the **public** repo `redpanda-data/connect` at
`internal/impl/tigerbeetle/input_tigerbeetle.go` (gated `//go:build cgo`). Its reference page is
generated from the Go config spec into the **private** repo `redpanda-data/rp-connect-docs`
(`modules/components/pages/inputs/tigerbeetle_cdc.adoc`) and published at
https://docs.redpanda.com/connect/components/inputs/tigerbeetle_cdc/. The cookbook is
`modules/cookbooks/pages/tigerbeetle_cdc.adoc`, published at
https://docs.redpanda.com/connect/cookbooks/tigerbeetle_cdc/. Read source with
`gh api repos/redpanda-data/connect/contents/internal/impl/tigerbeetle/<path>`. Verified against
tag `v4.117.0` on 2026-11-10.

## Claims in SKILL.md

| Claim | Source (`redpanda-data/connect`) | Eval case |
|---|---|---|
| `tigerbeetle_cdc` streams change events, each a transfer with its debit and credit accounts | `internal/impl/tigerbeetle/input_tigerbeetle.go` (`configSpec()` description, `JsonChangeEvent`) | none |
| The source is under `internal/impl/tigerbeetle/` | `internal/impl/tigerbeetle/input_tigerbeetle.go` (`MustRegisterBatchInput("tigerbeetle_cdc", ...)`) | none |
| `get_connect_component` looks up `tigerbeetle_cdc` and its fields | Live `tools/list` from `https://docs.redpanda.com/mcp` (see `skills/redpanda-docs/references/SOURCES.md`) | none |
| When the Docs MCP server refuses for quota and no page fetch is possible, tell the user to sign in through `/mcp` rather than answering from memory | `skills/redpanda-docs/references/SOURCES.md` (anonymous quota row) | none |

## Docs gaps reported (not skill claims; do not re-verify here)

Both are spec fixes in `internal/impl/tigerbeetle/input_tigerbeetle.go`, because the reference
page is generated from it. Neither the input page nor the cookbook states them (checked
2026-11-10). The `docs` arm failed both cases 0/3 on 2026-11-10.

- The progress key is `timestamp_last_<cluster_id>` and its value is the last acknowledged
  timestamp as an 8-byte little-endian unsigned integer; any other length fails at startup.
  Source: `newTigerbeetleInput` (`timestampLastKey`), `getTimestampLast`, `setTimestampLast`.
  Fix: the `progress_cache` field description. Case: `checkpoint-value-format`.
- The input keeps one batch in flight: it holds the next batch until the current one is
  acknowledged, so output `max_in_flight` does not raise throughput and `event_count_max` sets
  the batch size. Source: `consume` ("the next batch can only be flushed when the current one
  has been acknowledged"). Fix: the component description's Guarantees section. Case:
  `throughput-single-batch-in-flight`.

## Lines removed for lack of a failing baseline

The pre-thin skill's procedures, tested as behavioral cases on 2026-11-10 (subject
`claude-sonnet-5-5`, 3 runs per arm):

- Rewind with a cleared checkpoint, not `timestamp_initial` alone: case
  `replay-from-timestamp-clear-checkpoint`, baseline 2/3, skill 2/3, docs 2/3. The baseline
  inspected the key and wrote the 8-byte value itself.
- Give a second pipeline on the same cluster its own progress state, because the key depends
  only on `cluster_id`: case `second-pipeline-separate-progress`, baseline 2/3, skill 3/3,
  docs 3/3.
- If `tigerbeetle_cdc` is not recognized, switch to the cgo-enabled binary: case
  `install-cgo-build-for-component`, baseline 2/3, skill 3/3, docs 3/3.

None of these guards against data loss, an irreversible change, or a change to network
exposure, so none stays as a safety guardrail.

Facts the docs already cover (`docs` arm 3/3 on 2026-11-10): the license tier, cgo-only builds,
the first-run start position, settled event types, and that the input is not available in
Redpanda Cloud. The Enterprise destination-topic material of the pre-thin skill (Iceberg, Tiered
Storage, Shadow Linking and so on) is not specific to this input and lives in the Redpanda docs.

## TODO / re-verify

- Status: `configSpec()` registers `Stable()`, while the cookbook says the input "is in beta. The
  API is subject to change." Which label is current is a product decision. Flag for a human.
