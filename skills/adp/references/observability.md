Source: `cloudv2 apps/rpai/internal/cmd/{agent/transcript.go,auditlog/}` and `apps/rpai/testdata/commands-snapshot.md`, `cloudv2 proto/public/cloud/redpanda/api/adp/v1alpha2/trace.proto`, `adp-docs modules/monitor/pages/` (`traces.adoc`, `transcripts.adoc`, `audit-log.adoc`, `agent-network.adoc`, `monitor-agents.adoc`, `troubleshoot-ai-agents.adoc`), `modules/cli/pages/index.adoc`, `modules/control/pages/permissions-reference.adoc`. Full per-claim mapping and the dated verification log: the `references/observability.md` rows of `SOURCES.md`.

# Agentic Data Plane Observability Reference

**Maturity:** The docs carry no Preview or Experimental marker on traces, transcripts, the audit log, the Agent network view, or the Home dashboard. Traces dropped its Preview badge and its documented Preview marker with the release that moved it under **Observability**.

## Discover the live surface

```bash
# Transcripts are a subcommand of `agent` (aliases: transcripts, tr), not a top-level group
rpk ai agent transcript list <agent>
rpk ai agent transcript get <agent> <conversation-id>

# These are read-only top-level groups of their own
rpk ai auditlog --help      # aliases audit-log, audit; list, get, query
rpk ai trace --help         # list, get, span
rpk ai spending --help      # summary, breakdown, time-series, time-series-by-dimension, tag-keys
rpk ai agent-network --help # get, node, provider-failures
```

## Which surface answers which question

