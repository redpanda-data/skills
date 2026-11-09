Source: `cloudv2 apps/rpai/testdata/commands-snapshot.md` (`policy`), `cloudv2 apps/rpai/internal/cmd/policy/` and `agent/`, `cloudv2 apps/adp-api/internal/seed/`, `adp-docs modules/control/pages/` (`access-policies.adoc`, `permissions-overview.adoc`, `permissions-reference.adoc`). Full per-claim mapping and the dated verification log: the `references/governance.md` entry of this skill's `SOURCES.md`; for the moved subcommand sections, the `references/cli.md` log of `skills/adp/SOURCES.md`.

# Agentic Data Plane Access Control Reference

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

**A new agent has no policy of its own.** Creating an agent writes no policy for it, so you decide what it may reach. `rpk ai agent create` prints a notice on **stderr** saying the agent has no access until a policy names it, with the two commands below, leaving stdout as the created object so `-o json` output stays parseable. In the UI, a managed agent's **Permissions** tab warns until you author one. Registering a self-managed agent in the UI is the exception: its create page carries a required **Access** section that writes the first policy for you. Whether a given call was checked against policies at all shows in the audit log: a call that bypassed policy evaluation carries the status detail `allowed by internal-caller exemption; no policy evaluated` (see `/redpanda:adp-observability`, *Audit log*).

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

**Or create the agent and its policy in one command.** `rpk ai agent create <name> --policy-template <template>` takes the same template values and creates the same `<name>-access` policy as `policy create --agent <name> --template <template>`, so a new agent can make runtime calls straight away:

```bash
rpk ai agent create invoice-triage --policy-template sandboxed
```

- The template is checked **before** the agent is created, so a template that cannot be resolved leaves no agent behind.
- If the agent is created and the bind then fails, **the agent exists with no access**: the created agent still goes to stdout, the error names the `rpk ai policy create` call that binds the template by hand, and the command exits non-zero — under `set -e` a script stops there with the agent already created. Recover by running the named command, not `agent create` again.
- An already-existing `<name>-access` policy is reported as exactly that rather than as a lack of access; read what it grants with `rpk ai policy get` before adding another.

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
- **An agent's children evaluate with the agent's tags.** `AgentCredential`, `AgentKillSwitch`, `AgentTrigger`, `AgentTriggerRun`, `KillSwitchPolicy`, `Session` and `Transcript` carry no tags of their own, so a tag condition on any of them matches the parent agent's tags, read at decision time — retagging the agent moves all of them with it, and a child has nothing of its own to tag. That widens a grant further than it looks: a `permit` conditioning on a tag without pinning the resource type reaches the children as well as the agent, and with the action unpinned too it lets the principal mint that agent's credentials and change its kill switch. **Pin `resource is Agent` to grant by tag on the agent alone.** None of the children carries `changed_tags`, so you can condition on their current tags but not on a tag transition.

**Do not copy the Cedar action from the `rpk ai policy create --help` example.** Actions must be entity-qualified action IDs (for example `Action::"McpServerTool.call"`). If a policy fails to save with `Unknown action` because you used a role-permission name, the error names the action ID to use instead.

Data shaping (masking, dropping, row filtering) is **not** configured in Cedar; it lives on the MCP server's data policies (below).

#### Condition on the caller network

A condition can also read `context.ip_address`, the address the listener resolved for the request. Unlike a resource attribute it is **always declared, so it takes no `has` guard** — and a `context has ip_address` guard is rejected at save time, because a guarded `forbid` would skip every caller whose address did not resolve and so fail open. It holds an address rather than text: compare it with `ip()` or test it with `isInRange()`.

```cedar
forbid (
  principal is User,
  action,
  resource
) unless {
  context.ip_address.isInRange(ip("203.0.113.0/24")) ||
  context.ip_address.isInRange(ip("10.20.0.0/16"))
};
```

