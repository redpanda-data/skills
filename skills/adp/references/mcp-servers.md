Source: `cloudv2 apps/rpai/testdata/commands-snapshot.md` (`mcp-server`, `mcp-server create`, `mcp-server tools list|call`, `mcp-server types`, `mcp-server get` and error sections), `adp-docs modules/connect/pages/create-server.adoc`, `data-policies.adoc`, `user-delegated-oauth.adoc`, `remote-mcp-clients.adoc`, `oauth-providers.adoc`, `managed/slack.adoc`, `managed/managed-catalog.adoc`, `adp-docs modules/gateway/pages/code-mode.adoc` — verified 2026-09-23. The per-method `user_oauth` gating and `response_format` fail-open behavior are carried forward from the earlier source-verified revision and cross-checked against `user-delegated-oauth.adoc` and `create-server.adoc` on 2026-09-23.

# Agentic Data Plane MCP Servers Reference

**Maturity:** Redpanda Agentic Data Plane is generally available. The `rpk ai` CLI is Preview. Output format and data policies are Preview capabilities, and individual managed types carry their own maturity badges in the managed catalog; confirm the badge in the UI or docs rather than assuming GA.

Audience: an AI agent operating Agentic Data Plane MCP servers through `rpk ai mcp-server` and the ADP UI (ai.redpanda.com), and connecting MCP clients to them.

Related references: [SKILL.md](../SKILL.md), [agents.md](agents.md), [gateway-and-providers.md](gateway-and-providers.md), [governance.md](governance.md), [rpk-ai.md](rpk-ai.md), [observability.md](observability.md).

For the separate `rpk cloud mcp` control-plane server, see /redpanda:rpk-cloud.

## Discover the live surface

```bash
rpk ai mcp-server --help                    # aliases: mcp-servers, mcp
rpk ai mcp-server create --help             # flags grouped by backend (remote.*, managed.*)
rpk ai mcp-server list                      # NAME, TYPE, URL, ENABLED
rpk ai mcp-server get <name> -o yaml        # full manifest, including data policies
rpk ai mcp-server types                     # managed types available to you (-o wide adds type URLs)
rpk ai mcp-server tools list <name>         # live tools/list through the gateway
rpk ai mcp-server tools call <name> <tool> --args '{"k":"v"}'
```

In the UI: **MCP servers** in the sidebar → **Add MCP server**. A server's detail page has **Overview**, **Data Policies**, **Connection** (the `Server URL`, the `Code mode URL`, and client snippets), and **Inspector** tabs, plus **Access** and **Activity** where enabled.

## Commands

| Command | Purpose |
|---|---|
| `create NAME` | Create a server; the name is positional (`--name` is rejected as an unknown flag) |
| `get NAME` / `list` | Read one (`-o yaml` for the manifest) / list all |
| `update NAME` | Change only the flags you pass; list/map flags replace wholesale |
| `delete NAME` | Delete the record |
| `types` | Managed types you can create |
| `tools list NAME` / `tools call NAME TOOL` | Call `tools/list` / a tool through the gateway, with the same auth and per-user token path a client uses. `--code-mode` targets the code-mode endpoint |
| `apply -f` / `diff -f` | GitOps reconcile / dry-run (see [rpk-ai.md](rpk-ai.md)) |

`create` and `update` also accept `-f <manifest>` (flags override file values) and `--dry-run` (print the request, including the computed update mask, without sending it).

A missing server reads `Error: MCP server not found (use 'rpk ai mcp-server list' to see what's available)` followed by `Code: not_found`. An invalid enum value lists the valid ones, for example `--remote.transport: invalid value "websocket"; valid values: sse, streamable-http`.

## Server fields

As they appear in flags and `get -o yaml`:

