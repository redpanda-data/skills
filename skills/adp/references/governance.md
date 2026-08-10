Source: `cloudv2/proto/public/cloud/redpanda/api/adp/v1alpha1/budget.proto` (BudgetService, BudgetCreate, Budget fields), `spending_service.proto` (SpendingService, SpendingFilter, SpendingStats), `guardrail.proto` (GuardrailService, BedrockGuardrailConfig, ContentFilterPolicy, LocalGuardrailConfig, GuardrailProvider), `policy_service.proto` (PolicyService lines 25-62, PolicyTemplateService lines 66-104), `system_policy_service.proto` (SystemPolicyService), `effective_policy_set_service.proto` (EffectivePolicySetService), `cedar_options.proto`, `oauth_client.proto` (OAuthClientService), `oauth_provider.proto` (OAuthProviderService), `oauth_connection.proto` (OAuthConnectionService), `pending_auth_request.proto` (PendingAuthRequestService), `token_vault_admin.proto` (TokenVaultAdminService). Service registrations confirmed at `cloudv2/apps/aigw/internal/server/server.go` and `cloudv2/apps/adp-api/internal/server/server.go`. `SpendingService` cost-allocation tag surface (`GetSpendingTagKeys`, `BREAKDOWN_DIMENSION_TAG`, `tag_key`) re-verified against `spending_service.proto` on 2026-07-13. `GuardrailProvider` / `Guardrail.config` oneof re-verified against `guardrail.proto` on 2026-07-20. The MCP data-policy surface (`data_policy.proto` `DataShaping`/`DataPolicy`; the `PreviewDataPolicies` and `PreviewToolResponse` RPCs on `MCPServerService` in `mcp_server.proto`) verified on 2026-07-27. The CIMD inbound-registration surface (`GetCIMDSettings`/`UpdateCIMDSettings` RPCs on `OAuthClientService`, the `CIMDSettings` message, and the `CIMDTrustPolicy` enum in `oauth_client.proto`) verified on 2026-08-10. Evidence date: 2026-08-10.

# Agentic Data Plane Governance Reference

**Maturity:** Redpanda Agentic Data Plane is generally available. The services in this file are on the `v1alpha1` version path and carry no `LaunchStage` annotation in the protos, so treat field-level details as still evolving and confirm them live via `--help` and live introspection.

Audience: an AI agent operating Agentic Data Plane governance (budgets, spending analysis, guardrails, access control, OAuth/identity) via the Agentic Data Plane API and `rpk ai`. Optimize for correct programmatic use.

Related references: [SKILL.md](../SKILL.md), [agents.md](agents.md), [mcp-servers.md](mcp-servers.md), [gateway-and-providers.md](gateway-and-providers.md), [rpk-ai.md](rpk-ai.md), [observability.md](observability.md).

## Discover the live surface

Before acting, confirm available operations and current state:

```bash
# Access-control policies (Cedar) are exposed on the CLI:
rpk ai policy --help
rpk ai policy list
```

There is **no** `rpk ai budget`, `rpk ai spending`, or `rpk ai guardrail` subcommand:
budgets, spending analysis, and guardrails are API-only surfaces
(`BudgetService`, `SpendingService`, `GuardrailService`). Reach them via the
Agentic Data Plane API directly or via the MCP tools exposed on the cluster.

The sections below document the proto-verified surface. For exact field lists and current limits, confirm live via `--help` and by calling the relevant list or describe operations.

## Cost unit: microcents

All cost fields throughout the governance API use **microcents** (not cents, not dollars).

```
1 cent = 1,000,000 microcents
$1.00  = 100,000,000 microcents
```

Field names use the `_microcents` suffix consistently: `limit_microcents`, `warn_at_microcents`, `total_cost_microcents`. Never use `limit_cents` or `current_spend_cents`; those fields do not exist.

## `BudgetService` RPCs

Source: `budget.proto:14`. Served: `aigw server.go:1253`.

| RPC | Purpose |
|-----|---------|
| `CreateBudget` | Create a spend cap (per-agent or tenant-wide) |
| `GetBudget` | Fetch a single budget by name |
| `ListBudgets` | List all budgets |
| `UpdateBudget` | Update mutable fields |
| `DeleteBudget` | Remove a budget |

