# rpk topic Skill Source Map

Maps each file in `skills/rpk-topic/` to the source paths it derives from, so future syncs and
human maintainers know exactly where to verify claims.

The `rpk topic` command group is Go source in the **public** repo `redpanda-data/redpanda` under
`src/go/rpk/pkg/cli/topic/`; the user-facing reference is auto-generated in the **public** repo
`redpanda-data/docs`. Topic *properties* (retention, tiered storage, Iceberg, schema-id
validation, etc.) are **broker** config, not rpk — `rpk` only passes `key=value` pairs through the
Kafka config APIs; the citation of record is the generated docs partial
`modules/reference/partials/properties/topic-properties.adoc` (upstream:
`src/v/config/configuration.cc`). All repos are public — read them via the Redpanda-Github-Read MCP
connector (`search_code`, `get_file_contents`), or `gh api` for verification; do not guess. Before
writing or changing any fact, re-open the cited source and confirm exact command paths, flag names,
and config keys. `rpk` is versioned: verify against the **current stable release tag**, not
`dev`/`main` (unreleased commands/flags are not yet user-facing).

## File-to-source table

| Skill file | redpanda source paths | docs sources |
|---|---|---|
| `SKILL.md` | `src/go/rpk/pkg/cli/topic/` — `topic.go` (group root), `create.go`, `list.go`, `describe.go`, `describe_storage.go`, `config.go` (`alter-config`), `add_partitions.go`, `trim.go` (`trim-prefix`), `analyze.go`, `delete.go`, `produce.go`, `consume.go`, `utils.go`; enterprise topic-property keys are broker config (`src/v/config/configuration.cc`), rpk only passes them through `create.go`/`config.go` | `modules/reference/pages/rpk/rpk-topic/` (`rpk-topic.adoc`, `-create`, `-list`, `-describe`, `-describe-storage`, `-alter-config`, `-add-partitions`, `-trim-prefix`, `-analyze`, `-delete`, `-produce`, `-consume`), `modules/reference/partials/properties/topic-properties.adoc` |
| `references/manage.md` | `src/go/rpk/pkg/cli/topic/create.go`, `list.go`, `describe.go`, `describe_storage.go`, `config.go` (`alter-config`), `add_partitions.go`, `trim.go`, `analyze.go`, `delete.go`, `topic.go`, `utils.go` | `modules/reference/pages/rpk/rpk-topic/rpk-topic-create.adoc`, `-list`, `-describe`, `-describe-storage`, `-alter-config`, `-add-partitions`, `-trim-prefix`, `-analyze`, `-delete` |
| `references/produce.md` | `src/go/rpk/pkg/cli/topic/produce.go` | `modules/reference/pages/rpk/rpk-topic/rpk-topic-produce.adoc` |
| `references/consume.md` | `src/go/rpk/pkg/cli/topic/consume.go` | `modules/reference/pages/rpk/rpk-topic/rpk-topic-consume.adoc` |
| `references/enterprise-topic-properties.md` | Topic properties are **broker** config, not rpk: `src/v/config/configuration.cc` (accepted values / defaults). rpk only passes them via `src/go/rpk/pkg/cli/topic/create.go` (`-c/--topic-config`) and `config.go` (`alter-config --set`). Enterprise gating is broker/license-side. | `modules/reference/partials/properties/topic-properties.adoc` (citation of record), `cluster-properties.adoc`, `object-storage-properties.adoc`; feature pages under `modules/manage/` and `modules/develop/`; `modules/get-started/pages/licensing/overview.adoc`; `rpk-topic-create.adoc`, `rpk-topic-alter-config.adoc` |

## Deferred to live introspection (NOT drift — do not pin or hardcode)

The skill deliberately points the agent at live values for these; a sync/audit must not "correct"
them into hardcoded facts:

