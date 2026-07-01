# Maintaining This Skills Repo

This repo has no CI or automated enforcement today. Correctness is a human and
process responsibility. This document records the norms for keeping skills accurate
and introduces the proposed automation (defined in `skills-sync-routine.md`).

## How skills are verified

Every skill in this repo was built and must be re-verified with a four-step process
drawn from `README.md`:

1. **Grounded spec.** Identify the authoritative source paths (proto files, Go source,
   golden CLI snapshots, API definitions) for the feature area. Write or revise the
   skill to match those paths exactly, not from memory or prior drafts.

2. **Adversarial review at maximum model effort.** Cross-check every command, flag,
   config field, endpoint, and code example against the actual source. Fix any
   hallucinated or outdated detail. Assume the draft is wrong until the source confirms
   it.

3. **Enterprise-feature coverage pass.** Verify that key differentiating features and
   their nested settings are present and accurate. These are the details most likely to
   be missing in a quick draft.

4. **Final verification pass.** Read the skill as a user would. Confirm the examples
   are copy-pasteable and the decision rules are clear. Run `rpk ai --help` (or the
   equivalent live surface for the product area) to catch any drift since the source
   was last read.

**This four-step process must be re-applied on every change**, not just initial
authoring. A partial update that skips steps 2-4 is likely to introduce drift.

## The durability principle (ADP skill and generalizing it)

The ADP skill (`skills/adp/`) uses a durability principle: **stable concepts live in
the skill; volatile specifics are deferred to live introspection.** For example:

- The skill explains how to list models and what fields to inspect, rather than
  hardcoding a model catalog that rotates frequently.
- CLI flag names and service names are grounded in source because they are stable
  across releases.
- Category counts, pricing fields, and model lists are handled by telling the agent
  to call `rpk ai model list` or equivalent, so the skill does not go stale with every
  model update.

Apply this same principle to other skills: document the shape and semantics of an API
surface; defer enumerated values that change frequently (catalog contents, region
lists, version numbers) to runtime calls.

## Per-file source maps

Each skill area that derives from private source code should carry a source map. It
records which `cloudv2` file paths each skill file is grounded in, so a maintainer (or
automated routine) knows exactly where to look when re-verifying. The repo currently
carries source maps for:

- **ADP:** `skills/adp/SOURCES.md` (grounded in `proto/public/cloud/redpanda/api/adp/`,
  `apps/rpai/`, `apps/aigw/`).
- **Redpanda Cloud:** `skills/cloud-serverless/references/SOURCES.md`,
  `skills/cloud-byoc/references/SOURCES.md`, and
  `skills/cloud-dedicated/references/SOURCES.md` (grounded in
  `proto/public/cloud/redpanda/api/controlplane/v1/`, the byoc plugin proto, and the
  generated `proto/gen/openapi/openapi.{controlplane,dataplane}.yaml`).

The same pattern generalizes repo-wide: add a `SOURCES.md` alongside any skill whose
claims need to be traceable to private or versioned source, and reference it from this
file when it exists.

## Proposed automation

`skills-sync-routine.md` (repo root) defines four proposed scheduled routines that
monitor `cloudv2` (and the user-facing changelogs) and open a PR against this repo when
user-facing updates are detected:

- **`adp-skill-sync`** (weekly) — syncs `skills/adp/`, triggered primarily off
  `adp/RELEASE_NOTES.md`.
- **`cloud-skill-sync`** (weekly, staggered) — syncs the three `skills/cloud-*` skills,
  triggered primarily off the Cloud changelog
  (`cloud-docs/modules/get-started/pages/whats-new-cloud.adoc`) and an OpenAPI-spec diff.
- **`skills-sync-critic`** (every 6h) — one read-only critic that reviews the PRs from
  both generators and the drift audit.
- **`skills-drift-audit`** (monthly) — a full re-verification of every source-grounded
  skill against its `SOURCES.md`, backstopping the change-triggered syncs against silent
  drift (there is no failure alerting).

They are **not yet created or enabled**; read that file for the full definitions, the
cadence rationale (weekly generators use a 10-day lookback so one skipped run
self-heals), and the steps to create them. Both generators and the drift audit enforce
the durability principle as a hard constraint — the #1 skills-specific failure mode is
documenting the volatile detail from a commit that the skill deliberately defers to live
introspection.

The routine environment cannot see your global `~/CLAUDE.md` or the docs-team-standards
plugin — it only reads the repo's committed `CLAUDE.md`. That file (repo root) carries
the durability principle, the four-step process, and the flag-don't-guess rule as HARD
RULES, so all four routines (and interactive sessions) inherit them. Put new
cross-cutting rules there rather than duplicating them into each prompt.

Until the routines are live, syncs are manual: a maintainer reads the relevant
`cloudv2` source paths (listed in each skill's `SOURCES.md`), identifies any
user-facing changes since the last skill update, and applies the four-step process
above.
