# ADP Skills Sync Routine Definition

> **THIS IS A PROPOSED DEFINITION. IT IS NOT YET CREATED OR ENABLED.**
> The live routine does not exist until a maintainer creates it following the
> instructions in "How to create it" below. The decision to create and enable the
> routine belongs to the maintainer.

This file is the version-controlled definition of the proposed `adp-skill-sync`
scheduled routine, which monitors `redpanda-data/cloudv2` for ADP changes and opens
a PR against `redpanda-data/skills` when user-facing updates require skill updates.

It follows the same generator/critic pattern as the adp-docs routines, documented at
https://github.com/redpanda-data/docs-team-standards/blob/main/resources/adp-docs-routines.md
which is the reference for all operational gotchas (branch prefix, private-repo read
strategy, no `gh` CLI, and so on).

---

## System overview

Two routines form a generator/critic loop:

| # | Routine | Role | Proposed schedule (UTC) |
|---|---------|------|------------------------|
| 1 | ADP skills sync | Generator | `0 12 * * *` (daily, ~6 AM MT) |
| 2 | ADP skills sync critic | Critic | `0 * * * *` (hourly) |

Common configuration:

- **Model:** `claude-opus-4-8`
- **Cloned git source:** `https://github.com/redpanda-data/skills` (public; write
  access required for PR pushes)
- **MCP connector:** Redpanda-Github-Read
  (the same connector used by adp-docs routines; reads `redpanda-data/cloudv2` via
  `search_code`, `get_file_contents`, `list_commits`, `get_commit`, `compare_commits`).
- **Private repos:** `redpanda-data/cloudv2` is read-only via the connector. It is
  NOT cloned. (Cloning private repos causes runs to hang; see adp-docs-routines.md.)

---

## 1. ADP skills sync (generator)

- **Name:** `ADP skills sync`
- **Schedule:** `0 12 * * *` (daily, ~6 AM MT)
- **Cloned source:** `https://github.com/redpanda-data/skills`
- **MCP connector:** Redpanda-Github-Read
- **Allowed tools:** Bash, Read, Write, Edit, Glob, Grep

### Prompt

```
You are a skills-maintenance agent for the redpanda-data/skills repository. Your
task is to sync the ADP skill files (skills/adp/) with recent changes in the
redpanda-data/cloudv2 product source.

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

STEP 1 - IDENTIFY CHANGES:
Using the Redpanda-Github-Read tools, list commits to the main branch of
redpanda-data/cloudv2 in the last 24 hours (list_commits with an appropriate
since/until window). Inspect diffs and files with get_commit for commits touching
the ADP source paths:
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
If there are no user-facing ADP changes in the last 24 hours, stop and do nothing.
Do not open a PR. A run with no changes is a success, not a failure.

STEP 3 - DETERMINE WHAT TO UPDATE:
For each user-facing change, identify which skill file(s) in skills/adp/ are
affected. Read those files before editing. Check SOURCES.md to find the relevant
source paths for each file.

STEP 4 - APPLY THE FOUR-STEP SKILL PROCESS (from README.md):
a. Ground each change in the cloudv2 source. Use get_file_contents and search_code
   to read the actual proto or Go source, not just the commit message.
b. Apply adversarial review: cross-check every command, flag, config field, endpoint,
   and code example you write against the source. Fix anything that doesn't match.
c. Apply the enterprise-feature coverage pass: ensure that nested settings and key
   differentiators are present for any new feature.
d. Final verification: confirm the edits are copy-pasteable and decision rules are
   clear. Follow the durability principle from MAINTAINING.md: stable concepts in the
   skill, volatile specifics (model lists, category counts) deferred to live
   introspection (rpk ai model list, etc.).

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

## 2. ADP skills sync critic (read-only)

- **Name:** `ADP skills sync critic`
- **Schedule:** `0 * * * *` (hourly)
- **Cloned source:** `https://github.com/redpanda-data/skills`
- **MCP connector:** Redpanda-Github-Read
- **Allowed tools:** Bash, Read, Glob, Grep (no Write or Edit; read-only by design)

This critic automates the adversarial review step from README.md. It reviews open
sync PRs opened by the generator, verifies claims against cloudv2, and posts advisory
comments. It cannot approve, merge, or edit.

### Prompt

