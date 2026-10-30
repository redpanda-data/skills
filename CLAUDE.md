# CLAUDE.md

Guidance for Claude Code (interactive sessions and scheduled routines) working in this
repository. **These instructions override default behavior.**

The scheduled maintenance routines (see `skills-sync-routine.md`) clone this repo in an
isolated cloud environment with no access to any global `~/CLAUDE.md` or plugin. **This
file is the only repo-level guidance they read**, so cross-cutting rules belong here, not
duplicated into each routine prompt.

## About this repo

This is a Claude Code **plugin** named `redpanda`: a set of Agent Skills for Redpanda's
five products — Streaming, SQL (Oxla), Connect, Cloud (Serverless, BYOC, Dedicated), and
the Agentic Data Plane (ADP) — unified by `rpk`. Each skill is a `SKILL.md` (loaded on
demand) plus `references/` files, grounded in Redpanda's own source code, docs, and APIs.
Skills are moving, one at a time, to a thin format whose `references/` holds only
`SOURCES.md` (see "Skill format: thin skills"). Several rules below differ for thin skills and
skills that are not yet thin; each section says which applies.

- `README.md` — what each skill is and how they were built.
- `MAINTAINING.md` — the verification norms and the proposed sync automation.
- `skills-sync-routine.md` — the scheduled-routine definitions.

## HARD RULE: facts go in the docs, behavior goes in skills

A skill tells an agent **how to work**. It does not restate **what is true** about a
product. Users and agents both read the Redpanda docs, so a fact belongs there, where
everyone gets it, and an agent reaches it through the Redpanda Docs MCP server.

**Facts go in the docs:** config fields and properties, CLI flags and commands, defaults,
limits, syntax, API fields and endpoints, error messages, feature behavior, and the steps of
a documented procedure.

**Behavioral guidance goes in skills:** what an agent should do in a specific agentic
scenario, the order to check things in, when to stop and ask the user a follow-up question,
what to confirm before a destructive or irreversible step, when to escalate to a person,
how to use memory and what is worth remembering, and the decision rules and traps an agent
gets wrong without the skill.

A skill whose `references/` holds only `SOURCES.md` is **thin**. Every other skill is **not
yet thin**: it still carries facts, and keeps them up to date under the durability principle and
the verification process below until it is converted. Skills are converted one at a time, each
only after its own evals show which of its facts the docs already cover.

Rules for every change, by routines and people alike:

1. **Never add a new fact to a thin skill.** When a user-facing change ships, update a thin
   skill only if what an agent should *do* changed. If the change is a new or changed fact,
   make no change to a thin skill. A skill that is not yet thin may still gain a fact when a
   user-facing change ships, under the durability principle.
2. **A fact missing from the docs is a docs gap.** Report it (routines: under "Docs gaps" in
   the private provenance report) so the docs are fixed. For a thin skill this is the only
   action: do not work around the gap in the skill.
3. **Any skill may correct or remove a drifted fact**, so it does not tell agents something
   false. In a thin skill, that includes the facts inside a "How to work" line; correct the
   fact without widening the line. Prefer replacing a drifted fact with a pointer to the docs
   page that states it.
4. **A thin skill never gains facts or reference files.** Never add facts to it and never
   recreate a deleted reference file. It gains a new "How to work" line only with a behavioral
   eval case that the baseline fails (see "Skill format: thin skills").

## HARD RULE: the durability principle

**No skill hardcodes volatile specifics.** What a skill may carry depends on its format:

- **A thin skill** carries no API surface at all: CLI flags, service names, config field
  names, endpoint paths, and enum values are facts, and they live in the docs. Its only facts
  are the few a "How to work" line needs to state the behavior.
- **A skill that is not yet thin** documents the *shape and semantics* of an API surface (CLI
  flags, service names, config field names, endpoint paths, enum values, state machines),
  because those are stable across releases, until it is converted.

Neither kind may **hardcode** values that rotate frequently:

- model lists and catalogs
- category counts, pricing, quotas
- region lists
- version numbers

Those are deferred to **live introspection** — the skill tells the agent to run
`rpk ai model list`, `rpk cloud region list`, or the equivalent live surface, rather than
enumerating values that go stale.

Consequence for maintenance: **most product commits do NOT require a skill change.** If a
change is only a volatile-detail update, the correct action is to do nothing. "Documenting
the changelog" — copying a new model, count, or version into a skill — is the single most
common maintenance mistake in this repo. If a skill correctly defers a volatile specific,
that is correct, not a gap.

## HARD RULE: the four-step verification process

Re-apply this on **every** change, not just initial authoring (a partial update that skips
steps 2–4 introduces drift):

