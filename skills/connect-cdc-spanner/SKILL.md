---
name: connect-cdc-spanner
description: >-
  Streams change data capture (CDC) from Google Cloud Spanner into Redpanda or
  Kafka using Redpanda Connect's gcp_spanner_cdc input — Spanner change streams,
  partition-aware watermarked delivery, and metadata persistence. Use when:
  capturing INSERT/UPDATE/DELETE changes from a Google Cloud Spanner database
  into Redpanda or Kafka; configuring the gcp_spanner_cdc input; creating a
  Spanner change stream with CREATE CHANGE STREAM; setting up GCP service-account
  credentials or Application Default Credentials for the connector; configuring
  project_id, instance_id, database_id, and stream_id; using start_timestamp or
  end_timestamp to bound the stream window; understanding the metadata_table the
  connector creates in Spanner for partition watermarking; filtering mod types
  with allowed_mod_types (INSERT, UPDATE, DELETE); tuning heartbeat_interval or
  min_watermark_cache_ttl; understanding the message payload (Mod JSON with keys,
  new_values, old_values) and message metadata (table_name, mod_type,
  commit_timestamp, record_sequence, server_transaction_id, transaction_tag);
  using the batching policy for throughput tuning; the Enterprise license
  requirement for this connector; routing per-table CDC events to separate Kafka
  topics with Bloblang; or landing CDC history into Redpanda Enterprise
  destination features — Iceberg Topics (redpanda.iceberg.mode/delete/
  target.lag.ms/partition.spec/invalid.record.action), Tiered Storage
  (redpanda.remote.write/read, cloud_storage_enabled), Cloud Topics
  (redpanda.cloud_topic.enabled / redpanda.storage.mode=cloud,
  cloud_topics_enabled), Remote Read Replicas
  (redpanda.remote.readreplica), Shadowing for cross-cluster disaster recovery
  (rpk shadow), and the Redpanda Connect enterprise capabilities (secrets
  management, the redpanda config-service block, allow/deny lists, FIPS, plus
  RBAC, OIDC/OAUTHBEARER, Kerberos, Audit Logging, and server-side Schema ID
  Validation on the destination cluster). All of these require a Redpanda
  Enterprise license.
---

# Redpanda Connect CDC: Google Cloud Spanner

The `gcp_spanner_cdc` input in Redpanda Connect streams change data capture (CDC) from a Google Cloud Spanner database into Redpanda or any Kafka-compatible topic. It uses Spanner's native change stream API, tracks multiple concurrent partitions, persists watermark state in a Spanner metadata table, and delivers each row mutation as a JSON message with rich metadata.

Introduced in version **4.56.0**. This is an **Enterprise feature** — a Redpanda Enterprise license is required.

The connector supports both **GoogleSQL** and **PostgreSQL** Spanner dialects. It automatically detects the dialect and creates the metadata table in the same database if it does not already exist. Partitions split and merge over time as Spanner scales; the connector handles all partition lifecycle events transparently.

## Quickstart

### 1. Create the Spanner change stream (one DDL statement)

```sql
-- Track all tables in the database:
CREATE CHANGE STREAM AllChanges FOR ALL;

-- Or track specific tables:
CREATE CHANGE STREAM OrderChanges FOR orders, customers;

-- Spanner default is OLD_AND_NEW_VALUES; opt into NEW_VALUES to drop old values:
CREATE CHANGE STREAM OrderChanges FOR orders, customers
  OPTIONS (value_capture_type = 'NEW_VALUES');
```

### 2. Create a GCP service account and grant it the required IAM roles

The connector issues a `CREATE TABLE IF NOT EXISTS` DDL statement on **every
startup** to create or validate the partition metadata table. This means the
service account must retain DDL permission (`spanner.databases.updateDdl`)
permanently — not just on first run.

```bash
# Create a service account
gcloud iam service-accounts create redpanda-spanner-cdc \
  --display-name="Redpanda Spanner CDC"

PROJECT=MY_PROJECT
SA=redpanda-spanner-cdc@${PROJECT}.iam.gserviceaccount.com

# Grant Spanner Database Reader (read data and change streams)
gcloud spanner databases add-iam-policy-binding my-database \
  --instance=my-spanner-instance \
  --project=${PROJECT} \
  --member="serviceAccount:${SA}" \
  --role="roles/spanner.databaseReader"

# Grant DDL permission — required on every startup for metadata table setup
gcloud spanner databases add-iam-policy-binding my-database \
  --instance=my-spanner-instance \
  --project=${PROJECT} \
  --member="serviceAccount:${SA}" \
  --role="roles/spanner.databaseAdmin"

# Download the JSON key file and base64-encode it for credentials_json
gcloud iam service-accounts keys create spanner-cdc-key.json \
  --iam-account=${SA}

export SPANNER_CDC_CREDENTIALS=$(base64 < spanner-cdc-key.json)
```

