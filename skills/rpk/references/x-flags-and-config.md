# rpk -X Flags and Configuration Reference

Every rpk command accepts `-X key=value` flags to override connection and
authentication settings on a per-command basis. Each `-X` option also has a
corresponding `RPK_*` environment variable. For persistent configuration use
[rpk profiles](profiles.md) instead.

---

## Configuration priority (highest wins)

1. **`-X` flags** on the command line — applies to current command only
2. **`RPK_*` environment variables** — lasts for the shell session
3. **rpk profile** in `rpk.yaml` — persistent, recommended
4. **`redpanda.yaml` rpk section** — system-wide defaults (self-managed only)

---

## Quick reference: -X → RPK_ mapping

| `-X` option | Environment variable | Default |
|---|---|---|
| `brokers` | `RPK_BROKERS` | `localhost:9092` |
| `tls.enabled` | `RPK_TLS_ENABLED` | `false` |
| `tls.insecure_skip_verify` | `RPK_TLS_INSECURE_SKIP_VERIFY` | `false` |
| `tls.ca` | `RPK_TLS_CA` | `""` |
| `tls.cert` | `RPK_TLS_CERT` | `""` |
| `tls.key` | `RPK_TLS_KEY` | `""` |
| `sasl.mechanism` | `RPK_SASL_MECHANISM` | `""` |
| `user` | `RPK_USER` | `""` |
| `pass` | `RPK_PASS` | `""` |
| `admin.hosts` | `RPK_ADMIN_HOSTS` | `localhost:9644` |
| `admin.tls.enabled` | `RPK_ADMIN_TLS_ENABLED` | `false` |
| `admin.tls.insecure_skip_verify` | `RPK_ADMIN_TLS_INSECURE_SKIP_VERIFY` | `false` |
| `admin.tls.ca` | `RPK_ADMIN_TLS_CA` | `""` |
| `admin.tls.cert` | `RPK_ADMIN_TLS_CERT` | `""` |
| `admin.tls.key` | `RPK_ADMIN_TLS_KEY` | `""` |
| `registry.hosts` | `RPK_REGISTRY_HOSTS` | `localhost:8081` |
| `registry.tls.enabled` | `RPK_REGISTRY_TLS_ENABLED` | `false` |
| `registry.tls.insecure_skip_verify` | `RPK_REGISTRY_TLS_INSECURE_SKIP_VERIFY` | `false` |
| `registry.tls.ca` | `RPK_REGISTRY_TLS_CA` | `""` |
| `registry.tls.cert` | `RPK_REGISTRY_TLS_CERT` | `""` |
| `registry.tls.key` | `RPK_REGISTRY_TLS_KEY` | `""` |
| `cloud.client_id` | `RPK_CLOUD_CLIENT_ID` | `""` |
| `cloud.client_secret` | `RPK_CLOUD_CLIENT_SECRET` | `""` |
| `globals.prompt` | `RPK_GLOBALS_PROMPT` | `bg-red "%n"` |
| `globals.no_default_cluster` | `RPK_GLOBALS_NO_DEFAULT_CLUSTER` | `false` |
| `globals.command_timeout` | `RPK_GLOBALS_COMMAND_TIMEOUT` | `30s` |
| `globals.dial_timeout` | `RPK_GLOBALS_DIAL_TIMEOUT` | `3s` |
| `globals.request_timeout_overhead` | `RPK_GLOBALS_REQUEST_TIMEOUT_OVERHEAD` | `10s` |
| `globals.retry_timeout` | `RPK_GLOBALS_RETRY_TIMEOUT` | `30s` |
| `globals.fetch_max_wait` | `RPK_GLOBALS_FETCH_MAX_WAIT` | `5s` |
| `globals.kafka_protocol_request_client_id` | `RPK_GLOBALS_KAFKA_PROTOCOL_REQUEST_CLIENT_ID` | `rpk` |

Profile selection: `RPK_PROFILE=<profile-name>`

---

## Detailed option descriptions

### brokers

Comma-delimited list of `host:port` pairs for the Kafka API.

- **Type**: string
- **Default**: `localhost:9092`
- **Example**: `rpk topic list -X brokers=broker1:9092,broker2:9092`

---

### tls.enabled

Enable TLS for the Kafka API connection. Set this when your brokers use
well-known CA certificates. Specifying mTLS certificate paths (`tls.cert`,
`tls.key`) automatically opts in without setting this flag.

- **Type**: boolean
- **Default**: `false`
- **Example**: `rpk topic list -X tls.enabled=true`

---

### tls.insecure_skip_verify

Disable certificate chain verification (useful for self-signed certs in dev).
Do not use in production.

- **Type**: boolean
- **Default**: `false`

---

### tls.ca

Path to a PEM-encoded CA certificate file. Use when brokers present a
certificate signed by a CA not in your OS trust store.

- **Type**: string (file path)
- **Default**: `""`
- **Example**: `rpk topic list -X tls.ca=/etc/ssl/certs/my-ca.pem`

---

### tls.cert / tls.key

Client certificate and key for mTLS (mutual TLS) to the Kafka API.

- **Type**: string (file path)
- **Example**:
  ```bash
  rpk topic list \
    -X tls.cert=/etc/ssl/certs/client.pem \
    -X tls.key=/etc/ssl/certs/client.key
  ```

---

### sasl.mechanism

SASL authentication mechanism.

- **Type**: string
- **Default**: `""`
- **Accepted values**: `SCRAM-SHA-256`, `SCRAM-SHA-512`, `PLAIN`, `OAUTHBEARER`
- **Notes**:
  - The Admin API uses Basic auth with Kafka SASL credentials; if the mechanism
    is unspecified it defaults to `SCRAM-SHA-256` for Admin API auth.
  - For `OAUTHBEARER`: set `pass` to an OIDC access token (raw value or
    prefixed with `token:`), leave `user` unset.

