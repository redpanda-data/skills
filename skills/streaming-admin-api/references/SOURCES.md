# streaming-admin-api Skill Source Map

The skill is thin: it keeps only the "How to work" procedure below, backed by behavioral
eval cases in `evals/suites/streaming-admin-api.eval.json`, and sends the agent to the docs
for everything else. This file maps only the claims the skill still makes.

Source of truth is the Admin API server, its Swagger specs and its ConnectRPC `.proto` files
in the **public** repo `redpanda-data/redpanda`. Verify against the current stable release
tag, not `dev`. The claims below were checked at tag `v26.2.2`, the latest release tag in the
public repo on 2026-11-10. Paths are relative to that repo.

## How to work: line, source, eval case

| How to work line | Source | Eval case |
|---|---|---|
| Before restarting a broker, send the pre-restart probe to that broker, because it reports the risks of restarting the broker that answers. If it lists any partition, such as replication-factor-1 partitions that maintenance mode can't drain, tell the user and get the go-ahead first. Rerun against the thin skill on 2026-11-10 (run `2026-11-10T20-28-10Z`): baseline 0/3 (it restarted the broker every time), skill 3/3, installed 3/3. | `src/v/redpanda/admin/server.cc` (`pre_restart_probe` calls `get_current_node_restart_risks`), `src/v/redpanda/admin/api-doc/broker.json` (`restart_risks`: "Partitions affected by the current node restart"; `rf1_offline`) | `restart-broker-rf1-partitions` |
| A `FailOver` without `shadow_topic_name` fails over the whole link, and the Admin API ignores a JSON field it doesn't recognize, so a misspelled field does the same and returns 200. Failover can't be undone. If the user hasn't named the topics, ask. Safety guardrail (irreversible change): the baseline passes its case, and the line and case stay as a regression guard. Rerun against the thin skill on 2026-11-10 (run `2026-11-10T20-28-10Z`): baseline 2/2 (1 run errored), skill 3/3, installed 3/3. | `proto/redpanda/core/admin/v2/shadow_link.proto` (`FailOverRequest.shadow_topic_name`: "if not set will fail over the entire shadow link"), `bazel/pbgen/main.go` (generated `from_json` skips an unknown key with `skip_value`) | `failover-single-shadow-topic` |
| An `UpdateShadowLink` whose `update_mask` names a repeated field appends what you send to the existing entries. To remove an entry, read the link with `GetShadowLink`, then mask the parent message and send it whole, or send the full configuration with no mask; fields left out are reset. Rerun against the thin skill on 2026-11-10 (run `2026-11-10T20-28-10Z`): baseline 1/3 (the failing runs masked the filter list itself, so the filter stayed), skill 3/3, installed 3/3. | `src/v/serde/protobuf/field_mask.h` (`merge_into`: "repeated fields are appended to, not replaced"; an empty mask replaces the resource), `src/v/serde/protobuf/tests/field_mask_test.cc` (`[1]` merged with `[3]` gives `[1, 3]`), `src/v/serde/protobuf/tests/goldens/codegen_test.proto.cc` (a path that ends at a message replaces it), `src/v/redpanda/admin/services/shadow_link/converter.cc` (`create_update_cluster_link_config_cmd`) | `shadow-link-remove-topic-filter` |

## Other claims in SKILL.md

| Claim | Source | Eval case |
|---|---|---|
| `search_api_reference`, `list_api_reference_pages` and `get_api_reference_content` reach the Admin API reference, and `get_config_property` looks up one cluster property | Live `tools/list` from `https://docs.redpanda.com/mcp` (see `skills/redpanda-docs/references/SOURCES.md`) | none |
| The Admin API reference is at https://docs.redpanda.com/api/doc/admin/ (`/v1`) and https://docs.redpanda.com/api/doc/admin/v2/ (ConnectRPC), and the Admin API guide is at https://docs.redpanda.com/streaming/current/manage/use-admin-api/ | Published pages (checked 2026-11-10) | none |
| When the Docs MCP server refuses for quota and no page fetch is possible, tell the user to sign in through `/mcp` | `skills/redpanda-docs/references/SOURCES.md` (anonymous quota row) | none |
| `GET /v1/cluster_config/schema` describes every cluster property the cluster accepts | `src/v/redpanda/admin/server.cc` (`get_cluster_config_schema`, `util::generate_json_schema`) | none |

## Docs gaps (not skill claims; do not re-verify here)

The Admin API reference is generated from the redpanda source, so each gap is a fix to that
source's descriptions.

- **`force_replicas` on the controller partition needs `evil_mode=true`.** Without it the
  request is refused with 400 ("Refusing to reconfigure the controller; pass evil_mode=true
  to force a raft0 reconfiguration"). The reference page
  https://docs.redpanda.com/api/doc/admin/operation/operation-force_update_partition_replicas
  lists no query parameters and doesn't mention the controller. Source:
  `src/v/redpanda/admin/partition.cc` (`controller_ntp` gated by `evil_mode`). Fix: add the
  `evil_mode` query parameter and the controller rule to `force_update_partition_replicas` in
  `src/v/redpanda/admin/api-doc/debug.json`. Eval case `force-replicas-controller-gated`:
  docs arm 0/3, skill arm 3/3.
- **A mask that names a repeated field appends instead of replacing.** The `updateMask`
  field on
  https://docs.redpanda.com/api/doc/admin/v2/operation/operation-redpanda-core-admin-v2-shadowlinkservice-updateshadowlink
  says only "See AIP-134", and AIP-134 says the opposite. The Shadowing setup page describes
  the append only as an older-rpk behavior. Source: `src/v/serde/protobuf/field_mask.h`
  (`merge_into`). Fix: describe the merge (repeated fields append, a message path replaces
  the message, an empty mask replaces the link) in the `update_mask` comment of
  `UpdateShadowLinkRequest` in `proto/redpanda/core/admin/v2/shadow_link.proto`. Eval cases
  `update-shadow-link-mask-appends` (docs 1/3, skill 3/3) and
  `shadow-link-remove-topic-filter` (docs 0/3).

## Drifted facts in the pre-thin skill (removed with the conversion)

- The pre-thin `SKILL.md` said a plain `GET /v1/cluster_config` returns only non-default
  values. It returns every property: `include_defaults` defaults to true
  (`src/v/redpanda/admin/server.cc`). Eval case `get-cluster-config-default-output`: the
  pre-thin skill arm failed 0/3, the docs arm passed 3/3.
- The pre-thin skill led agents to say any authenticated user can read
  `GET /v1/cluster_config`. It is registered at the superuser level
  (`register_route_raw_sync<superuser>` in `src/v/redpanda/admin/server.cc`). Eval case
  `cluster-config-read-needs-superuser`: skill arm 0/3, docs arm 3/3.

## Lines removed for lack of a failing baseline

The pre-thin skill had no "How to work" procedure; it was an endpoint reference. Its facts
were sampled into fact cases on 2026-11-10, and the docs or the baseline answered all but
the two gaps above: node-local `/v1/partitions`, the node-local pre-restart probe, the local
pending list in `/v1/cluster_config/status`, the debug bundle's `rpk_path` dependency, the
unknown-field `FailOver`, `DeleteShadowLink` with active topics, role sync needing an
include filter, and the license-sanctioned `node_add` balancer mode.
