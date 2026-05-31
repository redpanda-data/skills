# Authentication Mechanisms: SCRAM, OIDC, Kerberos, mTLS, Basic

Redpanda supports several authentication mechanisms for the Kafka API and the HTTP APIs (Admin API, Schema Registry, HTTP Proxy). SASL/SCRAM and mTLS are available in Community Edition. **OAUTHBEARER/OIDC and GSSAPI (Kerberos) authentication are Enterprise features and require a valid Enterprise license.**

| Mechanism | API | License | How it is selected |
|-----------|-----|---------|--------------------|
| SASL/SCRAM-SHA-256, SASL/SCRAM-SHA-512 | Kafka | Community | `sasl_mechanisms` includes `SCRAM` |
| SASL/PLAIN | Kafka | Community | `sasl_mechanisms` includes `PLAIN` |
| SASL/OAUTHBEARER (OIDC) | Kafka | **Enterprise** | `sasl_mechanisms` includes `OAUTHBEARER` |
| SASL/GSSAPI (Kerberos) | Kafka | **Enterprise** | `sasl_mechanisms` includes `GSSAPI` |
| mTLS principal mapping | Kafka | Community | listener `authentication_method: mtls_identity` |
| HTTP Basic | Admin/SR/Proxy | Community | `http_authentication` includes `BASIC` |
| HTTP OIDC | Admin/SR/Proxy | **Enterprise** | `http_authentication` includes `OIDC` |

`sasl_mechanisms` is a cluster property (list). Per-listener overrides use `sasl_mechanisms_overrides`. Toggle authentication on/off with `enable_sasl` (global, legacy but not deprecated) or per-listener `authentication_method`. ACL enforcement is separate: `kafka_enable_authorization`.

```bash
rpk cluster config get sasl_mechanisms
rpk cluster config set sasl_mechanisms '["SCRAM"]'
rpk cluster config set sasl_mechanisms '["SCRAM","PLAIN"]'
rpk cluster config set enable_sasl true
rpk cluster config set kafka_enable_authorization true
```

## SASL/SCRAM (Community)

Default and most common. See [users.md](users.md) for `rpk security user` management. Two mechanisms: `SCRAM-SHA-256` (default) and `SCRAM-SHA-512`. Mechanism is stored per user and must match the client's SASL config.

```bash
rpk security user create alice --password 'MySecretPass!' --mechanism scram-sha-256
```

Note: when FIPS mode is `enabled` or `permissive`, SCRAM passwords must be at least 14 characters.

## SASL/PLAIN (Community)

Add `PLAIN` to `sasl_mechanisms`. PLAIN users are the same SCRAM credential store; PLAIN simply sends the password in cleartext over the (TLS-protected) connection.

```bash
rpk cluster config set sasl_mechanisms '["SCRAM","PLAIN"]'
```

## SASL/OAUTHBEARER (OIDC) — Enterprise

OIDC authentication requires an Enterprise license. With OIDC, Redpanda does not manage user credentials; clients present an access token (JWT) issued by your identity provider (IdP). Redpanda's OIDC follows the OAuth 2.0 client-credentials flow (RFC 6749 §4.4). OIDC provides SASL/OAUTHBEARER for the Kafka API and standard OIDC auth across the HTTP APIs (Admin API, Schema Registry, HTTP Proxy).

### Cluster properties for OIDC

| Property | Description | Default |
|----------|-------------|---------|
| `sasl_mechanisms` | Must include `OAUTHBEARER` | — |
| `oidc_discovery_url` | IdP discovery URL (`.well-known/openid-configuration`) | `https://auth.prd.cloud.redpanda.com/.well-known/openid-configuration` |
| `oidc_token_audience` | Required `aud` claim value | `redpanda` |
| `oidc_principal_mapping` | JSON path extracting the principal from token claims | `$.sub` |
| `oidc_clock_skew_tolerance` | Seconds of clock skew allowed when validating `exp` | — |
| `oidc_token_expire_disconnect` | Disconnect clients when their token expires | — |
| `oidc_keys_refresh_interval` | How long keys from `jwks_uri` are cached (seconds) | — |

