Source: `cloudv2 apps/rpai/testdata/commands-snapshot.md` (`budget`, `spending`, `guardrail`, `--guardrail`, `kill-switch-policy`, `agent-kill-switch`), `adp-docs modules/control/pages/` (`budgets.adoc`, `cost-usage.adoc`, `cost-allocation-tags.adoc`, `guardrails/`, `kill-switch/`), `modules/cli/pages/index.adoc`. Full per-claim mapping and the dated verification log: the `references/governance.md` entry of this skill's `SOURCES.md`; for the moved subcommand sections, the `references/cli.md` log of `skills/adp/SOURCES.md`.

# Agentic Data Plane Spend and Safety Reference

## Budgets

In the UI, open **Budgets** in the sidebar; from the terminal, `rpk ai budget` (`create NAME`, `get`, `list`, `update`, `delete`).

```bash
# The tenant default: every agent gets its own pool of this limit
rpk ai budget create fleet-default --pooling-mode per-agent --period monthly \
  --limit-usd 100 --warn-at-usd 80
# One agent's override
rpk ai budget create invoice-monthly --pooling-mode per-agent --period monthly \
  --filter-agent-name agents/invoice --limit-usd 10 --warn-at-usd 8
```

`--pooling-mode` and `--period` are both required. Pass `--pooling-mode per-agent` for the tenant default *and* for a per-agent override; `--filter-agent-name agents/<slug>` is what makes it an override. A budget name starts with a lowercase letter and holds only lowercase letters, digits and hyphens.

A budget caps LLM spend per agent over a recurring period. Its **limit** (`Limit spend to`) is a hard cap on per-period spend, entered in dollars: when an agent's spend reaches it, that agent's next LLM request gets `HTTP 429` until the period resets. Its **warning threshold** (`Warn at`) must be greater than zero and less than the limit, 80% of the cap by default; past it requests still pass and gateway responses carry a `SpendLimit-Warning` header. The **period** is daily, weekly or monthly, calendar-aligned in UTC (00:00 daily, 00:00 Monday weekly, 00:00 on the 1st monthly). The **target agent** is unset for the tenant **default** budget and set to `agents/<slug>` for a **per-agent override**; it is immutable, so retargeting means delete and recreate.