### Key `BudgetCreate` / `Budget` fields

| Field | Notes |
|-------|-------|
| `name` | REQUIRED, immutable after create; resource identity (`budget.proto:155`) |
| `display_name` | Optional human-readable label (`budget.proto:167`) |
| `filter_agent_name` | Optional; `NULL` = tenant default, set = per-agent override (`budget.proto:182`) |
| `pooling_mode` | `PER_AGENT` (1) or `SHARED` (2) (`budget.proto:195`) |
| `period` | `DAILY` (1), `WEEKLY` (2), or `MONTHLY` (3) (`budget.proto:205`) |
| `limit_microcents` | int64, > 0; hard cap on per-period spend in USD microcents (`budget.proto:211`) |
| `warn_at_microcents` | int64, > 0; threshold for warning notifications (`budget.proto:216`) |
| `notification_user_ids` | Repeated string; max 50 entries, each length 20 (`budget.proto:334`) |

Output-only fields: `current_spend_microcents`, `period_starts_at`, `period_resets_at`, `top_agent_name`, `uid`, `effective_from`.

## `SpendingService` RPCs

Source: `spending_service.proto:8`. Served: `aigw server.go:1217`.

| RPC | Purpose |
|-----|---------|
| `GetSpendingSummary` | Aggregate spend totals over a time window |
| `GetSpendingTimeSeries` | Spend over time at hourly or daily granularity |
| `GetSpendingBreakdown` | Spend broken down by a single dimension |
| `GetSpendingTimeSeriesByDimension` | Time series segmented by a dimension |
| `GetSpendingTagKeys` | List the distinct cost-allocation tag keys observed on spend within a window (the source for a "group by tag" picker) |

### `SpendingFilter` fields

`start_time` and `end_time` (timestamps) are REQUIRED. Optional singular equality filters: `provider_name`, `model_id`, `user_email`, `organization_id`, `agent_name`, `agent_uid` (`agent_uid` is only valid alongside `agent_name`; setting it alone is rejected). An AIP-160 `filter` expression is available for multi-value or compound conditions over the rollup columns (provider, model, user, `agent_name`, `agent_uid`, organization, hour, and the cost/token/request counters) — including cost-allocation tag traversal, e.g. `tags.department = "sales"`. For time series, `granularity` is `HOURLY` (1) or `DAILY` (2). For breakdowns, `dimension` is `PROVIDER` (1), `MODEL` (2), `USER` (3), `PROVIDER_TYPE` (4), `AGENT` (5), or `TAG` (6).

### Cost-allocation tags

`GetSpendingBreakdown` and `GetSpendingTimeSeriesByDimension` accept `BREAKDOWN_DIMENSION_TAG` (6) to group spend by the value of one cost-allocation tag key. When you use it, set the request's `tag_key` (e.g. `department`); the server rejects a `TAG` breakdown with an empty `tag_key`. Spend with no value for that key collapses into a single entry whose key is the **empty string** (clients render it as "Untagged") — never the literal string `untagged`, so a genuine tag value of `untagged` can never merge into the synthetic bucket. The tags come from the agent's `Agent.tags` map (see [agents.md](agents.md)), which the gateway stamps onto every LLM call the agent makes; attribution is point-in-time — spend already recorded keeps the tags it was recorded with. `GetSpendingTagKeys` takes a required `start_time`/`end_time` window and returns the distinct tag keys observed on spend in that range (sorted ascending, empty when no tagged spend exists); keys that exist only on agents that never spent are excluded.

### `SpendingStats` fields

`total_cost_microcents` (int64) is the primary aggregate. Token usage is broken down by `UsageType` sub-buckets: `input`, `output`, `cached`, `cache_creation_5m`, `cache_creation_1h`, `cache_creation_unknown_ttl`, `reasoning`, `tool_use_input`. Each bucket carries token counts and `cost_microcents`. `total_requests` and `failed_requests` are also available.

## `GuardrailService` RPCs

