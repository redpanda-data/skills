Source: `cloudv2/proto/public/cloud/redpanda/api/adp/v1alpha1/transcript.proto` (TranscriptsService lines 21-42, TranscriptSummary lines 172-207, TranscriptTurn lines 135-167, TranscriptToolCall lines 113-132, ListTranscriptsRequest/Filter lines 216-264, GetTranscriptResponse lines 288-298). Service registration confirmed at `cloudv2/apps/adp-api/internal/server/server.go:344-348`. Experimental service: `cloudv2/proto/public/cloud/redpanda/api/adp/experimental/v1alpha1/insights_service.proto` (InsightsService lines 13-27, Insights message lines 41-49). InsightsService registration confirmed at `cloudv2/apps/aigw/internal/server/server.go:1225-1229`. Audit log service: `cloudv2/proto/public/cloud/redpanda/api/adp/v1alpha1/audit_log.proto` (AuditLogService RPCs, AuditLogEntry fields, AuditOutcome/AuditOperationStatus/AuditEventClass enums, ListAuditLogEntriesRequest filters); AuditLogService registration confirmed at `cloudv2/apps/adp-api/internal/server/server.go`. Accountability framing from `adp-docs/modules/monitor/pages/concepts.adoc:323-334`. The audit-log read surface — the `QueryAuditLog` custom method, the shared `AuditLogFilter` (`terms` / `AuditLogFilterTerm`, replacing the removed typed filter fields), `order_by`, `AUDIT_OUTCOME_MASKED`, `AuditLogEntryPolicy` / `AuditPolicyDecision` / `AuditLogGuardrailFinding`, and the `actor_type`, `resource_parent_type` / `resource_parent_id`, `resource_name`, `policy_uid`, `request_flags`, `deciding_policies`, `policies` and `status_detail` entry fields — verified against `audit_log.proto` on 2026-09-07. `ListTranscriptsRequest.order_by` verified against `transcript.proto`, and the `query` filter's title-or-conversation-ID match against `cloudv2/apps/adp-api/internal/storage/transcript/repository_oxla.go`, on 2026-09-07. Evidence date: 2026-09-07.

# Agentic Data Plane Observability Reference

**Maturity:** Redpanda Agentic Data Plane is generally available. `TranscriptsService` is on the `v1alpha1` version path and is non-experimental (package path `redpanda.api.adp.v1alpha1`; the proto carries no `LaunchStage` annotation, so treat field-level details as still evolving and confirm them live). `InsightsService` is Experimental (package path `redpanda.api.adp.experimental.v1alpha1`; the proto header explicitly warns it may change shape without a version bump or be removed entirely). Do not depend on `InsightsService` from stable clients.

Audience: an AI agent using Agentic Data Plane observability via the Agentic Data Plane API and `rpk ai`. Optimize for correct programmatic use.

Related references: [SKILL.md](../SKILL.md), [agents.md](agents.md), [mcp-servers.md](mcp-servers.md), [gateway-and-providers.md](gateway-and-providers.md), [governance.md](governance.md), [rpk-ai.md](rpk-ai.md).

## Discover the live surface

Before acting, confirm available operations and current state:

```bash
# Transcripts are a subcommand of `agent`, not a top-level command.
# See all subcommands and flags:
rpk ai agent transcript --help

# List recent transcripts for a specific agent
rpk ai agent transcript list <agent>
```

The sections below document the proto-verified surface. For exact field lists and current limits, confirm live via `--help` and by calling the relevant list or describe operations.

## `TranscriptsService` RPCs

Source: `transcript.proto:21`. Served: `adp-api server.go:344-348`. On the `v1alpha1` version path, non-experimental.

| RPC | Request | Response | Cedar permission |
|-----|---------|----------|-----------------|
| `ListTranscripts` | `ListTranscriptsRequest` | `ListTranscriptsResponse` | `dataplane_adp_transcript_list` |
| `GetTranscript` | `GetTranscriptRequest` | `GetTranscriptResponse` | `dataplane_adp_transcript_get` |

