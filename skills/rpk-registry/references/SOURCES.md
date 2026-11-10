# rpk registry Skill Source Map

The skill is thin: it keeps only the "How to work" procedure below, backed by behavioral eval
cases in `evals/suites/rpk-registry.eval.json`, and sends the agent to the docs for everything
else. This file maps only the claims the skill still makes.

The `rpk registry` command group is Go source under `src/go/rpk/pkg/cli/registry/`, and the
broker-side Schema Registry it drives is under `src/v/pandaproxy/schema_registry/`. Both are
cited at the public `redpanda-data/redpanda` tag `v26.2.2`. Verify against the current stable
release tag, not `dev`.

## How to work: line, source, eval case

| How to work line | Source | Eval case |
|---|---|---|
| Ask before removing a schema context that still holds subjects: a context can be deleted only after every subject in it is hard-deleted; list the subjects first and get the go-ahead before any `--permanent` delete (verified 2026-11-10). Safety guardrail: the baseline failed its case 0/3 on 2026-11-10 (it hard-deleted the subjects unasked); the pre-thin skill passed 1/3 (installed 2/3), and the thin skill passed 3/3 in both the skill and installed arms. | `src/go/rpk/pkg/cli/registry/context/delete.go` (long help: hard deletion required, soft-deleted subjects still block; confirmation prompt and `--no-confirm`), `src/v/pandaproxy/schema_registry/errors.h` (`context_not_empty`) | `context-delete-asks-before-hard-delete` |
| Don't hard-delete a subject or version to get past a compatibility error: a permanent delete removes the schema by ID once no other subject version uses it; relax only that subject's level, never the global level (verified 2026-11-10). Safety guardrail: the baseline passed its case 3/3 on 2026-11-10, and the line and case stay as a regression guard. The thin skill passed 3/3 in the skill and installed arms. | `src/v/pandaproxy/schema_registry/sharded_store.cc` (`delete_subject_version` calls `delete_schema` when no subject version uses the ID), `src/go/rpk/pkg/cli/registry/subject.go` and `schema/delete.go` (`--permanent`), `compatibility_level.go` (per-subject or global `set`) | `incompatible-change-keeps-history` |

## Other claims in SKILL.md

| Claim | Source | Eval case |
|---|---|---|
| `rpk sr` is an alias of `rpk registry` | `src/go/rpk/pkg/cli/registry/registry.go` (`Aliases: []string{"sr"}`) | none |
| The Schema Registry is built into every broker; rpk reaches it through the profile or `-X registry.hosts` | `src/go/rpk/pkg/config/params.go` (`registry.hosts`) | none |
| `get_rpk_command` looks up one rpk subcommand and `get_config_property` one cluster or topic property | Live `tools/list` from `https://docs.redpanda.com/mcp` (see `skills/redpanda-docs/references/SOURCES.md`) | none |
| When the Docs MCP server refuses for quota and no page fetch is possible, tell the user to sign in through `/mcp` | `skills/redpanda-docs/references/SOURCES.md` (anonymous quota row) | none |

## Docs gaps (not skill claims; do not re-verify here)

Found by the 2026-11-10 eval run. Each fact is confirmed in source at `redpanda` tag `v26.2.2`.

- **Soft-deleting a subject drops its subject-level compatibility and mode.** The subject falls
  back to the context or global level, and the next version registered is not checked against
  the soft-deleted versions. Every arm failed `soft-delete-subject-drops-subject-config` (0/3
  each). Missing from https://docs.redpanda.com/streaming/current/manage/schema-reg/schema-reg-api/
  (Soft delete a schema) and
  https://docs.redpanda.com/streaming/current/reference/rpk/rpk-registry/rpk-registry-subject-delete/.
  Source: `src/v/pandaproxy/schema_registry/seq_writer.cc` (`do_delete_subject_impermanent`
  writes tombstones for the subject mode and config; soft-deleting the last version in
  `do_delete_subject_version` clears the config too) and `handlers.cc` (the compatibility check
  runs only when undeleted versions exist).
- **`rpk registry schema check-compatibility` exits 0 for an incompatible schema.** It prints
  "Schema is not compatible." and the reasons; only a failed check exits non-zero, so a CI gate
  must read the output (the `compatible` field of `--format json`). The docs arm did not find
  this (0/3 on a complete rerun; the baseline passed 3/3, so the case is uninformative). Missing from
  https://docs.redpanda.com/streaming/current/reference/rpk/rpk-registry/rpk-registry-schema-check-compatibility/.
  Source: `src/go/rpk/pkg/cli/registry/schema/check_compatibility.go` (no non-zero exit on
  `compatible.Is == false`). The pre-thin skill said the command exits non-zero, which was wrong.
- **A soft-deleted schema is still served by ID; a hard delete removes it.** `GET
  /schemas/ids/{id}` resolves soft-deleted versions, so consumers still decode old records,
  while a permanent delete removes the schema once no other subject version uses the ID. The
  docs arms passed `soft-deleted-schema-readable-by-id` 1/3 and 0/3. Missing from
  https://docs.redpanda.com/streaming/current/manage/schema-reg/schema-reg-api/ (Delete a
  schema). Source: `src/v/pandaproxy/schema_registry/handlers.cc` (`resolve_schema_id_simple`
  uses `include_deleted::yes`) and `sharded_store.cc` (`delete_subject_version`).

## Lines removed for lack of a failing baseline

- "Grant registry ACLs over a subject prefix with `--resource-pattern-type prefixed` and no
  asterisk" was not kept. Its behavioral case `registry-acl-subject-prefix` passed 3/3 in the
  baseline on 2026-11-10, and the fact case `prefixed-subject-acl-asterisk` passed 3/3 too.
- "For a migration with fixed IDs into a busy registry, set IMPORT on the target subject only,
  not globally with `--force`, then set it back" was not kept. Its case
  `import-ids-without-forcing-global-import` scored baseline 1/3, but every baseline run chose
  per-subject IMPORT; the two failures stopped to ask after the stateless mock returned
  confusing read-backs, so the failures come from the mock, not from a missing procedure. The
  pre-thin skill taught global IMPORT for this, which is the riskier path.
- The pre-thin skill's quickstart, command map, compatibility table, mode and context sections,
  and the Enterprise Authorization, Schema ID Validation, and authentication references were
  removed as facts. The docs arms answered the sampled cases drawn from them, or the baseline
  already did (see the suite's sampled and targeted results).

## Drift found in the pre-thin skill (fixed by removal)

- It said `schema_registry_enable_qualified_subjects` must be set to true before contexts work.
  At `v26.2.2` the property defaults to true (`src/v/config/configuration.cc`).
- It said `check-compatibility` exits non-zero for an incompatible schema (see Docs gaps).
