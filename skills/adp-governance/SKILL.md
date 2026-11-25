---
name: adp-governance
description: >-
  Govern what Agentic Data Plane agents may do, spend, and expose, through the `rpk ai` CLI and the
  ADP UI at ai.redpanda.com, and look up governance features in the Redpanda docs. Use when writing
  or debugging a Cedar access policy with `rpk ai policy`, giving a new agent access, capping agent
  spend with `rpk ai budget`, analyzing cost, attaching a guardrail to a provider, containing or
  releasing an agent with the kill switch, storing or deleting a credential with `rpk ai secret`,
  minting an API key, masking MCP tool data with data policies, or setting up inbound or outbound
  OAuth. For signing in, agents, MCP servers, LLM providers, and the rest of the `rpk ai` CLI, see
  `/redpanda:adp`. For transcripts, the audit log, and traces, see `/redpanda:adp-observability`.
---

# Agentic Data Plane: Governance

The Agentic Data Plane (ADP) decides whether an agent's call runs (access policies, roles, the
kill switch), what it may cost (budgets), what data it exposes (guardrails, data policies), and
which credentials it uses (secrets, API keys, OAuth). Sign in and pick an environment first, as
`/redpanda:adp` describes. This skill keeps only the procedures below. Look up everything else in
the docs (last section).

## How to work

**Before you delete a secret, find what still uses it.** `rpk ai secret delete` checks no
references, and a secret's value can't be read back, so a deleted secret can't be restored and
every resource that names it fails at its next call. Read the MCP servers, LLM providers, OAuth
providers and clients, and agents (`list -o yaml`) for the secret's ID first. If anything still
uses it, tell the user what, and ask before deleting.

**To deny one tool on one MCP server, name the tool alone and pin the server in a `when` clause.**
Cedar identifies a tool by its name only, so write `resource == McpServerTool::"<tool>"` with
`when { resource in McpServer::"<server>" }`. A combined ID such as
`McpServerTool::"<server>/<tool>"` names no tool, so it denies nothing, and leaving out the
`when` clause denies that tool name on every server.

**To stop a misbehaving agent, contain it. Don't delete it, its credentials, or its MCP servers.**
Containment (`rpk ai agent-kill-switch`, or **Contain agent** in the UI, with a reason) denies the
agent's gateway traffic, to it and from it, until someone releases it, and leaves its
configuration as it is.
Deletes can't be undone and remove what an investigation needs.

## Use the docs for everything else

Look up commands, flags, Cedar actions and attributes, permissions, templates, limits, and UI
steps in the Redpanda docs instead of from memory:

- Follow `/redpanda:redpanda-docs`. The ADP docs are not versioned and not tied to a platform, so
  `ask_redpanda_question` needs no `version`. Use `get_rpk_command` for one `rpk ai` command and
  `list_rpk_commands` with `plugin: "ai"` to find one.
- Most useful pages, under https://docs.redpanda.com/agentic-data-plane/: `control/access-policies/`
  (Cedar, templates, the action reference), `control/permissions-overview/` and
  `control/permissions-reference/` (roles and permissions), `control/budgets/`,
  `control/cost-usage/`, `control/guardrails/`, `control/kill-switch/`, `control/secrets/`,
  `control/tags/`, `connect/data-policies/`, `connect/oauth-providers/`,
  `connect/remote-mcp-clients/`, and the `rpk ai` reference under `reference/rpk/rpk-ai/`.

If the Docs MCP server refuses for quota and you can't fetch the page, tell the user to sign in
through `/mcp` rather than answering from memory.

`rpk ai <command> --help` on the installed plugin is the live check for flags in that version.