Source: `guardrail.proto:25`. Served: `aigw server.go:1200`.

| RPC | Purpose |
|-----|---------|
| `CreateGuardrail` | Create a guardrail resource |
| `GetGuardrail` | Fetch a single guardrail by name |
| `ListGuardrails` | List all guardrails |
| `UpdateGuardrail` | Update mutable fields |
| `DeleteGuardrail` | Remove a guardrail |

### Guardrail envelope fields

| Field | Notes |
|-------|-------|
| `name`, `display_name`, `description` | Standard resource identity and labelling |
| `blocked_input_message` | REQUIRED; message returned when input is blocked; 1-500 chars (`guardrail.proto:158`) |
| `blocked_output_message` | REQUIRED; message returned when output is blocked; 1-500 chars (`guardrail.proto:168`) |
| `enabled` | bool; master on/off switch (`guardrail.proto:173`) |
| `config` | oneof (REQUIRED). Two variants: `bedrock_config BedrockGuardrailConfig` (field 10) and `local_config LocalGuardrailConfig` (field 23). `bedrock_config` is the generally-available variant; `local_config` is an emerging, dataplane-evaluated variant that is not yet GA — see Provider below (`guardrail.proto:237-253`) |

### Provider

`GuardrailProvider` defines two values (`guardrail.proto:96-104`), each mapping 1:1 to a `config` oneof variant:

- `GUARDRAIL_PROVIDER_BEDROCK = 1` — AWS Bedrock Guardrails (`bedrock_config`). This is the **generally-available** provider; author guardrails against it unless you have confirmed otherwise.
- `GUARDRAIL_PROVIDER_LOCAL = 2` — dataplane-evaluated local guardrails with per-family engine routing (`local_config`): each policy family runs either locally in the gateway (`ENGINE_LOCAL`) or delegates to a companion Bedrock guardrail (`ENGINE_BEDROCK`). This is **not yet generally available** — per-family local engines are gated per deployment (admission rejects `ENGINE_LOCAL` for a family whose local evaluator is not wired on that deployment), and it is not covered by the ADP release notes as of this writing. Confirm availability live via `rpk ai guardrail --help` and the API before relying on it, and treat its nested shape as still evolving — read `LocalGuardrailConfig` in `guardrail.proto` for current field detail rather than assuming the family set here.

### `BedrockGuardrailConfig` sub-policies

All sub-policies are optional fields on `BedrockGuardrailConfig`:

| Sub-policy field | Type | Description |
|-----------------|------|-------------|
| `content_filter_policy` | `ContentFilterPolicy` | 6 content categories; see below |
| `word_filter_policy` | `WordFilterPolicy` | Custom and managed word lists |
| `denied_topics_policy` | `DeniedTopicsPolicy` | Semantic topic classifier |
| `pii_filter_policy` | `PIIFilterPolicy` | 31 built-in entity types plus custom regex |
| `grounding_policy` | `GroundingPolicy` | Grounding and relevance filters |
| `automated_reasoning_policy` | `AutomatedReasoningPolicy` | Detect-only; never blocks; attaches 1-2 versioned Bedrock AR policy ARNs |

### Content filter categories

The `ContentFilterPolicy` has exactly **6 categories** (not 14): `hate`, `insults`, `sexual`, `violence`, `misconduct`, `prompt_attack` (`guardrail.proto:588-641`). These map to Bedrock's native content policy config. `prompt_attack` was moved from a standalone top-level field into `content_filter_policy` (`guardrail.proto:1157-1161`).

Each category is a `ContentFilterRule` with a `DirectionConfig` carrying `strength` (`NONE`/`LOW`/`MEDIUM`/`HIGH`), `action` (`NONE`/`BLOCK`), and `modalities` (`TEXT`/`IMAGE`).

**Note:** A 14-category taxonomy (violent_crimes, non_violent_crimes, child_sexual_exploitation, etc.) appears only in the RFC draft at `apps/aigw/docs/rfcs/0011-guardrails/guardrails.proto`. That is a design document, not a shipped API. Do not use those category names.

## Access control (RBAC) services

