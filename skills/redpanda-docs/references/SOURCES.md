# Sources for redpanda-docs

Each claim in `SKILL.md`, and where it was verified (2026-10-21).

| Claim | Source |
|---|---|
| `rpk version` prints the rpk version and each live broker's version through the Admin API, skips the cluster section for Cloud profiles, and `rpk --version` prints only rpk's | `redpanda-data/streaming-enterprise` `src/go/rpk/pkg/cli/version/versioncmd/versioncmd.go` (`NewCommand`, `printClusterVersions`) |
| `rpk redpanda admin brokers list` adds a VERSION column | `redpanda-data/streaming-enterprise` `src/go/rpk/pkg/cli/redpanda/admin/brokers/list.go` (calls `RunBrokerInfo`) and `src/go/rpk/pkg/cli/cluster/info.go` (VERSION header) |
| `rpk connect --version` prints the Connect version | `redpanda-data/benthos` `internal/cli/app.go` (the `version` flag, alias `-v`) |
| `ask_redpanda_question` takes `platform` (`cloud`, `self-managed`) and `version` (release as the docs URLs spell it, or `current`); Cloud, Connect, ADP, and API reference docs are version-neutral | Live `tools/list` from `https://docs.redpanda.com/mcp` (served by `redpanda-data/docs-site` `netlify/functions/mcp.mjs`) |
| The anonymous tool-call limit, and that signing in removes it | `redpanda-data/docs-site` `netlify/functions/lib/anon-quota.mjs` (`anonMcpQuotaRefusal`) |
| Every page has a Markdown version (`.md`, or `Accept: text/markdown`); `llms-full.txt` holds only the latest version of each component | `https://docs.redpanda.com/llms.txt` |
| Self-managed pages are versioned at `/streaming/<version>/` and `/streaming/current/` | Live site: `/streaming/24.3/...`, `/streaming/25.3/...`, and `/streaming/current/...` pages all return 200 |
| `give_feedback` sends a report to the Redpanda docs team, and reports do not include the user's name or email | Live `tools/list` from `https://docs.redpanda.com/mcp` (the tool's own description, checked 2026-10-30) |
| `get_config_property`, `list_config_properties`, `get_connect_component`, and `list_connect_components` look up one property or component, or find one by keyword | Live `tools/list` from `https://docs.redpanda.com/mcp` (checked 2026-10-30) |
| The server is a remote MCP server at `https://docs.redpanda.com/mcp` that any MCP client can add | `.mcp.json` in this repo; live `tools/list` over streamable HTTP (checked 2026-10-30) |