---

### user / pass

SASL username and password. Also used for Admin API Basic auth when the Admin
API is configured to require authentication.

- **Type**: string
- **Default**: `""`
- **Example**:
  ```bash
  rpk topic list -X user=alice -X pass=s3cr3t -X sasl.mechanism=SCRAM-SHA-256
  ```

---

### admin.hosts

Comma-delimited list of `host:port` pairs for the Admin API.

- **Type**: string
- **Default**: `localhost:9644`
- **Example**: `rpk cluster info -X admin.hosts=broker1:9644,broker2:9644`

---

### admin.tls.enabled / admin.tls.ca / admin.tls.cert / admin.tls.key / admin.tls.insecure_skip_verify

TLS settings for the Admin API connection. Same semantics as the corresponding
`tls.*` options for the Kafka API.

- **Example**:
  ```bash
  rpk cluster info \
    -X admin.hosts=broker1:9644 \
    -X admin.tls.enabled=true \
    -X admin.tls.ca=/etc/ssl/certs/ca.pem
  ```

---

### registry.hosts

Comma-delimited list of `host:port` pairs for the Schema Registry.

- **Type**: string
- **Default**: `localhost:8081`
- **Example**: `rpk registry schema list -X registry.hosts=broker1:8081`

---

### registry.tls.enabled / registry.tls.ca / registry.tls.cert / registry.tls.key / registry.tls.insecure_skip_verify

TLS settings for the Schema Registry connection. Same semantics as `tls.*`.

---

### cloud.client_id / cloud.client_secret

OAuth2 client credentials for the Redpanda Cloud API. Used by `rpk cloud`
commands when authenticating with service-account credentials instead of SSO.

- **Type**: string
- **Example**:
  ```bash
  rpk cloud cluster list \
    -X cloud.client_id=my-client-id \
    -X cloud.client_secret=my-secret
  ```

---

### globals.command_timeout

Sets a deadline for all rpk commands.

- **Type**: duration (`30s`, `1m`, `2m30s`)
- **Default**: `30s`

---

### globals.dial_timeout

How long rpk waits to establish a connection to a broker before timing out.

- **Type**: duration
- **Default**: `3s`

---

### globals.request_timeout_overhead

Additional time rpk waits on top of any request-internal timeout for a
response from the broker.

- **Type**: duration
- **Default**: `10s`

---

### globals.retry_timeout

How long rpk keeps retrying Kafka API requests before giving up.

- **Type**: duration
- **Default**: `30s`

---

### globals.fetch_max_wait

Maximum time brokers wait before responding to a fetch request with available
data.

- **Type**: duration
- **Default**: `5s`

---

### globals.no_default_cluster

When `true`, rpk will not silently fall back to `localhost:9092` when no
cluster is configured. Useful to prevent accidental operations against a wrong
cluster.

- **Type**: boolean
- **Default**: `false`

---

### globals.kafka_protocol_request_client_id

The Kafka client ID rpk sends in Kafka protocol requests. Appears in broker
logs and metrics.

- **Type**: string
- **Default**: `rpk`
- **Example**: `rpk topic list -X globals.kafka_protocol_request_client_id=my-tool`

---

## Duration format

Duration values use Go's standard format — decimal numbers with unit suffixes:

| Suffix | Unit |
|---|---|
| `ns` | nanoseconds |
| `us` or `µs` | microseconds |
| `ms` | milliseconds |
| `s` | seconds |
| `m` | minutes |
| `h` | hours |

Examples: `30s`, `1m30s`, `2h`, `500ms`, `1h15m30s`

---

## Discover all available -X options

```bash
# Short list with defaults
rpk -X list

# Detailed descriptions
rpk -X help
```

---

## rpk.yaml vs redpanda.yaml

| File | Purpose | Location |
|---|---|---|
| `rpk.yaml` | All rpk profiles, Cloud auth tokens, globals | `~/.config/rpk/rpk.yaml` (Linux) or `~/Library/Application Support/rpk/rpk.yaml` (macOS) |
| `redpanda.yaml` | Broker node configuration (Kafka API, Admin API, cluster settings, data directories) — also has an `rpk:` section for legacy defaults | `/etc/redpanda/redpanda.yaml` on broker nodes |

rpk reads the `rpk:` section from `redpanda.yaml` as the lowest-priority source
of broker addresses and TLS settings. For client use (connecting remotely to a
cluster) always use `rpk.yaml` profiles instead.

---

## Common usage patterns

**One-off command with explicit broker and auth:**
```bash
rpk topic list \
  -X brokers=broker1.example.com:9092 \
  -X tls.enabled=true \
  -X sasl.mechanism=SCRAM-SHA-256 \
  -X user=alice \
  -X pass=s3cr3t
```

**Script/CI with environment variables:**
```bash
export RPK_BROKERS="broker1.example.com:9092,broker2.example.com:9092"
export RPK_TLS_ENABLED="true"
export RPK_SASL_MECHANISM="SCRAM-SHA-256"
export RPK_USER="ci-user"
export RPK_PASS="ci-password"

rpk topic list
rpk cluster health
```

**Persistent config via profile (recommended):**
```bash
rpk profile create ci \
  --set brokers=broker1.example.com:9092 \
  --set tls.enabled=true \
  --set sasl.mechanism=SCRAM-SHA-256 \
  --set user=ci-user \
  --set pass=ci-password

rpk profile use ci
rpk topic list   # no extra flags needed
```