Traces (`rpk ai trace`), transcripts (`rpk ai agent transcript`) and the audit log (`rpk ai auditlog`) overlap and are easy to confuse — [Accountability](#accountability-traces-vs-transcripts-vs-the-audit-log) below says which answers what. The agent network (`rpk ai agent-network`) answers which agents call which models and tools and where errors cluster; for spend use `rpk ai spending` or **Cost and usage** (see [governance.md](governance.md)); to try an agent live use its **Playground** tab (UI, managed agents only; see [agents.md](agents.md)).

## Traces

A **trace** is the record of one agent run, broken into **spans**: a model call, a tool call, a subagent hand-off, a gateway call. A call that only the AI Gateway handled gets a trace of its own. Traces answer "where did this run spend its time, and which call failed?" across every agent and the gateway at once, without opening each agent separately.

In the UI: **Traces** under **Observability** in the sidebar (default Last 1 hour, newest first); from the terminal, `rpk ai trace` ([below](#read-traces-from-the-cli)). A row expands into its span waterfall beside a summary pane that includes every guardrail or data-policy decision met; a failed run's summary carries the error code and message it ended with, or *Error* in place of a code it did not record.

| Status | Meaning |
|---|---|
| Completed | The run finished. A run that finished *with* a failed tool call inside it is Completed, not Error — the failed-call count appears beside the status |
| Error | The run itself failed |
| Running | The root span is still open, or the trace has no root span and spans arrived in the last 15 minutes |
| Incomplete | No root span and no span in the last 15 minutes, so the record is partial |

A gateway-only trace is never Running or Incomplete. **Cost** covers the run's model calls only, in US dollars; an **asterisk** means only some calls could be priced, and no cost means none could.

**Span kinds** are `AGENT`, `SUBAGENT`, `LLM`, `TOOL`, `GATEWAY`, `COMPACTION` (a [context-compaction](#context-compaction) pass) and `SPAN`. A failed span shows its error on the tab holding its content (**Messages** for a model call, **Input & output** for a tool call or hand-off, **Gateway** for a gateway span), not on an agent-run span's **Overview**.

Traps worth knowing:

- **The Conversation cell navigates** to that conversation's transcript. To narrow the list to one conversation, use the Conversation filter instead.
- **Status is a tab row** — All, Errors, Running, Incomplete — one at a time, counting within everything else you filtered on. There is no Completed tab and no failed-calls tab, so to find a run that recovered from a failed tool call, read the Status column.
- **Each filter facet takes at most 20 values, and past that it silently stops applying** rather than reporting an error. The facets are Agent, User, Conversation, MCP server (servers whose tools the run called), and LLM provider (where OpenAI also matches OpenAI-compatible providers, which have no option of their own).
- **An absent trace is not proof that nothing happened.** A gateway record holding *only* upkeep nobody ran on purpose — MCP session setup and keepalives, tool and resource discovery, token issuance, internal ADP calls — is dropped before storage. A record holding a real model or tool call is kept whole, keepalives included.
- **A model can only call a tool it was offered**, so a run that skipped a tool you expected was often never offered it. A model call's **Tools** tab counts offered and used tools in groups: one per MCP server, **Subagents** (offered as tools but counted separately), and *Not via gateway* for tools the agent defines itself — don't fold subagents into *Not via gateway*. A gateway span's Tools tab reports only the count; a call whose offered tools were not recorded has no Tools tab.
- **A restricted span still shows its shape.** A span whose content your permissions don't reach reads **Restricted** but keeps its kind, timing, token use, emitting agent, error code and gateway status visible; prompts, messages and tool payloads stay hidden. A trace whose content you can't read shows **Restricted** in place of its title and reports no user.
- **Open transcript** is in the trace's *toolbar*, not the summary pane, and only for a trace that ran an agent: it opens that agent's transcript at the turn holding the selected span.

### Read traces from the CLI

`rpk ai trace` reads the same records: `list`, `get <trace>`, and `span list <trace>` / `span get <trace> <span-id>`.

```bash
rpk ai trace list --since 24h --errors
rpk ai trace list --since 7d --agent support --order-by "duration desc" --limit 10
rpk ai trace get <trace-id>                  # a trace ID, traces/<id>, or a trace link copied from the UI
rpk ai trace span list <trace-id> --ids      # the span IDs that `span get` takes
```

- **`--since` is required on `list`**, as an RFC 3339 timestamp or a duration ago (`15m`, `24h`, `7d`), and the window it opens is **at most 30 days**; `--until` ends the range earlier than now. No listing reads all of history. There is no `--page-size` or `--page-token` here: `--limit` caps the rows printed (default 50, maximum 1000) and the command pages internally to fill it.
- **Filter algebra:** values within one flag are ORed, different flags are ANDed, and `--filter` (raw AIP-160) is ANDed with all of them. A `--filter` term that repeats a field a flag already set is **rejected**, not narrowed — `--agent support --filter 'agent_uid = "..."'` fails. `--status` (repeatable: `running`, `completed`, `error`, `incomplete`) and `--errors` cannot be combined.
- **`--errors` is wider than the Error status.** It covers failed runs *and* runs that finished with a failed tool call inside them, which the UI's Status tab row cannot express — so it is the quickest way to find a run that recovered from a failed call.
- `--agent` takes a name or UID; `--user` matches an email against the caller and anything else against the end-user ID. `--order-by` defaults to `start_time desc`.
- **`rpk ai trace get --fail-on-error` exits 4** when the trace ended in error or stayed incomplete — how a scheduled job fails on a run that did not finish cleanly. Passing `get` a UI trace link rather than a bare ID also tells it where in time to look.

### Permissions

`dataplane_adp_trace_list` opens the list and its timeline, `dataplane_adp_trace_get` expands one trace and reads its spans, and `dataplane_adp_trace_content_read` reads the content of spans no agent or person owns and of other people's gateway calls. Without `_list` the page reports that permission was denied. The built-in *Read only* template and every template above it grant all three; in an access policy, name `Action::"Trace.list"`, `Action::"Trace.get"` and `Action::"Trace.read_content"`. Without `_content_read`, content follows ownership: an agent's spans need `dataplane_adp_transcript_get` on that agent (or `dataplane_adp_transcript_list` for a call made outside any conversation), and your own gateway calls are always yours to read.

## Transcripts

A transcript is the record of one agent conversation, turn by turn: the user message, the agent's response, the tool calls it made (arguments, result, status, duration, error), per-turn latency and token usage, and the system prompt when one was recorded. Transcripts cover both managed and self-managed agents. A self-managed agent's transcript holds only what its own instrumentation exports.

What a transcript holds depends on recording settings. On a managed agent, a *Metadata only* recording mode keeps the conversation's shape (tool names, status, duration) without content, and recording off produces no transcripts (see [agents.md](agents.md)). On an LLM provider, `transcripts.record_input_messages` / `transcripts.record_output_messages` (flags `--transcripts.record-input-messages` / `--transcripts.record-output-messages`) control prompt and response capture and default to on (see [gateway-and-providers.md](gateway-and-providers.md#transcript-recording-defaults-to-on)).

**Access warning:** transcripts can hold full prompts, responses and tool payloads, they are read separately from an agent's configuration, and the Admin role and every built-in policy template — even *Read only* — grant transcript (and audit-log) read access. Grant it only to people who need it.

### `rpk ai agent transcript list <agent>`

The filter flags — `--query`, `--status`, `--errors-only`, `--tool-errors-only`, `--end-user`, `--since` / `--until` — are all optional and ANDed; take their exact spellings from `--help`.

- **`--query` does not search conversation content**, although its help says "titles and content". It is a case-insensitive substring match on the conversation **title or ID**, so paste a conversation ID to find a conversation whose title you don't know, and don't offer it as a content search.
- `--status` takes `running|completed|error` (`complete`/`done` and `failed` are accepted synonyms) and errors on anything else, naming the valid values. `--since` / `--until` take an RFC 3339 timestamp or a duration meaning "that long ago" (`24h`).
- **`--tool-errors-only` finds a failed tool call inside a conversation that otherwise succeeded** — the UI's **Tools** filter and its one *Has tool errors* option. It reads a per-conversation count of failed tool calls, independent of `--errors-only` and `--status`, which read the conversation's own outcome; a `completed` conversation holding a failed tool call matches this filter and no other. `--tool-errors-only=false` returns only conversations with none. **The filter misses older conversations:** the count reads zero for a conversation last written before it existed, until new activity republishes it, while `get` derives the count from the conversation's own tool calls — so open an older conversation to see tool errors the list filter will not surface.
- The command walks every page and returns the full matching set; there is no page-size or sort flag. Duration is not a list column; `get` shows it.
- A cron trigger's run history links to its transcript by `conversation_id`: `rpk ai trigger runs <agents/<agent>/triggers/<id>>`, then `rpk ai agent transcript get <agent> <conversation_id>`.

### `rpk ai agent transcript get <agent> <conversation-id>`

- `table`/`wide` prints a readable conversation log — a header, the system prompt, then each turn with its role, model, timing, tokens, content and tool calls. **Tool input and output are truncated to 500 characters in this view**, so `-o json` / `-o yaml`, which return the full untruncated structure, are the ones to use for scripting or complete tool payloads.

### Transcripts in the UI

**Agents > <agent> > Transcripts** tab. Transcripts are per agent; there is no cross-agent transcripts view.

- The list sorts and filters the whole list (search matches conversation ID or title only). A row opens a **Chat** / **Detailed** view; **Detailed** shows one card per turn with its tool calls, latency and tokens.
- A tool call's dialog shows the **Arguments**, **Result** and any error, and names whatever the transcript didn't record, so an empty field means not recorded, not that nothing happened.
- A failure shows on the failing turn (a _Turn failed_ notice with the error message, and the error code when one was recorded) or tool call (error status), and the conversation-level status reads `Error`. A conversation also carries a notice above it collecting every error it recorded — see [Errors recorded in a conversation](#errors-recorded-in-a-conversation).
- A transcript stays `Running` while any turn is unfinished. That includes a process killed mid-run whose spans never finished arriving.
- MCP tool calls are labeled with the name the model called, which includes the server (for example, `servicenow__lookup_user`).
- A delegation to a subagent gets its own row with the subagent's name and a *Delegated* badge, not an ordinary tool-call row. Open it to see the delegated turn: the message it received, its response, its own tool calls and tokens.

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

In the **Detailed** view, each turn card carries a **context chip** (repeated as a **Context** metrics row) reporting how much of the model's context window the turn filled; click it for the tokens, the window and the share.

- **A turn's context size is not its input-token total.** Context size is the prompt the model read on the turn's **last** call, prompt-cache reads included; the input-token total sums **every** call the turn made and is what it cost, so a multi-call turn reports a context size *smaller* than its input total. Use context size for headroom and the input total (or **Cost and usage**) for spend; never read it as a cost or expect it to reconcile with the turn's token totals.
- **The window is not always known.** It comes from the OpenAI, Anthropic, Google Gemini API and Amazon Bedrock catalogs; a model none of them lists (one served through an OpenAI-compatible endpoint, for example) gets the context size alone and a note that its window is unknown.
- **No chip is not zero.** A turn whose model steps recorded no token usage, and any turn recorded before ADP began storing context size, shows no chip and no Context row.
- Read it alongside the compaction markers in the same conversation: a turn running close to its window is the one whose next step is likely to compact. See [Context compaction](#context-compaction).

### Context compaction

A managed agent reduces its own context to stay inside the model's window. The **Detailed** view marks each reduction with a **Context compacted** marker at the point it happened, carrying the estimated request size before and after the pass. These markers are a **Detailed**-view feature; **Chat** view does not show them.

- A long conversation can carry several markers, and a single turn can carry more than one: an agent compacts either when its own estimate nears the limit before a model step, or after the provider rejects a request as too large. Hover the marker to see which of the two ran.
- Expand a marker for what the pass removed (whole messages dropped, tool results replaced with short markers) and the before and after size by request part.
- **These sizes are the agent's own estimate of what it was about to send, not billed usage**, so they do not reconcile with the turn's token totals. Use them to see what the agent dropped, and **Cost and usage** for spend.
- No markers means either the conversation never compacted or the agent does not report compaction — not that nothing was dropped. Missing early messages, or tool results replaced by short markers, is normal in a long conversation and not a fault; the markers are how you tell a compacted detail apart from one the agent never had.

## Audit log

The audit log records authorization decisions across the Agentic Data Plane: who acted, on which resource, through which subsystem, from where, whether it was allowed, and which policy decided. It covers management actions, LLM calls, MCP tool calls, and agent-to-agent (A2A) requests through the gateway, including denied ones.

Two surfaces read the same events: **Audit log**, under **Observability** in the UI sidebar, and `rpk ai auditlog` on the command line. The UI is the better place to explore — the timeline, the Fields panel's value counts, and shareable URLs. The CLI is the better place for a scripted review, a repeatable query, or pulling a window of events into a file. Both need the same permission, and the log is read-only on both: there is no way to write or delete an entry.

Access: needs audit log read permission (`dataplane_adp_auditlog_list`). The Admin role grants it, as does a built-in template such as Read only, or an access policy granting audit log reads (see [governance.md](governance.md)). If the page or the CLI returns nothing for a period you know had activity, audit recording may not be enabled for the deployment. Read access and recording are independent, so an empty result is not proof that nothing happened.

### Read the audit log from the CLI

`rpk ai auditlog` (aliases `audit-log`, `audit`) has three read-only subcommands: `list` searches the log, `get` reads one entry in full, and `query` returns entries together with the timeline and facets the UI page draws, for a **bounded** time window you must set. All three need `dataplane_adp_auditlog_list`, the same permission as the UI page, and all exit **3** when you are not authenticated or lack it.

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

The filter flags mirror the UI's columns and field keys (`--actor`, `--agent`, `--group` and `--invoked-by` for [delegation](#delegation-on-behalf-of), `--operation`, `--outcome`, `--subsystem`, the resource and parent flags, and so on), and `--query` matches a case-insensitive substring of the entry message. Read the full flag list and accepted values from `rpk ai auditlog list --help` or the UI's Fields panel rather than hardcoding them.

**Output and fields.** `-o table` prints a lean column set; `-o wide`, `json`, `yaml`, and `markdown` add the decision and delegation fields. `--fields` picks which fields come back *and* which columns the table shows; `--fields all` returns every field including the request and entity bodies, which is slower. For one entry's bodies, use `get` instead.

**Paging.** `--limit` caps the entries printed (default **50**; `0` returns everything). When more remain, **the exit code stays 0** and the continuation flags are written to **stderr**: `--page-token`, plus the resolved `--since` and `--until` when your window was relative, so the next page covers the same window instead of sliding. Rerun with those flags and the same filters. So a script that reads only stdout and only the exit code will silently process the first 50 rows and believe it saw everything — check stderr, or set `--limit 0`. When nothing matches, stderr names the filter that was sent.

**Your own reads are audited.** Reading the audit log is itself an audited action, so your reads appear in later listings. Hide them with `--operation '!ListAuditLogEntries'`.

**Grouped calls on the CLI.** A grouped call ([below](#grouped-calls)) is a single row whose `RESOURCE_COUNT` says how many resources it decided on. Expand it with `rpk ai auditlog list --correlation-id <id>`, which returns one row per resource, denials first, and is **not bounded by `--since`** unless you pass it. `rpk ai auditlog get <id>` reads **one event, not a grouped call**, so its resources field is never filled — reach the members through `--correlation-id` and then `get` each. `-o yaml` is the readable form for request and entity bodies, and an unknown id exits 1.

### Reading the table (UI)

Default view: last 24 hours, newest first; the **Fields** panel adds columns beyond the default set.

**Outcome** (as shown, and the values the `outcome` filter takes): `Allowed` — everything the call decided on was allowed; `Masked` — allowed and delivered, but a guardrail or data policy masked content; `Partial` — a call that decided on several resources allowed some and denied others; `Denied` — refused, either by access policy or by a guardrail or data policy that ran after access was granted.

"Denied" is not the same as "no permission." When the caller has access but the call reads Denied, open the event: an Access row of Permit plus a Guardrail or Data policy row of Blocked means the later check stopped it. To find all refusals, filter on both `outcome=denied` and `outcome=partial`. The timeline's denied percentage counts Partial as denied.

**Outcome is not success:** use **Status** for whether the operation succeeded overall. **Activity** reads Other for a tool call, and **Event class** separates API Activity (an authorization decision) from Entity Management (a configuration change, which carries before/after versions).

### Filtering (UI)

- In the search bar, a bare phrase matches the event message and `field=value` / `field!=value` include and exclude. **Field keys can differ from column labels** (`operation` for Action, `deciding_policy` for Policy, `operation_status` for Status), and chips on different fields AND together while chips on the same field OR together.
- Filters, sort and the open event are all in the URL, so a view is shareable.

### Grouped calls

One row is one call. A call that decided on several resources (a list filtered by a policy, for example) shows Resource name as `Multiple resources (N)`, and an Outcome of Partial when some were denied. Such a call records **one decision per resource**, and those decisions open in the table, not in the detail pane: open the event, then click **View individual decisions**.

The table then lists only that call's decisions, denied first, across the call's whole history (not the selected window), until you click **Clear call filter**. In that view, don't filter on `outcome=partial`, which describes a call rather than one decision; filter by `allowed`, `denied` or `masked`, and narrow by typing `field=value` (the Fields panel counts by call, not by decision).

### Delegation (on-behalf-of)

When an agent makes the call, **Actor** shows the agent's name and the accountable identity, such as the user it acted for, while **Invoked by** holds the authenticated caller when that differs from the effective user (the agent's service account, for example); **Agent** / **Agent UID** name the bound agent. **Actor type** reads User, Service account or Agent. Two traps: it reads `Unknown` on older events and configuration changes, which means unknown rather than User; and an empty **Groups** means no memberships were recorded at authorization time, not that the actor had none. Filter it with `actor_groups=<exact name>`, since spaces are significant.

### Inspecting an event (UI)

Expand a row, then **Open event details**. Its **Policies** section lists the checks in evaluation order: **Access** (Permit/Deny), **Guardrail** (Blocked/Masked) and **Data policy** (Blocked/Masked/Passed). Depending on the action, the pane also has Configuration change (before/after), Request and Response sections. For a grouped call, those sections belong to each individual decision (see [Grouped calls](#grouped-calls)).

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

- **Home**: the landing page after sign-in (attention items, health, recent gateway traffic, spend and budget status), and the one view here with no CLI equivalent.
- **Observability > Agent network** (`rpk ai agent-network get` / `node` / `provider-failures` from the terminal): a live graph of agents, the agents they **call directly** as well as the subagents configured on them (each named in the legend), and the LLM providers, MCP servers and tools they use, with usage, cost, tokens and health for a chosen window. An agent's or MCP server's detail panel carries a **View traces** link that opens Traces filtered to that resource over the same window. Health derives from the window's error rate, and budget-blocked and provider-failed requests count as errors. Of the header figures, only the agent and MCP server counts follow a search or filter (`3 of 8`); conversations, tool calls, cost and tokens always cover the **whole** network.
- **Agent Playground**: see [agents.md](agents.md) for live testing, session history, and the token/context estimate.

## Permissions

For transcript and audit-log read access see the [Transcripts access warning](#transcripts); for the trace permissions see [above](#permissions); for the rest, [governance.md](governance.md#roles-and-permissions).
