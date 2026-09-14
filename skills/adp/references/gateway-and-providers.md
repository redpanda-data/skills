Source: `cloudv2/proto/public/cloud/redpanda/api/adp/v1alpha1/llm_provider.proto` (LLMProviderService RPCs lines 16-66, LLMProvider fields lines 82-260, provider config oneof lines 220-231, provider type enum lines 68-78, config messages lines 574-747, ProviderModelPricing lines 451-548), `cloudv2/proto/public/cloud/redpanda/api/adp/v1alpha1/model.proto` (ModelService RPCs lines 10-23, Model fields, ModelCapabilities lines 26-36, ListModelsRequest lines 62-72), `cloudv2/apps/aigw/internal/server/server.go` (LLMProviderService registered lines 1054/1189; ModelService registered lines 1059/1213), `cloudv2/apps/aigw/internal/llm/provider/google/google.go:70` (Gemini x-goog-api-key injection). `cloudv2/apps/aigw/internal/services/llmprovider/service.go` (create-path `Transcripts` defaulting). `Model.max_input_tokens` (field 6) and `max_output_tokens` (field 7) re-verified against `model.proto` on 2026-07-06. The `CheckConnection` `target` oneof (`name` / `LLMProviderConnectionConfig`), its `dataplane_adp_llmprovider_check_connection` permission and `check_connection` Cedar action verified against `llm_provider.proto` on 2026-09-07. `ModelCapabilities.reasoning_efforts` (field 11, the provider-owned effort strings) and the deprecation of `supported_reasoning_efforts` (field 10) verified against `model.proto` on 2026-09-14. Failed-call investigation: `cloudv2/proto/public/cloud/redpanda/api/adp/v1alpha1/agent_network_service.proto` (the `QueryLLMProviderCallFailures` RPC on `AgentNetworkService` with its `dataplane_adp_llmprovider_get` permission and `get`-on-`LLMProvider` Cedar action, `QueryLLMProviderCallFailuresRequest` scope/`Filter.caller`/paging bounds, `LLMProviderCallFailureEvidence` fields, and the `LLMProviderCallFailureReason` enum) verified on 2026-09-14. Evidence date: 2026-09-14 (provider types, pricing overrides, and the transcript-recording create default unchanged).

# AI Gateway, LLM Providers, and Models Reference

**Maturity:** Redpanda Agentic Data Plane is generally available. The services in this file are on the `v1alpha1` version path and carry no `LaunchStage` annotation in the protos, so treat field-level details as still evolving and confirm them live via `--help` and live introspection.

Audience: an AI agent operating the Agentic Data Plane AI Gateway via `rpk ai llm` / `rpk ai model` and the Agentic Data Plane API. Optimize for correct programmatic use.

Related references: [SKILL.md](../SKILL.md), [agents.md](agents.md), [mcp-servers.md](mcp-servers.md), [governance.md](governance.md), [rpk-ai.md](rpk-ai.md), [observability.md](observability.md).

## Discover the live surface

Before acting, confirm available operations and current provider/model state:

```bash
# See all rpk ai llm subcommands and flags
rpk ai llm --help

# List all LLM providers registered on the cluster
rpk ai llm list

# List models known to the gateway
rpk ai model list

# Optional: filter models by provider type (e.g., bedrock, with AWS region)
rpk ai model list --help
```

The sections below document the proto-verified surface. Provider type support and exact model identifiers change with catalog updates; always confirm live via `rpk ai model list` and the API before hardcoding values.

## `LLMProviderService` RPCs

Source: `llm_provider.proto:16-66`. Service name: `redpanda.api.adp.v1alpha1.LLMProviderService`.

| RPC | IAM permission |
|-----|----------------|
| `CreateLLMProvider` | `dataplane_adp_llmprovider_create` |
| `GetLLMProvider` | `dataplane_adp_llmprovider_get` |
| `ListLLMProviders` | `dataplane_adp_llmprovider_list` |
| `UpdateLLMProvider` | `dataplane_adp_llmprovider_update` |
| `DeleteLLMProvider` | `dataplane_adp_llmprovider_delete` |
| `ListLLMProviderTypes` | none — `skip: true` (read-only static catalog; any authenticated caller) |
| `CheckConnection` | `dataplane_adp_llmprovider_check_connection` |

