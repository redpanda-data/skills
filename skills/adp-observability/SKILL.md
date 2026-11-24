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

The Agentic Data Plane (ADP) keeps three records of what ran: traces (`rpk ai trace`),
conversation transcripts (`rpk ai agent transcript`) and the audit log (`rpk ai auditlog`). The
docs cover all of them, so this skill carries no procedure of its own. Sign in and select an
environment first, as described in `/redpanda:adp`.

## Use the docs

Look up commands, flags, filters, columns, statuses, permissions and UI views in the docs instead
of from memory:

- Follow `/redpanda:redpanda-docs`. Use `get_rpk_command` for one `rpk ai` command's flags and
  help (for example `rpk ai auditlog list`), `list_rpk_commands` with `plugin: "ai"` to find a
  command, and `ask_redpanda_question` for everything else. ADP docs are not versioned, so pass
  no `version`.
- The ADP docs live at https://docs.redpanda.com/agentic-data-plane/. Most useful pages:
  https://docs.redpanda.com/agentic-data-plane/monitor/traces/,
  https://docs.redpanda.com/agentic-data-plane/monitor/transcripts/,
  https://docs.redpanda.com/agentic-data-plane/monitor/audit-log/ and
  https://docs.redpanda.com/agentic-data-plane/monitor/agent-network/.

If the Docs MCP server refuses for quota and you can't fetch the page, tell the user to sign in
through `/mcp` rather than answering from memory.

`rpk ai <command> --help` on the installed plugin is the live check for flags in that version.
