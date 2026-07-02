# Maintaining This Skills Repo

This repo has no CI enforcement. Skill accuracy is kept up over time by a **human + automation
process**: a fleet of scheduled agents ("routines") watch each product's source, open PRs when a
user-facing change needs documenting, and a human reviews and merges. This document is the
**plain-language overview** of that process (read this first); the exact routine definitions,
prompts, trigger IDs, and schedules live in [`skills-sync-routine.md`](./skills-sync-routine.md),
and the guardrails every routine inherits live in the repo [`CLAUDE.md`](./CLAUDE.md).

## How the maintenance automation works

Seven scheduled cloud routines (Claude Code "routines", stored in the claude.ai backend, run in
Anthropic's cloud — not on anyone's laptop) maintain this repo. They form a **generator → critic →
human loop**:

1. **Generators** (one per product) run weekly. Each watches its product's source, detects
   *user-facing* changes since the last run, grounds them in source, and opens a PR against `main`.
   If nothing user-facing changed, the run does nothing (a no-op is a success, not a failure).
2. **The critic** (read-only, every 6h) reviews each generator PR: it re-verifies every claim
   against the product source and posts an advisory comment. **It cannot approve, merge, or edit** —
   it only comments.
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
| Redpanda Core skills sync | `skills/streaming*`, `skills/rpk*` (12) | `redpanda-data/redpanda` + `docs` (public) | **release-pinned** (GitHub Release notes) |
| SQL skills sync | `skills/sql*` (4) | `redpanda-data/oxla` (private) + `cloud-docs` | commit-watch (Oxla is trunk-based) |
| Connect skills sync | `skills/connect*` (10) | `connect` + `benthos` engine + `rp-connect-docs` (public) | **release-pinned** (Connect releases) |
| Skills sync critic | reviews all generator PRs | (per skill's `SOURCES.md`) | every 6h, read-only |
| Skills drift audit | all 30 source-grounded skills | (per skill's `SOURCES.md`) | monthly full re-verification |

Generators are staggered onto different weekdays (ADP Mon, Core Tue, SQL Wed, Cloud Thu,
Connect Fri) so their PRs don't all land on the same day, and use a lookback window slightly
longer than the weekly cadence so one skipped run self-heals.

## The durability principle (why this differs from prose-docs automation)

**Stable concepts live in the skill; volatile specifics do NOT.** A skill documents the *shape and
semantics* of an API surface (CLI flags, service names, config-key names, endpoint paths, enum
values) — those are stable. It must **never hardcode** values that rotate frequently (model lists,
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
3. **Enterprise-feature coverage pass.** Verify key differentiators and their nested settings.
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
- **Core** → `redpanda-data/redpanda` + `docs`, public (verify at the current stable release tag).
- **SQL** → `redpanda-data/oxla` (private) + `cloud-docs` module `sql`. (`sql-admin-api` is source-only.)
- **Connect** → `redpanda-data/connect` + the `benthos` engine + the auto-generated `rp-connect-docs`.

When adding a new source-grounded skill, add a `SOURCES.md` beside it and register it in the
drift-audit scope.

## Operating the routines

- **Where they live / how to manage them:** the dashboard at https://claude.ai/code/routines, or the
  `RemoteTrigger` tool / `/schedule` skill (actions: list, get, create, update, run). You cannot
  delete a routine via the API — use the dashboard.
- **Monitoring (there is NO automated alerting).** A silently-failing run notifies no one. The
  standing responsibility is to **check the dashboard ~weekly** for failed or empty runs; each run's
  transcript (in the dashboard) is the source of truth for what it did. The **monthly drift audit**
  is the automated safety net that catches drift a missed weekly run would otherwise leave.
- **Reviewing generator PRs.** Read the PR description (it lists the source commits/release + what
  changed and why), read the critic's `[skills-sync critic]` comment, then apply the docs-team review
  standards and merge. Anything the generator flagged as a TODO needs a human decision — don't guess.
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