`CheckConnection` fires a live upstream probe and returns `latency_ms` plus a `google.rpc.Status` (`OK` on success; otherwise a canonical code and a human-readable message). It carries its own permission — `dataplane_adp_llmprovider_check_connection`, Cedar action `check_connection` — so the ability to probe a provider is grantable separately from reading or writing one.

### Testing a connection before you save it

`CheckConnectionRequest` carries a required `target` oneof, so the same RPC covers both a saved provider and a draft:

| `target` arm | What it probes |
|---|---|
| `name` | An existing, persisted provider, by resource name. Use this to re-test a provider whose credentials or endpoint may have changed. |
| `provider_config` | An **unpersisted** `LLMProviderConnectionConfig` — connection settings only. Nothing is created or cached, so you can validate credentials before committing a `CreateLLMProvider`. |

`LLMProviderConnectionConfig` is a bare `provider_config` oneof over the same five config messages as the resource (`openai_config`, `anthropic_config`, `google_config`, `bedrock_config`, `openai_compatible_config`); exactly one arm is required. Resource identity, models, guardrails, tags, and every other persistence field are deliberately absent — a draft check answers "do these credentials reach this endpoint", nothing more. Credential references are still resolved through the secret store, so a probe can fail on a missing secret before any request leaves the gateway.

Read `status` for the verdict, not `latency_ms`: latency is `0` when the probe failed *before* a request went out (a missing secret, for example), which is indistinguishable from a very fast response if you only look at the number.

### Investigating calls that already failed

`CheckConnection` answers "can the gateway reach this provider *now*". To ask why calls failed over some past window, use `QueryLLMProviderCallFailures` — an on-demand telemetry drilldown, not a managed collection:

| Aspect | Detail |
|---|---|
| Service | `AgentNetworkService` (not `LLMProviderService`), `redpanda.api.adp.v1alpha1` |
| Permission | `dataplane_adp_llmprovider_get`, Cedar action `get` on `LLMProvider` — reading a provider's failures is the same capability as reading the provider |
| Scope | Required `llm_provider` (bare lowercase `LLMProvider.name`, ≤ 63 chars — this resource predates canonical AIP names), plus a required `start_time` (inclusive) / `end_time` (exclusive) window |
| Narrowing | Optional `filter.caller` oneof: `agent_name` (`agents/{agent}`) or `user_email` (matches direct, non-agent calls only) |
| Paging | `page_size` 0 → 50, values above 100 coerced to 100; `page_token` must be replayed against an identical scope and filter |
| Order | `start_time` descending, then `span_id` descending |

Each `LLMProviderCallFailureEvidence` entry is one deduplicated gateway-side failed span: `trace_id` / `span_id`, `start_time`, `latency`, `model`, the `caller` oneof (`agent_name` or `user_email`), `response_id`, `conversation_id`, and the classification pair below. Individual fields can be empty, each for its own reason: `trace_id` on older telemetry that recorded none, `latency` when telemetry carried no usable duration, `model` when telemetry did not record one, `response_id` when the upstream issued no response identifier, and `conversation_id` when telemetry omitted it or the call belongs to no transcript. Treat an empty field as "not recorded", not as a measured absence.

**The classification is content-safe by construction.** `reason` is a stable `LLMProviderCallFailureReason` enum and `error_summary` is derived *only* from `reason`; provider-supplied error text is never returned by this RPC. Do not expect to read the upstream's own message here, and do not parse `error_summary` — switch on `reason`:

| `LLM_PROVIDER_CALL_FAILURE_REASON_…` | What it means |
|---|---|
| `UNSPECIFIED` | Could not be classified more precisely |
| `RATE_LIMITED` | The provider rate limit was reached |
| `AUTHENTICATION_FAILED` | The provider rejected its configured credentials |
| `PERMISSION_DENIED` | The provider denied the requested operation |
| `RESOURCE_NOT_FOUND` | The request referenced an upstream resource that does not exist — a removed or renamed model is the common case |
| `TIMED_OUT` | The provider call exceeded its deadline |
| `PROVIDER_UNAVAILABLE` | The provider was temporarily unavailable or overloaded |
| `SAFETY_POLICY_BLOCKED` | A provider safety policy blocked the request |
| `REQUEST_TOO_LARGE` | The request exceeded a provider size limit |
| `INVALID_REQUEST` | The provider rejected the request shape or parameters |
| `PROVIDER_INTERNAL` | The provider reported an internal failure |
| `PROVIDER_ERROR` | Another provider-side failure; no text is exposed |

