Source: `cloudv2/proto/public/cloud/redpanda/api/adp/v1alpha1/llm_provider.proto` (LLMProviderService RPCs lines 16-66, LLMProvider fields lines 82-260, provider config oneof lines 220-231, provider type enum lines 68-78, config messages lines 574-747, ProviderModelPricing lines 451-548), `cloudv2/proto/public/cloud/redpanda/api/adp/v1alpha1/model.proto` (ModelService RPCs lines 10-23, Model fields, ModelCapabilities lines 26-36, ListModelsRequest lines 62-72), `cloudv2/apps/aigw/internal/server/server.go` (LLMProviderService registered lines 1054/1189; ModelService registered lines 1059/1213), `cloudv2/apps/aigw/internal/llm/provider/google/google.go:70` (Gemini x-goog-api-key injection). `Model.max_input_tokens` (field 6) and `max_output_tokens` (field 7) re-verified against `model.proto` on 2026-07-06. Evidence date: 2026-07-06.

# AI Gateway, LLM Providers, and Models Reference

**Maturity:** ADP is generally available. The services in this file are on the `v1alpha1` version path and carry no `LaunchStage` annotation in the protos, so treat field-level details as still evolving and confirm them live via `--help` and live introspection.

Audience: an AI agent operating the ADP AI Gateway via `rpk ai llm` / `rpk ai model` and the ADP API. Optimize for correct programmatic use.

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
| `ListLLMProviderTypes` | `dataplane_adp_llmprovider_list` |
| `CheckConnection` | `dataplane_adp_llmprovider_get` |

`CheckConnection` (`llm_provider.proto:59-65`) fires a live upstream probe to the configured provider endpoint and returns `latency_ms` plus a `google.rpc.Status` indicating reachability.

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
| `transcripts` (field 20) | `Transcripts.record_input_messages`, `record_output_messages`; OTel content capture |
| `guardrail` (field 21) | Optional; references a `Guardrail` resource evaluated before forwarding |

The **provider config oneof** (`llm_provider.proto:220-231`) holds exactly one of: `openai_config`, `anthropic_config`, `google_config`, `bedrock_config`, `openai_compatible_config`. The set arm must match the `type` field.

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
| `ListModels` | `dataplane_aigateway_model_list` |
| `GetModel` | `dataplane_aigateway_model_get` |

`Model` is discovery-catalog metadata only (`model.proto:39`): "This is metadata only -- it does not affect runtime proxy behavior." There are no Create, Update, Delete, Enable, or Disable RPCs on `ModelService`. (Those RPCs existed only in the deprecated `aigateway/v1` `ModelsService`, which has no source proto in the current tree and is not registered in the aigw server.)

**Key `Model` fields:** `name`, `label`, `provider_type` (`LLMProviderType`), `capabilities` (`ModelCapabilities`), `default_pricing` (`ProviderModelPricing`, sourced from `ai-sdk-go/pricing.Catalog`), `max_input_tokens` (field 6) and `max_output_tokens` (field 7). The two token limits are `optional int64`, OUTPUT_ONLY: the model's context-window (input) and single-response generation (output) caps, sourced from the ai-sdk-go per-model constraints catalog. Both are unset when the catalog declares no limit — absent means "unknown", never zero — so treat a missing value as unknown rather than zero.

**`ModelCapabilities`** (`model.proto:26-36`): `streaming`, `tools`, `json_mode`, `structured_output`, `vision`, `audio`, `multi_turn`, `system_prompts`, `reasoning`.

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
- Optionally captures `gen_ai.input.messages` and `gen_ai.output.messages` content (controlled by `transcripts` fields on `LLMProvider`).
- Optionally evaluates a `Guardrail` resource before forwarding (`llm_provider.proto:243-258`).

## Not in scope

The following capabilities are absent from the ADP AI Gateway. Both the `adp/v1alpha1` proto tree and the ADP AI Gateway product documentation confirm this.

**Proto evidence:** no `RoutingService`, `BackendPoolService`, `RateLimitService`, or routing/failover/load-balancing messages were found anywhere under `cloudv2/proto/public/cloud/redpanda/api/adp/` (v1alpha1 and experimental). No `requests_per_second`, `requests_per_minute`, or `requests_per_day` fields are defined on any `adp/v1alpha1` message.

**Product documentation evidence** (`adp-docs/modules/gateway/pages/overview.adoc`):

Lines 107-110 ("When to use" section):
> "Need routing, failover, or cross-provider load balancing across providers. AI Gateway does not provide these capabilities."

Lines 113-119 (`[[out-of-scope]]` Limitations section):
> "Multi-provider routing, failover, and retries. A synthetic provider that fans requests to multiple upstreams is not part of AI Gateway."
> "Rate limits. Requests-per-second, per-minute, or per-day caps are not available. To cap spend rather than request rate, use budgets, which enforce a per-agent hard cap."
> "Managed MCP aggregation at the gateway. Register MCP tool servers separately under MCP Servers in ADP."

Do not attempt to configure routing rules, failover policies, cross-provider load balancing, or request rate limits via `LLMProviderService` or any other ADP API. These features do not exist in the current API surface.
