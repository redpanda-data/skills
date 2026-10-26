Source: `cloudv2 apps/rpai/testdata/commands-snapshot.md` (`policy`, `oauth-client`, `oauth-provider`, `connection`, `secret`, `--guardrail`, `--data-policies`), `cloudv2 apps/adp-api/internal/seed/` and the `api_key` and `secret_service` protos, `adp-docs modules/control/pages/` (`budgets.adoc`, `cost-usage.adoc`, `cost-allocation-tags.adoc`, `guardrails/`, `access-policies.adoc`, `permissions-overview.adoc`, `permissions-reference.adoc`, `secrets.adoc`, `tags.adoc`), `modules/connect/pages/` (`data-policies.adoc`, `remote-mcp-clients.adoc`, `oauth-providers.adoc`), `modules/gateway/pages/connect-agent.adoc`. Full per-claim mapping and the dated verification log: the `references/governance.md` rows of `SOURCES.md`.

# Agentic Data Plane Governance Reference

**Maturity:** Redpanda Agentic Data Plane is generally available, and so is the `rpk ai` CLI. Per-feature markers from the docs: **guardrails** and **data policies** are Preview; budgets, cost reporting, and access policies carry no Preview marker. Access policies are still enabled per organization: if **Access** is missing from the sidebar, they are not enabled for yours.

## Discover the live surface

```bash
rpk ai policy --help            # Cedar access policies (create/get/list/update/delete/apply/diff)
rpk ai policy list
rpk ai oauth-client --help      # inbound OAuth clients, DCR settings, revoke-tokens
rpk ai oauth-provider --help    # outbound OAuth providers
rpk ai connection --help        # your own OAuth connections (list, revoke)
rpk ai secret --help            # the secret store (create/get/list/update/delete)
```

Which surface each governance feature uses:

| Feature | CLI | UI (ai.redpanda.com) |
|---|---|---|
| Budgets | none | **Budgets** in the sidebar |
| Cost and usage analysis, cost-allocation tags | none | **Cost and usage** in the sidebar |
| Guardrails (create, configure, enable) | none; attach/detach only, via `rpk ai llm-provider update --guardrail` / `--clear guardrail` | **Guardrails** in the sidebar |
| Access policies (Cedar) | `rpk ai policy` | **Access** in the sidebar (only when access policies are enabled for your organization) |
| Data policies | `rpk ai mcp-server create/update --data-policies` | MCP server → **Data Policies** tab |
| Secrets that other resources reference | `rpk ai secret` | **Secrets store** in the sidebar |
| OAuth clients (inbound), DCR | `rpk ai oauth-client`, `rpk ai oauth-client dcr` | **Integrations setup** → **Inbound clients** |
| CIMD settings | none | **Integrations setup** → **Inbound clients** → **Self-registration** |
| OAuth providers (outbound) | `rpk ai oauth-provider` | **Integrations setup** → **Outbound providers** |
| Your OAuth connections | `rpk ai connection` | **Connections** |

There is no `rpk ai budget`, `rpk ai spending`, or `rpk ai guardrail` command. Do not invent one; direct the user to the UI.

## Budgets

UI only: open **Budgets** in the sidebar.

A budget caps LLM spend per agent over a recurring period. Concepts:

| Setting | Behavior |
|---|---|
| Limit (`Limit spend to`) | Hard cap on per-period spend, entered in dollars. When an agent's spend reaches it, the agent's next LLM request gets `HTTP 429` until the period resets. |
| Warning threshold (`Warn at`) | Percentage of the cap (80% by default). Past it, requests still pass; gateway responses carry a `SpendLimit-Warning` header. Must be greater than zero and less than the limit. |
| Period | Daily, weekly, or monthly, calendar-aligned in UTC (00:00 daily; 00:00 Monday weekly; 00:00 on the 1st monthly). |
| Target agent | Unset = the tenant **default** budget. Set to an agent (`agents/<slug>`) = a **per-agent override**. Immutable; to retarget, delete and recreate. |

