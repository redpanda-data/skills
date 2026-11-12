---
name: rpk-security
description: >-
  Manage Redpanda authentication and authorization from the CLI with the `rpk
  security` command group, and look up security settings in the Redpanda docs.
  Use when the user wants to create, rotate, or delete SASL/SCRAM users, grant
  or revoke ACLs and RBAC roles, change Redpanda Cloud secrets, turn on SASL or
  OIDC or Kerberos or mTLS authentication, or set up Enterprise security
  features like audit logging, group-based access control, and FIPS mode. For Schema Registry ACL patterns, see /redpanda:rpk-registry, and for
  the Enterprise license itself, see /redpanda:rpk-cluster.
---

# rpk security

`rpk security` manages SASL users, ACLs, RBAC roles, and Redpanda Cloud
secrets, using the active rpk profile or `-X` flags. This skill keeps only the
product-specific procedure below. Look up everything else in the docs (last
section).

## How to work

**Ask which SCRAM mechanism a user's clients use before you change its
password.** `rpk security user update` sets the mechanism along with the
password, and rpk has no command that shows a user's current mechanism. If you
pick the wrong one, the clients fail to authenticate even with the new
password. Don't assume the `create` default.

**Never update a Cloud secret with a value you made up.** `rpk security secret
update` overwrites both the stored value and the scope list, and rpk can't read
a secret's value back. To change only the scopes, get the value from the user,
or give them the command to run with their own value, and list every scope the
secret should keep.

## Use the docs for everything else

Look up commands, flags, principal formats, ACL operations, security
properties, and procedures in the Redpanda docs instead of from memory:

- Follow `/redpanda:redpanda-docs`. Use `get_rpk_command` for one `rpk
  security` command, `get_config_property` for one security property such as
  `enable_sasl` or `superusers`, and `ask_redpanda_question` for everything
  else.
- Most useful pages: the rpk security reference at
  https://docs.redpanda.com/streaming/current/reference/rpk/rpk-security/rpk-security/
  (one page per subcommand), and the authentication and authorization pages
  under https://docs.redpanda.com/streaming/current/manage/security/. Swap
  `current` for the user's version.
- For a Redpanda Cloud cluster, pass `platform: "cloud"`.

If the Docs MCP server refuses for quota and you can't fetch the page, tell the
user to sign in through `/mcp` rather than answering from memory.

`rpk security <subcommand> --help` on the installed rpk is the live check for
flags in that version.
