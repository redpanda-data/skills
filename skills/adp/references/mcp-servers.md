Source: `cloudv2 apps/rpai/testdata/commands-snapshot.md` (`mcp-server` group), `adp-docs modules/connect/pages/` (`create-server.adoc`, `data-policies.adoc`, `user-delegated-oauth.adoc`, `remote-mcp-clients.adoc`, `oauth-providers.adoc`, `managed/`), `modules/gateway/pages/code-mode.adoc`, `modules/control/pages/` (`access-policies.adoc`, `tags.adoc`). Full per-claim mapping and the dated verification log: the `references/mcp-servers.md` rows of `SOURCES.md`.

# Agentic Data Plane MCP Servers Reference

**Maturity:** Output format, data policies and the Google Identity-Aware Proxy setting are Preview, and individual managed types carry their own maturity badges in the managed catalog; confirm the badge in the UI or docs rather than assuming GA.

For the separate `rpk cloud mcp` control-plane server, see /redpanda:rpk-cloud.

## Discover the live surface

```bash
rpk ai mcp-server --help                  # aliases: mcp-servers, mcp
rpk ai mcp-server create --help           # flags grouped by backend (remote.*, managed.*)
rpk ai mcp-server get <name> -o yaml      # full manifest, including data policies
rpk ai mcp-server types                   # managed types available to you (-o wide adds type URLs)
rpk ai mcp-server tools list <name>       # live tools/list through the gateway
rpk ai mcp-server ping <name>             # negotiated protocol version and advertised capabilities
rpk ai mcp-server resources list <name>   # also resource-templates, prompts
rpk ai mcp-server sql-exposure <name>     # also sql-sources, test-sql-exposure
```

In the UI: **MCP servers** in the sidebar → **Add MCP server**. On a server's page, **Connection** carries the `Server URL`, the `Code mode URL` and client snippets, **Data Policies** the data shaping, and **Inspector** the live tool view the protocol commands above also reach.

## Commands

