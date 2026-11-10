# ADP Skill Source Map

The skill is thin: it keeps only the "How to work" procedures below, each backed by a behavioral
eval case in `evals/suites/adp.eval.json`, and sends the agent to the docs for everything else.
This file maps only the claims the skill still makes.

The `rpk ai` CLI and the AI Gateway live in the **private** repo `redpanda-data/cloudv2`
(`apps/rpai/` for the CLI, `apps/aigw/` for the gateway, `proto/public/cloud/redpanda/api/adp/`
for the API). Read it with `gh api` or the Redpanda-Github-Read connector; do not clone it. The
ADP docs source is the private `adp-docs` repo, published at
https://docs.redpanda.com/agentic-data-plane/. The Redpanda Docs MCP server
(`https://docs.redpanda.com/mcp`) indexes those pages: `ask_redpanda_question` returns them with
or without `platform: "cloud"` (they are not versioned), and `get_rpk_command` returns `rpk ai`
commands from the latest published plugin (checked 2026-11-10).

The golden help snapshot `apps/rpai/testdata/commands-snapshot.md` that earlier versions of this
map cited no longer exists. Use live `rpk ai <command> --help`, `get_rpk_command`, or the command
source under `apps/rpai/internal/cmd/` instead.

## How to work: line, source, eval case

| How to work line | Source | Eval case |
|---|---|---|
| Put `enabled: true` in a trigger manifest you apply: a missing `enabled` means false, so the trigger is created or left paused, while `rpk ai trigger create` enables by default. Baseline 0/3, skill 3/3, installed 3/3 (docs 1/3, both 2/3) on 2026-11-10. | `cloudv2` `apps/rpai/internal/cmd/trigger/gitops.go` and `gitops_test.go` (`TestGitOpsTriggerApply_CreateThenReapplyIsUnchanged`: omitted enabled means false rather than the server's true default); `apps/rpai/internal/cmd/trigger/create.go` (`--enabled` default true) | `apply-daily-trigger-manifest` |
| Build a GitOps manifest from `get -o yaml` before `apply`, because a field left out is cleared; check with `diff` first. Safety guardrail (an apply of a partial manifest wipes an agent's system prompt, MCP servers and tags): the baseline passed its case 3/3 on 2026-11-10, and the line and case stay as a regression guard. | `cloudv2` `apps/rpai/internal/cmd/agent/gitops.go` and the shared `apply` / `diff` help text ("A manifest is the COMPLETE desired state, so a field you omit is not left alone") | `agent-gitops-raise-iterations` |

## Other claims in SKILL.md

| Claim | Source | Eval case |
|---|---|---|
| `get_rpk_command` returns one `rpk ai` command's flags and defaults from the latest published plugin; ADP docs are not versioned | Live `get_rpk_command` for `rpk ai trigger create` and `rpk ai docs search` (plugin `ai` 0.2.110, checked 2026-11-10); `ask_redpanda_question` tool description (ADP docs are version-neutral) | none |
| When the Docs MCP server refuses for quota and no page fetch is possible, tell the user to sign in through `/mcp` | `skills/redpanda-docs/references/SOURCES.md` (anonymous quota row) | none |
| `rpk ai docs` and `rpk ai docs search` read the published ADP docs without a sign-in | `cloudv2` `apps/rpai/internal/cmd/docs/cmd.go`; `adp/RELEASE_NOTES.md` | none |
| `rpk ai mcp-server types`, `rpk ai llm-provider types` and `rpk ai model list` list the live catalogs | `cloudv2` `apps/rpai/internal/cmd/mcp/`, `apps/rpai/internal/cmd/llm/`, `apps/rpai/internal/cmd/model/` | none |

## Docs gaps (not skill claims; do not re-verify here)

Facts the 2026-11-10 eval found the published docs lack or state wrongly:

- **`RPAI_TOKEN` is ignored under `rpk ai`.** Only `--token` supplies a static bearer token. The
  "Environment variables" table on
  https://docs.redpanda.com/agentic-data-plane/gateway/connect-agent/ says `rpk ai` honors
  `RPAI_TOKEN`, which is wrong. Source: the `--token` flag help in `cloudv2` `apps/rpai/` ("ambient
  RPAI_TOKEN is ignored under rpk ai"). Eval case `rpai-token-env-ignored`: docs 0/3, skill 3/3.
- **Which `rpk ai doctor` checks are warnings.** https://docs.redpanda.com/agentic-data-plane/cli/
  says doctor exits non-zero only on an error, but not that "no environment selected" is a warning
  while a selected environment that cannot be resolved is an error. Source: `cloudv2`
  `apps/rpai/internal/cmd/doctor/doctor.go`. Eval case `doctor-no-env-is-warning`: docs 0/3,
  skill 3/3.

Gaps in `rpk ai` help text, to fix at source in `cloudv2` `apps/rpai/`, not in the docs:

- `rpk ai agent credential create --ttl` says "0 means no expiry", but 0 sends no expiry and the
  gateway applies its 90-day default (`apps/aigw/internal/services/serviceaccount/service.go`,
  `apps/aigw/config/config.go`). The docs arm passed this case 3/3.
- The LLM provider `transcripts` field descriptions in
  `proto/public/cloud/redpanda/api/adp/v1alpha1/llm_provider.proto` say "Disabled by default",
  but a create with no transcripts settings records both inputs and outputs
  (`apps/aigw/internal/services/llmprovider/service.go`).

## Lines removed for lack of a failing baseline

All checked on 2026-11-10 against a mocked `rpk ai` shell, 3 runs per arm:

- "Pass `--enabled` when creating an MCP server with `rpk ai`, because the CLI creates it
  disabled": case `register-remote-mcp-for-claude-code`, baseline 3/3. Without the skill, the
  agent saw the disabled server in the create output and enabled it.
- "A new agent has no policy of its own; its creator's successful test says nothing about a
  trigger-started run": case `scheduled-agent-has-access`, baseline 3/3. `rpk ai agent create`
  prints the no-access notice, and the baseline bound a policy or told the user.
- "Creating an LLM provider records prompts and completions unless you turn it off": case
  `hr-provider-keep-no-content`, baseline 3/3 (and 3/3 in every other arm). On a request that
  said content must not be kept, the baseline passed both `--transcripts.record-*-messages=false`
  flags on create.
- The remaining "Key patterns and gotchas" of the full skill (exit codes, cost units, secret
  piping, passthrough credentials, `rpk ai run` session keys, model checks, reasoning effort,
  subagent MCP servers, code mode, output format, `user_oauth` tool lists, Slack identity, audit
  log scope, `connection`, Bedrock naming) were facts, not procedures, so they belong in the
  docs. The fact cases sampled from them found the docs cover most of them, except the gaps
  above.