1. **Grounded spec.** Identify the authoritative source paths (proto files, Go source,
   golden CLI snapshots, API definitions). Write from the source, not from memory.
2. **Adversarial review at maximum effort.** Cross-check every command, flag, config
   field, endpoint, enum, and code example against the actual source. Assume the draft is
   wrong until the source confirms it.
3. **Coverage pass.** For a skill that is not yet thin, verify that key enterprise
   differentiators and their nested settings are present and accurate. For a thin skill,
   verify the opposite: the skill restates no facts beyond what its "How to work" lines need,
   and every "How to work" line still maps to a source and an eval case in `SOURCES.md`.
   Feature coverage for a thin skill is the docs' job; a missing feature is a docs gap.
4. **Final verification pass.** Read the skill as a user would: examples copy-pasteable,
   decision rules clear. Re-confirm against the live surface where one exists.

For a thin skill, steps 1 and 2 apply to the facts inside "How to work" lines and to the
`SOURCES.md` mapping.

## HARD RULE: flag, don't guess

If you cannot confirm a fact against source — or you're unsure whether a mismatch is real
drift versus an intentional simplification — flag it as a TODO for human review with the
reason. Never guess a field name, default, flag, or endpoint.

## HARD RULE: public-surface rule

This repository is PUBLIC (it ships as an installable plugin), while much of the product
source it documents is PRIVATE (`cloudv2`, `oxla`, and the docs repos `docs`, `cloud-docs`,
`rp-connect-docs`, `adp-docs`); operational detail and routine output live in the docs
team's private `docs-team-standards` repo.
Nothing that identifies private-repo internals may appear on any public surface of this
repo — PR titles, PR descriptions, commit messages, branch names, comments, or committed
files: no private-repo commit SHAs or links, no internal source file paths or proto line
numbers, no internal ticket or RFC IDs, no feature flag/gate names or rollout/gating
status, no mentions of unshipped, in-flight, or reverted features, and no session links.
PR descriptions and commit messages describe only the skill changes themselves, and
routine-generated surfaces (PR titles, descriptions, commits, branches) additionally avoid
naming the private repos at all. **Repo maintenance files** (this file, `MAINTAINING.md`,
`SOURCES.md`, `skills-sync-routine.md`) may name the private repos where the process
requires it.

Two sanctioned exceptions to the internals ban:

- Citations of PUBLIC source repos (`redpanda`, `connect`, `benthos`) — tags, paths,
  commits — are fine anywhere. The docs repos are private (verified 2026-09-14 via the
  GitHub API) and fall under the ban everywhere except the provenance surfaces below.
- `SOURCES.md` files may name the private repos and the source file paths a skill is
  grounded in (the verification process depends on that mapping) — but never commit SHAs,
  tickets, gate names, rollout status, or unshipped surfaces.
- The **provenance header** of a skill file — the leading `Source:` line of a
  `references/*.md` file, and the equivalent line in a `SKILL.md` — may likewise name the
  private repos, source file paths, symbol names, and line numbers a file's claims derive
  from, together with the evidence dates on which they were verified. This is the same
  mapping `SOURCES.md` carries, kept beside the content so the sync and drift-audit
  routines can stamp what they re-verified and when. The same limits apply: no commit
  SHAs, tickets, gate names, rollout status, or unshipped surfaces. Provenance stays in
  that header; the body of a skill file cites public repos only.

Automated routines post their full provenance and review reports to the docs team's
private channel, never to this repo. If the private channel is unreachable, fail the run
loudly and carry the report in the run's final message; never fall back to posting the
content here.

## Source maps

Skills grounded in private or versioned source carry a `SOURCES.md` mapping each skill
file to the exact source paths its claims derive from. **Read the relevant `SOURCES.md`
before editing or verifying any file**, and open the cited paths first.

- ADP: `skills/adp/SOURCES.md` (grounded in the `rpk ai` CLI help and the ADP product docs;
  primary changelog `adp/RELEASE_NOTES.md`). The skill covers the `rpk ai` CLI, the ADP UI,
  and the endpoints applications call.
- Cloud: `skills/cloud-serverless/references/SOURCES.md`,
  `skills/cloud-byoc/references/SOURCES.md`,
  `skills/cloud-dedicated/references/SOURCES.md` (grounded in
  `proto/public/cloud/redpanda/api/controlplane/v1/`, the byoc-plugin proto, and the
  generated `proto/gen/openapi/openapi.{controlplane,dataplane}.yaml`; the user-facing
  Cloud changelog is `cloud-docs/modules/get-started/pages/whats-new-cloud.adoc`).

When adding a source-grounded skill, add a `SOURCES.md` beside it and list it here.