| Command | Purpose |
|---|---|
| `create NAME` | Create a server; the name is positional (`--name` is rejected as an unknown flag) |
| `get NAME` / `list` | Read one (`-o yaml` for the manifest) / list all |
| `update NAME` | Change only the flags you pass; list/map flags replace wholesale |
| `delete NAME` | Delete the record |
| `types` | Managed types you can create |
| `tools list NAME` / `tools call NAME TOOL` | Call `tools/list` / a tool through the gateway, with the same auth and per-user token path a client uses. `--code-mode` targets the code-mode endpoint |
| `ping NAME` | Open a session and report the negotiated MCP protocol version and the capabilities the server advertises. **Start here when a server misbehaves:** a server that answers `ping` is reachable and authenticated |
| `resources list/read`, `resource-templates list`, `prompts list/get` | Browse and read what the server serves besides tools — the same surface the UI's **Inspector** tab shows |
| `sql-exposure NAME`, `sql-sources`, `test-sql-exposure NAME` | Inspect a server's SQL exposure, list its SQL sources, and run a read-only exposure test (see [SQL table exposure](#sql-table-exposure-on-a-managed-connector)) |
| `preview-data-policies NAME`, `preview-tool-response NAME` | Preview the data policies in force on a tool, and what they do to a tool response, without calling the tool |
| `google-identity NAME` | Print the identity the gateway mints Google ID tokens with, and the `gcloud` commands that trust it (see [Google Identity-Aware Proxy](#google-identity-aware-proxy-and-cloud-run-preview)) |
| `apply -f` / `diff -f` | GitOps reconcile / dry-run (see [rpk-ai.md](rpk-ai.md)) |

`create` and `update` also accept `-f <manifest>` (flags override file values) and `--dry-run` (print the request, including the computed update mask, without sending it).

**A server serves only what it advertises**, so `resources`, `resource-templates` and `prompts` against a capability it does not offer fail saying so rather than returning an empty list — "empty" and "not offered" are different answers. `resources read` goes *through* the server and never fetches the URI itself. The `list` commands return one page: pass their `nextCursor` back as `--cursor`.

A missing server reads `Error: MCP server not found (use 'rpk ai mcp-server list' to see what's available)` followed by `Code: not_found`. An invalid enum value lists the valid ones, for example `--remote.transport: invalid value "websocket"; valid values: sse, streamable-http`.

## Server fields

As they appear in flags and `get -o yaml`:

| Field | Flag | Notes |
|---|---|---|
| `name` | positional | 1–63 characters, lowercase letter first, then lowercase letters, digits, hyphens. Immutable; it is the URL path segment. To rename, delete and recreate |
| backend | `--remote.*` or `--managed.config` | Remote (a server you host, proxied by the gateway) or managed (hosted by Redpanda). The flag group you use selects it; mixing groups is an error. Immutable |
| `enabled` | `--enabled` | **The CLI creates a server disabled unless you pass `--enabled`**; the UI creates it enabled. A disabled server rejects every request, connection attempts included |
| `description` | `--description` | Up to 256 characters |
| `tags` | `--tags key=value` (repeatable) | Up to 50 pairs, values up to 256 characters; for filtering and tag-based access-policy conditions. An update replaces the whole map. The UI has a **Tags** section too, last on the create form and on the edit form. No secrets or PII (see [governance.md](governance.md#tags-on-adp-resources)) |
| `code_mode` | `--code-mode` | See [Code mode](#code-mode) |
| `response_format` | `--response-format jton\|toon` | See [Output format](#output-format-token-optimization). Omitted = JSON |
| `data_policies` | `--data-policies` (repeatable) | See [Data policies](#data-policies-preview). Returned by `get`, omitted by `list` |
| `url` | read-only | `<gateway-base>/mcp/v1/<name>`, the endpoint MCP clients connect to |
| `tools` | read-only | Populated by a live `tools/list` when you `get` a server |

Remote servers take `--remote.url` (alias `--url`) and `--remote.transport` (alias `--transport`): `streamable-http` (recommended for new servers) or `sse`. Service-account OAuth and user-delegated OAuth generally require an HTTPS URL.

## Remote auth modes

A remote server uses exactly one of five auth modes; the flag group you set selects it. A managed type configures authentication inside its own `--managed.config` instead: it may offer some of the same modes, showing only those that make sense for the type (SQL, for example, never offers user OAuth), and the AWS types use none of them (see [Managed catalog](#managed-catalog)).

| Mode | UI label | CLI flags | Behavior |
|---|---|---|---|
| None | `No Authentication` | `--remote.none` | Unauthenticated upstream |
| Token passthrough | `Token Passthrough` | `--remote.token-passthrough` | Forwards the caller's `Authorization` header upstream unchanged |
| Static key | `Static Key` | `--remote.static-key.key-secret-ref`, optional `--remote.static-key.header-name` (default `Authorization`) | One shared API key from the secret store. The field is `key_secret_ref` (UI label `Key reference`); some docs call it `key_ref`, which is wrong |
| Service-account OAuth | `OAuth (Service Account)` | `--remote.service-account-oauth.client-id`, `.client-secret-ref`, `.token-url`, `.scopes` | Client-credentials flow; every caller shares one upstream identity |
| User-delegated OAuth | `User OAuth (Per-User Delegated)` | `--remote.user-oauth.provider-name`, `.required-scopes`, `.injection.header-name` (default `Authorization`), `.injection.header-prefix` (default `Bearer`; empty for none), `.client-id`, `.client-secret-ref`, `.automatic-setup` | Each end user connects their own upstream account; the gateway injects that user's token per call |

Secret references are `UPPER_SNAKE_CASE` names in the ADP secret store, never the secret value.

**User-delegated OAuth setup.** Name an existing OAuth provider with `--remote.user-oauth.provider-name`, or leave it empty to have the gateway set OAuth up automatically from the server URL. `--remote.user-oauth.client-id` / `.client-secret-ref` are only for automatic setup against a server without dynamic client registration (the secret only for a confidential app). On `update`, `--remote.user-oauth.automatic-setup` re-runs automatic setup instead of keeping the attached provider; do not combine it with a provider name. A connection with fewer scopes than `--remote.user-oauth.required-scopes` fails with `scope_upgrade_required`; the caller clears it by reconnecting and granting the missing scope, and a required scope the OAuth provider does not request keeps failing until the provider asks for it too. See [governance.md](governance.md) for OAuth providers and connections.

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

### Google Identity-Aware Proxy and Cloud Run (Preview)

A remote server behind **Google Identity-Aware Proxy (IAP)**, or a **Cloud Run** service that requires authentication, needs no public endpoint and no service-account key: the gateway presents the gate with a Google-signed ID token for a service account you control. This is **not** a sixth auth mode — it sits *alongside* the server's own authentication, in a different header, and the server still checks its own credential. It also applies to a JavaScript managed server, where the gate protects the backend that server's code calls, not the server itself (which runs inside the gateway).

```bash
rpk ai mcp-server google-identity <name>    # the identity to trust, and the gcloud commands; the server need not exist yet
rpk ai mcp-server create <name> --enabled \
  --remote.url https://internal.example.com/mcp --remote.transport streamable-http \
  --remote.google-identity-aware-proxy.service-account gate@my-project.iam.gserviceaccount.com \
  --remote.google-identity-aware-proxy.audience <oauth-client-id>.apps.googleusercontent.com
```

- **Audience and header both differ by gate.** IAP takes an OAuth client ID it accepts for programmatic access (ending `.apps.googleusercontent.com`) and reads `Proxy-Authorization`, the `header-name` default; Cloud Run takes the service URL or a custom audience and reads `X-Serverless-Authorization`. **The token can't share a header with the server's own credential**, so `Authorization` is admissible only on a server with no authentication of its own, and never on a JavaScript server. The URL must be `https://`.
- **`workload-identity-provider` is required on an AWS-hosted environment and must be empty on a Google Cloud one** — on AWS the gateway federates its own AWS role, on Google Cloud it uses its own service account. Run `google-identity` rather than guessing: it prints the setup for the environment you are pointed at.
- **The blast radius differs by environment.** On AWS the binding trusts **one server's session**, so a second server naming the same service account is refused and needs its own binding. On Google Cloud it trusts the **whole gateway**: anyone who can create or update an MCP server there can get tokens as that service account, so treat that permission as equivalent to acting as it. Either way grant each service account access at **one gate only** — gates in a project commonly share one OAuth client, so the IAM grant is all that scopes the token.
- **In the UI the setting is read-only** on a self-managed server's edit page and saving the form does not change it; use `update`. `get` prints a `Gate:` line naming the service account, audience and header.
- **Verifying differs by server kind.** `tools list` proves the gate admitted the gateway for a *self-managed* server. A **JavaScript** server's tool list comes from its own bundle and never reaches the backend, so it proves nothing — call a tool that fetches a listed host instead. Such a server names the hosts that get the token: up to eight exact hostnames, no wildcards, fetchable without also being in `Allowed Hosts`, token added only to HTTPS requests to a listed host on the default port, never visible to the code.
- **Misconfiguration surfaces at the first token request, not at save.** A missing binding or unenabled API is Google's to detect, so calls fail with **`502 upstream_auth_error`** naming the problem (a JavaScript server's `fetch()` fails with that message). A `user_oauth` server returns `Authorization required` *before* any token is minted, so that error says nothing about the gate. A client's own `Proxy-Authorization` is never forwarded, and the token's header is dropped from any redirect leaving the server's origin.

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

**The AWS types can run with no stored credentials.** The AWS managed types authenticate either with AWS access keys held in the secret store or by **assuming an IAM role you create in the AWS account the environment runs in**, which keeps no AWS credential in ADP at all. The keyless mode needs the gateway to have an AWS identity, so it works only on an environment hosted on AWS and fails elsewhere. These types do not use the remote auth modes above. Read the AWS setup guide for the role, its trust policy, and the per-type configuration.

**A managed type's `readonly` guardrail is the type's own, and the SQL type's now holds both tools to reads.** With `readonly` set, the SQL type disables `execute` outright *and* constrains `query`: it checks the statement text, then runs it in a transaction it never commits (opened read-only on PostgreSQL), so a write that slips past the text check still does not persist — `DELETE … RETURNING` through `query` fails rather than running. The text check is deliberately strict and refuses some legitimate reads: the statement must start with `SELECT`, `WITH`, `SHOW`, `VALUES` or `TABLE` (or `EXPLAIN` of one of those); a `;` other than a trailing one, and any write, DDL, grant, transaction or session-control keyword, is refused **wherever it appears, string literals and comments included**, the `CREATE` in `SHOW CREATE` being the one exception (so `… WHERE action = 'delete'` is refused — pass such values as query parameters, which the check does not read); `VALUE` after `NEXT` is refused (use `LIMIT`, not `FETCH NEXT`); and advisory-lock functions are refused by name, a safeguard rather than a guarantee. With `readonly` unset, `query` runs whatever it is given. Scope the database user's privileges too: grants are the one control that holds however the statement arrives.

### SQL table exposure on a managed connector

Some managed types can present their data as read-only SQL tables in addition to their tools, so an agent can filter records the way it would query a database instead of paging through tool results. It is a per-server setting, **off by default** (UI: the **Enabled** toggle under **Queryable** in the server's configuration; CLI: the type's own field in `--managed.config`), so an existing server gains nothing until someone turns it on. Which types offer it changes, so read the type's configuration form or setup guide rather than assuming.

Turning it on adds two tools to the server:

- `list_tables`: the table catalog — each table's columns and types, which columns can be filtered and with which operators, **whether each filter is exact**, the page-size limit, and a schema fingerprint that every query response repeats, so a caller can tell when the catalog changed.
- `execute_query`: run one query against one table and return a page of rows plus a cursor for the next page. It takes a table, predicates, a projection, a page size, and a cursor — there is no sort.

Behavior to design around:

- **Filters can be supersets.** A filter is offered only where the upstream search never drops a matching row, but most filters can return **extra** rows (case-insensitive matching, widened time bounds), and the rows are returned without being re-checked. An agent that needs exact results re-applies its filters to the rows it receives; `list_tables` marks which filters are exact.
- **A table can require a predicate.** An unfiltered query against such a table is refused before the upstream is called.
- **Paged scans are best-effort.** Page sizes are capped per table, the upstream keeps changing under a multi-page scan, and a cursor is bound to the query that produced it — reusing one with different predicates or against another table is refused rather than quietly restarting.
- **A value list longer than the cap fails** instead of being silently truncated.
- **Authentication is the server's own**, so with user-delegated OAuth a query returns only what the calling user can see. Neither tool writes.
- **A data-policy mask does not hide row membership.** Masking a column that the table also declares filterable hides that column's values, but a caller who can call `execute_query` can still filter on it, and whether any rows come back tells them whether the value is there. A mask on a column that cannot be filtered is not exposed this way, and `list_tables` is what reports which columns are filterable. Where a caller must not learn which records exist, withhold `execute_query` from them instead of relying on the mask. The remedy is an access policy that denies `McpServerTool.call` on that one tool, written as Cedar text because the policy form cannot scope to a single tool:

```cedar
forbid (
  principal in Group::"contractors",
  action == Action::"McpServerTool.call",
  resource == McpServerTool::"execute_query"
) when {
  resource in McpServer::"zendesk"
};
```

Keep the `when` clause: Cedar identifies a tool by name alone, so without it the policy denies every tool named `execute_query` on every server the principal can reach. See [governance.md](governance.md#deny-one-tool-on-one-mcp-server) for the full form and [governance.md](governance.md#data-policies-mcp-data-shaping) for data policies.
- **The tools reach every caller of the server**, agents included. Leave the setting off on a server whose agents should only reach the curated tools.

### User-delegated OAuth on a managed connector: whose identity acts

On a managed connector that supports user-delegated OAuth, the per-user connection decides **which** stored credential is used, not necessarily **whose identity** the upstream call carries. Slack is the case where these differ, because one Slack authorization can issue both a bot token and a user token. The acting identity is fixed by the OAuth provider's **Slack OAuth token type** (`slack_token_type`), not by who owns the connection:

- **`Bot User OAuth Token`** (the default): tools post, read, and react **as the app's bot user**, even on a user-OAuth server.
- **`User OAuth Token`**: tools act **as the person who authorized**. Offered only when the provider uses Slack's standard OAuth v2 authorize and token endpoints, so not on a provider set up by discovery.
- The setting is chosen at provider creation and is immutable, so serving both identities means two providers (they can share one Slack app). See [governance.md](governance.md#slack-whose-identity-the-connection-acts-as-slack_token_type).

Some Slack tools accept only one identity: search needs a user token, and a bot token comes back as `not_allowed_token_type` or `user_token_required`. That is a provider token-type problem, not a missing connection or scope.

## Permissions

`dataplane_adp_mcpserver_*` gates both server management and each MCP protocol call against a running server (`initialize`, `tools_list`, `tools_call`, `resources_read`, `prompts_get`, and so on). Grant tool calls with a policy on `Action::"McpServerTool.call"`, scoped to one server where possible (`resource is McpServerTool in McpServer::"<name>"`). Attaching an OAuth provider to a server needs `dataplane_aigateway_oauthprovider_attach`. See [governance.md](governance.md#roles-and-permissions).
