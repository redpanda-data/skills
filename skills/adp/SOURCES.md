# ADP Skill Source Map

Maps each file in `skills/adp/` to the `cloudv2` source paths it derives from, so
future syncs and human maintainers know exactly where to verify claims.

## File-to-source table

| Skill file | cloudv2 source paths |
|---|---|
| `skills/adp/SKILL.md` | `apps/rpai/internal/cmd/root.go`, `apps/adp-api/internal/server/server.go`, `apps/aigw/internal/server/server.go`, `proto/public/cloud/redpanda/api/adp/v1alpha1/` (all services, summary-level), `adp/RELEASE_NOTES.md` (user-facing changelog — version/feature history) |
| `skills/adp/references/agents.md` | `proto/public/cloud/redpanda/api/adp/v1alpha1/agent.proto` (lines 16-699), `managed_agent_runtime.proto` (lines 18-114), `apps/adp-api/internal/server/server.go:340-341` (service registration), `apps/aigw/internal/server/server.go:988-989` (A2A routing) |
| `skills/adp/references/mcp-servers.md` | `proto/public/cloud/redpanda/api/adp/v1alpha1/mcp_server.proto` (MCPServerService RPCs, MCPServer fields, code-mode comment, tool-naming comment), `proto/public/cloud/redpanda/mcps/v1/auth.proto` (auth mode messages), `apps/aigw/internal/mcp/managed/defaults.go` (managed catalog registrations) |
| `skills/adp/references/gateway-and-providers.md` | `proto/public/cloud/redpanda/api/adp/v1alpha1/llm_provider.proto` (lines 16-260, 451-747), `proto/public/cloud/redpanda/api/adp/v1alpha1/model.proto` (lines 10-72), `apps/aigw/internal/server/server.go:1054,1059,1189,1213` (service registrations), `apps/aigw/internal/llm/provider/google/google.go:70` (Gemini credential injection) |
| `skills/adp/references/governance.md` | `proto/public/cloud/redpanda/api/adp/v1alpha1/budget.proto`, `spending_service.proto`, `guardrail.proto`, `policy_service.proto` (lines 25-104), `system_policy_service.proto`, `effective_policy_set_service.proto`, `cedar_options.proto`, `oauth_client.proto`, `oauth_provider.proto`, `oauth_connection.proto`, `pending_auth_request.proto`, `token_vault_admin.proto`; service registrations at `apps/aigw/internal/server/server.go` and `apps/adp-api/internal/server/server.go` |
| `skills/adp/references/rpk-ai.md` | `apps/rpai/internal/cmd/root.go` (subcommand tree lines 134-150, persistent flags lines 199-237, version lines 631-641), `apps/rpai/testdata/commands-snapshot.md` (golden help output), `apps/rpai/internal/config/cloudenv.go:179-181` (config path), `apps/rpai/.goreleaser.yaml` (platforms) |
| `skills/adp/references/observability.md` | `proto/public/cloud/redpanda/api/adp/v1alpha1/transcript.proto` (lines 21-264, 288-298), `apps/adp-api/internal/server/server.go:344-348` (TranscriptsService registration), `proto/public/cloud/redpanda/api/adp/experimental/v1alpha1/insights_service.proto` (lines 13-49), `apps/aigw/internal/server/server.go:1225-1229` (InsightsService registration) |

## Usage

The `adp-skill-sync` routine (defined in `skills-sync-routine.md` at the repo root) and
human maintainers use this map when re-verifying the skill against `cloudv2`. For each
file being reviewed or updated, open the listed source paths in `cloudv2` first and
confirm that every claim in the skill file still matches.

All source paths are relative to the `redpanda-data/cloudv2` repository root. The
`cloudv2` repo is private; read it via the Redpanda-Github-Read MCP connector
(`search_code`, `get_file_contents`, `list_commits`, `get_commit`), not by cloning.

**`adp/RELEASE_NOTES.md`** is the user-facing ADP changelog (one section per release,
e.g. `v0.2.9`). It is deliberately *not* copied into the skill — a changelog is
volatile and would go stale every release. The skill instead points the agent to read
it live for version/feature-history questions. For the sync routine it is the
**primary, highest-signal trigger**: a diff to this file is a human-curated summary of
exactly the user-facing changes a sync should react to, and its bullet categories (MCP
Servers, LLM Providers, rpk ai, governance, …) map directly onto the reference files
above.
