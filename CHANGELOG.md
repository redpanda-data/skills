# Changelog

All notable changes to Redpanda Agent Skills will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Restructured 11 skills to behavioral guidance format** (v2.0.0):
  - `streaming-debugging`, `connect-debugging`, `sql-debugging`
  - All 8 CDC skills: `connect-cdc-postgres`, `connect-cdc-mysql`, `connect-cdc-mongodb`, `connect-cdc-oracle`, `connect-cdc-sqlserver`, `connect-cdc-spanner`, `connect-cdc-dynamodb`, `connect-cdc-salesforce`
  - Streamlined from ~200-500 lines to ~60-80 lines each
  - Now contain: "First three moves", decision trees, common gotchas, red herrings, escalation criteria
  - Link to docs for reference details instead of duplicating content
- Fixed "Oxla" naming to "Redpanda SQL" throughout
- Added Cloud-only warnings to all SQL skills (Redpanda SQL is Cloud-only)
- Applied sentence case to all H2+ headings per docs team standards
- Fixed broken documentation URLs

### Added
- `CLAUDE.md` with AI assistant instructions for creating/modifying skills
- `CONTRIBUTING.md` with decision framework for skills vs docs
- Evaluation framework in `evals/` directory
- Eval runner script (`scripts/eval-runner.js`)
- GitHub Actions workflow for skill validation (`.github/workflows/validate-skills.yml`)
- Per-skill `metadata.version` field in frontmatter
- Empirical eval findings comparing Baseline vs Docs MCP vs Skill-enhanced approaches
- Eval-driven skill creation policy: create skill only if Docs MCP fails where skill succeeds

### Eval Results

Evals run 2025-06-04 with `claude-sonnet-4-6`, comparing Baseline vs Docs MCP vs Skill:

| Skill | Baseline | Docs MCP | Skill | Skill vs Docs | Verdict |
|-------|----------|----------|-------|---------------|---------|
| `streaming` | 41.7% | 66.7% | 66.7% | **0.0%** | DELETE |
| `rpk` | 83.3% | 83.3% | 66.7% | **-16.7%** | DELETE |
| `connect-cdc-postgres` | 100% | 100% | 100% | **0.0%** | DELETE |
| `streaming-debugging` | 100% | 66.7% | 66.7% | **0.0%** | DELETE |
| `sql` | 33.3% | 66.7% | 66.7% | **0.0%** | DELETE |
| `connect` | 83.3% | 83.3% | 83.3% | **0.0%** | DELETE |

**Variance check** (`connect` skill, 4 runs):
| Run | Skill | Docs MCP | Delta |
|-----|-------|----------|-------|
| 1 | 100% | 83.3% | +16.7% |
| 2 | 83.3% | 83.3% | 0.0% |
| 3 | 66.7% | 83.3% | -16.7% |
| 4 | 83.3% | 83.3% | 0.0% |
| **Avg** | **83.3%** | **83.3%** | **0.0%** |

**Key findings:**
- No skill consistently beats Docs MCP (all average deltas ≤ 0%)
- `rpk` skill makes performance WORSE (-16.7%)
- `streaming-debugging` performs worse than baseline (-33.3%)
- Initial +16.7% for `connect` was noise — variance ranges from -16.7% to +16.7%

### Recommendations

Based on eval evidence (all Skill vs Docs deltas ≤ 0%):
- **DELETE**: `streaming`, `rpk`, `connect-cdc-postgres`, `streaming-debugging`, `sql`, `connect`
- **Pending evals**: `cloud-*`, other rpk subcommand skills, other CDC skills

## [0.1.0] - 2025-06-02

### Added
- Initial release with 30 skills across 5 product areas:
  - **Streaming** (3): streaming, streaming-admin-api, streaming-debugging
  - **SQL** (4): sql, sql-admin-api, sql-federated-queries, sql-debugging
  - **Connect** (10): connect, connect-debugging, 8 CDC connectors
  - **Cloud** (3): cloud-serverless, cloud-byoc, cloud-dedicated
  - **rpk CLI** (10): rpk core + 9 subcommand-specific skills
- Claude Code plugin configuration (`.claude-plugin/`)
- Apache 2.0 license

### Notes
- Skills grounded in Redpanda source code, documentation, and APIs
- Each skill underwent adversarial review for accuracy
- Enterprise features clearly marked with license requirements
