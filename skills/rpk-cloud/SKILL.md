---
name: rpk-cloud
description: >-
  Authenticate and manage Redpanda Cloud from the CLI with the `rpk cloud`
  command group, and look up its commands and flags in the Redpanda docs. Use
  when logging in to Redpanda Cloud with SSO or client credentials, switching
  or deleting cloud authentications, running `rpk cloud cluster select` to
  point an rpk profile at a Cloud cluster, managing resource groups, installing
  the BYOC plugin, or setting up the `rpk cloud mcp` server for Claude Desktop
  or Claude Code. For BYOC provisioning and teardown, see /redpanda:cloud-byoc.
  For topics, cluster storage, and security on a selected Cloud cluster, see
  /redpanda:rpk-topic, /redpanda:rpk-cluster, and /redpanda:rpk-security.
---

# rpk cloud

`rpk cloud` logs rpk in to Redpanda Cloud, manages the cloud authentications in
`rpk.yaml`, points an rpk profile at a Cloud cluster, installs the BYOC plugin,
and runs the Redpanda Cloud MCP server for AI clients. After `rpk cloud cluster
select`, the other rpk command groups talk to that Cloud cluster.

## How to work

This skill keeps no product-specific procedure. Its evals found nothing about
`rpk cloud` that an agent gets wrong without it, so look everything up in the
docs (next section).

## Use the docs for everything else

Look up commands, flags, login and credential behavior, profile handling, and
procedures in the Redpanda docs instead of from memory:

- Follow `/redpanda:redpanda-docs`. Use `get_rpk_command` for one `rpk cloud`
  command, `list_rpk_commands` to find a command's name, and
  `ask_redpanda_question` with `platform: "cloud"` for everything else.
- Most useful pages: the rpk cloud reference at
  https://docs.redpanda.com/cloud-data-platform/reference/rpk/rpk-cloud/rpk-cloud/
  (one page per subcommand) and the rpk profile create reference at
  https://docs.redpanda.com/cloud-data-platform/reference/rpk/rpk-profile/rpk-profile-create/.

If the Docs MCP server refuses for quota and you can't fetch the page, tell the
user to sign in through `/mcp` rather than answering from memory.

`rpk cloud <subcommand> --help` on the installed rpk is the live check for
flags in that version. The BYOC `apply`, `destroy`, and `validate` subcommands
come from the downloaded plugin, so check them with
`rpk cloud byoc <aws|gcp|azure> --help` after `rpk cloud byoc install`.