| Field | Flag | Notes |
|---|---|---|
| `name` | positional | 1–63 characters, lowercase letter first, then lowercase letters, digits, hyphens. Immutable; it is the URL path segment. To rename, delete and recreate |
| backend | `--remote.*` or `--managed.config` | Remote (a server you host, proxied by the gateway) or managed (hosted by Redpanda). The flag group you use selects it; mixing groups is an error. Immutable |
| `enabled` | `--enabled` | **The CLI creates a server disabled unless you pass `--enabled`**; the UI creates it enabled. A disabled server rejects every request, connection attempts included |
| `description` | `--description` | Up to 256 characters |
| `tags` | `--tags key=value` (repeatable) | Up to 50 pairs, values up to 256 characters; for filtering and tag-based access-policy conditions. An update replaces the whole map. No UI field. No secrets or PII |
| `code_mode` | `--code-mode` | See [Code mode](#code-mode) |
| `response_format` | `--response-format jton\|toon` | See [Output format](#output-format-token-optimization). Omitted = JSON |
| `data_policies` | `--data-policies` (repeatable) | See [Data policies](#data-policies-preview). Returned by `get`, omitted by `list` |
| `url` | read-only | `<gateway-base>/mcp/v1/<name>`, the endpoint MCP clients connect to |
| `tools` | read-only | Populated by a live `tools/list` when you `get` a server |

Remote servers take `--remote.url` (alias `--url`) and `--remote.transport` (alias `--transport`): `streamable-http` (recommended for new servers) or `sse`. Service-account OAuth and user-delegated OAuth generally require an HTTPS URL.

## Remote auth modes

A remote server uses exactly one of five auth modes; the flag group you set selects it. Managed types show only the modes that make sense for that type (SQL, for example, never offers user OAuth) and carry their auth shape inside `--managed.config`.

| Mode | UI label | CLI flags | Behavior |
|---|---|---|---|
| None | `No Authentication` | `--remote.none` | Unauthenticated upstream |
| Token passthrough | `Token Passthrough` | `--remote.token-passthrough` | Forwards the caller's `Authorization` header upstream unchanged |
| Static key | `Static Key` | `--remote.static-key.key-secret-ref`, optional `--remote.static-key.header-name` (default `Authorization`) | One shared API key from the secret store. The field is `key_secret_ref` (UI label `Key reference`); some docs call it `key_ref`, which is wrong |
| Service-account OAuth | `OAuth (Service Account)` | `--remote.service-account-oauth.client-id`, `.client-secret-ref`, `.token-url`, `.scopes` | Client-credentials flow; every caller shares one upstream identity |
| User-delegated OAuth | `User OAuth (Per-User Delegated)` | `--remote.user-oauth.provider-name`, `.required-scopes`, `.injection.header-name` (default `Authorization`), `.injection.header-prefix` (default `Bearer`; empty for none), `.client-id`, `.client-secret-ref`, `.automatic-setup` | Each end user connects their own upstream account; the gateway injects that user's token per call |

Secret references are `UPPER_SNAKE_CASE` names in the ADP secret store, never the secret value.

**User-delegated OAuth setup.** Name an existing OAuth provider with `--remote.user-oauth.provider-name`, or leave it empty to have the gateway set OAuth up automatically from the server URL. `--remote.user-oauth.client-id` / `.client-secret-ref` are only for automatic setup against a server without dynamic client registration (the secret only for a confidential app). On `update`, `--remote.user-oauth.automatic-setup` re-runs automatic setup instead of keeping the attached provider; do not combine it with a provider name. A connection with fewer scopes than `--remote.user-oauth.required-scopes` fails with `scope_upgrade_required`. See [governance.md](governance.md) for OAuth providers and connections.

**Before a user connects**, `rpk ai mcp-server get <name>` on a user-OAuth server prints the authorize link instead of a tool list:

```
Tool discovery requires OAuth connection to "<provider>".
Connect: <gateway-base>/oauth/v1/authorize?provider_name=<provider>&scopes=...
```

### What a caller without a connection can do (`user_oauth`)

A client pointed at a user-OAuth server's gateway URL (Claude Code, Cursor, an agent at startup) is not refused wholesale before the user connects. Behavior differs by JSON-RPC method:

| Method group | Methods | Without a usable connection |
|---|---|---|
| Session setup and liveness | `initialize`, `notifications/initialized`, `notifications/cancelled`, `ping` | Always proceed; a client can open the session before connecting |
| Capability listing | `tools/list`, `resources/list`, `resources/templates/list`, `prompts/list` | **Managed** servers answer from the schema Redpanda holds for the type, the same for every user — except a managed type whose tool list depends on the signed-in user, which needs a connection first. **Remote** servers: a connected caller gets their own per-user list; a caller without a connection is forwarded token-less, and the upstream decides whether to answer |
| Reading content or acting | `tools/call`, `resources/read`, `prompts/get`, `resources/subscribe`, `completion/complete`, and any other method | Refused until the user connects. The refusal is an `isError` tool result whose **text** carries the authorize URL |

Consequences:

- **The tool list is not proof of access.** Expect listing to succeed and the first call to come back asking the user to sign in.
- **Read the authorize link from the tool result's text**, not from an error status or the `isError` bit: some MCP clients surface only the result content.
- **Only sign-in-fixable failures** (no connection, an expired one, a missing scope) open the token-less listing path. An unresolvable provider, an unreachable token store, or a connection that does not verify fails listings too. So a `tools/list` that fails **hard** on a user-OAuth remote server is an infrastructure or configuration problem, **not** a missing user connection — do not prompt the user to sign in.

A connected caller is not automatically the *acting* identity: on a managed connector the provider can decide that, and for Slack it does — see [below](#user-delegated-oauth-on-a-managed-connector-whose-identity-acts).

## Connecting clients

A client connects to the `Server URL` on the **Connection** tab (`<gateway-base>/mcp/v1/<name>`), whose **Install in an AI client** card has ready-to-paste snippets. The gateway reports routing problems on the connection itself, so the client shows the reason:

- `MCP server "<name>" not found` — no server by that name in this environment.
- `MCP server "<name>" is disabled` — turn the **Enabled** toggle on, or `rpk ai mcp-server update <name> --enabled`.
- `MCP server "<name>" does not have code mode enabled` — the client used the `-code` URL of a server without code mode.

## Code mode

Turn on **Enable code mode** in the UI, or pass `--code-mode`, to serve a **second endpoint** for the server: the server URL with a `-code` suffix (`Code mode URL` on the Connection tab). The primary endpoint is unchanged. The code-mode endpoint exposes exactly two tools instead of the full catalog:

| Tool | Behavior |
|---|---|
| `search` | Optional `query`, a Go RE2 regex matched against tool names and descriptions; returns each match's full schema, or null. Omitting the query returns the whole catalog, so use a narrow regex |
| `execute` | Runs JavaScript in a sandbox with synchronous host functions `call_tool({name, arguments})` (throws on a tool error; parses JSON output) and `search_tools(query)`. The value of the last expression is the result |

Sandbox limits: code up to 64 KiB, at most 50 tool calls per `execute`, plus memory and runtime limits. Do not `await` the host functions; top-level `await` and `return` are syntax errors, promises are not awaited, and `console.log` output is discarded. Calls made through code mode run with the server's own identity and auth, including per-user tokens; code mode never widens what the server can reach.

The `--code-mode` flag help still describes `{name}_search` / `{name}_execute` tools added alongside the existing ones; the product docs describe the separate `-code` endpoint with bare `search` and `execute`. Trust the docs, and confirm with `rpk ai mcp-server tools list <name> --code-mode`.

```bash
rpk ai mcp-server tools list <server> --code-mode
rpk ai mcp-server tools call <server> search --code-mode --args '{"query":"(?i)pull.*create"}'
rpk ai mcp-server tools call <server> execute --code-mode \
  --args '{"code":"var r = call_tool({name:\"query\", arguments:{query:\"SELECT 1\"}}); JSON.stringify(r);"}'
```

Code mode is per server: it is a token-reduction technique for one server with many tools, not a way to combine servers behind one endpoint. The UI create form turns it on by default for some managed types; `rpk ai mcp-server create` leaves it off unless you pass `--code-mode`.

**Token reduction.** Deferring tool loading this way substantially reduces token usage on tool-heavy configurations; measure it for your own workload rather than assuming a figure.

**Tool name truncation.** MCP limits tool names to 64 characters. For managed types whose generated names exceed it, the prefix is truncated and replaced with a hash (for example `64ghux5adn_github_read_v1_GitHubReadService_GetAuthenticatedUser`). The method name is always preserved, so the short tool name an agent sees (for example `get_authenticated_user`) stays stable. This only matters when correlating logs or transcripts with full tool names.

## Output format (token optimization)

Preview. A server's output format selects how its tool results are encoded before the agent reads them. UI: **Output format → Encoding**. CLI: `--response-format jton|toon`; omitted means JSON.

| Encoding | Effect |
|---|---|
| JSON (default) | Results forwarded unchanged |
| JTON | Re-encodes tabular JSON (arrays of homogeneous objects) into a compact JSON superset |
| TOON | A leaner indentation-based encoding that also compacts nested objects |

Both are lossless re-encodings and never change the data. Behavior a caller sees:

- **Applies to managed and remote servers**, on either transport.
- **Whole-server**, not per-tool; non-tabular results simply pass through.
- **The code-mode endpoint inherits the server's format.**
- **`tools/list` drops `outputSchema`** on an opted-in server, because the encoding strips the duplicate structured content a schema would promise. Expect no structured-output contract there; the data arrives in the encoded text block.
- **It fails open, never closed.** Anything that cannot be safely re-encoded is forwarded unchanged: non-JSON text, error results, results the encoding would not shrink, very large results, and anything that does not round-trip exactly (high-precision decimals are a known case).

The selected encoding may not be active on every gateway; until it is, results are forwarded as JSON. Because passthrough is silent and shape-dependent, treat the format as a best-effort optimization, not a guaranteed wire format; check actual output with `rpk ai mcp-server tools call` before relying on it. In a GitOps manifest an omitted `response_format` reconciles the server back to JSON.

## Data policies (preview)

Data policies shape a server's tool traffic before the model sees it: mask, redact, hash, or drop result fields; restrict tool-call argument values; and filter elements out of list results. They apply to managed and remote servers, compose **most-restrictively** across every matching policy, and **fail closed** (a rule that cannot be enforced denies matching calls). Each policy names the `tools` it shapes and the `principals` (`User:<email>`) it applies to; an empty list means all. Data policies decide *how data looks*; access policies decide *whether* a call runs.

- **UI:** server → **Data Policies** tab. Pick a tool, click **New policy**, choose **Keep / Mask / Drop** per field, or edit the rules as YAML.
- **Preview before saving (UI):** the **Configuration** tab shows the composed effect for the selected tool across all of the server's policies, including unsaved edits, with each field's winning treatment. The **Preview** tab runs editable sample data (seeded from the tool's schema) through the rules and shows before/after for both the request and the response, with counts of masked, dropped, and filtered items, and a banner when matching calls would be denied. There is no CLI preview command.
- **CLI:** `--data-policies` on `create` / `update` takes one policy per flag as a JSON object and **replaces the server's whole list**, so pass every policy the server should keep. This is also the only way to make one policy shape several tools. Read policies with `rpk ai mcp-server get <name> -o yaml`; `list` omits them.
- Rules written in YAML or via `--data-policies` are **strict** unless marked absence-safe: a strict mask or drop whose selector matches nothing denies the call. Rules created in the UI form default to absence-safe.

For the transform vocabulary (mask methods, selectors, allowlist mode, argument limits, row filters), limitations, and audit-log outcomes, see [governance.md](governance.md).

## Managed catalog

A managed server connects to a service Redpanda hosts in-process: for example databases (SQL, MongoDB), work and messaging tools (Slack, Jira), and cloud services (AWS SNS, SQS). The set available to you changes, so never enumerate it from memory:

- `rpk ai mcp-server types` lists the short type names; `-o wide` adds each type's full type URL.
- The UI **Add MCP server** picker shows the same types as cards, with maturity badges.

Create one with `--managed.config`, JSON whose `@type` is a short name from `types` or a full type URL:

```bash
rpk ai mcp-server create my-sql --enabled \
  --managed.config '{"@type":"SQLMCP","driver":"sqlite3","dsn":":memory:"}'
```

Type-specific fields (including a `userOauth` block for types that support user-delegated OAuth) differ per type; take them from the type's setup guide or the UI form.

### User-delegated OAuth on a managed connector: whose identity acts

On a managed connector that supports user-delegated OAuth, the per-user connection decides **which** stored credential is used, not necessarily **whose identity** the upstream call carries. Slack is the case where these differ, because one Slack authorization can issue both a bot token and a user token. The acting identity is fixed by the OAuth provider's **Slack OAuth token type** (`slack_token_type`), not by who owns the connection:

- **`Bot User OAuth Token`** (the default, and what providers created before the setting existed keep): tools post, read, and react **as the app's bot user**, even on a user-OAuth server.
- **`User OAuth Token`**: tools act **as the person who authorized**. Offered only when the provider uses Slack's standard OAuth v2 authorize and token endpoints, so not on a provider set up by discovery.
- The setting is chosen at provider creation and is immutable, so serving both identities means two providers (they can share one Slack app). See [governance.md](governance.md#slack-whose-identity-the-connection-acts-as-slack_token_type).

Some Slack tools accept only one identity: search needs a user token, and a bot token comes back as `not_allowed_token_type` or `user_token_required`. That is a provider token-type problem, not a missing connection or scope.
