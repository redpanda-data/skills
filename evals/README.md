# Skill vs docs evals

These evals answer one question about each skill: **does it give an agent anything the
published Redpanda docs do not?**

Every case is a user question, asked in four arms and graded the same way in each:

| Arm | Skill in context | Docs MCP server |
|---|---|---|
| `baseline` | no | no |
| `skill` | yes | no |
| `docs` | no | yes |
| `both` | yes | yes |

The docs arms use the Redpanda Docs MCP server at `https://docs.redpanda.com/mcp` and are told
to look the question up before answering.

## Reading the result

Each case gets a verdict from its pass rates:

| Verdict | Means |
|---|---|
| uninformative | The baseline passes it. A model already knows the answer, so the case says nothing about the skill or the docs. Rewrite or delete it. |
| skill adds value (docs gap) | `both` beats `docs` by at least a third. The skill carries something the docs do not. |
| docs are enough | `docs` passes at least two thirds of the time and is within 10 points of `both`. |
| neither answers reliably | Both docs arms pass less than two thirds of the time. Check the case before blaming the skill or the docs. |
| no clear difference | Anything else. Run more repeats. |

A skill whose informative cases are mostly "docs are enough" is a candidate for deletion.

The summary also lists two kinds of gap, which are worth acting on whatever the verdict:

- **Docs gaps:** the skill arm passes and the docs arm fails. The skill knows something the
  published docs do not. Either document it, or it is the reason the skill exists.
- **Skill gaps:** the docs arm passes and the skill arm fails. The skill is wrong or silent
  about something the docs cover.

### Case origin

How a case was picked decides what it can show, so every case records an `origin`, and
verdicts are reported per origin, never pooled:

| Origin | Picked how | What it can show |
|---|---|---|
| `docs-cited` | From a published docs page | Only that the docs arm finds what the docs say. It cannot find a docs gap. |
| `sampled` | Claims taken at even intervals through the skill, without looking at the docs | How much of a skill the docs already cover |
| `targeted` | Claims the author expected the docs to lack, without looking at the docs | Docs gaps |

Write `sampled` and `targeted` cases from the skill and product source. Do not check the
published docs while choosing them, because that brings back the bias in `docs-cited`.

## Run the evals

You need `claude` on your `PATH`, signed in. Nothing else to install.

The docs arms need `EVAL_DOCS_CLIENT_KEY`, a trusted client key for the Docs MCP server.
Anonymous callers get a few tool calls a day per network address, which one suite uses up.
When the server refuses a call for quota, the run counts as an error, not a result.

```bash
# Every suite, every arm, 3 runs each
node evals/run-evals.mjs

# One suite
node evals/run-evals.mjs --suite rpk-topic

# Specific cases, one run
node evals/run-evals.mjs --case some-case-id --runs 1

# Regression check only
node evals/run-evals.mjs --arms both --runs 1
```

Options: `--arms`, `--runs`, `--concurrency` (default 4), `--model` (default
`claude-sonnet-5-5`), `--judge-model` (default `claude-opus-5-5`), `--no-judge`, `--out`.
Results go to `evals/results/<timestamp>/`: `runs.jsonl` has every response and tool call,
`summary.md` has the tables.

A case run costs roughly $0.03 (baseline) to $0.21 (both), and `runs.jsonl` records each run's tokens. The skill arms preload SKILL.md and every reference file it names, so they overstate what an installed skill costs a user, which loads references only as needed.

## Isolation

Every subject runs `claude -p` from an empty temporary directory with setting sources,
skills, slash commands, and session persistence off, and only the MCP server its arm declares.
It cannot see an installed plugin (including this one), a `CLAUDE.md`, auto-memory, or the
skill files on disk. Each run checks the tools the subject reports against what its arm
should have, and a mismatch is a harness error, not a result. The same goes for a skill, slash command, or non-built-in plugin showing up in a subject's session.

The skill arms get the skill's `SKILL.md` plus every `references/` file that `SKILL.md`
names, which is what an agent following the skill would load.

Before any subject runs, every case is graded against an answer that says nothing. A case
that passes it cannot fail, and the run stops.

## Write a case

Suites live in `evals/suites/<skill>.eval.json` and follow [`schema.json`](schema.json).

```json
{
  "id": "short-kebab-id",
  "query": "What a user would ask an agent.",
  "why": "The fact under test, and why a model would not already know it.",
  "origin": "sampled",
  "verified_against": ["product source"],
  "required_patterns": ["literal the right answer must contain"],
  "failure_patterns": ["assertive wrong claim"],
  "invariants": [
    { "name": "snake_case_name", "failure_condition": "What fails, and what passes." }
  ]
}
```

A good case is:

- **A real question about the product**, not about the skill. Phrase it the way a user
  would, so the docs arm has a fair chance.
- **Not general knowledge.** If the baseline passes it, it measures nothing. Popular
  commands and well-known concepts fail this test. Exact flag interactions, prerequisites,
  limitations, and error causes usually pass it.
- **Correct.** The skill can be wrong. Verify the fact against product source and cite it in
  `verified_against`. This repo is public: cite public source (`connect`, `benthos`) by path,
  and private source only as "product source", never by repository, path, or ticket.
- **Durable.** No versions, region lists, model lists, pricing, or quotas.
- **Not leaking its answer.** A query that names the flag it then requires is satisfied by
  echoing the question.

### Behavioral cases

A case can grade what the agent does instead of what it says. Give it a `tools` block: a mocked tool surface (`mock`), served to every arm by [`scripts/mock-tools.mjs`](scripts/mock-tools.mjs), plus assertions on the calls the agent made:

```json
"tools": {
  "mock": [{
    "name": "run_sql",
    "description": "Run a SQL statement on the user's PostgreSQL server.",
    "responses": [
      { "match": "wal_level", "output": " wal_level\n-----------\n replica" },
      { "match": ".", "output": "(0 rows)" }
    ]
  }],
  "first_call": { "tool": "run_sql", "args": "wal_level" },
  "expected_calls": [{ "tool": "run_sql", "args": "wal_level" }],
  "forbidden_calls": [{ "tool": "run_sql", "args": "DROP" }],
  "ordered_calls": [{ "tool": "run_sql", "args": "wal_level" }, { "tool": "run_sql", "args": "pg_replication_slots" }]
}
```

Each response's `match` is a regex tested against the call's arguments as JSON, and the first match wins. A call that matches nothing gets an error result, the way a real tool fails on input it doesn't understand. `args` in an assertion is a regex too. Calls are graded from the mock's own log, before any pattern or invariant.

The rule for facts applies to behavior: generic good practice, such as checking the obvious setting first, is something the baseline already does. A behavioral case earns its place only on a procedure specific to the product.

Assert a literal with a pattern and an idea with an invariant. Patterns are
case-insensitive JavaScript regexes matched against the whole response. Keep
`failure_patterns` to assertive claims, because a correct answer may mention the wrong option
to reject it.

To screen a candidate cheaply before adding it:

```bash
evals/scripts/probe.sh baseline <skill> "<query>"
evals/scripts/probe.sh skill <skill> "<query>"
```

Validate a suite:

```bash
npx --yes ajv-cli@5.0.0 validate -s evals/schema.json -d "evals/suites/*.eval.json"
```