The access-control surface is four read/write services, all using **Cedar** as the policy dialect.

### `PolicyService` RPCs

Source: `policy_service.proto:25`. Served: `adp-api server.go:360`.

| RPC | Purpose |
|-----|---------|
| `CreatePolicy` | Create a Cedar policy |
| `GetPolicy` | Fetch a policy by name |
| `ListPolicies` | List all policies |
| `UpdatePolicy` | Update mutable fields (Cedar text or template link) |
| `DeletePolicy` | Remove a policy |

### `PolicyTemplateService` RPCs

Source: `policy_service.proto:66`. Served: `adp-api server.go:366`.

| RPC | Purpose |
|-----|---------|
| `CreatePolicyTemplate` | Create a Cedar policy template |
| `GetPolicyTemplate` | Fetch a template by name |
| `ListPolicyTemplates` | List all templates |
| `UpdatePolicyTemplate` | Update a template |
| `DeletePolicyTemplate` | Remove a template |

### Key `Policy` fields

| Field | Notes |
|-------|-------|
| `name` | AIP-122 resource name `policies/{policy}` (`policy_service.proto:150`) |
| `cedar_text` | Inline Cedar policy body (`policy_service.proto:175`) |
| `template_link` | `TemplateLink`; alternative to inline `cedar_text` (`policy_service.proto:178`) |
| `scope` | OUTPUT_ONLY; derived at write time (`policy_service.proto:186`) |
| `version` | OUTPUT_ONLY; monotonic int64 counter; used to derive `etag` (`policy_service.proto:211`) |
| `etag` | OUTPUT_ONLY; optimistic concurrency token (`policy_service.proto:202`) |

Cedar syntax is validated at write time; `scope` is recomputed on every write. `PolicyTemplate` uses `cedar_text` with `?principal`/`?resource` slots.

There is no `ValidatePolicy`, `EvaluateAccess`, `GetPolicyEntities`, or `ListPolicyVersions` RPC. The `version` field is an internal monotonic counter, not a user-facing version history.

### `SystemPolicyService` RPCs

Source: `system_policy_service.proto:29`. Served: `adp-api server.go:390`. Read-only; policies are derived from controlplane RBAC role bindings by the policy-materializer.

| RPC | Purpose |
|-----|---------|
| `ListSystemPolicies` | List RBAC-derived system policies |
| `ListActionGroups` | List available action groups |

### `EffectivePolicySetService` RPCs

Source: `effective_policy_set_service.proto:20`. Served: `adp-api server.go:407`. Read-only; delivers the compiled set the dataplane evaluates.

| RPC | Purpose |
|-----|---------|
| `ListEffectivePolicySets` | List effective policy sets |
| `GetEffectivePolicySet` | Fetch the current effective set |

The singleton resource name is `effectivePolicySets/default`. The `cedar_text` field (OUTPUT_ONLY) is the evaluable Cedar text the dataplane runs. The `etag` changes whenever the compiled set changes.

## Data policies (MCP data shaping)

**Preview.** Data policies are a preview capability — confirm current availability in the ADP release notes and live via the API before relying on them. They are configured on an MCP server resource, not through a standalone service; the field and the preview RPCs live in [mcp-servers.md](mcp-servers.md). This section documents what they express and how they compose.

A **data policy** shapes the data an MCP server exposes: it transforms tool-call arguments on the way upstream and tool responses on the way back to the model. It is a distinct control from Cedar authorization: a Cedar policy (see Access control above) decides **whether** a tool call runs; a server's data policies decide **how** the call's data is shaped and **to whom**. Data policies are embedded on the MCP server (`MCPServer.data_policies`); there is no org-scoped or standalone data-policy resource.

### Binding

Each `DataPolicy` binds one reusable transform bundle (`DataShaping`) to:

- `tools` — the tools on this server the policy shapes; empty means every tool.
- `principals` — who the policy applies to, in the same `<Type>:<id>` vocabulary Cedar targets (for example `User:alice`, `Group:support`); empty means every principal.
- `shaping` — the `DataShaping` bundle (REQUIRED).

