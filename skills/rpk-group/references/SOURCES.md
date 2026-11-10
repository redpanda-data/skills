# rpk group Skill Source Map

The skill is thin: it keeps only the "How to work" line below, backed by a behavioral eval
case in `evals/suites/rpk-group.eval.json`, and sends the agent to the docs for everything
else. This file maps only the claims the skill still makes.

Sources are the public `redpanda-data/redpanda` repo at tag `v26.2.2`. Verify against the
current stable release tag, not `dev`.

## How to work: line, source, eval case

| How to work line | Source | Eval case |
|---|---|---|
| Check what a name pattern matches before deleting groups; `rpk group delete` takes literal names, does not ask for confirmation, and drops every committed offset of the groups it deletes (verified 2026-11-10). Safety guardrail: the baseline passed its case 3/3 on 2026-11-10 (skill 3/3, installed 3/3), and the line and case stay as a regression guard. | `src/go/rpk/pkg/cli/group/group.go` (`newDeleteCommand`: `cobra.MinimumNArgs(1)`, no prompt, no regex flag), `src/v/kafka/server/group.cc` (`group::remove` tombstones the group's offsets) | `delete-groups-preview-matches` |

## Other claims in SKILL.md

| Claim | Source | Eval case |
|---|---|---|
| `get_rpk_command` looks up one rpk subcommand and `get_config_property` one cluster property | Live `tools/list` from `https://docs.redpanda.com/mcp` (the runner's expected tool list in `evals/run-evals.mjs`; see `skills/redpanda-docs/references/SOURCES.md`) | none |
| `group_offset_retention_sec` is a cluster property | `src/v/config/configuration.cc` | none |
| The rpk group reference has one page per subcommand at `/streaming/current/reference/rpk/rpk-group/rpk-group/` | https://docs.redpanda.com/streaming/current/reference/rpk/rpk-group/rpk-group/ (checked 2026-11-10) | none |
| When the Docs MCP server refuses for quota and no page fetch is possible, tell the user to sign in through `/mcp` | `skills/redpanda-docs/references/SOURCES.md` (anonymous quota row) | none |

## Docs gaps (not skill claims; do not re-verify here)

- `rpk group describe`: `--print-lag-per-topic` (`-t`) and `--print-commits` (`-c`) are mutually
  exclusive, and `-t` prints the summary and per-topic lag without the commit table, so the
  commit table and per-topic lag need two runs. The page
  https://docs.redpanda.com/streaming/current/reference/rpk/rpk-group/rpk-group-describe/ lists
  both flags but says neither (checked 2026-11-10). Source: `src/go/rpk/pkg/cli/group/describe.go`
  (`cmd.MarkFlagsMutuallyExclusive("print-lag-per-topic", "print-commits")`, and the
  `lagPerTopic` branch returns before the commits are printed). Case
  `describe-commits-with-lag-per-topic`: baseline 0/3, docs 0/3, both 3/3, installed 3/3.
- `rpk group delete`: the broker refuses to delete a group with a transaction in progress and
  returns `NON_EMPTY_GROUP`, even when the group shows `Empty` with no members. The transaction
  has to commit, abort, or time out first. The page
  https://docs.redpanda.com/streaming/current/reference/rpk/rpk-group/rpk-group-delete/ does not
  mention transactions (checked 2026-11-10). Source: `src/v/kafka/server/group.cc` (`group::remove`
  returns `non_empty_group` when `has_transactions_in_progress()`). Case
  `delete-empty-group-open-transaction`: 0/3 in every arm, baseline included, once the case's
  group name stopped hinting at a transaction.

## Drifted facts removed with the conversion

- The pre-thin skill said `rpk group seek --to-group` and `--to-file` work on a group that still
  has members. They do not: every seek mode commits with OffsetCommit as a non-member, and rpk
  reports `INVALID_OPERATION: seeking a non-empty group is not allowed.` for each partition
  (`src/go/rpk/pkg/cli/group/seek.go`). Case `seek-to-file-active-group`: the skill arm passed
  1/3 because of the wrong claim, docs 3/3.
- The pre-thin `--to-file` example lined columns up with several spaces. rpk splits each line on
  a single space (or a tab) and needs exactly three fields, so that file is rejected
  (`parseSeekFile` in `seek.go`).

## Lines removed for lack of a failing baseline

All cases were run on 2026-11-10 with 3 runs per arm (subject claude-sonnet-5-5).

- "Stop all consumers, confirm the group is Empty, and scope a rewind with `--topics` before
  `rpk group seek --to`" (the safe reset and bad-deploy playbooks). Case
  `bad-deploy-rewind-scoped-and-empty` (rewind one topic of a running group whose consumers the
  agent cannot reach): baseline 3/3, skill 3/3, installed 3/3. Without the skill, the agent scoped
  the seek to the affected topic and reported that the consumers must be stopped. Not kept as a
  safety guardrail: a seek prints the prior offsets, so it can be undone.
- "After a Shadow Linking failover, check the link's consumer offset sync group filters before
  repairing a group's offsets with `rpk group seek`." Case `shadow-failover-group-lost-position`:
  baseline 3/3, skill 3/3, installed 3/3. Without the skill, the agent ran `rpk shadow describe`
  and named the group filter as the cause.
- The sampled and targeted fact cases that the baseline already answered (seek modes, timestamps
  past the last record, `--allow-new-topics`, offset-delete rules, delete of a non-empty group,
  the DELETE ACL for offset-delete, offset clamping, `--to-file` separators, seek exit codes,
  open transactions blocking delete, empty-group offset expiry) carried facts, not procedure,
  and leave with the reference files. `seek-microsecond-timestamp` (baseline 0/3) is answered by
  the docs (docs 3/3).
