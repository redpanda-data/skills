# ADP Skill Rebuild — progress ledger

Branch: adp-skill-rebuild

- Task 0: complete (clone + branch + evidence dir)
- Task 1-7 (Phase 1 verification): complete — evidence in /Users/miche/adp-skill-verify/ (governance, agents, mcp-servers, gateway, rpk-ai, observability, misc)
- rpk-cloud-mcp verify: rpk cloud mcp uses aigateway.v1 (29 svcs incl rate limits/routing/SSO/audit) — REAL, not stale. rpk-cloud phrase is accurate-but-abbreviated; Task 16 = expand list, do NOT remove. ADP skill (adp.v1alpha1) correctly excludes those. Evidence: rpk-cloud-mcp.md
- Task 8 (agents.md): complete (commit db1247a, SPEC ✅). Reviewer QUALITY flag = cross-task forward-links to new siblings (mcp-servers/gateway-and-providers/governance/observability) — intended, resolve by end of Phase 2; final review to confirm no danglers. Minor: add a few proto line cites + surface built-in-tools TODO(verify) — defer to final review.
- Task 9 (mcp-servers.md): complete (commit 002a1db, SPEC ✅ QUALITY Approved). Minor (final-review): Utility catalog "and others" omits 2 beta types; MCP_TRANSPORT_UNSPECIFIED=0 omitted. Cross-links match canonical set.
- Task 10 (gateway-and-providers.md): complete (commit 0a072c8, SPEC ✅ QUALITY Approved, zero findings). "Not in scope" correctly attributed to ADP product.
- Task 11 (governance.md): complete (commit c6c15cf, SPEC ✅ QUALITY Approved). Wrong names only in labeled "Not part of this API"; microcents/Bedrock-6/Cedar-no-ValidatePolicy/PendingAuth-not-callable all correct. Minor (final-review): add discover examples for policy/oauth.
- Task 12 (rpk-ai.md): complete (commit 85e009f, SPEC ✅ QUALITY Approved). "plugin" zero hits; full subcommand tree; install/upgrade/uninstall scoped to rpk; rpk ai version subcommand; --rpai-endpoint NOT env-bound; FIPS TODO(verify).
- Task 13 (observability.md): complete (commit 5a42340, SPEC ✅ QUALITY Approved). All 6 reference files done; cross-links resolve. Minor (final-review): a "--" inline separator in a table Notes cell (not an em dash).
- Task 14 (SKILL.md + deletions): complete (commit 43c39c1, SPEC ✅ QUALITY Approved). name: adp; 4 old files removed; no plugin/em-dash/MCP-Gateway/out-of-scope features. Minor (final-review): description parenthetical omits `auth`.
