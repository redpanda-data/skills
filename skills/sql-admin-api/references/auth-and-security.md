# Oxla Authentication, Access Control & Secret Encryption

This reference covers Oxla's security surfaces: password (SCRAM) authentication, OIDC/JWT bearer-token authentication, access-control modes, centralized access control, and at-rest encryption of stored connection secrets. These are the security differentiators relevant to operating Oxla; all keys below are verified against `config/Release/default_config.yml`, `src/config/config_parameter_list.h`, `src/config/startup_config.{h,cpp}`, and `src/access_control/`.

Authentication for the PostgreSQL wire port is distinct from TLS for the admin API (port 9090) — see [admin-grpc-and-runtime.md](admin-grpc-and-runtime.md) for the latter.

---

## Access Control Modes

```yaml
access_control:
  mode: default          # "default" | "on" | "off"
  initial_password: oxla  # password for the built-in 'oxla' superuser (internal param)
  cache_update_interval: 5s
```

| Mode | Behavior |
|------|----------|
| `default` | Password authentication enforced using `initial_password`. |
| `on` | Full access control enabled. |
| `off` | No authentication required (isolated dev only). |

- `access_control.mode` is a **public** parameter (`OXLA__ACCESS_CONTROL__MODE`).
- `initial_password` is **internal**, settable via `OXLA__ACCESS_CONTROL__INITIAL_PASSWORD`.
- `cache_update_interval` controls how often the access-control cache is refreshed.

Passwords are stored using **SCRAM-SHA-256** (`src/access_control/scram_sha256/`). When a role is created or altered (`CREATE ROLE` / `ALTER ROLE ... PASSWORD`), the password is run through `scram_sha256::encryptPassword` and stored with mechanism `"SCRAM-SHA-256"` (`src/access_control/access_controller.cpp`). Role/grant SQL DDL itself is covered by the `sql` skill.

---

## OIDC / JWT Bearer Authentication

Oxla supports OAuth/OpenID Connect JWT bearer-token authentication on the PostgreSQL wire port — the analog of Redpanda's OIDC/OAUTHBEARER enterprise authentication. All `oidc.*` keys are **public** parameters.

```yaml
oidc:
  enabled: false                       # OXLA__OIDC__ENABLED
  issuer_url: ""                       # OIDC issuer URL
  audience: ""                         # expected token audience
  jwks_refresh_interval: 300s          # how often to refresh the JWKS key set
  jwks_force_refresh_cooldown: 60s     # min interval between forced JWKS refreshes
  clock_skew_tolerance: 30s            # allowed clock skew when validating exp/nbf
  oidc_principal_mapping: "$.sub"      # JSONPath to extract the principal from the JWT
  disable_password_auth: false         # when true, only OIDC tokens accepted (no password)
  require_tls: true                    # require TLS for OIDC connections
  protected_users:                     # users that ALWAYS use password auth, never OIDC
    - "oxla"
```

Notes:
- When `oidc.enabled: true`, clients may present JWT bearer tokens issued by `issuer_url`; the principal is extracted via the `oidc_principal_mapping` JSONPath (default `$.sub`).
- `protected_users` is an array. Set it via env var with YAML list syntax: `OXLA__OIDC__PROTECTED_USERS=[oxla, admin]`.
- `disable_password_auth: true` forces token-only auth for all non-protected users.
- `require_tls: true` (default) refuses OIDC over plaintext connections.

---

## Centralized Access Control (CAC)

A managed/centralized access-control mode used in Oxla Cloud-style deployments where roles and privileges are governed by an external control plane keyed by organization/cluster identifiers. Configured under `feature_flags.centralized_access_control` (the source comment notes "centralized_access_control is under feature_flags for now"). All four keys are **public** parameters.

```yaml
feature_flags:
  centralized_access_control:
    enabled: false        # OXLA__FEATURE_FLAGS__CENTRALIZED_ACCESS_CONTROL__ENABLED
    organization_id: ""   # OXLA__FEATURE_FLAGS__CENTRALIZED_ACCESS_CONTROL__ORGANIZATION_ID
    datastorage_id: ""    # OXLA__FEATURE_FLAGS__CENTRALIZED_ACCESS_CONTROL__DATASTORAGE_ID
    cluster_id: ""        # OXLA__FEATURE_FLAGS__CENTRALIZED_ACCESS_CONTROL__CLUSTER_ID
```

These map directly to `config.access_control.cac.{organization_id, cluster_id, datastorage_id}` at startup (`src/config/startup_config.cpp`). Related: `feature_flags.force_catalog_ac_consistency` (default `true`) enforces catalog/access-control consistency.

