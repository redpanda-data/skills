# Contributing to Redpanda Agent Skills

This guide explains when and how to contribute to the Redpanda skills repository.

## Core principle

**Skills are thin behavioral guidance for agents, not restated documentation.**

Skills tell agents HOW to approach problems (choreography). Documentation tells agents WHAT things are (facts). If you can answer a question by querying docs via MCP, you don't need a skill.

```
WRONG: Skill that lists all rpk flags and their descriptions (200+ lines)
RIGHT: Skill that says "when debugging, check X first, then Y, avoid Z" (60-80 lines)
```

## Source of truth hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                    SOURCE CODE                               │
│  (redpanda, connect repos)                                  │
│  The ultimate truth. Configs, APIs, behavior.               │
└─────────────────────────────────────────────────────────────┘
                          ↓ grounds
┌─────────────────────────────────────────────────────────────┐
│                    DOCUMENTATION                             │
│  (docs.redpanda.com)                                        │
│  Authoritative reference. Query via MCP for facts.          │
└─────────────────────────────────────────────────────────────┘
                          ↓ informs (but does not restate)
┌─────────────────────────────────────────────────────────────┐
│                    SKILLS                                    │
│  (redpanda-data/skills)                                     │
│  Behavioral guidance only. Links to docs, never duplicates. │
│  Source of truth for: triage sequences, decision trees,     │
│  gotchas, red herrings, escalation criteria.                │
└─────────────────────────────────────────────────────────────┘
```

## When to create a skill

Create a skill ONLY when ALL of these are true:

1. **Docs MCP fails** — Run the task with `mcp__redpanda__ask_redpanda_question` first. If it passes, no skill needed.
2. **Multi-step procedural task** — Requires sequencing, branching, or error recovery
3. **Pattern is repeatable** — Not a one-off edge case
4. **Agent hallucinates without it** — Base model gets Redpanda-specific details wrong
5. **Evals confirm value** — Skill vs Docs MCP delta > 0%

**Do NOT create skills for:**
- Reference lookups (config options, API endpoints, CLI flags)
- Simple procedures (1-3 steps, no branching)
- Content that exists in docs and RAG retrieves correctly

## Decision framework

```
User identifies AI workflow gap
            │
            ▼
Q1: Does Docs MCP handle it?
    YES → NO SKILL NEEDED
    NO  ↓

Q2: Is this a multi-step procedural task?
    NO  → Improve docs (structure, keywords, discoverability)
    YES ↓

Q3: Does the model hallucinate Redpanda-specific details?
    NO  → BASE MODEL is sufficient
    YES ↓

Q4: Do evals show Skill vs Docs MCP delta > 0%?
    NO  → NO SKILL NEEDED (docs fix or nothing)
    YES → CREATE SKILL
```

## Skill format (v2.0 behavioral)

Skills should be **60-100 lines** of behavioral guidance, not 200-500 lines of reference material.

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

### Size guidelines

| Component | Guideline |
|-----------|-----------|
| SKILL.md | **60-100 lines** (behavioral only) |
| Reference files | **None** — link to docs instead |
| Total size | **<10KB** |

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

## Empirical validation

Evals run 2025-06-04 with `claude-sonnet-4-6`, comparing Baseline vs Docs MCP vs Skill:

| Skill | Baseline | Docs MCP | Skill | Skill vs Docs | Verdict |
|-------|----------|----------|-------|---------------|---------|
| `streaming` | 41.7% | 66.7% | 66.7% | 0.0% | DELETE |
| `rpk` | 83.3% | 83.3% | 66.7% | -16.7% | DELETE |
| `connect-cdc-postgres` | 100% | 100% | 100% | 0.0% | DELETE |
| `streaming-debugging` | 100% | 66.7% | 66.7% | 0.0% | DELETE |
| `sql` | 33.3% | 66.7% | 66.7% | 0.0% | DELETE |
| `connect` | 83.3% | 83.3% | 83.3% | 0.0% | DELETE |

**Key findings:**
- No skill beats Docs MCP (all deltas ≤ 0%)
- `rpk` skill makes performance WORSE (-16.7%)
- Reference-style skills provide no value over docs retrieval

**Policy**: Only create skills when evals show Skill vs Docs MCP delta > 0%.

## Contribution workflow

```
PROPOSE → EVAL → REVIEW → MERGE
```

1. **Propose**: Open an issue describing the agent failure and why Docs MCP doesn't solve it
2. **Eval**: Create eval tasks; must show Skill vs Docs MCP delta > 0%
3. **Review**: Docs team + product SME review behavioral content
4. **Merge**: Approval required

## Review checklist

Before submitting a PR:

- [ ] Docs MCP tested first and confirmed insufficient
- [ ] Skill is behavioral guidance (60-100 lines), not reference-heavy
- [ ] SKILL.md has valid frontmatter with trigger phrases
- [ ] H2+ headings use sentence case
- [ ] Links to docs instead of restating content
- [ ] Enterprise features marked with license requirements
- [ ] `metadata.version` set appropriately
- [ ] Eval suite exists with 5+ tasks including negative transfer check
- [ ] Eval passes: Skill vs Docs MCP delta > 0%, no negative transfer
- [ ] CHANGELOG updated

## Versioning

| Change Type | Version Bump | Example |
|-------------|--------------|---------|
| New skill | Start at `1.0.0` | — |
| Content restructure | MAJOR (X.0.0) | Changing from reference to behavioral format |
| Add/remove sections | MINOR (x.Y.0) | Adding a new "gotchas" table |
| Fix errors, typos | PATCH (x.y.Z) | Fixing a broken URL |
