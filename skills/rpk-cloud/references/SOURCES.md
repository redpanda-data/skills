# rpk-cloud Skill Source Map

The skill is thin: it keeps no "How to work" procedure, because no behavioral eval case in
`evals/suites/rpk-cloud.eval.json` failed in the baseline. It sends the agent to the docs for
everything. This file maps only the claims the skill still makes.

The `rpk cloud` CLI surface is Go source in the **public** repo `redpanda-data/redpanda` under
`src/go/rpk/pkg/`. Verify against the current stable release tag (claims below were checked at
`v26.2.2`), not `dev`. The generated reference content lives in the **private** `redpanda-data/docs`
repo under `modules/reference/partials/rpk-cloud/` (with overrides in
`docs-data/rpk-overrides.json`) and is single-sourced into the **private**
`redpanda-data/cloud-docs` repo. Read the private repos with the Redpanda-Github-Read connector;
do not clone them.

## How to work: line, source, eval case

None. See "Lines removed for lack of a failing baseline".

## Other claims in SKILL.md

| Claim | Source | Eval case |
|---|---|---|
| After `rpk cloud cluster select`, other rpk command groups talk to that Cloud cluster | `cli/cloud/cluster/select.go` (alias for `rpk profile create --from-cloud`), `cli/profile/create.go` (`CreateFlow` switches to the profile) | none |
| `get_rpk_command` looks up one rpk command and `list_rpk_commands` finds a command's name; `ask_redpanda_question` takes `platform: "cloud"` | Live `tools/list` from `https://docs.redpanda.com/mcp` (checked 2026-11-10; see `skills/redpanda-docs/references/SOURCES.md`) | none |
| The rpk cloud and rpk profile create reference pages | https://docs.redpanda.com/cloud-data-platform/reference/rpk/rpk-cloud/rpk-cloud/ and https://docs.redpanda.com/cloud-data-platform/reference/rpk/rpk-profile/rpk-profile-create/ (both 200 on 2026-11-10) | none |
| When the Docs MCP server refuses for quota and no page fetch is possible, tell the user to sign in through `/mcp` | `skills/redpanda-docs/references/SOURCES.md` (anonymous quota row) | none |
| BYOC `apply`, `destroy`, and `validate` come from the downloaded plugin; check them with `rpk cloud byoc <provider> --help` after `rpk cloud byoc install` | `cli/cloud/byoc/byoc.go` (`plugin.RegisterManaged`; provider commands are plugin commands), `cli/cloud/byoc/install.go` | none |

## Docs gaps (not skill claims; do not re-verify here)

Gaps on rpk reference pages are fixed in rpk's help text at source. Found by the 2026-11-10 eval run.

- **Cloud mount and unmount accept only the `kafka` namespace.** On a Cloud cluster,
  `rpk cluster storage mount` and `unmount` exit with "namespace not allowed; only kafka topics
  can be mounted in Redpanda Cloud clusters". The Cloud page
  https://docs.redpanda.com/cloud-data-platform/reference/rpk/rpk-cluster/rpk-cluster-storage-mount/
  does not say so, and its examples (from the docs override) mount `<my-namespace>/<my-topic>`.
  Source: `cli/cluster/storage/mount.go` and `unmount.go` (`CheckFromCloud` namespace check).
  Help-text fix: the mount and unmount help does not mention it; the override examples should
  not show a non-kafka namespace on the Cloud page. Case `mount-cloud-namespace` (docs 0/3).
- **`rpk cloud resource-group` has no reference page.** The command (create, list, delete with
  `--no-confirm`; aliases `namespace` and `ns`) is `Hidden: true`, so the generated reference
  skips it, and https://docs.redpanda.com/cloud-data-platform/reference/rpk/rpk-cloud/rpk-cloud-resource-group/
  returns 404. No override hides it. Source: `cli/cloud/resourcegroup/resourcegroup.go`,
  `delete.go`. Help-text fix: unhide the command or document resource groups elsewhere. Case
  `resource-group-cli` (docs 0/3).
- **`rpk cloud auth delete` asks for confirmation when profiles use the auth.** The page
  https://docs.redpanda.com/cloud-data-platform/reference/rpk/rpk-cloud/rpk-cloud-auth-delete/
  says affected profiles keep only SASL access but not that rpk lists them and prompts first.
  Source: `cli/cloud/auth/delete.go` (`out.Confirm`). Help-text fix: the help does not mention
  the prompt. Case `auth-delete-attached-profiles` (docs 0/3, all for the missing prompt).
- **Help text states credential precedence backwards (hidden by an override).** The
  `rpk cloud login` help lists rpk.yaml, then environment variables, then flags "in order of
  preference", but flags override environment variables, which override rpk.yaml. The docs
  override already rewrites the login page correctly, so the published page is right and only
  the help text needs fixing. Source: `config/params.go` (`processOverrides` applies env, then
  flags, over rpk.yaml), `cli/cloud/login.go`. Case `login-flags-beat-saved-credentials`
  (docs 3/3; the pre-thin skill repeated the help text and failed 0/3).
- Not a gap: `rpk cloud byoc <provider> validate` without `--redpanda-id` is on
  https://docs.redpanda.com/cloud-data-platform/reference/rpk/rpk-cloud/rpk-cloud-byoc/ (checked
  2026-11-10). Case `byoc-validate-before-cluster-id` passed 1/3 in the docs arm, a retrieval
  miss rather than a missing fact.
- Not covered by the eval: a plain `rpk cloud cluster select` replaces the whole existing
  `rpk-cloud` profile, including SASL credentials set by hand (`cli/profile/create.go`,
  `*old = *p`). The cluster select page says only that it creates or updates values in the
  default profile. Agents avoided the overwrite without being told (see below), so this is a
  possible help-text clarification, not a measured gap.

## Lines removed for lack of a failing baseline

- "Give a second Cloud cluster its own profile with `--profile` instead of a plain
  `rpk cloud cluster select`, which overwrites the `rpk-cloud` profile" was not kept on
  2026-11-10. Its case `second-cloud-cluster-keeps-current-profile` (the user's production
  profile is `rpk-cloud` and holds SASL credentials; set up a staging cluster too) passed 3/3 in
  the baseline: without the skill, the agent created a separately named profile. Rerun
  2026-11-10 (archive run `2026-11-10T20-41-54Z`): baseline 3/3, skill 3/3, installed 3/3.
- "Don't turn on MCP deletes yourself; tell the user to rerun `rpk cloud mcp install
  --allow-delete` and restart the client" was not kept on 2026-11-10. Its case
  `mcp-delete-forbidden-dont-self-enable` passed 3/3 in the baseline (skill 3/3, installed 3/3;
  rerun `2026-11-10T20-41-54Z`): the MCP server's own refusal tells the agent to hand the decision to the user. It was not kept
  as a safety guardrail: enabling deletes is a config change that makes later deletes possible,
  not itself data loss, an irreversible change, or a network exposure change.
- Every fact in the pre-thin skill and its five reference files (login and auth, cluster select
  and resource groups, BYOC, enterprise data features, RBAC and IAM) was removed. Fact cases in
  the suite measured how much of it the docs cover; the uncovered facts are listed above.