---

## Secret Encryption at Rest (`OXLA_ENCRYPTION_KEY`)

Credentials embedded in connection objects (`CREATE STORAGE`, `CREATE ICEBERG CATALOG`, `CREATE REDPANDA CATALOG` — see [lakehouse-and-streaming.md](lakehouse-and-streaming.md)) and other sensitive values are **encrypted at rest with AES-256-GCM** (`src/access_control/aes256_gcm/`). The encryption key is supplied via the environment variable:

```bash
OXLA_ENCRYPTION_KEY=<hex string, up to 64 hex characters>
```

Verified behavior (`src/access_control/aes256_gcm/crypt.cpp`):
- The variable holds **hex characters**, maximum length **64 hex chars** (= a 32-byte / 256-bit key).
- Empty value → error `"OXLA_ENCRYPTION_KEY must not be empty"`. Unset → `"OXLA_ENCRYPTION_KEY environment variable not set"`.
- Values **shorter than 64 hex chars are expanded** by cycling the supplied characters to fill 64 hex chars, then parsed to a 32-byte key. Non-hex characters → `"OXLA_ENCRYPTION_KEY contains invalid hex characters"`.
- Cipher: `EVP_aes_256_gcm()` (OpenSSL), with a per-record IV and authentication tag.

**Operational guidance:**
- Use the **full 64 hex characters** for maximum entropy (e.g. `openssl rand -hex 32`). Short keys are accepted but cycled, reducing effective entropy.
- The key must be **identical and stable across all nodes and restarts** — it decrypts previously stored secrets. Losing or changing it makes existing encrypted connection secrets unreadable.
- Sensitive option values are additionally **redacted from query logs and error messages** at parse time (`k_kafka_sensitive_keys`, `k_iceberg_sensitive_keys`, `k_storage_sensitive_keys` in `src/sqlparser/sql/connection_option_names.h`).

Example (matches the deployment references):

```bash
OXLA_ENCRYPTION_KEY=$(openssl rand -hex 32)   # full 64 hex chars, recommended
```

---

## TLS for client connections

PostgreSQL-wire TLS is configured in the `ssl` block (all keys **public**). See the SSL section in [configuration.md](configuration.md). Summary:

```yaml
ssl:
  mode: "off"            # "off" | "optional" | "require"
  ca_crt_file: ""        # set to require client certs (mTLS) — only valid with mode: require
  cert_file: ""
  key_file: ""
  min_protocol_version: 1.2   # 1.2 or 1.3
  max_protocol_version: 1.3
```

When `oidc.require_tls: true`, OIDC authentication requires one of `optional`/`require` SSL modes so tokens are not sent in plaintext.

---

## Security configuration quick reference

| Config key | Env var | Default | Public? |
|-----------|---------|---------|---------|
| `access_control.mode` | `OXLA__ACCESS_CONTROL__MODE` | `default` | Public |
| `access_control.initial_password` | `OXLA__ACCESS_CONTROL__INITIAL_PASSWORD` | `oxla` | Internal |
| `access_control.cache_update_interval` | `OXLA__ACCESS_CONTROL__CACHE_UPDATE_INTERVAL` | `5s` | Internal |
| `oidc.enabled` | `OXLA__OIDC__ENABLED` | `false` | Public |
| `oidc.issuer_url` | `OXLA__OIDC__ISSUER_URL` | `""` | Public |
| `oidc.audience` | `OXLA__OIDC__AUDIENCE` | `""` | Public |
| `oidc.oidc_principal_mapping` | `OXLA__OIDC__OIDC_PRINCIPAL_MAPPING` | `$.sub` | Public |
| `oidc.disable_password_auth` | `OXLA__OIDC__DISABLE_PASSWORD_AUTH` | `false` | Public |
| `oidc.require_tls` | `OXLA__OIDC__REQUIRE_TLS` | `true` | Public |
| `oidc.protected_users` | `OXLA__OIDC__PROTECTED_USERS` | `[oxla]` | Public |
| `feature_flags.centralized_access_control.enabled` | `OXLA__FEATURE_FLAGS__CENTRALIZED_ACCESS_CONTROL__ENABLED` | `false` | Public |
| `feature_flags.centralized_access_control.organization_id` | `…__ORGANIZATION_ID` | `""` | Public |
| `feature_flags.centralized_access_control.datastorage_id` | `…__DATASTORAGE_ID` | `""` | Public |
| `feature_flags.centralized_access_control.cluster_id` | `…__CLUSTER_ID` | `""` | Public |
| (secret encryption) | `OXLA_ENCRYPTION_KEY` | (none) | env-only |
