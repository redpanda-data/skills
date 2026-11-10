# ADP Observability Skill Source Map

The skill is thin: it carries no "How to work" procedure, because no behavioral case survived the
baseline (see below), and sends the agent to the docs for everything else. This file maps only the
claims the skill still makes. Evals: `evals/suites/adp-observability.eval.json`.

## Scope

Converted to a thin skill on 2026-11-10, after its evals. Traces, transcripts, the audit log and
the other monitoring views are documented in the published Agentic Data Plane docs at
https://docs.redpanda.com/agentic-data-plane/ (source: `adp-docs`, `modules/monitor/pages/`), and
the `rpk ai` command reference is served by the Docs MCP (`get_rpk_command`, `list_rpk_commands`
with `plugin: "ai"`) and published under
https://docs.redpanda.com/agentic-data-plane/reference/rpk/rpk-ai/. The Docs MCP returns ADP pages
for `ask_redpanda_question` with no `platform`, with `platform: "cloud"` and with
`platform: "self-managed"` alike (checked 2026-11-10): ADP docs are platform-neutral and not
versioned.

`cloudv2`, `adp-docs`, and `docs` are private: read them via the Redpanda-Github-Read MCP
connector (`search_code`, `get_file_contents`, `list_commits`, `get_commit`), not by cloning.
`adp/RELEASE_NOTES.md` in `cloudv2` is the ADP changelog and the sync routine's trigger. For a thin
skill a changed fact is a docs gap, not a skill change.

## How to work: line, source, eval case

None. Every behavioral case passed in the baseline (see "Lines removed for lack of a failing
baseline"). The skill's records are read-only, so no line qualifies as a safety guardrail.

## Other claims in SKILL.md

| Claim | Source | Eval case |
|---|---|---|
| Traces, transcripts and the audit log are read with `rpk ai trace`, `rpk ai agent transcript` and `rpk ai auditlog` | `cloudv2` `apps/rpai/internal/cmd/` (`trace`, `agent/transcript.go`, `auditlog`); Docs MCP `list_rpk_commands` with `plugin: "ai"` (checked 2026-11-10) | none |
| Sign in and select an environment first, as `/redpanda:adp` describes | `skills/adp/SOURCES.md` | none |
| `get_rpk_command` reads one `rpk ai` command and `list_rpk_commands` with `plugin: "ai"` finds one; ADP docs are not versioned | Live `tools/list` from `https://docs.redpanda.com/mcp` (checked 2026-11-10; see `skills/redpanda-docs/references/SOURCES.md`) | none |
| The ADP docs and the four monitor pages are at the linked URLs | https://docs.redpanda.com/agentic-data-plane/ (each URL returned 200 on 2026-11-10) | none |
| When the Docs MCP server refuses for quota and no page fetch is possible, tell the user to sign in through `/mcp` | `skills/redpanda-docs/references/SOURCES.md` (anonymous quota row) | none |

## Eval results (2026-11-10)

Subject `claude-sonnet-5-5`, judge `claude-opus-5-5`, 3 runs per arm, run against the full skill
before conversion. Fact cases: the docs arm passed 2/3 or better on every informative case but
one (`transcript-get-tool-output-truncated`, docs 1/3, a docs gap below). The `installed` arm
passed every case 3/3.

## Docs gaps (not skill claims; do not re-verify here)

- **`rpk ai agent transcript get` truncates tool payloads in its readable view.** The `table` and
  `wide` output cut each tool call's input and output to 500 characters; `-o json` and `-o yaml`
  return the full payloads. Neither the published `rpk ai agent transcript get` reference page nor
  the Transcripts page (https://docs.redpanda.com/agentic-data-plane/monitor/transcripts/) says
  so. This is `rpk ai` help text, so fix it at source: the command's help in `cloudv2`
  `apps/rpai/internal/cmd/agent/transcript.go`, which calls `truncate(..., 500)` in the readable
  log. Eval case: `transcript-get-tool-output-truncated` (baseline 0/3, docs 1/3, both 3/3).
- **`rpk ai agent transcript list --query` help on `cloudv2` `main` says it searches content.** The
  flag help in `apps/rpai/internal/cmd/agent/transcript.go` reads "free-text search across
  conversation titles and content", but the list query matches only the title or conversation ID
  (`apps/adp-api/internal/storage/transcript/repository_oxla.go`, `buildListSQL`). The published
  reference page already says "title or conversation ID", so this is a source help-text fix, not a
  docs page change. Eval case: `transcript-find-conversation-by-content`.

## Lines removed for lack of a failing baseline

The full skill taught these procedures. Each was tested by a behavioral case graded on the
outcome, with mocks built from the published `rpk ai` help, and the baseline passed it:

- "A grouped audit log row needs expanding: `--denied`, not `--outcome denied`, finds a partly
  denied call, `get` reads one member, and `--correlation-id` lists one row per resource." Case
  `audit-grouped-partial-denial`: baseline 3/3, skill 3/3, installed 3/3. The published
  `rpk ai auditlog list` and `get` help state all three rules.
- "`transcript list --query` matches only the title or ID, so don't treat an empty result as proof
  a conversation does not exist; read the conversations instead." Case
  `transcript-find-conversation-by-content`: baseline 2/3, skill 3/3, installed 3/3.
- "`--errors-only` and `--status error` read the conversation's own outcome; use
  `--tool-errors-only` (or `rpk ai trace list --errors`) for a failed tool call inside a completed
  conversation." Case `transcript-failed-tool-calls-in-completed-conversations`: baseline 3/3,
  skill 3/3, installed 3/3.

Removed with the reference file, as facts the docs cover (fact cases where `docs` passed 2/3 or
better): trace status for a run that recovered from a failed tool call, the 20-value filter facet
cap, restricted spans and the trace content permission, the Running and Incomplete statuses, the
older-conversation gap in the tool-error count, the transcript error-record window, actor type
Unknown, and the MCP handshake audit rule. Four fact cases were uninformative (baseline 3/3):
context size versus input tokens, compaction sizes, Denied after an access permit, and the missing
trace for a discovery-only MCP session.