Both RPCs carry `resource_type: "agents"` and `id_getter_cel: "request.agent_id"`. The service supports both managed Redpanda agents and bring-your-own-agent (BYOA / self-managed) deployments.

### How transcripts are grouped

The grouping key is `gen_ai.conversation.id` (an OTel span attribute). A conversation may span multiple agent invocations; all spans sharing the same `conversation_id` are aggregated into one `TranscriptSummary`. The data is OTel spans consumed from the dataplane traces topic, grouped by this key (`transcript.proto:19-20`).

### `ListTranscripts` filter fields

The `ListTranscriptsRequest` carries a `filter` sub-message (`transcript.proto:216`):

| Filter field | Type | Notes |
|-------------|------|-------|
| `start_time`, `end_time` | timestamp | Time range for the listing |
| `status` | `TranscriptStatus` enum | Filter by conversation state |
| `query` | string | Case-insensitive substring match over the conversation **title** and the **conversation ID** (max 256 chars) |
| `has_errors` | optional bool | Narrow to errored or error-free conversations |
| `page_size` | int32 | Default 50, max 100; set to -1 to disable pagination |

`query` matching the conversation ID as well as the title means you can paste a `gen_ai.conversation.id` straight into the search filter to find a conversation whose title you do not know.

### Sorting the transcript list

`ListTranscriptsRequest.order_by` (field 5, not part of `filter`) is an AIP-132 order expression: exactly one field, optionally followed by `asc` or `desc`, max 256 characters. Supported fields are `start_time`, `duration`, `turn_count`, and `usage.total_tokens`; the default is `start_time desc`. Anything else returns `INVALID_ARGUMENT`.

`ListTranscriptsResponse` carries no `total_size` — transcripts are a "load more" feed, so page with `next_page_token` and do not expect a total count.

### `TranscriptSummary` fields

`ListTranscriptsResponse` and `GetTranscriptResponse` both include a `TranscriptSummary` (`transcript.proto:172`) that aggregates metadata across all spans sharing one `conversation_id`:

| Field | Notes |
|-------|-------|
| `conversation_id` | string (REQUIRED) -- OTel `gen_ai.conversation.id` |
| `agent_id` | string (OUTPUT_ONLY) -- managed or BYOA agent identifier |
| `title` | string -- short description |
| `start_time`, `end_time`, `duration` | Span time bounds |
| `status` | `TranscriptStatus` enum: UNSPECIFIED / RUNNING / COMPLETED / ERROR |
| `turn_count` | int32 |
| `usage` | `TranscriptUsage`: `input_tokens`, `output_tokens`, `total_tokens`, `estimated_cost_usd` |
| `user_id` | string |
| `has_errors` | bool |

### `GetTranscriptResponse` structure

`GetTranscriptResponse` (`transcript.proto:288`) provides the full detail for one conversation:

| Field | Type | Notes |
|-------|------|-------|
| `summary` | `TranscriptSummary` | Aggregated metadata (see above) |
| `system_prompt` | string | Effective system prompt for the conversation |
| `turns` | repeated `TranscriptTurn` | Ordered list of conversation turns |
| `error` | `TranscriptError` | Top-level error if the conversation failed |

### `TranscriptTurn` fields

Each `TranscriptTurn` (`transcript.proto:135`) represents one exchange step:

| Field | Notes |
|-------|-------|
| `turn_id` | string (REQUIRED) -- sourced from OTel span ID |
| `role` | `TranscriptTurnRole` enum: UNSPECIFIED / SYSTEM / USER / ASSISTANT / TOOL |
| `timestamp`, `content`, `model`, `latency`, `usage` | Standard turn metadata |
| `tool_calls` | repeated `TranscriptToolCall` |
| `error` | `TranscriptError` |
| `is_reconstructed` | bool -- set when earlier spans were evicted; turn lacks precise timestamps, latency, and usage |

### `TranscriptToolCall` fields

Each `TranscriptToolCall` (`transcript.proto:113`) corresponds to a child OTel span with `gen_ai.operation.name = "execute_tool"`:

`tool_call_id`, `name`, `status`, `latency`, `input`, `output`, `error`

### Cost fields in transcripts

