Source: `cloudv2/proto/public/cloud/redpanda/api/adp/v1alpha1/transcript.proto` (TranscriptsService lines 21-42, TranscriptSummary lines 172-207, TranscriptTurn lines 135-167, TranscriptToolCall lines 113-132, ListTranscriptsRequest/Filter lines 216-264, GetTranscriptResponse lines 288-298). Service registration confirmed at `cloudv2/apps/adp-api/internal/server/server.go:344-348`. Experimental service: `cloudv2/proto/public/cloud/redpanda/api/adp/experimental/v1alpha1/insights_service.proto` (InsightsService lines 13-27, Insights message lines 41-49). InsightsService registration confirmed at `cloudv2/apps/aigw/internal/server/server.go:1225-1229`. Accountability framing from `adp-docs/modules/monitor/pages/concepts.adoc:323-334`. Evidence date: 2026-06-29.

# ADP Observability Reference

**Maturity:** ADP is generally available. `TranscriptsService` is on the `v1alpha1` version path and is non-experimental (package path `redpanda.api.adp.v1alpha1`; the proto carries no `LaunchStage` annotation, so treat field-level details as still evolving and confirm them live). `InsightsService` is Experimental (package path `redpanda.api.adp.experimental.v1alpha1`; the proto header explicitly warns it may change shape without a version bump or be removed entirely). Do not depend on `InsightsService` from stable clients.

Audience: an AI agent using ADP observability via the ADP API and `rpk ai`. Optimize for correct programmatic use.

Related references: [SKILL.md](../SKILL.md), [agents.md](agents.md), [mcp-servers.md](mcp-servers.md), [gateway-and-providers.md](gateway-and-providers.md), [governance.md](governance.md), [rpk-ai.md](rpk-ai.md).

## Discover the live surface

Before acting, confirm available operations and current state:

```bash
# See all rpk ai transcript subcommands and flags
rpk ai transcript --help

# List recent transcripts for a specific agent
rpk ai transcript list --agent-id <agent-id>
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

Source: `experimental/v1alpha1/insights_service.proto:13`. Served: `aigw server.go:1225-1229`. **Experimental** -- the proto header (`insights_service.proto:3-6`) explicitly states this package is provisional, backs in-flight surfaces (the ADP home dashboard), may change shape without a version bump, and may be removed entirely.

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

## Accountability: no OCSF AuditService

There is no `AuditService` in the ADP public API. A search of the full ADP proto tree (`cloudv2/proto/public/cloud/redpanda/api/adp/`) returns zero matches for `AuditService`, `ocsf`, or `OCSF`. There is no `audit.proto` in either `v1alpha1/` or `experimental/v1alpha1/`.

The documented "who did what" mechanism for ADP is `TranscriptsService`. The adp-docs observability concepts page (`adp-docs/modules/monitor/pages/concepts.adoc:323-334`) frames this explicitly:

> "Transcripts provide: a complete, immutable record of every execution step, stored on Redpanda's distributed log with no gaps; hierarchical view of request flow through your system (parent-child span relationships); detailed timing information for performance analysis; ability to reconstruct execution paths and identify bottlenecks. Transcripts are optimized for execution-level observability and governance. For user-level accountability tracking ('who initiated what'), use the session and task topics for agents, which provide records of agent conversations and task execution."

For request/response accountability, use `TranscriptsService`. There is no separate audit API to call.

Note: an `AuditService` (OCSF-shaped) does exist in the legacy generated-only tree at `cloudv2/proto/gen/go/redpanda/api/aigateway/v1/audit.pb.go`. That tree has no public source protos and is used by the separate `rpk cloud mcp` control-plane path (`aigateway/v1`), not by the current ADP API surface.

## Service status summary

| Service | Package | Served in | API version | Maturity |
|---------|---------|-----------|--------|--------|
| `TranscriptsService` | `redpanda.api.adp.v1alpha1` | `apps/adp-api` | `v1alpha1` | non-experimental |
| `InsightsService` | `redpanda.api.adp.experimental.v1alpha1` | `apps/aigw` | `v1alpha1` (experimental path) | Experimental |
