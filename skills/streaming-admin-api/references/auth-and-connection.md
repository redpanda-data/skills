# Admin API: Auth and Connection

## Base URL

```
http://<broker-address>:9644/v1/<path>
```

The Admin API is served on **port 9644** by default. You can target any broker in the cluster — read operations are served locally and writes are forwarded to the controller leader.

## TLS

When TLS is configured on the Admin API listener, use `https://`:

```bash
curl https://<broker>:9644/v1/brokers
```

To skip certificate verification (test environments):
```bash
curl -k https://<broker>:9644/v1/brokers
```

To provide a CA certificate:
```bash
curl --cacert /path/to/ca.crt https://<broker>:9644/v1/brokers
```

## mTLS (Mutual TLS)

When the cluster is configured with `require_client_auth: true` for the Admin API listener, you must present a client certificate and key:

```bash
curl \
  --cacert /path/to/ca.crt \
  --cert /path/to/client.crt \
  --key /path/to/client.key \
  https://<broker>:9644/v1/brokers
```

## Authentication Modes

Authentication is optional and mirrors the cluster's authentication configuration. When auth is **not** enabled (the default for a freshly installed cluster), all requests are accepted without credentials.

When authentication is enabled, the Admin API recognizes two credential forms:

### HTTP Basic Authentication

Pass `<username>:<password>` as HTTP Basic auth:

```bash
curl -u admin:your-password http://localhost:9644/v1/brokers
```

This is equivalent to the `Authorization: Basic <base64(user:pass)>` header.

### Bearer Token

Pass an `Authorization` header with a bearer token (e.g., an OIDC JWT):

```bash
curl -H "Authorization: Bearer <token>" http://localhost:9644/v1/brokers
```

## Auth Levels

The Admin API uses three authorization levels (defined in `server.h`):

| Level | Meaning |
|-------|---------|
| `publik` (public) | No authentication required even when auth is enabled. Used for informational/read-only endpoints. |
| `authenticated` | Requires valid credentials (any authenticated user). |
| `superuser` | Requires a superuser account. Most write/mutating endpoints require superuser. |

**Superusers** are configured in `redpanda.yaml` under `superusers:` list. When using `rpk security user create` with SASL, you then add that user to the `superusers` config property in the cluster config.

## Setting Up curl for All Requests

For convenience, use shell variables so you don't repeat credentials:

```bash
# No auth
ADMIN=http://localhost:9644

# With Basic auth
ADMIN_OPTS="-u admin:secret http://localhost:9644"
curl $ADMIN_OPTS/v1/brokers

# Or export
export ADMIN_CREDS="-u admin:secret"
curl $ADMIN_CREDS http://localhost:9644/v1/brokers

# TLS + Basic
curl -u admin:secret --cacert /etc/redpanda/ca.crt https://broker1:9644/v1/brokers
```

## Multi-Broker Clusters

All brokers serve the Admin API. For cluster-level mutations, you can send to any broker — it forwards the request to the controller leader internally. For node-specific endpoints like `/v1/partitions` (local only) or `/v1/debug/cpu_profile`, target the specific broker you want to inspect.

```bash
# Read node-specific data from broker 2
curl http://broker2:9644/v1/partitions/local_summary

# Read cluster-wide data from any broker
curl http://broker1:9644/v1/cluster/health_overview
```

## ConnectRPC (v25.3+)

Starting in Redpanda v25.3, new endpoints are served as ConnectRPC services on the same port 9644. They use different URL patterns:

```
http://<broker>:9644/<fully-qualified-service>/<method>
```

For example:
```bash
curl -u admin:secret \
  -X POST http://localhost:9644/redpanda.core.admin.v2.ShadowLinkService/FailOver \
  -H "Content-Type: application/json" \
  -d '{"name": "my-link", "shadowTopicName": "my-topic"}'
```

ConnectRPC endpoints:
- Always use **POST** (even for reads)
- Accept JSON (`Content-Type: application/json`) or binary Protobuf (`Content-Type: application/proto`)
- Optionally accept `Connect-Protocol-Version` and `Connect-Timeout-Ms` headers
- Use the same port (9644) and the same auth mechanism as legacy endpoints

Legacy `/v1` endpoints are unaffected by v25.3 and remain fully supported.

## Common HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Bad request (invalid body, missing required field, validation error) |
| 401 | Unauthorized (no credentials provided when auth is required) |
| 403 | Forbidden (authenticated but insufficient privileges) |
| 404 | Not found (broker/partition does not exist) |
| 409 | Conflict (operation already in progress, e.g., two decommissions, debug bundle already running) |
| 422 | Unprocessable entity (malformed request format) |
| 500 | Internal server error |
| 503 | Service unavailable (e.g., self-test failed to start) |

## Quick Health Check (No Auth)

If you just want to verify the Admin API is reachable and the cluster is healthy:

```bash
curl -s http://localhost:9644/v1/cluster/health_overview | python3 -m json.tool
```

Look for `"is_healthy": true` in the response.
