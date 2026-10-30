# Maintaining This Skills Repo

CI checks only skill frontmatter and size (`.github/workflows/validate-skills.yml`); nothing runs
the evals automatically. Skill accuracy is kept up over time by a **human + automation
process**: a fleet of scheduled agents ("routines") watch each product's source and open a PR
when a user-facing change affects a skill, and a human reviews and merges. What counts as
affecting a skill depends on its format: a **thin** skill (its `references/` holds only
`SOURCES.md`) changes only when what an agent should *do* changes, while a skill that is **not
yet thin** also changes when a fact it documents changes. A new or changed fact for a thin skill
is a docs gap, reported for the docs, not a skill PR. This document is the
**plain-language overview** of that process (read this first); the exact routine definitions,
prompts, trigger IDs, and schedules live in the docs team's private standards repository (see
[`skills-sync-routine.md`](./skills-sync-routine.md) for the pointer), and the guardrails every
routine inherits — including the public-surface rule — live in the repo [`CLAUDE.md`](./CLAUDE.md).

## How the maintenance automation works

Seven scheduled cloud routines (Claude Code "routines", stored in the claude.ai backend, run in
Anthropic's cloud — not on anyone's laptop) maintain this repo. They form a **generator → critic →
human loop**:

1. **Generators** (one per product) run weekly. Each watches its product's source, detects
   *user-facing* changes since the last run, and grounds them in source. For a skill that is not
   yet thin, a changed fact it documents gets a PR against `main`. For a thin skill, only a
   changed procedure gets a PR, and a new "How to work" line comes with a draft behavioral eval
   case (see "Thin skills and the evals"); a changed fact is listed under "Docs gaps" in the
   provenance report instead. Any skill may get a PR that corrects or removes a drifted fact. If
   nothing affects a skill, the run does nothing (a no-op is a success, not a failure).
2. **The critic** (read-only, every 6h) reviews each generator PR: it re-verifies every claim
   against the product source and posts its review to a private standing issue in the docs team's
   standards repo (nothing is posted on the public PR). **It cannot approve, merge, or edit.**
3. **A human maintainer reviews and merges the PR.** The routines never merge their own work;
   merging (and responding to review comments) is always a human decision.
4. **The drift audit** (monthly) is the backstop: it re-verifies *every* source-grounded skill
   against its source from scratch — catching silent drift that the change-triggered generators
   miss (there is **no failure alerting**, so a silently-skipped run is caught here or by the
   weekly dashboard check — see "Operating the routines").

