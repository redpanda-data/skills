Source: `cloudv2 apps/rpai/internal/cmd/agent/transcript.go` (transcript list/get flags, columns, output) and `cloudv2 apps/rpai/testdata/commands-snapshot.md` (`agent` command tree, `trigger runs`, global flags); `adp-docs modules/monitor/pages/transcripts.adoc`, `adp-docs modules/monitor/pages/audit-log.adoc`, `adp-docs modules/monitor/pages/agent-network.adoc`, `adp-docs modules/monitor/pages/monitor-agents.adoc`, `adp-docs modules/get-started/pages/adp-quickstart.adoc` (Home page); `cloudv2 adp/RELEASE_NOTES.md` (shipped-feature checks). Evidence date: 2026-09-23.

# Agentic Data Plane Observability Reference

**Maturity:** Redpanda Agentic Data Plane is generally available. The `rpk ai` CLI is Preview. The docs carry no Preview or Experimental marker on transcripts, the audit log, the Agent network view, or the Home dashboard.

Audience: an AI agent answering "what did my agent do?" and "who was allowed to do what?" through `rpk ai` and the ADP UI (ai.redpanda.com).

Related references: [SKILL.md](../SKILL.md), [agents.md](agents.md), [mcp-servers.md](mcp-servers.md), [gateway-and-providers.md](gateway-and-providers.md), [governance.md](governance.md), [rpk-ai.md](rpk-ai.md).

## Discover the live surface

```bash
# Transcripts are a subcommand of `agent` (aliases: transcripts, tr), not a top-level command.
rpk ai agent transcript --help
rpk ai agent transcript list --help

# List an agent's conversations, then open one
rpk ai agent transcript list <agent>
rpk ai agent transcript get <agent> <conversation-id>
```

The audit log, the Home dashboard, and the Agent network view have no `rpk ai` command. They are UI-only: confirm with `rpk ai --help` before concluding otherwise.

## Where each question is answered

| Question | Surface |
|---|---|
| What happened in one agent conversation (turns, tool calls, tokens, latency, errors)? | Transcripts: `rpk ai agent transcript`, or the agent's **Transcripts** tab |
| Who called what, was it allowed, which policy decided, what changed? | **Audit log** (UI) |
| Which agents call which models and MCP tools, and where are errors clustering? | **Agents > Agent network** (UI) |
| Spend and traffic at a glance | **Home** (UI); for breakdowns, **Cost and usage** (see [governance.md](governance.md)) |
| Try an agent live, token/context estimate, reopen a past session | Agent **Playground** tab (UI, managed agents only; see [agents.md](agents.md)) |

## Transcripts

A transcript is the record of one agent conversation, turn by turn: the user message, the agent's response, the tool calls it made (arguments, result, status, duration, error), per-turn latency and token usage, and the system prompt when one was recorded. Transcripts cover both managed and self-managed agents. A self-managed agent's transcript holds only what its own instrumentation exports.

What a transcript holds depends on recording settings. On a managed agent, a *Metadata only* recording mode keeps the conversation's shape (tool names, status, duration) without content, and recording off produces no transcripts (see [agents.md](agents.md)). On an LLM provider, `transcripts.record_input_messages` / `transcripts.record_output_messages` (flags `--transcripts.record-input-messages` / `--transcripts.record-output-messages`) control prompt and response capture and default to on (see [gateway-and-providers.md](gateway-and-providers.md#transcript-recording-defaults-to-on)).

**Access warning:** transcripts can hold full prompts, responses, and tool payloads. The Admin role and every built-in policy template, even Read only, grant transcript read access. Grant it only to people who need it.

### `rpk ai agent transcript list <agent>`

Filter flags (all optional, ANDed):

| Flag | Meaning |
|---|---|
| `--query <text>` | Case-insensitive substring match. The docs describe it as matching conversation title or conversation ID, so you can paste a conversation ID to find a conversation whose title you don't know |
| `--status running\|completed\|error` | Narrow by conversation state (`complete`/`done` and `failed` are accepted synonyms). Any other value errors: `unknown --status "<v>" (want running\|completed\|error)` |
| `--errors-only` | Only conversations that contain errors |
| `--since <t>` / `--until <t>` | Conversations started at/after, or before, `<t>`. Accepts an RFC 3339 timestamp or a duration meaning "that long ago" (`24h`, `1h`) |

<!-- TODO(human): the `--query` flag help reads "free-text search across conversation titles and content", but the transcripts docs page says the search matches title or conversation ID. Confirm which is right and align the flag help or the docs. -->