```
You are an independent adversarial reviewer (the "critic" in a generator/critic
pattern) for the redpanda-data/skills repository. Two automated routines open PRs
against skills/adp/; your job is to review their PRs and post advisory comments.
Provide a fresh, adversarial second opinion; assume the PR may contain mistakes.

REPO ACCESS:
- The redpanda-data/skills repo is cloned in your environment (read-only use).
- The redpanda-data/cloudv2 repo is private and NOT cloned. Read it via the
  Redpanda-Github-Read MCP connector: search_code, get_file_contents, list_commits,
  get_commit, compare_commits. Do NOT attempt to clone cloudv2.
- Read PRs and diffs via the GitHub read tools available to the Redpanda-Github-Read
  connector.
- Post comments via your native GitHub comment capability.
- The gh CLI is NOT installed. Do NOT call gh.

HARD CONSTRAINTS:
- COMMENTS ONLY. Post only comments via your GitHub comment capability. NEVER
  approve, NEVER request changes, NEVER merge, NEVER push commits, NEVER edit files,
  NEVER create or close PRs.
- SELECT ONLY automation PRs: review only PRs whose title starts with
  `skills: sync ADP changes from cloudv2` AND whose head branch matches
  `claude/sync-skills-*`. When in doubt, skip.

STEP 1 - SELECT PRs:
List open PRs in redpanda-data/skills. Apply the selection rule above. Skip any PR
that already contains a comment from you (your comments are prefixed
`[adp-skills critic]`) unless new commits landed after your last review.

STEP 2 - VERIFY CLAIMS AGAINST SOURCE:
For each selected PR:
a. Read the diff and the full skill files it modifies (not just the changed hunks).
b. Read skills/adp/SOURCES.md to find the cloudv2 paths relevant to each changed
   file.
c. For every factual claim in the diff (config field names, defaults, API RPCs, CLI
   flags, behaviors), verify it against cloudv2 via get_file_contents and
   search_code on redpanda-data/cloudv2. Flag anything that does not match the source
   or that you cannot find (possible hallucination or stale content).
d. Check that volatile specifics (model lists, category counts, pricing) are deferred
   to live introspection rather than hardcoded, per the durability principle in
   MAINTAINING.md.
e. Check completeness: does the PR cover all user-facing changes cited in the PR
   description? Note anything missing.
f. Check correctness: any broken xrefs, wrong identifiers, or code examples that
   would not work as written.

STEP 3 - CALIBRATE SEVERITY:
`critical` only for genuinely wrong or missing content (claim contradicted by
cloudv2 source, or a real user-facing change the PR omits). `suggestion` or `minor`
for style, phrasing, or durability improvements.

STEP 4 - POST COMMENT:
Post your review as a comment. Begin every comment body with `[adp-skills critic]`.
Include:
- A one-line verdict (looks accurate / has issues).
- Findings grouped by severity (Critical / Suggestion / Minor), each with the
  specific claim, the problem, and (for source-accuracy findings) the cloudv2 path
  you checked.
- If you found no problems, still post a short comment saying you reviewed it and it
  looks accurate against the cloudv2 source paths.

STEP 5 - NO-OP GUARD:
If there are no open automation PRs matching the selection rule, or all are already
reviewed with no new commits, stop and do nothing.
```

---

## How to create it

The `/schedule` skill in Claude Code is the easiest path; it wraps the routine API
and pre-fills your connected MCP connectors. Alternatively, use the `RemoteTrigger`
tool (actions: `list`, `get`, `create`, `update`, `run`). You cannot delete routines
via the API; use the dashboard at https://claude.ai/code/routines.

Before creating either routine:

1. **GitHub App write access:** confirm the Claude GitHub App (installed on
   `redpanda-data`) has read+write access to `redpanda-data/skills`. An org owner must
   grant this. Without it, branch pushes and PR creation will fail silently.
2. **Connector:** confirm the Redpanda-Github-Read connector is connected in your
   claude.ai account and can read `redpanda-data/cloudv2` (test with a manual
   `get_file_contents` call on a known ADP proto path).
3. **Create disabled, run once manually:** after creating each routine, trigger a
   manual `run` from the dashboard or via `RemoteTrigger` `run`. Read the run
   transcript. Confirm the generator either opens a sensible PR or correctly no-ops.
   Confirm the critic selects and reviews that PR. Then enable both.

Key gotchas (from `adp-docs-routines.md`, which is the reference for all operational
detail):

- **`claude/` branch prefix is required.** Pushes to branches without this prefix are
  rejected. The generator prompt already enforces this; do not change the branch name
  pattern.
- **Cron is 5-field UTC, minimum interval 1 hour.** A `*/30 * * * *` expression is
  rejected. For a one-shot test, use `run_once_at` (RFC3339 UTC).
- **No `gh` CLI in the routine environment.** The generator uses `git` via Bash for
  branch/commit/push, and the environment's native GitHub capability for PRs and
  comments. The critic uses only the native GitHub comment capability.
- **Do not clone `cloudv2`.** It is private. Cloning a private repo causes the run to
  hang indefinitely during provisioning. Read it exclusively via the
  Redpanda-Github-Read connector.
- **Pin `mcp_connections` on create.** If you omit the list, all connected connectors
  are attached. Explicitly list only Redpanda-Github-Read to avoid scope creep.

See the adp-docs routines doc (linked at the top; "Building a similar routine" section) for the full
checklist, the create-body JSON shape, and the environment facts that made the
adp-docs routines reliable.