The reason is what selects the remedy: `AUTHENTICATION_FAILED` points at the provider's credentials (re-probe with `CheckConnection`), `RESOURCE_NOT_FOUND` at the model the caller asked for (re-check against `rpk ai model list` and the provider's `provider_models`), `RATE_LIMITED` and `PROVIDER_UNAVAILABLE` at upstream capacity rather than at your configuration.

## Key `LLMProvider` fields

Source: `llm_provider.proto:82-260`.

| Field | Notes |
|-------|-------|
| `name` (field 2) | AIP-122 resource name; immutable after creation |
| `display_name` (field 3) | Human-readable label |
| `type` (field 4) | `LLMProviderType` enum; immutable after creation |
| `provider_models` (field 19) | Canonical model list (`ProviderModel`); field 7 `models` is deprecated, do not use |
| `enabled` (field 8) | Toggle; a disabled provider rejects all requests |
| `url` (field 11) | OUTPUT_ONLY; computed proxy URL for this provider; not persisted |
| `transcripts` (field 20) | `Transcripts.record_input_messages`, `record_output_messages`; OTel content capture. **Both default to enabled when you omit the message on create** — see below |
| `guardrail` (field 21) | Optional; references a `Guardrail` resource evaluated before forwarding |

The **provider config oneof** (`llm_provider.proto:220-231`) holds exactly one of: `openai_config`, `anthropic_config`, `google_config`, `bedrock_config`, `openai_compatible_config`. The set arm must match the `type` field.

### Transcript recording defaults to ON

`Transcripts` carries two plain (no-presence) bools: `record_input_messages` (field 1) and `record_output_messages` (field 2). They control whether the gateway populates `gen_ai.input.messages` and `gen_ai.output.messages` on call spans — that is, whether prompts and completions are captured verbatim for transcripts.

On `CreateLLMProvider` the server distinguishes an **absent** `transcripts` message from a supplied one:

- **Omit `transcripts`** → the server stamps both fields **true**. A provider created without saying anything about transcripts captures full request and response content.
- **Supply `transcripts`** → the message is honoured as written, so a supplied `false` is a real opt-out.

To create a provider that does *not* capture content, send the message explicitly:

```json
{
  "transcripts": {
    "record_input_messages": false,
    "record_output_messages": false
  }
}
```

Existing providers are not backfilled — this defaulting applies to newly created providers only, and `UpdateLLMProvider` can flip either field at any time.

**Privacy consequence.** Captured content may contain PII or secrets, and enabling capture is now the default for any programmatic create that leaves the field unset. If a provider must not record content, set the fields explicitly on create rather than relying on the zero value.

## Supported provider types and auth schemes

Source: `llm_provider.proto:68-78` (enum), config messages at lines 574-747.

| Provider type | Enum value | Config message | Auth mechanism |
|---------------|-----------|----------------|----------------|
| OpenAI | `LLM_PROVIDER_TYPE_OPENAI` (1) | `OpenAIConfig` | `api_key_ref`: UPPER_SNAKE_CASE key name referencing a secret in the Redpanda secret store; `base_url` optional |
| Anthropic | `LLM_PROVIDER_TYPE_ANTHROPIC` (2) | `AnthropicConfig` | XOR: `api_key_ref` (server-side key) OR `authorization_passthrough` (see note below); `base_url` optional |
| Google / Gemini | `LLM_PROVIDER_TYPE_GOOGLE` (3) | `GoogleConfig` | `api_key_ref` required; the proxy injects the resolved key as the `x-goog-api-key` header on outbound requests |
| AWS Bedrock | `LLM_PROVIDER_TYPE_BEDROCK` (4) | `BedrockConfig` | SigV4 signing; credential source is one of: `StaticCredentials` (`access_key_id_ref` + `secret_access_key_ref`), `AssumeRole` (`role_arn`), or default credential chain (env vars / IRSA / EKS Pod Identity) when the credentials oneof is unset |
| OpenAI-compatible | `LLM_PROVIDER_TYPE_OPENAI_COMPATIBLE` (5) | `OpenAIConfig` (reused) | `api_key_ref` optional (empty = no-auth, valid for Ollama, vLLM, LM Studio, LocalAI); `base_url` required |

