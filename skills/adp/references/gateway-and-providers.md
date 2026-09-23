Source: `cloudv2 apps/rpai/testdata/commands-snapshot.md` (`llm-provider`, `model` groups), `cloudv2 apps/rpai/internal/cmd/llm/` (`check`), `cloudv2 apps/rpai/internal/cmd/model/` (`list`, `get`), `adp-docs modules/gateway/pages/configure-provider.adoc`, `adp-docs modules/gateway/pages/overview.adoc` — verified 2026-09-23. Behavioral claims carried over from earlier source verification (passthrough header handling, transcript create default, catalog token limits and reasoning efforts): 2026-09-21.

# AI Gateway, LLM Providers, and Models Reference

**Maturity:** Redpanda Agentic Data Plane is generally available. The `rpk ai` CLI is in Preview, so confirm flags live with `--help` before relying on them.

Audience: an AI agent operating the Agentic Data Plane AI Gateway through `rpk ai llm-provider` / `rpk ai model` and the ADP UI (ai.redpanda.com), or calling the gateway from an application.

Related references: [SKILL.md](../SKILL.md), [agents.md](agents.md), [mcp-servers.md](mcp-servers.md), [governance.md](governance.md), [rpk-ai.md](rpk-ai.md), [observability.md](observability.md).

## Discover the live surface

```bash
rpk ai llm-provider --help          # verbs and flags (aliases: llm-providers, llm, provider, lp)
rpk ai llm-provider create --help   # per-type flag groups
rpk ai llm-provider list            # providers in the current environment
rpk ai model list                   # the model catalog
rpk ai model list --provider-type anthropic
```

In the UI, providers live under **LLM providers** in the sidebar (the **AI Gateway** group, alongside Guardrails, Cost and usage, and Budgets). Provider types, model identifiers, and prices change with catalog updates; read them live rather than hardcoding them.

## Manage providers

