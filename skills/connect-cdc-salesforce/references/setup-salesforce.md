# Salesforce Setup for salesforce_cdc

This guide covers everything needed on the Salesforce side before running a `salesforce_cdc` pipeline: creating a Connected App with OAuth Client Credentials, enabling Change Data Capture for objects, defining Platform Events, and understanding the Pub/Sub API replay/retention model.

Grounded in:
- `internal/impl/salesforce/README.md` — developer setup workflow
- `internal/impl/salesforce/app/setup.sh` — automated Connected App deployment script
- `internal/impl/salesforce/config.go` — `authFieldSpecs()` field descriptions
- `internal/impl/salesforce/input_salesforce_cdc.go` — component description and prerequisites
- `internal/impl/salesforce/salesforcegrpc/client.go` — Pub/Sub endpoint (`api.pubsub.salesforce.com:443`)

---

## Step 1: Salesforce Org and CLI

You need a Salesforce org (Developer Edition, sandbox, or production). Sign up at [developer.salesforce.com/signup](https://developer.salesforce.com/signup).

Install the Salesforce CLI:

```bash
# macOS
brew install salesforce-cli

# Verify
sf --version
```

Log in to your org:

```bash
sf org login web --set-default
# Opens a browser — authorize the Salesforce CLI
# --set-default makes this the default org for subsequent sf commands
# The automated setup.sh also honors $SF_TARGET_ORG if set (setup.sh:23-36)
```

---

## Step 2: Create a Connected App

The `salesforce_cdc` input authenticates using the **OAuth 2.0 Client Credentials flow**. This requires a Salesforce Connected App configured to allow that flow.

### Manual setup (Salesforce Setup UI)

1. **Setup → App Manager → New Connected App**
2. Fill in:
   - Connected App Name: e.g. `Redpanda Connect`
   - Contact Email: your admin email
3. **Enable OAuth Settings** (checkbox)
4. **Callback URL**: `http://localhost` (not used by client credentials — any valid URL works; the reference Connected App in the repo uses `http://localhost`)
5. **Selected OAuth Scopes**: Add:
   - `api` (Access and manage your data)
   - `full` (Full access)
   - `RefreshToken` (Allow refresh token; required by the reference Connected App)
6. **Enable Client Credentials Flow** (checkbox — found under "Flow Enablement")
7. Save. Wait 2–10 minutes for Salesforce to propagate.
8. **Manage Consumer Details** (button on app detail page — triggers email verification):
   - Copy the **Consumer Key** → this is your `client_id`
   - Copy the **Consumer Secret** → this is your `client_secret`

Set the **Run-As User** (required for client credentials):

```
Setup → App Manager → [your app] → Manage → Edit Policies
→ Client Credentials Flow: Run As = [choose an admin user with API access]
→ Save
```

### Automated setup script

The repo includes `internal/impl/salesforce/app/setup.sh` which deploys the Connected App via the Salesforce Metadata API:

```bash
# From the salesforce package directory
./app/setup.sh > .env
# Writes SALESFORCE_ORG_URL and SALESFORCE_CLIENT_ID to .env
# Prints the app Setup URL to stderr

# Add the Consumer Secret manually:
echo 'SALESFORCE_CLIENT_SECRET="<secret-from-UI>"' >> .env

# Verify (runs client_credentials OAuth flow end-to-end):
set -a; source .env; set +a
./app/setup.sh > /dev/null
# "OAuth: OK" on stderr = ready to use
```

The script requires `sf`, `jq`, `envsubst`, `xmllint`, and `curl`.

### Store credentials

```bash
export SALESFORCE_ORG_URL="https://acme.my.salesforce.com"
export SALESFORCE_CLIENT_ID="3MVG9..."          # Consumer Key
export SALESFORCE_CLIENT_SECRET="abc123..."     # Consumer Secret
```

Use `${SALESFORCE_CLIENT_SECRET}` in your pipeline YAML — never inline secrets in config files.

---

## Step 3: Enable Change Data Capture

Change Data Capture (CDC) must be explicitly enabled for each sObject you want to capture. If CDC is not enabled, subscribing to `/data/<sObject>ChangeEvent` will fail or receive no events.

### In Salesforce Setup

```
Setup → Integrations → Change Data Capture
→ Available Entities: select the objects (Account, Contact, Opportunity, MyCustom__c, ...)
→ Move them to Selected Entities
→ Save
```

Standard objects that support CDC (partial list): Account, Contact, Opportunity, Lead, Case, Order, Contract, Asset, Product2, User, and more. Custom objects (`__c`) are also supported.

### Verify via SOQL (optional)

After enabling CDC, verify the Pub/Sub topics exist:

```bash
# Using Salesforce CLI
sf data query --query "SELECT Id, EntityDefinition.QualifiedApiName FROM PlatformEventChannelMember" --target-org <alias>
```

---

## Step 4: Platform Events (if using `/event/...` topics)

If you want to subscribe to **Platform Events** rather than CDC events:

### Custom Platform Events

```
Setup → Integrations → Platform Events → New Platform Event
→ Label: Order Created
→ API Name: Order_Created__e
→ Add custom fields (Text, Number, etc.)
→ Save
```

Subscribe with:
```yaml
topics:
  - /event/Order_Created__e
```

### Standard Platform Events

Standard events like `LoginEventStream` may require:
- Event Monitoring license for some events
- Specific permission sets for the Run-As user

Subscribe with:
```yaml
topics:
  - /event/LoginEventStream
```

Platform Event topics are **never snapshotted** — the connector skips them in the REST snapshot phase. There is no REST query equivalent for Platform Events.

---

## Step 5: Pub/Sub API Access

The `salesforce_cdc` input connects to `api.pubsub.salesforce.com:443` (TLS, gRPC). This endpoint is provided by Salesforce and is always available for orgs with API access.

Ensure the Run-As user has:
- **API Enabled** permission (profile or permission set)
- **Read** access to all sObjects being captured
- **Access to the Pub/Sub API** (no separate enablement needed beyond API access for most orgs)

The connector dials `api.pubsub.salesforce.com:443` using TLS 1.2+ (hardcoded in `salesforcegrpc/client.go`). No additional firewall allowlisting is needed beyond standard Salesforce API access.

---

## Replay-ID and Event Retention

The Salesforce Pub/Sub API uses **replay IDs** (opaque byte strings, stored as hex in the checkpoint cache) to resume subscriptions.

**Retention windows**:

| Plan | Retention |
|---|---|
| Standard | 24 hours |
| Enhanced Event Retention (add-on) | 72 hours |

When `replay_preset: earliest` is set and no checkpoint exists, the connector asks for events from the start of the retention window. Events older than the retention window are gone and cannot be replayed.

**Stale replay recovery**: If the pipeline was stopped for longer than the retention window, the stored `replay_id` is rejected by Salesforce with a gRPC `INVALID_ARGUMENT` error. The connector handles this automatically:

1. Logs: `topic /data/... replay_id rejected (...); clearing and reconnecting via configured preset`
2. Clears the stale `replay_id` from the checkpoint cache
3. Reconnects using `replay_preset` (typically `latest`)

To recover missed events after a long outage, set `replay_preset: earliest` before restarting — this replays from the oldest available event within the retention window.

---

## Salesforce API Limits

The REST snapshot phase consumes **Salesforce API call quota**:

- Each page of `snapshot_max_batch_size` records = 1 API call
- For a 100,000-record sObject with `snapshot_max_batch_size: 2000` = 50 API calls
- Multiple sObjects multiply the count
- The quota is per-org per-24-hour rolling window (25,000 calls for Developer Edition; higher for Enterprise/Unlimited)

Monitor usage:
```
Setup → Company Information → API Requests, Last 24 Hours
```

Tune `snapshot_max_batch_size` and `max_parallel_snapshot_objects` to control quota consumption rate.

---

## Troubleshooting Connected App Issues

**"Consumer not found" / 401 errors**:
- The Connected App may not have propagated (wait 2–10 minutes after creation)
- Verify `client_id` is the Consumer Key (not the app name)
- Ensure Client Credentials Flow is enabled and a Run-As user is set

**"insufficient_scope" error**:
- Add broader OAuth scopes to the Connected App (`full` or `api`)

**"INVALID_LOGIN" or "authentication failure"**:
- Verify `org_url` matches your org's My Domain URL exactly (production vs sandbox)
- Sandbox URLs use `https://{name}.sandbox.my.salesforce.com`

**No events received on a CDC topic**:
- Confirm CDC is enabled for the sObject in Setup → Change Data Capture
- Confirm the Run-As user has Read access to the object
- Try `replay_preset: earliest` to check for past events within the retention window
