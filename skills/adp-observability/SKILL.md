---
name: adp-observability
description: >-
  Read what Agentic Data Plane agents did and why, through traces, conversation transcripts, the
  audit log, and the monitoring views in the ADP UI at ai.redpanda.com and the `rpk ai` CLI. Use
  when finding which call made an agent run slow, failed, or expensive with `rpk ai trace`, reading
  or filtering a conversation with `rpk ai agent transcript`, finding conversations with a failed
  tool call, investigating a denied or masked call with `rpk ai auditlog`, working out on whose
  behalf an agent acted, or reading the Agent network or Home views. For budgets, cost, and access
  policies, see `/redpanda:adp-governance`. For signing in, agents, MCP servers, LLM providers, and
  the rest of the `rpk ai` CLI, see `/redpanda:adp`.
---

# Agentic Data Plane: Observability

The Agentic Data Plane (ADP) is Redpanda's governance infrastructure for AI agents and MCP servers. This skill covers the records ADP keeps of what ran: traces, transcripts and the audit log. Building agents, MCP servers and LLM providers, and the `rpk ai` CLI itself, are in `/redpanda:adp`; the controls those records report on (access policies, budgets, guardrails) are in `/redpanda:adp-governance`.

**Before any command:** sign in and select an environment (`rpk ai auth login`, then `rpk ai env use <environment>`), as described in `/redpanda:adp` (*Auth model*). Operate ADP with `rpk ai`, send the user to the UI for tasks the CLI does not cover, and confirm the live surface with `--help` before acting.

**Maturity:** The docs carry no Preview or Experimental marker on traces, transcripts, the audit log, the Agent network view, or the Home dashboard. Traces dropped its Preview badge and its documented Preview marker with the release that moved it under **Observability**.

## Where each task lives

| Task | CLI | UI |
|---|---|---|
| Transcripts | `rpk ai agent transcript` | Agent → Transcripts |
| Audit log | `rpk ai auditlog` | Observability → Audit log |
| Traces: one row per run, span by span | `rpk ai trace` | Observability → Traces |
| Agent network | `rpk ai agent-network` | Observability → Agent network |

## Discover the live surface

```bash
# Transcripts are a subcommand of `agent` (aliases: transcripts, tr), not a top-level group
rpk ai agent transcript list <agent>
rpk ai agent transcript get <agent> <conversation-id>

# These are read-only top-level groups of their own
rpk ai auditlog --help      # aliases audit-log, audit; list, get, query
rpk ai trace --help         # list, get, span
rpk ai agent-network --help # get, node, provider-failures
```

## Components

- **Transcripts** (`rpk ai agent transcript list|get`, UI): what an agent did in a conversation: turns, tool calls, models, timing.
- **Audit log** (`rpk ai auditlog list|get`, UI): who was allowed or refused what across ADP, which policy decided, and on whose behalf an agent acted.
- **Traces** (`rpk ai trace`, **Observability → Traces**): one row per agent run or gateway call, expandable into a span waterfall — model calls, tool calls, subagent hand-offs, gateway calls, and the guardrail and data-policy decisions each met. Start here to find which call made a run slow, expensive, or wrong.
- **Home** (UI) and **Agent network** (`rpk ai agent-network`): headline metrics and agent-to-resource topology. Per-agent conversation sessions (**Playground history**, `rpk ai session`) are covered in `/redpanda:adp`.

## Reference files

- [references/observability.md](references/observability.md): which surface answers which question, traces (CLI and UI), transcripts (CLI filters, UI, recorded errors, context size and compaction), the audit log (CLI, table, filters, grouped calls, delegation, event detail, MCP gateway records), the traces/transcripts/audit-log comparison, other monitoring views, and permissions.