| Routine | Skills it maintains | Source of truth | Trigger model |
|---------|--------------------|-----------------|---------------|
| ADP skills sync | `skills/adp/` | `redpanda-data/cloudv2` (private) | commit-watch, keyed off `adp/RELEASE_NOTES.md` |
| Cloud skills sync | `skills/cloud-*` (3) | `cloudv2` + `cloud-docs` (private) | commit-watch, keyed off `whats-new-cloud.adoc` + OpenAPI diff |
| Redpanda Core skills sync | `skills/streaming*`, `skills/rpk*` (12) | `redpanda-data/redpanda` (public) + `docs` (private) | **release-pinned**, keyed off the published Redpanda release notes (`modules/reference/pages/releases/redpanda.adoc` in `docs`), not GitHub Releases |
| SQL skills sync | `skills/sql*` (4) | `cloud-docs` (private; the published Cloud SQL docs are the scope gate) + `redpanda-data/oxla` (private; confirms documented behavior only) | pin-watch: the Oxla version `cloudv2` pins, verified at that version's Oxla release tag (not the default branch) |
| Connect skills sync | `skills/connect*` (10) | `connect` + `benthos` engine + `rp-connect-docs` (public) | **release-pinned** (Connect releases) |
| Skills sync critic | reviews all generator PRs | (per skill's `SOURCES.md`) | every 6h, read-only |
| Skills drift audit | all 30 source-grounded skills | (per skill's `SOURCES.md`) | monthly full re-verification |

Generators are staggered onto different weekdays (ADP Mon, Core Tue, SQL Wed, Cloud Thu,
Connect Fri) so their PRs don't all land on the same day, and use a lookback window slightly
longer than the weekly cadence so one skipped run self-heals.

## The durability principle (why this differs from prose-docs automation)

**No skill hardcodes volatile specifics.** A thin skill carries no API surface at all: CLI flags,
service names, config-key names, endpoint paths, and enum values are facts, and they live in the
docs. A skill that is not yet thin documents the *shape and semantics* of an API surface (CLI
flags, service names, config-key names, endpoint paths, enum values), because those are stable,
until it is converted. Neither may **hardcode** values that rotate frequently (model lists,
category counts, pricing, region lists, version numbers, metric names, per-release property
*defaults*, and — for Connect — the auto-generated per-field connector config). Those are deferred
to **live introspection** (`rpk ai model list`, `rpk cloud region list`, `rpk <cmd> --help`, the
live `/metrics` endpoint, the auto-generated reference docs).

Consequence: **most product changes do NOT require a skill change.** The generators are built to
no-op on volatile-only churn — "documenting the changelog" is the #1 failure mode to avoid. This
rule is a HARD RULE in the repo `CLAUDE.md`, which every routine (and interactive session) inherits.

## The four-step verification process

Applied on **every** change, by generators, the critic, and human maintainers alike:

1. **Grounded spec.** Identify the authoritative source paths (proto/Go/C++ source, generated docs,
   golden CLI snapshots). Write from source, not memory.
2. **Adversarial review at maximum effort.** Cross-check every command, flag, config key, endpoint,
   enum, and code example against the actual source. Assume the draft is wrong until source confirms.
3. **Coverage pass.** For a skill that is not yet thin, verify key enterprise differentiators and
   their nested settings are present. For a thin skill, verify the skill restates no facts beyond
   what its "How to work" lines need, and that each line still maps to a source and an eval case
   in `SOURCES.md`; feature coverage is the docs' job.
4. **Final verification.** Read as a user would: examples copy-pasteable, decision rules clear;
   re-confirm against the live surface where one exists.

## Source maps (`SOURCES.md`) — the contract between skills and source

Every source-grounded skill carries a `SOURCES.md` (at `skills/<name>/references/SOURCES.md`, or
`skills/adp/SOURCES.md`) mapping each skill file to the exact source paths its claims derive from,
plus a **"Deferred to live introspection"** section (what NOT to hardcode) and a **"TODO / re-verify"**
section. This is what the generators, critic, and drift audit read first, and where a human starts
when re-verifying. **All 30 source-grounded skills have one** (ADP; 3 Cloud; 12 Core; 4 SQL;
10 Connect). Each names its authoritative source repo(s):

- **ADP / Cloud** → `cloudv2` (+ `cloud-docs`), private.
- **Core** → `redpanda-data/redpanda` (public) + `docs` (private). A release counts as shipped once the
  release-notes page has a `== vX.Y.Z (date)` section for it. `v26.2.2` is the last release published
  as a GitHub Release, and the public repo carries no tag or branch head for later releases, so verify
  in this order: the public source at the release's tag, when one exists; otherwise the generated docs
  in `docs` (property partials, rpk reference), but only once the commit that last regenerated them
  names that release or a later one (the rpk reference can lag several releases behind the property
  partials, and generated docs from an earlier release are not evidence for or against a later
  release's change); otherwise describe the change only as far as the release notes state it, with a
  version marker, and record it as a TODO in the skill's `SOURCES.md`.
- **SQL** → `cloud-docs` module `sql` and the `reference/sql` pages (private), which set the scope: a skill covers only what the published Cloud docs document for users. `redpanda-data/oxla` (private) confirms the behavior of documented surfaces at the shipped tag and never adds undocumented ones (no engine config, env vars, admin API, raw metrics, or self-hosted deployment).
- **Connect** → `redpanda-data/connect` + the `benthos` engine + the auto-generated `rp-connect-docs`.

When adding a new source-grounded skill, add a `SOURCES.md` beside it and register it in the
drift-audit scope.

A thin skill's `SOURCES.md` maps only the claims the skill still makes: each "How to work" line
with its source and its eval case id, plus the few other claims in `SKILL.md`. When a skill is
converted, its `SOURCES.md` is trimmed in the same PR, so the drift audit stops re-checking
claims the skill no longer makes. Docs gaps the evals found may be listed in a separate section,
as items for the docs, not claims to re-verify.

## Thin skills and the evals

The evals in `evals/` (see `evals/README.md`) decide what a thin skill keeps. The routines cannot
run them, so a maintainer does.

- **New "How to work" line.** A routine or person may propose one only together with a draft
  behavioral eval case in `evals/suites/<skill>.eval.json`, and the line, its source, and the
  case id in `SOURCES.md`. The PR stays unmerged until a maintainer runs the case
  (`node evals/run-evals.mjs --case <id> --arms baseline,skill,installed`) and the baseline
  fails it while the skill arms pass. The maintainer records the pass rates in the PR. If the
  baseline passes, the line comes out.
- **Scheduled re-run.** "The baseline fails it" stops being true as models improve. Each month,
  when the drift audit runs, a maintainer re-runs the behavioral cases of every thin skill
  (`--arms baseline,installed`). A line whose case the baseline now passes is flagged for
  removal in a PR; a line whose case the installed arm fails is a skill or docs problem to fix.
- **Converting a skill.** Convert one skill at a time, after its own evals show which of its
  facts the docs already cover. Every fact the skill drops that the docs lack is a docs gap,
  and the conversion waits until the docs cover it.

## Docs gaps: from report to fix

A thin skill cannot work around a missing or wrong fact in the docs, so the gap stays visible to
users until the docs change. The handoff point is the **"Docs gaps" section of each routine's
provenance report** (and of each eval run's summary): every item names the fact, the published
page that lacks it, and the source that confirms it. The docs team reads that section, turns each
item into a docs ticket, and tracks it to closure. A later provenance report repeats a gap only
while the published docs still lack the fact. A skill PR never waits on, or substitutes for, that ticket.

## Operating the routines

- **Where they live / how to manage them:** the dashboard at https://claude.ai/code/routines, or the
  `RemoteTrigger` tool / `/schedule` skill (actions: list, get, create, update, run). You cannot
  delete a routine via the API — use the dashboard.
- **Monitoring (there is NO automated alerting).** A silently-failing run notifies no one. The
  standing responsibility is to **check the dashboard ~weekly** for failed or empty runs; each run's
  transcript (in the dashboard) is the source of truth for what it did. The **monthly drift audit**
  is the automated safety net that catches drift a missed weekly run would otherwise leave.
- **Reviewing generator PRs.** The public PR description is deliberately minimal (public-surface
  rule in `CLAUDE.md`). The full run record — source commits, verification paths, skipped changes,
  TODOs — is the generator's provenance report, and the critic's `[skills-sync critic]` review lands
  beside it; both are comments on private standing issues in the docs team's standards repo,
  delivered to the docs-team Slack channel. Read both, then apply the docs-team review standards and
  merge. Anything flagged as a TODO needs a human decision — don't guess.
- **Kill switch.** To stop a routine immediately, disable it: `RemoteTrigger` `update`
  `{"enabled": false}` on its trigger ID, or toggle it off in the dashboard. This stops future fires;
  it does not interrupt a run already in flight.
- **Branch cleanup.** Generators push `claude/sync-skills-*` / `claude/drift-audit-*` branches. The
  routine environment cannot delete remote branches, so enable the repo's **"Automatically delete
  head branches"** setting (a repo admin) so merged branches self-clean.

### Operational gotchas (self-contained; see `adp-docs-routines.md` for the full reference)

The [`adp-docs-routines.md`](https://github.com/redpanda-data/docs-team-standards/blob/main/resources/adp-docs-routines.md)
doc in `docs-team-standards` (private) is the origin reference for these; the essentials are repeated
here so this repo stands alone:

- **`claude/` branch prefix is required** — pushes to any other branch name are rejected.
- **No `gh` CLI** in the routine environment — routines use `git` via Bash for push and the
  environment's native GitHub capability for PRs/comments.
- **Private source repos are never cloned** (cloning a private repo hangs the run) — they are read
  via the read-only Redpanda-Github-Read MCP connector. Only `redpanda-data/skills` is cloned.
- **GitHub App write access** to `redpanda-data/skills` is required for the generators to open PRs
  (granted by adding the Claude GitHub App to the repo per the Routines docs — an org action).
- Cron is 5-field UTC, minimum interval 1 hour; PRs/commits are authored as the routine's creator
  (so downstream automation selects by PR title + `claude/` branch, not by author).
