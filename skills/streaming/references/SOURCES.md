# streaming Skill Source Map

The skill is thin: it keeps only the "How to work" procedures below, each backed by a
behavioral eval case in `evals/suites/streaming.eval.json`, and sends the agent to the docs
for everything else. This file maps only the claims the skill still makes.

The skill is grounded in the **public** repo `redpanda-data/redpanda` (broker C++ under
`src/v/`, config under `src/v/config/`, rpk under `src/go/rpk/`). Verify against the current
stable release tag (checked at `v26.2.2`), not `dev`. Paths below are relative to that repo.

## How to work: line, source, eval case

| How to work line | Source | Eval case |
|---|---|---|
| Deleting a topic deletes its object storage objects while `redpanda.remote.delete` is `true`, the default; set it to `false` first to keep the archive. Safety guardrail (data loss): the baseline passes its case, and the line and case stay as a regression guard. Run `2026-11-10T20-28-08Z`: baseline 3/3, skill 3/3, installed 2/2 (1 run errored). | `src/v/storage/ntp_config.h` (`default_remote_delete{true}`), `src/v/kafka/server/handlers/topics/types.cc` (`redpanda.remote.delete` falls back to `default_remote_delete`) | `delete-tiered-topic-keep-archive` |
| Tables go in the namespace `redpanda` unless `iceberg_default_catalog_namespace` is set; set a distinct one before or with `iceberg_enabled` when clusters share a catalog, and never change it afterward. Run `2026-11-10T20-48-04Z` (after the case fix below): baseline 0/3, skill 3/3, installed 2/3. | `src/v/config/configuration.cc` (`iceberg_default_catalog_namespace`: default `{"redpanda"}`, "must be configured before enabling Iceberg and must not be changed afterward", needs restart) | `iceberg-second-cluster-shared-catalog` |
| With `partition_autobalancing_mode=continuous`, cancelling moves is not enough; set the mode to `off` or `node_add`, then run `rpk cluster partitions move-cancel`. Run `2026-11-10T20-28-08Z`: baseline 0/3, skill 3/3, installed 2/3. | `src/v/config/configuration.cc` (`partition_autobalancing_mode`: `node_add`, `continuous`, `off`), `src/go/rpk/pkg/cli/cluster/partitions/cancel.go` (`move-cancel`); the "first set to off, then cancel" rule is stated on https://docs.redpanda.com/streaming/current/manage/cluster-maintenance/continuous-data-balancing/ | `stop-partition-balancing-for-maintenance` |

Rates above are from the rerun against this thin skill on 2026-11-10, 3 runs per arm, as
baseline / skill / installed. The failing installed run of the Iceberg case set the namespace,
then stopped and reverted `iceberg_enabled` because the stateless mock's re-read still showed
`redpanda`; the judge failed it for that. The failing installed run of the stop-balancing case
set the mode to `off` and never cancelled the in-flight moves.

## Other claims in SKILL.md

| Claim | Source | Eval case |
|---|---|---|
| `get_config_property` looks up one property and `list_config_properties` finds a property's name | Live `tools/list` from `https://docs.redpanda.com/mcp` (see `skills/redpanda-docs/references/SOURCES.md`) | none |
| The docs page URLs listed under "Most useful pages" | Each returned 200 on 2026-11-10 | none |
| When the Docs MCP server refuses for quota and no page fetch is possible, tell the user to sign in through `/mcp` | `skills/redpanda-docs/references/SOURCES.md` (anonymous quota row) | none |

## Docs gaps (not skill claims; do not re-verify here)

The 2026-11-10 eval run found no fact the docs lack. Every informative fact case
(`kafka4-transactions-v2-fallback`, `local-log-eviction-exempt-topic`,
`cloud-topics-no-separate-switch`, `shadow-link-msk-iam-source`,
`shadow-link-roles-not-synced`, `shadow-update-file-password`,
`down-broker-not-decommissioned`) passed 3/3 in the docs arm.

The two kept procedures fail in the docs arm (Iceberg namespace 0/3, stop balancing 0/3 and
1/3 across two runs) although the docs state both facts:
https://docs.redpanda.com/streaming/current/manage/iceberg/about-iceberg-topics/ and
`iceberg-topics-aws-glue` say each cluster writing to one catalog needs a distinct namespace,
and the Continuous Data Balancing page says to set the mode to `off` before cancelling. The
agent does not look these up during the task, so they are reasons the skill lines exist,
not missing docs.

## Lines removed for lack of a failing baseline

- "Update a shadow link from its full current configuration (`rpk shadow describe --format
  yaml`), because `rpk shadow update` replaces the whole configuration" was not kept. Its case
  `shadow-link-update-full-config` passes in the baseline: after the case fix below, run
  `2026-11-10T20-48-04Z` scored baseline 3/3, skill 3/3, installed 3/3, and no baseline run
  wrote a partial configuration. Without the skill, the agent read the `rpk shadow update` help,
  which says both modes replace the entire configuration, and used the editor seeded with the
  current configuration. The case stays in the suite as data.
- The full pre-thin skill (14 reference files on Kafka API behavior, producers, consumers,
  transactions, topic management, clients, TLS, Tiered Storage, enterprise features, Iceberg,
  Cloud Topics, balancing, Shadow Linking, and client metadata settings) was removed. Its
  fact cases were either answered by the baseline (`storage-mode-tiered-to-cloud`,
  `schema-id-validation-mode-values`, `iceberg-invalid-records-dlq-table`,
  `scram-one-mechanism-per-user`, `shadow-topic-alter-rejected`) or answered 3/3 by the docs.

## Corrections after the eval run

Two cases graded wrongly and were fixed, then rerun in `2026-11-10T20-48-04Z`; no line's
verdict changed.

- `iceberg-second-cluster-shared-catalog`: the expected call treated any namespace that starts
  with `redpanda` followed by a non-word character as the default, so a distinct namespace such
  as `redpanda-west`, or the nested `["redpanda","west"]`, would have failed. It now rejects
  only a namespace that is exactly `redpanda`.
- `shadow-link-update-full-config`: the mock cannot run an editor script passed through
  `EDITOR`, so a run that applied the update that way saw no change on a later diff or re-read,
  and the judge failed it for reporting that. The invariant now says not to. In
  `2026-11-10T20-28-08Z`, before the fix, two of the three installed runs failed this way.
