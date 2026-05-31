# Authentication: OAuth2 Client Credentials for api.redpanda.com

All calls to the Redpanda Cloud Control Plane API (`https://api.redpanda.com`)
and per-cluster Data Plane APIs use **OAuth2 Bearer tokens**. This document
covers everything you need to obtain and use a token.

## Overview

The authentication flow is OAuth2 Client Credentials (RFC 6749 §4.4). You
exchange a `client_id` + `client_secret` for a short-lived access token, then
pass it as `Authorization: Bearer <token>` on every API call.

All values below are grounded in the rpk source:
- Token URL: `https://auth.prd.cloud.redpanda.com/oauth/token` (`auth0.go`)
- Audience: `cloudv2-production.redpanda.cloud` (`auth0.go`)
- Control Plane base: `https://api.redpanda.com` (`publicapi.go`)

## Step 1: Get a Service Account Client ID and Secret

Service accounts are created either through the Redpanda Cloud console or via
the IAM API. The `client_id` and `client_secret` come from the
`ServiceAccountCredentials` embedded in the create response, or retrieved via
`GET /v1/service-accounts/{id}/credentials`.

**Create a service account via API** (you need an existing token for this
bootstrap call, or use the Cloud console):

```bash
curl -s -X POST https://api.redpanda.com/v1/service-accounts \
  -H "Authorization: Bearer ${BOOTSTRAP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "service_account": {
      "name": "ci-bot",
      "description": "CI pipeline service account"
    }
  }' | jq '{
    id: .service_account.id,
    client_id: .service_account.auth0_client_credentials.client_id
  }'
```

The `client_secret` is returned **only on creation**. Save it immediately.
To retrieve credentials for an existing service account:

```bash
curl -s "https://api.redpanda.com/v1/service-accounts/${SA_ID}/credentials" \
  -H "Authorization: Bearer ${TOKEN}" | jq .credentials
```

To rotate the secret:

```bash
curl -s "https://api.redpanda.com/v1/service-accounts/${SA_ID}/rotate-secret" \
  -H "Authorization: Bearer ${TOKEN}" | jq .service_account.auth0_client_credentials
```

## Step 2: Exchange Credentials for a Bearer Token

The token endpoint is an Auth0-hosted URL. Post a URL-encoded form body:

```bash
TOKEN=$(curl -s -X POST https://auth.prd.cloud.redpanda.com/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "client_id=${CLIENT_ID}" \
  --data-urlencode "client_secret=${CLIENT_SECRET}" \
  --data-urlencode "audience=cloudv2-production.redpanda.cloud" \
  | jq -r .access_token)
echo "Token: ${TOKEN:0:20}..."
```

**Response fields** (from the `oauth.Token` struct in `oauth.go`):

| Field | Type | Notes |
|---|---|---|
| `access_token` | string | JWT bearer token |
| `token_type` | string | Always `"Bearer"` |
| `expires_in` | int | Seconds until expiry |

## Step 3: Use the Token on Every Request

The token goes in the `Authorization` header:

```bash
curl -s "https://api.redpanda.com/v1/serverless/clusters" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq '.serverless_clusters[].name'
```

The rpk client sets this header via auth interceptors defined in `publicapi.go`:
- The **control-plane** client uses `newReloadingAuthInterceptor(ccs.Token)` —
  a token-reloading variant that fetches a fresh token on each call
  (grounded in `controlplane.go`).
- **Fixed-host data-plane** clients use `newAuthInterceptor(authToken)` with a
  static token string; data-plane clients that accept a token provider also use
  `newReloadingAuthInterceptor` (grounded in `dataplane.go`).

```go
req.Header().Set("Authorization", fmt.Sprintf("Bearer %s", token))
```

## Token Audience and Validation

The audience `cloudv2-production.redpanda.cloud` must be present in the token's
`aud` claim. rpk validates tokens via `authtoken.ValidateToken(token, audience,
clientID)` before using them. If you see "invalid Redpanda Cloud token", the
token was issued for a different audience or has expired.

## Token Expiry and Refresh

The `expires_in` field tells you the lifetime (typically 1 hour). There is no
refresh token in the client-credentials flow — simply re-request a new token
with the same `client_id` and `client_secret`. rpk's `ClientCredentialFlow`
in `oauth.go` re-requests automatically when the token is expired.

## Environment Variables (rpk)

When using the `rpk cloud` CLI, you can supply credentials via environment
variables instead of storing them in `rpk.yaml`:

```bash
export RPK_CLOUD_CLIENT_ID=<your-client-id>
export RPK_CLOUD_CLIENT_SECRET=<your-client-secret>
rpk cloud login --client-id "${RPK_CLOUD_CLIENT_ID}" \
                --client-secret "${RPK_CLOUD_CLIENT_SECRET}"
```

## Using the Same Token for the Data Plane API

The bearer token obtained above is valid for both:
- Control Plane API: `https://api.redpanda.com`
- Per-cluster Data Plane API: URL returned in `ServerlessCluster.dataplane_api.url`

Do not hard-code the data-plane host. Always read the URL from the API
response. The real DNS pattern (from API examples) is:
`https://<cluster-id>.any.<region>.mpx.prd.cloud.redpanda.com`
e.g. `https://d1d9risv0c3i7qbbeoc0.any.us-east-1.mpx.prd.cloud.redpanda.com`

No separate token is needed for the data plane.

## ServiceAccount IAM Fields (grounded in `service_account.proto`)

| Field | Notes |
|---|---|
| `id` | 20-char opaque ID |
| `name` | 3–128 chars, no `<>` |
| `description` | **required**, max 140 chars |
| `auth0_client_credentials.client_id` | The client ID to use for OAuth |
| `auth0_client_credentials.client_secret` | Returned only on creation and rotation |

## Troubleshooting

| Symptom | Likely Cause |
|---|---|
| 401 Unauthorized | Token expired, wrong audience, or missing `Authorization` header |
| 403 Forbidden | Service account lacks required IAM permission |
| "invalid Redpanda Cloud token" | Audience mismatch or malformed JWT |
| "client secret not available for token refresh" | Secret not in config; re-authenticate |
