# connect-cdc-dynamodb Skill Source Map

Maps each file in `skills/connect-cdc-dynamodb/` to the source paths it derives from, so future syncs and human maintainers know exactly where to verify claims.

The subject is the `aws_dynamodb_cdc` **input** of Redpanda Connect (change data capture over DynamoDB Streams). Two **public** repos are authoritative:

- `redpanda-data/connect` — Go implementation under `internal/impl/aws/dynamodb/`. `internal/plugins/info.csv` classifies the input as **enterprise**-tier, and `input_cdc.go` carries the standard Enterprise-file header (under the Redpanda Community License). The input registers itself as **`Stable()`** and, unlike the other enterprise `*_cdc` inputs, carries **no runtime Enterprise license gate** (no `license.CheckRunningEnterprise` call in source) — verified.
- `redpanda-data/rp-connect-docs` — the connector reference page and its **auto-generated** field partial, plus the `docs-data/overrides.json` that customizes generated field descriptions.

Read both via the Redpanda-Github-Read MCP connector (`get_file_contents`) or `gh api .../contents/`. Avoid `gh search code` (rate-limited). Before writing or changing any fact, re-open the cited source and confirm exact field names, defaults, enums, and metric names.

**Critical grounding rule:** the connector's **field list, defaults, and enum options are auto-generated** from the Go config spec into `modules/components/partials/fields/inputs/aws_dynamodb_cdc.adoc`. Treat that generated partial (plus `docs-data/overrides.json` for description text) as the citation of record for field/default facts — do **not** hardcode them. If `config-reference.md` drifts, the generated partial wins.

## File-to-source table

| Skill file | `redpanda-data/connect` source paths | `redpanda-data/rp-connect-docs` sources |
|---|---|---|
| `SKILL.md` | `internal/impl/aws/dynamodb/input_cdc.go` (registration = `Stable()`, no license gate; fields, snapshot modes, metadata keys, metrics) | `modules/components/pages/inputs/aws_dynamodb_cdc.adoc`, `modules/components/partials/fields/inputs/aws_dynamodb_cdc.adoc` (auto-gen) |
| `references/config-reference.md` | `internal/impl/aws/dynamodb/input_cdc.go` (config spec, `LintRule`s on `snapshot_segments`/`snapshot_batch_size`/`snapshot_throttle`; metric names `dynamodb_cdc_*`), `checkpoint.go` (checkpoint-table schema, snapshot sentinel ShardIDs), `snapshot.go` (parallel Scan, dedup) | `modules/components/partials/fields/inputs/aws_dynamodb_cdc.adoc` (**auto-generated** — types, defaults, options of record), `docs-data/overrides.json` (`aws_dynamodb_cdc` entry) |
| `references/pipeline-and-output.md` | `internal/impl/aws/dynamodb/input_cdc.go` (message JSON shape, `keys`/`newImage`/`oldImage`/`sizeBytes` presence rules, `READ` snapshot events, metadata keys incl. `dynamodb_snapshot_segment`), `snapshot.go` + `checkpoint.go` (snapshot→CDC ordering, RFC3339Nano / `ApproximateCreationDateTime` dedup, restart behavior) | `modules/components/pages/inputs/aws_dynamodb_cdc.adoc` (message structure, metadata, example mapping) |
| `references/setup-dynamodb.md` | `internal/impl/aws/dynamodb/input_cdc.go` (`DescribeTable` used to resolve stream ARN — `ListStreams` **not** called; 24h retention handling; `TrimmedDataAccessException` restart), shard lifecycle: refresh every `30s`, cleanup every `5m`, `bench/README.md` (DynamoDB Local single-shard; throughput ~95,516–102,000 msg/sec) | (none — AWS-side setup) |
| `references/enterprise-redpanda-features.md` | n/a — `info.csv` classifies the input enterprise-tier; `input_cdc.go` confirms it is `Stable()` with no runtime license gate | Connect-side rows cite `connect:` doc pages (licensing, secrets, config service, allow/deny). **Redpanda-cluster/topic** Enterprise properties (Iceberg, Tiered Storage, RRR, Schema ID Validation, Shadow Linking) are **external** — see TODO. |

## Deferred to live introspection (NOT drift — do not pin or hardcode)

- **Field types / defaults / enum options** — generated from the Go spec into `modules/components/partials/fields/inputs/aws_dynamodb_cdc.adoc`. Regenerate/read that partial, don't hand-edit `config-reference.md`. Field descriptions customized via `docs-data/overrides.json`.
- **The connector reference page body** pulls Common/Advanced examples and Fields/Examples from generated includes; regenerate rather than transcribe.
- **Benchmark throughput numbers** — environment-dependent output in `connect` `bench/README.md`; illustrative, not a guarantee.
- **AWS DynamoDB setup** (`update-table` stream specs, IAM JSON, Terraform, DynamoDB Local) — external AWS behavior; verify against AWS docs, not the connector repo.

## TODO / re-verify