- **Pooling is per agent.** The default budget gives every agent its own independent pool of the limit; one agent hitting its cap does not affect another. There is no shared tenant-wide pool.
- One default per tenant; at most one override per agent. An override replaces the default for that agent.
- Adding, or deleting and recreating, an override mid-period does **not** reset usage: while a default exists, the override inherits the default's current window. Editing a limit never moves the window.
- Only calls made **as an agent** (including on a user's behalf) are capped. A user calling the gateway directly is never capped. If the gateway can't read current spend, it lets the request through (fail-open).
- A capped request's `429` body uses the provider's own rate-limit format (OpenAI-format: code `budget_exceeded`; Anthropic `rate_limit_error`; Google `RESOURCE_EXHAUSTED`; Bedrock `ThrottlingException`). The message names the budget, spend against the cap, and reset time.
- Guardrail evaluation is not counted against budgets.

### Amounts and units

The UI takes and shows budget amounts in **dollars**, and cost reporting and CSV exports show **USD**. Raw stored cost values are in **USD microcents** (1 cent = 1,000,000 microcents; $1 = 100,000,000). If you ever see a `*_microcents` value, divide by 100,000,000 for dollars; never treat it as cents.

## Cost and usage

UI only: open **Cost and usage** in the sidebar. Every LLM call routed through the gateway is recorded and priced automatically (input, output, and cached tokens; cost; request count; provider, model, user, agent context). Prices come from the built-in per-model catalog or per-provider overrides (`rpk ai llm-provider create/update --pricing`, see [gateway-and-providers.md](gateway-and-providers.md)). Pricing is resolved per provider and model, so a call is priced with the rates of the provider that served it, and the same model offered by two providers is priced separately for each. Cost reporting works with no pricing setup at all.

The **Cost & usage** tab offers a UTC time window (written to the URL, every figure compared with the equal-length previous period), headline spend, request, cost-per-1k and token figures, per-resource spend charts, a CSV export of the table as shown or of every row, and a **Spend breakdown** grouped by **Agents**, **Models**, **Providers**, **Users** or **Tags**.

On the **Models** tab a row is **one model as served by one provider**, not the model on its own: it names the model and the service that served it, with the provider the call went through and the exact recorded model identifier underneath. A model you reach through two providers gets a row for each, so duplicate-looking model rows are per-route costs rather than a bug, and a call whose provider details were not recorded keeps its row and says the provider configuration is unknown. Filtering spend by a model covers every dated version of it, not only the newest; a name that differs by more than a trailing date stays separate (`gpt-4o-mini` is its own model, as is each regional version of a model served through Amazon Bedrock), and because the breakdown lists each exact recorded identifier, a charted model's spend can exceed the row you charted it from. Synthetic rows: *Direct usage* (calls not made through an agent), *Unattributed* (no user recorded), *Untagged* (no value for the chosen tag key), and *Deleted provider* rows that keep history complete.

The **Activity** tab shows the agents active right now.

### Cost-allocation tags

Cost-allocation tags are the agent's own tags (see [Tags on ADP resources](#tags-on-adp-resources)), stamped on every LLM call it makes as a snapshot. **Attribution is point-in-time:** retagging never rewrites past spend, new spend picks up new tags, and a change takes a short time to apply. Spend with no value for the grouped key — direct user calls, untagged agents, the window before a new agent's tags apply — collapses into one *Untagged* row.
- In the UI: **Spend breakdown** → **Tags** tab → choose a tag key. The key list shows only keys seen on spend in the current window. Tag rows can be opened for a chart but can't be charted against the gateway total, and the full-report export doesn't group by tag (use *Breakdown table as shown*).
- Limits: at most 50 tags per agent; values up to 256 characters. Don't put secrets or PII in tag values; they appear in cost reports.

## Guardrails

**Preview.** Create and configure guardrails in the UI (**Guardrails** in the sidebar). The CLI can only attach and detach them from LLM providers.

A guardrail is a bundle of safety policies backed by **Amazon Bedrock Guardrails**. It inherits the credentials and region of the Bedrock LLM provider you pick at creation, so a Bedrock provider must exist first. The name and provider connection are fixed after creation.

### Create and enable (UI)

1. **Guardrails** → **Create guardrail**. Enter a `Name` (derived ID: lowercase letters, numbers, hyphens, 1-63 chars, immutable).
2. **Template:** *Start blank*, *Content safety*, *PII protection*, or *Prompt attack defense*. Templates seed editable policies and never remove existing rules.
3. **Rollout:** *Monitor first* (created disabled; recommended) or *Enforce now* (requires a template).
4. **Provider:** the Bedrock provider whose credentials and region it inherits. Click **Create guardrail**.
5. **Policies** tab: switch on each policy, configure it, then **Save and apply** (the save reaches every provider that uses the guardrail). Switching a policy off keeps its configuration.
6. **Settings** tab: `Message for blocked prompts` and `Message for blocked responses` (each required, 1-500 characters; both default to a generic message; one checkbox reuses the prompt message).
7. Click **Enable guardrail**. It stays unavailable until at least one saved policy is configured. Enable/disable and edits take effect within about 30 seconds.

### Attach to an LLM provider

A guardrail does nothing until a provider references it. Each provider references at most one guardrail; a guardrail can back many providers.

```bash
rpk ai llm-provider update <provider-name> --guardrail <guardrail-name>
rpk ai llm-provider update <provider-name> --clear guardrail   # detach
```

The UI shows the guardrail setting only on Bedrock providers; for any other provider type (OpenAI, Anthropic, Google, and so on) use the CLI. On a Bedrock provider, Bedrock enforces the guardrail in the model call. On other providers, the gateway sends each prompt and response to Bedrock for evaluation, so that text reaches AWS even if the model runs in your network. You can't delete a guardrail while any provider references it; detach first.

### Policy types

Each policy is optional, but a guardrail needs at least one to be enabled.

| Policy | What it does |
|---|---|
| Content filters | Categories `Hate`, `Insults`, `Sexual`, `Violence`, `Misconduct`, `Prompt attack` (input only). Per category and direction: strength `None`/`Low`/`Medium`/`High`, action `None` (detect) or `Block`; modality `Text`, `Image`, or both. |
| Word filters | Custom words plus managed lists (such as profanity); `None` or `Block` per direction. |
| Denied topics | Semantic topic matching (catches paraphrases); up to 30 topics, each with name, definition, and up to five examples. |
| Sensitive information | Built-in PII entity types (the UI lists them) plus custom RE2 regexes; action `None`, `Block`, or `Anonymize` per direction. |
| Contextual grounding | Output only; grounding and relevance sub-filters, each with a threshold 0.0-0.99. |
| Automated reasoning | Output only, detect-only (never blocks); one or two versioned Bedrock Automated Reasoning policy ARNs (`DRAFT` rejected). |

Only these six content-filter categories exist; don't use other category taxonomies.

### Blocking behavior

- A blocked input returns the configured blocked-prompt message; a blocked output returns the blocked-response message instead of the model's response.
- `Anonymize` replaces each match with its entity type (for example `{EMAIL}`). On output, the redacted response is delivered. On input: a Bedrock provider masks and forwards the prompt; other providers short-circuit the request like a block.
- Evaluation **fails closed**: if the gateway can't complete an evaluation, it rejects the request.
- Streaming output on non-Bedrock providers is evaluated in text batches; if a batch is blocked, the caller gets the blocked message in its place and the stream ends (earlier batches are already delivered).
- Guardrail activity appears on the request's trace in transcripts; when the gateway evaluated the guardrail itself (non-Bedrock path), the audit log also records the block or mask and names the guardrail. See [observability.md](observability.md).
- AWS bills Bedrock guardrail evaluation to the AWS account whose credentials the guardrail uses; it is not in ADP cost reporting.

## Access control (Cedar access policies)

Manage from the CLI with `rpk ai policy` or the UI (**Access** → **Policies**). A policy is one Cedar `permit` or `forbid` statement over a principal, an action, and a resource.

```bash
rpk ai policy create --name deny-prod-reads --cedar-file deny-prod-reads.cedar \
  --display-name "Deny prod reads" --description "..."
rpk ai policy get deny-prod-reads -o yaml        # round-trips as an apply manifest
rpk ai policy update deny-prod-reads --cedar-file new.cedar --etag <etag>
rpk ai policy delete deny-prod-reads --etag <etag>
rpk ai policy apply -f policies/                 # GitOps: create or reconcile, no prune
rpk ai policy diff -f policies/                  # exits non-zero when drift is pending
```

`--cedar` and `--cedar-file` are mutually exclusive, and the body must contain exactly one statement. `--etag` gives optimistic concurrency on update and delete.

### Give a new agent access

**A new agent has no policy of its own.** Creating an agent writes no policy for it, so you decide what it may reach. `rpk ai agent create` prints a notice on **stderr** saying the agent has no access until a policy names it, with the two commands below, leaving stdout as the created object so `-o json` output stays parseable. In the UI, a managed agent's **Permissions** tab warns until you author one. Registering a self-managed agent in the UI is the exception: its create page carries a required **Access** section that writes the first policy for you. Whether a given call was checked against policies at all shows in the audit log: a call that bypassed policy evaluation carries the status detail `allowed by internal-caller exemption; no policy evaluated` (see [observability.md](observability.md#audit-log)).

<!-- TODO(human): the CLI notice says a new agent "has no access until a policy names it"; the published docs stop at "has no policy of its own" plus the Permissions tab's warning, and do not state that a policy-less agent's runtime calls are refused. Keep this section at the docs' level until a human confirms which to state. -->

**Its creator can nevertheless invoke it.** The built-in *Owner lifecycle* policy grants `Agent.invoke` on an agent **you** created — which covers that agent's whole A2A surface — and `LLMProvider.invoke` on a provider you created, so whoever created both can run the agent without authoring a policy first. Ownership is read from the stored resource, so a resource that records no creator (one imported, or created by the system) is owned by nobody and grants invocation to no one. This does not change what the *agent* may reach when it runs: that is the agent's own grants, which still come from a policy naming it as principal.

Two `create` paths bind a policy to one agent:

```bash
# Bind a built-in template (least to most access: readonly, sandboxed, standard, full)
rpk ai policy create --agent invoice-triage --template sandboxed

# Or supply Cedar whose principal is that agent
rpk ai policy create --agent invoice-triage --cedar-file grant.cedar
```

- `--agent` takes the agent ID or the `agents/<id>` resource name that `rpk ai agent list` prints; the prefixed form is normalized, so the policy never binds `Agent::"agents/<id>"`, which would save and then never match.
- `--agent` defaults `--name` to `<agent-id>-access` and tags the policy `redpanda.com/agent-self: <agent-id>`. `--name` is required whenever `--agent` is not set, and must be passed explicitly when the derived name would exceed the 63-character policy-name limit.
- With `--agent` and a Cedar body, the CLI parses the body and refuses it unless the principal is exactly `Agent::"<agent-id>"`; the error names the principal it found. This fails before the request is sent, because a body naming any other principal would save and never match the agent's token.
- `--template` resolves one of the built-in aliases (`readonly`, `sandboxed`, `standard`, `full` — the templates the UI lists as *Read only*, *Sandboxed*, *Standard* and *Full access*; see [Templates and built-in policies](#templates-and-built-in-policies)) or takes a `policyTemplates/<id>` resource name, so a template you authored is bindable too. It requires `--agent`, and is mutually exclusive with `--cedar` / `--cedar-file`.
- Creating a second grant under the derived name reports that the policy already exists. Pass an explicit `--name` for an additional policy, or change the existing one with `rpk ai policy update`.

The UI offers the same binding from the agent's **Permissions** tab.

### Evaluation rules

- **A run a person starts is authorized as that person.** When someone runs an agent — in the Playground, for example — ADP checks *their* permissions for the model and tool calls the run makes, not the agent's. A run no person started, such as a scheduled trigger, uses the agent's own grants. So granting a team its agents is not enough: grant the LLM providers and the tools those agents use as well, and don't read a successful test run by the agent's author as proof of the agent's own access.
- Default deny: a request is denied unless a `permit` matches.
- A matching `forbid` always wins, over any permit and over anything a role grants.
- Fail-closed: a `forbid` that errors during evaluation denies.
- Policy changes reach enforcement asynchronously, so a successful save is not yet an enforcement guarantee.
- Every save validates the body against the current schema (strict mode) and reports all problems at once.

### Writing policies

- **Principals:** `User::"alice@example.com"`, `Group::"support"` (group names as your IdP emits them), or `Agent::"support-bot"`. Principals carry no attributes; model facts such as region as group membership.
- **Actions** are entity-qualified: `Action::"Agent.get"`, `Action::"McpServerTool.call"`, `Action::"Budget.update"`. Entity names are case-sensitive (`McpServer`, not `MCPServer`). Copy action IDs from the docs' Action reference rather than deriving them; if a pasted role-permission name is rejected, the error names the action ID to use. Each verb also exists as an action group (`action in Action::"get"`), and a `permit` using a group must pin the resource type (`resource is <Entity>`).
- **Resources:** always pin the type (`resource is Agent`, `resource == Agent::"x"`, `resource is McpServerTool in McpServer::"zendesk"`). To name **one tool**, match the tool entity and pin its server in a `when` clause — see [Deny one tool on one MCP server](#deny-one-tool-on-one-mcp-server).
- **Conditions** can read resource tags (`resource.hasTag("k") && resource.getTag("k") == "v"`), `created_by`/`updated_by` (guard with `resource has created_by`; they hold `User` references), and `changed_tags` on update only. Always guard the read: an unguarded read errors, and an erroring `forbid` denies.
- On create and update, conditions see the **resulting** state of the resource, not the stored one.

**Do not copy the Cedar action from the `rpk ai policy create --help` example.** Actions must be entity-qualified action IDs (for example `Action::"McpServerTool.call"`). If a policy fails to save with `Unknown action` because you used a role-permission name, the error names the action ID to use instead.

Data shaping (masking, dropping, row filtering) is **not** configured in Cedar; it lives on the MCP server's data policies (below).

#### Deny one tool on one MCP server

A tool is its own resource, so a policy can target a single tool. Members of `contractors` cannot call `execute_query` on the `zendesk` server, whatever else their roles or policies grant:

```cedar
forbid (
  principal in Group::"contractors",
  action == Action::"McpServerTool.call",
  resource == McpServerTool::"execute_query"
) when {
  resource in McpServer::"zendesk"
};
```

- **The `when` clause is what pins the server, and leaving it out widens the policy.** Cedar identifies a tool by its **name alone**, so without it this policy denies every tool called `execute_query` on **every** MCP server the principal can reach. Keep the clause to limit the denial to one server; drop it deliberately to deny that tool name everywhere.
- **The policy form cannot scope to a single tool.** Under *Specific resource*, picking a child type scopes to the *children of one parent* — the tools of one server, not one tool. Write this policy as Cedar text: the **Cedar** view in the UI, or `rpk ai policy create --cedar-file <file>.cedar` (`--cedar` for inline text; the two are mutually exclusive).
- A tool entity carries no tags, so membership in its server is the only condition it supports.

### Roles and permissions

ADP enforces fine-grained permissions: every operation checks exactly one permission. Permissions are the role-based access control (RBAC) vocabulary. Access policies use a different vocabulary, action IDs, so the two are never interchangeable.

**Built-in roles.** Roles are Redpanda Cloud IAM roles, assigned through role bindings; see `/redpanda:rpk-cloud` for managing them.

| Role | What it grants in ADP |
|---|---|
| Admin | Every ADP permission on every resource. Bind it to the people who administer the deployment and author policies; it is not a least-privilege role for day-to-day users |
| Writer, Reader | Nothing in ADP. They keep their control-plane and Kafka permissions, so a Writer can manage clusters and topics and still gets permission denied from every agent, MCP server, and LLM provider operation |
| The Kafka and Schema Registry roles | Nothing in ADP |

There are no built-in invoker or transcript-reader roles for ADP. Grant runtime-only or read-only access with an access policy. Organizations created before that change may still carry legacy invoker and transcript-reader roles; don't build new grants on them. A **custom role** holding ADP permissions still works, for when you need a permission bundle bound at a control-plane scope. Until access policies are enabled for an organization, Admin or a custom role is the only way to reach ADP.

**Permission families.** The full list with the operation each one gates is in the ADP roles and permissions reference.

| Family | Gates |
|---|---|
| `dataplane_adp_mcpserver_*` | MCP server management (create, get, list, update, delete) and each MCP protocol call against a running server (`initialize`, `tools_list`, `tools_call`, `resources_read`, `prompts_get`, …) |
| `dataplane_adp_llmprovider_*` | LLM provider management; `_invoke` proxies LLM requests at runtime; `_check_connection` tests a saved or draft provider |
| `dataplane_adp_agent_*` | Agent configuration, plus `dataplane_adp_agent_credential_*`, `dataplane_adp_agent_trigger_*`, and `dataplane_adp_agent_session_*` for credentials, triggers, and conversation sessions |
| `dataplane_adp_a2a_invoke` | All agent-to-agent (A2A) runtime calls to an agent |
| `dataplane_adp_transcript_*` | Reading conversation transcripts |
| `dataplane_adp_auditlog_list` | Reading the audit log |
| `dataplane_adp_trace_*` | The Traces view: `_list` for the list and its timeline, `_get` for one trace's spans, `_content_read` for span content nobody owns |
| `dataplane_adp_apikey_*` | API keys: `_create` to mint your own; `_get`, `_list`, `_update`, `_delete` for *other people's* keys |
| `dataplane_adp_secret_*` | The secret store. No permission returns a value: `_get` and `_list` disclose IDs and tags only |
| `dataplane_adp_agentnetwork_get` | The Agent network view |
| `dataplane_adp_spending_get`, `dataplane_adp_budget_*`, `dataplane_adp_guardrail_*` | Cost reporting, budgets, guardrails |
| `dataplane_adp_policy_*`, `dataplane_adp_policytemplate_*` | Authoring access policies and templates; granting these is equivalent to granting everything a policy can grant |
| `dataplane_aigateway_*` | OAuth clients, DCR and CIMD settings, OAuth providers (including attaching one to an MCP server), and OAuth connections (`connection_manage` for your own, `connection_admin` for everyone's) |

Points worth knowing:

- **The narrowest useful runtime grant** for an application or service account is LLM invocation alone (`dataplane_adp_llmprovider_invoke`). Grant it with a policy naming `Action::"LLMProvider.invoke"`. For MCP tool calls, the equivalent is `Action::"McpServerTool.call"`.
- **Content access is separate from configuration access.** Reading an agent's configuration does not let you read its transcripts or sessions, and a session read or transcript read exposes full conversation content (prompts, tool inputs and outputs, model output). The built-in *Read only* template and every template above it include transcript, session, and audit-log reads. To grant configuration reads without conversation content, write your own template or policy that leaves those actions out.
- **Testing a provider connection needs its own permission.** Neither read access nor create access alone allows it.
- **Debugging a denial:** map the refused operation to its permission in the reference, then grant the matching action ID with a policy.

**Identities.** Calls authenticate as a **user** (signed in through Redpanda's OIDC provider, as the UI and `rpk ai auth login` do), a **service account** (OIDC client credentials, for applications and CI), or an **agent** (with the credentials issued to it). All three can be policy principals. A service account is evaluated as a user, and an agent is named `Agent::"<agent-name>"`.

### Templates and built-in policies

- Redpanda compiles role bindings into permits automatically, so they take part in the same evaluation as your policies. The **Roles** and **System policies** tabs show them read-only.
- **Templates** (**Access** → **Templates**) fix an action set and effect; a policy links a template and supplies the principal and scope. Built-in templates: *Read only*, *Sandboxed*, *Standard*, *Full access* (each a superset of the previous; all grant transcript and session reads). Built-ins can't be edited; a template is a live link, so editing one changes every linked policy.
- Built-in, read-only managed policies: *Owner lifecycle*, *Self-service OAuth connections* (users manage their own connections), and *Agent capability ceiling* (agents can never mint credentials or control OAuth clients, providers, DCR settings, or the token vault). *Owner lifecycle* lets a user get, update and delete the agents, MCP servers, LLM providers, guardrails, budgets and secrets **they** created, update the triggers they created, list and manage their own API keys, and **invoke** an agent or an LLM provider they created. It stops short of creates — a create authorizes a payload that records no creator yet — and of agent credentials and sessions, which record no creator at all.
- **No policy is created for a new agent.** An agent created before Agentic Data Plane began asking for this decision carries an editable `Agent grant: <agent-name>` policy covering MCP session access, LLM invocation and agent-to-agent calls. It is a starting point, not a managed policy, so you can edit or delete it, and a deleted grant is not recreated. An agent created now gets no such policy and needs one bound to it — see [Give a new agent access](#give-a-new-agent-access).

## Secrets

A credential that an LLM provider, MCP server, OAuth provider, OAuth client, trigger or agent names is held in the ADP **secret store** and referenced by ID, so the credential lives in one place and a rotation is one edit rather than one per resource. (A user's own OAuth tokens are not secrets in this sense: those live in the token vault behind **Connections**.) Manage secrets with `rpk ai secret` (see [rpk-ai.md](rpk-ai.md#secret-subcommands)) or under **Secrets store** in the UI sidebar.

- **Shape.** An ID starts with a letter and holds uppercase letters, digits and underscores, up to 255 characters, and is immutable — `OPENAI_API_KEY`, not `openai-api-key`. The value is the credential itself, up to 64 KiB, and is **write-only**: nothing reads it back, in the UI or the CLI, so a lost value is replaced rather than recovered. Tags are key/value pairs for organizing and for policy conditions (see [Tags on ADP resources](#tags-on-adp-resources)).
- **The UI takes a multi-line value.** Pick *Single line* for an API key or token (no leading or trailing whitespace), or *Multiline* for a PEM key or a JSON document, where the form drops one final line break. The credential fields on provider, server and OAuth-provider forms can also store a new value in place, which lands in the same store.
- **What the pickers show.** A credential picker lists only this store's secrets, the ones the AI Gateway can read; a secret Redpanda Cloud holds for another product does not appear, and a new secret cannot reuse its name.
- **A rotation does not require touching the resources.** They keep referencing the ID, and how soon each picks up the new value differs: **within about five minutes** for OpenAI, Anthropic and Google providers, **on the next request** for Amazon Bedrock providers, **on the next call** for self-managed MCP servers authenticating with a static key or service-account OAuth, and **within about ten minutes** for a managed MCP server that uses a secret.
- **Deleting is unchecked and permanent.** Nothing verifies whether a resource still references the secret; those resources keep the reference and fail at their next call. Find and repoint them first.
- **Who can manage them.** Policies name `Secret.create`, `Secret.get`, `Secret.list`, `Secret.update` and `Secret.delete`; the permissions are `dataplane_adp_secret_*`. Admin and the *Standard* and *Full access* templates carry all five; *Read only* and *Sandboxed* carry `get` and `list`. The built-in *Owner lifecycle* policy adds get, update and delete on the secrets **you** created, so no per-person grant is needed for your own. `Secret.get` and `Secret.list` disclose a secret's ID and tags, never its value; to limit someone to a subset, condition the policy on the secret's tags.

## Tags on ADP resources

Tags are key/value labels that let a policy or a report act on a whole team or environment instead of a list of resource names. Agents, MCP servers, LLM providers, guardrails, budgets and secrets all carry them, and a policy can also read the tags on OAuth clients, OAuth providers and policies.

All six are settable in the UI — an agent under **Advanced** → **Tags** on the create canvas and on its Settings tab, an MCP server, LLM provider, guardrail, budget or secret in the **Tags** section of its create form and its edit form or Settings tab. With `rpk ai`: `--tag` on `agent create` / `update`, `--tags` on `mcp-server` and `llm-provider` `create` / `update`, and `--tag` plus `--remove-tag` on `secret create` / `update`. Guardrails and budgets have no flag, so script those through the UI.

- **Limits.** At most 50 pairs per resource, values up to 256 characters, both halves required. An entry whose key already exists replaces that key's value.
- **A write replaces the whole map.** `--tags` on a provider or server update, and a save in the UI, send the full set, so keep the pairs you want. `rpk ai secret update` is the exception: it merges `--tag` onto the stored tags and drops only what `--remove-tag` names.
- **Three consumers, one set of tags.** Policies condition on them, cost reporting groups by them, and lists filter on them. Only the **calling agent's** tags are stamped on an LLM call, never the provider's or the server's, and a call made outside an agent carries none. A budget's own tags do not decide which agents it covers — its target agent does.
- **Lists.** The agents, MCP servers, LLM providers, guardrails and secrets lists show a Tags column (the first to drop on a narrow window); the agents and secrets lists also carry a `Tag` filter matching one `key=value` pair.
- Keep keys consistent across resource types (one `team` key on agents, servers and providers) so one policy and one spend report cover a team's whole footprint, keep values lowercase (a condition compares exactly), and tag at creation — an untagged resource falls outside every policy and report that relies on the tag. Never put secrets or PII in tag values.

## API keys

An **API key** is a long-lived credential that authenticates requests to ADP as **the user who created it**, for cases where a browser sign-in and a short-lived token are awkward: a desktop AI client that reads a key from its configuration, a long-running script, a workstation tool. Every `rpk ai run` session uses one (see [rpk-ai.md](rpk-ai.md#the-session-credential-is-an-adp-api-key)). For a caller that should be a service account rather than a person — an application, a CI job — use OIDC client credentials instead. Keys are managed in the UI only, under **API keys** in the sidebar; there is no `rpk ai` command group for them.

- **Lifecycle.** A key takes a name (name it after the client *and* the machine holding it, so you can tell which to delete later) and an expiration: 1 day, 7 days, 30 days, 90 days, a date you pick, or Never — the default is 30 days. The value is shown **once**; ADP stores only a hash, so a lost key is replaced, not recovered. The expiration is **fixed at creation**: to change it, create a new key and delete the old. Renaming is API-only.
- **Review and revoke.** The list shows each key's prefix and last four characters, its expiry, last use, and creator; an expired key stays listed, marked Expired, until deleted. Deleting is permanent and takes effect within a minute. You see your own keys by default; filtering by creator needs the administrative permissions below.
- **Scope.** One key authenticates both the gateway's runtime traffic and the ADP management API, carries its creator's permissions, and is attributed to that person in the audit log and transcripts. For the headers a client sends, see [gateway-and-providers.md](gateway-and-providers.md#how-a-client-authenticates-to-the-gateway).
- **Offboarding is manual.** ADP does **not** revoke a user's keys when they are deactivated or removed in the identity provider. Delete them as part of offboarding.
- **Permissions.** Creating a key (`dataplane_adp_apikey_create`) comes with the *Sandboxed* template and above. Reading and deleting the keys *you* created, and renaming them through the API, come from the built-in *Owner lifecycle* policy, so no per-person grant is needed. Reading, renaming, or deleting *another* user's keys needs `dataplane_adp_apikey_get`, `_list`, `_update`, `_delete`, which only *Full access* grants.

## Data policies (MCP data shaping)

**Preview.** Configured per MCP server: in the UI on the server's **Data Policies** tab, or with `rpk ai mcp-server create/update --data-policies` (repeatable JSON object; on update it **replaces the full list**, so pass every policy the server should keep). Read them with `rpk ai mcp-server get <name> -o yaml`; list output omits them. See [mcp-servers.md](mcp-servers.md).

A data policy shapes tool-call arguments on the way upstream and results on the way back to the model. Cedar decides **whether** a tool call runs; data policies decide **what the data looks like** for matching callers.

- **Binding:** `tools` (empty = every tool on the server), `principals` as `User:<email>` entries (empty = every caller; group targeting is not supported), and the transforms.
- **Composition:** several policies can match one call; they compose most-restrictively, so adding a policy only narrows.
- **Fail closed:** a rule that can't be enforced denies matching calls.

Transforms:

- **Field actions** (request and response), selected by JSONPath (`$.user.email`; descendant `$..ssn` for mask/drop; no wildcard, index, or filter expressions): `keep`, `drop`, or `mask` with a method — redact (placeholder, default `[REDACTED]`), partial (keep first/last N characters), hash (SHA-256, correlatable; salted hashing isn't supported), or pattern (RE2 substitution). *Drop fields without policy* switches to allowlist mode (only kept fields survive). A **strict** mask/drop rule whose selector matches nothing denies the call (protection against renamed fields); an **absence-safe** rule tolerates a missing field. UI-created rules are absence-safe by default; rules in YAML or `--data-policies` are strict unless marked absence-safe; descendant selectors must be absence-safe.
- **Argument limits** (request): numeric min/max, string length, RE2 pattern, format, allowed values, array item count. Violations are rejected with an error naming the argument, and the limits are merged into the tool's advertised input schema.
- **Row filters** (response): name the array path (`$.body`, `$.result`, or `$`) and a predicate such as `@.priority >= 8` or `@ != "restricted"`. Elements the predicate can't evaluate never survive; predicates on the same array conjoin.

**Preview in the UI:** the **Configuration** tab shows the composed effect for the selected tool across all of the server's policies (including unsaved edits); the **Preview** tab runs sample request and response data through the live shaping code, side by side, and shows masked/dropped/added/filtered counts or a "would be denied" banner.

**A mask hides values, not which records hold them.** On a server that also exposes its data as read-only SQL tables, a caller who can run `execute_query` can filter on a masked column that the table declares filterable, and whether any rows come back tells them whether the value they filtered for exists. Treat a mask as value-hiding only. To stop a caller learning which records exist, withhold `execute_query` from them rather than relying on the mask. The remedy is an access policy that denies `McpServerTool.call` on that one tool, and the single-tool Cedar form is published: see [Deny one tool on one MCP server](#deny-one-tool-on-one-mcp-server). Remember the `when` clause that pins the server, or the deny covers every server with a tool of that name. See [mcp-servers.md](mcp-servers.md#sql-table-exposure-on-a-managed-connector).

Other limits: on legacy SSE self-managed servers, calls matching a policy with response rules are denied. A *Not enforced here* badge means rules save but don't apply on that gateway. The audit log records each matching data policy as Blocked, Masked, or Passed.

## OAuth and identity

OAuth clients govern **inbound** auth (an external MCP client, such as Claude or ChatGPT, authenticating to the AI Gateway). OAuth providers govern **outbound** auth (the gateway authenticating to an upstream system such as GitHub or Slack on a user's behalf). They are separate resources.

### OAuth clients (inbound)

CLI: `rpk ai oauth-client` (`create`, `get`, `list`, `update`, `delete`, `apply`, `diff`, `dcr`, `revoke-tokens`). UI: **Integrations setup** → **Inbound clients** → **Add external tool** (well-known presets prefill redirect URIs, or *Custom client*).

User-configured fields (UI labels): `Name` (becomes the OAuth `client_id`, immutable), `Display name`, `Logo URI`, `Redirect URIs` (exact match), `Allowed MCP Resources` (default `*`), `Grant types` (Authorization Code, Refresh Token), `Token endpoint authentication method` (Client Secret (Basic), Client Secret (POST), None (PKCE only)), `Require PKCE`, `Enabled`. A confidential client's `client_secret` is shown **once** at creation and can't be regenerated; delete and recreate to get a new one.

```bash
rpk ai oauth-client revoke-tokens <name>   # revoke every refresh token issued under the client; idempotent
```

Already-issued short-lived access tokens keep working until they expire (typically minutes). Deleting a client also revokes its tokens.

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

**Client ID Metadata Documents (CIMD)** — **UI only** (no CLI command): **Integrations setup** → **Inbound clients** → **Self-registration** → *Accept client metadata documents (CIMD)*. The client's `client_id` is an HTTPS URL hosting a JSON metadata document; nothing is persisted and the client does not appear in the client list.

| Setting | Behavior |
|---|---|
| *Accept client metadata documents (CIMD)* | On/off. Off: URL `client_id`s are refused and discovery metadata doesn't advertise support. |
| *Trusted document domains* | *Any domain* or *Only these domains*. A listed domain also covers its subdomains; bare public suffixes are rejected. |
| *Allowed resources* | MCP URLs CIMD clients may request tokens for, or any MCP server on the gateway. Turning CIMD on seeds "any"; the UI refuses to save an empty list. |

CIMD works only when **all three** hold: the switch is on, *Allowed resources* is non-empty (a stored empty list behaves exactly like off: no advertisement, URL client IDs refused, DCR fallback preserved), and the gateway can fetch metadata documents. If the settings show *Not active on this gateway*, the last condition fails and only the gateway operator can fix it. Allowed-resources matching is exact: copy each URL from the server's **Connection** tab, drop trailing slashes, and list a code-mode server's `Code mode URL` separately (see [mcp-servers.md](mcp-servers.md)). Because CIMD clients are admitted with no admin seeing them, prefer *Only these domains* and keep *Allowed resources* narrow.

### OAuth providers (outbound)

CLI: `rpk ai oauth-provider` (aliases `oauth`, `op`; `create`, `get`, `list`, `update`, `delete`, `apply`, `diff`). UI: **Integrations setup** → **Outbound providers** → **Add provider** (catalog preset, *Custom Provider*, or *Discover from MCP server URL*).

User-configured settings: name (positional, immutable), display name, authorization / token / revocation endpoints, client ID (immutable), client-secret reference (secret-store key in `UPPER_SNAKE_CASE`), scopes, grant types (select browser consent; token exchange is not usable), token-endpoint auth method, PKCE required, extra auth/token params, `--register-from-url` (discovery), `--enabled` (a new provider is **disabled** unless set), and, for Slack, the token type below. You can't delete a provider while an MCP server uses it; deleting one revokes every stored user token for it. Providers Redpanda creates for an MCP server are *Managed* and can't be edited or deleted.

#### How discovery registers this gateway (DCR and CIMD)

*Discover from MCP server URL* (CLI `--register-from-url`) points Redpanda at a remote MCP server and lets it work out the upstream OAuth setup. Registering this gateway as a client with the upstream authorization server follows a ladder, in order:

1. **Credentials you supply** — the client ID and client-secret reference you enter yourself.
2. **Client ID Metadata Documents (CIMD)**, where the upstream authorization server advertises support. The gateway identifies itself by the HTTPS URL of a metadata document it publishes about itself; that URL *is* the `client_id`. Nothing is registered upstream, which is why this rung is tried before DCR.
3. **Dynamic Client Registration (RFC 7591)**, where the upstream offers a registration endpoint.
4. **Manual setup** — you register the client with the upstream yourself and enter its credentials.

What follows from that:

- An upstream whose OAuth setup supports **only** CIMD, with no DCR, connects through this same discovery flow; it does not need manual setup.
- A CIMD `client_id` is a public document URL, not a secret. It is the identity the upstream vendor sees, so it is the value to hand over for an allowlist, and the URL to open when an authorization request is rejected. Discovery reports it.
- CIMD needs this deployment to know its own external HTTPS address. Where it cannot, discovery falls back to the DCR rung.
- `rpk ai oauth-provider get <name> -o yaml` marks a provider admitted on the CIMD rung with `cimd_client: true`. It is set by the system at creation and is not a field you write. Such a provider holds no client registration at the upstream authorization server.

This is the **outbound** direction. The separate inbound setting that admits *other* clients to this gateway by metadata document is [above](#inbound-client-registration-dcr-and-cimd); the two are independent.

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

Existing Slack connections keep their bot identity and need no reconnection. See [mcp-servers.md](mcp-servers.md#remote-auth-modes) for the `user_oauth` side of this.

### Your OAuth connections

`rpk ai connection list` / `rpk ai connection revoke` (UI: **Connections**) manage **your own** per-user connections to OAuth providers; the built-in self-service policy lets every user do this. Connections are isolated per user. Listing or revoking **other** users' connections is a separate administrator permission; there is no CLI command for it in `rpk ai`.

### Capabilities that are not offered

- The AI Gateway does no per-second/minute/day rate limiting, routing, or failover; use budgets to cap spend (see [gateway-and-providers.md](gateway-and-providers.md)).
- Access policies govern only ADP resources; they cannot govern resources outside it.
