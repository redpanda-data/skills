---
name: rpk-transform
description: >-
  Build, deploy, and operate Redpanda Data Transforms, WebAssembly functions that
  run inside the broker and write records from an input topic to output topics,
  with the `rpk transform` command group, and look up transform details in the
  Redpanda docs. Use when writing a transform in Go (TinyGo), Rust, JavaScript, or
  TypeScript, deploying or redeploying one, reprocessing records, pausing or
  deleting a transform, reading its logs, or enabling data transforms on a cluster.
  Transforms run on self-managed, BYOC, and Dedicated clusters, not Serverless.
  For multi-record joins or aggregations, use Redpanda Connect instead, and for
  cluster properties in general, see /redpanda:rpk-cluster.
---

# rpk transform

`rpk transform` scaffolds, builds, deploys, and manages data transforms on the
cluster in the active rpk profile. This skill keeps only the product-specific
procedure below. Look up everything else in the docs (last section).

## How to work

**Before redeploying a transform, carry over its deploy settings.** A redeploy
takes environment variables and compression only from `transform.yaml` and that
deploy's flags. Anything an earlier deploy set with `--var` or `--compression` is
dropped, and rpk reports no error. Read the running values with `rpk transform
list --format json`, and pass them again or add them to `transform.yaml`.

## Use the docs for everything else

Look up flags, `transform.yaml` fields, SDK APIs, limits, cluster properties,
metrics, and procedures in the Redpanda docs instead of from memory:

- Follow `/redpanda:redpanda-docs`. Use `get_rpk_command` for an `rpk transform`
  subcommand, `get_config_property` for a `data_transforms_*` cluster property,
  and `ask_redpanda_question` for everything else.
- Most useful pages: the Data Transforms section at
  https://docs.redpanda.com/streaming/current/develop/data-transforms/ (how
  transforms work and their limits, build, configure, deploy, monitor) and the
  rpk transform reference at
  https://docs.redpanda.com/streaming/current/reference/rpk/rpk-transform/rpk-transform/
  (one page per subcommand). Swap `current` for the user's version.
- For a Redpanda Cloud cluster, pass `platform: "cloud"`. The Cloud page at
  https://docs.redpanda.com/cloud-data-platform/develop/data-transforms/how-transforms-work/
  says which cluster types support transforms.

If the Docs MCP server refuses for quota and you can't fetch the page, tell the
user to sign in through `/mcp` rather than answering from memory.

`rpk transform <subcommand> --help` on the installed rpk is the live check for
flags in that version.
