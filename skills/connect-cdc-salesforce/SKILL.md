---
name: connect-cdc-salesforce
description: >-
  Streams change data capture (CDC) and platform events from Salesforce into
  Redpanda or Kafka using Redpanda Connect's salesforce_cdc input — the
  Salesforce Pub/Sub gRPC API (api.pubsub.salesforce.com:443), OAuth Client
  Credentials flow, optional REST snapshot of sObjects, and per-topic replay-ID
  checkpointing in a cache resource.
  Use when: capturing Salesforce change events (Account, Contact, Opportunity,
  or any CDC-enabled sObject) into Redpanda/Kafka; subscribing to the CDC
  firehose (/data/ChangeEvents); streaming custom or standard Platform Events
  (/event/Order__e, /event/LoginEventStream); configuring a Salesforce Connected
  App for OAuth client_credentials; enabling Change Data Capture for sObjects in
  Salesforce Setup; setting up a durable Connect cache_resource (e.g. Redis, Postgres, DynamoDB)
  for replay-ID persistence across restarts; tuning stream_snapshot,
  replay_preset, stream_batch_size, or snapshot_max_batch_size; understanding
  the topic/replay_id/operation/sobject/record_ids/event_uuid metadata emitted
  per message; mixing CDC topics and Platform Event topics in a single pipeline;
  or asking about the Enterprise license requirement for this connector.
  Also covers the Redpanda Enterprise features the destination CDC topics can
  use: Iceberg Topics (redpanda.iceberg.mode/delete/invalid.record.action/
  partition.spec/target.lag.ms), Tiered Storage (redpanda.remote.read/write,
  retention.local.target.*), Cloud Topics (cloud_topics_enabled,
  redpanda.storage.mode=cloud), Server-side Schema ID Validation
  (enable_schema_id_validation, redpanda.value.schema.id.validation,
  subject.name.strategy), and pointers to RBAC, Audit Logging, OIDC/Kerberos,
  FIPS, and Shadowing — all of which require a Redpanda Enterprise license.
---

# Redpanda Connect CDC: Salesforce

The `salesforce_cdc` input in Redpanda Connect streams change data capture (CDC) events and Platform Events from Salesforce into Redpanda or any Kafka-compatible topic. It uses the Salesforce **Pub/Sub gRPC API** (`api.pubsub.salesforce.com:443`) for real-time streaming and the Salesforce **REST API** for optional initial snapshots of existing sObject records. Authentication uses the OAuth 2.0 Client Credentials flow via a Salesforce Connected App.

This is an **Enterprise feature** — a Redpanda Enterprise license is required at runtime. The connector manages per-topic replay-ID state in a durable cache resource (Redis, PostgreSQL, DynamoDB, etc.) so pipelines survive restarts and resume from where they left off.

## Quickstart

### 1. Salesforce prerequisites (5 steps)

```bash
# Install the Salesforce CLI (macOS example)
brew install salesforce-cli

# Log in to your org (opens a browser)
sf org login web --set-default
```

In Salesforce Setup, enable **Change Data Capture** for the objects you want to capture:

```
Setup → Integrations → Change Data Capture → select Account, Contact, Opportunity → Save
```

Create a **Connected App** for OAuth Client Credentials:

```
Setup → App Manager → New Connected App
  → Enable OAuth Settings
  → Selected OAuth Scopes: api, full, RefreshToken
  → Enable Client Credentials Flow
  → Save → Manage Consumer Details → copy Consumer Key + Consumer Secret
```

Assign the Run-As user to the Connected App:

```
Setup → App Manager → find app → Manage → Edit Policies
  → Client Credentials Flow: set Run As User → Save
```

Store credentials as environment variables:

```bash
export SALESFORCE_ORG_URL="https://acme.my.salesforce.com"
export SALESFORCE_CLIENT_ID="3MVG9..."          # Consumer Key
export SALESFORCE_CLIENT_SECRET="abc123..."     # Consumer Secret
```

### 2. Full pipeline YAML (snapshot + CDC, three core objects)

```yaml
# salesforce-cdc-pipeline.yaml
input:
  label: "sf_cdc"
  salesforce_cdc:
    org_url: ${SALESFORCE_ORG_URL}
    client_id: ${SALESFORCE_CLIENT_ID}
    client_secret: ${SALESFORCE_CLIENT_SECRET}
    topics:
      - Account       # shorthand for /data/AccountChangeEvent
      - Contact       # shorthand for /data/ContactChangeEvent
      - Opportunity   # shorthand for /data/OpportunityChangeEvent
    stream_snapshot: true          # back-fill existing records first
    replay_preset: latest          # for live changes after snapshot; use earliest to recover missed events
    snapshot_max_batch_size: 2000  # records per REST query page (200–2000)
    stream_batch_size: 100         # events per gRPC Fetch call
    max_parallel_snapshot_objects: 1
    checkpoint_cache: persistent_cache
    checkpoint_cache_key: salesforce_cdc  # default
    checkpoint_limit: 1024
    batching:
      count: 100
      period: 1s

pipeline:
  processors:
    # Route each event to a topic named after the sObject
    - mapping: |
        meta kafka_topic = "sf.cdc." + metadata("sobject").lowercase()

output:
  kafka_franz:
    seed_brokers:
      - localhost:9092
    topic: ${! metadata("kafka_topic") }

cache_resources:
  - label: persistent_cache
    redis:
      url: redis://localhost:6379
```

