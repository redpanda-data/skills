# redpanda-solutions Skill Source Map

Maps each file in `skills/redpanda-solutions/` to the sources its claims derive from.

The skill documents only where the Solutions catalog and each solution's agent companion are
published, and how an agent must fetch them. The procedure for applying a solution lives in the
companion's "How to use this" section, which the docs build generates. Do not copy that
procedure into this skill.

## File-to-source table

| Skill file | Sources |
|---|---|
| `SKILL.md` | The catalog's published path and fields: the solutions-catalog extension in the private repo `redpanda-data/docs-extensions-and-macros` (`extensions/solutions-catalog/`), which writes `assets/data/solutions.json`. The companion's path, its `# Agent companion:` first line, and the single-`curl` fetch rule: `extensions/solutions-catalog/agent-companion.js` in the same repo. The "Take this design to production" prompt that points at this skill: `src/js/33-solution-productionize.js` in the private repo `redpanda-data/docs-ui`. |

## Verify

1. Download `https://docs.redpanda.com/assets/data/solutions.json` and confirm each entry still
   has `id`, `title`, `description`, `useCases`, `technologies`, and `platforms`.
2. Download one companion with the skill's `curl -sf` command and confirm the output starts with
   `# Agent companion:` and has a `## How to use this` section.