- **Status drift (flag):** source registers the input as **`Stable()`**, but the docs page header sets `:status: beta`. SKILL.md follows the source ("Stable"). Re-verify which is current and reconcile the page's `:status:`.
- **Support tier vs runtime gate (resolved 2026-08-01):** `internal/plugins/info.csv` lists `aws_dynamodb_cdc` as `enterprise` (`cloud: y`) and `input_cdc.go` carries the Enterprise-file header, but the impl has **no** `license.CheckRunningEnterprise` call — so no runtime license is enforced. The skill previously called the connector "Community-licensed"; it now classifies it enterprise-tier and notes the currently-absent runtime gate. Whether the missing gate is intentional is a product question — re-verify if a future release adds one.
- **Wrong docs path in `config-reference.md`:** cites `connect/docs/modules/components/pages/inputs/aws_dynamodb_cdc.adoc`. Verified actual location is repo **`rp-connect-docs`**, path `modules/components/pages/inputs/aws_dynamodb_cdc.adoc` (no `connect/docs/` prefix). Correct the citation.
- **Checkpoint schema + snapshot sentinel ShardIDs** (`snapshot#segment#N`, `snapshot#complete`) and the `(StreamArn, ShardID)` primary key were attributed to `checkpoint.go`/`snapshot.go` but not line-verified — open `internal/impl/aws/dynamodb/checkpoint.go` to confirm exact strings.
- **Enterprise Redpanda topic/cluster properties** (`redpanda.iceberg.*`, `redpanda.remote.*`, `iceberg_enabled`, `cloud_storage_enabled`, etc.) live in `redpanda-data/docs` auto-generated property partials, upstreamed from `src/v/config/configuration.cc` — out of the connect/rp-connect-docs scope; verify there.
- **`rpk shadow` command family** in `enterprise-redpanda-features.md` belongs to rpk/redpanda source — cross-check the `rpk` skill's SOURCES map, not this connector.

## Sync log

- **Verified against Connect v4.106.0 (2026-08-21 sync).** Sources for this release's changes:
  - `internal/impl/aws/dynamodb/input_cdc.go` — `service.NewAutoRetryNacksToggleField()` + `service.AutoRetryNacksBatchedToggled` (the new `auto_replay_nacks` field, default `true`); the `honorStartFrom atomic.Bool` on both the single-table and multi-table (`tableStream`) paths and the `checkpointer.HasAnyState` probe in `connectSingleTable`, which together implement "`start_from` applies only to a genuinely fresh pipeline; later-discovered and checkpoint-less shards always start at `TRIM_HORIZON`".
  - `internal/impl/aws/dynamodb/snapshot_ack.go` (new) + `snapshot.go`, `checkpoint.go` — snapshot checkpoint persistence gated on downstream acknowledgment, so a rejected snapshot batch is redelivered rather than skipped.
- **Backfilled from v4.101.0 in the same pass:** `checkpoint_namespace` was absent from the skill. Added because the new `start_from` wording is defined relative to it ("no checkpoint state under this `checkpoint_namespace`"). Grounded in the generated page's `checkpoint_namespace` field and Checkpointing section (isolates, does not coordinate; must not contain `#`).

## TODO — unresolved contradiction (flagged, not guessed)

- **`auto_replay_nacks: false` on the CDC shard path: does a nack pin or advance the shard checkpoint?** Two upstream statements disagree at v4.106.0:
  - the v4.106.0 release notes say nacks **advance** checkpoints when `auto_replay_nacks` is disabled, and the snapshot ack function in `internal/impl/aws/dynamodb/input_cdc.go` matches that (the ack error is deliberately ignored so "the segment's checkpoint must advance past them rather than pin the tracker");
  - the comment at the input's registration in the same file says that with the toggle off "a nack **pins** the shard's checkpoint frontier and redelivery happens on restart".
  These may describe genuinely different paths (snapshot vs CDC shard) or one comment may be stale. The skill asserts only the snapshot behavior and names the conflict for the CDC path. **Needs Connect-team confirmation** — do not resolve it by picking the more plausible reading.

## Known gaps (not yet documented — for a future sync)

- **`global_table` / `global_table_replicas`** (multi-region checkpoint replication as a DynamoDB Global Table v2, including the reconcile-vs-fail-fast behavior on a pre-existing non-global table and the extra IAM actions required) are in the generated reference but absent from this skill.
- **`dynamodb_cdc_failover_skipped`** metric and the **`dynamodb_approximate_creation_time`** metadata field are likewise undocumented here.

## Usage

For each file being reviewed or updated, open the listed source paths first and confirm every claim still matches. For any field/default/enum fact, read the generated `partial$fields/inputs/aws_dynamodb_cdc.adoc` + `docs-data/overrides.json` rather than trusting the transcribed table. Verify Go behavior against `internal/impl/aws/dynamodb/*.go` at the current release tag. Enterprise cluster/topic properties and `rpk` commands are external — cite their own repos.