`TranscriptUsage` (`transcript.proto:91`) is sourced from `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` OTel span attributes. `estimated_cost_usd` is available on `TranscriptSummary.usage` for per-conversation cost visibility. For tenant-wide cost analysis and budget enforcement, use `SpendingService` and `BudgetService` (see [governance.md](governance.md)).

## `InsightsService` (Experimental)

Source: `experimental/v1alpha1/insights_service.proto:13`. Served: `aigw server.go:1225-1229`. **Experimental** -- the proto header (`insights_service.proto:3-6`) explicitly states this package is provisional, backs in-flight surfaces (the Agentic Data Plane home dashboard), may change shape without a version bump, and may be removed entirely.

### `GetInsights` RPC

| RPC | Authorization |
|-----|--------------|
| `GetInsights` | `dataplane_adp_spending_get` (reuses the spending read permission) |

`InsightsService` owns no resource of its own. It aggregates from the spending rollup and returns headline metrics in a single call to avoid dashboard fan-out to many RPCs (`insights_service.proto:13-17`).

### `GetInsightsRequest` fields

`GetInsightsRequest` (`insights_service.proto:30`) requires a `filter` of type `redpanda.api.adp.v1alpha1.SpendingFilter` (reuses the stable spending filter: time window, tenant scope, AIP-160 filter expression).

### `Insights` fields

The `GetInsightsResponse` embeds an `Insights` message (`insights_service.proto:41`):

| Field | Type | Notes |
|-------|------|-------|
| `active_agents` | int64 | Distinct agents (by `agent_name`) with at least one request in the window; excludes direct user calls |
| `total_requests` | int64 | Total requests across the window, including direct user calls |
| `total_cost_microcents` | int64 | Total spend in microcents across the window |

For the `total_cost_microcents` unit: 1 cent = 1,000,000 microcents; $1.00 = 100,000,000 microcents. This matches the `_microcents` convention used throughout `SpendingService` and `BudgetService`.

## `AuditLogService` (Preview)

Source: `audit_log.proto`. Served in `apps/adp-api`. Preview surface (release notes v0.2.43): the read-only, tamper-evident record of who did what, to which resource, from where, and whether it was allowed and why, across the Agentic Data Plane (management API, LLM proxy, MCP gateway, A2A, spending).

The audit log is written by the OCSF audit interceptor to a Redpanda topic and served here from Redpanda SQL over the live Kafka tail UNION the committed Iceberg archive, so one query spans recent and archived events. Reading the audit log is itself an authorized action (`dataplane_adp_auditlog_list`) and, because this RPC runs through the same authorization and audit interceptors as every other adp-api call, is itself audited.

### RPCs

| RPC | Cedar permission |
|-----|------------------|
| `ListAuditLogEntries` | `dataplane_adp_auditlog_list` |
| `GetAuditLogEntry` | `dataplane_adp_auditlog_list` |
| `QueryAuditLog` | `dataplane_adp_auditlog_list` |

`ListAuditLogEntries` returns entries most-recent first with cursor pagination. `GetAuditLogEntry` returns one entry by opaque id, with every field populated (including the heavier request/response and entity-diff bodies the list may omit). `QueryAuditLog` is the AIP-136 custom method that answers a whole audit-log view — entries plus optional aggregates — in one request; see below.

All three share one permission and one Cedar action (`list` on the `AuditLog` singleton entity), so there is no way to grant "read one entry" without granting "list".

### Filtering: `AuditLogFilter`

Both read paths take the **same** `AuditLogFilter` message (`ListAuditLogEntriesRequest.filter`, `QueryAuditLogRequest.filter`), so a table, a timeline, and a facet rail cannot disagree about which calls they describe. All fields are optional and ANDed; empty means "any".

Pagination and projection stay on the request rather than the filter: `ListAuditLogEntriesRequest` carries `page_size` (0 → server default 50, max 200), `page_token` (an opaque cursor from a previous response), `read_mask`, and `order_by` beside its `filter`.