- The command walks every page and returns the full matching set; there is no page-size or sort flag.
- Default columns: `conversation_id`, `title`, `status`, `turn_count`, `start_time`. `-o wide` adds `end_time`, `user_id`, `has_errors`. Duration is not a list column; `get` shows it.
- A cron trigger's run history links to its transcript by `conversation_id`: `rpk ai trigger runs <agents/<agent>/triggers/<id>>`, then `rpk ai agent transcript get <agent> <conversation_id>`.

<!-- TODO(human): confirm what the `user_id` column in `-o wide` output holds before describing it. -->

### `rpk ai agent transcript get <agent> <conversation-id>`

- `table`/`wide` output prints a readable conversation log: a header (conversation, title, agent, status, start time, duration, input/output/total tokens, any error), the system prompt, then each turn with its role, model, timestamp, latency, tokens, content, and tool calls (name, status, latency, input, output, error). Tool input and output are truncated to 500 characters in this view.
- `-o json` / `-o yaml` return the full, untruncated structure; use them for scripting or when you need complete tool payloads.

### Transcripts in the UI

**Agents > <agent> > Transcripts** tab. Transcripts are per agent; there is no cross-agent transcripts view.

- List columns include Conversation, Started, Duration, Turns, Status (`Completed` / `Error` / `Running`), and Tokens. Click Started, Duration, Turns, or Tokens to sort the whole list (not just the page). The sort is kept in the URL, so a sorted view is shareable.
- Filters: a search box (conversation ID or title, case-insensitive, whole list) and a status dropdown. The list is paged, newest first, with a refresh control.
- Open a row for the detail view: a summary header (status, start, duration, turn count, total tokens) and a **Chat** / **Detailed** toggle. **Detailed** shows one card per turn with its tool calls, latency, LLM and tool call counts, and input/output tokens. Expand a tool call to read its **Arguments** and **Result** JSON and any error.
- A failure shows on the failing turn (a _Turn failed_ notice with the error message) or tool call (error status). The conversation-level status reads `Error`. Look for the detail on the turn, not in a conversation-level notice.
- A transcript stays `Running` while any turn is unfinished. That includes a process killed mid-run whose spans never finished arriving.
- MCP tool calls are labeled with the name the model called, which includes the server (for example, `servicenow__lookup_user`). Delegation to a subagent also appears as a tool call.

**Finding the slow step:** the Detailed view gives a turn's total latency and each tool call's duration, but not each model call's duration. Subtract tool time from turn latency. What remains is model time.

**Cost:** transcripts show tokens, not dollars. For spend by agent, model, or user, use **Cost and usage** (see [governance.md](governance.md)).

## Audit log (UI)

**Audit log** in the sidebar. It records authorization decisions across the Agentic Data Plane: who acted, on which resource, through which subsystem, from where, whether it was allowed, and which policy decided. It covers management actions, LLM calls, MCP tool calls, and agent-to-agent (A2A) requests through the gateway, including denied ones. There is no `rpk ai` command for it.

Access: needs audit log read permission. The Admin role grants it, as does a built-in template such as Read only, or an access policy granting audit log reads (see [governance.md](governance.md)). If the page shows but is empty for a period you know had activity, audit recording may not be enabled for the deployment. Page access and recording are independent.

### Reading the table

Default view: last 24 hours, newest first, loads more as you scroll. Default columns are Time (RFC 3339, UTC), Actor, Subsystem (such as MCP Gateway, LLM proxy, A2A proxy, Agents, Access control, Spending, or `Management API (legacy)` for services that declare none), Action (for example `tools/call`, or an LLM request path), Resource name, and Outcome. The **Fields** panel adds more columns, including Actor type, Groups, Agent, Agent UID, Invoked by, Service, Resource type/ID, Parent/Parent type, Policy, All policies, Policy UID, Status, Status detail, Activity, Event class, Source IP, and Source service. Column choice is stored per browser, not in the URL.

**Outcome** (as shown, and the values the `outcome` filter takes):

| Outcome | Meaning |
|---|---|
| Allowed | Everything the call decided on was allowed |
| Masked | Allowed and delivered, but a guardrail or data policy masked content |
| Partial | A call that decided on several resources allowed some and denied others |
| Denied | Refused, either by access policy or by a guardrail or data policy that ran after access was granted |

"Denied" is not the same as "no permission." When the caller has access but the call reads Denied, open the event: an Access row of Permit plus a Guardrail or Data policy row of Blocked means the later check stopped it. To find all refusals, filter on both `outcome=denied` and `outcome=partial`. Sorting by Outcome orders Allowed, Masked, Partial, Denied, so a descending sort puts denials on top. The timeline's denied percentage counts Partial as denied.

Use **Status** for whether the operation succeeded overall. **Activity** is Create / Read / Update / Delete / Other (a tool call reads Other). **Event class** is API Activity (an authorization decision) or Entity Management (a configuration change, with before/after versions in the detail pane).

