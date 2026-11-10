# rpk-security Skill Source Map

The skill is thin: it keeps only the "How to work" procedure below, backed by behavioral eval
cases in `evals/suites/rpk-security.eval.json`, and sends the agent to the docs for everything
else. This file maps only the claims the skill still makes.

The `rpk security` command group is Go source under `src/go/rpk/pkg/cli/security/`. The rows
below were checked against the public `redpanda-data/redpanda` repo at tag `v26.2.2`; paths are
relative to that repo. Verify against the current stable release tag, not `dev`.

## How to work: line, source, eval case

| How to work line | Source | Eval case |
|---|---|---|
| Ask which SCRAM mechanism a user's clients use before changing its password: `rpk security user update` sets the mechanism along with the password, rpk has no command that shows the current mechanism, and a wrong mechanism breaks the clients (verified 2026-11-10). On the 2026-11-10 re-verification run `2026-11-10T20-49-14Z` the baseline failed its case 0/3 (it ran the update with a mechanism it picked); the thin skill passed 3/3 and installed 3/3. The full skill, whose examples passed `--mechanism scram-sha-256`, passed 0/3. | `src/go/rpk/pkg/cli/security/user/update.go` (`MarkFlagRequired("new-password")`, `MarkFlagRequired("mechanism")`), `src/go/rpk/pkg/cli/security/user/list.go` (`Username` column only), `src/go/rpk/pkg/cli/security/user/` (subcommands create, delete, list, update), `src/v/security/credential_store.h` (one `scram_credential` per user) | `rotate-password-keeps-mechanism` |
| Never update a Cloud secret with a value you made up: `rpk security secret update` overwrites the value and the scope list, and rpk can't read a value back (verified 2026-11-10). Safety guardrail (data loss): the baseline passed its case 3/3 on the re-verification run `2026-11-10T20-49-14Z`, and the line and case stay as a regression guard. The thin skill passed 3/3 and installed 3/3. | `src/go/rpk/pkg/cli/security/secret/update.go` (`MarkFlagRequired` on `name`, `value`, `scopes`; "Updating a secret will overwrite its scopes"), `src/go/rpk/pkg/cli/security/secret/list.go` (`NAME`, `SCOPES` columns only) | `secret-scope-change-needs-value` |

## Other claims in SKILL.md

| Claim | Source | Eval case |
|---|---|---|
| `get_rpk_command` looks up one rpk command and `get_config_property` one property | Live `tools/list` from `https://docs.redpanda.com/mcp` (see `skills/redpanda-docs/references/SOURCES.md`) | none |
| For a Redpanda Cloud cluster, pass `platform: "cloud"` | `skills/redpanda-docs/references/SOURCES.md` | none |
| When the Docs MCP server refuses for quota and no page fetch is possible, tell the user to sign in through `/mcp` rather than answering from memory | `skills/redpanda-docs/references/SOURCES.md` (anonymous quota row) | none |

## Docs gaps (not skill claims; do not re-verify here)

- `rpk security acl delete --dry` still asks for confirmation before it prints "Dry run,
  exiting.", even with `--no-confirm`, so with no terminal it fails after printing the matches.
  `rpk security acl list` with the same filters is the non-interactive preview. The page
  https://docs.redpanda.com/streaming/current/reference/rpk/rpk-security/rpk-security-acl-delete/
  (checked 2026-11-10) describes `--dry` only as "Dry run: validate what would be deleted."
  Source: `src/go/rpk/pkg/cli/security/acl/delete.go` (`if !noConfirm || dry` runs the describe,
  then `out.Confirm`, then the dry-run exit). Eval case `acl-delete-dry-still-prompts`: every arm
  failed 0/3, because neither the docs nor the full skill said it.
- The same page says "Anything matching more than 10 ACLs doubly confirms." The command asks
  once: `src/go/rpk/pkg/cli/security/acl/delete.go` has a single `out.Confirm` and no match
  count check. The sentence comes from the command's own help text, so the fix is in the rpk
  help. No eval case.

## Lines removed for lack of a failing baseline

Each of these procedures from the full skill (or its references) was tested on 2026-11-10 with
a behavioral case graded on the outcome, and rerun against the thin skill on the
re-verification runs named below (skill is the thin skill). The baseline passed, so the thin skill carries no line
for it. The cases stay in the suite.

- Remove only the operation asked for when revoking access: `rpk security acl delete` matches
  every operation you leave out. Case `revoke-consume-keep-produce`: baseline 3/3, skill 3/3,
  installed 3/3 (run `2026-11-10T20-54-45Z`, after the invariant fix under "Corrections after the eval run").
- Deleting a user does not delete its ACLs or role memberships, so offboarding also deletes the
  ACLs for `User:<name>` and unassigns the user from each role, without deleting shared roles.
  Case `offboard-user-acls-and-roles`: baseline 2/3, skill 3/3, installed 3/3 (run `2026-11-10T20-49-14Z`). The
  baseline run that failed never unassigned bob from the role; two of three passing still makes
  the line general knowledge, and leftover ACLs for a deleted user are not data loss.
- `superusers` is a list that `rpk cluster config set` replaces, so read it first and keep the
  existing entries. Case `add-superuser-keeps-existing`: baseline 3/3, skill 3/3,
  installed 3/3 (run `2026-11-10T20-49-14Z`).
- Bootstrapping SASL: create the superuser first, add it to `superusers`, then turn on
  `enable_sasl` and `kafka_enable_authorization` as cluster properties (not in `redpanda.yaml`).
  A behavioral case was drafted and dropped, because the stateless shell mock showed the old
  state after each change and the agents stopped. The baseline transcripts that were read planned the right
  order with cluster properties, so the line is treated as general knowledge.

The first run of the three kept cases used invariants that failed an answer for honestly
reporting that a listing after the change still showed the old state. The invariants were
rewritten to grade the change the agent made, and the three cases were rerun; the rates above
are from the rerun.

## Corrections after the eval run

The premise audit of 2026-11-10 checked each line against the code path rpk runs.

- `revoke-consume-keep-produce`: the invariant still failed answers that ran the READ-only delete
  and then reported, from the stateless mock's unchanged listing, that the change did not take
  effect. Run `2026-11-10T20-49-14Z` scored baseline 2/3, skill 1/3, installed 3/3 for that reason alone. The
  invariant now grades the change from the tool calls; rerun `2026-11-10T20-54-45Z` scored 3/3 in every arm. The
  line stays dropped.

## TODO / re-verify

- The mechanism line holds for rpk: no rpk command reads a user's mechanism. Outside rpk, the
  Admin API v2 `GetScramCredential` returns it (`proto/redpanda/core/admin/v2/security.proto`,
  `ScramCredential.mechanism`). The case's mock does not serve that call, so an agent that read
  the mechanism there and kept it would fail. No run tried it.
- The secret line says `rpk security secret update` overwrites the stored value. That holds for
  any non-empty `--value`. The Data Plane API marks `secret_data` optional, and the Console edit
  form says an empty value keeps the existing secret (public `redpanda-data/console`,
  `proto/redpanda/api/dataplane/v1/secret.proto` and
  `frontend/src/components/pages/secrets-store/edit/secret-edit-page.tsx`). Whether `--value ""`
  keeps the value on every cloud is not confirmed. The line stays, because a value the agent made
  up overwrites the secret either way.
