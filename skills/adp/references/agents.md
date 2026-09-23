Source: `cloudv2 apps/rpai/testdata/commands-snapshot.md` (`agent`, `agent a2a`, `agent a2a send`, `agent a2a task watch`, `trigger` sections), `cloudv2 apps/rpai/internal/cmd/agent/` (positional arguments), `docs modules/reference/partials/rpk-ai/` (`rpk-ai-agent-create`, `-update`, `-credential-create`, `-transcript-list` flag tables), `adp-docs modules/connect/pages/create-agent.adoc`, `self-managed-agents.adoc`, `concepts.adoc`, `triggers/overview.adoc`, `adp-docs modules/monitor/pages/monitor-agents.adoc` (session history), `adp-docs modules/cli/pages/gitops.adoc` — verified 2026-09-23. Write-time validation, subagent, tag and agent-card behavior carried forward from the earlier source-verified revision and cross-checked against `create-agent.adoc` on 2026-09-23.

# Agentic Data Plane Agents Reference

**Maturity:** Redpanda Agentic Data Plane is generally available. The `rpk ai` CLI is Preview: confirm flags with `--help` before relying on them.

Audience: an AI agent operating Agentic Data Plane agents through `rpk ai` and the ADP UI (ai.redpanda.com). Optimize for correct programmatic use.

Related references: [SKILL.md](../SKILL.md), [mcp-servers.md](mcp-servers.md), [gateway-and-providers.md](gateway-and-providers.md), [governance.md](governance.md), [rpk-ai.md](rpk-ai.md), [observability.md](observability.md).

## Discover the live surface

```bash
rpk ai agent --help                 # a2a, apply, create, credential, delete, diff, get, list, start, stop, transcript, update
rpk ai agent create --help          # current create flags
rpk ai agent get <name> -o yaml     # the complete manifest shape for an existing agent
rpk ai trigger --help               # triggers are a top-level group
rpk ai model list                   # models the gateway can route to
```

In the UI, agents live under **Agents** in the sidebar. A managed agent's detail page has **Settings**, **Triggers**, **Playground**, **Cost & Usage**, **Transcripts**, and (when access policies are enabled) **Permissions** tabs. A self-managed agent has **Setup** and **Credentials** tabs (plus Cost & Usage, Transcripts, and a Settings tab with only Integration and Identity), and no Triggers or Playground tab.

## Agent types: managed vs. self-managed

| | Managed | Self-managed |
|---|---|---|
| Who runs it | Redpanda deploys, runs, and observes it | You do, on your own runtime and framework |
| How it is defined | Declaratively: model, LLM provider, system prompt, MCP servers, subagents | Already coded; ADP holds only an identity record (name, description, tags) |
| Create | UI: **Agents → Create agent → Managed by Redpanda**. CLI: `rpk ai agent create <name> ...` (managed is the default) | UI: **Create agent → Self-managed**. CLI: `rpk ai agent create <name> --self-managed` |
| Connects to ADP through | The managed runtime wires the gateway | A client credential it exchanges for a gateway token; its code points LLM and MCP clients at the gateway |
| Triggers, Playground, sessions | Yes | No |

Both types share one registry, the same governance views, and the same cost attribution. The managed-or-self-managed kind is create-only: changing it means delete and recreate. For self-managed wiring (token endpoint, `/llm/v1/providers/<name>`, `/mcp/v1/<server>`, span export for transcripts), see [gateway-and-providers.md](gateway-and-providers.md) and [observability.md](observability.md).

## Agent commands

`<name>` is the agent ID (for example `support-bot`); the commands below take it as a positional argument.

