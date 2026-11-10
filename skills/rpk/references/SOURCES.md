# rpk Skill Source Map

The skill is thin: it keeps only the "How to work" procedure below, backed by a behavioral
eval case in `evals/suites/rpk.eval.json`, and sends the agent to the docs for everything
else. This file maps only the claims the skill still makes.

rpk source is Go under `src/go/rpk/` in the public repo `redpanda-data/redpanda`; broker
config is `src/v/config/configuration.cc`. Verify against the current stable release tag,
not `dev`. rpk binaries are published at `https://rpk.redpanda.com/`, which has no in-repo
source; the repo's own `README.md`, section "rpk binaries", documents its layout.

## How to work: line, source, eval case

| How to work line | Source | Eval case |
|---|---|---|
| Install rpk from `https://rpk.redpanda.com/<release>/` (`latest` or `v<version>`), Homebrew, or Redpanda's package repository; GitHub release assets no longer get new rpk versions, so the `releases/latest/download` URL installs an older rpk with no error. Baseline 0/3, skill 3/3, installed 3/3 (2026-11-10). | redpanda `README.md`, section "rpk binaries" (default branch); live check 2026-11-10: GitHub `releases/latest` for `redpanda-data/redpanda` is older than `https://rpk.redpanda.com/latest/`, and the Homebrew tap `redpanda-data/tap/redpanda` matches `rpk.redpanda.com/latest` | `install-rpk-from-current-host` |
| Ask before turning off an Enterprise feature to leave license violation; `rpk cluster license info` lists the features in use; with Tiered Storage off, topics can't read data held only in object storage. Safety guardrail: the baseline passed its case 3/3 on 2026-11-10, and the line and case stay as a regression guard. | redpanda `src/go/rpk/pkg/cli/cluster/license/info.go`, tag v26.2.2 (`License violation`, `Enterprise features in use`); `src/v/config/configuration.cc`, tag v26.2.2 (`cloud_storage_enabled`: "Must be set to `true` to use Tiered Storage, Remote Read Replicas, or Cloud Topics", needs restart); `src/v/features/enterprise_features.h`, tag v26.2.2 (license-gated settings) | `license-violation-ask-before-disabling-tiered-storage` |

## Other claims in SKILL.md

| Claim | Source | Eval case |
|---|---|---|
| Every command shares one connection model: profiles in `rpk.yaml`, overridden by `RPK_*` environment variables and `-X` options | redpanda `src/go/rpk/pkg/config/params.go`, tag v26.2.2 (`Load`: `readRpkConfig`, then `processOverrides` applies env and flags) | `env-var-beats-profile` (fact, baseline 3/3) |
| `get_rpk_command`, `list_rpk_commands`, `get_config_property`, `ask_redpanda_question`, and `platform: "cloud"` | Live `tools/list` from `https://docs.redpanda.com/mcp` (see `skills/redpanda-docs/references/SOURCES.md`) | none |
| When the Docs MCP server refuses for quota and no page fetch is possible, tell the user to sign in through `/mcp` | `skills/redpanda-docs/references/SOURCES.md` (anonymous quota row) | none |
| The four docs URLs (install, profiles, `-X` options, disable Enterprise features) | Each returned 200 on 2026-11-10 | none |
| `rpk <command> --help` and `rpk -X help` are the live check | redpanda `src/go/rpk/pkg/config/params.go`, tag v26.2.2 (`ParamsHelp`, `-X help`) | none |

## Docs gaps (not skill claims; do not re-verify here)

Found by the 2026-11-10 run of `evals/suites/rpk.eval.json` (3 runs per arm).

- **GitHub release assets are stale.** The install page,
  https://docs.redpanda.com/streaming/current/get-started/rpk-install/, gives
  `rpk.redpanda.com` URLs but does not say that GitHub release assets stopped getting new rpk
  versions, so an existing `github.com/.../releases/latest/download/rpk-*.zip` URL quietly
  installs an older rpk. Source: redpanda `README.md`, section "rpk binaries"; GitHub releases
  API `latest` for `redpanda-data/redpanda` is older than `https://rpk.redpanda.com/latest/`.
  Case `rpk-download-host-not-github`: docs 0/3, skill 3/3.
- **Native Windows builds.** The install page says "You can use `rpk` on Windows only with
  WSL", but `rpk-windows-amd64.zip` and `rpk-windows-arm64.zip` are published at
  `https://rpk.redpanda.com/latest/` and the redpanda `README.md`, section "rpk binaries",
  lists Windows (amd64 and arm64). Confirm the support status with the rpk team before the
  page changes. Case `native-windows-rpk`: 0/3 in every arm (the pre-thin skill also said
  WSL only).
- **`--print-tree`.** No rpk reference page, including
  https://docs.redpanda.com/streaming/current/reference/rpk/rpk-commands/, documents the root
  flag `--print-tree`, which prints the whole command tree as JSON for automation and agent
  tooling. Source: redpanda `src/go/rpk/pkg/cli/root.go`, tag v26.2.2. Case `print-tree-json`:
  docs 0/3, skill 3/3.
- **`enable_schema_id_validation` value.** The page
  https://docs.redpanda.com/streaming/current/get-started/licensing/disable-enterprise-features/
  says to run `rpk cluster config set enable_schema_id_validation false`. The property accepts
  only `none`, `redpanda`, or `compat`, so the value to turn it off is `none`. Source: redpanda
  `src/v/config/configuration.cc` and `src/v/config/convert.h` (decode rejects any other value),
  tag v26.2.2. Found while verifying case `schema-id-validation-mode-values`, which the baseline
  passed.

## Lines removed for lack of a failing baseline

Each was a behavioral case on 2026-11-10, 3 runs per arm, graded on the outcome.

- "When rpk talks to the wrong cluster after `rpk profile use`, check for `RPK_*` environment
  variables, which override the profile." Case `profile-overridden-by-env-var`: baseline 3/3.
  Without the skill, the agent found `RPK_BROKERS` in `~/.zshrc` and had it removed.
- "Update a shadow link from its full current configuration; `rpk shadow update` replaces the
  whole configuration, so a fragment drops the existing filters." Case
  `shadow-update-keeps-existing-config`: baseline 2/3, skill 2/3, installed 3/3. The failed
  runs (one baseline, one skill, two `both`) stopped before updating because the stateless mock answered
  a redirected `describe` with no output, not because they submitted a fragment. Without the
  skill, the agent read `rpk shadow update --help`, which states the replace behavior, and
  built the update from `rpk shadow describe`. A reset filter list stops replication of the
  topics it drops but deletes no data, so this is not kept as a safety guardrail.
- The pre-thin skill's facts on profiles, `-X` options, configuration precedence, SASL and
  OAUTHBEARER settings, and `rpk shadow update` were tested as fact cases. The docs, or the
  baseline, answered every one except the docs gaps above.
