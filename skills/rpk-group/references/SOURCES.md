# rpk-group Skill Source Map

Maps each file in `skills/rpk-group/` to the source paths it derives from, so future syncs and human maintainers know exactly where to verify claims.

The `rpk group` CLI is Go source in the **public** repo `redpanda-data/redpanda` under `src/go/rpk/pkg/cli/group/`. The subcommands it drives (list, describe, seek, offset-delete, delete) are thin clients over Kafka APIs whose **authorization, offset-commit, lag, and coordinator behavior is broker-side** in `src/v/kafka/server/`. The user-facing reference is auto-generated in the **public** repo `redpanda-data/docs`. All are public — read them via the Redpanda-Github-Read MCP connector (`get_file_contents`, `search_code`), or `gh api .../contents/<path>` for verification; do not guess. Before writing or changing any fact, re-open the cited source and confirm exact command paths, flag names, and config keys. `rpk` is versioned: verify against the **current stable release tag**, not `dev`/`main`.

Note on file layout: the `list` and `delete` subcommands are **not** in separate files — both are defined inside `group.go` (`NewCommand` → nested `newListCommand`/`newDeleteCommand`). Only `describe`, `seek`, and `offset-delete` have their own files. The command is `offset-delete` (spelled `offset_delete.go` in source), not `delete-offsets`.

## File-to-source table

| Skill file | redpanda source paths | docs sources |
|---|---|---|
| `SKILL.md` | `src/go/rpk/pkg/cli/group/group.go` (root cmd, alias `g`; `list`/`ls` with `--states -s`; `delete`), `describe.go`, `seek.go`, `offset_delete.go`; broker behavior: `src/v/kafka/server/group_manager.cc`, `src/v/kafka/server/handlers/{list_groups.h,describe_groups.h,delete_groups.h,offset_commit.h,offset_fetch.h,offset_delete.h,list_offsets.cc,find_coordinator.cc}`; shadow config struct `src/go/rpk/pkg/cli/shadow/types.go` (`consumer_offset_sync_options`) | `modules/reference/pages/rpk/rpk-group/rpk-group.adoc`, `rpk-group-list.adoc`, `rpk-group-describe.adoc`, `rpk-group-seek.adoc`, `rpk-group-offset-delete.adoc`, `rpk-group-delete.adoc` |
| `references/describe.md` | `src/go/rpk/pkg/cli/group/describe.go` (flags `--print-summary -s`, `--print-commits -c`, `--print-lag-per-topic -t`, `--regex -r`, `--instance-ID -i`, `--format`; summary/commits/lag output modes; JSON field names); lag/offset/coordinator values come from `src/v/kafka/server/group_manager.cc` + handlers `describe_groups.h`, `offset_fetch.h`, `list_groups.h`, `find_coordinator.cc` | `modules/reference/pages/rpk/rpk-group/rpk-group-describe.adoc`, `rpk-group-list.adoc` |
| `references/seek-and-reset.md` | `src/go/rpk/pkg/cli/group/seek.go` (`--to`/`--to-group`/`--to-file` mutual exclusivity, `--topics`, `--allow-new-topics`, timestamp normalization, empty-group `UnknownMemberID`→`INVALID_OPERATION` remap, PRIOR/CURRENT-OFFSET output), `offset_delete.go` (`--topic -t`, `--from-file -f`), `group.go` (`delete`); broker enforcement: `src/v/kafka/server/handlers/{offset_commit.h,offset_delete.h,delete_groups.h,list_offsets.cc}`, `group_manager.cc` | `modules/reference/pages/rpk/rpk-group/rpk-group-seek.adoc`, `rpk-group-offset-delete.adoc`, `rpk-group-delete.adoc` |
| `references/authorization.md` | Kafka-API→ACL mapping is broker-side: `src/v/kafka/server/handlers/{list_groups.h,describe_groups.h,delete_groups.h,offset_commit.h,offset_fetch.h,offset_delete.h,find_coordinator.cc}` (GROUP/TOPIC/CLUSTER resource authorization); ACL/RBAC grant commands: `src/go/rpk/pkg/cli/security/acl/`, `src/go/rpk/pkg/cli/security/role/` (`--allow-role`, `--allow-principal Group:`, `role assign`) | `modules/reference/pages/rpk/rpk-security/` (acl/role subpages) |
| `references/shadow-link-consumer-groups.md` | `src/go/rpk/pkg/cli/shadow/types.go` (`consumer_offset_sync_options`: `interval`, `paused`, `group_filters` with `pattern_type`/`filter_type`/`name`), `shadow/describe.go`, `proto/redpanda/core/admin/v2/shadow_link.proto`, `src/v/redpanda/admin/services/shadow_link/converter.cc` (offset clamping / selective replication is broker-side) | `modules/reference/pages/rpk/rpk-shadow/` (shadow config subpages) — *unverified, see TODO* |

## Deferred to live introspection (NOT drift — do not pin or hardcode)

- `rpk group <cmd> --help` — the live flag set and descriptions for each subcommand.
- `rpk group list` / `describe` runtime values — coordinator node IDs, group STATE, MEMBER-ID/CLIENT-ID/HOST, CURRENT/LOG-START/LOG-END-OFFSET, LAG, TOTAL-LAG. All runtime cluster state.
- `rpk group describe --format help` (and `seek`/`offset-delete` `--format help`) — the JSON/YAML output schema, emitted dynamically.
- `rpk group seek` PRIOR-OFFSET / CURRENT-OFFSET result rows and any per-partition ERROR column — depend on live broker responses.
- `rpk group offset-delete` / `delete` per-row STATUS strings — raw broker/kadm error strings.

## TODO / re-verify

- **`offset-delete` STATUS error strings**: SKILL/seek-and-reset assert rpk passes the raw broker error (e.g. `GROUP_SUBSCRIBED_TO_TOPIC`) with no `KAFKA_ERROR:` prefix. Re-confirm the exact rendering against current `offset_delete.go` before relying on the specific example string.
- **`seek` non-empty-group remap**: the claim that rpk translates broker `UnknownMemberID` into `INVALID_OPERATION: seeking a non-empty group is not allowed.` should be re-verified against `seek.go` — this is an rpk-side string.
- **Timestamp normalization** (10/13/19-digit → ms; ns divided by 1e6): verify against the digit-length branching in `seek.go`.
- **Broker ACL-operation mapping** (FindCoordinator→DESCRIBE GROUP, OffsetCommit→READ GROUP+TOPIC, OffsetDelete→DELETE GROUP+READ TOPIC, etc.): each mapping lives in the corresponding `src/v/kafka/server/handlers/*.h` authorization block — line-verify individual operations there.
- **Shadow docs pages** (`modules/reference/pages/rpk/rpk-shadow/`): path listed by analogy but **not verified** in this pass. The `rpk shadow` command source and `consumer_offset_sync_options` proto/struct ARE verified. Confirm the exact shadow docs page paths before citing.
- **`group_offset_retention_sec`** is a broker cluster-config property (`src/v/config/configuration.cc`), not an rpk concept — treat the docs cluster-properties partial as citation of record.

## Usage

For each file being reviewed or updated, open the listed source paths first and confirm every claim still matches. Verify against the current stable release tag of `redpanda-data/redpanda`, and re-confirm exact command paths / flag names / config keys before writing any new fact. Remember that `list` and `delete` live inside `group.go`, and that lag/offset/authorization semantics are broker-side under `src/v/kafka/server/`, not in the rpk CLI.
