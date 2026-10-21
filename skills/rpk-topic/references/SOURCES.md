# rpk topic Skill Source Map

Maps each claim kept in `skills/rpk-topic/SKILL.md` to the source it derives from, so syncs
and human maintainers know where to re-verify it. The skill is in the thin format: it keeps
only product-specific procedure, each backed by a behavioral eval case, and defers
everything else to the docs.

The `rpk topic` command group and the broker validators live in the **private** repo
`redpanda-data/streaming-enterprise`. Read it with `gh api` or the Redpanda-Github-Read
connector; do not clone it. Verify against the current stable release tag, not `dev`.
Paths below are relative to that repo.

## Claim-to-source table

| SKILL.md claim | Source |
|---|---|
| How to work 1: `-r` on `alter-config` and `delete` anchors each expression with `^` and `$`; `rpk topic list -r` takes the same format for a preview | `src/go/rpk/pkg/cli/topic/config.go` and `delete.go` (`--regex`, `regexTopics`), `list.go` (`regexTopicDetails`), `utils.go`; anchoring in `src/go/rpk/pkg/rpkutil/regex_filter.go` (`RegexListedItems`, `CompileRegexExpressions`) |
| How to work 2: parsed `%p` needs a non-negative `-p/--partition`, and the parsed value wins | `src/go/rpk/pkg/cli/topic/produce.go` (`partition >= 0` selects `kgo.ManualPartitioner()`; help text on `%p`) |
| How to work 3: schema-context lookup through DescribeConfigs, exit on failure, `--schema-context ''` or `.` for the default context | `src/go/rpk/pkg/cli/topic/schema_context.go` (`schemaContextForTopic`, `effectiveSchemaContext`); `consume.go` (context resolver, `unable to determine schema context for topic`); `produce.go` (`resolveSchemaContext`) |
| describe-storage unsupported on Redpanda Cloud | `src/go/rpk/pkg/cli/topic/describe_storage.go` (`config.CheckExitCloudAdmin`) |

Each "How to work" step has a behavioral case in `evals/suites/rpk-topic.eval.json`
(`alter-config-regex-preview`, `produce-parsed-partition-file`,
`consume-schema-context-bypass`). If the no-skill baseline starts passing one, the step is
general knowledge and comes out.

## Deferred to the docs or live introspection (not drift)

Flags, defaults, percent-escape format tokens, offset syntax, topic property values, and
Cloud limits are deliberately not in the skill. The agent looks them up in the docs or runs
`rpk topic <subcommand> --help`. A sync must not copy them back in.

## TODO / re-verify

- `alter-config -r` and `delete -r` match against a topic list that includes internal
  topics (`regexTopics` uses `ListTopicsWithInternal`), while `list -r` hides internal topics
  and the `delete` help says it deletes only non-internal topics. For a broad expression
  such as `'.*'` the preview may then not show everything the change touches; broker-side
  `kafka_nodelete_topics` protects the default internal topics. The skill does not claim
  either way; confirm with engineering before documenting it.
