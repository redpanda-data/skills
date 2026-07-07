# connect-cdc-tigerbeetle Skill Source Map

Maps each file in `skills/connect-cdc-tigerbeetle/` to the source paths it derives from, so future syncs and human maintainers know exactly where to verify claims.

The subject is the `tigerbeetle_cdc` **input** of Redpanda Connect (change data capture over TigerBeetle's CDC facility). Two **public** repos are authoritative:

- `redpanda-data/connect` — Go implementation in `internal/impl/tigerbeetle/input_tigerbeetle.go` (plus `config_test.go`, `integration_test.go`). The file is gated `//go:build cgo`, carries an **Apache-2.0** license header, registers via `service.MustRegisterBatchInput("tigerbeetle_cdc", ...)`, and has **no Enterprise license gate** (no `license.CheckRunningEnterprise` call) — verified against the file at authoring time. The commercial support tier of record is `internal/plugins/info.csv`: `tigerbeetle_cdc` is **`certified`** (the only `*_cdc` input not marked `enterprise`) with `cloud: n` and `cloud_unsupported_reason: "not yet certified for cloud"` — verified in the CSV at authoring time.
- `redpanda-data/rp-connect-docs` — the connector reference page, its **auto-generated** field partial, and the TigerBeetle CDC cookbook with runnable example YAMLs.

Read both via the Redpanda-Github-Read MCP connector (`get_file_contents`) or `gh api .../contents/`. Before writing or changing any fact, re-open the cited source and confirm exact field names, defaults, enums, and metadata keys.

**Critical grounding rule:** the connector's **field list, defaults, and descriptions are auto-generated** from the Go config spec into `modules/components/partials/fields/inputs/tigerbeetle_cdc.adoc`. Treat that generated partial as the citation of record for field/default facts — do **not** hardcode them elsewhere. If `config-reference.md` drifts, the generated partial wins. Note that `rpk connect create tigerbeetle_cdc` does **not** work as a live surface here (rpk builds lack cgo); use `redpanda-connect create tigerbeetle_cdc` on a cgo-enabled binary instead.

## File-to-source table

| Skill file | `redpanda-data/connect` source paths | `redpanda-data/rp-connect-docs` sources |
|---|---|---|
| `SKILL.md` | `internal/impl/tigerbeetle/input_tigerbeetle.go` (registration, `//go:build cgo`, fields, metadata keys, event-type enum, at-least-once + ordering, JSON shape) | `modules/components/pages/inputs/tigerbeetle_cdc.adoc` (intro, 4.65.0, beta status, requirements, metadata table), `modules/cookbooks/pages/tigerbeetle_cdc.adoc` (patterns, Redis cache, troubleshooting) |
| `references/config-reference.md` | `internal/impl/tigerbeetle/input_tigerbeetle.go` (`configSpec()` — field constants, defaults `2730`/`1000`/`15`, LintRules, `AutoRetryNacksToggleField`; `newTigerbeetleInput` runtime validation incl. cache/rate-limit resource existence; cache key `timestamp_last_<cluster_id>`, 8-byte little-endian value; no custom metrics defined) | `modules/components/partials/fields/inputs/tigerbeetle_cdc.adoc` (**auto-generated** — types, defaults of record), `modules/components/pages/inputs/tigerbeetle_cdc.adoc` (version 4.65.0, `:status: beta`) |
| `references/pipeline-and-output.md` | `internal/impl/tigerbeetle/input_tigerbeetle.go` (`JsonChangeEvent`/`JsonTransfer`/`JsonAccount` JSON field names and string-vs-number encoding, `MetaSet` keys, `eventTypeString` enum, single-in-flight-batch ordering in `produce`/`consume`, ack-driven checkpoint) | `modules/cookbooks/pages/tigerbeetle_cdc.adoc` + `modules/cookbooks/examples/tigerbeetle_cdc/{basic-capture,filter-events,to-redpanda,to-s3,route-by-event}.yaml` (all pipeline examples), `modules/components/pages/inputs/tigerbeetle_cdc.adoc` (sample event JSON, metadata table, guarantees) |
| `references/setup-tigerbeetle.md` | `internal/impl/tigerbeetle/input_tigerbeetle.go` (`//go:build cgo`; first-request connection check in `Connect()`; cache key derivation; `timestamp_initial` override logic `timestampLast = timestamp_initial - 1`) | `modules/components/pages/inputs/tigerbeetle_cdc.adoc` (0.16.57 requirement, client-not-newer rule, cgo requirement), `modules/install/pages/prebuilt-binary.adoc` (`redpanda-connect-cgo_*_linux_amd64.tar.gz`, Linux AMD64 only, binary name `redpanda-connect`), `modules/install/pages/build-from-source.adoc`, `modules/cookbooks/pages/tigerbeetle_cdc.adoc` (cache choices: redis/aws_dynamodb/sql; host:port addresses; three-replica note; troubleshooting) |
| `references/enterprise-redpanda-features.md` | `internal/plugins/info.csv` (`certified` tier — connector itself is not enterprise); `input_tigerbeetle.go` (Apache-2.0 header, no license check) | Connect-side rows cite `connect:` doc pages (licensing, secrets, config service, allow/deny). **Redpanda-cluster/topic** Enterprise properties (Iceberg, Tiered Storage, RRR, Schema ID Validation, Shadow Linking) are **external** — see TODO. |

External upstream (behavioral context only, not transcribed): TigerBeetle CDC docs at `https://docs.tigerbeetle.com/operating/cdc/` (linked from the component description). Retention/availability of past events is TigerBeetle's domain — the skill deliberately defers it there.

## Deferred to live introspection (NOT drift — do not pin or hardcode)

- **Field types / defaults / descriptions** — generated from the Go spec into `modules/components/partials/fields/inputs/tigerbeetle_cdc.adoc`. Read that partial (or run `redpanda-connect create tigerbeetle_cdc` on a cgo binary), don't hand-edit `config-reference.md`.
- **Connect release versions** and prebuilt-binary download URLs — use the GitHub releases page; the skill uses `<VERSION>` placeholders.
- **TigerBeetle cluster setup and CDC retention semantics** — external TigerBeetle behavior; verify against TigerBeetle docs, not the connector repo. (The 0.16.57 minimum is stated in both the Go source description and the docs page, so it is pinned.)
- **Redpanda Enterprise topic/cluster property defaults** — live in `redpanda-data/docs` auto-generated property partials.

## TODO / re-verify

- **Status drift (flag):** source `configSpec()` registers **`Stable()`**, but the docs page sets `:status: beta` and the cookbook says "in beta. The API is subject to change." The skill follows the **docs (beta)** — the more conservative, user-facing label — but this is the same class of drift flagged for `aws_dynamodb_cdc` (there the skill followed source). Reconcile which is current and align both skills' conventions.
- **Version drift (flag):** source `configSpec()` declares `Version("0.0.1")` (looks like a placeholder), while the docs page says "Introduced in version 4.65.0". The skill cites 4.65.0 per docs. Confirm 4.65.0 against the release notes when reconciling.
- **`timeout_seconds` missing from docs page body:** the auto-generated partial `modules/components/partials/fields/inputs/tigerbeetle_cdc.adoc` and the Go source both define `timeout_seconds` (default 15), but the hand-listed Fields section and example config in `modules/components/pages/inputs/tigerbeetle_cdc.adoc` omit it. The page appears hand-maintained rather than including the generated partial — docs bug worth fixing upstream.
- **No `docs-data/overrides.json` entry** for `tigerbeetle_cdc` existed at authoring time (checked); if one appears, it becomes part of the description citation chain.
- **Enterprise Redpanda topic/cluster properties** (`redpanda.iceberg.*`, `redpanda.remote.*`, `iceberg_enabled`, `cloud_storage_enabled`, etc.) were mirrored from the `connect-cdc-dynamodb` sibling's enterprise reference, which cites `redpanda-data/docs` auto-generated property partials (upstreamed from `src/v/config/configuration.cc`) — out of the connect/rp-connect-docs scope; verify there.
- **`rpk shadow` command family** in `enterprise-redpanda-features.md` belongs to rpk/redpanda source — cross-check the `rpk` skill's SOURCES map, not this connector.
- **FIPS on the cgo binary:** the Connect FIPS doc covers the `rpk`-embedded flow; whether a FIPS-compliant cgo standalone binary exists is unconfirmed — flagged in the enterprise reference.
- **Sibling-skill conflict (flag, not this skill's scope):** `internal/plugins/info.csv` marks `aws_dynamodb_cdc` as `enterprise`, while the `connect-cdc-dynamodb` skill (and its SOURCES.md) describes it as Community/Stable with no license gate based on its Go source. One of the two is stale — reconcile `info.csv` vs `internal/impl/aws/dynamodb/input_cdc.go` and update the dynamodb skill accordingly.
- **Cloud availability is volatile:** `cloud: n` / "not yet certified for cloud" in `info.csv` can flip in a release. Re-check the CSV row before repeating the "not available as a Cloud managed pipeline" claim.

## Usage

For each file being reviewed or updated, open the listed source paths first and confirm every claim still matches. For any field/default fact, read the generated `partial$fields/inputs/tigerbeetle_cdc.adoc` rather than trusting the transcribed table. Verify Go behavior against `internal/impl/tigerbeetle/input_tigerbeetle.go` at the current release tag. Enterprise cluster/topic properties and `rpk` commands are external — cite their own repos.