### 3. Full pipeline YAML

```yaml
# spanner-cdc-pipeline.yaml
input:
  label: "spanner_cdc"
  gcp_spanner_cdc:
    # Base64-encoded service account JSON, or leave empty to use ADC
    credentials_json: "${SPANNER_CDC_CREDENTIALS}"
    project_id: "my-gcp-project"
    instance_id: "my-spanner-instance"
    database_id: "my-database"
    stream_id: "OrderChanges"
    # Optional: start from a specific point in time (RFC3339)
    # start_timestamp: "2025-01-01T00:00:00Z"
    # Optional: stop at a specific time (RFC3339, exclusive)
    # end_timestamp: "2025-12-31T23:59:59Z"
    heartbeat_interval: 10s
    # metadata_table defaults to: cdc_metadata_OrderChanges
    # allowed_mod_types filters to only these operations:
    allowed_mod_types:
      - INSERT
      - UPDATE
      - DELETE
    batching:
      count: 100
      period: 1s

output:
  kafka_franz:
    seed_brokers:
      - "localhost:9092"
    topic: '${! meta("table_name") }'
    compression: snappy
```

### 4. Run the pipeline

```bash
# Assuming redpanda-connect binary is in PATH (Enterprise build)
redpanda-connect run spanner-cdc-pipeline.yaml

# Or with rpk (Redpanda enterprise)
rpk connect run spanner-cdc-pipeline.yaml
```

### 5. Inspect a message

Each emitted message payload is a JSON-serialized `Mod` object:

```json
{
  "keys":       { "SingerId": "1" },
  "new_values": { "FirstName": "Alice", "LastName": "Smith" },
  "old_values": {}
}
```

Message metadata keys available via `meta("...")`:

| Key | Description |
|-----|-------------|
| `table_name` | The Spanner table that was mutated |
| `mod_type` | `INSERT`, `UPDATE`, or `DELETE` |
| `commit_timestamp` | Spanner commit timestamp (`time.Time`); format to a string (e.g. `.string()`) before writing to a Kafka header |
| `record_sequence` | Sequence within the transaction and partition |
| `server_transaction_id` | Groups all records from the same transaction |
| `is_last_record_in_transaction_in_partition` | Boolean |
| `value_capture_type` | e.g. `NEW_VALUES` or `OLD_AND_NEW_VALUES` |
| `number_of_records_in_transaction` | Total records in this transaction |
| `number_of_partitions_in_transaction` | Partitions touched by this transaction |
| `transaction_tag` | Application-defined tag on the Spanner transaction |
| `is_system_transaction` | Boolean — true for Spanner internal transactions |

## How It Works

The connector uses the Spanner Change Stream API, which divides the stream into **partitions** — each covering an immutable key range for a specific time window. The connector:

1. Creates a metadata table in the same Spanner database (default name: `cdc_metadata_<stream_id>`) to track partition state (CREATED → SCHEDULED → RUNNING → FINISHED) and per-partition watermarks.
2. Discovers root partitions at startup (or on resume).
3. Queries each partition concurrently for change records.
4. When a partition splits or merges, the connector automatically detects and schedules child partitions.
5. Watermarks are updated after each message is acknowledged downstream.
6. On restart, interrupted (SCHEDULED or RUNNING) partitions are resumed from their last watermark.

## Reference Directory

- [Config Reference](references/config-reference.md): Every `gcp_spanner_cdc` field with type, default, and description — grounded in the source.
- [Setup Spanner](references/setup-spanner.md): Creating the change stream, IAM permissions, metadata table details, dialects, and retention notes.
- [Pipeline and Output](references/pipeline-and-output.md): Full pipeline YAML examples, the message payload and metadata shape, per-table routing with Bloblang, landing CDC into an Iceberg topic, and restart/resume behavior.
- [Enterprise Features](references/enterprise-features.md): Redpanda enterprise differentiators for Spanner CDC — the connector's Enterprise license gating; Iceberg Topics (`redpanda.iceberg.mode/delete/invalid.record.action/partition.spec/target.lag.ms`); Tiered Storage (`redpanda.remote.write/read`, `cloud_storage_enabled`); Cloud Topics (`redpanda.cloud_topic.enabled` / `redpanda.storage.mode=cloud`, `cloud_topics_enabled`); Remote Read Replicas (`redpanda.remote.readreplica`); Shadowing DR (`rpk shadow`); the Connect `redpanda` config-service block, secrets management, allow/deny lists, FIPS; and destination-cluster security (RBAC, OIDC/OAUTHBEARER, Kerberos, Audit Logging, Schema ID Validation). All require an Enterprise license.
