---
name: rpk-group
description: >-
  Inspect and manage Redpanda consumer groups from the CLI with the `rpk group`
  command group, and look up its flags and behavior in the Redpanda docs. Use
  when checking consumer group lag or members, resetting or seeking group
  offsets after a bad deploy, deleting groups or committed offsets, granting
  group ACLs, or checking group offsets after a Shadow Linking failover. For
  topics and records, see /redpanda:rpk-topic, and for ACLs and roles in
  general, see /redpanda:rpk-security.
---

# rpk group

`rpk group` lists and describes consumer groups, seeks their committed offsets,
and deletes groups or offsets over the Kafka API, using the active rpk profile or
`-X` flags. This skill keeps only the safety rule below. Look up everything else
in the docs (last section).

## How to work

**Check what a name pattern matches before deleting groups.** `rpk group delete`
takes literal names, does not ask for confirmation, and drops every committed
offset of the groups it deletes. When the user names groups by a pattern, list
the groups first, leave out or ask about any match that doesn't look like what
the user meant (for example an Empty group that still has lag), and say which
groups you deleted.

## Use the docs for everything else

Look up flags, output columns, seek modes, the empty-group rule, ACLs, and
Shadow Linking settings in the Redpanda docs instead of from memory:

- Follow `/redpanda:redpanda-docs`. Use `get_rpk_command` for one `rpk group`
  subcommand, `get_config_property` for a cluster property such as
  `group_offset_retention_sec`, and `ask_redpanda_question` for everything else.
- Most useful pages: the rpk group reference at
  https://docs.redpanda.com/streaming/current/reference/rpk/rpk-group/rpk-group/ (one
  page per subcommand) and the Shadowing pages for consumer offset sync after a
  failover. Swap `current` for the user's version.
- For a Redpanda Cloud cluster, pass `platform: "cloud"`.

If the Docs MCP server refuses for quota and you can't fetch the page, tell the
user to sign in through `/mcp` rather than answering from memory.

`rpk group <subcommand> --help` on the installed rpk is the live check for flags
in that version.
