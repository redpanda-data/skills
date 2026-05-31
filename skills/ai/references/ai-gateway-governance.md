# AI Gateway Governance and Security (Enterprise)

The Redpanda **AI Gateway** is part of Redpanda Cloud, which is a managed deployment of **Redpanda Enterprise Edition**. Its governance, security, and cost-control surfaces are the AI-domain enterprise differentiators exposed to AI agents through `rpk cloud mcp` (the `ai_gateway_url`-scoped tool groups) and through the `rpk ai` (`rpai`) plugin CLI.

> License note: Redpanda Cloud always runs Enterprise Edition. Self-managed analogues of these governance primitives (Audit Logging, RBAC, OIDC/OAuthBearer authentication) require a valid Enterprise license — see `references/enterprise-self-managed.md`.

Source (proto/generated):
- `cloudv2/proto/gen/go/redpanda/api/aigateway/v1/*.pb.go`
- `cloudv2/apps/aigw/docs/rfcs/0011-guardrails/guardrails.proto`

All field names below are the proto `json` names verified from the generated code — they are the keys an MCP tool call (or `rpai` request body) carries.

---

## Guardrails (`GuardrailService`)

Content/word filtering applied to AI Gateway requests and responses. MCP tools: `CreateGuardrail`, `GetGuardrail`, `ListGuardrails`, `UpdateGuardrail`, `DeleteGuardrail`.

`Guardrail` message fields:

| Field | Notes |
|-------|-------|
| `name` / `guardrail_id` | Resource identity |
| `display_name`, `description` | Human-facing labels |
| `enabled` | Toggle the guardrail on/off |
| `type` | Guardrail type |
| `filter` | Filter selector for which traffic the guardrail applies to |
| `match_expression` | Expression that selects matching requests |
| `patterns`, `value`, `case_sensitive`, `action` | Pattern-match rule config |
| `metadata`, `order_by`, `create_time`, `update_time` | Standard resource fields |

### Word filter rules (`WordFilterRule` / `WordFilter`)

| Field | Notes |
|-------|-------|
| `words` | Word list to match |
| `regex` | Treat `words` as regular expressions |
| `mask_replacement` | Replacement string when masking |
| `input` / `output` (`DirectionConfig`) | Per-direction `action` (`ACTION_BLOCK`, mask, etc.) |
| `blocked_input_message`, `blocked_output_message` | Payload substituted when blocked |
| `rules`, `managed_rules` | Custom rules + managed word lists (`ManagedWordsFilterRule.list`) |

### Content filter rules (`ContentFilterRule` / `ContentFilter`)

Per-category toggles, each an optional `ContentFilterRule` with `input`/`output` `DirectionConfig` carrying `strength` (`FilterStrength`), `action`, and `modalities` (`Modality`):

`violent_crimes`, `non_violent_crimes`, `sex_related_crimes`, `child_sexual_exploitation`, `defamation`, `specialized_advice`, `privacy`, `intellectual_property`, `indiscriminate_weapons`, `hate`, `suicide_and_self_harm`, `sexual_content`, `elections`, `code_interpreter_abuse`.

---

## Rate Limits (`RateLimitService`)

Throttle request volume per key. MCP tools: `CreateRateLimit`, `GetRateLimit`, `ListRateLimits`, `UpdateRateLimit`, `DeleteRateLimit`.

`RateLimit` message fields:

| Field | Notes |
|-------|-------|
| `name`, `display_name`, `description`, `enabled` | Identity / toggle |
| `expression` | Selector for matching requests |
| `key_extractor` | How the throttle key is derived (e.g. per user/team/account) |
| `requests_per_second` | Per-second cap |
| `requests_per_minute` | Per-minute cap |
| `requests_per_day` | Per-day cap |
| `filter`, `metadata`, `order_by`, `create_time`, `update_time` | Standard resource fields |

---

## Spend Limits (`SpendLimitService`)

Cost guardrails with alerting and enforcement. MCP tools: `CreateSpendLimit`, `GetSpendLimit`, `ListSpendLimits`, `UpdateSpendLimit`, `DeleteSpendLimit`, `GetSpendLimitUsage`.

`SpendLimit` message fields:

| Field | Notes |
|-------|-------|
| `name`, `display_name`, `description`, `enabled`, `type` | Identity / toggle / limit type |
| `limit_cents` | Hard spend cap (in cents) |
| `tokens_per_minute`, `tokens_per_day` | Token-based ceilings |
| `window`, `size_seconds` | Rolling-window definition |
| `alert_thresholds` | Percentage thresholds that fire alerts |
| `action` | Action when the limit is hit |
| `key_extractor`, `key_value`, `match_expression`, `filter` | Scoping of the limit |

`SpendLimitUsage` (returned by `GetSpendLimitUsage`): `current_spend_cents`, `percentage_used`, `is_exceeded`, `reset_at`, `window_start`, `window_end`.

---

## Routing rules (`RoutingService`)

Route gateway traffic to backend pools with fallback. MCP tools: `CreateRoutingRule`, `GetRoutingRule`, `ListRoutingRules`, `UpdateRoutingRule`, `DeleteRoutingRule`.

`RoutingRule` message fields:

| Field | Notes |
|-------|-------|
| `name`, `display_name`, `description`, `enabled` | Identity / toggle |
| `expression` | Match expression selecting requests |
| `backend_pool` | Target `BackendPool` (managed by `BackendPoolService`) |
| `fallback_pool` | Pool used when the primary is unavailable |
| `priority` | Evaluation order among rules |
| `filter`, `metadata`, `create_time`, `update_time` | Standard resource fields |

---

## Model Providers (`ModelProvidersService`)