- **Requests from inside the environment carry the environment's address, not the person's.** A managed agent acting for a user, a cron trigger firing, and a Teams message reaching an agent all authorize as that person but arrive from inside the environment. An allowlist holding only your user networks denies every one of them, so include the environment's own addresses — read them from the audit log's **Source IP**, which reports the same value the policy evaluates, before you enforce.
- **An unresolved address has no placeholder value.** A `forbid` that reads it errors, and an erroring `forbid` denies; a `permit` that reads it grants nothing. Policies that don't read it are unaffected.
- Leaving the action unpinned, as above, also covers the `Policy` actions, so an admin outside every listed range cannot edit or delete the policy. Keep a range you can always reach, or list the actions to restrict instead.
- Validation rejects an address compared with text (`== "203.0.113.7"`) and a range passed as text (`isInRange("203.0.113.0/24")`). Write IPv4 ranges in plain dotted form; an IPv4 client that arrives over IPv6 still matches them. **The condition builder offers no address conditions** — write these in the **Cedar** view.

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

There are no built-in invoker or transcript-reader roles for ADP. Grant runtime-only or read-only access with an access policy. Older organizations may still carry legacy invoker and transcript-reader roles; don't build new grants on them. A **custom role** holding ADP permissions still works, for when you need a permission bundle bound at a control-plane scope. Until access policies are enabled for an organization, Admin or a custom role is the only way to reach ADP.

**Permission families.** The full list with the operation each one gates is in the ADP roles and permissions reference. The families, and what is not obvious about them:

- `dataplane_adp_mcpserver_*` covers both MCP server management (create, get, list, update, delete) **and** each MCP protocol call against a running server (`initialize`, `tools_list`, `tools_call`, `resources_read`, `prompts_get`, …).
- `dataplane_adp_llmprovider_*` manages providers; `_invoke` is what proxies LLM requests at runtime and `_check_connection` tests a saved or draft provider.
- `dataplane_adp_agent_*` covers agent configuration, with `dataplane_adp_agent_credential_*`, `_agent_trigger_*` and `_agent_session_*` for credentials, triggers and conversation sessions; `dataplane_adp_a2a_invoke` covers every A2A runtime call to an agent.
- `dataplane_adp_transcript_*` reads transcripts, `dataplane_adp_auditlog_list` the audit log, and `dataplane_adp_agentnetwork_get` the Agent network view. `dataplane_adp_trace_*` splits three ways: `_list` for the list and its timeline, `_get` for one trace's spans, `_content_read` for span content nobody owns.
- `dataplane_adp_apikey_*`: `_create` mints your own, while `_get`, `_list`, `_update` and `_delete` reach *other people's* keys. `dataplane_adp_secret_*` covers the secret store, where no permission returns a value — `_get` and `_list` disclose IDs and tags only.
- `dataplane_adp_spending_get`, `dataplane_adp_budget_*` and `dataplane_adp_guardrail_*` cover cost reporting, budgets and guardrails. `dataplane_adp_policy_*` and `dataplane_adp_policytemplate_*` author policies and templates — granting either is equivalent to granting everything a policy can grant.
- `dataplane_aigateway_*` covers OAuth clients, DCR and CIMD settings, OAuth providers (including attaching one to an MCP server), and OAuth connections (`connection_manage` for your own, `connection_admin` for everyone's).

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
- **No policy is created for a new agent**; bind one (see [Give a new agent access](#give-a-new-agent-access)). An older agent may carry an editable `Agent grant: <agent-name>` policy, which isn't recreated once deleted.

## `policy` subcommands

Aliases: `policies`, `pol`. Subcommands: `create`, `get`, `list`, `update` (Cedar body or metadata), `delete`, `apply`, `diff`, plus two that touch no stored policy: `analyze` parses and validates draft Cedar against the environment's schema, and `format` formats draft Cedar without saving it or overwriting the input. Use `analyze` to catch an unknown action or entity before a save, which is where most policy errors land. See [governance.md](../SKILL.md).

`create` also takes `--agent <id>` and `--template readonly|sandboxed|standard|full`, which bind a policy to one agent in one command — how a new agent, which gets no policy at create time, gets its first. See [Give a new agent access](#give-a-new-agent-access).
