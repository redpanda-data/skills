# Skills Sync Routines

Seven scheduled routines maintain this repo: five weekly per-product generators (Agentic
Data Plane, Cloud, Core, SQL, Connect), a read-only critic that reviews their PRs every
6 hours, and a monthly drift audit that re-verifies every source-grounded skill from
scratch. [`MAINTAINING.md`](./MAINTAINING.md) explains how the generator → critic → human
process works and how to operate it; the guardrails every routine inherits live in the
repo [`CLAUDE.md`](./CLAUDE.md).

The full routine definitions — prompts, trigger IDs, schedules, and the operational
runbook — live in the docs team's private standards repository
(`resources/skills-routines.md` in `redpanda-data/docs-team-standards`), because they
contain operational detail that does not belong in a public repo. Routine output
(provenance and review reports) also goes to private standing issues there, per the
public-surface rule in `CLAUDE.md`.

If you edit a routine in the dashboard, update the private doc too, and vice versa.
