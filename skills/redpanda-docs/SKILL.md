---
name: redpanda-docs
description: Look things up in the Redpanda documentation for the product, platform, and version the user actually runs, through the Redpanda Docs MCP server or the Markdown pages. Use when another Redpanda skill says to check the docs, or when answering a Redpanda question needs config fields, flags, defaults, or procedures.
---

# Using the Redpanda docs

The Redpanda docs are the source for config fields, flags, defaults, syntax, and procedures.
Answer from the docs for the user's own deployment, not from memory and not from the latest
release by default.

## 1. Find out what the user runs

Before looking anything up, establish the platform and, for self-managed Redpanda, the version.
Ask if you can't tell from the conversation or the user's environment.

| Product | How to tell |
|---|---|
| Redpanda, self-managed | `rpk version` prints the rpk version and, under "Redpanda Cluster", each broker's version (through the Admin API). `rpk redpanda admin brokers list` shows it in a VERSION column. The rpk version alone (`rpk --version`) is not the cluster's version. |
| Redpanda Cloud | `rpk version` does not report a version for Cloud profiles. Cloud has no docs versions, so you only need to know it's Cloud. |
| Redpanda Connect | `rpk connect --version` |

## 2. Ask the Docs MCP with that context

The Claude Code plugin installs the Redpanda Docs MCP server (`redpanda-docs`). In any other
agent, add it yourself as a remote (streamable HTTP) MCP server at `https://docs.redpanda.com/mcp`,
or use the Markdown pages (section 3).

Use the direct lookups first when the question names a specific property or component:

- `get_config_property` for one cluster, broker, or topic property (type, default, Cloud
  support), and `list_config_properties` to find the right property name.
- `get_connect_component` for one Redpanda Connect component and its fields, and
  `list_connect_components` to find a component.
- `search_api_reference` and `get_api_reference_content` for the Admin, HTTP Proxy, Schema
  Registry, Control Plane, and Data Plane APIs.

For everything else, use `ask_redpanda_question`:

- Set `platform` to `cloud` or `self-managed`. Without it, answers mix both.
- For self-managed Redpanda, set `version` to the user's release as the docs URLs spell it
  (major.minor, as in the cluster's version). Leave it unset, or use `current`, only for the latest release.

If the server says you've used up the anonymous limit, tell the user to run `/mcp` and sign in
with a Redpanda Cloud account, and use the Markdown pages in the meantime.

## 3. Read the Markdown pages

Every docs page has a Markdown version: replace the trailing `/` or `.html` in its URL with
`.md`, or request the URL with `Accept: text/markdown`.

- Self-managed Redpanda pages are versioned in the path: `/streaming/<version>/...`, or
  `/streaming/current/...` for the latest. Read the user's version.
- Cloud, Connect, Agentic Data Plane, and API reference pages describe only the latest
  release. For an older Connect version, a field on the page may not exist yet. Check the
  user's config with `rpk connect lint` before relying on it.
- `https://docs.redpanda.com/llms.txt` lists the exports. `llms-full.txt` covers only the
  latest version of each component, so for an older release read the versioned page instead.

## 4. Say where the answer came from

Link the page you used. If the docs and the user's system disagree, trust the system, say so,
and offer to report it with `give_feedback`. Ask the user first: it sends the report you write to
the Redpanda docs team. Reports do not include the user's name or email, so keep credentials,
tokens, and personal data out of the report.
