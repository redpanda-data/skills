# Self-Managed Enterprise Features Relevant to the AI Surface

Redpanda Cloud (where the AI Gateway, AI Agents, MCP servers, and Knowledge Bases live) is a managed deployment of **Redpanda Enterprise Edition** — no separate license key to manage. For **self-managed** Redpanda the same governance/security primitives the AI surface relies on are gated behind a valid **Enterprise license**. This file lists the cluster/node config keys so an agent can enable/disable or verify them.

Source: `docs/modules/get-started/pages/licensing/overview.adoc`, `docs/modules/get-started/pages/licensing/disable-enterprise-features.adoc`.

> Verify license status: `rpk cluster license info` (reports `license violation: true` if an Enterprise feature is enabled without a valid license). Enterprise features in Redpanda Connect and Console are not reported by this command.

## Enterprise features that map to AI-surface governance

| Feature | License? | Enable / disable key | Notes |
|---------|----------|----------------------|-------|
| Audit Logging | Enterprise | `rpk cluster config set audit_enabled true\|false` | The AI Gateway `AuditService` is the Cloud analogue. On expiry, read access to the audit log topic is denied but logging continues. |
| Role-Based Access Control (RBAC) | Enterprise | manage via `rpk security role ...` (disable = delete all roles) | Maps to AI Gateway `RoleService`/`AccessControlService`. On expiry, roles/ACLs cannot be created or modified; deletion allowed. |
| Group-Based Access Control (GBAC) | Enterprise | OIDC group `Group:` principals in ACLs | On expiry, `Group:` ACLs cannot be created; existing ones still evaluate. |
| OAUTHBEARER / OIDC authentication | Enterprise | `rpk cluster config set sasl_mechanisms <...>` and `http_authentication <...>` (remove `OIDC` to disable) | Maps to AI Gateway `SSOService` / OIDC config. No change on expiry. |
| Kerberos (GSSAPI) authentication | Enterprise | `sasl_mechanisms` (remove `GSSAPI` to disable) | No change on expiry. |
| FIPS Compliance | Enterprise | `rpk node config set fips_mode disabled` | The `rpk ai` (`rpai`) plugin has **no FIPS build** and refuses to download on FIPS-enabled `rpk`. No change on expiry. |
| Server-Side Schema ID Validation | Enterprise | `rpk cluster config set enable_schema_id_validation false` | On expiry, topics with schema validation cannot be created or modified. |
| Schema Registry Authorization | Enterprise | `schema_registry_enable_authorization` | On expiry, cannot enable or create/modify schema ACLs. |

## Other Enterprise features (cluster/storage domain — not core to the AI surface)

Listed for completeness; these are covered in the cluster-management skills, not driven by the AI CLI/MCP:

- Tiered Storage (`cloud_storage_enabled`), Topic Recovery (`redpanda.remote.recovery`), Remote Read Replicas (`cloud_storage_enable_remote_read`), Whole Cluster Restore.
- Cloud Topics (`redpanda.cloud_topic.enabled`), Iceberg Topics (`redpanda.iceberg.mode`).
- Continuous Data Balancing (`partition_autobalancing_mode=continuous`, disable with `node_add`), Continuous Intra-Broker Partition Balancing (`core_balancing_continuous`).
- Leader Pinning (`default_leaders_preference`, disable with `none`).
- Shadowing / Shadow Linking cross-cluster DR (`rpk shadow`).
- Topic Deletion Control (`delete_topic_enable`).

To remove a license violation, either add a valid license (`rpk cluster license set`) or disable the offending feature with the key above, then re-check `rpk cluster license info`.