| Field | Type | Notes |
|-------|------|-------|
| `start_time`, `end_time` | timestamp | `start_time` inclusive, `end_time` exclusive |
| `outcomes` | repeated `AuditOutcome` | Set over **call**-level verdicts (see below). Rejects `UNSPECIFIED` and unknown values rather than silently widening to "any" |
| `correlation_id` | string | One API call's `correlation_id` (max 128 chars) — returns that call's member events **ungrouped**, denials first |
| `query` | string | Case-insensitive substring match over the human `message` (max 256 chars) |
| `terms` | repeated `AuditLogFilterTerm` | Per-event field predicates, max 20 terms, ANDed with each other and with everything above |

**Terms are the only way to filter on a field.** There are no longer typed `actor` / `subsystems` / `service` / `resource_type` / `resource_id` filter fields; every per-event predicate goes through `terms`, which is also what makes negation possible. Each `AuditLogFilterTerm` is:

| Field | Notes |
|-------|-------|
| `field` | REQUIRED. The `AuditLogEntry` field to filter on, **by its proto field name** — `actor`, `subsystem`, `service`, `operation`, `resource_type`, `resource_id`, `deciding_policy`, `resource_parent_id`, `operation_status`, `actor_type`, and so on. Not every field is filterable (a captured-body field is not); an unfilterable field is `INVALID_ARGUMENT`, never silently ignored |
| `values` | REQUIRED, 1–50 entries, ORed within the term (max 320 chars each). An empty list is `INVALID_ARGUMENT` |
| `negate` | Invert the match: the field is NONE of `values`. An event whose field the transport never observed is **kept**, so `negate` reads as "everything except these, including events that have no value here" |

Because an unfilterable or misspelled field is rejected rather than dropped, a filter either applies or errors — it never quietly returns more rows than you asked for. Discover the filterable set from the API (a facet request rejects exactly the fields a term rejects) rather than hardcoding a list.

`read_mask` (a `google.protobuf.FieldMask`, on every read path) selects which `AuditLogEntry` fields to populate, AIP-157 style. It is pushed down into the SQL projection, so a lean list view avoids reading the expensive body columns (`request_data`, `response_data`, `entity_before`, `entity_after`). `id` and `time` are always populated (they anchor the cursor), a path that is not an `AuditLogEntry` field is `INVALID_ARGUMENT`, and unset means all fields. The group aggregates — `outcome`, `operation_status`, `resource_count`, `denied_resource_count` — are returned even when the mask omits them.

### Ordering: `order_by`

`ListAuditLogEntriesRequest.order_by` (field 17) is an AIP-132 expression: one field, optionally suffixed with ` desc`, max 256 characters. Empty means the server default, `time desc`. (It replaced an earlier `order_ascending` bool.)

- **Orderable:** `time`, every single-valued `AuditLogEntry` filter field, and the two call verdicts — `outcome` (Allowed < Partial < Denied) and `operation_status` (unset < Succeeded < Failed).
- **Rejected with `INVALID_ARGUMENT`:** `deciding_policies` (a set per event, so no single value to sort by) and anything that is not an entry field.
- A member-level field (`resource_id`, `deciding_policy`, …) orders a grouped entry by its **smallest** member value — exact for the ordinary single-resource call.
- A non-time order puts entries with no value for the field last and breaks ties most-recent-first.