A server can carry several data policies. They compose as a **most-restrictive meet**: adding a policy can only ever narrow what a caller sees, never widen it.

### What a `DataShaping` bundle can do

A bundle has an optional request side (arguments sent upstream) and an optional response side (results returned to the model).

**Field actions** (both request and response). A list of rules, each a JSONPath-style `selector` plus one treatment:

- `keep` — mark a field as surviving allowlist mode.
- `drop` — remove the field entirely.
- `mask` — replace the value while preserving the field's presence, via one method: `redact` (fixed placeholder), `partial` (keep the first/last N characters), `hash` (salted digest, so equal inputs stay correlatable without exposing the plaintext), or `pattern` (RE2 substitution).

`default_drop` on a field-action set switches it between denylist mode (unmatched fields pass through; the default) and allowlist mode (only explicitly kept fields survive). A selector marked `absence_safe = false` that matches nothing is an enforcement error and the call **fails closed** — protection against a renamed field silently leaking.

**Request clamps** (request side). Tighten the allowed *values* of a single tool-call argument addressed by path: numeric bounds, string length, item counts, an RE2 pattern, a string format, or an allowed-value enum. The gateway both validates the argument on each call and deep-merges the tightened contract into the tool's advertised input schema on `tools/list`, so the model sees the clamped shape up front. Clamps compose as conjunction — adding one can only tighten.

**Response row filters** (response side). Drop whole records from a list-shaped response: name the record array by path, and give a per-record predicate a record must satisfy to survive (for example `@.priority >= 8`). A record missing the compared field never survives (fail-closed). Predicates on the same path conjoin across filters and policies.

The exact JSONPath grammar subset, clamp keyword set, and per-treatment options are still evolving; read the current `DataShaping` field detail live rather than assuming this list is complete.

### Previewing a policy

Two RPCs on `MCPServerService` dry-run a policy before you save it. Each accepts a `draft_data_policies` overlay so an editor can preview unsaved edits without persisting anything:

- `PreviewDataPolicies` — for a `(server, tool, principal)`, returns the allow/deny effect plus the explained composition: per-field winners with their ordered contributions, composed clamps and row filters, and diagnostics (for example an unenforceable bundle or a contradictory clamp conjunction).
- `PreviewToolResponse` — runs the response-side shaping against a sample response document and returns the shaped "after" the agent would receive.

Both require Cedar authorization to be enabled; they return `UNIMPLEMENTED` otherwise.

## OAuth and identity services

### `OAuthClientService` RPCs

Source: `oauth_client.proto:22`. Served: `aigw server.go:2694`.

Manages OAuth clients (external tools such as Claude.ai or ChatGPT) that request tokens from the aigw OAuth Authorization Server.

Core CRUD: `CreateOAuthClient`, `GetOAuthClient`, `ListOAuthClients`, `UpdateOAuthClient`, `DeleteOAuthClient`.

Additional operations: `RevokeAllTokens`, `ListWellKnownClients`, `GetDCRSettings`, `UpdateDCRSettings`, `GetCIMDSettings`, `UpdateCIMDSettings`, `MintInitialAccessToken`, `ListInitialAccessTokens`, `RevokeInitialAccessToken`.

Key `OAuthClient` fields:

| Field | Notes |
|-------|-------|
| `name` | Used as OAuth `client_id` |
| `redirect_uris` | Min 1 required |
| `allowed_resources` | MCP URLs this client can request tokens for |
| `grant_types` | `AUTHORIZATION_CODE` (1), `REFRESH_TOKEN` (2) |
| `token_endpoint_auth_method` | `CLIENT_SECRET_BASIC` (1), `CLIENT_SECRET_POST` (2), `NONE` (3) |
| `pkce_required` | bool |
| `enabled` | bool |
| `dcr_issued` | OUTPUT_ONLY; bool; set when issued via Dynamic Client Registration |
| `client_secret` | Returned once on create only; not retrievable after that |

#### Inbound client registration: DCR and CIMD

An external MCP client can be admitted to the aigw Authorization Server without an
admin creating an `OAuthClient` by hand, through two independent self-service
mechanisms. Both are configured as **tenant-singleton** settings on
`OAuthClientService` (no per-instance resource name), and either can be enabled
without the other:

- **Dynamic Client Registration (DCR)** — the RFC 7591 flow, configured via
  `GetDCRSettings` / `UpdateDCRSettings`. The client registers itself and the
  gateway persists a real `OAuthClient` (its `dcr_issued` field is set).
- **Client ID Metadata Documents (CIMD)** — configured via `GetCIMDSettings` /
  `UpdateCIMDSettings`. The client's `client_id` is an `https` URL at which it
  hosts a JSON metadata document about itself; the gateway resolves that document
  on demand at `/authorize`. There is no registration step and no persisted client
  — the resolved client is ephemeral. The MCP authorization spec treats CIMD as
  the successor to DCR.

##### `CIMDSettings` (singleton)

`GetCIMDSettings` returns the settings plus an output-only `resolution_available`
signal; `UpdateCIMDSettings` takes a required `cimd_settings` and is admin-only
(`CIMDSettings` is a distinct authorization entity from `OAuthClient`, so granting
CIMD-config access does not grant per-client CRUD).

| Field | Notes |
|-------|-------|
| `enabled` | bool. When false, URL-shaped `client_id`s are rejected at `/authorize` and the authorization-server metadata does not advertise `client_id_metadata_document_supported`, so conformant clients fall back to DCR or pre-registration. |
| `trust_policy` | `CIMDTrustPolicy`: `CIMD_TRUST_POLICY_UNSPECIFIED` (0, treated as all-domains at the boundary), `CIMD_TRUST_POLICY_ALL_DOMAINS` (1, any host serving a valid document), `CIMD_TRUST_POLICY_ALLOWED_DOMAINS` (2, only `allowed_domains`). |
| `allowed_domains` | Repeated string; the trusted document-hosting domains when `trust_policy` is `ALLOWED_DOMAINS`. An entry matches the `client_id` host exactly or as a parent domain (`example.com` admits `app.example.com`); bare public suffixes (`com`, `co.uk`) are rejected. |
| `allowed_resources` | Repeated string; the MCP resource (RFC 8707) allowlist applied to every CIMD-resolved client. `"*"` (must be the only entry) permits any MCP on this gateway; otherwise each entry is a concrete `https://` URL. Unlike the DCR equivalent this is **not** required, and an empty list means no MCP is reachable — the fail-closed default for clients no admin reviews. |
| `resolution_available` | OUTPUT_ONLY on the get response. Whether the gateway can actually resolve documents right now — a deployment-level prerequisite distinct from the tenant's desired `enabled` state. With `enabled = true` but `resolution_available = false`, CIMD does not take effect. |

Because a CIMD client is admitted with no admin ever seeing it, the trust policy and
resource allowlist are the enforcement surface: restrict `trust_policy` to
`ALLOWED_DOMAINS` and keep `allowed_resources` as narrow as the clients require.

### `OAuthProviderService` RPCs

Source: `oauth_provider.proto:15`. Served: `aigw server.go:1195`.

Manages third-party OAuth providers (GitHub, Google, Slack, and similar) that the aigw acts as a client toward.

RPCs: `CreateOAuthProvider`, `GetOAuthProvider`, `ListOAuthProviders`, `UpdateOAuthProvider`, `DeleteOAuthProvider`, `ListWellKnownProviders`.

Key fields: `name` (slug), `authorization_endpoint`, `token_endpoint`, `revocation_endpoint`, `client_id` (immutable), `client_secret_ref` (UPPER_SNAKE_CASE secret-store key), `scopes`, `grant_types` (`BROWSER_CONSENT` (1), `TOKEN_EXCHANGE` (3)), `pkce_required`, `token_endpoint_auth_method`, `extra_auth_params`, `extra_token_params`, `enabled`.

### `OAuthConnectionService` RPCs

Source: `oauth_connection.proto:13`. Served: `aigw server.go:1205`.

Manages per-user OAuth connections between a user and a configured provider.

RPCs: `Authorize`, `Callback` (auth-exempt), `ListConnections`, `GetConnection`, `RevokeConnection`.