- **Pooling is per agent.** The default budget gives every agent its own independent pool of the limit; one agent hitting its cap does not affect another. There is no shared tenant-wide pool.
- One default per tenant; at most one override per agent. An override replaces the default for that agent.
- Adding, or deleting and recreating, an override mid-period does **not** reset usage: while a default exists, the override inherits the default's current window. Editing a limit never moves the window.
- Only calls made **as an agent** (including on a user's behalf) are capped. A user calling the gateway directly is never capped. If the gateway can't read current spend, it lets the request through (fail-open).
- A capped request's `429` body uses the provider's own rate-limit format (OpenAI-format: code `budget_exceeded`; Anthropic `rate_limit_error`; Google `RESOURCE_EXHAUSTED`; Bedrock `ThrottlingException`). The message names the budget, spend against the cap, and reset time.
- Guardrail evaluation is not counted against budgets.
- **A call the caller's own subscription covered is recorded at $0 and never counts against a budget.** With authorization passthrough (see `/redpanda:adp`, *Authorization passthrough*) on an Anthropic provider pointed at `api.anthropic.com`, or an OpenAI or OpenAI-compatible provider pointed at `chatgpt.com`, ADP reads the plan state the vendor reports on each response: a call that plan covered is priced at zero, with its request and tokens still recorded, so **a budget cannot cap that traffic**. Usage past the plan, and any call whose plan state cannot be established — no plan state reported, or any other upstream host such as a proxy or aggregator — is priced from the provider's rate card as usual.

### Amounts and units

The UI takes and shows budget amounts in **dollars**, and cost reporting and CSV exports show **USD**. Raw stored cost values are in **USD microcents** (1 cent = 1,000,000 microcents; $1 = 100,000,000). If you ever see a `*_microcents` value, divide by 100,000,000 for dollars; never treat it as cents.

On the CLI, enter dollars with `--limit-usd` / `--warn-at-usd` rather than converting; each **stands in for** its `--*-microcents` partner rather than joining it (see [`budget` subcommands](#budget-subcommands)).

**The warning threshold is a percentage in the UI and an amount on the CLI.** The create form takes `Warning threshold` as a percent of the limit (1-99, 80 by default) and shows the dollar figure it resolves to; `--warn-at-usd` and `--warn-at-microcents` take the amount itself. Don't pass `80` to `--warn-at-usd` expecting 80%.

## Cost and usage

In the UI, open **Cost and usage** in the sidebar. Every LLM call routed through the gateway is recorded and priced automatically (input, output, and cached tokens; cost; request count; provider, model, user, agent context). Prices come from the built-in per-model catalog or per-provider overrides (`rpk ai llm-provider create/update --pricing`, see `/redpanda:adp`). Pricing is resolved per provider and model, so a call is priced with the rates of the provider that served it, and the same model offered by two providers is priced separately for each. Cost reporting works with no pricing setup at all.

The **Cost & usage** tab shows spend, requests and tokens for a UTC time window, compared with the previous period of the same length, and a **Spend breakdown** by **Agents**, **Models**, **Providers**, **Users** or **Tags**, with CSV export.

On the **Models** tab a row is **one model as served by one provider**, not the model on its own, so duplicate-looking model rows are per-route costs rather than a bug; a call whose provider details were not recorded keeps its row and says the provider configuration is unknown. Filtering spend by a model covers every dated version of it; a name differing by more than a trailing date stays separate (`gpt-4o-mini` is its own model, as is each regional version of a model served through Amazon Bedrock), and because the breakdown lists each exact recorded identifier, a charted model's spend can exceed the row you charted it from. Synthetic rows: *Direct usage* (calls not made through an agent), *Unattributed* (no user recorded), *Untagged* (no value for the chosen tag key), and *Deleted provider* rows that keep history complete.

### Cost-allocation tags

Cost-allocation tags are the agent's own tags (see [Tags on ADP resources](identity-and-secrets.md#tags-on-adp-resources)), stamped on every LLM call it makes as a snapshot. **Attribution is point-in-time:** retagging never rewrites past spend, new spend picks up new tags, and a change takes a short time to apply. Spend with no value for the grouped key — direct user calls, untagged agents, the window before a new agent's tags apply — collapses into one *Untagged* row.
- In the UI: **Spend breakdown** → **Tags** tab → choose a tag key. The key list shows only keys seen on spend in the current window. Tag rows can be opened for a chart but can't be charted against the gateway total, and the full-report export doesn't group by tag (use *Breakdown table as shown*).
- Limits: at most 50 tags per agent; values up to 256 characters. Don't put secrets or PII in tag values; they appear in cost reports.

## Guardrails

**Preview.** The UI (**Guardrails** in the sidebar) is where you author a guardrail's policies. `rpk ai guardrail` also carries `create`, `get`, `list`, `update`, `delete` and a read-only `providers`, so read `rpk ai guardrail create --help` before concluding a task needs the UI. Attaching one to an LLM provider is a CLI job either way.

A guardrail is a bundle of safety policies backed by **Amazon Bedrock Guardrails**. It inherits the credentials and region of the Bedrock LLM provider you pick at creation, so a Bedrock provider must exist first. The name and provider connection are fixed after creation.

### Create and enable (UI)

Creating one asks for a name (its derived ID is lowercase letters, numbers and hyphens, 1-63 characters, **immutable**), an optional template that seeds editable policies, a rollout (*Monitor first*, created disabled and recommended, or *Enforce now*, which **needs a template**), and the Bedrock provider whose credentials and region it inherits. Then configure policies on **Policies** and **Save and apply** — the save reaches **every** provider using the guardrail. Blocked-prompt and blocked-response messages are 1-500 characters each. **Enable guardrail** stays unavailable until at least one saved policy is configured, and enabling, disabling and edits take effect within about 30 seconds.

### Attach to an LLM provider

A guardrail does nothing until a provider references it. Each provider references at most one guardrail; a guardrail can back many providers.

```bash
rpk ai llm-provider update <provider-name> --guardrail <guardrail-name>
rpk ai llm-provider update <provider-name> --clear guardrail   # detach
```

The UI shows the guardrail setting only on Bedrock providers; for any other provider type (OpenAI, Anthropic, Google, and so on) use the CLI. On a Bedrock provider, Bedrock enforces the guardrail in the model call. On other providers, the gateway sends each prompt and response to Bedrock for evaluation, so that text reaches AWS even if the model runs in your network. You can't delete a guardrail while any provider references it; detach first.

### Policy types

Each policy is optional, but a guardrail needs at least one to be enabled.

- **Content filters.** Exactly six categories exist — `Hate`, `Insults`, `Sexual`, `Violence`, `Misconduct` and `Prompt attack` (input only) — each taking a strength and an action of `None` (detect) or `Block` per direction. Don't use another category taxonomy.
- **Word filters:** custom words plus managed lists, `None` or `Block` per direction. **Denied topics:** semantic matching, so it catches paraphrases, up to 30 topics. **Sensitive information:** built-in PII entity types plus custom RE2 regexes, with `None`, `Block` or `Anonymize` per direction.
- **Contextual grounding** is output only, with grounding and relevance thresholds from 0.0 to 0.99. **Automated reasoning** is output only and **detect-only — it never blocks**; it takes versioned Bedrock Automated Reasoning policy ARNs (`DRAFT` is rejected).

### Blocking behavior

- A blocked input returns the configured blocked-prompt message; a blocked output returns the blocked-response message instead of the model's response.
- `Anonymize` replaces each match with its entity type (for example `{EMAIL}`). On output, the redacted response is delivered. On input: a Bedrock provider masks and forwards the prompt; other providers short-circuit the request like a block.
- Evaluation **fails closed**: if the gateway can't complete an evaluation, it rejects the request.
- Streaming output on non-Bedrock providers is evaluated in text batches; if a batch is blocked, the caller gets the blocked message in its place and the stream ends (earlier batches are already delivered).
- Guardrail activity appears on the request's trace in transcripts; when the gateway evaluated the guardrail itself (non-Bedrock path), the audit log also records the block or mask and names the guardrail. See `/redpanda:adp-observability`.
- AWS bills Bedrock guardrail evaluation to the AWS account whose credentials the guardrail uses; it is not in ADP cost reporting.

## Kill switch

**Containment** is an emergency stop for one agent's traffic. You can apply it yourself, and a **kill switch policy** can apply it for you: a policy watches one of the agent's safety signals and, in Enforce mode, contains the agent when that signal spikes. Either way the agent stays contained until someone releases it. Containment acts at the AI Gateway: it denies the agent's calls to LLM providers, MCP servers and other agents and every A2A call to it, and cancels calls in progress, streams included. The agent's runtime keeps running, the agent cannot release itself, and containment never expires on its own. Manage policies on the agent's **Govern** tab or with `rpk ai kill-switch-policy` (see [`kill-switch-policy` subcommands](#kill-switch-policy-subcommands)); contain and release with the agent page's own controls or `rpk ai agent-kill-switch`.

- **Signals.** *Guardrail block rate*, *Data policy deny rate*, or *Evaluation error rate*. A policy can fire only if something on the agent produces its signal (a guardrail on its LLM provider, or an MCP server with data policies), and the UI refuses to save one that has no source.
- **Detection.** Each signal is evaluated in 5-minute windows, and a window with fewer than 10 calls is skipped. *Burst* fires when one window clearly exceeds the threshold; *Drift* fires on a sustained shift and ignores isolated spikes. In the UI, the Low, Medium (default) and High sensitivity presets set the values, and a backtest replays the agent's last 7 days before you save.
- **Observe, then Enforce.** New policies start in **Observe**, which only records firings. **Enforce** contains the agent on each firing. *Evaluation error rate* policies are Observe only. A Burst policy in Enforce fires on a single spike, which a prompt injection can cause deliberately, so prefer Drift for Enforce. Promote a policy once its firings match real incidents.
- **What a caller sees.** HTTP 403 with code `agent_contained`, with a message naming the agent and the reason (for a policy, the policy, its detection method and the rate). MCP clients get JSON-RPC error `-32003`. There is no retry hint.
- **Contain and release by hand.** **Contain agent** and **Release agent** sit in the agent page's header on every tab, and the containment banner repeats the release action. From the terminal:

  ```bash
  rpk ai agent-kill-switch get    --agent agents/<agent-id>
  rpk ai agent-kill-switch update --agent agents/<agent-id> \
    --kill-switch.enabled --kill-switch.reason "<why>"      # contain
  rpk ai agent-kill-switch update --agent agents/<agent-id> \
    --kill-switch.enabled=false                              # release
  ```

  Containing **requires a reason** (up to 1024 characters); it reaches the audit log and every denied response, so write it for whoever reads the failure. Releasing takes none. Fix what got the agent contained before you release it — for a policy firing, read it on the **Govern** tab. On release, gateway calls resume within seconds, but canceled calls are **never replayed** and a runtime that was stopped stays stopped. Deleting a policy does not release an agent it contained.
- **The contain and release controls stay clickable for everyone,** because the permission is checked when the request arrives rather than before the control is drawn. Without it the dialog reports that the change failed and keeps your reason on screen, so you can hand it to someone who has the permission. Don't read an enabled button as proof of access.
- **Where it shows.** A contained agent carries a `Contained` badge in its page header, a containment banner on every tab naming when, by whom and why, and the status `Contained` in the **Agents** list. The Govern tab lists each policy's firings in the last 7 days and marks each one *Recorded only* (Observe) or *Contained* (Enforce), carries a red dot while the agent is contained, and refreshes containment state every 10 seconds while you are on it; the Settings tab summarizes coverage as No policy, Observing or Enforcing.
- **Permissions.** Every built-in template, *Read only* up, can read containment state, policies and firings. Only *Full access* and the Admin role can create, change or delete policies or contain and release an agent; *Standard* leaves them out on purpose, so permission to edit an agent doesn't include permission to release it.

## `kill-switch-policy` subcommands

Aliases: `kill-switch-policies`, `ksp`, `kill-switch`. Subcommands: `create <name> --parent agents/<agent>`, `get`, `list --parent agents/<agent>` (the parent is required), `update`, `delete`, `firings` (list kill-switch firings), `signal-history` (an agent's signal history). A policy belongs to one agent and watches one signal (`--spec.signal guardrail-block-rate|datapolicy-deny-rate|evaluation-error-rate`) with *Burst* (`--spec.burst.threshold`, `--spec.burst.confidence 95|99|999`) or *Drift* (`--spec.drift.baseline`, `.slack`, `.threshold`) detection. `--spec.mode shadow` is the UI's **Observe** and `enforce` its **Enforce**. `create` and `update` take `-f` and `--dry-run` like other groups. For what containment does and who may manage it, see [Kill switch](#kill-switch).

## `agent-kill-switch` subcommands

`get` and `update`, each taking `--agent agents/<agent-id>`: `update` contains or releases one agent, `get` reports its state. Containing **requires a reason**; releasing takes none. If the group is not recognized, the installed plugin predates it — run `rpk ai upgrade`. For the commands, what containment does and who may do it, see [Kill switch](#kill-switch).

## `budget` subcommands

Alias: `budgets`. Subcommands: `create NAME`, `get`, `list`, `update`, `delete`. Amounts are stored in USD **microcents** ($1 = 100,000,000), so enter dollars with `--limit-usd` / `--warn-at-usd` — a positive decimal with at most eight places — rather than converting by hand. **Each USD flag stands in for its `--*-microcents` partner rather than joining it:** pass one of a pair, never both, and don't combine one with `--clear` of the same field. `delete` now takes `--dry-run`, like `create` and `update`. See [Budgets](#budgets).

## `guardrail` subcommands

Alias: `guardrails`. A generated group with `create`, `get`, `list`, `update`, `delete`, plus a read-only `providers`. Read `rpk ai guardrail create --help` for what the CLI can set before you send a user to the UI.