### 3. Run the pipeline

```bash
# Via rpk
rpk connect run salesforce-cdc-pipeline.yaml

# Via the redpanda-connect binary
redpanda-connect run salesforce-cdc-pipeline.yaml

# Via Docker
docker run --rm \
  -e SALESFORCE_ORG_URL \
  -e SALESFORCE_CLIENT_ID \
  -e SALESFORCE_CLIENT_SECRET \
  -v $(pwd)/salesforce-cdc-pipeline.yaml:/pipeline.yaml \
  docker.redpanda.com/redpandadata/connect:latest \
  run /pipeline.yaml
```

### 4. Inspect emitted messages

Every message has these metadata fields accessible via `metadata("key")` in Bloblang:

| Metadata key | Present for | Value |
|---|---|---|
| `topic` | Streaming events only | Full Pub/Sub topic path, e.g. `/data/AccountChangeEvent` |
| `replay_id` | Streaming events only | Hex-encoded Pub/Sub replay ID |
| `operation` | All | `read` (snapshot rows), `create`, `update`, `delete`, `undelete` (streaming CDC) |
| `sobject` | Streaming CDC events | sObject API name, e.g. `Account` (also set on snapshot rows by `GetNextBatchParallel`) |
| `record_ids` | Streaming CDC events (when present) | Comma-separated affected record IDs |
| `event_uuid` | Standard Platform Events only (when present) | Salesforce `EventUuid` (dedup key); absent on custom `__e` events |

**Snapshot rows** (`operation: read`) carry exactly `sobject` and `operation` — they have no `topic`, `replay_id`, `record_ids`, or `event_uuid`.

Example snapshot payload (operation=read):

```json
{
  "Id": "001Dp000008KFIXIA4",
  "Name": "Acme Corp",
  "BillingCity": "San Francisco",
  "CreatedDate": "2024-01-15T10:30:00.000+0000"
}
```

Example CDC event payload (operation=create):

```json
{
  "ChangeEventHeader": {
    "entityName": "Account",
    "recordIds": ["001Dp000008KFIXIA4"],
    "changeType": "CREATE",
    "changeOrigin": "com/salesforce/api/rest/65.0"
  },
  "Name": "Acme Corp",
  "BillingCity": "San Francisco"
}
```

## Topic Syntax

The `topics` list accepts four forms. Each entry maps to exactly one gRPC Pub/Sub subscription with its own independent replay cursor:

| Form | Example | Resolves to |
|---|---|---|
| Bare sObject name | `Account` | `/data/AccountChangeEvent` |
| Explicit CDC channel | `/data/AccountChangeEvent` | `/data/AccountChangeEvent` |
| CDC firehose | `/data/ChangeEvents` | All CDC-enabled sObjects |
| Custom Platform Event | `/event/Order__e` | `/event/Order__e` |
| Standard Platform Event | `/event/LoginEventStream` | `/event/LoginEventStream` |

The firehose (`/data/ChangeEvents`) and per-sObject channels are mutually exclusive — do not mix them. Platform Event topics are always skipped during the REST snapshot phase (no REST equivalent exists).

## Snapshot + Stream Lifecycle

When `stream_snapshot: true`:

1. The connector opens the checkpoint cache and checks for a persisted `snapshot_complete` flag.
2. If not complete, it pages through all sObjects in `topics` via the Salesforce REST Query API, emitting rows with `operation: read`.
3. Snapshot cursor is checkpointed after each page — restarts resume mid-snapshot.
4. When all pages are exhausted, `snapshot_complete: true` is written to the cache.
5. The gRPC Pub/Sub subscriptions are then opened (one per topic) and stream live events.

Platform Event topics are always skipped in the snapshot phase. The firehose (`/data/ChangeEvents`) triggers snapshotting of all queryable sObjects.

## Checkpoint Cache and Restart Semantics

The connector persists a JSON document to the cache under `checkpoint_cache_key` (default `salesforce_cdc`):

```json
{
  "snapshot_complete": true,
  "rest_cursor": {},
  "topics": {
    "/data/AccountChangeEvent": "<hex-replay-id>",
    "/data/ContactChangeEvent": "<hex-replay-id>"
  }
}
```

On restart:
- If `snapshot_complete` is `false` and a `rest_cursor` is present, the snapshot resumes mid-page.
- Each topic's `replay_id` is used to resume that subscription from the exact event where it left off.
- If a `replay_id` is rejected by Salesforce (gRPC `INVALID_ARGUMENT` — stale beyond retention), it is cleared from state and the subscription restarts using `replay_preset`.

