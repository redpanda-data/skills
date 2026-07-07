---
name: connect-cdc-tigerbeetle
description: >-
  Guides setup and operation of the tigerbeetle_cdc Redpanda Connect input for
  streaming change data capture from a TigerBeetle financial transactions
  database into Redpanda or Kafka. Covers the cgo-enabled binary requirement,
  connecting to a TigerBeetle cluster (cluster_id, replica addresses), the
  progress_cache checkpointing model, resuming from a timestamp
  (timestamp_initial), the JSON change-event shape (transfer + debit/credit
  account snapshots), and per-event-type or per-ledger routing. Use when:
  capturing TigerBeetle ledger events (transfers, account updates) into
  Redpanda or Kafka, configuring tigerbeetle_cdc, choosing a persistent
  progress cache, filtering settled vs pending two-phase transfers with the
  event_type metadata, routing by ledger, archiving transfer events to S3,
  troubleshooting "component not available" (cgo builds) or duplicate events
  after restart, or asking whether tigerbeetle_cdc needs an Enterprise license
  (it does not — it is a certified community connector, unlike the other CDC
  inputs). Also covers the Redpanda Enterprise features the CDC
  destination topic and cluster can use: Iceberg Topics
  (redpanda.iceberg.mode/delete/partition.spec/target.lag.ms/
  invalid.record.action), Tiered Storage (redpanda.remote.read/write) for
  long-term ledger-event retention, Remote Read Replicas, Shadow Linking (rpk
  shadow cross-cluster DR), server-side Schema ID Validation, RBAC, Audit
  Logging, and OIDC/Kerberos auth on the landed topic.
---

# Redpanda Connect CDC: TigerBeetle

