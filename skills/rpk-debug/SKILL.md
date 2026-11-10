---
name: rpk-debug
description: >-
  Collect Redpanda diagnostics bundles with the `rpk debug` command group, and
  look up bundle flags, contents, and procedures in the Redpanda docs. Use when
  collecting a debug bundle for Redpanda Support or self-triage, running
  `rpk debug bundle` on a broker host or inside a Kubernetes pod, collecting a
  cluster-wide bundle through the Admin API with `rpk debug remote-bundle`, or
  reading a bundle to triage a problem such as an Enterprise feature that stopped
  working. Applies to self-managed deployments only. For client-side triage of a
  Redpanda Cloud cluster, see /redpanda:rpk-cluster and /redpanda:rpk-topic.
---

# rpk debug

`rpk debug bundle` collects a diagnostics bundle from the broker it runs on, and
`rpk debug remote-bundle` asks brokers to collect their own bundles through the
Admin API. This skill keeps only the product-specific procedure below. Look up
everything else in the docs (last section).

`rpk debug` works only on self-managed clusters. Redpanda Cloud clusters don't
support debug bundles: there is no broker host to run `bundle` on, and
`remote-bundle` needs the Admin API. For a Cloud cluster, Redpanda Support
collects cluster-side diagnostics, so the user should say so on the ticket.

## How to work

**Make a remote bundle cover every broker.** `rpk debug remote-bundle` asks only
the brokers in the profile's Admin API addresses (or `-X admin.hosts`), not every
broker in the cluster. Before `start`, compare that list with the cluster's
brokers (`rpk cluster info`). If any are missing, pass all of their Admin API
addresses with `-X admin.hosts` on `start`, `status`, and `download`.

## Use the docs for everything else

Look up flags, defaults, the bundle's file layout, and procedures in the Redpanda
docs instead of from memory:

- Follow `/redpanda:redpanda-docs`. Use `get_rpk_command` for one `rpk debug`
  subcommand's flags and `ask_redpanda_question` for everything else.
- Most useful pages: the debug bundle guides at
  https://docs.redpanda.com/streaming/current/troubleshoot/debug-bundle/ (generate,
  configure, and inspect, for Linux and Kubernetes) and the rpk debug reference at
  https://docs.redpanda.com/streaming/current/reference/rpk/rpk-debug/rpk-debug/.
  Swap `current` for the user's version.
- To triage an Enterprise feature from a bundle, look up the feature's config
  properties with `get_config_property` and the license behavior in the docs.

If the Docs MCP server refuses for quota and you can't fetch the page, tell the
user to sign in through `/mcp` rather than answering from memory.

`rpk debug bundle --help` and `rpk debug remote-bundle <subcommand> --help` on
the installed rpk are the live check for flags in that version.
