Source: `cloudv2 apps/rpai/internal/cmd/{agent/transcript.go,auditlog/}` and `apps/rpai/testdata/commands-snapshot.md`, `cloudv2 proto/public/cloud/redpanda/api/adp/v1alpha2/trace.proto`, `adp-docs modules/monitor/pages/` (`traces.adoc`, `transcripts.adoc`, `audit-log.adoc`, `agent-network.adoc`, `monitor-agents.adoc`, `troubleshoot-ai-agents.adoc`), `modules/cli/pages/index.adoc`, `modules/control/pages/permissions-reference.adoc`. Full per-claim mapping and the dated verification log: the `references/observability.md` rows of `SOURCES.md`.

# Agentic Data Plane Observability Reference

**Maturity:** Redpanda Agentic Data Plane is generally available, and so is the `rpk ai` CLI. The docs carry no Preview or Experimental marker on traces, transcripts, the audit log, the Agent network view, or the Home dashboard. Traces dropped its Preview badge and its documented Preview marker with the release that moved it under **Observability**.

## Discover the live surface

```bash
# Transcripts are a subcommand of `agent` (aliases: transcripts, tr), not a top-level command.
rpk ai agent transcript --help
rpk ai agent transcript list --help

# List an agent's conversations, then open one
rpk ai agent transcript list <agent>
rpk ai agent transcript get <agent> <conversation-id>

# The audit log is its own top-level group (aliases: audit-log, audit), read-only
rpk ai auditlog --help
rpk ai auditlog list --help
```

The Traces view, the Home dashboard, and the Agent network view have no `rpk ai` command. They are UI-only: confirm with `rpk ai --help` before concluding otherwise.

## Where each question is answered

| Question | Surface |
|---|---|
| Which call made a run slow, expensive, or wrong, across every agent and the gateway? | **Observability > Traces** (UI) |
| What happened in one agent conversation (turns, tool calls, tokens, latency, errors)? | Transcripts: `rpk ai agent transcript`, or the agent's **Transcripts** tab |
| Who called what, was it allowed, which policy decided, what changed? | Audit log: `rpk ai auditlog list`, or **Observability > Audit log** in the UI |
| Which agents call which models and MCP tools, and where are errors clustering? | **Observability > Agent network** (UI) |
| Spend and traffic at a glance | **Home** (UI); for breakdowns, **Cost and usage** (see [governance.md](governance.md)) |
| Try an agent live, token/context estimate, reopen a past session | Agent **Playground** tab (UI, managed agents only; see [agents.md](agents.md)) |

## Traces

A **trace** is the record of one agent run, broken into **spans**: a model call, a tool call, a subagent hand-off, a gateway call. A call that only the AI Gateway handled gets a trace of its own. Traces answer "where did this run spend its time, and which call failed?" across every agent and the gateway at once, without opening each agent separately.

UI only: **Traces** under **Observability** in the sidebar. Default range is Last 1 hour, newest first; click a row to expand it into its span waterfall beside a pane holding either the trace summary or the selected span's detail. The summary reports the run's duration, tokens sent, received and cached, cost, model and tool call counts with how many failed, span count, where the time went (model, tools, orchestration), the tools used, and every guardrail or data-policy decision met. When the run failed and recorded an error, the summary also carries the error code and message it ended with, or *Error* in place of a code it did not record.

The list **loads more rows as you scroll** toward the end, with a count line reading how many have loaded out of the total when the total is known; there are no page controls and no rows-per-page selector, and loading more leaves an expanded trace open.

| Status | Meaning |
|---|---|
| Completed | The run finished. A run that finished *with* a failed tool call inside it is Completed, not Error — the failed-call count appears beside the status |
| Error | The run itself failed |
| Running | The root span is still open, or the trace has no root span and spans arrived in the last 15 minutes |
| Incomplete | No root span and no span in the last 15 minutes, so the record is partial |

