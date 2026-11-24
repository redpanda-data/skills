---
name: redpanda-solutions
description: >-
  Applies a Redpanda Solutions reference architecture to the user's own
  repository and production environment by finding the solution that matches
  their use case and following its agent companion. Use when a user wants to
  build a streaming pattern on Redpanda and asks whether Redpanda has a
  reference design, blueprint, or worked example for it, wants to take a
  Redpanda solution to production, or pastes a "Take this design to
  production" prompt. For product facts such as topic, client, and Connect
  configuration, see `/redpanda:streaming` and `/redpanda:connect`.
---

# Redpanda Solutions

Redpanda Solutions are reference architectures published with the Redpanda docs. Each one has
an agent companion: a Markdown file with the design's rules, what to adapt in a target
repository, and how to prove the result. The companion carries the whole procedure. This skill
only finds the right companion and gets it intact.

## How to work

**Find the solution in the catalog, not from memory.** Download the catalog with this one
command, exactly as written: `curl -sf https://docs.redpanda.com/assets/data/solutions.json`.
Each entry in `solutions` has an `id`, a `title`, a `description`, `useCases`, `technologies`,
and `platforms`. Match the user's use case against those fields, and check `platforms` against
where the user runs Redpanda. If the user already named a solution or gave a companion URL, use
it and skip the matching. If the user gave another docs origin, such as a preview, use that
origin in every URL instead of `https://docs.redpanda.com`.

**Ask when more than one fits, and say so when none does.** If two or more solutions fit, name
each with one line on how it differs, and ask the user to choose. If none fits, tell the user
that no Redpanda solution covers this use case. Do not stretch the nearest one onto the
repository: help with the product skills and the docs instead.

**Get the companion in full, one plain command per file.** Run
`curl -sf https://docs.redpanda.com/solutions/<id>/agent-companion.md` with no pipes,
redirects, `cd`, or temporary directories. The download failed if curl exits non-zero or the
output does not start with `# Agent companion:` (an HTML page means a wrong URL). Then stop and
tell the user. A long companion comes in parts: its "How to use this" lists each
`agent-companion-part-<n>.md` with the command to fetch it, and each part must start with
`# Agent companion part`. Fetch every part before you plan. Never work from the catalog entry or
from memory instead. If you cannot run curl, ask the user to paste the files. Do not rely on a
summarizing web-fetch tool.

**Follow the companion's "How to use this" section.** Its steps and constraints win over
anything else in the file and over this skill. Do not copy the reference system into the
repository.

## Use the docs for everything else

Product details, such as broker and topic properties, `rpk` commands, client settings, and
Redpanda Connect components, come from the Redpanda docs and the product skills. Use the Redpanda
Docs MCP server (`https://docs.redpanda.com/mcp`) with `ask_redpanda_question` and the platform
filter set to the user's deployment. If it is not connected, use
`https://docs.redpanda.com/llms.txt` and the `.md` version of any docs page. Never invent a
configuration value, limit, or default.
