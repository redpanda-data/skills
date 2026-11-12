---
name: rpk
description: >-
  Install and configure rpk, the Redpanda CLI, and look up its setup in the
  Redpanda docs. Use when installing or upgrading rpk, when creating or
  switching rpk profiles and setting connection details with -X options or RPK_
  environment variables to reach a self-managed or Redpanda Cloud cluster, or
  when checking an Enterprise license and leaving license violation. This is the
  hub skill for rpk. For a specific command group such as topics or clusters,
  see the matching /redpanda:rpk-* skill.
---

# rpk

`rpk` is the single CLI for Redpanda. Every command shares one connection
model: profiles in `rpk.yaml`, overridden by `RPK_*` environment variables and
`-X` options. This skill keeps only the product-specific procedure below. Look
up everything else in the docs (last section).

## How to work

**Install rpk from `rpk.redpanda.com`, not from GitHub.** Download from
`https://rpk.redpanda.com/<release>/`, where `<release>` is `latest` or
`v<version>`, or use Homebrew or Redpanda's package repository. GitHub release
assets no longer get new rpk versions, so a `releases/latest/download` URL
still works but installs an older rpk, with no error.

**Ask before turning off an Enterprise feature to leave license violation.**
`rpk cluster license info` lists the features in use. Turning one off can cost
the user data or access: with Tiered Storage off, topics can't read the data
held only in object storage. Say what each change would lose, then ask. Don't
turn features off on your own to clear the violation.

## Use the docs for everything else

Look up install steps, profile commands, `-X` options, environment variables,
defaults, and license procedures in the Redpanda docs instead of from memory:

- Follow `/redpanda:redpanda-docs`. Use `get_rpk_command` for one rpk command
  and `list_rpk_commands` to find one, `get_config_property` for a cluster
  property, and `ask_redpanda_question` for everything else.
- Most useful pages: install at
  https://docs.redpanda.com/streaming/current/get-started/rpk-install/, profiles at
  https://docs.redpanda.com/streaming/current/get-started/config-rpk-profile/,
  `-X` options at
  https://docs.redpanda.com/streaming/current/reference/rpk/rpk-x-options/, and
  leaving license violation at
  https://docs.redpanda.com/streaming/current/get-started/licensing/disable-enterprise-features/.
  Swap `current` for the user's version.
- For a Redpanda Cloud cluster, pass `platform: "cloud"`.

If the Docs MCP server refuses for quota and you can't fetch the page, tell the
user to sign in through `/mcp` rather than answering from memory.

`rpk <command> --help` and `rpk -X help` on the installed rpk are the live
check for commands, flags, and `-X` options in that version.
