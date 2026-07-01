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

- `README.md` — what each skill is and how they were built.
- `MAINTAINING.md` — the verification norms and the proposed sync automation.
- `skills-sync-routine.md` — the scheduled-routine definitions.

## HARD RULE: the durability principle

**Stable concepts live in the skill; volatile specifics do NOT.** A skill documents the
*shape and semantics* of an API surface — CLI flags, service names, config field names,
endpoint paths, enum values, state machines — because those are stable across releases.
It must **never hardcode** values that rotate frequently:

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
3. **Enterprise-feature coverage pass.** Verify key differentiators and their nested
   settings are present and accurate.
4. **Final verification pass.** Read the skill as a user would: examples copy-pasteable,
   decision rules clear. Re-confirm against the live surface where one exists.

## HARD RULE: flag, don't guess

If you cannot confirm a fact against source — or you're unsure whether a mismatch is real
drift versus an intentional simplification — flag it as a TODO for human review with the
reason. Never guess a field name, default, flag, or endpoint.

## Source maps

Skills grounded in private or versioned source carry a `SOURCES.md` mapping each skill
file to the exact source paths its claims derive from. **Read the relevant `SOURCES.md`
before editing or verifying any file**, and open the cited paths first.

- ADP: `skills/adp/SOURCES.md` (grounded in `proto/public/cloud/redpanda/api/adp/`,
  `apps/rpai/`, `apps/aigw/`, `apps/adp-api/`; primary changelog `adp/RELEASE_NOTES.md`).
- Cloud: `skills/cloud-serverless/references/SOURCES.md`,
  `skills/cloud-byoc/references/SOURCES.md`,
  `skills/cloud-dedicated/references/SOURCES.md` (grounded in
  `proto/public/cloud/redpanda/api/controlplane/v1/`, the byoc-plugin proto, and the
  generated `proto/gen/openapi/openapi.{controlplane,dataplane}.yaml`; the user-facing
  Cloud changelog is `cloud-docs/modules/get-started/pages/whats-new-cloud.adoc`).

When adding a source-grounded skill, add a `SOURCES.md` beside it and list it here.

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
