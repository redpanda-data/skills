Source: `cloudv2/proto/public/cloud/redpanda/api/adp/v1alpha1/transcript.proto` (TranscriptsService lines 21-42, TranscriptSummary lines 172-207, TranscriptTurn lines 135-167, TranscriptToolCall lines 113-132, ListTranscriptsRequest/Filter lines 216-264, GetTranscriptResponse lines 288-298). Service registration confirmed at `cloudv2/apps/adp-api/internal/server/server.go:344-348`. Experimental service: `cloudv2/proto/public/cloud/redpanda/api/adp/experimental/v1alpha1/insights_service.proto` (InsightsService lines 13-27, Insights message lines 41-49). InsightsService registration confirmed at `cloudv2/apps/aigw/internal/server/server.go:1225-1229`. Audit log service: `cloudv2/proto/public/cloud/redpanda/api/adp/v1alpha1/audit_log.proto` (AuditLogService RPCs, AuditLogEntry fields, AuditOutcome/AuditOperationStatus/AuditEventClass enums, ListAuditLogEntriesRequest filters); AuditLogService registration confirmed at `cloudv2/apps/adp-api/internal/server/server.go`. Accountability framing from `adp-docs/modules/monitor/pages/concepts.adoc:323-334`. Evidence date: 2026-08-24.

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
| `query` | string | Free-text search across titles and content |
| `has_errors` | optional bool | Narrow to errored or error-free conversations |
| `page_size` | int32 | Default 50, max 100; set to -1 to disable pagination |

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

`ListAuditLogEntries` returns entries most-recent first with cursor pagination. `GetAuditLogEntry` returns one entry by opaque id, with every field populated (including the heavier request/response and entity-diff bodies the list may omit).

### `ListAuditLogEntriesRequest` filter fields

All filters are optional and ANDed; empty means "any".

| Field | Type | Notes |
|-------|------|-------|
| `page_size` | int32 | 0 → server default (50); max 200 |
| `page_token` | string | Opaque cursor from a previous response |
| `start_time`, `end_time` | timestamp | Half-open window (`end_time` is exclusive) |
| `actor` | string | Exact caller email |
| `outcomes` | repeated `AuditOutcome` | Set filter over call verdicts (see below); rejects `UNSPECIFIED` and unknowns rather than silently widening |
| `subsystems` | repeated string | Set over coarse components (`management`, `llm-proxy`, `mcp-gateway`, `a2a-proxy`, `spending`) |
| `service` | string | Specific service/surface, e.g. `LLMProviderService`, `MCPGateway`, `LLMProxy` |
| `resource_type`, `resource_id` | string | Namespaced OCSF type matched case-insensitively; id matched exactly. Matched against the entry's scalar entity projection |
| `correlation_id` | string | One API call's `correlation_id` — returns that call's member events ungrouped, denials first |
| `query` | string | Case-insensitive substring match over the human message |
| `read_mask` | `google.protobuf.FieldMask` | Which `AuditLogEntry` fields to populate (AIP-157). `id` and `time` are always populated. Unset = all fields |

The `read_mask` is pushed down into the SQL projection, so a lean list view avoids reading the expensive body columns. Confirm the exact set of `AuditLogEntry` fields live via the proto or the API — the list evolves.

### `AuditOutcome` and `AuditOperationStatus`

The call verdict (`AuditLogEntry.outcome`) is one of:

- `AUDIT_OUTCOME_ALLOWED` — every resource the call decided on was allowed.
- `AUDIT_OUTCOME_DENIED` — every resource was refused (wholly denied).
- `AUDIT_OUTCOME_PARTIAL` — a collection-filtered call that allowed some resources and denied others. Only ever a **call**-level verdict, never a per-resource one.

`DENIED` therefore means WHOLLY denied. Anything with a denial in it is `DENIED` or `PARTIAL`, so a reader looking for refusals wants both. `AuditLogEntry.denied_resource_count` carries the exact split.

Read `operation_status` (`AUDIT_OPERATION_STATUS_SUCCEEDED` / `FAILED`) for whether the operation succeeded overall: it folds both the authorization verdict and any transport-observed failure. Do not derive success from `response_code` — that field carries transport-native codes (Connect codes on the management API, HTTP status on the gateways) and is unset when the transport observed no failure.

### Grouped calls and per-resource decisions

One `AuditLogEntry` describes one API **call**, not one emitted event. A collection-filtered call — a `List*` filtered by a Cedar policy that permits some resources and denies others — emits one audit event per candidate resource, and the read side groups those back together by `correlation_id`. The grouped entry then describes the call as a whole, and:

- `resource_count` — how many resources the call decided on (always populated).
- `denied_resource_count` — how many of them were denied (always populated). Zero = wholly allowed; equal to `resource_count` = wholly denied; anything between = partly allowed.
- `outcome` and `operation_status` — the aggregate verdicts computed over the whole group, exact even if the members list is truncated.
- `resources` — the per-resource decisions (each with its own `resource_type`, `resource_id`, per-item `outcome`, and `deciding_policy`), populated only when the `read_mask` requests it and never populated for a single-resource call. `GetAuditLogEntry` reads one member event of a call, not the call, so it never populates `resources` even if the mask names it — page a call's members via the `correlation_id` filter instead.
- `resources_truncated` — true when the returned members list is shorter than `resource_count` because one page cannot carry every member; the aggregates stay exact.

A collection-filtered call with 40 policies and 1 refusal reads as one `PARTIAL` row with `resource_count = 40`, `denied_resource_count = 1`. Refusals are always reachable, whatever the page size.

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