```bash
rpk cluster config set sasl_mechanisms '["SCRAM","OAUTHBEARER"]' -X admin.hosts=localhost:9644
rpk cluster config set oidc_discovery_url 'https://auth.prd.cloud.redpanda.com/.well-known/openid-configuration'
rpk cluster config set oidc_token_audience 'redpanda'
rpk cluster config set oidc_principal_mapping '$.sub'
# principal mapping can use a JSONPath + regex transform:
rpk cluster config set oidc_principal_mapping '$.user_info.email/([^@]+)@.*/$1/L'
rpk cluster config set oidc_clock_skew_tolerance 30
rpk cluster config set oidc_token_expire_disconnect true
rpk cluster config set oidc_keys_refresh_interval 3600
```

### Token claims validated by Redpanda

- `aud` — must match `oidc_token_audience`; cannot be `none`.
- `exp` — must be in the future within `oidc_clock_skew_tolerance`.
- `iss` — must exactly match the `issuer` field of the discovery document at `oidc_discovery_url`.
- signature — must validate against the JWK set published at the discovery URL.

OIDC principals use the value extracted by `oidc_principal_mapping` and do **not** use the `User:` prefix in ACLs/superusers. Use the exact claim value (for example, the `sub` value `example@company.com`).

### Connecting rpk with OIDC

Starting with rpk v26.1.7 (and v25.3.x / v25.2.x patches), rpk supports `OAUTHBEARER` for Kafka API auth. Pass the token via `-X` options: set `sasl.mechanism=OAUTHBEARER` and supply the token through `pass`, either raw or in `token:<TOKEN>` form.

```bash
export OIDC_TOKEN="<access-token>"
rpk topic list \
  -X brokers=<broker-host>:<oidc-listener-port> \
  -X sasl.mechanism=OAUTHBEARER \
  -X pass="token:$OIDC_TOKEN"

# Or store in a profile:
rpk profile create oidc \
  --set kafka_api.brokers=<broker-host>:<oidc-listener-port> \
  --set kafka_api.tls.ca_file=<path-to-ca-cert> \
  --set kafka_api.sasl.mechanism=OAUTHBEARER \
  --set kafka_api.sasl.password="token:$OIDC_TOKEN"
```

If rpk returns `OAUTHBEARER requires a token`, the password is empty or only the `token:` prefix. Earlier rpk versions reject `-X sasl.mechanism=OAUTHBEARER` as unknown.

OIDC enables [GBAC (group-based access control)](enterprise-security.md) — assign Redpanda permissions to OIDC groups via `Group:` ACL principals or role assignments.

## SASL/GSSAPI (Kerberos) — Enterprise

Kerberos authentication requires an Enterprise license. Uses a keytab containing service credentials. Prepare brokers with FQDN host names, a `krb5.conf` (default `/etc/krb5.conf`), a valid SPN per broker (`primary/<FQDN>@<REALM>`), and a keytab at an identical path on each broker (default `/var/lib/redpanda/redpanda.keytab`).

### Cluster properties for Kerberos

| Property | Description | Default |
|----------|-------------|---------|
| `sasl_mechanisms` | Must include `GSSAPI` | — |
| `sasl_kerberos_keytab` | Path to the keytab | `/var/lib/redpanda/redpanda.keytab` |
| `sasl_kerberos_config` | Path to `krb5.conf` | `/etc/krb5.conf` |
| `sasl_kerberos_principal` | Primary of the Kerberos SPN used by Redpanda | `redpanda` |
| `sasl_kerberos_principal_mapping` | Rules mapping Kerberos UPNs to Redpanda principals | `["DEFAULT"]` |

```bash
rpk cluster config set sasl_kerberos_keytab <path>
rpk cluster config set sasl_kerberos_config <path>
rpk cluster config set sasl_kerberos_principal <name>
rpk cluster config set sasl_kerberos_principal_mapping '["RULE:[1:$1@$0](.*@MYDOMAIN.COM)s/@.*//","DEFAULT"]'
rpk cluster config set sasl_mechanisms '["SCRAM","GSSAPI"]'
```

