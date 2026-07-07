# rpk-security Skill Source Map

Maps each file in `skills/rpk-security/` to the source paths it derives from, so future
syncs and human maintainers know exactly where to verify claims.

The `rpk security` command group is Go source in the **public** repo
`redpanda-data/redpanda` under `src/go/rpk/pkg/cli/security/` (subcommands `user`, `acl`,
`role`, `secret`); the deprecated `rpk acl` alias lives at `src/go/rpk/pkg/cli/acl/`.
Broker-side authentication/authorization (SASL, ACLs, OIDC, Kerberos, mTLS, roles, audit,
license) is under `src/v/security/` and `src/v/kafka/server/handlers/`; cluster config keys
are defined in `src/v/config/configuration.cc` (rpk only passes them through). The
user-facing reference is auto-generated in the **public** repo `redpanda-data/docs`. All
are public — read them via the Redpanda-Github-Read MCP connector (`search_code`,
`get_file_contents`), or `gh api .../contents/<path>` for verification; do not guess.
Before writing or changing any fact, re-open the cited source and confirm exact command
paths, flag names, and config keys. `rpk` is versioned: verify against the **current stable
release tag**, not `dev`/`main`.

## File-to-source table

| Skill file | redpanda source paths | docs sources |
|---|---|---|
| `SKILL.md` | `src/go/rpk/pkg/cli/security/security.go`, and the subcommand dirs `security/user/`, `security/acl/`, `security/role/`, `security/secret/` (all under `src/go/rpk/pkg/cli/`); `src/go/rpk/pkg/cli/acl/acl.go` (deprecated alias); `src/go/rpk/pkg/cli/cluster/license/` (`info.go`, `set.go`, `license.go`); `src/go/rpk/pkg/cli/generate/license.go`; broker gates in `src/v/config/configuration.cc`; broker auth in `src/v/security/` | `modules/reference/pages/rpk/rpk-security/` (index `rpk-security.adoc`), `modules/manage/pages/security/` (`authentication.adoc`, `authorization/`, `fips-compliance.adoc`), `modules/manage/pages/security/audit-logging.adoc` |
| `references/users.md` | `src/go/rpk/pkg/cli/security/user/` (`user.go`, `create.go`, `list.go`, `delete.go`, `update.go`); broker SCRAM: `src/v/security/scram_authenticator.cc`, `scram_algorithm.cc`, `scram_credential.h`; Kafka SCRAM handlers `src/v/kafka/server/handlers/{alter,describe}_user_scram_credentials.{cc,h}`; `enable_sasl`/`kafka_enable_authorization`/`superusers` in `src/v/config/configuration.cc` | `modules/reference/pages/rpk/rpk-security/rpk-security-user*.adoc` (`-create`, `-list`, `-delete`, `-update`, `rpk-security-user.adoc`), `modules/manage/pages/security/authentication.adoc` |
| `references/acls.md` | `src/go/rpk/pkg/cli/security/acl/` (`acl.go`, `common.go`, `create.go`, `list.go`, `delete.go`); `src/go/rpk/pkg/cli/acl/acl.go` (deprecated flags/alias); broker ACL model: `src/v/security/acl.{cc,h}`, `acl_entry_set.h`, `acl_store.h`, `authorizer.{cc,h}`; Kafka ACL handlers `src/v/kafka/server/handlers/{create,delete,describe}_acls.{cc,h}` | `modules/reference/pages/rpk/rpk-security/rpk-security-acl*.adoc` (`-create`, `-list`, `-delete`, `rpk-security-acl.adoc`), `modules/manage/pages/security/authorization/acl.adoc` |
| `references/roles.md` | `src/go/rpk/pkg/cli/security/role/` (`role.go`, `create.go`, `list.go`, `describe.go`, `delete.go`, `assign.go`, `unassign.go`); broker RBAC: `src/v/security/role.{cc,h}`, `role_store.h`, handler `src/v/kafka/server/handlers/describe_redpanda_roles.{cc,h}`; secrets: `src/go/rpk/pkg/cli/security/secret/` (`secret.go`, `create.go`, `list.go`, `update.go`, `delete.go`) — Cloud Dataplane API, no broker source | `modules/reference/pages/rpk/rpk-security/rpk-security-role*.adoc` (`-create`, `-list`, `-describe`, `-delete`, `-assign`, `-unassign`, `rpk-security-role.adoc`), `modules/manage/pages/security/authorization/rbac.adoc`, `gbac.adoc`. **No generated `rpk security secret` docs page** (cloud-only) |
| `references/authentication.md` | broker authenticators in `src/v/security/`: `scram_authenticator.cc`, `plain_authenticator.cc`, `oidc_authenticator.cc`, `oidc_service.cc`, `oidc_principal_mapping_applicator.cc`, `jwt.cc`, `gssapi_authenticator.cc`, `gssapi_principal_mapper.cc`, `gssapi_rule.cc`, `krb5.cc`, `mtls.cc`, `mtls_rule.cc`, `request_auth.cc`; Kafka SASL handlers `src/v/kafka/server/handlers/sasl_handshake.h`, `sasl_authenticate.h`; `sasl_mechanisms`/`oidc_*`/`sasl_kerberos_*`/`kafka_mtls_principal_mapping_rules`/`http_authentication`/`enable_sasl`/`admin_api_require_auth` keys in `src/v/config/configuration.cc`; rpk-side `-X sasl.*` in `src/go/rpk/pkg/config/params.go` | `modules/manage/pages/security/authentication.adoc`, `modules/manage/pages/security/authorization/gbac.adoc` |
| `references/enterprise-security.md` | license CLI `src/go/rpk/pkg/cli/cluster/license/` + `src/go/rpk/pkg/cli/generate/license.go`; broker license `src/v/security/license.{cc,h}`, audit `src/v/security/audit/`; enterprise gates (`audit_*`, `enable_schema_id_validation`, `schema_registry_enable_authorization`, `oidc_group_claim_path`, `nested_group_behavior`, `fips_mode`, `openssl_*`) in `src/v/config/configuration.cc`; topic config via `src/go/rpk/pkg/cli/topic/` (`create.go`, `config.go`) | `modules/manage/pages/security/audit-logging.adoc`, `modules/manage/pages/schema-reg/schema-id-validation.adoc`, `modules/manage/pages/security/fips-compliance.adoc`, `modules/manage/pages/security/authorization/gbac.adoc`, `rbac.adoc`, `modules/reference/pages/rpk/rpk-cluster/rpk-cluster-license*.adoc`, `modules/reference/pages/rpk/rpk-generate/rpk-generate-license.adoc`, `modules/reference/partials/properties/cluster-properties.adoc`, `topic-properties.adoc` |