Register upstream LLM providers. MCP tools: `GetModelProvider`, `ListModelProviders`, `EnableModelProvider`, `DisableModelProvider`, `UpdateModelProvider`.

`ModelProvider` message fields:

| Field | Notes |
|-------|-------|
| `name`, `display_name`, `description`, `enabled` | Identity / toggle |
| `base_url`, `path_rewrite` | Upstream endpoint + path mapping |
| `auth_type`, `auth_header`, `extra_headers` | Auth scheme + headers |
| `openai_compat`, `openai_native` | API-compatibility flags |
| `request_transforms`, `response_transforms` | Payload transforms |
| `data_policy`, `data_region`, `data_retention_days` | Data-governance metadata |
| `certifications`, `headquarters`, `logo_url`, `website_url` | Provider metadata |
| `disabled_models_count`, `creator`, `updater` | Output-only status |

Individual models are managed by `ModelsService` (`CreateModel`, `EnableModel`, `DisableModel`, `ListDisabledModels`, ...) and priced via `ModelPricingService` (`GetStandardPrice`, `CreateCustomPrice`, `GetEffectivePrice`, `ListPriceHistory`, ...).

---

## Access Control / RBAC policies (`AccessControlService`)

Policy-based authorization for gateway resources. MCP tools: `CreatePolicy`, `GetPolicy`, `ListPolicies`, `UpdatePolicy`, `DeletePolicy`, `ValidatePolicy`, `EvaluateAccess`, `GetPolicyEntities`, `ListPolicyVersions`.

`Policy` message fields:

| Field | Notes |
|-------|-------|
| `name`, `policy_id`, `display_name`, `description`, `enabled` | Identity / toggle |
| `policy_text`, `policy_type` | Policy body + dialect |
| `principal`, `principal_types` | Who the policy applies to |
| `resource`, `resource_types` | What it governs |
| `action`, `action_types`, `effect` | Allow/deny semantics |
| `priority`, `attributes`, `context` | Evaluation inputs |

`ValidatePolicy` returns `valid`, `errors` (with `line`/`column`/`message`), `diagnostics`. `EvaluateAccess` returns `allowed`, `decision`, `determining_policies`, `change_reason`.

### Roles and Teams (`RoleService`, `TeamService`)

- `RoleService`: `CreateRole`, `AssignTeamRole`, `UnassignTeamRole`, `ListTeamRoles`, `ListRoleTeams`. `Role` fields include `name`, `display_name`, `description`, `assignment`/`assignments` (`assigned_at`, `assigned_by`).
- `TeamService`: `CreateTeam`, `AddTeamMember`, `ListTeamMembers`, `UpdateTeamMember`. `Team` fields include `name`, `enabled`, `membership`/`memberships` (`user`, `role`).

---

## Audit Logging (`AuditService`)

Enterprise audit trail for the AI Gateway. MCP tools: `GetAuditLog`, `ListAuditLogs`.

`AuditLog` fields (OCSF-aligned): `audit_log`/`audit_logs`, `activity`, `activity_id`, `actor`, `actor_id`, `email`, `session`, `entity`, `entity_type`, `entity_result`, `class_uid`, `category_uid`, `severity`, `severity_id`, `gateway_id`, `field`, `old_value`, `new_value`, `comment`, `start_time`/`end_time` (query window), `data`.

> Audit Logging is an Enterprise feature. In self-managed Redpanda it is gated by the cluster config `audit_enabled` (see `references/enterprise-self-managed.md`).

---

## SSO / OIDC / OAuth2 authentication (`SSOService`, `OAuth2ClientService`, `OAuth2KeyService`)

Enterprise SSO for the AI Gateway. MCP tools include `CreateIdentityProvider`, `AddDomain`, `VerifyDomain`, `LookupIdPByEmail`, `TestCredentials`.

`IdentityProvider` / OIDC config fields:

| Field | Notes |
|-------|-------|
| `identity_provider_id`, `display_name`, `enabled` | Identity / toggle |
| `auth_method`, `oidc_config` | Auth method + OIDC block |
| `issuer_url`, `authorization_endpoint`/`authorization_url`, `jwks_uri`, `login_url` | OIDC endpoints |
| `client_id`, `client_secret`, `allowed_audiences` | OAuth client config |
| `email_claim`, `name_claim`, `given_name_claim`, `family_name_claim`, `custom_claims`, `claim_mappings` | Claim mapping |
| `domain`/`domains`, `email_domain`, `auto_link_enabled`, `jit_provisioning` | Domain binding + JIT provisioning |
| `default_organization`, `default_role`, `allow_password_login`, `filter_enabled` | Defaults / fallback |

OAuth2 clients (`OAuth2ClientService`): `client_id`, `client_secret`, `client_type`, `grant_types`, `redirect_uris`, `scopes`, `owner`, `expires_at`, `last_used_at`. Signing keys (`OAuth2KeyService`): `CreateOAuth2Key`, `RotateOAuth2Keys`, `DeactivateOAuth2Key`, `GetJWKS`.

> OIDC / OAuthBearer authentication is an Enterprise feature in self-managed Redpanda (configured via `sasl_mechanisms`/`http_authentication`).

---

## FIPS interaction

The `rpk ai` (`rpai`) plugin **does not ship a FIPS build**. On a FIPS-enabled `rpk`, any `rpk ai` subcommand that triggers a download fails with `the Redpanda AI CLI is not yet available in FIPS mode`. Use a non-FIPS `rpk` build for the AI plugin. See `references/rpk-ai.md`. (FIPS Compliance itself is an Enterprise feature; in self-managed Redpanda it is the node config `fips_mode`.)