**Anthropic passthrough detail** (`llm_provider.proto:624-628`): `authorization_passthrough` forwards the client's `Authorization` header to Anthropic unchanged instead of injecting a server-side API key. This is intended for enterprise and Max plan OAuth passthrough scenarios. `api_key_ref` and `authorization_passthrough` are mutually exclusive.

**OpenAI-compatible note** (`llm_provider.proto:74-77`): the `LLM_PROVIDER_TYPE_OPENAI_COMPATIBLE` type tag is used for UI labelling and catalog routing. It reuses the `OpenAIConfig` payload. The `base_url` field is required because there is no default endpoint.

## `ModelService` RPCs

Source: `model.proto:10-23`. Service name: `redpanda.api.adp.v1alpha1.ModelService`.

| RPC | IAM permission |
|-----|----------------|
| `ListModels` | none — `skip: true` (read-only static catalog; any authenticated caller) |
| `GetModel` | none — `skip: true` (read-only static catalog; any authenticated caller) |

Both `ModelService` RPCs bypass authorization (`skip: true`): the catalog is build-time static and identical for every caller, so `skip` bypasses authorization only — authentication still applies. Model *invocation* stays separately enforced via `dataplane_adp_llmprovider_invoke` at the LLM proxy, so catalog visibility does not imply the right to invoke.

`Model` is discovery-catalog metadata only (`model.proto:39`): "This is metadata only -- it does not affect runtime proxy behavior." There are no Create, Update, Delete, Enable, or Disable RPCs on `ModelService`. (Those RPCs existed only in the deprecated `aigateway/v1` `ModelsService`, which has no source proto in the current tree and is not registered in the aigw server.)

**Key `Model` fields:** `name`, `label`, `provider_type` (`LLMProviderType`), `capabilities` (`ModelCapabilities`), `default_pricing` (`ProviderModelPricing`, sourced from `ai-sdk-go/pricing.Catalog`), `max_input_tokens` (field 6) and `max_output_tokens` (field 7). The two token limits are `optional int64`, OUTPUT_ONLY: the model's context-window (input) and single-response generation (output) caps, sourced from the ai-sdk-go per-model constraints catalog. Both are unset when the catalog declares no limit — absent means "unknown", never zero — so treat a missing value as unknown rather than zero.

**`ModelCapabilities`**: `streaming`, `tools`, `json_mode`, `structured_output`, `vision`, `audio`, `multi_turn`, `system_prompts`, `reasoning` (field 9), `supported_reasoning_efforts` (field 10, **deprecated**), and `reasoning_efforts` (field 11).

