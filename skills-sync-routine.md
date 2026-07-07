# Skills Sync Routine Definitions

> **STATUS (2026-07-07): all seven routines are LIVE (`enabled: true`) and cover all five
> products.** The SQL and Connect syncs passed their manual probe runs on 2026-07-02 (probe
> PRs [#18](https://github.com/redpanda-data/skills/pull/18) and
> [#20](https://github.com/redpanda-data/skills/pull/20), both merged) and were enabled the
> same day. This file is the version-controlled record — if you edit a routine in the
> dashboard, update this file too, and vice versa.
>
> | Routine | Trigger ID | State |
> |---------|-----------|-------|
> | ADP skills sync | `trig_0154oVHsWXAv57ZoHgSYHBXX` | enabled |
> | Cloud skills sync | `trig_01KTyepdPaeH8wJp5Qa62AMQ` | enabled |
> | Redpanda Core skills sync | `trig_01Hmpkh7Bvm7pSv3ej1tikSK` | enabled |
> | SQL skills sync | `trig_01Hgnuo3x5i82dMwYx17PysY` | enabled |
> | Connect skills sync | `trig_01Ms8Dm47LXALNSg4KQumNb4` | enabled |
> | Skills sync critic | `trig_01HZY8SRDcuAdK1Hfm9Y725B` | enabled (reviews all 5 products) |
> | Skills drift audit | `trig_01BMbjQwNvuG39f1akg7RbQg` | enabled (audits all 5 products) |
>
> Dashboard: https://claude.ai/code/routines · Owner: Michele (michele@redpanda.com) ·
> Environment: `env_01GtQ6tQeM9RZqpxdkRhWvtU`

This file is the version-controlled definition of the scheduled routines that monitor the
product source (and the user-facing changelogs/releases) and open a PR against
`redpanda-data/skills` when user-facing updates require skill updates:

- **`adp-skill-sync`** — keeps `skills/adp/` in sync with the ADP product source (cloudv2).
- **`cloud-skill-sync`** — keeps the three `skills/cloud-*` skills in sync with the
  Redpanda Cloud control-plane / data-plane API source (cloudv2).
- **`core-skill-sync`** — keeps the 13 Redpanda Core skills (`skills/streaming*`,
  `skills/rpk*`) in sync with the latest **stable release** of `redpanda-data/redpanda`
  (+ the generated reference in `redpanda-data/docs`).
- **`sql-skill-sync`** — keeps the 4 SQL skills (`skills/sql*`) in sync with the **Oxla**
  engine source (private `redpanda-data/oxla`, trunk-based; SQL docs in `cloud-docs`).
- **`connect-skill-sync`** — keeps the 11 Connect skills (`skills/connect*`) in sync with
  the latest **stable release** of Redpanda Connect (`redpanda-data/connect` + the
  `redpanda-data/benthos` engine + the auto-generated `redpanda-data/rp-connect-docs`).
- **`skills-sync-critic`** — a single read-only critic that reviews the PRs opened by all
  five generators (and the drift audit).
- **`skills-drift-audit`** — a low-frequency full re-verification that backstops the
  change-triggered syncs by re-checking every source-grounded skill against its
  `SOURCES.md`, regardless of whether a change was detected.

All follow the same generator/critic pattern as the adp-docs routines, documented at
https://github.com/redpanda-data/docs-team-standards/blob/main/resources/adp-docs-routines.md
which is the reference for all operational gotchas (branch prefix, private-repo read
strategy, no `gh` CLI, and so on).

## How skills differ from docs (read this first)

These routines are adapted from the **adp-docs** routines, not copied. The skills repo
has one property that changes the design: the **durability principle** (see
`MAINTAINING.md` and the repo `CLAUDE.md`). Stable concepts live in the skill; volatile
specifics (model lists, region lists, category counts, pricing, version numbers) are
deferred to live introspection (`rpk ai model list`, `rpk cloud region list`, etc.).

Consequence: **most cloudv2 commits should NOT trigger a skill change.** The
signal-to-noise ratio of raw commit-watching is far lower for skills than for prose docs.
So these routines:

1. Trigger off the **highest-signal, human-curated source** first — a user-facing
   changelog — and only then confirm specifics in the proto/OpenAPI/source. (ADP:
   `adp/RELEASE_NOTES.md`. Cloud: `whats-new-cloud.adoc` in `cloud-docs`. Core: the
   `redpanda-data/redpanda` **GitHub Release notes** for the current stable tag.)
   Core is **release-pinned** — it syncs against the latest stable release, not
   `dev`/`main`, because core features reach users at release time (this also serves the
   "docs/skills shouldn't document unreleased behavior" concern).
2. Are backstopped by a periodic **full re-verification** (`skills-drift-audit`), because
   a change-triggered sync alone can miss silent drift (a default or enum that changes
   without an obvious watched-path match, or a silently-skipped run — there is no
   alerting).
3. Use a **lookback window longer than the cadence** so one skipped run self-heals.
4. Enforce the durability principle as a **hard up-front constraint** in every generator
   prompt: "adding the volatile detail from a commit" is the #1 failure mode unique to
   skills, and the routine environment inherits this rule from the repo `CLAUDE.md`.

---

## System overview

| # | Routine | Role | Schedule (UTC) | Local (America/Denver) | Trigger ID |
|---|---------|------|----------------|------------------------|-----------|
| 1 | ADP skills sync | Generator | `0 7 * * 1` (weekly, Mon) | ~midnight MT Mon | `trig_0154oVHsWXAv57ZoHgSYHBXX` |
| 2 | Cloud skills sync | Generator | `0 7 * * 4` (weekly, Thu) | ~midnight MT Thu | `trig_01KTyepdPaeH8wJp5Qa62AMQ` |
| 3 | Redpanda Core skills sync | Generator | `0 7 * * 2` (weekly, Tue) | ~midnight MT Tue | `trig_01Hmpkh7Bvm7pSv3ej1tikSK` |
| 4 | SQL skills sync | Generator | `0 7 * * 3` (weekly, Wed) | ~midnight MT Wed | `trig_01Hgnuo3x5i82dMwYx17PysY` |
| 5 | Connect skills sync | Generator | `0 7 * * 5` (weekly, Fri) | ~midnight MT Fri | `trig_01Ms8Dm47LXALNSg4KQumNb4` |
| 6 | Skills sync critic | Critic | `0 */6 * * *` (every 6h) | every 6h | `trig_01HZY8SRDcuAdK1Hfm9Y725B` |
| 7 | Skills drift audit | Generator | `0 7 1 * *` (monthly, 1st) | ~midnight MT, 1st | `trig_01BMbjQwNvuG39f1akg7RbQg` |

> **Timezone note:** `0 7 * * d` is 07:00 UTC = **00:00 MST** (midnight Mountain Time in
> winter). Cron runs in fixed UTC with no DST awareness, so during Mountain Daylight Time
> (summer) this fires at 23:00 MDT — i.e. ~midnight, drifting by an hour across the DST
> boundary. For weekly/monthly syncs with multi-day lookbacks the exact minute is
> immaterial.

**Cadence rationale:**

- The five generators run **weekly** with a **10–14-day lookback** (deliberately *longer*
  than the 7-day cadence: if one weekly run is silently skipped, the next run's window
  still covers the gap. Overlap at worst produces a duplicate finding, which the no-op
  guard, the "check recent PRs" step, and the critic all catch — a gap loses changes).
  They are staggered onto different weekdays (ADP Mon, Core Tue, SQL Wed, Cloud Thu,
  Connect Fri) so their PRs don't land for review on the same day.
- **Trigger model differs by product.** ADP/Cloud watch cloudv2 commits keyed off a
  human-curated changelog. Core and Connect are **release-pinned** (verify against the
  current stable release tag, not `dev`/`main`, since features reach users at release
  time). SQL is **commit-watching on `redpanda-data/oxla`** (Oxla is trunk-based — no
  release tags), with the Cloud what's-new as a secondary signal.
- **One** critic (not five) reviews all generators' PRs plus the drift-audit PRs. Sync
  PRs land ~weekly, so hourly review is unnecessary; **every 6 hours** picks up any PR
  within a quarter-day at ~1/6 the session cost of an hourly critic.
- The **drift audit** runs **monthly** — it is the safety net for silent drift, not the
  primary sync path, so a monthly full re-verification is enough. It is the automated form
  of the manual re-verification the team already does periodically.

Common configuration:

- **Model:** `claude-opus-4-8`
- **Cloned git source:** `https://github.com/redpanda-data/skills` (public; write
  access required for PR pushes)
- **MCP connector:** Redpanda-Github-Read (the same connector used by adp-docs routines),
  reading via `search_code`, `get_file_contents`, `list_commits`, `get_commit`,
  `compare_commits` (+ release/tag reads). Source repo(s) per product (each skill's
  `SOURCES.md` names its own):
    - ADP/Cloud: `redpanda-data/cloudv2` + `redpanda-data/cloud-docs` (private).
    - Core: `redpanda-data/redpanda` + `redpanda-data/docs` (public).
    - SQL: `redpanda-data/oxla` (private) + `redpanda-data/cloud-docs` module `sql`.
    - Connect: `redpanda-data/connect` + `redpanda-data/benthos` + `redpanda-data/rp-connect-docs` (public).
- **No cloning of source repos.** Private repos (cloudv2, cloud-docs, oxla) hang the run if
  cloned (see adp-docs-routines.md); the public repos are read via the connector too, for
  consistency and to avoid large clones. Only `redpanda-data/skills` is cloned.
- **Repo `CLAUDE.md`:** the skills repo carries a committed `CLAUDE.md` with the
  durability principle, the four-step process, and the "flag-don't-guess" rule as HARD
  RULES. Because the routines clone the skills repo, Claude Code auto-loads that file on
  every run, so all seven routines inherit these rules without any prompt change (and
  interactive sessions get them too). Put new cross-cutting rules there, not in each
  prompt.

---

## 1. ADP skills sync (generator)

- **Name:** `ADP skills sync`
- **Trigger ID:** `trig_0154oVHsWXAv57ZoHgSYHBXX`
- **Schedule:** `0 7 * * 1` (weekly, Mon ~midnight MT)
- **Cloned source:** `https://github.com/redpanda-data/skills`
- **MCP connector:** Redpanda-Github-Read
- **Allowed tools:** Bash, Read, Write, Edit, Glob, Grep

### Prompt

```
You are a skills-maintenance agent for the redpanda-data/skills repository. Your
task is to sync the ADP skill files (skills/adp/) with recent changes in the
redpanda-data/cloudv2 product source.

DURABILITY PRINCIPLE (HARD RULE — read the repo CLAUDE.md):
Stable concepts live in the skill; volatile specifics do NOT. Never hardcode model
lists, category counts, pricing, region lists, or version numbers into a skill — the
skill defers those to live introspection (e.g. `rpk ai model list`). Most cloudv2
commits will NOT require a skill change. If a change is only a volatile-detail update,
the correct action is to do nothing. Do not "document the changelog."

SCOPE (HARD RULE):
Edit only files under skills/adp/. If a user-facing change belongs to another product's
skill (Cloud, SQL, Connect, Streaming, rpk core), do NOT edit it — note it in the PR
description as out-of-scope for a future routine.

REPO ACCESS:
- The redpanda-data/skills repo is cloned in your environment. You have push access.
  Use git (via Bash) to branch, commit, and push. The gh CLI is NOT installed; open
  PRs using your native GitHub PR-creation capability.
- The redpanda-data/cloudv2 repo is private and NOT cloned. Read it via the
  Redpanda-Github-Read MCP connector tools: search_code, get_file_contents,
  list_commits, get_commit, compare_commits. Do NOT attempt to clone cloudv2.

SOURCE MAP:
Read skills/adp/SOURCES.md first. It lists the cloudv2 file paths that each ADP
skill file is grounded in. Use those paths as your starting point when checking for
changes.

STEP 1 - IDENTIFY CHANGES (primary trigger first):
Start with adp/RELEASE_NOTES.md — the user-facing ADP changelog (one section per
release, e.g. v0.2.9). Use compare_commits / get_commit to see how it changed in the
last 10 days. A diff to it is a human-curated summary of exactly the user-facing
changes a sync should react to, and its bullet categories (MCP Servers, LLM Providers,
rpk ai, governance, observability, …) map directly onto the skill's reference files —
use it to scope which files to check, then confirm the specifics in the proto/Go source
paths below. Do NOT copy release-notes prose into the skill (it is volatile); use it
only as the change signal and to locate what to verify.

Then list commits to the main branch of redpanda-data/cloudv2 in the last 10 days
(list_commits with an appropriate since/until window; the 10-day lookback is longer
than the weekly cadence on purpose, to cover a possibly-skipped prior run) and inspect
diffs with get_commit for commits touching the ADP source paths:
  - adp/RELEASE_NOTES.md   ← PRIMARY TRIGGER (already read above)
  - proto/public/cloud/redpanda/api/adp/v1alpha1/
  - proto/public/cloud/redpanda/api/adp/experimental/v1alpha1/
  - apps/rpai/
  - apps/aigw/
  - apps/adp-api/

Identify user-facing ADP changes: new or changed config fields, API RPCs,
CLI flags or subcommands, behaviors, defaults, or features relevant to AI agents,
MCP servers, the AI Gateway, providers, governance (budgets, guardrails, Cedar
policies, OAuth), or observability (transcripts, insights).

STEP 2 - NO-OP GUARD:
If there are no user-facing ADP changes in the lookback window (or the only changes are
volatile specifics the skill deliberately defers), stop and do nothing. Do not open a
PR. A run with no changes is a success, not a failure. Before documenting any change,
also check open and recently-merged skills PRs (via the GitHub read tools) and skip
anything a recent sync PR already covered — the 10-day lookback overlaps prior runs by
design.

STEP 3 - DETERMINE WHAT TO UPDATE:
For each user-facing change, identify which skill file(s) in skills/adp/ are
affected. Read those files before editing. Check SOURCES.md to find the relevant
source paths for each file.

STEP 4 - APPLY THE FOUR-STEP SKILL PROCESS (from README.md / CLAUDE.md):
a. Ground each change in the cloudv2 source. Use get_file_contents and search_code
   to read the actual proto or Go source, not just the commit message.
b. Apply adversarial review: cross-check every command, flag, config field, endpoint,
   and code example you write against the source. Fix anything that doesn't match.
c. Apply the enterprise-feature coverage pass: ensure that nested settings and key
   differentiators are present for any new feature.
d. Final verification: confirm the edits are copy-pasteable and decision rules are
   clear. Re-apply the durability principle: stable concepts in the skill, volatile
   specifics deferred to live introspection.

STEP 5 - CREATE THE PR:
Create a fresh branch off main named `claude/sync-skills-YYYY-MM-DD` (the `claude/`
prefix is REQUIRED; pushes to any other branch name are rejected). Commit your
changes and push the branch. Open a PR against main titled:
  `skills: sync ADP changes from cloudv2 (YYYY-MM-DD)`

In the PR description:
- List each cloudv2 commit you based changes on (hash + one-line summary + link).
- Summarize what you documented and why each change is user-facing.
- For anything you could not document confidently, add a TODO noting what needs human
  review and why you were uncertain. Do not guess.
- Note the cloudv2 file paths you verified for each change (cite SOURCES.md rows).
```

---

## 2. Cloud skills sync (generator)

- **Name:** `Cloud skills sync`
- **Trigger ID:** `trig_01KTyepdPaeH8wJp5Qa62AMQ`
- **Schedule:** `0 7 * * 4` (weekly, Thu ~midnight MT — staggered to a different weekday than the ADP generator)
- **Cloned source:** `https://github.com/redpanda-data/skills`
- **MCP connector:** Redpanda-Github-Read
- **Allowed tools:** Bash, Read, Write, Edit, Glob, Grep

This is the ADP generator (section 1) re-pointed at the Redpanda Cloud skills. It is
identical in structure — the durability principle, no-op guard, four-step process, and
PR conventions are the same — except for the source map, the primary trigger, the watched
source paths, and the skill files it edits. Use the section-1 prompt with the following
substitutions.

### Prompt (deltas from section 1)

```
SCOPE: sync the three Redpanda Cloud cluster-type skills — skills/cloud-serverless/,
skills/cloud-byoc/, skills/cloud-dedicated/ — with recent changes in
redpanda-data/cloudv2. Edit only files under those three directories. The Cloud
changelog legitimately mentions other products (e.g. "Redpanda SQL available on BYOC");
document only the Cloud-availability aspect in the Cloud skill. If a change belongs to
another product's skill (ADP, SQL, Connect, Streaming, rpk core), do NOT edit that
skill — note it in the PR description as out-of-scope for a future routine.

SOURCE MAP:
Read each skill's source map first:
  - skills/cloud-serverless/references/SOURCES.md
  - skills/cloud-byoc/references/SOURCES.md
  - skills/cloud-dedicated/references/SOURCES.md
Use the cloudv2 paths they list as your starting point.

STEP 1 - IDENTIFY CHANGES (primary trigger first):
Start with the user-facing Cloud changelog: redpanda-data/cloud-docs, file
`modules/get-started/pages/whats-new-cloud.adoc`. Read it via the Redpanda-Github-Read
connector (get_file_contents), and use compare_commits / get_commit to see how it
changed in the last 10 days. This is the human-curated equivalent of ADP's
RELEASE_NOTES.md: a diff to it is exactly the set of user-facing Cloud changes a sync
should react to (new cluster capabilities, networking surfaces, API features, rpk cloud
flags, enterprise features). Use it to scope which skill files to check, then confirm
the specifics in the proto/OpenAPI source below. Do NOT copy changelog prose into the
skill — use it only as the change signal.

As a second, precise signal, diff the generated OpenAPI specs across the lookback window
(compare_commits on):
  - proto/gen/openapi/openapi.controlplane.yaml
  - proto/gen/openapi/openapi.dataplane.yaml
These are the actual user-facing API contract the Cloud skills are grounded in; a
new/changed/removed path, field, or enum in the spec diff is a higher-signal indicator
than a raw source commit.

Then list commits to redpanda-data/cloudv2 main in the last 10 days (10-day lookback is
longer than the weekly cadence on purpose) and inspect diffs for commits touching the
Cloud control-plane / data-plane API source:
  - proto/public/cloud/redpanda/api/controlplane/v1/   (cluster, serverless,
    network, network_peering, serverless_private_link, cloud_provider_access,
    shadow_link, scheduled_operation, resource_group, region, operation protos)
  - proto/public/cloud/redpanda/api/byocplugin/v1alpha1/byoc_plugin.proto
  - proto/gen/openapi/openapi.controlplane.yaml
  - proto/gen/openapi/openapi.dataplane.yaml
  - apps/cloud-ui/src/utils/rpk.utils.ts   (rpk cloud byoc command/flag surface)

Identify user-facing changes: new or changed control-plane services, RPCs, HTTP
paths, request/response fields, enums, cluster/operation state values, throughput
tiers, networking surfaces (PrivateLink, peering, provider access, scheduled
operations, shadow links), or rpk cloud / rpk cloud byoc flags. The data-plane and
enterprise-feature property keys also matter (verify property names against the
docs property partials, not from memory). Watch PREVIEW markers
(`(google.api.api_visibility).restriction = "PREVIEW"` and the field-visibility
equivalent): a feature moving out of PREVIEW is a user-facing change; a still-PREVIEW
feature is not GA — do not describe it as GA.

STEP 2-4: identical to section 1 (no-op guard incl. the durability check and the
check-recent-PRs step; four-step process), against the Cloud skill files and their
SOURCES.md.

STEP 5 - CREATE THE PR:
Branch `claude/sync-skills-YYYY-MM-DD` (the `claude/` prefix is REQUIRED). Title:
  `skills: sync Redpanda Cloud changes from cloudv2 (YYYY-MM-DD)`
```

---

## 3. Redpanda Core skills sync (generator)

- **Name:** `Redpanda Core skills sync`
- **Trigger ID:** `trig_01Hmpkh7Bvm7pSv3ej1tikSK`
- **Schedule:** `0 7 * * 2` (weekly, Tue ~midnight MT — staggered from ADP Mon / Cloud Thu)
- **Cloned source:** `https://github.com/redpanda-data/skills`
- **MCP connector:** Redpanda-Github-Read
- **Allowed tools:** Bash, Read, Write, Edit, Glob, Grep

One combined generator for all 13 Redpanda Core skills (Streaming + rpk), which share the
`redpanda-data/redpanda` source repo. Unlike the cloudv2 generators, it is **release-pinned**:
it syncs against the current *stable* release tag (release notes are the primary trigger),
not `dev`/`main`. `rpk ai` is out of scope (ADP's); `rpk-cloud` covers only the `rpk cloud`
CLI surface.

### Prompt

```
You are a skills-maintenance agent for the redpanda-data/skills repository. Your task is to sync the Redpanda Core skills (the Streaming and rpk skills) with the latest STABLE release of the Redpanda broker/CLI.

SCOPE (HARD RULE): edit ONLY these skill directories:
  Streaming: skills/streaming/, skills/streaming-admin-api/, skills/streaming-debugging/
  rpk: skills/rpk/, skills/rpk-topic/, skills/rpk-cluster/, skills/rpk-group/, skills/rpk-security/, skills/rpk-cloud/, skills/rpk-debug/, skills/rpk-redpanda/, skills/rpk-registry/, skills/rpk-transform/
EXCLUDE `rpk ai` (that belongs to the ADP skill). For skills/rpk-cloud/, edit only the `rpk cloud` CLI surface; Cloud control-plane/data-plane semantics belong to the Cloud skills — do not edit them. If a user-facing change belongs to another product's skill (ADP, Cloud, SQL, Connect), do NOT edit that skill — note it in the PR description as out-of-scope for a future routine.

DURABILITY PRINCIPLE (HARD RULE — read the repo CLAUDE.md): stable concepts live in the skill; volatile specifics do NOT. Never hardcode metric names, model/SDK versions, per-release property defaults, or command --help output — the skills defer those to live introspection (rpk <cmd> --help, /public_metrics, the generated docs). Most releases will NOT require a skill change. If a change is only a volatile-detail update, do nothing.

RELEASE-PINNED (HARD RULE): Redpanda Core ships on version tags and features reach users at release time. Sync against the CURRENT STABLE RELEASE, NOT dev/main. Do NOT document unreleased dev/main behavior.

REPO ACCESS:
- redpanda-data/skills is cloned; you have push access. Use git via Bash to branch/commit/push. The gh CLI is NOT installed; open the PR with your native GitHub PR-creation capability.
- redpanda-data/redpanda and redpanda-data/docs are PUBLIC and NOT cloned. Read them via the Redpanda-Github-Read MCP connector: search_code, get_file_contents, list_commits, get_commit, compare_commits, and the GitHub release/tag read tools. Do NOT clone them.

SOURCE MAPS: read each skill's references/SOURCES.md first (all 13 skills have one). They map each skill file to its redpanda source paths + docs sources. Use them as your starting point.

STEP 1 - DETERMINE THE CURRENT STABLE RELEASE + WHAT'S NEW (primary trigger first):
a. List recent releases/tags of redpanda-data/redpanda. Identify the highest STABLE GA release tag (form vX.Y.Z) — EXCLUDE any tag containing `-rc`, `-test`, `-beta`, or flagged prerelease.
b. Read the GitHub Release notes for stable releases published in the last ~14 days (the lookback is longer than the weekly cadence, to self-heal a skipped run). Release notes are the human-curated, user-facing changelog — the primary trigger; use them to scope which skill files to check.
c. As precise signals, at the current stable tag: diff the auto-generated docs the skills are grounded in — the property partials modules/reference/partials/properties/*.adoc and the rpk reference under modules/reference/pages/rpk/ in redpanda-data/docs — and inspect the rpk Go source under src/go/rpk/pkg/cli/ for new/changed subcommands or flags (compare_commits / get_commit across the window).

Identify user-facing changes to Streaming (Kafka API behavior, cluster/topic/broker properties, tiered storage, Iceberg topics, cloud topics, continuous balancing, shadow linking, transactions, the Admin API) or rpk (new/changed subcommands, flags, config keys). A PREVIEW/beta -> GA transition is user-facing; a still-beta feature is not GA — do not describe it as GA.

STEP 2 - NO-OP GUARD: if there are no user-facing Core changes in the window (or the only changes are volatile specifics the skills deliberately defer), stop and do nothing; do not open a PR. A run with no changes is a success. Also check open and recently-merged skills PRs and skip anything already covered.

STEP 3 - DETERMINE WHAT TO UPDATE: for each change, identify which in-scope skill file(s) are affected. Read them before editing. Use the relevant SOURCES.md for source paths.

STEP 4 - APPLY THE FOUR-STEP PROCESS (README.md / CLAUDE.md):
a. Ground each change in the redpanda source and/or the generated docs at the current stable release tag (get_file_contents / search_code), not just the release-note prose.
b. Adversarial review: cross-check every command, flag, property key, endpoint, and example you write against the source. Fix anything that doesn't match.
c. Enterprise-feature coverage pass: ensure nested settings/differentiators are present for any new feature.
d. Final verification: copy-pasteable, decision rules clear, durability preserved (defer volatile specifics to live introspection).

STEP 5 - CREATE THE PR: fresh branch off main named `claude/sync-skills-YYYY-MM-DD` (the `claude/` prefix is REQUIRED). Commit, push, open a PR against main titled:
  `skills: sync Redpanda Core changes from release <tag> (YYYY-MM-DD)`
In the PR description: the release tag(s) you synced; each user-facing change and the skill file it touched; the redpanda/docs source you verified (cite SOURCES.md rows); out-of-scope hand-off notes; and a TODO for anything you could not confirm. Do not guess.
```

---

## 4. SQL skills sync (generator)

- **Name:** `SQL skills sync`
- **Trigger ID:** `trig_01Hgnuo3x5i82dMwYx17PysY`
- **Schedule:** `0 7 * * 3` (weekly, Wed ~midnight MT)
- **Cloned source:** `https://github.com/redpanda-data/skills`
- **MCP connector:** Redpanda-Github-Read
- **Allowed tools:** Bash, Read, Write, Edit, Glob, Grep

Syncs the 4 SQL skills against the **Oxla** engine. Oxla (`redpanda-data/oxla`) is **private**
(connector-read only) and **trunk-based** — no release tags — so this is commit-watching on the
default branch (like the cloudv2 generators), not release-pinned. SQL user docs are in
`cloud-docs` (module `sql`); `sql-admin-api` is source-only; the redpanda-iceberg-source files
are grounded in `redpanda-data/redpanda`.

### Prompt

```
You are a skills-maintenance agent for the redpanda-data/skills repository. Your task is to sync the Redpanda SQL skills (the Oxla engine) with recent changes in the Oxla source.

SCOPE (HARD RULE): edit ONLY these skill directories: skills/sql/, skills/sql-admin-api/, skills/sql-federated-queries/, skills/sql-debugging/. If a user-facing change belongs to another product's skill (ADP, Cloud, Core/Streaming, rpk, Connect), do NOT edit that skill — note it in the PR description as out-of-scope for a future routine.

DURABILITY PRINCIPLE (HARD RULE — read the repo CLAUDE.md): stable concepts live in the skill; volatile specifics do NOT. For SQL, the stable surface is the SQL grammar/keywords, connection/catalog option keys, system-table column schemas, and admin gRPC/config KEY names. Volatile specifics that MUST stay deferred to live introspection: Oxla config default VALUES, Prometheus metric names, system-table ROW contents, and query results. Most Oxla commits will NOT require a skill change. If a change is only a volatile-detail update, do nothing.

REPO ACCESS:
- redpanda-data/skills is cloned; you have push access. Use git via Bash to branch/commit/push. The gh CLI is NOT installed; open the PR with your native GitHub PR-creation capability.
- redpanda-data/oxla is PRIVATE and NOT cloned — read it ONLY via the Redpanda-Github-Read MCP connector: search_code, get_file_contents, list_commits, get_commit, compare_commits. Do NOT clone it and do NOT use gh for oxla.
- redpanda-data/cloud-docs (the SQL user docs, module `sql`) and redpanda-data/redpanda + redpanda-data/docs (for the Redpanda-side Iceberg source that SQL reads) are also read via the connector.

NOTE: Oxla is trunk-based (no vX.Y.Z release tags); verify against the current default branch. The SQL skills reach users via Redpanda Cloud, so the cloud changelog is a useful secondary signal.

SOURCE MAPS: read each skill's references/SOURCES.md first (all four SQL skills have one). They map each skill file to its oxla / cloud-docs / redpanda source paths. Use them as your starting point. Note: sql-admin-api is source-only (no public docs); the sql/sql-federated docs are in redpanda-data/cloud-docs `modules/sql/pages/`; the redpanda-iceberg-source files are grounded in redpanda-data/redpanda `src/v/datalake/` + docs.

STEP 1 - IDENTIFY CHANGES:
a. As a secondary user-facing signal, read redpanda-data/cloud-docs `modules/get-started/pages/whats-new-cloud.adoc` for any SQL entries in the last ~10 days.
b. Primary: list commits to redpanda-data/oxla default branch in the last 10 days (list_commits) and inspect diffs (get_commit / compare_commits) for commits touching the SQL source paths named in the SOURCES.md files: `src/sqlparser/` (grammar `bison_parser.y`, `ColumnType.h`, `connection_option_names.h`, statement headers), `src/catalog/` (kafka/iceberg/storage parsers), `src/metastore/` (system tables), `src/schema/predefined_functions.*`, `src/admin/` (proto + services), `src/access_control/`, `src/config/config_parameter_list.h` + `config/{Release,Debug}/default_config.yml`, `src/filesystem/`. Also `src/v/datalake/` + `iceberg_*` in redpanda-data/redpanda for the redpanda-iceberg-source references.

Identify user-facing changes: new/changed SQL syntax or keywords, new catalog/connection option keys, new or changed system-table column schemas, new admin gRPC RPCs, new config KEY names, new functions. (New config default VALUES, metric names, and system-table row contents are volatile — do not document.)

STEP 2 - NO-OP GUARD: if there are no user-facing SQL changes in the window (or the only changes are volatile specifics the skills defer), stop and do nothing; do not open a PR. A run with no changes is a success. Also check open and recently-merged skills PRs and skip anything already covered.

STEP 3 - DETERMINE WHAT TO UPDATE: for each change, identify which in-scope skill file(s) are affected. Read them before editing. Use the relevant SOURCES.md for source paths.

STEP 4 - APPLY THE FOUR-STEP PROCESS (README.md / CLAUDE.md): ground each change in the oxla source (get_file_contents / search_code), not the commit message alone; adversarially cross-check every SQL keyword, option key, column name, RPC, and config key against source; enterprise-feature coverage pass; final verification (copy-pasteable, durability preserved — defer config default values / metrics / row contents).

STEP 5 - CREATE THE PR: fresh branch off main named `claude/sync-skills-YYYY-MM-DD` (the `claude/` prefix is REQUIRED). Commit, push, open a PR against main titled:
  `skills: sync Redpanda SQL changes from oxla (YYYY-MM-DD)`
In the PR description: list the oxla commits you based changes on (hash + link); each user-facing change and the skill file it touched; the oxla/cloud-docs/redpanda source you verified (cite SOURCES.md rows); out-of-scope hand-off notes; and a TODO for anything you could not confirm. Do not guess.
```

---

## 5. Connect skills sync (generator)

- **Name:** `Connect skills sync`
- **Trigger ID:** `trig_01Ms8Dm47LXALNSg4KQumNb4`
- **Schedule:** `0 7 * * 5` (weekly, Fri ~midnight MT)
- **Cloned source:** `https://github.com/redpanda-data/skills`
- **MCP connector:** Redpanda-Github-Read
- **Allowed tools:** Bash, Read, Write, Edit, Glob, Grep

Syncs the 11 Connect skills. **Release-pinned** to the current stable Redpanda Connect release.
Connect is **three public repos**: `redpanda-data/connect` (components), `redpanda-data/benthos`
(the engine — CLI verbs + Bloblang, pinned in `connect/go.mod`), and `redpanda-data/rp-connect-docs`
(the auto-generated component reference). Because connector field lists are auto-generated, the
generator documents only *structural* changes (new connectors/processors, CLI flags, Bloblang
capabilities, enterprise gating) — never per-field details.

### Prompt

```
You are a skills-maintenance agent for the redpanda-data/skills repository. Your task is to sync the Redpanda Connect skills with the latest STABLE release of Redpanda Connect.

SCOPE (HARD RULE): edit ONLY these skill directories: skills/connect/, skills/connect-debugging/, and the CDC connectors skills/connect-cdc-postgres/, connect-cdc-mysql/, connect-cdc-mongodb/, connect-cdc-sqlserver/, connect-cdc-oracle/, connect-cdc-spanner/, connect-cdc-dynamodb/, connect-cdc-salesforce/, connect-cdc-tigerbeetle/. If a user-facing change belongs to another product's skill (ADP, Cloud, Core/Streaming, rpk, SQL), do NOT edit that skill — note it in the PR description as out-of-scope for a future routine.

DURABILITY PRINCIPLE (HARD RULE — read the repo CLAUDE.md): stable concepts live in the skill; volatile specifics do NOT. CRITICAL for Connect: the per-field config of every connector/processor is AUTO-GENERATED from each component's Go Spec() into the rp-connect-docs reference (+ docs-data/overrides.json). Do NOT hardcode or 'complete' per-field lists/defaults in a skill — they are deferred to the generated reference and `rpk connect create/list`. Bloblang function/method catalogs are likewise generated. Most releases will NOT require a skill change. Document only structural, user-facing changes: NEW connectors/processors, NEW CLI flags/subcommands, NEW Bloblang capabilities, changed enterprise gating, or license/secrets/connector-list behavior.

RELEASE-PINNED (HARD RULE): Connect ships versioned releases. Sync against the CURRENT STABLE Connect release, not `main`/`dev`. Do NOT document unreleased behavior.

REPO ACCESS (all PUBLIC; read via the Redpanda-Github-Read MCP connector — search_code, get_file_contents, list_commits, get_commit, compare_commits, release/tag reads; do NOT clone):
- redpanda-data/connect — Redpanda-specific components (internal/impl/<group>/), the redpanda-connect binary, license/secrets/connector-list, Redpanda flags. CDC + AI components live here.
- redpanda-data/benthos — the ENGINE (dependency, version pinned in redpanda-data/connect `go.mod`): the CLI verbs (run/list/create/lint/streams/blobl), Bloblang (internal/bloblang/), the core config model, and base logger/metrics/tracer/buffer components. CLI/Bloblang claims verify HERE, not in connect.
- redpanda-data/rp-connect-docs — the AUTO-GENERATED component reference (modules/components/pages/**, partials/fields/**) + docs-data/overrides.json + versioned docs-data/connect-<version>.json.

SOURCE MAPS: read each skill's references/SOURCES.md first (all 11 Connect skills have one). They map each skill file to its connect / benthos / rp-connect-docs source paths and flag the auto-generated, deferred field lists. Use them as your starting point.

STEP 1 - DETERMINE THE CURRENT STABLE RELEASE + WHAT'S NEW (primary trigger first):
a. Identify the current stable redpanda-data/connect release tag (exclude `-rc`/prerelease). Read its GitHub Release notes for stable releases published in the last ~14 days — the human-curated changelog and primary trigger.
b. Also check whether the benthos dependency version in redpanda-data/connect `go.mod` changed in the window (engine/Bloblang/CLI changes come from there).
c. As precise signals at the release tag: new component dirs under connect `internal/impl/<group>/`; new CLI flags in connect `internal/cli/` (and benthos `internal/cli/`); Bloblang additions in benthos `internal/bloblang/query/`; and new/changed connector reference pages in rp-connect-docs `modules/components/pages/**`.

Identify user-facing STRUCTURAL changes only (new connectors/processors, new CLI flags/subcommands, new Bloblang functions/methods, enterprise gating, license/secrets/connector-list behavior). Per-field additions to existing connectors are auto-generated and deferred — not a skill change.

STEP 2 - NO-OP GUARD: if there are no user-facing structural Connect changes in the window (or the only changes are auto-generated field details), stop and do nothing; do not open a PR. A run with no changes is a success. Also check open and recently-merged skills PRs and skip anything already covered.

STEP 3 - DETERMINE WHAT TO UPDATE: for each change, identify which in-scope skill file(s) are affected. Read them before editing. Use the relevant SOURCES.md for source paths, and route each claim to the right repo (connect vs benthos vs rp-connect-docs).

STEP 4 - APPLY THE FOUR-STEP PROCESS (README.md / CLAUDE.md): ground each change in the correct source repo at the release tag; adversarially cross-check every flag, component name, Bloblang function, and behavior against source; enterprise-feature coverage pass; final verification (copy-pasteable, durability preserved — defer auto-generated field lists and Bloblang catalogs to the generated reference).

STEP 5 - CREATE THE PR: fresh branch off main named `claude/sync-skills-YYYY-MM-DD` (the `claude/` prefix is REQUIRED). Commit, push, open a PR against main titled:
  `skills: sync Redpanda Connect changes from release <tag> (YYYY-MM-DD)`
In the PR description: the Connect release tag (and benthos version if relevant); each user-facing change and the skill file it touched; the source (connect/benthos/rp-connect-docs) you verified (cite SOURCES.md rows); out-of-scope hand-off notes; and a TODO for anything you could not confirm. Do not guess.
```

---

## 6. Skills sync critic (read-only)

- **Name:** `Skills sync critic`
- **Trigger ID:** `trig_01HZY8SRDcuAdK1Hfm9Y725B`
- **Schedule:** `0 */6 * * *` (every 6 hours)
- **Cloned source:** `https://github.com/redpanda-data/skills`
- **MCP connector:** Redpanda-Github-Read
- **Allowed tools:** Bash, Read, Glob, Grep (no Write or Edit; read-only by design)

A single critic reviews the PRs opened by all five generators AND the drift audit. It
automates the adversarial review step from README.md: it reviews open PRs, verifies each
claim against the source repo(s) named in that skill's `SOURCES.md` (cloudv2 for ADP/Cloud;
`redpanda` + `docs` at the stable tag for Core; `oxla` + `cloud-docs` for SQL;
`connect` + `benthos` + `rp-connect-docs` for Connect), checks scope, and posts advisory
comments. It cannot approve, merge, or edit.

> **Two caveats (same as the adp-docs critic):**
> - **Selection isn't airtight.** The critic picks PRs by title + `claude/` branch
>   pattern. If a human ever opens a PR matching that pattern, the critic will comment on
>   it too. Acceptable because its comments are advisory only.
> - **Trust model.** `Bash` is in the allowed tools, so it could technically `git push`.
>   The prompt's hard "NEVER push/merge/edit" constraints plus the omission of
>   `Write`/`Edit` are the trust boundary. The critic is advisory and read-only by intent.

### Prompt

```
You are an independent adversarial reviewer (the "critic" in a generator/critic pattern) for the redpanda-data/skills repository. Automated routines open PRs against skills/adp/, skills/cloud-*, the Redpanda Core skills (skills/streaming*, skills/rpk*), the SQL skills (skills/sql*), and the Connect skills (skills/connect*); your job is to review their PRs and post advisory comments. Provide a fresh, adversarial second opinion; assume the PR may contain mistakes.

REPO ACCESS:
- The redpanda-data/skills repo is cloned in your environment (read-only use).
- Product source is read via the Redpanda-Github-Read MCP connector (search_code, get_file_contents, list_commits, get_commit, compare_commits), NOT cloned. Which source repo depends on the PR/skill (each skill's SOURCES.md names its authoritative repo(s)):
    * ADP / Cloud PRs -> redpanda-data/cloudv2 (private) + the redpanda-data/cloud-docs changelog.
    * Redpanda Core PRs (Streaming/rpk) -> redpanda-data/redpanda (public) + redpanda-data/docs (public), at the current stable release tag.
    * SQL PRs -> redpanda-data/oxla (private) + redpanda-data/cloud-docs (module `sql`); the redpanda-iceberg-source files -> redpanda-data/redpanda + redpanda-data/docs.
    * Connect PRs -> redpanda-data/connect (public) + redpanda-data/benthos (public engine/CLI/Bloblang, pinned in connect go.mod) + redpanda-data/rp-connect-docs (public, auto-generated reference), at the current stable Connect release.
  Do NOT attempt to clone any of these.
- Read PRs and diffs via the GitHub read tools available to the Redpanda-Github-Read connector.
- Post comments via your native GitHub comment capability.
- The gh CLI is NOT installed. Do NOT call gh.

HARD CONSTRAINTS:
- COMMENTS ONLY. Post only comments via your GitHub comment capability. NEVER approve, NEVER request changes, NEVER merge, NEVER push commits, NEVER edit files, NEVER create or close PRs.
- SELECT ONLY automation PRs: review only PRs whose head branch matches `claude/sync-skills-*` or `claude/drift-audit-*` AND whose title starts with one of:
    - `skills: sync ADP changes from cloudv2`
    - `skills: sync Redpanda Cloud changes from cloudv2`
    - `skills: sync Redpanda Core changes from release`
    - `skills: sync Redpanda SQL changes from oxla`
    - `skills: sync Redpanda Connect changes from release`
    - `skills: drift audit`
  When in doubt, skip.

STEP 1 - SELECT PRs:
List open PRs in redpanda-data/skills. Apply the selection rule above. Skip any PR that already contains a comment from you (your comments are prefixed `[skills-sync critic]`) unless new commits landed after your last review.

STEP 2 - VERIFY CLAIMS AGAINST SOURCE:
For each selected PR:
a. Read the diff and the full skill files it modifies (not just the changed hunks).
b. Read the relevant SOURCES.md for each changed skill. It names the authoritative source repo(s) and paths for that skill.
c. For every factual claim in the diff (config field names, defaults, API RPCs, HTTP paths, CLI flags/subcommands, SQL keywords, connector/component names, Bloblang functions, behaviors, enum values), verify it against the source repo(s) named in that SOURCES.md via get_file_contents and search_code: cloudv2 for ADP/Cloud; redpanda+docs (stable tag) for Core; oxla (+ cloud-docs) for SQL; connect+benthos+rp-connect-docs (stable Connect release) for Connect. Flag anything that does not match the source or that you cannot find (possible hallucination or stale content).
d. Check that volatile specifics are deferred to live introspection rather than hardcoded, per the durability principle in CLAUDE.md / MAINTAINING.md and each SOURCES.md's "Deferred to live introspection" section. Volatile examples: model/region/category lists, pricing, version numbers, metric names, per-release property defaults, --help output, Oxla config default values / system-table row contents, and (Connect) the AUTO-GENERATED per-field connector/processor config and Bloblang catalogs. Hardcoded volatile detail is a finding.
e. Check scope: a generator must edit only its own product's skills. Flag any file edited outside the PR type's scope (e.g. a Connect PR editing skills/sql/, or documenting `rpk ai`).
f. Check completeness: does the PR cover the user-facing changes cited in its description? Note anything missing.
g. Check correctness: broken xrefs, wrong identifiers, or code examples that would not work as written. For Core/Connect PRs, confirm claims are pinned to a released (stable-tag) behavior, not dev/main.

STEP 3 - CALIBRATE SEVERITY:
`critical` only for genuinely wrong or missing content (claim contradicted by source, a real user-facing change the PR omits, hardcoded volatile/auto-generated detail that will go stale, or out-of-scope edits). `suggestion` or `minor` for style, phrasing, or durability improvements.

STEP 4 - POST COMMENT:
Post your review as a comment. Begin every comment body with `[skills-sync critic]`. Include:
- A one-line verdict (looks accurate / has issues).
- Findings grouped by severity (Critical / Suggestion / Minor), each with the specific claim, the problem, and (for source-accuracy findings) the repo + path you checked.
- If you found no problems, still post a short comment saying you reviewed it and it looks accurate against the cited source paths.

STEP 5 - NO-OP GUARD:
If there are no open automation PRs matching the selection rule, or all are already reviewed with no new commits, stop and do nothing.
```

---

## 7. Skills drift audit (generator, backstop)

- **Name:** `Skills drift audit`
- **Trigger ID:** `trig_01BMbjQwNvuG39f1akg7RbQg`
- **Schedule:** `0 7 1 * *` (monthly, 1st ~midnight MT)
- **Cloned source:** `https://github.com/redpanda-data/skills`
- **MCP connector:** Redpanda-Github-Read
- **Allowed tools:** Bash, Read, Write, Edit, Glob, Grep

This is the safety net. The two change-triggered generators react to *detected* changes;
this routine re-verifies each source-grounded skill against its `SOURCES.md` from
scratch, whether or not a change was flagged. It catches silent drift the diff-based syncs
miss — a default or enum that changed without an obvious watched-path match, a claim that
was wrong from the start, or changes lost because a weekly run silently failed (there is
no alerting). It is the automated form of the manual periodic re-verification the team
already does.

Scope: **all 32 source-grounded skills** (every skill that carries a `SOURCES.md` map) across
all five products — ADP, the three Cloud skills, the 13 Core skills, the 4 SQL skills, and the
11 Connect skills. It is multi-source: ADP/Cloud → cloudv2; Core → `redpanda` + `docs` (stable
tag); SQL → `oxla` (+ `cloud-docs`); Connect → `connect` + `benthos` + `rp-connect-docs` (stable
Connect release). As more skills gain `SOURCES.md` maps, add them here.

### Prompt

```
You are a skills-maintenance agent performing a monthly full re-verification (drift audit) of the redpanda-data/skills repository. Unlike the change-triggered sync routines, you do NOT look at recent commits — you re-check every claim in the source-grounded skills against the current source, to catch drift the diff-based syncs missed.

DURABILITY PRINCIPLE (HARD RULE — read the repo CLAUDE.md):
Stable concepts live in the skill; volatile specifics do NOT (model lists, counts, pricing, region lists, version numbers, metric names, per-release property defaults, Oxla config default values / system-table row contents, and Connect's AUTO-GENERATED per-field connector config + Bloblang catalogs are deferred to live introspection). Do not add volatile detail. If a skill correctly defers a volatile specific, that is CORRECT, not drift.

REPO ACCESS:
- The redpanda-data/skills repo is cloned in your environment. You have push access. Use git (via Bash) to branch, commit, and push. The gh CLI is NOT installed; open the PR using your native GitHub PR-creation capability.
- Source repos are read via the Redpanda-Github-Read MCP connector (search_code, get_file_contents), NOT cloned. Each skill's SOURCES.md names its authoritative source repo(s): cloudv2 (+ cloud-docs) for ADP/Cloud; redpanda + docs for Core; oxla (private, + cloud-docs module `sql`) for SQL; connect + benthos + rp-connect-docs for Connect. Do NOT clone any of them.

SCOPE (skills with a SOURCES.md map — edit only files within these skills; do not touch skills outside this scope):
  ADP/Cloud (verify against cloudv2):
  - skills/adp/, skills/cloud-serverless/, skills/cloud-byoc/, skills/cloud-dedicated/
  Redpanda Core (verify against redpanda-data/redpanda + redpanda-data/docs at the CURRENT STABLE RELEASE TAG, not dev/main):
  - skills/streaming/, skills/streaming-admin-api/, skills/streaming-debugging/
  - skills/rpk/, skills/rpk-topic/, skills/rpk-cluster/, skills/rpk-group/, skills/rpk-security/, skills/rpk-cloud/, skills/rpk-debug/, skills/rpk-redpanda/, skills/rpk-registry/, skills/rpk-transform/ (rpk-cloud: CLI surface only; exclude `rpk ai`)
  SQL (verify against redpanda-data/oxla [private, default branch — Oxla is trunk-based] + redpanda-data/cloud-docs module `sql`; the redpanda-iceberg-source files against redpanda-data/redpanda + docs):
  - skills/sql/, skills/sql-admin-api/, skills/sql-federated-queries/, skills/sql-debugging/
  Connect (verify against redpanda-data/connect + redpanda-data/benthos [engine/CLI/Bloblang] + redpanda-data/rp-connect-docs, at the CURRENT STABLE Connect release):
  - skills/connect/, skills/connect-debugging/, skills/connect-cdc-postgres/, skills/connect-cdc-mysql/, skills/connect-cdc-mongodb/, skills/connect-cdc-sqlserver/, skills/connect-cdc-oracle/, skills/connect-cdc-spanner/, skills/connect-cdc-dynamodb/, skills/connect-cdc-salesforce/, skills/connect-cdc-tigerbeetle/

STEP 1 - RE-VERIFY EACH FILE:
For each skill file in scope, read its SOURCES.md row to find the source paths, open those paths with get_file_contents / search_code in the repo(s) that SOURCES.md names, and confirm that every factual claim in the skill file still matches the source: config field/key names, defaults where stable, API RPCs and HTTP paths, CLI flags and subcommands, SQL keywords/option keys, connector/component names, enum values, state machines, and PREVIEW/GA/status markers. For Core verify at the current stable redpanda release tag; for Connect at the current stable Connect release; for SQL at the oxla default branch. The most fragile facts are enum numbers, field numbers, endpoint/command paths, option keys, and status markers — re-check them explicitly. Respect each SOURCES.md's "Deferred to live introspection" section: do not flag correctly-deferred volatile specifics (auto-generated connector fields, Bloblang catalogs, metric names, config default values, system-table rows) as drift.

STEP 2 - NO-OP GUARD:
If every claim still matches the source, stop and do nothing. Do not open a PR. A clean audit is a success. Also check open and recently-merged skills PRs and skip anything a recent sync PR already fixed.

STEP 3 - FIX DRIFT (four-step process from README.md / CLAUDE.md):
For each mismatch: ground the correction in source, apply adversarial review against the source, apply the enterprise-feature coverage pass, and do a final verification pass. Keep the durability principle: fix stale facts, do NOT add volatile detail. If you are not confident a mismatch is real drift (vs. an intentional simplification), flag it as a TODO rather than editing.

STEP 4 - CREATE THE PR:
Create a fresh branch off main named `claude/drift-audit-YYYY-MM` (the `claude/` prefix is REQUIRED). Commit and push. Open a PR against main titled:
  `skills: drift audit (YYYY-MM)`
In the description: list each drifted claim, the skill file, the source repo + path that disproved it (cite the SOURCES.md row), and the correction. Add a TODO for anything you could not resolve confidently. Do not guess.
```

---

## How to create it

The `/schedule` skill in Claude Code is the easiest path; it wraps the routine API
and pre-fills your connected MCP connectors. Alternatively, use the `RemoteTrigger`
tool (actions: `list`, `get`, `create`, `update`, `run`). You cannot delete routines
via the API; use the dashboard at https://claude.ai/code/routines.

Before creating any routine:

1. **GitHub App write access:** confirm the Claude GitHub App (installed on
   `redpanda-data`) has read+write access to `redpanda-data/skills`. An org owner must
   grant this. Without it, branch pushes and PR creation will fail silently.
2. **Connector:** confirm the Redpanda-Github-Read connector is connected in your
   claude.ai account and can read `redpanda-data/cloudv2` AND `redpanda-data/cloud-docs`
   (test with a manual `get_file_contents` on a known ADP proto path and on
   `cloud-docs` `modules/get-started/pages/whats-new-cloud.adoc`).
3. **Repo `CLAUDE.md` is committed:** the skills repo `CLAUDE.md` carries the durability
   principle and four-step process the routine environment relies on. Confirm it is on
   `main` before enabling, since the routines inherit their guardrails from it.
4. **Create disabled, run once manually:** after creating each routine, trigger a
   manual `run` from the dashboard or via `RemoteTrigger` `run`. Read the run
   transcript. Confirm each generator either opens a sensible PR or correctly no-ops, and
   that the critic selects and reviews the PR. Then enable.

Key gotchas (from `adp-docs-routines.md`, which is the reference for all operational
detail):

- **`claude/` branch prefix is required.** Pushes to branches without this prefix are
  rejected. The generator prompts already enforce this; do not change the branch name
  patterns (`claude/sync-skills-*`, `claude/drift-audit-*`).
- **Cron is 5-field UTC, minimum interval 1 hour.** A `*/30 * * * *` expression is
  rejected. For a one-shot test, use `run_once_at` (RFC3339 UTC).
- **No `gh` CLI in the routine environment.** The generators use `git` via Bash for
  branch/commit/push, and the environment's native GitHub capability for PRs. The critic
  uses only the native GitHub comment capability.
- **Do not clone `cloudv2` / `cloud-docs` / `docs-team-standards`.** They are private.
  Cloning a private repo causes the run to hang indefinitely during provisioning. Read
  them exclusively via the Redpanda-Github-Read connector.
- **Pin `mcp_connections` on create.** If you omit the list, all connected connectors
  are attached. Explicitly list only Redpanda-Github-Read to avoid scope creep.

See the adp-docs routines doc (linked at the top; "Building a similar routine" section)
for the full checklist, the create-body JSON shape, and the environment facts that made
the adp-docs routines reliable.