Use a **durable** cache backend (Redis, PostgreSQL, DynamoDB) for production. An in-memory cache loses all state on restart.

## Operational Notes

- **Event retention**: Standard retention is 24 hours; Enhanced Event Retention (Salesforce add-on) extends to 72 hours. After the retention window, replaying from `replay_preset: earliest` starts at the oldest available event.
- **API quota**: The REST snapshot uses Salesforce API call quota. Each page of `snapshot_max_batch_size` records is one API call. Large orgs with many records can consume significant quota during the initial snapshot.
- **Connected App permissions**: The Run-As user must have read access to all sObjects being captured and Pub/Sub API access (requires API-enabled profile or permission set).
- **License errors**: `salesforce_cdc` is an Enterprise-gated component. A startup error stating "this feature requires a valid Redpanda Enterprise Edition license that includes the Connect product" means the binary is not licensed. See [https://docs.redpanda.com/redpanda-connect/get-started/licensing/](https://docs.redpanda.com/redpanda-connect/get-started/licensing/) to obtain and configure an Enterprise license.
- **Stale replay recovery**: When `replay_id` is rejected (event outside retention window), the connector automatically clears the stale ID and reconnects using `replay_preset`. Log line: `topic /data/... replay_id rejected; clearing and reconnecting via configured preset`.
- **Multiple pipelines**: Run multiple `salesforce_cdc` inputs against the same cache by setting a distinct `checkpoint_cache_key` per input.

## Enterprise Features (License Required)

The `salesforce_cdc` input is a **Redpanda Connect enterprise connector** — it requires a valid
Enterprise license that includes the Connect product. Beyond the connector, the Redpanda topics that
receive the CDC stream can use broker-side enterprise features that require a Redpanda Enterprise
license on the destination cluster:

- **Iceberg Topics** — materialize the CDC topic as an Apache Iceberg table for analytics
  (`redpanda.iceberg.mode` = `key_value` | `value_schema_id_prefix` | `value_schema_latest`;
  plus `redpanda.iceberg.delete`, `redpanda.iceberg.invalid.record.action`,
  `redpanda.iceberg.partition.spec`, `redpanda.iceberg.target.lag.ms`). Requires
  `iceberg_enabled=true` and Tiered Storage on the topic.
- **Tiered Storage** — long-term retention of the change stream past Salesforce's 24h/72h window
  (`cloud_storage_enabled` cluster-wide; `redpanda.remote.write` + `redpanda.remote.read` per topic;
  `retention.local.target.ms`/`.bytes`).
- **Cloud Topics** — object-storage-native ("diskless") destination topics for cost-sensitive CDC
  retention (`cloud_topics_enabled=true` cluster-wide, requires restart; create the topic with
  `redpanda.storage.mode=cloud`, or `default_redpanda_storage_mode=cloud` to make it the cluster
  default). Cloud Topic mode can be set only at topic creation time.
- **Server-side Schema ID Validation** — enforce registered schemas on the CDC topic
  (`enable_schema_id_validation` = `redpanda`|`compat`; `redpanda.value.schema.id.validation`,
  `redpanda.value.subject.name.strategy`).
- **RBAC, Audit Logging, OIDC/OAUTHBEARER, Kerberos (GSSAPI), FIPS, Shadowing** — cluster-wide
  controls that govern who can produce to and operate the CDC topics.

Check license status with `rpk cluster license info`. See
[redpanda-enterprise-sink.md](references/redpanda-enterprise-sink.md) for exact config keys,
defaults, enable/disable commands, and license-expiry behavior.

## Reference Directory

- [config-reference.md](references/config-reference.md): Every `salesforce_cdc` config field — type, default, required status, and description grounded in source.
- [setup-salesforce.md](references/setup-salesforce.md): Creating a Salesforce Connected App, enabling Change Data Capture for sObjects, defining Platform Events, Pub/Sub API access, and the replay-ID/retention model.
- [pipeline-and-output.md](references/pipeline-and-output.md): Full runnable pipelines (CDC, firehose, Platform Events, mixed), the message/metadata shape, per-sObject topic routing, snapshot+stream behavior, and resume semantics.
- [redpanda-enterprise-sink.md](references/redpanda-enterprise-sink.md): Redpanda Enterprise features for the destination CDC topics — the connector's own Connect license requirement, Iceberg Topics (`redpanda.iceberg.*`), Tiered Storage (`redpanda.remote.read/write`, retention), Cloud Topics (`cloud_topics_enabled`, `redpanda.storage.mode=cloud`), Server-side Schema ID Validation, and pointers to RBAC, Audit Logging, OIDC/Kerberos, FIPS, and Shadowing, with exact config keys, defaults, enable/disable commands, and license-expiry behavior.
