---
name: rpk-registry
description: >-
  Manage the Redpanda Schema Registry from the CLI with the `rpk registry`
  command group (alias `rpk sr`), and look up Schema Registry behavior in the
  Redpanda docs. Use when registering, fetching, or deleting Avro, Protobuf, or
  JSON schemas and subjects, checking or setting compatibility levels, changing
  the registry mode for a migration, or working with schema contexts, Schema
  Registry Authorization, or server-side Schema ID Validation. For granting
  Kafka ACLs or roles, see /redpanda:rpk-security, and for producing or
  consuming records with schema encoding, see /redpanda:rpk-topic.
---

# rpk registry

`rpk registry` (alias `rpk sr`) manages subjects, schemas, compatibility
levels, modes, and contexts in the Schema Registry built into every Redpanda
broker, using the active rpk profile or `-X registry.hosts`. This skill keeps
only the product-specific procedure below. Look up everything else in the docs
(last section).

## How to work

**Ask before removing a schema context that still holds subjects.** A context
can be deleted only after every subject in it is hard-deleted, so removing it
means permanently deleting those schemas. List what is in it first
(`rpk registry --schema-context <context> subject list --deleted`), tell the
user which subjects would go, and get the go-ahead before any `--permanent`
delete. Don't hard-delete them on your own to get `context delete` to succeed.

**Don't hard-delete a subject or version to get past a compatibility error.**
A permanent delete removes the schema by ID once no other subject version uses
it, so records already written with that ID can no longer be decoded. For an
intentional breaking change, relax the compatibility level of that one subject
(and restore it after), never the global level, and ask before any
`--permanent` delete.

## Use the docs for everything else

Look up flags, compatibility levels, modes, contexts, delete behavior,
authorization ACLs, and Schema ID Validation settings in the Redpanda docs
instead of from memory:

- Follow `/redpanda:redpanda-docs`. Use `get_rpk_command` for one
  `rpk registry` subcommand, `get_config_property` for a Schema Registry
  cluster or topic property, and `ask_redpanda_question` for everything else.
- Most useful pages: the rpk registry reference at
  https://docs.redpanda.com/streaming/current/reference/rpk/rpk-registry/rpk-registry/
  (one page per subcommand) and the Schema Registry overview at
  https://docs.redpanda.com/streaming/current/manage/schema-reg/schema-reg-overview/,
  which links the API, contexts, authorization, and Schema ID Validation pages.
  Swap `current` for the user's version.
- For a Redpanda Cloud cluster, pass `platform: "cloud"`.

If the Docs MCP server refuses for quota and you can't fetch the page, tell the
user to sign in through `/mcp` rather than answering from memory.

`rpk registry <subcommand> --help` on the installed rpk is the live check for
flags in that version.