A trace that only the gateway saw is never Running or Incomplete, because the gateway records each call after it serves it; its Agent cell stays empty unless an agent made the call. **Cost** covers the run's model calls in US dollars, as the gateway priced each; a tool call carries no cost of its own. Under $0.0001 it reads `<$0.0001`, an **asterisk** means only some of the run's calls could be priced, and a run whose calls could not be priced at all shows no cost.

**Span kinds** (the waterfall badges) are `AGENT` (one run or turn), `SUBAGENT` (a run handed off), `LLM` (one model call), `TOOL` (one tool call), `GATEWAY` (what the gateway saw of a call it served, nested under the agent's own call), `COMPACTION` (a [context-compaction](#context-compaction) pass) and `SPAN` (anything else). A span's tabs follow its kind — a model call carries tokens, cost, messages and offered tools; a tool call or hand-off its input and output; a gateway span the caller, route, HTTP status and timings — and every readable span also carries its OpenTelemetry attributes and the raw stored span. A failed span reports its error code and message on the tab that holds its content — **Messages** for a model call, **Input & output** for a tool call or a subagent hand-off, **Gateway** for a gateway span — so an agent-run span's **Overview** is not where to look for it; a call the gateway refused shows what it rejected, such as a budget block or a model policy does not allow. Spans that arrive before the span opening the run sit under a stand-in labeled **Run in progress**, or **Run incomplete** once the run stopped sending spans.

Traps worth knowing:

- **The Conversation cell navigates** to that conversation's transcript. To narrow the list to one conversation, use the Conversation filter instead.
- **Status is a tab row** — All, Errors, Running, Incomplete — one at a time, counting within everything else you filtered on. There is no Completed tab and no failed-calls tab, so to find a run that recovered from a failed tool call, read the Status column.
- **Each filter facet takes at most 20 values, and past that it silently stops applying** rather than reporting an error. The facets are Agent, User, Conversation, MCP server (servers whose tools the run called), and LLM provider (where OpenAI also matches OpenAI-compatible providers, which have no option of their own).
- **An absent trace is not proof that nothing happened.** A gateway record holding *only* upkeep nobody ran on purpose — MCP session setup and keepalives, tool and resource discovery, token issuance, internal ADP calls — is dropped before storage. A record holding a real model or tool call is kept whole, keepalives included.
- **A model can only call a tool it was offered**, so a run that skipped a tool you expected is often a run that was never offered it. A model call's **Tools** tab reports how many tools it offered and how many it used, grouped by the MCP server they came from, with the agent's own tools under *Not via gateway*. A gateway span's Tools tab reports only the count, and a call whose offered tools were not recorded has no Tools tab at all.
- **A restricted span still shows its shape.** A span whose content your permissions don't reach reads **Restricted** but keeps its kind, timing, token use, emitting agent, error code and gateway status visible; prompts, messages and tool payloads stay hidden. A trace whose content you can't read shows **Restricted** in place of its title and reports no user.
- **Open transcript** is in the trace's *toolbar*, not the summary pane, and only for a trace that ran an agent: it opens that agent's transcript at the turn holding the selected span.

### Permissions

`dataplane_adp_trace_list` opens the list and its timeline, `dataplane_adp_trace_get` expands one trace and reads its spans, and `dataplane_adp_trace_content_read` reads the content of spans no agent or person owns and of other people's gateway calls. Without `_list` the page reports that permission was denied. The built-in *Read only* template and every template above it grant all three; in an access policy, name `Action::"Trace.list"`, `Action::"Trace.get"` and `Action::"Trace.read_content"`. Without `_content_read`, content follows ownership: an agent's spans need `dataplane_adp_transcript_get` on that agent (or `dataplane_adp_transcript_list` for a call made outside any conversation), and your own gateway calls are always yours to read.

## Transcripts

A transcript is the record of one agent conversation, turn by turn: the user message, the agent's response, the tool calls it made (arguments, result, status, duration, error), per-turn latency and token usage, and the system prompt when one was recorded. Transcripts cover both managed and self-managed agents. A self-managed agent's transcript holds only what its own instrumentation exports.

What a transcript holds depends on recording settings. On a managed agent, a *Metadata only* recording mode keeps the conversation's shape (tool names, status, duration) without content, and recording off produces no transcripts (see [agents.md](agents.md)). On an LLM provider, `transcripts.record_input_messages` / `transcripts.record_output_messages` (flags `--transcripts.record-input-messages` / `--transcripts.record-output-messages`) control prompt and response capture and default to on (see [gateway-and-providers.md](gateway-and-providers.md#transcript-recording-defaults-to-on)).

**Access warning:** transcripts can hold full prompts, responses, and tool payloads. The Admin role and every built-in policy template, even Read only, grant transcript read access. Grant it only to people who need it.

### `rpk ai agent transcript list <agent>`

Filter flags (all optional, ANDed):

| Flag | Meaning |
|---|---|
| `--query <text>` | Case-insensitive substring match on the conversation title or conversation ID. It does not search conversation content, even though the flag help says "titles and content". Paste a conversation ID to find a conversation whose title you don't know |
| `--status running\|completed\|error` | Narrow by conversation state (`complete`/`done` and `failed` are accepted synonyms). Any other value errors: `unknown --status "<v>" (want running\|completed\|error)` |
| `--errors-only` | Only conversations that contain errors |
| `--since <t>` / `--until <t>` | Conversations started at/after, or before, `<t>`. Accepts an RFC 3339 timestamp or a duration meaning "that long ago" (`24h`, `1h`) |

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
- Open a row for the detail view: a summary header (status, start, duration, turn count, total tokens) and a **Chat** / **Detailed** toggle. **Detailed** shows one card per turn with its tool calls, latency, LLM and tool call counts, and input/output tokens. Click a tool call to open it in a dialog with the **Arguments** the agent sent, the **Result** it got back, and the error when the call failed. The dialog opens for **every** tool call and names whichever of those the transcript did not record, so "nothing here" means not recorded, not nothing happened. A delegation row is the exception: it opens the delegated turn instead (see below).
- A failure shows on the failing turn (a _Turn failed_ notice with the error message, and the error code when one was recorded) or tool call (error status), and the conversation-level status reads `Error`. A conversation also carries a notice above it collecting every error it recorded — see [Errors recorded in a conversation](#errors-recorded-in-a-conversation).
- A transcript stays `Running` while any turn is unfinished. That includes a process killed mid-run whose spans never finished arriving.
- MCP tool calls are labeled with the name the model called, which includes the server (for example, `servicenow__lookup_user`).
- A delegation to a subagent is **not** shown as an ordinary tool call: it gets its own row carrying the subagent's name (not a tool name) with a *Delegated* badge, the delegation's duration, and the delegated turn's input and output tokens. Click it to open the delegated turn: its model, latency, call counts and tokens, the message it received, the response it returned (with its own failure notice when it failed), and its own tool calls. The delegating call's **Arguments** and **Result** sit collapsed under the turn, only when the transcript recorded them. A delegated turn that has not reached the transcript yet says so in place of the turn. Delegation is recognized from the subagent's own execution, not the tool's name, and conversations recorded before transcripts kept that link show delegations as ordinary tool calls.

**Finding the slow step:** the Detailed view gives a turn's total latency and each tool call's duration, but not each model call's duration. Subtract tool time from turn latency. What remains is model time.

**Cost:** transcripts show tokens, not dollars. For spend by agent, model, or user, use **Cost and usage** (see [governance.md](governance.md)).

### Errors recorded in a conversation

A transcript keeps **each failure as its own record**, so a step that failed stays listed even after a retry succeeded. Above the conversation, a notice reports how many sign-in records and how many error records the conversation holds; **Error details** on the notice opens the list. Each record carries:

- **A category**: *Sign-in request* (a missing user connection, an expired token, a missing scope, or a credential the upstream provider rejected), *Bedrock error* (one Amazon Bedrock reported), or *Recorded error* (everything else).
- The error message, or a note that none was recorded.
- The tool or model the failure happened on, or the turn it was recorded on.
- **Technical details**, which expands to the record's source and to the error code when one was recorded.

- **When every record is a sign-in one the notice reads _Sign-in requested_**, not *Errors recorded*: the conversation is waiting on a user connection rather than reporting a fault. Reconnect the provider the record names and run the conversation again (see [mcp-servers.md](mcp-servers.md#what-a-caller-without-a-connection-can-do-user_oauth)).
- **An empty list is not proof of a clean run.** The records cover at most the seven days before the conversation's last turn, up to 1,000 of them; past either limit the notice says the error history is limited. If the lookup itself fails, the notice says error records are unavailable — read the turns and tool calls instead.

### Context size per turn

In the **Detailed** view, each turn card carries a **context chip** beside the turn's latency, reporting how much of the model's context window that turn filled. Click it for the exact figures: the tokens the prompt used, the window they were measured against, and the share of the window they took. The turn's metrics repeat the same figure as a **Context** row.

- **A turn's context size is not its input-token total, and the two answer different questions.** Context size is the prompt the model read on the turn's **last** call, including anything served from the provider's prompt cache. The input-token total adds up **every** call the agent made to finish the turn, and that is what the turn cost. A turn that took several calls therefore reports a context size *smaller* than its input total. Use context size to see how close the turn came to the window, and the input total (or **Cost and usage**) for spend. Never read the context figure as a cost, or expect it to reconcile with the turn's token totals.
- **The window is not always known.** Redpanda reads it from the model catalogs of the **OpenAI**, **Anthropic**, **Google Gemini API**, and **AWS Bedrock** provider types. A model none of those catalogs lists — one served through an OpenAI-compatible endpoint, for example — has no known window, so the chip reports the context size on its own and says the window is unknown for that model.
- **No chip is not zero.** A turn whose model steps recorded no token usage, and any turn recorded before ADP began storing context size, shows no chip and no Context row.
- Read it alongside the compaction markers in the same conversation: a turn running close to its window is the one whose next step is likely to compact. See [Context compaction](#context-compaction).

### Context compaction

A managed agent reduces its own context to stay inside the model's window. The **Detailed** view marks each reduction with a **Context compacted** marker at the point it happened, carrying the estimated request size before and after the pass. These markers are a **Detailed**-view feature; **Chat** view does not show them.

- A long conversation can carry several markers, and a single turn can carry more than one: an agent compacts either when its own estimate nears the limit before a model step, or after the provider rejects a request as too large. Hover the marker to see which of the two ran.
- Expand a marker for what the pass removed: how many whole messages it dropped and how many tool results it replaced with short markers (a pass that removed neither says so), plus the before and after size split across the parts that make up a request — system prompt, tool definitions, text, reasoning, tool calls, tool results, and framing. A part that is empty on both sides is left out.
- **These sizes are the agent's own estimate of what it was about to send, not billed usage**, so they do not reconcile with the turn's token totals. Use them to see what the agent dropped, and **Cost and usage** for spend.
- No markers means either the conversation never compacted or the agent does not report compaction — not that nothing was dropped. Missing early messages, or tool results replaced by short markers, is normal in a long conversation and not a fault; the markers are how you tell a compacted detail apart from one the agent never had.

## Audit log

The audit log records authorization decisions across the Agentic Data Plane: who acted, on which resource, through which subsystem, from where, whether it was allowed, and which policy decided. It covers management actions, LLM calls, MCP tool calls, and agent-to-agent (A2A) requests through the gateway, including denied ones.

Two surfaces read the same events: **Audit log**, under **Observability** in the UI sidebar, and `rpk ai auditlog` on the command line. The UI is the better place to explore — the timeline, the Fields panel's value counts, and shareable URLs. The CLI is the better place for a scripted review, a repeatable query, or pulling a window of events into a file. Both need the same permission, and the log is read-only on both: there is no way to write or delete an entry.

Access: needs audit log read permission (`dataplane_adp_auditlog_list`). The Admin role grants it, as does a built-in template such as Read only, or an access policy granting audit log reads (see [governance.md](governance.md)). If the page or the CLI returns nothing for a period you know had activity, audit recording may not be enabled for the deployment. Read access and recording are independent, so an empty result is not proof that nothing happened.

### Read the audit log from the CLI

`rpk ai auditlog` (aliases `audit-log`, `audit`) has two read-only subcommands: `list` searches the log, `get` reads one entry in full. Both need `dataplane_adp_auditlog_list`, the same permission as the UI page, and both exit **3** when you are not authenticated or lack it. If `rpk ai auditlog` is not recognized, the installed plugin predates the group — run `rpk ai upgrade`.

```bash
# Everything wholly or partly denied in the last hour
rpk ai auditlog list --since 1h --denied

# Why was an MCP tool call denied
rpk ai auditlog list --operation tools/call --denied --since 7d \
  --fields time,actor,resource_parent_id,resource_id,deciding_policy,response_error

# Config changes in the last week, with the before/after state
rpk ai auditlog list --since 7d --event-class entity-management \
  --fields time,actor,operation,resource_id,entity_before,entity_after -o yaml

# Read one entry with every field, bodies included
rpk ai auditlog get <id> -o yaml
```

**The window.** `--since` defaults to **24h** (or to no lower bound with `--correlation-id`), and takes an RFC 3339 timestamp, a duration ago (`15m`, `24h`, `7d`, `2w`), or `all` for no lower bound. `all` scans the whole archive and can hit the server's 30-second query limit, so prefer a bounded window and page through it. `--until` is exclusive and must be after `--since`.

**How the filter flags combine.** Each flag matches one field. Values *within* one flag are ORed; *different* flags are ANDed. Repeat a flag or separate its values with commas (a literal comma is `\,`).

- A leading `!` negates: `--subsystem '!llm-proxy'`. **Quote it** — in an interactive shell `!` is history expansion. A literal leading `!` is `\!`.
- The resource, parent, `--policy`, and `--status` flags match a call when **any one of its resources** matches, and return the whole call.
- `--denied` is shorthand for `--outcome denied,partial` — anything with a refusal in it. `--outcome denied` alone leaves out partly denied calls, which is the same trap as filtering the UI on `denied` only.
- `--agent` and `--policy` take a bare name that also matches the qualified form (`agents/<name>`; `policies/<name>` and `guardrails/<name>` for `--policy`); a value containing `/` is sent verbatim.
- `--group` accepts at most **4 values per request** (a server limit).
- `--order-by` takes a field with an optional ` desc`, default `time desc`.

The flags map onto the same vocabulary as the UI's columns and field keys: `--actor`, `--actor-type`, `--invoked-by`, `--agent`, `--agent-uid`, `--group` (the delegation fields; see [Delegation (on-behalf-of)](#delegation-on-behalf-of)), `--resource-type`/`--resource-id`/`--resource-name`, `--parent-type`/`--parent-id`, `--policy`, `--outcome`, `--status`, `--activity`, `--event-class`, `--subsystem`, `--service`, `--source-service`, `--source-ip`, `--operation`, `--correlation-id`, and `--query` for a case-insensitive substring of the entry message. Read the accepted values from `rpk ai auditlog list --help` or the UI's Fields panel rather than hardcoding them.

**Output and fields.** `-o table` prints a lean column set; `-o wide`, `json`, `yaml`, and `markdown` add the decision and delegation fields. `--fields` picks which fields come back *and* which columns the table shows; `--fields all` returns every field including the request and entity bodies, which is slower. For one entry's bodies, use `get` instead.

**Paging.** `--limit` caps the entries printed (default **50**; `0` returns everything). When more remain, **the exit code stays 0** and the continuation flags are written to **stderr**: `--page-token`, plus the resolved `--since` and `--until` when your window was relative, so the next page covers the same window instead of sliding. Rerun with those flags and the same filters. So a script that reads only stdout and only the exit code will silently process the first 50 rows and believe it saw everything — check stderr, or set `--limit 0`. When nothing matches, stderr names the filter that was sent.

**Your own reads are audited.** Reading the audit log is itself an audited action, so your reads appear in later listings. Hide them with `--operation '!ListAuditLogEntries'`.

**Grouped calls on the CLI.** One row is one call, and a call that decided on several resources is a single grouped row whose `RESOURCE_COUNT` says how many (see [Grouped calls](#grouped-calls)). To expand one, run `rpk ai auditlog list --correlation-id <id>`: that returns one row per resource, denials first, and is not bounded by `--since` unless you pass it. Each member's id then works with `get`.

`rpk ai auditlog get <id>` reads **one event, not a grouped call**, so its resources field is never filled — reach a grouped call's members through `--correlation-id` as above. `--fields` narrows the entry; `-o yaml` is the readable form for request and entity bodies. An unknown id exits 1.

### Reading the table (UI)

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

### Filtering (UI)

- Search bar: a bare phrase matches the event message (case-insensitive, one phrase at a time). `field=value` includes, `field!=value` excludes, and `sort=<field>` or `sort=<field> desc` reorders. Field keys can differ from column labels (`operation` for Action, `deciding_policy` for Policy, `operation_status` for Status). Chips on different fields AND together; chips on the same field OR together.
- Fields panel: expand a field to see its most common values with call counts and denied counts. Click to filter, or use the exclude icon to hide. Activity, Event class, Status, All policies, and Groups take a typed value only.
- Time range: presets from Last 15 minutes to Last 14 days, or a custom range (UTC by default, switchable to local time). Click or drag on the timeline to zoom.
- Every filter, sort, and the open event are in the URL, so views are shareable. Every field sorts except All policies and Groups.

Example: MCP authorization failures in the last hour: `outcome=denied`, `subsystem=mcp-gateway`, range Last hour.

### Grouped calls

One row is one call. A call that decided on several resources (a list filtered by a policy, for example) shows Resource name as `Multiple resources (N)`, and an Outcome of Partial when some were denied. Such a call records **one decision per resource**, and those decisions open in the table, not in the detail pane: open the event, then click **View individual decisions**.

The table then lists only that call's decisions, denied first, under a bar that names the call and carries **Clear call filter**. While that filter is on:

- The table covers the call's whole recorded history rather than the selected window; the range control reads All time and the timeline is hidden.
- Sorting is off, because the decisions already come denied first. The search bar refuses a `sort=` filter and says so.
- The Fields panel counts values by call, not by decision, so narrow the decisions by typing `field=value` in the search bar.
- `outcome=partial` describes a call rather than one decision; filter by `allowed`, `denied`, or `masked` instead.

Click a decision to read it in the pane, which heads it *Individual decision*. **Clear call filter** returns to the events you came from, with the same window, rows, and open event.

Outcome tooltips: on a call that decided on a single resource, hover over the outcome to see the policy that decided it. A Partial call's tooltip reports how many of its resources were allowed, and the policy behind each one sits on that resource's individual decision.

### Delegation (on-behalf-of)

When an agent makes the call, the Actor cell shows the agent's name and the accountable identity, such as the user the agent acted for. **Invoked by** holds the authenticated caller when it differs from the effective user, for example the agent's service account. **Agent** / **Agent UID** name the bound agent. **Actor type** reads User, Service account, or Agent. `Unknown` (older events, configuration changes) means unknown, not User. **Groups** records the effective user's group memberships at authorization time. Empty means none were recorded, not that the actor had none. Filter with `actor_groups=<exact name>`, since spaces are significant.

### Inspecting an event (UI)

Expand a row, then **Open event details**. The pane shows the actor, groups, outcome, invoker, agent, subsystem, service, operation, resource, correlation ID, source IP, status detail, and a **Policies** section in evaluation order: **Access** (Permit/Deny), **Guardrail** (Blocked/Masked), and **Data policy** (Blocked/Masked/Passed), each linking to the policy. Depending on the action, the pane also shows Configuration change (before/after), Request, and Response sections. On a call that decided on more than one resource the pane carries the event summary and the **View individual decisions** link only: the Policies, Configuration change, Request, and Response sections belong to each individual decision (see [Grouped calls](#grouped-calls)). If part of an event fails to load, the affected rows read Unavailable and the pane offers a single **Retry**.

- A guardrail appears only when the AI Gateway evaluated it itself. A guardrail Bedrock enforces inside the model call is not attributed here.
- Captured values may be `[REDACTED]`, truncated (bodies are cut at 16 KB), or absent. An empty field does not mean no activity. Treat outcome and policy as the authoritative record.
- An allowed call that skipped policy evaluation shows the status detail `allowed by internal-caller exemption; no policy evaluated`.

### What the MCP gateway records

The audit log records calls that were made, not MCP protocol chatter. An MCP session's setup and keep-alive messages (`initialize`, `ping`, `tools/list`, and notification messages) are recorded **only when refused or failed**. Tool calls and other methods are always recorded.

So a session that opens, lists tools, and stays alive leaves no entries until its first tool call. Do not count sessions from the audit log, and do not read a missing `initialize` entry as "no session was opened." The handshake and `tools/list` entries you do see are the refusals and failures.

## Accountability: traces vs. transcripts vs. the audit log

- **Traces:** one row per run across every agent and the AI Gateway, with timing, token use, cost and the span tree — *where* a run spent its time and *which* call failed.
- **Transcripts:** one agent conversation in full, turn by turn, with tool payloads, models, latency, tokens and errors — what the agent and the person said to each other.
- **Audit log:** authorization decisions across the platform — who attempted what against which resource, whether it was allowed, denied or masked, which policy decided, and what configuration changed.

A trace and a transcript cover the same run from different angles, and **Open transcript** crosses from the selected span to the matching turn. An investigation often needs more than one: the decision in the audit log, the slow or failed call in traces, the execution detail in the transcript.

## Other monitoring views (UI)

- **Home**: the landing page after sign-in. It shows items needing attention, an overall health status, recent AI Gateway traffic (tokens and spend over time), month-to-date spend and token totals, budget status, top spenders, and quick actions. No CLI equivalent.
- **Observability > Agent network**: a live graph of agents, their subagents, the LLM providers they call, and the MCP servers and tools they use, with usage, cost, tokens, and health for a chosen window (last hour to last year, or custom). Select a node for its detail panel; for an agent or an MCP server the panel also carries a **View traces** link that opens Traces filtered to that resource over the same window (a provider or tool panel carries none). Health (agent: Active / Degraded / Error / Pending; MCP server: Connected / Degraded / Error) derives from error rate in the window, and servers with credential or tool-call failures are flagged. Budget-blocked and provider-failed requests count as errors. View state is in the URL.
  - **Scope the graph** with *Search resources* (name or ID across agents, subagents, providers, servers and tool names; a matched tool keeps its server and a matched subagent its parent, so the match stays reachable), *Filters* → *Related only* (the selection and what it connects to directly; needs a selection), and *Resources* (hide whole kinds, *Show all* to restore). The header's conversation, tool-call, cost and token figures always cover the **whole** network; only the agent and MCP server counts read as `3 of 8`.
- **Agent Playground**: see [agents.md](agents.md) for live testing, session history, and the token/context estimate.

## Permissions

Transcript reads (`dataplane_adp_transcript_*`) are separate from agent configuration reads and expose full conversation content. The audit log needs `dataplane_adp_auditlog_list` on both surfaces — the UI page and `rpk ai auditlog` — the Agent network view needs `dataplane_adp_agentnetwork_get`, and Traces needs the three `dataplane_adp_trace_*` permissions above. The built-in *Read only* policy template and every template above it include transcript and audit-log reads. See [governance.md](governance.md#roles-and-permissions).
