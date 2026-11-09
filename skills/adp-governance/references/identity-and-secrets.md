Source: `cloudv2 apps/rpai/testdata/commands-snapshot.md` (`oauth-client`, `oauth-provider`, `connection`, `secret`, `api-key`, `guardrail`, `--data-policies`), `cloudv2 apps/rpai/internal/cmd/secret/`, the `api_key` and `secret_service` protos, `adp-docs modules/control/pages/` (`secrets.adoc`, `tags.adoc`), `modules/connect/pages/` (`data-policies.adoc`, `remote-mcp-clients.adoc`, `oauth-providers.adoc`), `modules/gateway/pages/connect-agent.adoc`, `modules/cli/pages/index.adoc`. Full per-claim mapping and the dated verification log: the `references/governance.md` entry of this skill's `SOURCES.md`; for the moved subcommand sections, the `references/cli.md` log of `skills/adp/SOURCES.md`.

# Agentic Data Plane Identity and Secrets Reference

## Secrets

A credential that an LLM provider, MCP server, OAuth provider, OAuth client, trigger or agent names is held in the ADP **secret store** and referenced by ID, so the credential lives in one place and a rotation is one edit rather than one per resource. (A user's own OAuth tokens are not secrets in this sense: those live in the token vault behind **Connections**.) Manage secrets with `rpk ai secret` (see [`secret` subcommands](#secret-subcommands)) or under **Secrets store** in the UI sidebar.

- **Shape.** An ID starts with a letter and holds uppercase letters, digits and underscores, up to 255 characters, and is immutable — `OPENAI_API_KEY`, not `openai-api-key`. The value is the credential itself, up to 64 KiB, and is **write-only**: nothing reads it back, in the UI or the CLI, so a lost value is replaced rather than recovered. Tags are key/value pairs for organizing and for policy conditions (see [Tags on ADP resources](#tags-on-adp-resources)).
- **The UI takes a multi-line value.** Pick *Single line* for an API key or token (no leading or trailing whitespace), or *Multiline* for a PEM key or a JSON document, where the form drops one final line break. The credential fields on provider, server and OAuth-provider forms can also store a new value in place, which lands in the same store.
- **What the pickers show.** A credential picker lists only this store's secrets, the ones the AI Gateway can read; a secret Redpanda Cloud holds for another product does not appear, and a new secret cannot reuse its name.
- **A rotation does not require touching the resources.** They keep referencing the ID, and how soon each picks up the new value differs: **within about five minutes** for OpenAI, Anthropic and Google providers, **on the next request** for Amazon Bedrock providers, **on the next call** for self-managed MCP servers authenticating with a static key or service-account OAuth, and **within about ten minutes** for a managed MCP server that uses a secret.
- **Deleting is unchecked and permanent.** Nothing verifies whether a resource still references the secret; those resources keep the reference and fail at their next call. Find and repoint them first.
- **Who can manage them.** Policies name `Secret.create`, `Secret.get`, `Secret.list`, `Secret.update` and `Secret.delete`; the permissions are `dataplane_adp_secret_*`. Admin and the *Standard* and *Full access* templates carry all five; *Read only* and *Sandboxed* carry `get` and `list`. The built-in *Owner lifecycle* policy adds get, update and delete on the secrets **you** created, so no per-person grant is needed for your own. `Secret.get` and `Secret.list` disclose a secret's ID and tags, never its value; to limit someone to a subset, condition the policy on the secret's tags.

## Tags on ADP resources

Tags are key/value labels that let a policy or a report act on a whole team or environment instead of a list of resource names. Agents, MCP servers, LLM providers, guardrails, budgets and secrets all carry them, and a policy can also read the tags on OAuth clients, OAuth providers and policies.

Set them in the **Tags** section of each resource's create and edit forms (for an agent, **Advanced** → **Tags**), or with `--tag` on `agent` and `secret` `create` / `update`, `--tags` on `mcp-server` and `llm-provider` `create` / `update`, and `--remove-tag` on `secret update`. For guardrail and budget tags, use the UI unless `rpk ai --help` shows a group for them.

- **Limits.** At most 50 pairs per resource, values up to 256 characters, both halves required. An entry whose key already exists replaces that key's value.
- **A write replaces the whole map.** `--tags` on a provider or server update, and a save in the UI, send the full set, so keep the pairs you want. `rpk ai secret update` is the exception: it merges `--tag` onto the stored tags and drops only what `--remove-tag` names.
- **Three consumers, one set of tags.** Policies condition on them, cost reporting groups by them, and lists filter on them. Only the **calling agent's** tags are stamped on an LLM call, never the provider's or the server's, and a call made outside an agent carries none. A budget's own tags do not decide which agents it covers — its target agent does.
- **Lists.** The agents and secrets lists carry a `Tag` filter matching one `key=value` pair.
- Keep keys consistent across resource types (one `team` key on agents, servers and providers) so one policy and one spend report cover a team's whole footprint, keep values lowercase (a condition compares exactly), and tag at creation — an untagged resource falls outside every policy and report that relies on the tag. Never put secrets or PII in tag values.

## API keys

An **API key** is a long-lived credential that authenticates requests to ADP as **the user who created it**, for cases where a browser sign-in and a short-lived token are awkward: a desktop AI client that reads a key from its configuration, a long-running script, a workstation tool. Every `rpk ai run` session uses one (see `/redpanda:adp`, *The session credential is an ADP API key*). For a caller that should be a service account rather than a person — an application, a CI job — use OIDC client credentials instead. Keys are managed in the UI, under **API keys** in the sidebar, or with `rpk ai api-key` (`create`, `get`, `list`, `update`, `delete`).

- **`api-key create` prints the key on stderr, once.** The command takes **no positional name** — the server names the key — and requires `--display-name`; `--expires-at` takes an RFC 3339 timestamp. The metadata goes to stdout and the key value to **stderr**, so `rpk ai api-key create --display-name x -o json > key.json` saves the metadata and throws the key away. Capture both streams, or read the key off the terminal.
- **Lifecycle.** A key takes a name (name it after the client *and* the machine holding it, so you can tell which to delete later) and an expiration: 1 day, 7 days, 30 days, 90 days, a date you pick, or Never — the default is 30 days. The value is shown **once**; ADP stores only a hash, so a lost key is replaced, not recovered. The expiration is **fixed at creation**: to change it, create a new key and delete the old. Renaming is API-only.
- **Review and revoke.** The list shows each key's prefix and last four characters, its expiry, last use, and creator; an expired key stays listed, marked Expired, until deleted. Deleting is permanent and takes effect within a minute. You see your own keys by default; filtering by creator needs the administrative permissions below.
- **Scope.** One key authenticates both the gateway's runtime traffic and the ADP management API, carries its creator's permissions, and is attributed to that person in the audit log and transcripts. For the headers a client sends, see `/redpanda:adp` (*How a client authenticates to the gateway*).
- **Offboarding is manual.** ADP does **not** revoke a user's keys when they are deactivated or removed in the identity provider. Delete them as part of offboarding.
- **Permissions.** Creating a key (`dataplane_adp_apikey_create`) comes with the *Sandboxed* template and above. Reading and deleting the keys *you* created, and renaming them through the API, come from the built-in *Owner lifecycle* policy, so no per-person grant is needed. Reading, renaming, or deleting *another* user's keys needs `dataplane_adp_apikey_get`, `_list`, `_update`, `_delete`, which only *Full access* grants.

## Data policies (MCP data shaping)

**Preview.** Configured per MCP server: in the UI on the server's **Data Policies** tab, or with `rpk ai mcp-server create/update --data-policies` (repeatable JSON object; on update it **replaces the full list**, so pass every policy the server should keep). Read them with `rpk ai mcp-server get <name> -o yaml`; list output omits them. See `/redpanda:adp`.

A data policy shapes tool-call arguments on the way upstream and results on the way back to the model. Cedar decides **whether** a tool call runs; data policies decide **what the data looks like** for matching callers.

- **Binding:** `tools` (empty = every tool on the server), `principals` as `User:<email>` entries (empty = every caller; group targeting is not supported), and the transforms.
- **Composition:** several policies can match one call; they compose most-restrictively, so adding a policy only narrows.
- **Fail closed:** a rule that can't be enforced denies matching calls.

Transforms:

- **Field actions** (request and response), selected by JSONPath (`$.user.email`; descendant `$..ssn` for mask/drop; no wildcard, index, or filter expressions): `keep`, `drop`, or `mask` with a method — redact (placeholder, default `[REDACTED]`), partial (keep first/last N characters), hash (SHA-256, correlatable; salted hashing isn't supported), or pattern (RE2 substitution). *Drop fields without policy* switches to allowlist mode (only kept fields survive). A **strict** mask/drop rule whose selector matches nothing denies the call (protection against renamed fields); an **absence-safe** rule tolerates a missing field. UI-created rules are absence-safe by default; rules in YAML or `--data-policies` are strict unless marked absence-safe; descendant selectors must be absence-safe.
- **Argument limits** (request): numeric min/max, string length, RE2 pattern, format, allowed values, array item count. Violations are rejected with an error naming the argument, and the limits are merged into the tool's advertised input schema.
- **Row filters** (response): name the array path (`$.body`, `$.result`, or `$`) and a predicate such as `@.priority >= 8` or `@ != "restricted"`. Elements the predicate can't evaluate never survive; predicates on the same array conjoin.

In the UI, the **Configuration** tab shows the composed effect for one tool across all of the server's policies, and the **Preview** tab runs sample data through the live shaping code before you save.

**A mask hides values, not which records hold them.** On a server that also exposes its data as read-only SQL tables, a caller who can run `execute_query` can filter on a masked column the table declares filterable, and whether rows come back tells them whether that value exists. To stop that, deny `McpServerTool.call` on `execute_query` for those callers with [the single-tool Cedar form](access-control.md#deny-one-tool-on-one-mcp-server), keeping the `when` clause that pins the server, or the deny covers every server with a tool of that name. See `/redpanda:adp` (*SQL table exposure on a managed connector*).

Other limits: on legacy SSE self-managed servers, calls that match a policy with response rules are denied. A *Not enforced here* badge means rules save but don't apply on that gateway. The audit log records each matching data policy as Blocked, Masked, or Passed.

## OAuth and identity

OAuth clients govern **inbound** auth (an external MCP client, such as Claude or ChatGPT, authenticating to the AI Gateway). OAuth providers govern **outbound** auth (the gateway authenticating to an upstream system such as GitHub or Slack on a user's behalf). They are separate resources.

### OAuth clients (inbound)

CLI: `rpk ai oauth-client` (`create`, `get`, `list`, `update`, `delete`, `apply`, `diff`, `dcr`, `cimd`, `catalog` for the known clients, `revoke-tokens`). UI: **Integrations setup** → **Inbound clients** → **Add external tool** (well-known presets prefill redirect URIs, or *Custom client*).

The fields that bite: `Name` **becomes the OAuth `client_id` and is immutable**, `Redirect URIs` match **exactly**, `Allowed MCP Resources` defaults to `*`, and a confidential client's `client_secret` is shown **once** at creation and can't be regenerated — delete and recreate for a new one. Take the rest (display name, logo, grant types, token-endpoint auth method, PKCE, enabled) from the form or `rpk ai oauth-client create --help`.

```bash
rpk ai oauth-client revoke-tokens <name>   # revoke every refresh token issued under the client; idempotent
```

Already-issued access tokens keep working until they expire; deleting a client also revokes its tokens.

#### Inbound client registration: DCR and CIMD

Two independent self-service mechanisms admit an external MCP client without an admin creating it by hand. Both are tenant-wide settings; either can be on without the other.

**Dynamic Client Registration (DCR, RFC 7591)** — CLI, and viewable/editable in the UI under **Self-registration**. Off by default.

```bash
rpk ai oauth-client dcr get
rpk ai oauth-client dcr update --enabled --admission-mode open \
  --allowed-resource '*' --client-cap 100 --rate-per-hour 20 --inactive-ttl-days 30
rpk ai oauth-client dcr iat mint --label "Claude handoff" --ttl 24h   # plaintext shown once
rpk ai oauth-client dcr iat list
rpk ai oauth-client dcr iat revoke <token-id>
```

Admission modes: `open` (anonymous registration, still rate-limited and capped) or `initial-access-token` (callers present a one-shot admin-minted token). `software-statement` is reserved and not supported. Self-registered clients appear in `rpk ai oauth-client list` as `dcr-<id>` with a DCR badge, use PKCE with no secret, and are removed after the inactivity TTL (`0` keeps them).

**Client ID Metadata Documents (CIMD)** — `rpk ai oauth-client cimd`, or **Integrations setup** → **Inbound clients** → **Self-registration** → *Accept client metadata documents (CIMD)*. The client's `client_id` is an HTTPS URL hosting a JSON metadata document; nothing is persisted and the client does not appear in the client list.

Its settings are *Trusted document domains* (*Any domain*, or *Only these domains*, which also covers subdomains) and *Allowed resources* (the MCP URLs CIMD clients may request tokens for, or any MCP server on the gateway). **Turning CIMD on sets *Allowed resources* to any server**, so narrow it right away. CIMD works only when the switch is on, *Allowed resources* isn't empty, and the gateway can fetch metadata documents; *Not active on this gateway* means the last condition fails, which only the gateway operator can fix. Resource matching is exact: copy each URL from the server's **Connection** tab, drop trailing slashes, and list a code-mode URL separately. Because CIMD admits clients no admin sees, prefer *Only these domains* and keep *Allowed resources* narrow.

### OAuth providers (outbound)

CLI: `rpk ai oauth-provider` (aliases `oauth`, `op`; `create`, `get`, `list`, `update`, `delete`, `apply`, `diff`, `catalog`, `discover`). UI: **Integrations setup** → **Outbound providers** → **Add provider** (catalog preset, *Custom Provider*, or *Discover from MCP server URL*).

The settings that bite: the name (positional) and the client ID are **immutable**, the client secret is a secret-store key in `UPPER_SNAKE_CASE`, grant types must select browser consent because token exchange is not usable, and **a new provider is disabled unless you pass `--enabled`**. You can't delete a provider while an MCP server uses it, and deleting one revokes every stored user token for it. Providers Redpanda creates for an MCP server are *Managed* and can't be edited or deleted. Take the endpoints, scopes, auth method, PKCE setting and extra params from the form or `--help`; `--register-from-url` drives discovery, and Slack adds the token type below.

#### How discovery registers this gateway (DCR and CIMD)

*Discover from MCP server URL* (CLI `--register-from-url`) points Redpanda at a remote MCP server and lets it work out the upstream OAuth setup. Registering this gateway as a client with the upstream authorization server follows a ladder, in order:

1. **Credentials you supply** (a client ID and client-secret reference).
2. **CIMD**, where the upstream advertises it: the gateway's `client_id` is the HTTPS URL of a metadata document it publishes, so nothing is registered upstream.
3. **DCR (RFC 7591)**, where the upstream offers a registration endpoint.
4. **Manual setup**: you register with the upstream yourself.

So a CIMD-only upstream still connects through discovery. A CIMD `client_id` is a public URL, not a secret, and it's the value to give the upstream vendor for an allowlist. Where the deployment doesn't know its own external HTTPS address, discovery falls back to DCR. `rpk ai oauth-provider get <name> -o yaml` marks such a provider `cimd_client: true` (system-set). This outbound flow is independent of the [inbound](#inbound-client-registration-dcr-and-cimd) setting.

#### Slack: whose identity the connection acts as (`slack_token_type`)

Slack issues two credentials from one authorization, and a connection is per-user either way, so **connection ownership does not decide the acting identity**. The provider's Slack OAuth token type does (UI: `Slack OAuth token type`; CLI: `--slack-token-type`; manifest field `slack_token_type`):

| Setting | Requested with | The agent acts as |
|---|---|---|
| Not set (flag omitted) | Bot Token Scopes (`scope`); a `user_scope` carried in the provider's extra auth params is left alone | the app's bot user — the default, and what existing providers have |
| `slack-oauth-token-type-bot` (UI: *Bot User OAuth Token*) | Bot Token Scopes only: an explicit bot selection **strips `user_scope`** from the authorization request rather than minting an unused personal grant | the app's bot user, stated explicitly |
| `slack-oauth-token-type-user` (UI: *User OAuth Token*) | User Token Scopes (`user_scope`) | the person who authorized — posts, reads, and reactions are attributed to them |

Rules:

- **Immutable.** It can't be changed after creation (the edit form shows it read-only; updates keep the stored value), so a provider never flips identity under live connections. To offer both identities, create two providers and point each Slack MCP server at the one it needs.
- **User identity needs the Slack OAuth v2 endpoint pair** — authorization `https://slack.com/oauth/v2/authorize` and token `https://slack.com/api/oauth.v2.access`; any other pair is rejected. The bot setting has no endpoint requirement. The UI offers the field only on that standard pair.
- **Manual setup only.** Combining the token type with `--register-from-url` (discovery) is rejected, and that error is reported ahead of any endpoint error.
- **Never reused implicitly.** A user-token provider is never picked automatically when Redpanda sets up OAuth for a server; it is attached only when a server names it.
- **A user grant can't be back-filled.** If Slack returns a non-user token for a user-token provider (typically because User Token Scopes were never granted), the exchange fails as `invalid_grant` and the connection is expired, not retried: the user must reconnect with User Token Scopes.

Existing Slack connections keep their bot identity and need no reconnection. See `/redpanda:adp` (*Remote auth modes*) for the `user_oauth` side of this.

### Your OAuth connections

`rpk ai connection list` / `rpk ai connection revoke` (UI: **Connections**) manage **your own** per-user connections to OAuth providers; the built-in self-service policy lets every user do this. Connections are isolated per user. Listing or revoking **other** users' connections is a separate administrator permission; there is no CLI command for it in `rpk ai`.

### Capabilities that are not offered

- The AI Gateway does no per-second/minute/day rate limiting, routing, or failover; use budgets to cap spend (see [spend-and-safety.md](spend-and-safety.md#budgets)).
- Access policies govern only ADP resources; they cannot govern resources outside it.

## `connection` subcommands

A *connection* is your personal OAuth grant to a third-party provider, created by signing in through the browser consent flow (the **Connect** action in the UI), that lets `user_oauth` MCP servers act on your behalf. These commands manage connections you already hold — the terminal equivalent of **My Connections** — and do not create them.

`rpk ai connection list` lists your connections and their status, with `-o wide` / `-o yaml` adding connected-at, token-expiry and refresh-token detail. `rpk ai connection revoke <provider-name>` revokes your own connection to that provider — it invalidates your stored tokens and calls the provider's revocation endpoint best-effort, and affects only your connection.

## `oauth-client` subcommands

Aliases: `oauth-clients`, `oc`.

Subcommands: `create`, `get`, `list`, `update`, `delete`, `revoke-tokens <name>`, `dcr`, `apply`, `diff`.

`revoke-tokens` revokes every refresh token issued under the client, forcing every user who connected it to sign in again; already-issued short-lived access tokens may keep working until they expire. It is idempotent.

**`dcr`** manages Dynamic Client Registration settings: `dcr get`, `dcr update`, and initial access tokens under `dcr iat` (`mint`, `list`, `revoke <id>`).

## `oauth-provider` subcommands

Aliases: `oauth-providers`, `oauth`, `op`. Subcommands: `create`, `get`, `list`, `update`, `delete`, `apply`, `diff`.

## `secret` subcommands

Aliases: `secrets`, `sec`. Subcommands: `create <id>`, `get <id>`, `list` (alias `ls`), `update <id>`, `delete <id>` (alias `rm`). Every verb takes the bare ID (`OPENAI_API_KEY`) or the `secrets/<id>` resource name. Secret values are **write-only**: no command prints one, and `get` and `list` return IDs, tags and audit fields only. For what a secret is, who may manage one, and when a rotated value takes effect, see [Secrets](#secrets).

```bash
printf %s "$OPENAI_API_KEY" | rpk ai secret create OPENAI_API_KEY --value-file=-   # stdin
rpk ai secret create GITHUB_TOKEN --value-file ./token.txt --tag team=ai
rpk ai secret update OPENAI_API_KEY --tag env=prod --remove-tag stale              # value kept
rpk ai secret list --tag team=ai
rpk ai secret delete OPENAI_API_KEY --etag <etag>
```

- **Write `--value-file=-`, with the equals sign, to read from stdin.** Under `rpk ai`, a bare `-` passed as a separate argument is dropped before it reaches the plugin, so `--value-file -` fails with an argument error instead of reading the pipe. This does not carry over to `rpk ai policy --cedar-file`, which takes a file path only and has no stdin mode: write the Cedar to a file, or pass it with `--cedar`.
- `--value` takes the value inline, which leaves it in your shell history and the process list; prefer `--value-file`. The two are mutually exclusive, and one trailing newline is stripped from a file or stdin.
- `update` changes only what you pass: omit the value to keep the stored one, `--tag KEY=VALUE` adds or overwrites a tag, `--remove-tag KEY` drops one. A tag change reads the secret first and writes the merged set fenced by the etag it read, so a concurrent edit fails the update rather than being overwritten. `delete` takes an optional `--etag`.
- `list` ANDs `--filter` (AIP-160 over `name`, `created_by`, `updated_by`, `created_at`, `updated_at`, `tags.KEY`, `tags:KEY`) with `--tag`, then `--name-contains` narrows to IDs holding that substring, case-insensitively.
- **Delete does not check references.** An LLM provider, MCP server, OAuth client, trigger or agent that still names the secret keeps its reference and fails at its next call. Repoint those first.

## `api-key` subcommands

A generated group with `create`, `get`, `list`, `update`, `delete`.

`api-key create` takes **no positional name** — the server names the key — and requires `--display-name`. **The key value is printed once, on stderr, while the metadata goes to stdout**, so `... -o json > key.json` saves the metadata and throws the key away. See [API keys](#api-keys).