Two invariants worth planning around: the order applies to **entries**, never to the events *within* a call (a grouped entry's `resources` stay denials-first), and a non-time order cannot be combined with the `correlation_id` member view. The chosen order is encoded into the page token, so it must stay fixed across a pagination walk — a token minted under a different order is rejected.

### `QueryAuditLog`: entries, timeline, and facets in one call

`QueryAuditLog` exists because the three answers on an audit-log view must describe the same selected population of calls: issued as separate requests they can straddle a write and disagree, with no way for the reader to tell which view is stale. One `filter` applies to every section.

Every aggregate is **opt-in** — an absent section is not computed, so a request for entries alone runs no aggregate SQL at all:

| Request field | Effect |
|---|---|
| `entries` (`EntriesQuery`) | Return a page of entries. Carries `page_size` (0 → 50, max 200), `page_token`, `order_by`, `order_ascending`, and `read_mask`. Its `order_by` is narrower than the list RPC's: `time`, `resource_count` or `denied_resource_count`, each with an optional `asc` / `desc` suffix, defaulting to `time desc`; it is not supported alongside `filter.correlation_id`, whose member view is fixed denied-first. Tokens are interchangeable with `ListAuditLogEntries` tokens — both page the same keyset |
| `timeline` (`TimelineQuery`) | Return call volume over time, split by verdict. `interval` is optional: unset picks a width that puts the window in roughly 60 buckets, and a width finer than the server cap allows is **widened, never refused**. Always read the resolved width from `AuditLogTimeline.interval` — you cannot place the buckets without it. Set `filter.start_time` for a large window, or the scan is the whole archive |
| `facets` (repeated `FacetQuery`) | Return distinct values with call counts, one result per requested field, max 10 facets. Each carries `field` (the same filterable set as `AuditLogFilterTerm.field`; an unfacetable field is `INVALID_ARGUMENT`) and `limit` (0 → 50, max 500). Repeating a field in one request is `INVALID_ARGUMENT` |

Reading the response:

- `AuditLogTimeline.buckets` are oldest-first and **empty buckets are omitted**, not zero-filled — fill gaps yourself from `interval` if you need a continuous axis. Each `AuditLogTimeSeriesBucket` carries `start_time`, `call_count`, `allowed_call_count`, `denied_call_count`, and `partial_call_count`; those three verdict counts partition `call_count` exactly, which also means a masked call is counted as allowed (nothing in it was denied).
- `AuditLogFacet` echoes its `field` so you can pair results without relying on order, lists `values` by descending `call_count`, and sets `truncated` when more distinct values exist than the limit returned. There is no facet page token: a facet is a top-N, and walking its tail is a table query instead.
- Each `AuditLogFieldValue` carries `value`, `call_count`, and `denied_call_count`. For a field that can differ between the resources one call decided on, a call is counted **once if any** of its resources carried the value — which is exactly what filtering the entries by that value returns, and why facet counts can sum to more than the total number of calls.

### `AuditOutcome` and `AuditOperationStatus`

The call verdict (`AuditLogEntry.outcome`) is one of:

- `AUDIT_OUTCOME_ALLOWED` — every resource the call decided on was allowed.
- `AUDIT_OUTCOME_DENIED` — nothing was delivered: refused by authorization, **or** authorized and then withheld by a guardrail (OCSF `disposition_id` BLOCKED). Either way the deciding policy says which check refused it.
- `AUDIT_OUTCOME_PARTIAL` — a collection-filtered call that allowed some resources and denied others. Only ever a **call**-level verdict, never a per-resource one.
- `AUDIT_OUTCOME_MASKED` — allowed and delivered, but a guardrail masked content inside it (OCSF `disposition_id` CORRECTED).

`DENIED` therefore means WHOLLY denied — and it now covers a guardrail block as well as an authorization refusal, so "denied" is not synonymous with "no permission". Anything with a denial in it is `DENIED` or `PARTIAL`, so a reader looking for refusals wants both; `AuditLogEntry.denied_resource_count` carries the exact split. When a call's members disagree the verdict resolves in one precedence — **denied, then partial, then masked, then allowed** — so a denial always outranks a mask and a masked-and-denied call never reads as merely `MASKED`.

`MASKED` and `PARTIAL` are derived at read time rather than stored (no OCSF `action_id` spells either one), which is why neither is a per-resource verdict: an `AuditLogEntryResource` is `ALLOWED` or `DENIED`, nothing in between.

Read `operation_status` (`AUDIT_OPERATION_STATUS_SUCCEEDED` / `FAILED`) for whether the operation succeeded overall: it folds both the authorization verdict and any transport-observed failure. Do not derive success from `response_code` — that field carries transport-native codes (Connect codes on the management API, HTTP status on the gateways) and is unset when the transport observed no failure.

### Grouped calls and per-resource decisions

One `AuditLogEntry` describes one API **call**, not one emitted event. A collection-filtered call — a `List*` filtered by a Cedar policy that permits some resources and denies others — emits one audit event per candidate resource, and the read side groups those back together by `correlation_id`. The grouped entry then describes the call as a whole, and:

- `resource_count` — how many resources the call decided on (always populated).
- `denied_resource_count` — how many of them were denied (always populated). Zero = wholly allowed; equal to `resource_count` = wholly denied; anything between = partly allowed.
- `outcome` and `operation_status` — the aggregate verdicts computed over the whole group, exact even if the members list is truncated.
- `resources` — the per-resource decisions (each with its own `resource_type`, `resource_id`, per-item `outcome`, and `deciding_policy`), populated only when the `read_mask` requests it and never populated for a single-resource call. `GetAuditLogEntry` reads one member event of a call, not the call, so it never populates `resources` even if the mask names it — page a call's members via the `correlation_id` filter instead.
- `resources_truncated` — true when the returned members list is shorter than `resource_count` because one page cannot carry every member; the aggregates stay exact.

A collection-filtered call with 40 policies and 1 refusal reads as one `PARTIAL` row with `resource_count = 40`, `denied_resource_count = 1`. Refusals are always reachable, whatever the page size.

### Attributed policies and guardrail findings

`deciding_policy` is a single name, and OCSF does not order the attributions deterministically — so two identical calls could read as decided by different policies. Read the plural fields instead when attribution matters:

- `deciding_policies` (repeated string) — **every** policy the decision was attributed to, names only.
- `policies` (repeated `AuditLogEntryPolicy`) — the same attributions with their detail: `uid`, `name`, `applied` (bool), `decision`, and `findings`. Do not read anything into the order: the underlying OCSF array is not deterministically ordered, which is exactly why the plural fields exist.
- `policy_uid` — the uid of the scalar `deciding_policy`, whose stable name that field carries.

Both plural fields are capped at the first 8 attributions; a decision attributed to more policies is truncated there rather than reported, so do not treat either as necessarily complete.

`AuditPolicyDecision` covers both enforcement mechanisms in one enum: `PERMIT` / `DENY` are Cedar's verdict on the call for a policy or role binding, while `BLOCK` (a guardrail withheld the call) and `MASK` (a guardrail masked content and let the call through) are what a guardrail did. A guardrail attribution has a uid of the form `guardrails/<name>`, and when a guardrail is what decided the call it is the attribution the scalar `deciding_policy` names — so a blocked call reads as "denied by the guardrail", not "denied by the Cedar policy that permitted it".

`AuditLogGuardrailFinding` (on `AuditLogEntryPolicy.findings`, empty for a policy or role binding) is one thing a guardrail detected:

| Field | Notes |
|-------|-------|
| `family` | Policy family the finding came from, e.g. `pii_filter_policy` |
| `category` | Entity or category within the family: a PII entity (`EMAIL`), a content category (`HATE`), a topic name, a matched word list |
| `action` | `AUDIT_GUARDRAIL_FINDING_ACTION_NONE` (detected only), `BLOCK`, or `MASK` |
| `score` | `optional double` in [0, 1] where the engine reports one — absent means the engine reports no numeric confidence, not zero confidence |
| `engine` | `bedrock`, `local_rule`, or `local_model` |
| `shadow` | Recorded but never enforced |
| `confidence` | Bedrock's coarse confidence (`HIGH` / `MEDIUM` / `LOW`) where that is all it reports; empty otherwise |

A finding with `action = NONE` means the guardrail **flagged** content without acting on it — it is not "found nothing".

### Resource, actor, and capture detail fields

Beyond the scalar `resource_type` / `resource_id`, an entry carries:

| Field | Notes |
|-------|-------|
| `resource_parent_type`, `resource_parent_id` | The owner of the decided resource when that resource is a **child** entity — the MCP server behind a tool call, the agent behind a credential. Cedar authorizes `tools/call` against the *tool*, so this is the only way to ask "what touched this MCP server?". Empty for a top-level resource, which is the normal case |
| `resource_name` | The decided resource's human name, where `resource_id` is its id. Empty when the resource has no name distinct from its id |
| `actor_type` | The acting identity's kind: `Agent` when `agent_name` / `agent_uid` are set (an agent-bound service account, regardless of its own account type), else `ServiceAccount` or `User`. Computed at emission, so a filter and the displayed value can never disagree. **Empty means unknown** — events emitted before the field existed, and configuration changes, carry no account type; never read empty as `User` |
| `status_detail` | Why the operation reached its status, when the emitter had more to say than the status itself. Usually empty |
| `request_flags` | Capture markers on `request_data`: `redacted` when a field was masked, `truncated` when the body exceeded the capture cap. Read these before treating a captured body as complete |
| `response_data` | Empty on every event today — no surface is configured at response-capture level — but retained on the published read-mask contract. Do not read an empty value as a query bug |

`subsystem` is the coarse product surface that handled the call, declared per service in the API rather than by the binary, so the value travels with the API. **Treat the value set as open, not closed:** `management` still appears as a transport-shaped fallback for older events, the archive keeps emitting historical values forever, and new surfaces add new values. Read the live set as a facet (`QueryAuditLog` with a `subsystem` facet) instead of hardcoding a list.

### Delegation (on-behalf-of) fields

On a direct human call, `actor` (the effective end-user's email, never redacted) tells the whole story and `invoked_by` / `agent_name` / `agent_uid` are empty. On an on-behalf-of call — an agent's service account calling on behalf of a user — `actor` is the human, and:

- `invoked_by` — the authenticated caller (typically a service-account email) when it differs from the effective user.
- `agent_name`, `agent_uid` — the bound agent (OCSF `actor.app_name` / `app_uid`) when the caller is an agent's service account.

Read all four to reconstruct "who acted on behalf of whom".

### Event classes and change diffs

- `AUDIT_EVENT_CLASS_API_ACTIVITY` (OCSF 6003) — an API call / access decision. This is the majority.
- `AUDIT_EVENT_CLASS_ENTITY_MANAGEMENT` (OCSF 3004) — a managed-resource configuration change; carries redacted `entity_before` / `entity_after` JSON so a reader can diff them.

`activity` is the CRUD-style label (`Create` / `Read` / `Update` / `Delete` / `Other`); `subsystem` is the coarse component that handled the call; `service` and `operation` name the specific surface and method.

## Accountability: transcripts vs. the audit log

Use the right surface for the question:

- **`TranscriptsService`** — execution-level observability of an agent conversation: turns, tool calls, model choices, per-conversation cost, and reconstructed spans. Grouped by OTel `gen_ai.conversation.id`.
- **`AuditLogService`** — authorization-decision-level accountability: who invoked what, whether it was allowed, which policy decided, and what fields changed on a resource update. Grouped by the server-minted `correlation_id`.

The adp-docs observability concepts page (`adp-docs/modules/monitor/pages/concepts.adoc:323-334`) frames the execution side explicitly:

> "Transcripts provide: a complete, immutable record of every execution step, stored on Redpanda's distributed log with no gaps; hierarchical view of request flow through your system (parent-child span relationships); detailed timing information for performance analysis; ability to reconstruct execution paths and identify bottlenecks. Transcripts are optimized for execution-level observability and governance."

The transcripts document what an agent did in a conversation. The audit log documents what any principal (a user, a service account, an agent) was allowed or refused to do against the platform's APIs.

Note: an `AuditService` (OCSF-shaped) also exists in the legacy generated-only tree at `cloudv2/proto/gen/go/redpanda/api/aigateway/v1/audit.pb.go`. That tree has no public source protos and is used by the separate `rpk cloud mcp` control-plane path (`aigateway/v1`), not by the Agentic Data Plane API surface documented here.

## Service status summary

| Service | Package | Served in | API version | Maturity |
|---------|---------|-----------|--------|--------|
| `TranscriptsService` | `redpanda.api.adp.v1alpha1` | `apps/adp-api` | `v1alpha1` | non-experimental |
| `AuditLogService` | `redpanda.api.adp.v1alpha1` | `apps/adp-api` | `v1alpha1` | Preview |
| `InsightsService` | `redpanda.api.adp.experimental.v1alpha1` | `apps/aigw` | `v1alpha1` (experimental path) | Experimental |