### Kerberos principal mapping rule format

`RULE:[n:string](regexp)s/pattern/replacement/g/c`

- `n` — number of components the target principal should have.
- `string` — template using `$0` (realm) and `$n` (n-th component) substitutions.
- `regexp` — if the formed string matches, the `s//` substitution runs over it.
- `g` (optional) — global substitution.
- `c` (optional) — `/L` lowercases, `/U` uppercases the result.
- `DEFAULT` — uses the principal name as the local user name; fails if the principal has more than one component or is not in the default realm.

The first matching rule extracts the principal. Example: with `[1:$1@$0]`, UPN `jdoe@EXAMPLE.COM` -> `jdoe@EXAMPLE.COM`, but a two-component UPN `jdoe/host@EXAMPLE.COM` does not match.

## mTLS principal mapping (Community)

When mTLS is enabled, Redpanda extracts the principal from the X.509 certificate Distinguished Name (DN). Enable per listener with `authentication_method: mtls_identity` and `require_client_auth: true` on the listener's TLS block.

```yaml
redpanda:
  kafka_api:
    - address: 0.0.0.0
      port: 9092
      name: mtls_listener
      authentication_method: mtls_identity
  kafka_api_tls:
    - name: mtls_listener
      key_file: mtls_broker.key
      cert_file: mtls_broker.crt
      truststore_file: mtls_ca.crt
      enabled: true
      require_client_auth: true
```

By default Redpanda matches the entire DN. Override with the `kafka_mtls_principal_mapping_rules` cluster property (a list of rules). Rule format: `RULE:pattern/replacement/[LU]`.

- `pattern` — regex, e.g. `.*CN=([^,]+).*` to capture the CN.
- `replacement` — e.g. `$1` for the first match.
- `L` / `U` — lowercase / uppercase the result (optional).
- `DEFAULT` — use the full DN.

```bash
rpk cluster config set kafka_mtls_principal_mapping_rules '["DEFAULT"]'
# Example: extract lowercased CN
rpk cluster config set kafka_mtls_principal_mapping_rules '["RULE:.*CN=([^,]+).*/$1/L"]'
```

## HTTP API authentication (Admin API, Schema Registry, HTTP Proxy)

The HTTP APIs use the same credential store as the Kafka API. You must enable SASL for the Kafka API first. Two methods: HTTP Basic (Community) and OIDC (Enterprise).

### Cluster-wide http_authentication

`http_authentication` is a cluster property (list). Valid values are `BASIC` and `OIDC`. To disable OIDC for compliance, remove `OIDC` from this list (and from `sasl_mechanisms`).

```bash
rpk cluster config set admin_api_require_auth true
rpk cluster config set http_authentication '["BASIC"]'
# Enterprise OIDC on HTTP APIs:
rpk cluster config set http_authentication '["BASIC","OIDC"]'
```

The cluster-wide `BASIC` value differs from the per-listener `http_basic` set via the broker property `authentication_method` on a listener (`schema_registry_auth_method` / `http_proxy_auth_method`).

### Admin API and rpk

rpk can only communicate with the Admin API using HTTP Basic authentication, which requires a SCRAM user. For administrative tasks via rpk you must have a SCRAM user with superuser privileges, even when OIDC is the primary mechanism.

```yaml
# Per-listener http_basic example
pandaproxy:
  pandaproxy_api:
    address: "localhost"
    port: 8082
    authentication_method: http_basic
schema_registry:
  schema_registry_api:
    address: "localhost"
    port: 8081
    authentication_method: http_basic
```

## Disabling Enterprise authentication features (compliance)

To return a cluster to a license-compliant state without OIDC/Kerberos:

```bash
# Remove OIDC from both Kafka SASL and HTTP auth
rpk cluster config set sasl_mechanisms <other-mechanisms>
rpk cluster config set http_authentication <other-mechanisms>

# Remove GSSAPI (Kerberos)
rpk cluster config set sasl_mechanisms <other-mechanisms>
```

Upon license expiration, OIDC and Kerberos authentication continue to work (behavior "No change"), but you cannot newly enable them without a valid license.