### Filtering

- Search bar: a bare phrase matches the event message (case-insensitive, one phrase at a time). `field=value` includes, `field!=value` excludes, and `sort=<field>` or `sort=<field> desc` reorders. Field keys can differ from column labels (`operation` for Action, `deciding_policy` for Policy, `operation_status` for Status). Chips on different fields AND together; chips on the same field OR together.
- Fields panel: expand a field to see its most common values with call counts and denied counts. Click to filter, or use the exclude icon to hide. Activity, Event class, Status, All policies, and Groups take a typed value only.
- Time range: presets from Last 15 minutes to Last 14 days, or a custom range (UTC by default, switchable to local time). Click or drag on the timeline to zoom.
- Every filter, sort, and the open event are in the URL, so views are shareable. Every field sorts except All policies and Groups.

Example: MCP authorization failures in the last hour: `outcome=denied`, `subsystem=mcp-gateway`, range Last hour.

### Grouped calls

One row is one call. A call that decided on several resources (a list filtered by a policy, for example) shows Resource name as `Multiple resources (N)`, and an Outcome of Partial when some were denied. The detail pane's **Resources** section lists each resource with its own decision, denied first, and can be narrowed by exact resource ID (case-sensitive) or, for a Partial call, by Allowed/Denied. The Outcome tooltip on a Partial call shows how many resources were allowed.

### Delegation (on-behalf-of)

When an agent makes the call, the Actor cell shows the agent's name and the accountable identity, such as the user the agent acted for. **Invoked by** holds the authenticated caller when it differs from the effective user, for example the agent's service account. **Agent** / **Agent UID** name the bound agent. **Actor type** reads User, Service account, or Agent. `Unknown` (older events, configuration changes) means unknown, not User. **Groups** records the effective user's group memberships at authorization time. Empty means none were recorded, not that the actor had none. Filter with `actor_groups=<exact name>`, since spaces are significant.

### Inspecting an event

Expand a row, then **Open event details**. The pane shows the actor, groups, outcome, invoker, agent, subsystem, service, operation, resource, source IP, status detail, and a **Policies** section in evaluation order: **Access** (Permit/Deny), **Guardrail** (Blocked/Masked), and **Data policy** (Blocked/Masked/Passed), each linking to the policy. Depending on the action, the pane also shows Configuration change (before/after), Request, and Response sections.

- A guardrail appears only when the AI Gateway evaluated it itself. A guardrail Bedrock enforces inside the model call is not attributed here.
- Captured values may be `[REDACTED]`, truncated (bodies are cut at 16 KB), or absent. An empty field does not mean no activity. Treat outcome and policy as the authoritative record.
- An allowed call that skipped policy evaluation shows the status detail `allowed by internal-caller exemption; no policy evaluated`.

### What the MCP gateway records

The audit log records calls that were made, not MCP protocol chatter. An MCP session's setup and keep-alive messages (`initialize`, `ping`, `tools/list`, and notification messages) are recorded **only when refused or failed**. Tool calls and other methods are always recorded.

So a session that opens, lists tools, and stays alive leaves no entries until its first tool call. Do not count sessions from the audit log, and do not read a missing `initialize` entry as "no session was opened." The handshake and `tools/list` entries you do see are the refusals and failures.

## Accountability: transcripts vs. the audit log

- **Transcripts:** execution-level observability of one agent conversation: turns, tool calls and their payloads, models, latency, tokens, errors. Grouped by conversation ID.
- **Audit log:** authorization-level accountability across the platform: who (user, service account, or agent) attempted what against which resource, whether it was allowed, denied, or masked, which policy decided, and what configuration changed.

A transcript tells you what an agent did. The audit log tells you what any principal was allowed or refused to do. An investigation often needs both: find the decision in the audit log, then open the agent's transcript for execution detail.

## Other monitoring views (UI)

- **Home**: the landing page after sign-in. It shows items needing attention, an overall health status, recent AI Gateway traffic (tokens and spend over time), month-to-date spend and token totals, budget status, top spenders, and quick actions. No CLI equivalent.
- **Agents > Agent network**: a live graph of agents, the LLM providers they call, and the MCP servers and tools they use, with usage, cost, tokens, and health for a chosen window (last hour to last year, or custom). Select a node for its detail panel. Health (agent: Active / Degraded / Error / Pending; MCP server: Connected / Degraded / Error) derives from error rate in the window, and servers with credential or tool-call failures are flagged. Budget-blocked and provider-failed requests count as errors. View state is in the URL.
- **Agent Playground**: see [agents.md](agents.md) for live testing, session history, and the token/context estimate.