The `tigerbeetle_cdc` input streams change events from a [TigerBeetle](https://docs.tigerbeetle.com/operating/cdc/) cluster — the purpose-built financial transactions database — into Redpanda or any Kafka-compatible broker. Every event is a JSON snapshot of a transfer plus its debit and credit accounts at the time of the event. Progress is checkpointed as the last acknowledged event timestamp in a Connect [cache resource](references/config-reference.md#progress_cache), so the pipeline resumes where it left off after a restart. Available in the docs from Redpanda Connect v4.65.0, currently marked **beta** (API subject to change). Unlike every other CDC input, this is a **certified** (community-tier) connector, not an enterprise one: `internal/plugins/info.csv` marks it `certified`, the source carries an Apache-2.0 license header, and there is no runtime Enterprise license check.

Two constraints set this connector apart from the other CDC inputs:

- **cgo-only builds.** The component is compiled only into cgo-enabled builds of Redpanda Connect. It is **not** available in the `rpk connect` CLI or the standard Docker image — download the prebuilt cgo-enabled binary (Linux AMD64 only) or build from source with cgo enabled.
- **No snapshot mode.** There is no separate initial-snapshot phase: by default the connector streams **all CDC events available in the TigerBeetle cluster** from the beginning, or from `timestamp_initial` if set. Each event already embeds the full current state of the transfer and both accounts.

## Quickstart

### 1. Get a cgo-enabled Redpanda Connect binary

```bash
# Prebuilt cgo binary (Linux AMD64) — note the -cgo archive name
wget https://github.com/redpanda-data/redpanda-connect/releases/download/v<VERSION>/redpanda-connect-cgo_<VERSION>_linux_amd64.tar.gz
tar -xzf redpanda-connect-cgo_<VERSION>_linux_amd64.tar.gz
sudo mv redpanda-connect /usr/local/bin/
redpanda-connect --version
```

Requires a TigerBeetle cluster version 0.16.57 or later, and the Connect TigerBeetle client version must not be newer than the cluster version.

### 2. Create the pipeline config

The input requires a cache resource (`progress_cache`) to store the last acknowledged event timestamp. Use a persistent cache (Redis, `aws_dynamodb`, `sql`) in production — with an in-memory cache, every restart re-streams from the beginning.

```yaml
# pipeline.yaml — stream all TigerBeetle change events to Redpanda
input:
  tigerbeetle_cdc:
    cluster_id: "1"                  # 128-bit cluster ID as a decimal string
    addresses:                       # one entry per replica, in replica order
      - "192.168.1.10:3000"
      - "192.168.1.11:3000"
      - "192.168.1.12:3000"
    progress_cache: redis_cache      # cache resource label (must exist)

output:
  redpanda:
    seed_brokers: ["localhost:9092"]
    topic: 'transfers.${! meta("ledger") }'
    key: ${! json("transfer.id") }

cache_resources:
  - label: redis_cache
    redis:
      url: redis://localhost:6379
```

### 3. Run it

```bash
redpanda-connect run pipeline.yaml
```

### 4. Inspect messages

Each message body is a JSON object with the event timestamp, event type, ledger, and full snapshots of the transfer and both accounts. 128-bit and 64-bit numeric fields are serialized as decimal **strings**; 32-bit and 16-bit fields are JSON numbers:

```json
{
  "timestamp": "1745328372758695656",
  "type": "single_phase",
  "ledger": 2,
  "transfer": {
    "id": "9082709",
    "amount": "3794",
    "pending_id": "0",
    "user_data_128": "79248595801719937611592367840129079151",
    "user_data_64": "13615171707598273871",
    "user_data_32": 3229992513,
    "timeout": 0,
    "code": 20295,
    "flags": 0,
    "timestamp": "1745328372758695656"
  },
  "debit_account": {
    "id": "3750",
    "debits_pending": "0",
    "debits_posted": "8463768",
    "credits_pending": "0",
    "credits_posted": "8861179",
    "user_data_128": "118966247877720884212341541320399553321",
    "user_data_64": "526432537153007844",
    "user_data_32": 4157247332,
    "code": 1,
    "flags": 0,
    "timestamp": "1745328270103398016"
  },
  "credit_account": { "...": "same shape as debit_account" }
}
```

Every message carries these metadata fields (all values are strings):

| Metadata key | Value |
|---|---|
| `event_type` | `single_phase`, `two_phase_pending`, `two_phase_posted`, `two_phase_voided`, or `two_phase_expired` |
| `ledger` | The ledger code |
| `transfer_code` | The transfer code |
| `debit_account_code` | The debit account code |
| `credit_account_code` | The credit account code |
| `timestamp` | Unique event timestamp, nanosecond resolution |
| `timestamp_ms` | Event timestamp, millisecond resolution |

## Progress and Resume Semantics

- **Checkpoint:** after each batch is acknowledged, the connector writes the last event timestamp to `progress_cache` under the key `timestamp_last_<cluster_id>`. On restart it resumes from the next event.
- **`timestamp_initial`:** a TigerBeetle nanosecond timestamp to start from (inclusive). Ignored if the cache already holds a more recent acknowledged timestamp. Unset = stream everything available in the cluster.
- **Ordering:** events are delivered strictly in order — the connector holds the next batch until the current one is acknowledged.
- **Delivery:** at-least-once. During crash recovery, unacknowledged messages may be replayed; consumers must be idempotent. The nanosecond `timestamp` metadata is unique per event and suitable for deduplication.

## Event Types and Filtering

TigerBeetle transfers are either single-phase (settled immediately) or two-phase (pending, then posted/voided/expired). Keep only settled transfers:

```yaml
pipeline:
  processors:
    - mapping: |
        root = if meta("event_type") != "single_phase" && meta("event_type") != "two_phase_posted" {
          deleted()
        }
```

## Per-Event-Type Routing

```yaml
output:
  switch:
    cases:
      - check: meta("event_type") == "single_phase"
        output:
          redpanda:
            seed_brokers: ["localhost:9092"]
            topic: tigerbeetle.single_phase
      - check: meta("event_type") == "two_phase_posted"
        output:
          redpanda:
            seed_brokers: ["localhost:9092"]
            topic: tigerbeetle.two_phase
      - output:
          drop: {}
```

## Operational Notes

- **Component not available:** if `tigerbeetle_cdc` is not recognized, you are running a non-cgo build (`rpk connect` or the standard Docker image). Switch to the cgo-enabled binary.
- **Persistent cache:** the progress cache is the only durable state. Losing it re-streams all available events (safe but duplicative under at-least-once).
- **Throughput/pacing:** `event_count_max` (default 2730) caps events per request; `idle_interval_ms` (default 1000) is the wait when a poll returns nothing; an optional `rate_limit` resource throttles requests; `timeout_seconds` (default 15) bounds each query.
- **Version:** verify field names and defaults against the generated reference (`modules/components/partials/fields/inputs/tigerbeetle_cdc.adoc` in rp-connect-docs) or `redpanda-connect create tigerbeetle_cdc` on a cgo-enabled binary — not `rpk connect create`, which lacks the component.
- **Support tier / license:** `certified` in `internal/plugins/info.csv` — the only CDC input that is not `enterprise` there. Apache-2.0 source, no enterprise license check. Status is beta — the API may change.
- **Redpanda Cloud:** `info.csv` marks the component `cloud: n` ("not yet certified for cloud") — it cannot run as a Redpanda Cloud managed pipeline. Run the self-hosted cgo binary and write to your Cloud cluster over TLS/SASL.

## Enterprise Features on the Destination Topic

The `tigerbeetle_cdc` input is a certified community connector — no Enterprise license is needed for the input itself — but the Redpanda topic and cluster the ledger events land in can use Redpanda Enterprise differentiators (each requires a valid Redpanda Enterprise license on the destination cluster):

- **Iceberg Topics** — land transfer events directly into an Apache Iceberg table for analytics. Per-topic: `redpanda.iceberg.mode` (`key_value` | `value_schema_id_prefix` | `value_schema_latest` | `disabled`), `redpanda.iceberg.delete`, `redpanda.iceberg.partition.spec`, `redpanda.iceberg.target.lag.ms`, `redpanda.iceberg.invalid.record.action` (`drop` | `dlq_table`); cluster: `iceberg_enabled`.
- **Tiered Storage** — `redpanda.remote.write` + `redpanda.remote.read` (cluster `cloud_storage_enabled`) give the ledger-event topic effectively unlimited retention for audit and compliance.
- **Remote Read Replicas** — `redpanda.remote.readreplica` for read-only, object-storage-served copies of the CDC topic in a remote cluster.
- **Shadow Linking / Shadowing** — offset-preserving cross-cluster DR for the CDC topic, managed with the `rpk shadow` family (`create`/`list`/`describe`/`status`/`update`/`failover`/`delete`/`config-generate`).
- **Server-side Schema ID Validation** — `redpanda.value.schema.id.validation` + `redpanda.value.subject.name.strategy` (cluster `enable_schema_id_validation` = `none`/`redpanda`/`compat`).
- **RBAC, Audit Logging, OIDC/Kerberos, FIPS** — secure the CDC topic and pipeline; audit logging is a natural fit for financial event streams.
- **Redpanda Connect Enterprise** (separate Connect license) — secrets management, configuration service, allow/deny lists.

See [Enterprise Redpanda Features](references/enterprise-redpanda-features.md) for grounded nested config keys, defaults, license-expiration behavior, and `rpk` commands.

## Reference Directory

- [Config Reference](references/config-reference.md): Every `tigerbeetle_cdc` config field with type, default, and validation rule, grounded in source.
- [TigerBeetle Setup](references/setup-tigerbeetle.md): cgo-enabled binary acquisition, TigerBeetle version requirements, cluster connection parameters, and progress-cache selection.
- [Pipeline and Output](references/pipeline-and-output.md): Full runnable pipelines, message/metadata shape, event-type semantics, routing patterns (Redpanda, S3), resume-from-timestamp, and restart behavior.
- [Enterprise Redpanda Features](references/enterprise-redpanda-features.md): Iceberg Topics, Tiered Storage, Remote Read Replicas, Shadow Linking (cross-cluster DR), server-side Schema ID Validation, RBAC/Audit Logging/OIDC/Kerberos/FIPS, and Redpanda Connect Enterprise — nested config keys, defaults, and which license gates each.
