# rpk cloud login and auth

## Overview

`rpk cloud login` authenticates rpk against Redpanda Cloud and stores the resulting bearer token in `rpk.yaml`. The `rpk cloud auth` subgroup manages multiple named cloud authentications, which is useful when you have accounts across several Redpanda Cloud organizations.

---

## rpk cloud login

### Synopsis

```
rpk cloud login [flags]
```

### What it does

1. Checks `rpk.yaml` for an existing, valid bearer token.
2. If no valid token is found, performs the selected auth flow (SSO or client credentials).
3. Stores the token (and client ID) to `rpk.yaml`.
4. Optionally prompts you to select a Cloud cluster and creates/updates an rpk profile pointing at it.

### Authentication flows

#### SSO (default — OAuth device-authorization flow)

Opens your default browser to the Redpanda Cloud login page (Auth0 device flow). The CLI polls for a device code to be authorized; once you approve the login in the browser, Auth0 issues a bearer token that is stored in `rpk.yaml`. If you cannot open a browser (e.g., a remote machine), pass `--no-browser` to print the URL and device code so you can complete the flow manually on another machine.

```bash
rpk cloud login                  # auto-opens browser
rpk cloud login --no-browser     # prints URL; paste into browser manually
```

#### Client credentials (headless / CI)

Client credentials are created in the **Clients** tab of the Users section in the Redpanda Cloud UI. You supply a `client_id` and `client_secret`; rpk exchanges them for a bearer token without a browser.

Priority order (highest wins):

1. `client_id` / `client_secret` in the active `CloudAuth` entry in `rpk.yaml`
2. `RPK_CLOUD_CLIENT_ID` / `RPK_CLOUD_CLIENT_SECRET` environment variables
3. `--client-id` / `--client-secret` flags

```bash
# Flags
rpk cloud login \
  --client-id  "abc123" \
  --client-secret "secret456"

# Environment variables (preferred for CI — never stored unless --save)
export RPK_CLOUD_CLIENT_ID=abc123
export RPK_CLOUD_CLIENT_SECRET=secret456
rpk cloud login --no-profile

# Save the client secret permanently into rpk.yaml for automatic refresh
rpk cloud login \
  --client-id "abc123" \
  --client-secret "secret456" \
  --save
```

> Without `--save`, the client secret is used to obtain the token but is not written to `rpk.yaml`. This means the next login will require the secret again. The token and client ID are always written.

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--client-id` | string | — | Client ID from Redpanda Cloud |
| `--client-secret` | string | — | Client secret from Redpanda Cloud |
| `--no-browser` | bool | false | Disable auto-opening the browser for SSO |
| `--save` | bool | false | Persist the client secret to rpk.yaml |
| `--no-profile` | bool | false | Skip the automatic profile creation/selection prompt |
| `--config` | string | (search paths) | Path to rpk.yaml or redpanda.yaml |
| `-X, --config-opt` | stringArray | — | Override rpk config settings inline |
| `--profile` | string | — | Profile to use |
| `-v, --verbose` | bool | false | Enable verbose logging |

### Post-login profile behavior

After a successful login, rpk checks whether you already have a profile for the authenticated organization:

- **No profile yet**: Unless `--no-profile` is passed, rpk prompts you to select a Cloud cluster and creates a profile (default name: `rpk-cloud`).
- **Existing cloud profile for a different org**: rpk clears the stale profile and prompts for cluster selection.
- **Already pointing at a cloud cluster**: rpk shows which cluster you are talking to and offers to switch.
- **Self-hosted or container profile**: rpk offers to switch to a cloud profile.

Use `--no-profile` in automation to suppress all prompts.

### Logout

```bash
rpk cloud logout                        # clear token for the current org, keep credentials
rpk cloud logout -c                     # same as --clear-credentials: remove client ID/secret too
rpk cloud logout --clear-credentials    # remove client ID and client secret in addition to the token
rpk cloud logout --all                  # log out of all organizations (-a shorthand)
rpk cloud logout -a --clear-credentials # log out of all orgs and clear all credentials
```

Flag shorthands: `-c` = `--clear-credentials`, `-a` = `--all`.

---

## rpk cloud auth

The `auth` subgroup manages multiple named cloud authentications stored in `rpk.yaml` under `cloud_auth`. Each entry represents a Redpanda Cloud organization (SSO or client credentials). Most users only ever have one.

### Subcommands

#### list (ls)

```bash
rpk cloud auth list
rpk cloud auth ls
rpk cloud auth list --format json
```

Displays all stored cloud auths. The current auth is marked with `*`. Columns: `NAME`, `KIND` (sso or client_credentials), `ORGANIZATION`, `ORGANIZATION-ID`.

#### use

```bash
rpk cloud auth use <NAME>
```

Switches the active cloud auth to the named entry. If the current profile was using a different auth, the profile is cleared (you will need to run `rpk cloud cluster select` again to restore it).

#### delete

```bash
rpk cloud auth delete <NAME>
```

Removes the named auth from `rpk.yaml`. If the auth is used by any profiles, rpk prompts for confirmation and clears the auth reference from those profiles (the profiles remain but can only connect via SASL credentials until re-linked).

#### token

```bash
rpk cloud auth token
```

Prints the bearer token of the current cloud auth to stdout. Useful for piping into `curl` or other tools that need to call the Redpanda Cloud API directly. Pass the token as a `Bearer` token in the `Authorization` header; see the [Redpanda Cloud API reference](https://docs.redpanda.com/redpanda-cloud/api/cloud-api-overview/) for available endpoints.

```bash
TOKEN=$(rpk cloud auth token)
curl -H "Authorization: Bearer $TOKEN" \
  https://api.redpanda.com/<endpoint>
```

#### Deprecated no-ops

`rpk cloud auth create`, `rpk cloud auth rename-to`, and `rpk cloud auth edit` are deprecated/hidden no-ops that print a deprecation message and exit without making any change. Use `rpk cloud login` instead to create or update cloud auths.

### rpk.yaml CloudAuth fields

A cloud auth entry in `rpk.yaml` looks like:

```yaml
cloud_auth:
  - name: "my-org"
    organization: "My Organization"
    org_id: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    kind: sso
    auth_token: "eyJ..."
    client_id: "abc123"
    client_secret: ""     # only set if --save was used
```

`current_cloud_auth_org_id` and `current_cloud_auth_kind` in `rpk.yaml` identify which entry is active.

---

## Environment variable reference

| Variable | Equivalent flag | Notes |
|---|---|---|
| `RPK_CLOUD_CLIENT_ID` | `--client-id` | Applied on any `rpk cloud` command that performs auth |
| `RPK_CLOUD_CLIENT_SECRET` | `--client-secret` | Not written to rpk.yaml unless `--save` is passed |
| `RPK_PROFILE` | `--profile` | Selects the rpk profile to use |

---

## Troubleshooting

**Token expired**: Run `rpk cloud login --no-profile` to refresh. For client credentials, the secret must still be available (flag, env, or previously saved).

**Wrong organization**: Run `rpk cloud auth list` to see which org is current. Use `rpk cloud auth use <NAME>` to switch, or `rpk cloud logout --clear-credentials` and log in again.

**`Unable to login` error**: Try `rpk cloud logout --clear-credentials` then re-authenticate.
