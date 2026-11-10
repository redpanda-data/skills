# rpk-redpanda Skill Source Map

The skill is thin: it keeps only the "How to work" procedure below, backed by behavioral eval
cases in `evals/suites/rpk-redpanda.eval.json`, and sends the agent to the docs for everything
else. This file maps only the claims the skill still makes.

The `rpk redpanda` command group and `rpk iotune` are Go source in the public repo
`redpanda-data/redpanda` under `src/go/rpk/pkg/cli/redpanda/` and `src/go/rpk/pkg/cli/iotune/`.
Verify against the current stable release tag (the public repo's last tag is v26.2.2), not
`dev`. Paths below are relative to that repo. Most of these commands build only on Linux
(`//go:build linux`), so a `--help` sweep on macOS sees none of them; that is not drift.

Eval pass rates are baseline / skill / installed, 3 runs each, recorded 2026-11-10. "Pre-thin"
is the skill before this conversion; "thin" is this SKILL.md.

## How to work: line, source, eval case

| How to work line | Source | Eval case |
|---|---|---|
| Check developer mode before starting a broker that holds real data: with `redpanda.developer_mode: true` and no `--mode`, `rpk redpanda start` runs `dev-container` mode, which bypasses fsync; `--mode dev-container` saves `developer_mode: true` for later starts; run `rpk redpanda mode production` (or ask) first. Safety guardrail (data loss). Baseline 1/3; pre-thin skill 3/3, installed 2/3; thin skill 2/3, installed 3/3 (the failing run named the risk but started the broker before asking). | `src/go/rpk/pkg/cli/redpanda/start.go` (`DeveloperMode` with an empty `--mode` selects `dev-container`; `setContainerModeFlags` sets `--unsafe-bypass-fsync`; `y.Write` before launch), `src/go/rpk/pkg/config/config.go` (`setProdMode` sets `DeveloperMode = false`) | `start-broker-developer-mode-on` |
| Drain a broker with `rpk cluster maintenance enable <id> --wait` before stopping Redpanda on it, and disable maintenance mode when it is back. Baseline 0/3; thin skill 3/3, installed 3/3 (rerun after a mock fix that showed the broker already in maintenance mode). On the earlier mock the pre-thin skill, which kept the line in a reference file, scored 1/3. | `src/go/rpk/pkg/cli/cluster/maintenance/enable.go` (drains leadership; `--wait`), https://docs.redpanda.com/streaming/current/manage/node-management/ | `reboot-broker-drain-first` |
| Don't apply the autotuner (`rpk redpanda tune`, `start --tune`, `redpanda-tuner`) in Azure self-managed environments; other production preparation still applies. Baseline 0/3; pre-thin skill 3/3, installed 3/3; thin skill 3/3, installed 3/3. | https://docs.redpanda.com/streaming/current/reference/rpk/rpk-redpanda/rpk-redpanda-tune/ ("Do not use this command in Azure self-managed environments", checked 2026-11-10). Not in rpk's help text. | `azure-node-production-prep` |

## Other claims in SKILL.md

| Claim | Source | Eval case |
|---|---|---|
| `get_rpk_command` looks up one rpk command, `get_config_property` one property, `list_config_properties` finds a property's name | Live `tools/list` from `https://docs.redpanda.com/mcp` (see `skills/redpanda-docs/references/SOURCES.md`) | none |
| When the Docs MCP server refuses for quota and no page fetch is possible, tell the user to sign in through `/mcp` | `skills/redpanda-docs/references/SOURCES.md` (anonymous quota row) | none |
| Most of `rpk redpanda` and all of `rpk iotune` exist only in Linux builds of rpk | `src/go/rpk/pkg/cli/redpanda/redpanda.go` and `src/go/rpk/pkg/cli/iotune/iotune.go` (`//go:build linux`); `src/go/rpk/pkg/cli/redpanda/redpanda_darwin.go` registers only the hidden `admin` subtree | `macos-node-commands-missing` (baseline 3/3) |

## Docs gaps (not skill claims; do not re-verify here)

Found by the 2026-11-10 eval run (the docs arm failed) and checked against the published pages
the same day. The rpk reference pages are generated from rpk's help text, so each is a
help-text fix in rpk source, not a docs edit. None of these facts is in rpk's help today, so no
docs override (`docs-data/rpk-overrides.json`) hides them.

- `rpk redpanda start` applies `dev-container` mode whenever `redpanda.developer_mode` is `true`
  and no `--mode` is given, and `--mode dev-container` writes `developer_mode: true` (and the
  bundled cluster properties) into `redpanda.yaml`, so later plain starts also bypass fsync. The
  page https://docs.redpanda.com/streaming/current/reference/rpk/rpk-redpanda/rpk-redpanda-start/
  lists the bundled flags but says neither. Source: `src/go/rpk/pkg/cli/redpanda/start.go`.
  Case `dev-container-persists`: docs 0/3, both 0/3.
- `rpk redpanda start` writes the values of its flags (for example `--seeds` and
  `--advertise-kafka-addr`) into `redpanda.yaml` before launching, so they persist. The same
  start page does not say so. Source: `src/go/rpk/pkg/cli/redpanda/start.go` (`y.Write(fs)`
  before `launcher.Start`). Case `start-flags-persist`: baseline 3/3, but docs 2/3 and both 0/3,
  because the docs arms read the page as saying the flags apply to one run.
- `rpk redpanda config bootstrap` replaces listener and advertised addresses only while they hold
  the defaults, and always replaces `seed_servers` with the `--ips` list (so omitting `--ips`
  empties it). The page
  https://docs.redpanda.com/streaming/current/reference/rpk/rpk-redpanda/rpk-redpanda-config-bootstrap/
  says only that bootstrap "may undo some of your earlier edits". Source:
  `src/go/rpk/pkg/cli/redpanda/config.go` (`bootstrap`). Case `bootstrap-rerun-edited-file`:
  docs 0/3.
- `rpk redpanda config print` fetches the node configuration from a running broker's Admin API
  (`--host` picks the address); it does not read the local `redpanda.yaml` and fails while the
  broker is stopped. The page
  https://docs.redpanda.com/streaming/current/reference/rpk/rpk-redpanda/rpk-redpanda-config-print/
  says only "Display the selected node configuration", and its `--host` help calls the index one
  into "the configured Kafka broker list" when it indexes `rpk.admin_api.addresses`. Source:
  `src/go/rpk/pkg/cli/redpanda/config.go` (`printCommand`: `selectHost` over
  `p.AdminAPI.Addresses`, `adminapi.NewHostClient`, `GetNodeConfig`). Case `config-print-needs-running-broker`: docs 0/3.
- `rpk redpanda tune` takes several tuners as one comma-separated argument
  (`rpk redpanda tune disk_irq,net`); with spaces, only the first tuner runs and the rest are
  ignored without an error. The page
  https://docs.redpanda.com/streaming/current/reference/rpk/rpk-redpanda/rpk-redpanda-tune/
  shows only `rpk redpanda tune [list of elements to tune]`. Source:
  `src/go/rpk/pkg/cli/redpanda/tune/tune.go` (`strings.Split(args[0], ",")`). Case
  `tune-several-tuners-syntax`: docs 0/3.

## Drift in the pre-thin skill (removed with the conversion)

- The pre-thin skill said `rpk redpanda admin partitions list` was unaffected by the v26.2
  deprecations. At v26.2.2 the whole `rpk redpanda admin` group is hidden and deprecated, and
  `partitions list` points to `rpk cluster partitions list --node-ids <ID>`
  (`src/go/rpk/pkg/cli/redpanda/admin/admin.go`, `admin/partitions/partitions.go`).
- The pre-thin skill said `rpk redpanda config print` shows the local node configuration and
  sent agents to `rpk redpanda admin config print` for a running broker. `config print` itself
  queries the Admin API (see the docs gap above). Case `config-print-needs-running-broker`:
  skill 0/3.
- The pre-thin skill showed `sudo rpk redpanda tune disk_irq net` to run two tuners. That runs
  only `disk_irq` (see the docs gap above). Case `tune-several-tuners-syntax`: skill 0/3.
- The pre-thin skill said running bootstrap over an existing file "resets the fields it
  manages". It resets `seed_servers` but keeps non-default addresses (see the docs gap above).

## Lines removed for lack of a failing baseline

- Decommission pre-checks (the remaining broker count must still cover the highest replication
  factor, plus rack, disk, and partition-density checks) were not kept. Case
  `decommission-shrink-three-brokers` (decommission one of three brokers whose topics use
  replication factor 3) passed 3/3 in every arm, baseline included: without the skill, the agent
  checked the replication factor and stopped to ask. Decommission is in `/redpanda:rpk-cluster`.
- The pre-thin skill's other procedural notes (provision order: bootstrap, production mode, tune,
  iotune, check, start; iotune once per hardware type; node config vs cluster config) are
  documented procedure or general practice and were left to the docs. Facts sampled from them
  passed in the baseline (`tune-all-nothing-applied` 3/3, `iotune-file-picked-up` 2/3,
  `stop-signal-escalation` 3/3, `config-set-array-append` 3/3, `mode-recovery-scope` 3/3) or
  were found by the docs arms (`well-known-io-conflict` docs 2/3, installed 3/3;
  `decommission-dead-broker` docs 3/3; `mode-prod-tuner-set` docs 3/3;
  `tune-exit-status-unsupported` docs 3/3).
