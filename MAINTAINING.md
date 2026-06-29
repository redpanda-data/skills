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

Each skill area that derives from private source code should carry a source map. The
ADP source map lives at `skills/adp/SOURCES.md`. It records which `cloudv2` file paths
each ADP skill file is grounded in, so a maintainer (or automated routine) knows
exactly where to look when re-verifying.

The same pattern generalizes repo-wide: add a `SOURCES.md` alongside any skill whose
claims need to be traceable to private or versioned source, and reference it from this
file when it exists.

## Proposed automation

`skills-sync-routine.md` (repo root) defines a proposed scheduled routine
(`adp-skill-sync`) that monitors `cloudv2` for ADP changes and opens a PR against
this repo when user-facing updates are detected. It is **not yet created or enabled**;
read that file for the full definition and the steps to create it.

Until the routine is live, syncs are manual: a maintainer reads the relevant
`cloudv2` source paths (listed in `skills/adp/SOURCES.md`), identifies any user-facing
ADP changes since the last skill update, and applies the four-step process above.