### `TokenVaultAdminService` RPCs

Source: `token_vault_admin.proto:13`. Served: `aigw server.go:1209`.

Admin-level token vault operations.

RPCs: `ListAllConnections`, `AdminRevokeConnection`, `RotateEncryptionKey`.

### `PendingAuthRequestService` (proto-only; not callable)

Source: `pending_auth_request.proto:20`. The proto defines `GetPendingAuthRequest`, `ApprovePendingAuthRequest`, and `DenyPendingAuthRequest`, but **no `adpv1alpha1connect.NewPendingAuthRequestServiceHandler` is wired in `server.go`**. The consent flow is implemented via internal HTTP handlers (`idpstore.PendingAuthRequestStore`, `apps/aigw/internal/idp/`), not via the proto RPC handler. Do not attempt to call these RPCs; they will not route.

## Not part of this API

The following services and concepts do **not** exist in the `adp.v1alpha1` public proto surface. Every file in `cloudv2/proto/public/cloud/redpanda/api/adp/v1alpha1/` was grepped for these names and returned 0 matches.

| Absent name | What to use instead |
|-------------|---------------------|
| `SpendLimitService` | Use `BudgetService` with `limit_microcents` |
| `RateLimitService` | Not available; the Agentic Data Plane has no per-second/minute/day rate caps. Use `BudgetService` to cap spend. |
| `RoutingService` / `BackendPoolService` | Not available; see gateway-and-providers.md |
| `AccessControlService` | Use `PolicyService`, `PolicyTemplateService`, `SystemPolicyService`, `EffectivePolicySetService` |
| `AuditService` (OCSF) | Not in `adp.v1alpha1`. For request/response accountability, see observability.md (transcripts). |
| `ValidatePolicy` / `EvaluateAccess` / `ListPolicyVersions` RPCs | These RPCs do not exist on `PolicyService`. |
| `SSOService` / `OAuth2ClientService` / `OAuth2KeyService` | Use `OAuthClientService`, `OAuthProviderService`, `OAuthConnectionService` |

The names `SpendLimitService`, `RateLimitService`, `AccessControlService`, `AuditService`, `RoutingService`, and `SSOService` do exist in the legacy generated-only tree at `cloudv2/proto/gen/go/redpanda/api/aigateway/v1/` (ratelimit.pb.go, routing.pb.go, spend_limit.pb.go, audit.pb.go, access_control.pb.go, sso.pb.go). That tree has no public source protos and is not the current Agentic Data Plane surface. It is used by the separate `rpk cloud mcp` control-plane path (`aigateway/v1`); see /redpanda:rpk-cloud.

## Service status summary

| Service | Source | Served | API version |
|---------|--------|--------|--------|
| `BudgetService` | `budget.proto:14` | aigw server.go:1253 | `v1alpha1` |
| `SpendingService` | `spending_service.proto:8` | aigw server.go:1217 | `v1alpha1` |
| `GuardrailService` | `guardrail.proto:25` | aigw server.go:1200 | `v1alpha1` |
| `PolicyService` | `policy_service.proto:25` | adp-api server.go:360 | `v1alpha1` |
| `PolicyTemplateService` | `policy_service.proto:66` | adp-api server.go:366 | `v1alpha1` |
| `SystemPolicyService` | `system_policy_service.proto:29` | adp-api server.go:390 | `v1alpha1` |
| `EffectivePolicySetService` | `effective_policy_set_service.proto:20` | adp-api server.go:407 | `v1alpha1` |
| `OAuthClientService` | `oauth_client.proto:22` | aigw server.go:2694 | `v1alpha1` |
| `OAuthProviderService` | `oauth_provider.proto:15` | aigw server.go:1195 | `v1alpha1` |
| `OAuthConnectionService` | `oauth_connection.proto:13` | aigw server.go:1205 | `v1alpha1` |
| `TokenVaultAdminService` | `token_vault_admin.proto:13` | aigw server.go:1209 | `v1alpha1` |
| `PendingAuthRequestService` | `pending_auth_request.proto:20` | proto-only; gRPC handler not wired | `v1alpha1` |
