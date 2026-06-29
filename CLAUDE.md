# Claude Instructions for Redpanda Skills

This file provides instructions for AI assistants working on this repository.

## Core principle

**Skills are behavioral guidance for agents, not documentation restated.**

Skills tell agents HOW to approach problems (choreography). Documentation tells agents WHAT things are (facts). If you can answer a question by querying docs via MCP, you don't need a skill.

```
WRONG: Skill that lists all rpk flags and their descriptions
RIGHT: Skill that says "when debugging, check X first, then Y, avoid Z"
```

## When to create a skill

Create a skill ONLY when ALL of these are true:

1. **Docs MCP fails** — run the task with `mcp__redpanda__ask_redpanda_question` first. If it passes, no skill needed.
2. **Multi-step procedural task** — requires sequencing, branching, or error recovery
3. **Pattern is repeatable** — not a one-off edge case
4. **Agent hallucinates without it** — base model gets Redpanda-specific details wrong

**Do NOT create skills for:**
- Reference lookups (config options, API endpoints, CLI flags)
- Simple procedures (1-3 steps, no branching)
- Content that exists in docs and RAG retrieves correctly

## Skill structure (v2.0 behavioral format)

Skills should be 60-100 lines of behavioral guidance, not 200-500 lines of reference material.

### Required sections

```markdown
---
name: {skill-name}
description: "Behavioral guidance for {topic}. Use when: {trigger phrases}. This skill provides agent choreography - the actual {commands/configs/syntax} come from docs."
metadata:
  version: "X.Y.Z"
---

# {Topic}: Agent Behavior Guide

{One paragraph explaining what this skill helps with. Include a link to the relevant docs.}

## First three moves

When {problem scenario}:

1. **Do X first** — {why this is the right starting point}
2. **Then check Y** — {what this rules out}
3. **Then do Z** — {what this confirms}

## Decision tree

| Symptom | First Move |
|---------|-----------|
| {symptom} | {action} |

## Common gotchas

| Gotcha | How to Avoid |
|--------|--------------|
| {mistake} | {prevention} |

## Red herrings to avoid

- **{False signal}** — {why it's misleading}

## When to escalate

- {Condition that requires human/support intervention}

**Docs**: [Link](https://docs.redpanda.com/...)
```

### What each section does

| Section | Purpose |
|---------|---------|
| First three moves | Prevents flailing — gives agent a deterministic starting sequence |
| Decision tree | Maps symptoms to actions — agent doesn't have to reason from scratch |
| Common gotchas | Prevents known mistakes — based on real support cases |
| Red herrings | Prevents wasted effort on false signals |
| When to escalate | Prevents infinite loops — tells agent when to stop |

## Style guide

### Headings
- **H1**: Title case (e.g., "# PostgreSQL CDC: Agent Behavior Guide")
- **H2+**: Sentence case (e.g., "## First three moves", "## Common gotchas")

### Links to docs
Always link to docs instead of restating content:
```markdown
WRONG: The `wal_level` setting must be set to `logical`. This enables...
RIGHT: Verify `wal_level = logical` — see [PostgreSQL CDC docs](https://docs.redpanda.com/...) for setup.
```

### Enterprise features
Always note license requirements:
```markdown
> **Enterprise Feature**: `postgres_cdc` requires a Redpanda Enterprise license.
```

### Descriptions
Include trigger phrases that help the agent know when to load the skill:
```markdown
description: "Behavioral guidance for X. Use when: setting up X, troubleshooting Y, or diagnosing Z. This skill provides agent choreography - the actual config fields come from docs."
```

## Versioning

### When to update `metadata.version`

| Change Type | Version Bump | Example |
|-------------|--------------|---------|
| New skill | Start at `1.0.0` | — |
| Content restructure | MAJOR (X.0.0) | Changing from reference to behavioral format |
| Add/remove sections | MINOR (x.Y.0) | Adding a new "gotchas" table |
| Fix errors, typos | PATCH (x.y.Z) | Fixing a broken URL |

### How to update

1. Edit the `metadata.version` field in the skill's frontmatter
2. Update `CHANGELOG.md` under `## [Unreleased]`

## CHANGELOG requirements

**Always update CHANGELOG.md when:**
- Creating a new skill
- Modifying an existing skill
- Fixing errors
- Changing skill structure

### CHANGELOG format

```markdown
## [Unreleased]

### Added
- New `{skill-name}` skill for {purpose}

### Changed
- `{skill-name}`: {what changed}

### Fixed
- `{skill-name}`: {what was fixed}

### Removed
- Retired `{skill-name}` skill ({reason})
```

## File operations checklist

When creating or modifying a skill:

- [ ] Skill follows behavioral format (not reference-heavy)
- [ ] Frontmatter has `name`, `description` (with trigger phrases), `metadata.version`
- [ ] H2+ headings use sentence case
- [ ] Links to docs instead of restating content
- [ ] Enterprise features marked with license note
- [ ] `metadata.version` updated appropriately
- [ ] `CHANGELOG.md` updated
- [ ] URLs verified (not 404)

## Directory structure

```
skills/
├── {skill-name}/
│   └── SKILL.md          # The skill file (required)
```

Skills no longer use `references/` subdirectories. All content should be in SKILL.md, with links to docs for details.

## Examples

### Good skill (behavioral)
```markdown
## First three moves

When a CDC pipeline won't start:

1. **Check prerequisite config first** — run `SHOW wal_level;`. If not `logical`, that's your problem.
2. **Verify permissions** — user needs REPLICATION privilege, not just SELECT.
3. **Check for existing slot** — `SELECT * FROM pg_replication_slots;`
```

### Bad skill (reference-heavy)
```markdown
## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| slot_name | string | required | The name of the replication slot |
| publication_name | string | auto | The publication name... |
...200 more lines of config reference...
```

## Remember

1. **Query docs first** — if MCP answers the question, don't create a skill
2. **Behavioral, not reference** — tell agents how to think, not what to know
3. **60-100 lines** — if it's longer, you're probably duplicating docs
4. **Always update CHANGELOG** — every change gets logged
5. **Sentence case for H2+** — "## First three moves" not "## First Three Moves"
