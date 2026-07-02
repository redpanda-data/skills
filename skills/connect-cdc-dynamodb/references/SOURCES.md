# connect-cdc-dynamodb Skill Source Map

Maps each file in `skills/connect-cdc-dynamodb/` to the source paths it derives from, so future syncs and human maintainers know exactly where to verify claims.

The subject is the `aws_dynamodb_cdc` **input** of Redpanda Connect (change data capture over DynamoDB Streams). Two **public** repos are authoritative:

- `redpanda-data/connect` — Go implementation under `internal/impl/aws/dynamodb/`. The input registers itself as **`Stable()`** and carries **no Enterprise license gate** (no `EnterpriseLicense` reference in source) — verified.
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
| `references/enterprise-redpanda-features.md` | n/a — `input_cdc.go` only confirms the connector is Community/Stable and un-gated | Connect-side rows cite `connect:` doc pages (licensing, secrets, config service, allow/deny). **Redpanda-cluster/topic** Enterprise properties (Iceberg, Tiered Storage, RRR, Schema ID Validation, Shadow Linking) are **external** — see TODO. |

## Deferred to live introspection (NOT drift — do not pin or hardcode)

- **Field types / defaults / enum options** — generated from the Go spec into `modules/components/partials/fields/inputs/aws_dynamodb_cdc.adoc`. Regenerate/read that partial, don't hand-edit `config-reference.md`. Field descriptions customized via `docs-data/overrides.json`.
- **The connector reference page body** pulls Common/Advanced examples and Fields/Examples from generated includes; regenerate rather than transcribe.
- **Benchmark throughput numbers** — environment-dependent output in `connect` `bench/README.md`; illustrative, not a guarantee.
- **AWS DynamoDB setup** (`update-table` stream specs, IAM JSON, Terraform, DynamoDB Local) — external AWS behavior; verify against AWS docs, not the connector repo.

## TODO / re-verify

- **Status drift (flag):** source registers the input as **`Stable()`**, but the docs page header sets `:status: beta`. SKILL.md follows the source ("Stable"). Re-verify which is current and reconcile the page's `:status:`.
- **Wrong docs path in `config-reference.md`:** cites `connect/docs/modules/components/pages/inputs/aws_dynamodb_cdc.adoc`. Verified actual location is repo **`rp-connect-docs`**, path `modules/components/pages/inputs/aws_dynamodb_cdc.adoc` (no `connect/docs/` prefix). Correct the citation.
- **Checkpoint schema + snapshot sentinel ShardIDs** (`snapshot#segment#N`, `snapshot#complete`) and the `(StreamArn, ShardID)` primary key were attributed to `checkpoint.go`/`snapshot.go` but not line-verified — open `internal/impl/aws/dynamodb/checkpoint.go` to confirm exact strings.
- **Enterprise Redpanda topic/cluster properties** (`redpanda.iceberg.*`, `redpanda.remote.*`, `iceberg_enabled`, `cloud_storage_enabled`, etc.) live in `redpanda-data/docs` auto-generated property partials, upstreamed from `src/v/config/configuration.cc` — out of the connect/rp-connect-docs scope; verify there.
- **`rpk shadow` command family** in `enterprise-redpanda-features.md` belongs to rpk/redpanda source — cross-check the `rpk` skill's SOURCES map, not this connector.

## Usage

For each file being reviewed or updated, open the listed source paths first and confirm every claim still matches. For any field/default/enum fact, read the generated `partial$fields/inputs/aws_dynamodb_cdc.adoc` + `docs-data/overrides.json` rather than trusting the transcribed table. Verify Go behavior against `internal/impl/aws/dynamodb/*.go` at the current release tag. Enterprise cluster/topic properties and `rpk` commands are external — cite their own repos.