| Task | CLI | UI |
|---|---|---|
| Create | `rpk ai llm-provider create NAME [flags]` or `-f manifest.yaml` | **LLM providers** → **Add provider** |
| Read | `get NAME`, `list` (`-o table\|wide\|json\|yaml\|markdown`) | Provider detail page (Overview, Models, Connect, Playground when enabled, Settings tabs) |
| Edit | `update NAME [flags]`; `--dry-run` prints the request and computed update mask without sending it | **Settings** tab → change fields → **Save changes** |
| Enable / disable | `update NAME --enabled=false` (or `--enabled`) | **Settings** tab → **Disable provider**; or the row's actions menu in the list |
| Delete | `delete NAME` | **Settings** tab → **Delete this provider** (type `delete`), or the list row's actions menu (type the display name) |
| Test connectivity | `check NAME` | **Test connection** (see [Test a connection](#test-a-connection)) |
| GitOps | `apply -f`, `diff -f` | — |

- `NAME` is the resource ID: starts with a lowercase letter, lowercase letters/digits/hyphens, ends alphanumeric, at most 63 characters, **immutable**. It is the `<provider-name>` in the proxy URL. The UI derives it from the display name without showing it on the create form.
- The provider **type is immutable** after creation. In the CLI, the type is selected by which flag group you set (`--openai-config.*`, `--anthropic-config.*`, `--google-config.*`, `--bedrock-config.*`, `--openai-compatible-config.*`); setting flags from two groups is an error.
- `update` with no field flags fails: `Error: no fields to update; pass at least one field flag or -f`.
- `--provider-models` and `--tags` **replace** the full list/map on update.
- A missing provider returns `Error: LLM provider not found (use 'rpai llm-provider list' to see what's available)` with `Code: not_found`.
- A disabled provider rejects all requests to its proxy URL; its configuration is kept.

## Provider types and credentials

Every credential field is a **secret-store reference** (an `UPPER_SNAKE_CASE` key name such as `OPENAI_API_KEY`), never the secret value. The UI create form can also store a new key inline (**Bring a new API key reference** → Key name + API key → **Save key**).

| Type (UI label) | CLI flag group | Credential |
|---|---|---|
| OpenAI | `--openai-config.base-url`, `--openai-config.api-key-ref` | Exactly one of an API key reference or authorization passthrough. `base-url` defaults to `https://api.openai.com/v1`. |
| Anthropic | `--anthropic-config.base-url`, `--anthropic-config.api-key-ref`, `--anthropic-config.authorization-passthrough` | Exactly one of an API key reference or authorization passthrough. |
| Google AI | `--google-config.base-url`, `--google-config.api-key-ref` | API key reference required. Clients send their gateway token in `X-Redpanda-Cloud-Token`; the gateway sets `x-goog-api-key` to the stored key upstream (the gateway does not read a client's `x-goog-api-key`). |
| AWS Bedrock | `--bedrock-config.region` (required), `--bedrock-config.base-url`, plus one credential mode | UI **Credential type**: *Default chain* (leave credentials unset; needs an ambient AWS identity, so it cannot work on an environment hosted outside AWS), *Static keys* (`--bedrock-config.static-credentials.access-key-id-ref` + `.secret-access-key-ref`), or *Assume IAM role* (`--bedrock-config.assume-role.role-arn`, optional `.external-id`, `.session-name`; the AssumeRole call itself still authenticates through the default chain). One mode per provider. |
| OpenAI-compatible | `--openai-compatible-config.base-url`, `--openai-compatible-config.api-key-ref` | API key, passthrough, or **neither** (no-auth endpoints such as Ollama, vLLM, LM Studio, LocalAI); never both. **Always set the base URL**: the UI requires it. |

Short aliases exist for the Bedrock flags (`--region`, `--access-key-id-ref`, `--secret-access-key-ref`, `--role-arn`); an unknown flag such as `--api-key-ref` errors with a "did you mean" list of the per-group flags.

**Save-time validation checks the reference, not the secret.** A reference to a nonexistent secret saves fine and fails at the first proxied call (`secret "<NAME>" not found`). Google AI rejects an empty key reference; OpenAI and Anthropic reject neither-or-both of key and passthrough; OpenAI-compatible rejects only both.

**Bedrock `base-url` caveat:** with a custom base URL every request goes to that URL, so models Bedrock serves only on its separate `bedrock-mantle` endpoint are not reachable through that provider.

**Guardrail:** `--guardrail NAME` attaches an existing guardrail (validated at save; a missing or deleting guardrail is rejected). The UI shows the Guardrail field on Bedrock providers only; for other types use the CLI flag. See [governance.md](governance.md).

## Test a connection

| Where | What it tests |
|---|---|
| UI create form, **Connection settings** → **Verify connection** → **Test connection** | The **unsaved** credential and endpoint you entered. Creates nothing. Needs a provider key for types that require one and a base URL starting with `http://` or `https://`. |
| UI provider **Connect** tab → **Verify provider** → **Test connection** | The saved provider. |
| `rpk ai llm-provider check NAME` | The saved provider only; there is no CLI way to test a draft config. |

`check` prints `OK  NAME  (<latency>)` on success. On failure it writes `FAIL  NAME  code=<N>  <message>` to stderr, followed by `reason=… domain=…` and any metadata lines, and exits non-zero — script on the exit code, not the latency.

What a green result proves: for most types, the gateway listed the upstream's models with your credential (authentication + network path, not access to any one model); for Bedrock, the AWS credentials work in the configured region (model access is granted separately by IAM).

**A passthrough provider cannot be probed.** There is no server-side credential, so the UI says the first real request verifies upstream access, and `check` reports a failed-precondition verdict. That is about the configuration, not reachability; do not gate a create or update on a green check for these providers.

## Investigate failed calls

This is a **UI-only** workflow; no `rpk ai` command exposes it.

On a provider's **Overview** tab (which reports over one selectable time range, default last 7 days), a warning above **Who calls what** counts the callers with failed requests. Click **Inspect** on a caller — or its node in the graph, or its error count in the **Callers** table — to open the **Failed provider calls** panel: that caller's failed calls, newest first, with **Load more** for paging.

Each entry shows the start time, a summary, model, latency, and trace / span / response IDs, plus a failure label. The panel reports the call's diagnostics only, never the prompt, model output, or the provider's raw error text. Labels and the remedy they point to:

| Label | Points at |
|---|---|
| Authentication failed, Permission denied | The provider's credential or endpoint (**Review connection**; re-test with **Test connection**) |
| Resource not found | The requested model — commonly removed or renamed (**Review models**; re-check `rpk ai model list` and the provider's enabled models) |
| Rate limited | Upstream capacity (**Review usage**; **Manage budgets** where enabled) |
| Timed out, Provider unavailable, Provider internal error | Upstream health (a link to the upstream status page when known) |
| Safety policy blocked | The attached guardrail (**Review guardrail**) |
| Request too large, Invalid request, Provider error | The request itself / other provider-side failure |

**Open transcript** appears for agent calls that belong to a conversation. An empty panel suggests a wider range; recent telemetry can take a moment to arrive.

## Transcript recording defaults to ON

Each provider has two independent toggles — UI **Record inputs** / **Record outputs** (create form and **Settings** → **Transcripts**), manifest fields `transcripts.record_input_messages` / `transcripts.record_output_messages`, CLI `--transcripts.record-input-messages` / `--transcripts.record-output-messages`. They control whether the gateway captures full request and response bodies on its own trace data for calls it proxies.

- **Every create path defaults both to on.** The UI form starts with both toggles on, and a `create` (flags or manifest) that says nothing about transcripts records both.
- To opt out on create, pass **both** flags: `--transcripts.record-input-messages=false --transcripts.record-output-messages=false` (or set both to `false` in the manifest). **Setting only one of the flags leaves the other off.**
- Existing providers keep what they were saved with; changes apply to new requests only and do not redact content already recorded.
- These are per-provider, not per-request. To split sensitive traffic, create two providers (recording on and off) and route each application to the matching proxy URL.
- Token counts, latency, and spend are recorded regardless; cost reporting is unaffected.
- These toggles do not control agent transcripts. A managed agent's own transcript recording mode does (see [agents.md](agents.md) and [observability.md](observability.md)).

**Privacy consequence:** captured bodies may contain PII or secrets. If a provider must not record content, set both fields explicitly on create.

## Authorization passthrough

Passthrough makes the gateway forward the **caller's** upstream credential instead of a stored key, so no upstream API key is held in ADP. Available on OpenAI, Anthropic, and OpenAI-compatible providers; Google AI and Bedrock always use stored credentials.

- **UI:** the **Authorization passthrough** toggle in the type's configuration. Turning it on clears the API key reference and hides the credential picker.
- **CLI:** `--anthropic-config.authorization-passthrough` on `create` / `update` (`=false` to disable).
  <!-- TODO(human): the current CLI help shows no --openai-config.authorization-passthrough or --openai-compatible-config.authorization-passthrough flag, although the UI and docs support passthrough on both OpenAI types. Confirm whether a manifest (-f) with openai_config.authorization_passthrough / openai_compatible_config.authorization_passthrough works from the CLI, or whether the flags are missing from rpk ai. Until then, use the UI for OpenAI-family passthrough. -->
- Omitting the API key does **not** imply passthrough: on OpenAI-compatible, no key and no passthrough means a no-auth upstream.

**What the gateway forwards.** On OpenAI and OpenAI-compatible, only `Authorization` and `ChatGPT-Account-ID` (a Codex workspace selector), and only when the caller sent them; no other caller header reaches the upstream. On Anthropic, `Authorization`.

**Gateway authentication travels in its own header.** With passthrough, `Authorization` carries the upstream credential, so the caller sends its Redpanda gateway token in `X-Redpanda-Cloud-Token`; the gateway token is never forwarded upstream. On OpenAI-family passthrough providers a request without `X-Redpanda-Cloud-Token` is rejected with **HTTP 400** (`authorization passthrough requires gateway authentication in X-Redpanda-Cloud-Token`) before the upstream is contacted. Send the header on every passthrough call regardless of type; a client that cannot send two separate credentials cannot use this mode.

```bash
curl "$GATEWAY/llm/v1/providers/<provider-name>/chat/completions" \
  -H "Authorization: Bearer $UPSTREAM_TOKEN" \
  -H "X-Redpanda-Cloud-Token: $(rpk ai auth token)" \
  -H 'Content-Type: application/json' \
  -d '{"model":"<model>","messages":[{"role":"user","content":"hi"}]}'
```

**Redirects are refused on the OpenAI family.** An upstream 3xx becomes **HTTP 502** (`upstream redirects are not allowed with authorization passthrough`) and `Location` is not relayed, so credentials never follow a redirect to another host. Fix by pointing the base URL at the endpoint's final address.

**Codex subscriptions need the Codex base URL.** Passthrough never changes the default endpoint (plain OpenAI still resolves to `https://api.openai.com/v1`). For ChatGPT/Codex subscription passthrough, set the base URL to `https://chatgpt.com/backend-api/codex`. For such a provider, the UI **Connect** tab shows a passthrough setup guide (including a ready-to-paste Codex configuration) instead of the standard client instructions; use that manual setup rather than `rpk ai run codex`, which configures API-key authentication (see [rpk-ai.md](rpk-ai.md)). Whether a subscription tier permits this is an upstream entitlement question.

**Upstream 401 with passthrough on:** confirm the client sends its own `Authorization`, the provider's API key reference is empty, and (OpenAI) the base URL matches the credential type.

## Models

### Models enabled on a provider

`--provider-models` (repeatable; a bare name, comma-split names, or a protojson object) sets the models a provider exposes; the CLI help says an empty list allows all models. The UI model picker starts with the full catalog selected for OpenAI, Anthropic, Google AI, and Bedrock (you can also type an identifier the catalog does not show); OpenAI-compatible takes a freeform list of the exact identifiers your upstream serves. On a saved provider, toggle models on the **Models** tab.

A request for a model not enabled on the provider is rejected with **HTTP 403**, error type `model_not_allowed`, on every provider type. On Bedrock, the picker lists inference-profile IDs for profile-only models and bare model IDs for in-region models.

### The model catalog

The catalog is read-only and Redpanda-maintained. New upstream models usually appear within a day or two without a Redpanda release, but are not enabled on any provider automatically. Retired models drop out of the list but still resolve by identifier, and providers already serving them keep working.

```bash
rpk ai model list                              # NAME, PROVIDER_TYPE, LABEL
rpk ai model list -o wide                      # adds capabilities
rpk ai model list --provider-type bedrock      # openai | openai-compatible | anthropic | google | bedrock
rpk ai model get <name> -o yaml                # full entry
rpk ai model get <name> --provider-type <t>    # disambiguate a model offered by several provider types
```

Aliases: `models`, `m`. There are no create/update/delete verbs for models. Catalog visibility does not grant the right to call a model.

Fields of a catalog entry (`model get -o yaml`):

<!-- TODO(human): the current CLI help contains no `model get` output, so these field names come from the catalog schema (the CLI prints it with snake_case field names, as seen in `llm-provider get -o yaml`) rather than captured CLI output. Confirm against a live `rpk ai model get <name> -o yaml`. -->

| Field | Meaning |
|---|---|
| `name`, `label`, `provider_type` | Identifier, display label, provider type |
| `max_input_tokens` / `max_output_tokens` | Context window / most tokens in one response. **Absent means unknown**, never zero. |
| `capabilities` | Booleans such as `streaming`, `tools`, `json_mode`, `structured_output`, `vision`, `audio`, `multi_turn`, `system_prompts`, `reasoning`, plus `reasoning_efforts` |
| `default_pricing` | Catalog rates (same bucket fields as pricing overrides below) |

`capabilities.reasoning_efforts` lists the **provider-owned, case-sensitive** effort values this exact model accepts, ordered least to most computation; empty when the model has no configurable reasoning control. It varies by provider and model, so read it live and send a value back exactly as spelled. It is the authority for an agent's `reasoning.effort`: agent writes reject a value not on the list of every effective model (see [agents.md](agents.md)). `reasoning: true` with an empty `reasoning_efforts` means the model reasons but the effort is not adjustable. Ignore the deprecated `supported_reasoning_efforts` list if present; it can under-report.

In the UI, the provider **Models** tab shows capability icons, context-window limit, and input/output price per model; selecting a model opens its detail page (context window, max output, effective pricing with overrides applied, capabilities, and 7-day usage).

## Per-model pricing overrides

Overrides replace catalog rates for one model on one provider, for negotiated rates, internal chargeback, or models the catalog does not price. They change what ADP cost reporting computes, not what the upstream charges.

**UI:** the pencil icon (Override pricing) on a model in the picker or on the **Models** tab. Rates are in **US dollars per million tokens**; a blank field keeps the catalog rate, `0` is an explicit free rate; **Reset** / **Reset all** clear overrides. Overridden models carry a dollar-sign badge.

**CLI:** the repeatable `--pricing` flag on `create` / `update`, in USD per million tokens:

```bash
rpk ai llm-provider update openai \
  --pricing "model=<model-a>,input=<usd>,output=<usd>,cached=<usd>" \
  --pricing "model=<model-b>,input=<usd>,output=<usd>"
```

| `--pricing` key | UI bucket | Bills |
|---|---|---|
| `model` (required) | — | Model the entry applies to |
| `input` | Input | Prompt tokens; also tool-use input |
| `output` | Output | Completion tokens; also reasoning tokens |
| `cached` | Cached input | Prompt-cache reads |
| `cache_write_5m` | Cache write (5-minute TTL) | 5-minute cache writes |
| `cache_write_1h` | Cache write (1-hour TTL) | 1-hour cache writes |

Omitted rates keep the catalog default; set at least one rate per model. `--pricing` merges into `--provider-models` by model name, and **on `update` it replaces the whole model list**, so include every model the provider should keep. Cache writes with an unknown TTL always bill at the catalog rate.

**In manifests and `get -o yaml`**, overrides appear as `provider_models[].custom_pricing` with fields `input_per_million`, `output_per_million`, `cached_input_per_million`, `cache_creation_5m_per_million`, `cache_creation_1h_per_million`, stored in **microcents** per million tokens (not dollars). Prefer `--pricing`, which converts for you; if you hand-write `custom_pricing`, use microcents. See [rpk-ai.md](rpk-ai.md).

## What the AI Gateway proxy does

The AI Gateway is a managed HTTP proxy. Each provider has its own URL (copy it from the provider's **Proxy URL** or from the `url` field of `rpk ai llm-provider get`):

```
<gateway-base>/llm/v1/providers/<provider-name>/<upstream-path>
```

- Clients keep using the provider's native SDK and API, pointed at the proxy URL.
- Upstream keys stay in the Redpanda secret store; applications never see them (except passthrough, where the client supplies its own).
- The gateway injects the credential per request (API key, SigV4 signing for Bedrock, or the caller's passthrough `Authorization`).
- Inbound clients authenticate with short-lived tokens: `rpk ai auth login` / `rpk ai auth token` for local use, OIDC client credentials for applications and self-managed agents.
- Spend, requests, and tokens are recorded per provider (list view, provider Overview, **Cost and usage**).
- Optionally captures message bodies — on by default for new providers; see [Transcript recording defaults to ON](#transcript-recording-defaults-to-on).
- Optionally evaluates an attached guardrail before forwarding. On non-Bedrock providers, guardrail evaluation sends prompt and response text to AWS Bedrock Guardrails, even when the provider itself is self-hosted.

## Not in scope

The ADP gateway overview and provider docs list these as not provided by AI Gateway:

- **Multi-provider routing, failover, and retries.** There is no synthetic provider that fans requests across upstreams, and no cross-provider load balancing.
- **Rate limits.** No requests-per-second, per-minute, or per-day caps. To cap spend instead, use budgets (per-agent hard caps; see [governance.md](governance.md)). Budgets apply only to agent-attributed requests, so a user calling the gateway directly is not capped.

Do not try to configure routing, failover, load balancing, or request rate limits through `rpk ai` or the UI; the features do not exist.
