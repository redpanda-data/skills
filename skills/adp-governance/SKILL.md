---
name: adp-governance
description: >-
  Govern what Agentic Data Plane agents may do, spend, and expose, through the `rpk ai` CLI and the
  ADP UI at ai.redpanda.com. It covers Cedar access policies and roles, budgets and cost reporting,
  guardrails and the agent kill switch, and secrets, tags, API keys, data policies and OAuth. Use
  when writing or debugging an access policy with `rpk ai policy`, giving a new agent access,
  capping agent spend with `rpk ai budget`, analyzing cost with `rpk ai spending`, attaching a
  guardrail to a provider, containing or releasing an agent, storing a credential with
  `rpk ai secret`, minting an API key, masking MCP tool data, or setting up inbound or outbound
  OAuth. For signing in, agents, MCP servers, LLM providers, and the rest of the `rpk ai` CLI, see
  `/redpanda:adp`. For transcripts, the audit log, and traces, see `/redpanda:adp-observability`.
---

# Agentic Data Plane: Governance

The Agentic Data Plane (ADP) is Redpanda's governance infrastructure for AI agents and MCP servers. This skill covers the controls that decide whether a call runs, what it may cost, what data it exposes, and which credentials it uses. Building agents, MCP servers and LLM providers, and the `rpk ai` CLI itself, are in `/redpanda:adp`; reading what happened afterward is in `/redpanda:adp-observability`.

**Before any command:** sign in and select an environment (`rpk ai auth login`, then `rpk ai env use <environment>`), as described in `/redpanda:adp` (*Auth model*). Operate ADP with `rpk ai`, send the user to the UI for tasks the CLI does not cover, and confirm the live surface with `--help` before acting.

**Maturity:** Per-feature markers from the docs: **guardrails** and **data policies** are Preview; budgets, cost reporting, and access policies carry no Preview marker. Access policies are still enabled per organization: if **Access** is missing from the sidebar, they are not enabled for yours.

## Where each task lives

| Task | CLI | UI | Reference |
|---|---|---|---|
| Cedar access policies, giving an agent access | `rpk ai policy` | Access (when enabled for your organization) | access-control.md |
| Roles and permissions (RBAC) | role bindings via `/redpanda:rpk-cloud` | Access → Roles (read-only view) | access-control.md |
| Budgets that cap agent spend | `rpk ai budget` | Budgets | spend-and-safety.md |
| Cost and usage analysis | `rpk ai spending` | Cost and usage | spend-and-safety.md |
| Guardrails | `rpk ai guardrail` | Guardrails | spend-and-safety.md |
| Kill switch policies that contain an agent | `rpk ai kill-switch-policy` | Agent → Govern tab | spend-and-safety.md |
| Containing an agent by hand, and releasing it | `rpk ai agent-kill-switch` | Agent → **Contain agent** / **Release agent** | spend-and-safety.md |
| Secrets other resources reference by ID | `rpk ai secret` | Secrets store | identity-and-secrets.md |
| API keys for long-lived clients | `rpk ai api-key` | API keys | identity-and-secrets.md |
| Data policies on an MCP server | `rpk ai mcp-server create/update --data-policies` | MCP server → Data Policies tab | identity-and-secrets.md |
| OAuth clients (inbound) and providers (outbound) | `rpk ai oauth-client`, `rpk ai oauth-provider` | Integrations setup | identity-and-secrets.md |
| Your own OAuth connections | `rpk ai connection` | Connections | identity-and-secrets.md |

## Discover the live surface

```bash
rpk ai policy --help            # + analyze and format, which validate draft Cedar without saving
rpk ai oauth-client --help      # inbound clients; dcr, cimd, catalog, revoke-tokens live here
rpk ai oauth-provider --help    # outbound providers
rpk ai connection --help        # your own OAuth connections (list, revoke)
rpk ai budget --help            # budgets; `guardrail`, `api-key` and `spending` are groups too
rpk ai spending --help          # summary, breakdown, time-series, time-series-by-dimension, tag-keys
rpk ai agent-kill-switch --help # contain or release one agent (get, update)
```

## Components

- **Budgets** (`rpk ai budget`, **Budgets**): per-agent spend caps over a daily, weekly, or monthly period, with a warning threshold. A capped agent's LLM calls get `HTTP 429` until the period resets.
- **Cost and usage** (`rpk ai spending`, **Cost and usage**): spend and token reporting, groupable by cost-allocation tags taken from agent tags.
- **Guardrails** (Preview; `rpk ai guardrail` or the UI to author, `rpk ai llm-provider update --guardrail` to attach): content safety backed by Amazon Bedrock Guardrails. Policy types are content filters, word filters, denied topics, sensitive information (PII), contextual grounding, and automated reasoning.
- **Access policies** (`rpk ai policy`, UI): Cedar policies that decide *whether* a call runs. A new agent has no policy of its own; `rpk ai policy create --agent <name> --template <template>` binds one.
- **Roles and permissions**: every operation checks one fine-grained permission (`dataplane_adp_*`, `dataplane_aigateway_*`). Among built-in roles only Admin carries ADP permissions; everyone else gets access through policies, which name action IDs such as `Action::"LLMProvider.invoke"`, not permission strings.
- **Data policies** (Preview): shape *what data* a permitted MCP call exposes, and to whom.
- **Containment and the kill switch** (`rpk ai agent-kill-switch`, and `rpk ai kill-switch-policy` or the agent's **Govern** tab): containing an agent cuts off all of its gateway traffic until someone releases it. Contain one yourself with a required reason, or have a per-agent policy do it when a guardrail or data-policy signal spikes — start such a policy in Observe.
- **Secrets** (`rpk ai secret`, UI **Secrets store**): the write-only store every credential reference points at. Rotate a value in one place instead of editing each resource that uses it.
- **OAuth**: inbound clients (including Dynamic Client Registration), outbound providers, and per-user connections.

## Reference files

- [references/access-control.md](references/access-control.md): Cedar access policies, giving a new agent access (`policy create --agent`, `agent create --policy-template`), evaluation rules, writing policies (tags, ownership, the caller network, agent children), denying one tool, roles and permission families, templates and built-in policies, and the `policy` subcommands.
- [references/spend-and-safety.md](references/spend-and-safety.md): budgets and their units, subscription-covered calls, cost and usage, cost-allocation tags, guardrails, the kill switch, and the `budget`, `kill-switch-policy` and `agent-kill-switch` subcommands.
- [references/identity-and-secrets.md](references/identity-and-secrets.md): the secret store, tags on ADP resources, API keys, data policies, OAuth clients, providers and connections, and the `secret`, `connection`, `oauth-client`, `oauth-provider`, `guardrail` and `api-key` subcommands.