`reasoning_efforts` is a repeated string, OUTPUT_ONLY, listing the **provider-owned, case-sensitive** effort values **this exact model** accepts, ordered from least to most computation (at most 32 values, each 1–64 characters). It is empty for a model that exposes no configurable reasoning control. The vocabulary is the provider's, not the platform's — it varies by provider and by model, so never assume a value exists: read the list live per model and send a value back exactly as spelled (labels and how a control is presented are the client's concern). It is the authoritative source for what you may set as an agent's `reasoning.effort`: the agent write path rejects a value that is not on the list of every effective model (see [agents.md](agents.md)). Note that `reasoning = true` and a non-empty `reasoning_efforts` are different facts — a model can reason without letting you dial the effort.

`supported_reasoning_efforts` is the deprecated predecessor: a repeated `ReasoningEffort` enum that can only carry the values representable by the legacy platform-owned enum (`LOW` … `MAX`), so it under-reports a provider whose vocabulary is wider. Read `reasoning_efforts` instead; the agent write path consults the legacy list only when the new one comes back empty from an older gateway.

**`ListModelsRequest` filters** (`model.proto:62-72`): optional `provider_type` filter; optional `aws_region` for Bedrock regional filtering.

## Per-model pricing overrides

Source: `llm_provider.proto:451-548`.

Pricing overrides are set per model on the `LLMProvider` resource. There is no separate `ModelPricingService`. Each entry in `provider_models` (field 19 on `LLMProvider`) is a `ProviderModel` message that carries an optional `custom_pricing` field of type `ProviderModelPricing`.

`ProviderModelPricing` fields (all `optional int64`; unit: microcents per million tokens):

| Field | Meaning |
|-------|---------|
| `input_per_million` | Standard prompt tokens; also covers tool-use input |
| `output_per_million` | Completion and output tokens; also covers reasoning tokens |
| `cached_input_per_million` | Prompt-cache read tokens |
| `cache_creation_5m_per_million` | 5-minute TTL cache write (Anthropic family) |
| `cache_creation_1h_per_million` | 1-hour TTL cache write |

Comment (`llm_provider.proto:469-472`): this mechanism handles negotiated contract rates and pricing for fine-tuned or private models not in the public catalog. Field 6 (`cache_creation_unknown_ttl_per_million`) is reserved and always uses the catalog rate.

From the CLI, set these overrides with the repeatable `--pricing` flag on `rpk ai llm create` / `rpk ai llm update`, which takes rates in **US dollars per million tokens** and converts to the stored microcent unit for you; hand-written `--provider-models` protojson carrying a `custom_pricing` object (in microcents) also works. See [rpk-ai.md](rpk-ai.md).

## What the AI Gateway proxy does

Source: `adp-docs/modules/gateway/pages/overview.adoc:10-52`.

The AI Gateway is a managed HTTP proxy. The per-provider URL pattern is:

```
<gateway-base>/llm/v1/providers/<provider-name>/<upstream-path>
```

What the proxy does:

- Stores upstream API keys in the Redpanda secret store; calling applications never see them.
- Injects the resolved credential (API key, SigV4 signature, or passthrough `Authorization`) on each outbound request.
- Authenticates inbound clients via OIDC service accounts and short-lived tokens.
- Records spend, request counts, and token counts per provider on OTel spans.
- Optionally captures `gen_ai.input.messages` and `gen_ai.output.messages` content (controlled by `transcripts` fields on `LLMProvider`; enabled by default when the message is omitted on create — see [Transcript recording defaults to ON](#transcript-recording-defaults-to-on)).
- Optionally evaluates a `Guardrail` resource before forwarding (`llm_provider.proto:243-258`).

## Not in scope

The following capabilities are absent from the Agentic Data Plane AI Gateway. Both the `adp/v1alpha1` proto tree and the Agentic Data Plane AI Gateway product documentation confirm this.

**Proto evidence:** no `RoutingService`, `BackendPoolService`, `RateLimitService`, or routing/failover/load-balancing messages were found anywhere under `cloudv2/proto/public/cloud/redpanda/api/adp/` (v1alpha1 and experimental). No `requests_per_second`, `requests_per_minute`, or `requests_per_day` fields are defined on any `adp/v1alpha1` message.

**Product documentation evidence** (`adp-docs/modules/gateway/pages/overview.adoc`):

Lines 107-110 ("When to use" section):
> "Need routing, failover, or cross-provider load balancing across providers. AI Gateway does not provide these capabilities."

Lines 113-119 (`[[out-of-scope]]` Limitations section):
> "Multi-provider routing, failover, and retries. A synthetic provider that fans requests to multiple upstreams is not part of AI Gateway."
> "Rate limits. Requests-per-second, per-minute, or per-day caps are not available. To cap spend rather than request rate, use budgets, which enforce a per-agent hard cap."
> "Managed MCP aggregation at the gateway. Register MCP tool servers separately under MCP Servers in ADP."

Do not attempt to configure routing rules, failover policies, cross-provider load balancing, or request rate limits via `LLMProviderService` or any other Agentic Data Plane API. These features do not exist in the current API surface.
