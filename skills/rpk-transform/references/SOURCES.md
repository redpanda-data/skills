# rpk-transform Skill Source Map

The skill is thin: it keeps only the "How to work" procedure below, backed by a behavioral
eval case in `evals/suites/rpk-transform.eval.json`, and sends the agent to the docs for
everything else. This file maps only the claims the skill still makes.

The `rpk transform` CLI is Go source in the **public** repo `redpanda-data/redpanda` under
`src/go/rpk/pkg/cli/transform/`, and the broker side of Data Transforms is C++ under
`src/v/transform/`, `src/v/wasm/`, and `src/v/cluster/plugin_frontend.cc`. The user-facing
reference is in the **private** repo `redpanda-data/docs`; read it with the Redpanda-Github-Read
connector or `gh api`, and do not clone it. Verify against the current stable release tag
(v26.2.2 when this map was written), not `dev`. Paths below are relative to
`redpanda-data/redpanda`.

## How to work: line, source, eval case

| How to work line | Source | Eval case |
|---|---|---|
| A redeploy takes environment variables and compression only from `transform.yaml` and that deploy's flags, so values an earlier deploy set with `--var` or `--compression` are dropped with no error; read them with `rpk transform list --format json` and pass them again (verified 2026-11-10). Baseline 0/3, skill 3/3, both 3/3, installed 3/3, docs 0/3 on 2026-11-10. Rerun 2026-11-10 (archive run `2026-11-10T20-42-00Z`): baseline 0/3, skill 3/3, installed 3/3. | `src/go/rpk/pkg/cli/transform/deploy.go` (`mergeProjectConfigs`: metadata built from `transform.yaml` plus this deploy's flags; compression defaults to `none`), `src/v/cluster/plugin_frontend.cc` (an update of an existing transform may change its environment), `src/go/rpk/pkg/cli/transform/list.go` (`environment` and `compression` in json and yaml output) | `redeploy-keeps-deployed-settings` |

## Other claims in SKILL.md

| Claim | Source | Eval case |
|---|---|---|
| Transforms run on self-managed, BYOC, and Dedicated clusters, not Serverless | `src/go/rpk/pkg/cli/transform/deploy.go` (`config.CheckExitServerlessAdmin`); https://docs.redpanda.com/cloud-data-platform/develop/data-transforms/how-transforms-work/ (checked 2026-11-10) | `serverless-transform-support` |
| `get_rpk_command` looks up an rpk subcommand and `get_config_property` a cluster property | Live `tools/list` from `https://docs.redpanda.com/mcp` (see `skills/redpanda-docs/references/SOURCES.md`) | none |
| For a Cloud cluster, pass `platform: "cloud"`; the Cloud page says which cluster types support transforms | https://docs.redpanda.com/cloud-data-platform/develop/data-transforms/how-transforms-work/ (checked 2026-11-10) | none |
| When the Docs MCP server refuses for quota and no page fetch is possible, tell the user to sign in through `/mcp` | `skills/redpanda-docs/references/SOURCES.md` (anonymous quota row) | none |

## Docs gaps (not skill claims; do not re-verify here)

Found by the 2026-11-10 evals and checked against source at v26.2.2. None of these is on an
rpk reference page, so none is an rpk help-text fix, and `docs-data/rpk-overrides.json` in
`docs` hides nothing about them.

- **Lag metric name.** The broker registers the lag gauge as `lag` in the `transform` group, so
  the public name is `redpanda_transform_lag`, with labels `function_name` and `output_topic`.
  The Monitor page (`modules/develop/pages/data-transforms/monitor.adoc`) and the public
  metrics reference (`modules/reference/pages/public-metrics-reference.adoc`) name it
  `redpanda_transform_processor_lag`. Source: `src/v/transform/probe.cc` (`make_gauge("lag", ...)`,
  group `transform`; same name at v23.3.1). Case `transform-lag-metric-name`.
- **Environment variable value limit.** The broker rejects a value longer than 2 KiB (each value,
  not a combined total), an empty value, a key longer than 128 bytes, more than 128 variables,
  and a key starting with `REDPANDA_`. The Limitations section of How Data Transforms Work
  (`modules/develop/pages/data-transforms/how-transforms-work.adoc`) says the combined length of
  all values must be less than 2000 bytes and each key less than 128 bytes. Source:
  `src/v/cluster/plugin_frontend.cc` (`max_value_size = 2_KiB`, `max_key_size = 128`,
  `max_env_vars = 128`). Case `transform-env-var-limits`.
- **A redeploy cannot change topics.** A deploy of an existing transform name may change the
  binary, environment, and offset pointer only; a different input topic or output topic list
  is rejected, so changing topics needs a delete and a new deploy. The Deploy page
  (`modules/develop/pages/data-transforms/deploy.adoc`) does not say so. Source:
  `src/v/cluster/plugin_frontend.cc` (`errc::transform_invalid_update`). Case
  `redeploy-cannot-change-topics`.
- **Cost of goroutines.** `tinygo-with-goroutines` builds with TinyGo's asyncify scheduler, which
  makes code about 10 times slower in Redpanda's benchmarks; `tinygo-no-goroutines` uses no
  scheduler. The Build page (`modules/develop/pages/data-transforms/build.adoc`) lists both
  languages without the trade-off, and `rpk transform init --help` does not mention it either.
  Source: `src/go/rpk/pkg/cli/transform/build.go` (scheduler comment). Case
  `tinygo-goroutines-tradeoff` (docs arm 0/3).
- **Cycles are rejected.** The broker rejects a transform whose output topics lead back to its
  input topic, directly or through other transforms. How Data Transforms Work does not say so.
  Source: `src/v/cluster/plugin_frontend.cc` (`would_cause_cycle`). Case
  `transform-output-cycle` (baseline 3/3, docs arm 0/3).

## Lines removed for lack of a failing baseline

- "To stop a transform for a while, pause it; don't delete it" was removed on 2026-11-10. Its
  case `stop-transform-temporarily` (stop a transform for two hours without losing records)
  passed 3/3 in the baseline once the mock answered compound commands fairly (a first run, with
  a mock that hid the `rpk transform --help` listing, scored 1/3). A rerun on 2026-11-10
  (archive run `2026-11-10T20-42-00Z`) scored baseline 0/3, skill 3/3, installed 3/3: each baseline run said
  Redpanda cannot pause a transform and stopped to ask instead of pausing, while the thin skill,
  without this line, ran `rpk transform --help`, found `pause`, and paused. The line stays out
  because the thin skill passes without it, but the baseline result now varies between runs.
  It was not kept as a safety guardrail: a delete drops committed offsets, but the input records stay and a redeploy with
  `--from-offset` can recover them, so it is not data loss or an irreversible change.
- Reprocessing after a fix (delete, then redeploy with `--from-offset`, because `--from-offset`
  is honored only on a transform's first deploy) got no line. Case
  `reprocess-existing-records-after-fix` passed 3/3 in the baseline (rerun `2026-11-10T20-42-00Z`: baseline
  3/3, skill 3/3, installed 3/3); the `--from-offset` help
  text and the Deploy page both state the rule.
- The full skill's facts (command and flag tables, SDK templates, cluster properties, metrics,
  Enterprise features for transform topics, Cloud applicability) were dropped. Of the sampled
  and targeted cases, the baseline answered 10 of 15, and the docs arm answered two more that
  the baseline missed (`transform-error-rate-promql`, `js-sdk-specific-output-topic`). The rest
  are the docs gaps above.