## Frontmatter and size standards (CI-enforced)

`.github/workflows/validate-skills.yml` runs on every PR that touches `skills/**`;
errors block merge, warnings surface in the check summary. Follow the
[Agent Skills spec](https://agentskills.io/specification):

- `name` matches the skill's directory name exactly: lowercase letters, numbers, and
  single hyphens only; 1–64 characters.
- `description` is 1–1,024 characters of prose: one sentence on what the skill does, a
  "Use when …" sentence carrying the strongest trigger keywords, and any "For X, see
  `/redpanda:Y`" negative-routing pointers. No comma-separated keyword lists — the
  validator flags them as keyword stuffing.
- Keep `SKILL.md` under 500 lines. In a skill that is not yet thin, move detail into
  `references/` files and link them from the Reference Directory section. A thin skill has
  no reference files besides `SOURCES.md`: detail belongs in the docs, not in `references/`.
- Every skill ships a `SOURCES.md` (under `references/`, or at the skill root like
  `adp`); CI fails without one.

## Skill format: thin skills

The plugin ships the Redpanda Docs MCP server (`.mcp.json`), so a skill does not restate
the docs. The evals in `evals/` measure what a skill adds over the docs, and a skill keeps
only that. A skill in this format has two sections:

1. **How to work.** A product-specific procedure: ordered checks, decision rules, what to
   confirm before a destructive or irreversible step, when to stop and escalate. Leave out
   generic good practice that a model follows unprompted. Each procedure is tested by a
   behavioral eval case that the baseline fails.
2. **Use the docs for everything else.** Point the agent at the Docs MCP for config fields,
   flags, defaults, syntax, and procedures, and at the page's Markdown twin (`<page>.md`)
   when the server is unavailable.

Facts go in the docs, not the skill. When an eval shows the docs lack a fact or state it
wrongly, the fix is a docs change. A thin `SKILL.md` is as short as its proven procedures allow,
and `references/` holds only `SOURCES.md`, which maps each "How to work" line to its source and
its eval case id. A behavioral case counts only if it grades the outcome, its mocks answer every
legitimate command, and the baseline still fails it. If no procedure for a product survives that
test, the skill carries none and points at the docs; whether to keep such a skill at all is a
maintainer decision. When a sync routine finds a user-facing change, it updates "How to work"
only if the procedure changed (see "HARD RULE: facts go in the docs, behavior goes in skills").

**Adding a "How to work" line, or changing what one tells the agent to do.** The routines cannot
run the evals, so:

1. A routine (or person) proposes the line together with a draft behavioral case in
   `evals/suites/<skill>.eval.json`, and adds the line, its source, and the case id to
   `SOURCES.md`. A proposal without a draft case is not made.
2. The PR stays unmerged until a maintainer runs the case
   (`node evals/run-evals.mjs --case <id> --arms baseline,skill,installed`, see
   `evals/README.md`) and the baseline fails it while the skill arms pass. No CI job runs the
   evals; the maintainer records the pass rates in the PR.
3. If the baseline passes, the line is general knowledge: drop it, and keep the case only if
   it guards a real misroute.

Correcting a drifted fact inside an existing line (rule 3) needs no new case.

## Maturity and PREVIEW markers

Do not invent maturity labels. In the Cloud/ADP protos, a feature gated by
`(google.api.api_visibility).restriction = "PREVIEW"` (or the field-visibility
equivalent) is **not GA** — do not describe it as generally available. A feature moving
out of PREVIEW is a user-facing change worth reflecting. When a feature's maturity is
ambiguous or looks like a product decision, flag it for a human rather than labeling it.

## Working with source (interactive and routine environments)

- `redpanda-data/cloudv2`, `redpanda-data/cloud-docs`, and
  `redpanda-data/docs-team-standards` are **private**. Read them via the
  Redpanda-Github-Read MCP connector (`search_code`, `get_file_contents`, `list_commits`,
  `get_commit`, `compare_commits`). **Do not clone them** — cloning a private repo hangs
  the routine environment during provisioning.
- In the routine environment the `gh` CLI is **not installed**. Use `git` via Bash for
  branch/commit/push, and the environment's native GitHub capability for PRs and comments.
- Branch names pushed from the routine environment **must be `claude/`-prefixed**
  (`claude/sync-skills-*`, `claude/drift-audit-*`); other names are rejected.

## Git operations

Confirm the working directory before any git or `gh` command. Create a fresh branch off
`main` for a new PR; do not reuse an existing feature branch. Confirm the target remote and
branch before pushing, and wait for maintainer confirmation before committing or pushing
unless explicitly told to proceed.