- `rpk topic <cmd> --help` — live flag/usage output per installed version.
- `produce`/`consume` interactive behavior — stdin reading, Ctrl-D/Ctrl-C, per-record stdout lines, and continuous tailing are runtime behaviors, not static values.
- Server-resolved defaults — `-p -1` → `default_topic_partitions`, `-r -1` → `default_topic_replications` resolve on the broker; the actual numbers are cluster state.
- Version-gated values — e.g. `redpanda.storage.mode=unset` (introduced v26.1.1), `ordered_racks:` (v26.1+); confirm availability against the target release tag rather than assuming.
- `describe-storage` cloud-storage-mode enum and Schema-Registry decode output — produced by the broker/Admin API at runtime.

## TODO / re-verify

- **Command-to-filename mismatches** (verified, noted so a future audit doesn't flag a "missing" file): `trim-prefix` is defined in `trim.go`, `add-partitions` in `add_partitions.go`, and `alter-config` in `config.go` (`Use: "alter-config [TOPICS...] --set key=value --delete key2,key3"`). There is no `trim-prefix.go`/`add-partitions.go`/`alter-config.go`.
- **Enterprise topic-property accepted values, defaults, and expiration behavior** are broker config, not rpk. Treat `topic-properties.adoc` as the citation of record; upstream is `src/v/config/configuration.cc` (not line-verified per-key here). Confluent-compatible aliases (`confluent.key/value.schema.validation`, `confluent.key/value.subject.name.strategy`) are also broker-side.
- Individual produce/consume `--format` percent-escape tokens and modifiers were not each re-verified against `produce.go`/`consume.go` in this pass — re-check the token/modifier tables there if editing.
- **Serverless topic-config allowlist**: cloud-docs does not publish an explicit list of which topic-level configs are settable versus rejected/managed on Serverless — verify specific `alter-config --set` keys against a live Serverless cluster or the Cloud UI before advising them.

## Redpanda Cloud applicability sources

The "Redpanda Cloud notes" section in `SKILL.md` and the Cloud callouts in `references/manage.md`
derive from the **private** repo `redpanda-data/cloud-docs` (read via the Redpanda-Github-Read
connector; do not clone):

- `modules/get-started/pages/cloud-overview.adoc` — `rpk topic describe-storage` is the one
  unsupported `rpk topic` subcommand ("All other rpk topic commands are supported on both Redpanda
  Cloud and Self Managed"); the Admin API and `rpk cluster license` are unsupported on Cloud;
  automatic topic creation is disabled, with BYOC/Dedicated opt-in via `auto_create_topics_enabled`.
- `modules/develop/pages/topics/create-topic.adoc` — minimum replication factor 3 (RF 1 is reset
  to 3); `max.message.bytes` defaults/caps differ per cluster type; Tiered Storage is enabled and
  configured by default in Redpanda Cloud.
- `modules/get-started/pages/cluster-types/serverless.adoc` — "Serverless usage limits" (partition
  cap, consumer groups, connections, ACLs, producer IDs, message size); the `rpk cloud login` +
  `rpk topic` workflow; the auto-topic-creation note.
- `modules/reference/partials/tiers.adoc` (rendered as `modules/reference/pages/tiers/byoc-tiers.adoc`
  and `dedicated-tiers.adoc`) — per-usage-tier partition maxima (volatile; deferred by page name).
- `modules/manage/pages/cluster-maintenance/config-cluster.adoc` — cluster properties are
  unavailable on Serverless and on Azure clusters; a curated subset is settable on BYOC/Dedicated
  (AWS/GCP).

Numeric limits (partition caps, message-size caps, tier tables) are deliberately **not** hardcoded
in the skill — durability principle; the pages above are the live reference.

## Usage

For each file being reviewed or updated, open the listed source paths first and confirm every claim
still matches. Verify against the current stable release tag of `redpanda-data/redpanda`, and
re-confirm exact command paths / flag names / config keys before writing any new fact. Remember
topic *properties* are broker config: cite the docs partial, not an rpk source file.
