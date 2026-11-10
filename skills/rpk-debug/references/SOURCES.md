# rpk-debug Skill Source Map

The skill is thin: it keeps only the "How to work" procedure below, backed by a behavioral
eval case in `evals/suites/rpk-debug.eval.json`, and sends the agent to the docs for
everything else. This file maps only the claims the skill still makes.

The `rpk debug` command group is Go source in the **public** repo `redpanda-data/redpanda`
under `src/go/rpk/pkg/cli/debug/`. Verify against the current stable release tag (checked at
`v26.2.6`), not `dev`. Paths below are relative to that repo unless they name another.

## How to work: line, source, eval case

| How to work line | Source | Eval case |
|---|---|---|
| `rpk debug remote-bundle` asks only the brokers in the profile's Admin API addresses (or `-X admin.hosts`); compare with `rpk cluster info` before `start`, and pass every broker's Admin API address on `start`, `status`, and `download` | `src/go/rpk/pkg/cli/debug/remotebundle/start.go` (loops over `p.AdminAPI.Addresses`), `status.go` and `download.go` (same address list) | `remote-bundle-all-brokers` (2026-11-10: baseline 1/3 and 0/3 in two runs; thin skill 3/3, installed 3/3) |

## Other claims in SKILL.md

| Claim | Source | Eval case |
|---|---|---|
| `rpk debug` works only on self-managed clusters; Redpanda Cloud has no broker host for `bundle`, `remote-bundle` needs the Admin API, and Support collects Cloud cluster diagnostics | `src/go/rpk/pkg/config/config.go` (`CheckExitCloudAdmin`), called from every `remotebundle/*.go` command; private `cloud-docs` `modules/get-started/pages/cloud-overview.adoc` (unsupported list: debug bundles, Admin API, `rpk debug`), published at https://docs.redpanda.com/cloud-data-platform/get-started/cloud-overview/ | `dedicated-cluster-debug-bundle`, `cloud-cluster-bundle-request` |
| `get_rpk_command` looks up one `rpk debug` subcommand; `get_config_property` looks up a feature's config property | Live `tools/list` from `https://docs.redpanda.com/mcp` (see `skills/redpanda-docs/references/SOURCES.md`) | none |
| When the Docs MCP server refuses for quota and no page fetch is possible, tell the user to sign in through `/mcp` | `skills/redpanda-docs/references/SOURCES.md` (anonymous quota row) | none |

## Docs gaps (not skill claims; do not re-verify here)

Found by the 2026-11-10 eval run (skill arm passes, docs arm fails, or no arm passes). Gaps on
an rpk reference page are fixed in rpk's help text at source, not in the docs.

- **Cloud support for debug bundles (docs).** The self-managed debug bundle guides
  (https://docs.redpanda.com/streaming/current/troubleshoot/debug-bundle/) and the rpk debug
  reference don't say that Redpanda Cloud clusters don't support debug bundles. The Cloud
  overview lists it, but the docs arm didn't find it (`dedicated-cluster-debug-bundle`, docs
  0/3). Source: `src/go/rpk/pkg/config/config.go` (`CheckExitCloudAdmin`).
- **remote-bundle scope (docs).** "Generate a Debug Bundle with `rpk` in Linux" says
  `rpk debug remote-bundle` collects "from all brokers in your cluster". It collects only from
  the Admin API addresses in the profile or `-X admin.hosts`. Source: `remotebundle/start.go`.
- **Output path fallback (help text).** Without `--output`, `rpk debug bundle` writes to the
  user's home directory when the current directory isn't writable; with `--output` set to an
  unwritable directory it fails. The `--output` help says only the default path, and the
  `rpk debug bundle` page has no other mention (`bundle-output-unwritable-dir`, docs 0/3).
  The docs override for this command does not hide it. Source:
  `src/go/rpk/pkg/cli/debug/bundle/bundle_linux.go` (`determineFilepath`).
- **Controller log slicing (help text).** When the controller log is over
  `--controller-logs-size-limit`, rpk keeps segments from the start and the end, about half the
  limit each, and drops the middle. The flag help says only "the size limit"
  (`controller-logs-over-limit`, docs 0/3). Not hidden by an override. Source:
  `bundle/bundle_linux.go` (`saveControllerLogDir`, `sliceControllerDir`).
- **Kubernetes namespace fallback (help text).** Without `--namespace`, rpk uses `$NAMESPACE`,
  then the pod's service account namespace file, then `redpanda`. The `--namespace` help says
  only "(K8s only)"; no arm answered (`k8s-namespace-resolution`, 0/3 in every arm). Not
  hidden by an override. Source: `bundle/bundle_k8s_linux.go` (`resolveNamespace`).
- **remote-bundle download layout (help text).** The download is one ZIP per broker, at
  `<root>/<broker address>/<job ID>.zip`. The download help and page don't say so
  (`remote-bundle-download-layout`, docs 0/3, baseline 2/3). Source: `remotebundle/download.go`.
- **`--partition` help example (help text).** The `rpk debug bundle` long help spells the flag
  `--partitions` and uses a `_redpanda-internal` namespace that does not exist; Redpanda's
  namespaces are `kafka`, `kafka_internal`, and `redpanda`, and the controller partition is
  `redpanda/controller/0`. The docs override for `rpk debug bundle` copies the same example.
  Sources: `bundle/bundle.go` (`bundleHelpText`), `src/go/rpk/pkg/out/in.go`
  (`ParsePartitionString`), `src/v/model/namespace.h`.

## Lines removed for lack of a failing baseline

Checked on 2026-11-10 with 3 runs per arm.

- "Don't collect a bundle for a Redpanda Cloud cluster; send the user to Support" as a "How to
  work" line: its behavioral case `cloud-cluster-bundle-request` passed 3/3 in the baseline,
  because `remote-bundle` prints that Admin API commands aren't supported on Cloud. The scope
  stays as a one-paragraph claim (see "Other claims"), backed by the fact case
  `dedicated-cluster-debug-bundle` (baseline 0/3, docs 0/3, thin skill 3/3, installed 3/3).
- "Set `--logs-since` to cover the incident, since the default is yesterday": its case
  `bundle-covers-older-incident` passed 3/3 in the baseline.
- "When triaging an Enterprise feature from a bundle, check `admin/license.json` first": its
  case `bundle-leader-placement-regression` passed 3/3 in the baseline.
- The full flag tables, the bundle file manifest, the remote-bundle lifecycle, and the
  per-feature Enterprise key reference (former `references/bundle.md`, `remotebundle.md`, and
  `enterprise-triage.md`) are facts and belong in the docs.
