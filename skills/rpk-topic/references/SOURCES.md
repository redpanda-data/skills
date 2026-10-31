# rpk topic Skill Source Map

The skill is thin: it keeps only the "How to work" procedure below, backed by a behavioral
eval case in `evals/suites/rpk-topic.eval.json`, and sends the agent to the docs for
everything else. This file maps only the claims the skill still makes.

The `rpk topic` command group lives in the **private** repo
`redpanda-data/streaming-enterprise`. Read it with `gh api` or the Redpanda-Github-Read
connector; do not clone it. Verify against the current stable release tag, not `dev`.
Paths below are relative to that repo.

## How to work: line, source, eval case

| How to work line | Source | Eval case |
|---|---|---|
| A parsed `%p` needs a non-negative `-p/--partition` as well, and the parsed value wins; without `-p` the default partitioner places records and rpk reports no error | `src/go/rpk/pkg/cli/topic/produce.go` (`partition >= 0` selects `kgo.ManualPartitioner()`; help text on `%p`) | `produce-parsed-partition-file` |

## Other claims in SKILL.md

| Claim | Source | Eval case |
|---|---|---|
| `get_config_property` looks up one topic property and `list_config_properties` finds a property's name | Live `tools/list` from `https://docs.redpanda.com/mcp` (checked 2026-10-30; see `skills/redpanda-docs/references/SOURCES.md`) | none |
| For a Cloud cluster, pass `platform: "cloud"`; the Cloud topic properties page says which properties can be set and where Serverless limits differ | https://docs.redpanda.com/cloud-data-platform/reference/properties/topic-properties/ (checked 2026-10-31) | none |
| When the Docs MCP server refuses for quota and no page fetch is possible, tell the user to sign in through `/mcp` rather than answering from memory | `skills/redpanda-docs/references/SOURCES.md` (anonymous quota row) | none |
| `describe-storage` needs the Admin API, so it does not work on Redpanda Cloud | `src/go/rpk/pkg/cli/topic/describe_storage.go` (`config.CheckExitCloudAdmin`) | none |

## Lines removed for lack of a failing baseline

- "First get the cluster's version from `rpk version` (the Redpanda Cluster lines, not the rpk
  version) before looking up topic behavior" was removed on 2026-10-30. Its behavioral case (a
  request for the topic properties reference that applies to a cluster whose brokers run an
  older release than both the rpk client and the latest docs) passed 3/3 in the baseline:
  without the skill, the agent ran `rpk version` and linked the brokers' release. Finding the
  version is covered by `/redpanda:redpanda-docs`, so the case was not kept.
- Two guardrails restored from the pre-thin skill on 2026-10-31 were removed again the same day,
  because the baseline passed their behavioral cases 3/3:
  - "Preview a regex with `rpk topic list -r` before `delete -r` or `alter-config -r`". Case: delete
    every topic matching `^test.*`, where the expression also matches a non-test topic. Without the
    skill, the agent listed the topics first and deleted only the three test topics by name.
  - "Get the user's go-ahead before `trim-prefix`, lowering retention, `delete`, or
    `add-partitions`". Case: free disk space on brokers filled by one topic, with the destructive
    commands mocked. Without the skill, the agent inspected the topic and cluster, deleted nothing,
    and asked which option to take.
  Neither case was kept. (Correction to the pre-thin skill: `rpk topic delete` does not prompt;
  only `trim-prefix` does, per `delete.go` and `trim.go`.)
- "Before advising a specific `alter-config --set` key on Serverless, verify it against a live
  cluster or the Cloud UI" was not restored as a line on 2026-10-31. A screening query (raise a
  Serverless topic's maximum message size to 30 MiB and confirm the producers are good to go)
  passed 3/3 in the baseline: without the skill, the agent warned that Serverless caps the value
  lower than BYOC and Dedicated and told the user to check before relying on it. The skill keeps
  only the docs pointer for Cloud topic properties.
