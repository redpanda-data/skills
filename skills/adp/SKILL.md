---
name: adp
description: >-
  Redpanda's Agentic Data Plane: governance infrastructure for building, running, and
  governing AI agents and MCP servers behind a credential-injecting AI Gateway for LLM providers,
  operated through the `rpk ai` CLI and the ADP UI at ai.redpanda.com. Use when installing
  `rpk ai`, signing in to an environment, checking setup with `rpk ai doctor`, managing managed or
  self-managed AI agents and their triggers with `rpk ai agent` and `rpk ai trigger`, configuring
  remote or managed MCP servers with `rpk ai mcp-server` (including code mode and user-delegated
  OAuth), setting up LLM providers and models with `rpk ai llm-provider` and `rpk ai model`,
  applying GitOps manifests, or launching a coding tool with `rpk ai run`.
  For access policies, budgets and cost, guardrails and the kill switch, or secrets, API keys,
  data policies and OAuth, see `/redpanda:adp-governance`. For transcripts, the audit log, and
  traces, see `/redpanda:adp-observability`. For the `rpk cloud mcp` control-plane server, see
  `/redpanda:rpk-cloud`.
---

# Agentic Data Plane

The Agentic Data Plane (ADP) runs AI agents and MCP servers behind an AI Gateway that injects
LLM provider credentials. Operate it with the `rpk ai` CLI, and send the user to the ADP UI
(ai.redpanda.com) for tasks the CLI does not cover. This skill keeps only the procedures below.
Look up everything else in the docs (last section).

Governance (access policies, budgets, guardrails, the kill switch, secrets, API keys, OAuth) is
in `/redpanda:adp-governance`. Transcripts, the audit log, and traces are in
`/redpanda:adp-observability`.

## How to work

**Put `enabled: true` in a trigger manifest you apply.** In an `rpk ai trigger apply` manifest,
a missing `enabled` means false, so the trigger is created or left paused and never fires, even
though `rpk ai trigger create` enables a trigger by default. Before you apply a trigger manifest
the user wants live, add `enabled: true`, then confirm with `rpk ai trigger list`.

**Build a GitOps manifest from the live resource before `apply`.** `rpk ai <group> apply` treats
a manifest as the complete desired state, so a field you leave out is cleared on the live
resource. For a change to an existing agent, provider, MCP server, or trigger, start from
`rpk ai <group> get <name> -o yaml`, change only what the user asked for, and check the result
with `diff` before `apply`. Never apply a hand-written partial manifest to an existing resource.

## Use the docs for everything else

Look up commands, flags, defaults, limits, error messages, UI steps, and procedures in the ADP
docs instead of from memory:

- Follow `/redpanda:redpanda-docs`. Use `get_rpk_command` for one `rpk ai` command (for example
  `rpk ai trigger create`): it returns the flags and defaults of the latest published plugin.
  Use `ask_redpanda_question` for everything else. ADP docs are not versioned, so pass no
  `version`.
- Most useful pages: the ADP docs at https://docs.redpanda.com/agentic-data-plane/, the CLI
  guide at https://docs.redpanda.com/agentic-data-plane/cli/, GitOps at
  https://docs.redpanda.com/agentic-data-plane/cli/gitops/, and the `rpk ai` reference at
  https://docs.redpanda.com/agentic-data-plane/reference/rpk/rpk-ai/rpk-ai/ (one page per
  subcommand).

If the Docs MCP server refuses for quota and you can't fetch the page, tell the user to sign in
through `/mcp` rather than answering from memory.

`rpk ai <group> --help` on the installed plugin is the live check for flags in that version.
`rpk ai docs` and `rpk ai docs search` read the published ADP docs from the terminal without a
sign-in. Catalogs change, so list them live: `rpk ai mcp-server types` for managed MCP server
types, `rpk ai llm-provider types` for provider types, and `rpk ai model list` for models.