| Command | Purpose |
|---|---|
| `create <name>` | Create a managed agent (default) or, with `--self-managed`, a metadata-only record |
| `get <name>` / `list` | Read one agent (`-o yaml` for the full manifest) / list agents |
| `update <name>` | Change only the fields whose flags you pass |
| `delete <name>` | Delete the agent |
| `start <name>` / `stop <name>` | Set a managed agent's desired state to running / stopped. Stopping keeps configuration, transcripts, and cost history, and stops serving callers and triggers |
| `apply -f` / `diff -f` | GitOps reconcile / dry-run from YAML manifests (see [rpk-ai.md](rpk-ai.md)) |
| `credential create\|list\|delete` | Client credentials for the agent (see [Agent credentials](#agent-credentials)) |
| `transcript list\|get` | Conversation transcripts (see [observability.md](observability.md)) |
| `a2a card\|send\|task` | Talk to a running agent over A2A (see [A2A](#a2a-endpoint-and-agent-card)) |

Scalar flags on `create` / `update`: `--display-name`, `--description`, `--model`, `--llm-provider`, `--system-prompt`, `--max-iterations`, `--mcp-server` (repeatable), `--tag key=value` (repeatable; on `update` it replaces the whole tag map). `create` also takes `--self-managed` and `--spec-file <json|yaml>`, which loads a complete managed spec and is the only create-time way to set subagents or an agent card; `--spec-file` is mutually exclusive with `--self-managed` and the scalar spec flags. For anything the flags cannot express on an existing agent (subagents, agent card, reasoning effort), edit the manifest and `rpk ai agent apply -f`.

Updates roll out without interrupting the agent: the new version starts and becomes ready before the old one stops.

## Agent metadata and tags

Every agent carries, independent of type:

| Manifest field | Constraint |
|---|---|
| `name` | Immutable ID, a lowercase slug up to 63 characters. The UI derives it from the display name (adding a suffix on collision); check it on the Settings tab after create |
| `display_name` | Up to 128 characters |
| `description` | Up to 1,024 characters; an internal note, not the system prompt |
| `tags` | Key/value map, up to 50 pairs, each value up to 256 characters |

`tags` does three jobs at once, so adding or removing a key affects all three:

- **Access policies** — Cedar policies can condition on an agent's tags (`resource.getTag("team")`, `resource.hasTag("team")`); see [governance.md](governance.md).
- **Organization** — filter agents in the registry by tag.
- **Cost grouping** — the gateway stamps the agent's tags on each LLM call it makes, so spend can be grouped and filtered by tag (see [governance.md](governance.md)). Attribution is point-in-time: spend already recorded keeps the tags it had.

Do not put secrets or PII in tag values; they surface in cost reports.

## Managed agent spec

Manifest fields under `managed.spec` (also the shape `--spec-file` accepts). The UI create canvas has **Identity**, **Model**, **Instructions**, **Tools**, and a collapsible **Advanced** area (subagents, tags, transcript recording); everything is editable later on the **Settings** tab.

| Field | Required | Constraint / behavior |
|---|---|---|
| `model` | yes | Up to 128 characters; must be valid for the provider (see [Write-time validation](#write-time-validation)) |
| `llm_provider` | yes | Name of an LLM provider resource (lowercase slug, up to 63 characters) |
| `system_prompt` | no (strongly recommended) | Up to 50,000 **UTF-8 bytes** — a byte cap, so accented, non-Latin, or emoji text fits fewer characters. The UI disables **Create agent** when the prompt is too long |
| `max_iterations` | no | 0–200. `0` or omitted means the runtime default (100); the server fills the value in, so `get -o yaml` never shows `0`. Values above 200 are rejected. No UI control: set it with `--max-iterations` or in a manifest |
| `mcp_servers` | no | Up to 32 names per list (see the aggregate cap below). The agent discovers each server's tools at runtime; there is no per-tool selection |
| `subagents` | no | Map keyed by subagent name, up to 16 entries (see [Subagents](#subagents)) |
| `agent_card` | no | A2A discovery metadata (see [A2A](#a2a-endpoint-and-agent-card)) |
| `reasoning.effort` | no | Provider-owned string; omit for the provider default (see [Reasoning effort](#reasoning-effort)) |
| `reasoning_effort` | no | **Deprecated**; use `reasoning.effort` |

There is no `tools` field on an agent: agents reach tools only through `mcp_servers`.

**Aggregate MCP-reference cap.** An agent can reference at most **32 MCP servers in total**, counting the root agent's `mcp_servers` plus every subagent's. The cap counts references, not distinct servers: a server named by the root and by a subagent counts twice. So 16 subagents each listing 32 servers is valid per list but rejected overall.

**Transcript recording.** Under **Advanced → Transcripts** the UI offers **Full transcripts** (default), **Metadata only** (no message or tool content), and **Off** (no traces; the Transcripts tab stays empty). This setting alone decides what the agent's transcripts hold; the LLM provider's record-inputs/outputs toggles are separate. It does not affect cost and usage reporting. <!-- TODO(human): confirm the manifest field name for the agent-level transcript recording mode; it is documented as a UI setting only and is not in the CLI flag tables. -->

**Bedrock output cap.** For a Claude model on an AWS Bedrock provider, a managed agent caps each model call's output at 16,384 tokens (not configurable), so a long answer can be truncated. The same applies to subagent overrides.

## Write-time validation

Create and update validate a managed spec's references before saving, so a bad reference fails the write instead of producing a broken agent. The error names the offending field path (for example `agent.managed.spec.subagents.<name>.mcp_servers`), so you can map a rejection back to the spec element. <!-- TODO(human): confirm that `rpk ai` output includes the field-violation path, not only the message text. -->

**References must exist.** Every `llm_provider` and `mcp_servers` name — root and subagents — must resolve. A missing name is an invalid-argument error. If the lookup itself cannot complete, the call fails as unavailable instead: that means "cannot tell right now", so retry rather than edit the spec.

**Model must be valid for the provider.** Each effective `(model, llm_provider)` pair, including every subagent after inheritance, is checked:

1. **Catalog check — OpenAI, Anthropic, Google, and AWS Bedrock providers.** The model must be one the agent runtime can resolve: an exact model ID, an official alias, a dated version, or a retired model the catalog still knows. A plausible-looking but unpublished name is rejected with a message like `model "…" is not a known <provider> model, so a managed agent could not start with it; pick a model from the provider's model list or check the spelling`. On Bedrock the check depends on the provider's region and suggests the full inference-profile form (for example `us.anthropic.<model>` rather than a bare model name).
2. **Enabled on the provider — Bedrock only.** The model must also be in the provider's `provider_models` list: `model "…" is not enabled on llm_provider "…"; enable it on the provider or pick one of its models`. A provider with an **empty** `provider_models` list serves whatever Bedrock accepts, so this check is skipped.

Scoping rules:

- **OpenAI-compatible providers are not model-checked** at write time; any identifier saves, and the gateway enforces the model per request.
- **Non-Bedrock catalog providers get only the catalog check.** Their allowlist is enforced by the gateway at request time (`403 model_not_allowed`).
- **Updates validate only the pairings they change**, so an agent that already stores an out-of-catalog model stays editable. A partial update that changes only a model is still checked against the provider it inherits.
- Rarely, an update fails with a `changed while the update was in flight; retry` message; retry the update.

A retired model disappears from the provider's catalog, but an agent already using it keeps running, and the stored model still resolves when you edit the agent.

## Reasoning effort

`managed.spec.reasoning.effort` sets how much computation a reasoning-capable model spends before answering. It is persisted on the agent and applies to every run — Playground, A2A callers, and triggers. Higher levels cost more. The UI shows the current level (or `Provider default`) read-only in the Playground composer; set it in a manifest and `rpk ai agent apply -f`.

- **Provider-owned string, not a platform enum.** Use the provider's own spelling, case-sensitive, up to 64 characters. Empty or omitted means the provider's default, not "no reasoning".
- **Which values a model accepts is a live fact.** Read them from the model catalog (`rpk ai model get <model> -o yaml`, or the model's detail page in the UI), least to most computation; an empty list means the model has no configurable effort. Because subagents may run different models, the values safe to set are the **intersection** across the agent's model and every subagent's model. See [gateway-and-providers.md](gateway-and-providers.md). <!-- TODO(human): confirm the key name under which `rpk ai model get -o yaml` prints a model's accepted reasoning efforts. -->
- **Subagents inherit it.** There is no per-subagent effort, including for a subagent that overrides its model.

**Validation.** When an effort is set, every effective model pairing must accept it:

- A model that does not list the value fails with `model "…" does not support reasoning effort <value>`; several offending models are reported together. The error addresses whichever field you wrote (`agent.managed.spec.reasoning.effort` or the deprecated `agent.managed.spec.reasoning_effort`).
- On an **OpenAI-compatible** provider any explicit effort is rejected; leave it unset.
- A model the gateway cannot resolve is an invalid-argument error; a lookup that cannot complete fails as unavailable (retry).
- Updates check only the pairings they change. Leaving the effort unset is always accepted.

**Deprecated `reasoning_effort`.** Older manifests may set the closed `reasoning_effort` enum. It is still accepted and kept in step with `reasoning.effort` (`reasoning.effort` wins on read; a provider value the enum cannot represent leaves the enum unspecified). Setting the two to different values fails with `reasoning effort fields must not conflict`. Use `reasoning.effort` for new work.

## Subagents

Subagents are internal specialists inside one agent; the root agent delegates to them. Up to 16 per agent. UI: **Advanced → Add subagent**.

| Manifest field | Required | Constraint |
|---|---|---|
| map key (UI **Name**) | yes | Lowercase letter first, then lowercase letters, digits, hyphens; up to 63 characters; unique within the agent |
| `description` (UI **When should the parent use it?**) | yes | Up to 1,024 characters; the delegation hint the parent reads |
| `system_prompt` (UI **Instructions**) | yes | Up to 50,000 UTF-8 bytes, counted separately from the parent's |
| `mcp_servers` (UI **Tools**) | no | Up to 32 names; counts toward the agent's aggregate cap |
| `model` | no | Empty = inherit the parent's model |
| `llm_provider` | no | Empty = inherit the parent's provider. Setting it requires `model` too, because model names are provider-specific |

- **`mcp_servers` is independent of the parent's**, not a subset: a subagent may reference a server the parent does not.
- **There is no `skills` field on a subagent.** `skills` belongs to the agent card.
- **The UI overrides only the model**; a per-subagent provider override is manifest-only. Opening a subagent that carries a manifest-set provider override in the UI clears that override along with its model when you save.
- Subagents share the parent's provider credentials, gateway endpoint, and execution settings.

## A2A endpoint and agent card

A running managed agent serves an A2A endpoint. Copy it from the **Endpoint** field on the agent's Settings tab (Runtime section), or let `rpk ai agent a2a` resolve it from the agent name.

- **Agent card:** `https://<agent-url>/.well-known/agent-card.json` (`/.well-known/agent.json` is served as an alias; there is no bare `/agent.json`). The card is public; every other request needs `Authorization: Bearer <token>` and permission to invoke the agent.
- **Card content** comes from `managed.spec.agent_card`; its `skills` list takes entries with `tags`, `examples`, `input_modes`, and `output_modes`. Set it through `--spec-file` or a manifest.

```bash
rpk ai agent a2a card <agent>                                  # fetch the card
rpk ai agent a2a send <agent> "question"                       # blocks until the reply (default --timeout 5m)
rpk ai agent a2a send <agent> --context-id CTX "follow-up"     # continue the same conversation
rpk ai agent a2a send <agent> --task-id T --context-id CTX "…" # answer an input-required task
rpk ai agent a2a send <agent> --stream "…"                     # stream events (JSONL under -o json|yaml)
rpk ai agent a2a send <agent> --no-block "…"                   # return the task id immediately
rpk ai agent a2a task get|watch|cancel <agent> <task-id>
```

`<agent>` is a registry agent name or a full `http(s)://` A2A URL. Your token is attached for registry agents and for URLs on your environment's dataplane host; other hosts are called without credentials (stderr says so). Reply text goes to stdout; `context-id`, task id, and state go to stderr as `key: value` lines. Exit codes: `0` success or input-required, `4` task failed/canceled/rejected, `1` anything else. `task watch` (alias `resubscribe`) waits with no timeout unless `--timeout` is set.

An agent's context lasts one conversation (one A2A context). There is no built-in memory across conversations; expose earlier information through a tool instead.

## Conversation sessions (UI)

A **session** is a managed agent's saved conversation thread. **There is no `rpk ai` command for sessions** (`rpk ai agent --help` lists none); work with them in the UI:

- **Agent → Playground → History** opens Session history, newest first, with **Show more** for older sessions. Once a conversation has messages, the control reads *Session* plus the session ID, with a copy control.
- **Filter:** **Session ID (exact)**, or **Updated from** / **Updated through** (local timezone, both ends inclusive), then **Apply filters**; **Clear filters** resets.
- **Reopen** a session to replay it (including attached files and data); the next message continues that session.
- **Delete** a session from its row's actions; the UI says this permanently removes the session and its transcript. <!-- TODO(human): confirm whether deleting a session in the Playground also removes the matching entry on the agent's Transcripts tab, or only the Playground's stored copy. -->
- **New session** and **Clear context** both start a fresh session; the previous one stays in history.

**A session ID is the A2A context ID.** The `context-id` that `rpk ai agent a2a send` prints and accepts via `--context-id` is the same ID Session history shows, so you can resume a CLI conversation from the Playground and vice versa.

Sessions exist for managed agents only. They are not transcripts: a session is the agent's own conversation state; a transcript is the observability record (timing, tool calls, tokens, cost), which also covers self-managed agents and is readable from the CLI with `rpk ai agent transcript`. See [observability.md](observability.md).

## Agent credentials

Client-ID/secret pairs an agent uses to authenticate to the gateway (the self-managed path; see [gateway-and-providers.md](gateway-and-providers.md)).

```bash
rpk ai agent credential create <agent> [--description TEXT] [--ttl 8760h]
rpk ai agent credential list <agent>
rpk ai agent credential delete <credential-name>   # full name from list, e.g. agents/my-agent/credentials/abc123
```

- The client ID is `serviceaccounts/<agent-name>`, shared by every secret on the agent. The secret is shown **once**; store it immediately.
- A secret created without `--ttl` (and every secret created on the UI **Credentials** tab) expires after 90 days. `--ttl` sets another lifetime with no enforced maximum. The product docs state every secret has an expiry, so do not rely on `--ttl 0` for a non-expiring secret. <!-- TODO(human): the flag help says "0 means no expiry" but the product docs say every secret expires; confirm what --ttl 0 actually produces. -->
- Up to 10 unexpired secrets per agent; the next create fails with `secret cap exceeded`. Expired secrets do not count.
- Rotate without downtime: create a new secret, deploy it, then revoke the old one.

## Triggers

Triggers invoke a **managed** agent without a direct API call. Two kinds:

- **Microsoft Teams** — people chat with the agent in Teams; replies stream back.
- **Schedule (cron)** — each run sends a fixed message to the agent and is recorded as a transcript, with no reply path.

**UI:** agent → **Triggers** tab → **Add trigger**. Edit a trigger on its card; pause/resume icons exist only for schedule triggers. Teams triggers show **Pending**, **Connected**, or **Error** from a background credential check (about every 30 seconds); schedule triggers show the last run outcome and next run time, or **Paused** / **Failing**.

**CLI:** the **top-level** `rpk ai trigger` group (aliases `triggers`, `agent-trigger`), not `rpk ai agent trigger`. See [rpk-ai.md](rpk-ai.md#trigger-subcommands).

```bash
rpk ai trigger create <agent> --cron-schedule "0 9 * * 1-5" --cron-timezone Europe/Prague --cron-input "Daily report"
rpk ai trigger create <agent> --teams-bot-app-id <id> --teams-bot-tenant-id <tenant> --teams-bot-app-secret-ref TEAMS_BOT_SECRET
rpk ai trigger list <agent>                                   # alias ls; shows whether each trigger is enabled
rpk ai trigger get agents/<agent>/triggers/<id> -o yaml       # kind config and reported health
rpk ai trigger update agents/<agent>/triggers/<id> --enabled=false
rpk ai trigger runs agents/<agent>/triggers/<id>              # schedule runs, newest first
rpk ai trigger delete agents/<agent>/triggers/<id>            # idempotent
```

- `create` and `list` take the parent agent (`my-agent` or `agents/my-agent`); `get`, `update`, `delete`, and `runs` take the **full** name. A bare ID fails: `invalid trigger name "teams1": expected 4 path segments, got 1 (want agents/{agent}/triggers/{trigger}, …)`.
- Exactly one kind per trigger, fixed at creation (`a trigger needs a kind: pass the --teams-* flags … or the --cron-* flags …`). To change kind, delete and recreate.
- `--cron-timezone` is required for a schedule trigger; the server never falls back to UTC. `--cron-schedule` is a standard 5-field expression.
- The Teams secret flag takes a secret-store key (bare `UPPER_SNAKE_CASE`), never the secret itself.
- The trigger ID is server-assigned unless you pass `--id` (a DNS-1123 label). The UI derives it from the display name.
- Creating a trigger does not validate its credentials or secret references; an accepted trigger can still report unhealthy afterwards.
- `runs` returns an empty history for a Teams trigger. Each run's `conversation_id` joins it to its transcript (`rpk ai agent transcript get`).

### Pause and resume a trigger

`enabled` pauses a trigger without deleting it, keeping its configuration and run history.

- `rpk ai trigger update <name> --enabled=false` pauses; `--enabled=true` resumes from the next scheduled instant — **missed ticks are never backfilled**.
- `rpk ai trigger create` defaults `--enabled` to true (pass `--enabled=false` to create it paused).
- In a GitOps manifest an omitted `enabled` means **false**, so `rpk ai trigger apply` of a manifest without `enabled: true` creates or leaves a paused trigger.
- A disabled schedule trigger fires no runs. A disabled Teams trigger stops delivering messages, and its credential check and status stop updating — the Teams card shows no disabled indicator, so confirm with `rpk ai trigger list`.

## Permissions

Agent operations are gated by `dataplane_adp_agent_*`, with separate families for credentials (`dataplane_adp_agent_credential_*`), triggers (`dataplane_adp_agent_trigger_*`), and conversation sessions (`dataplane_adp_agent_session_*`). Reading a session exposes its full conversation content, so grant it as deliberately as transcript access. Every A2A call to an agent is covered by one permission, `dataplane_adp_a2a_invoke`; grant it with a policy on `Action::"Agent.invoke"`. See [governance.md](governance.md#roles-and-permissions).