## Deferred to live introspection (NOT drift — do not pin or hardcode)

- `rpk security <cmd> --help` and `rpk security acl --help-operations` — the live flag set and the full operation→Kafka-request mapping table; the skill reproduces only a subset.
- Auto-generated SASL user password (30 chars) from `rpk security user create` — runtime-generated, printed once.
- `rpk generate license --apply` trial license / generated license string — runtime state.
- `rpk cluster license info` output (Organization, Type, Expires, `license violation`) — runtime cluster state.
- `rpk security secret` behavior — Cloud Dataplane API passthrough; no broker source and no generated docs page. Confirm against a live cloud cluster / the Dataplane API, not `redpanda-data/redpanda`.

## TODO / re-verify

- **Enterprise cluster-config keys and their defaults** (`audit_*`, `oidc_*`, `sasl_kerberos_*`, `enable_schema_id_validation`, `schema_registry_enable_authorization`, `nested_group_behavior`, `http_authentication`) are broker config, not rpk. The property defaults listed were **not each line-verified** against `src/v/config/configuration.cc` — re-check; treat the docs property partials as the citation of record.
- **`fips_mode` and `rpk node config set`**: `fips_mode`/`openssl_*` are broker (`redpanda.yaml`) properties. rpk has **no `node` command** — the correct form is `rpk redpanda config set redpanda.fips_mode` (`src/go/rpk/pkg/cli/redpanda/config.go`); `rpk node config set` is a docs/Admin-API spelling. Call sites corrected on 2026-07-07.
- **`-X sasl.mechanism=OAUTHBEARER` rpk support and version claims** (v26.1.7 / v25.3.x / v25.2.x): verify against `src/go/rpk/pkg/config/params.go` and the release tag; version pins are unverified.
- **mTLS / Kerberos principal-mapping rule grammar**: verify against `src/v/security/mtls_rule.cc`, `gssapi_rule.cc`, `gssapi_principal_mapper.cc` rather than paraphrasing.

## Usage

For each file being reviewed or updated, open the listed source paths first and confirm
every claim still matches. Verify against the current stable release tag of
`redpanda-data/redpanda`, and re-confirm exact command paths / flag names / config keys
before writing any new fact.
