# ADP Skill Source Map

Maps each file in `skills/adp/` to the sources its claims derive from, so future syncs
and human maintainers know where to verify them.

## Scope

The skill covers the `rpk ai` CLI, the ADP UI (ai.redpanda.com), and the endpoints
applications call. Verify CLI claims against the `rpk ai` help output (golden snapshot:
`cloudv2` `apps/rpai/testdata/commands-snapshot.md`, or live `rpk ai --help`) and UI and
behavior claims against the ADP product docs (`adp-docs`).

## File-to-source table

| Skill file | Sources |
|---|---|
| `skills/adp/SKILL.md` | Summary of the reference files below; `cloudv2` `apps/rpai/testdata/commands-snapshot.md` (command tree, `rpk ai`-mode global flags) |
| `skills/adp/references/rpk-ai.md` | `cloudv2` `apps/rpai/testdata/commands-snapshot.md`, `apps/rpai/internal/cmd/` (auth, env, connection, trigger, run, llm pricing), `apps/rpai/internal/gitops/`, `apps/rpai/.goreleaser.yaml` and the publish manifest (platforms); `redpanda` `src/go/rpk/pkg/cli/ai/` (public: install path, lifecycle errors); `adp-docs` `modules/cli/` |
| `skills/adp/references/agents.md` | `cloudv2` `apps/rpai/testdata/commands-snapshot.md` (`agent`, `a2a`, `trigger`), `apps/rpai/internal/cmd/agent/`; `docs` `modules/reference/partials/rpk-ai/` (generated `rpk ai agent` flag tables); `adp-docs` `modules/connect/pages/` (`create-agent.adoc`, `self-managed-agents.adoc`, `concepts.adoc`, `triggers/`), `modules/monitor/pages/monitor-agents.adoc`, `modules/cli/pages/gitops.adoc` |
| `skills/adp/references/mcp-servers.md` | `cloudv2` `apps/rpai/testdata/commands-snapshot.md` (`mcp-server` group); `adp-docs` `modules/connect/pages/` (`create-server.adoc`, `data-policies.adoc`, `user-delegated-oauth.adoc`, `remote-mcp-clients.adoc`, `oauth-providers.adoc`, `managed/`), `modules/connect/partials/integrations/`, `modules/gateway/pages/code-mode.adoc`; `docs` `modules/reference/partials/rpk-ai/` (generated `rpk ai mcp-server` flag tables) |
| `skills/adp/references/gateway-and-providers.md` | `cloudv2` `apps/rpai/testdata/commands-snapshot.md` (`llm-provider`, `model`), `apps/rpai/internal/cmd/llm/`, `apps/rpai/internal/cmd/model/`; `adp-docs` `modules/gateway/pages/` (`configure-provider.adoc`, `overview.adoc`, `bedrock-setup.adoc`) |
| `skills/adp/references/governance.md` | `cloudv2` `apps/rpai/testdata/commands-snapshot.md` (`policy`, `oauth-client`, `oauth-provider`, `connection`, `--guardrail`, `--data-policies`); `adp-docs` `modules/control/pages/` (`budgets.adoc`, `cost-usage.adoc`, `cost-allocation-tags.adoc`, `guardrails/`, `access-policies.adoc`, `permissions-overview.adoc`, `permissions-reference.adoc`), `modules/connect/pages/` (`data-policies.adoc`, `remote-mcp-clients.adoc`, `oauth-providers.adoc`); `docs` `modules/reference/partials/rpk-ai/` (generated flag tables for `oauth-client dcr iat`, `oauth-provider --slack-token-type`, `--register-from-url`) |
| `skills/adp/references/observability.md` | `cloudv2` `apps/rpai/internal/cmd/agent/` (transcript commands), `apps/rpai/testdata/commands-snapshot.md`; `adp-docs` `modules/monitor/pages/` (`transcripts.adoc`, `audit-log.adoc`, `agent-network.adoc`, `monitor-agents.adoc`), `modules/get-started/pages/adp-quickstart.adoc` |

## Usage

The `adp-skill-sync` routine (defined in `skills-sync-routine.md` at the repo root) and
human maintainers use this map when re-verifying the skill. For each file being reviewed
or updated, open the listed sources first and confirm that every claim still matches.

Paths are relative to the named repository's root. `cloudv2`, `adp-docs`, and `docs` are
private: read them via the Redpanda-Github-Read MCP connector (`search_code`,
`get_file_contents`, `list_commits`, `get_commit`), not by cloning.

**`adp/RELEASE_NOTES.md`** in `cloudv2` is the ADP changelog (one section per release).
It is deliberately *not* copied into the skill: a changelog is volatile and would go stale
every release. For the sync routine it is the **primary trigger**, because a diff to this
file summarizes exactly the user-facing changes a sync should react to. It is also the
check for whether a feature has shipped: do not document a CLI group or UI feature that
the release notes and docs do not cover.
