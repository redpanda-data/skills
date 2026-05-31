---
name: connect-cdc-dynamodb
description: >-
  Guides setup and operation of the aws_dynamodb_cdc Redpanda Connect input
  for streaming change data capture from AWS DynamoDB into Redpanda or Kafka
  using DynamoDB Streams. Covers enabling DynamoDB Streams, IAM policy setup,
  checkpointing, snapshot modes, multi-table discovery, and the full pipeline
  YAML. Use when: capturing INSERT/MODIFY/REMOVE changes from DynamoDB into
  Redpanda or Kafka, configuring aws_dynamodb_cdc, enabling DynamoDB Streams,
  setting up the checkpoint table, using snapshot_and_cdc or snapshot_only,
  auto-discovering tables by tag, routing DynamoDB CDC events per table,
  troubleshooting DynamoDB stream retention or shard handling. Also covers the
  Redpanda Enterprise features the CDC destination topic and cluster can use:
  Iceberg Topics (redpanda.iceberg.mode/delete/partition.spec/target.lag.ms/
  invalid.record.action), Tiered Storage (redpanda.remote.read/write) to outlive
  the 24h stream window, Remote Read Replicas, Shadow Linking (rpk shadow
  cross-cluster DR), server-side Schema ID Validation, RBAC, Audit Logging,
  and OIDC/Kerberos auth on the landed topic.
---

# Redpanda Connect CDC: AWS DynamoDB

The `aws_dynamodb_cdc` input reads change events from DynamoDB Streams into Redpanda or any Kafka-compatible broker. It manages shard lifecycle automatically, writes checkpoints to a dedicated DynamoDB table, and supports an optional initial Scan snapshot before switching to streaming. Available from Redpanda Connect v4.79.0 with status Stable. Its source code is distributed under the Redpanda Community License; no runtime Enterprise license is required or enforced.

Three table-discovery modes cover single-table, explicit-list, and tag-based multi-table scenarios. The 24-hour DynamoDB Streams retention window is the key operational constraint: the connector must remain running or resume within that window or it re-runs a snapshot to avoid data loss.

## Quickstart

### 1. Enable DynamoDB Streams on your table

```bash
# Enable NEW_AND_OLD_IMAGES stream on an existing table
aws dynamodb update-table \
  --table-name orders \
  --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES

# Verify
aws dynamodb describe-table --table-name orders \
  --query "Table.StreamSpecification"
```

### 2. Create the IAM policy

```bash
# Save as dynamodb-cdc-policy.json (replace REGION, ACCOUNT_ID, TABLE_NAME)
cat > dynamodb-cdc-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DynamoDBStreams",
      "Effect": "Allow",
      "Action": [
        "dynamodb:DescribeStream",
        "dynamodb:GetRecords",
        "dynamodb:GetShardIterator"
      ],
      "Resource": "arn:aws:dynamodb:REGION:ACCOUNT_ID:table/orders/stream/*"
    },
    {
      "Sid": "DescribeSourceTable",
      "Effect": "Allow",
      "Action": ["dynamodb:DescribeTable"],
      "Resource": "arn:aws:dynamodb:REGION:ACCOUNT_ID:table/orders"
    },
    {
      "Sid": "SnapshotScan",
      "Effect": "Allow",
      "Action": ["dynamodb:Scan"],
      "Resource": "arn:aws:dynamodb:REGION:ACCOUNT_ID:table/orders"
    },
    {
      "Sid": "CheckpointTable",
      "Effect": "Allow",
      "Action": [
        "dynamodb:CreateTable",
        "dynamodb:DescribeTable",
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:Query"
      ],
      "Resource": "arn:aws:dynamodb:REGION:ACCOUNT_ID:table/redpanda_dynamodb_checkpoints"
    },
    {
      "Sid": "TagDiscovery",
      "Effect": "Allow",
      "Action": ["dynamodb:ListTables", "dynamodb:ListTagsOfResource"],
      "Resource": "*"
    }
  ]
}
EOF

aws iam create-policy \
  --policy-name redpanda-dynamodb-cdc \
  --policy-document file://dynamodb-cdc-policy.json
```

### 3. Create the pipeline config

```yaml
# pipeline.yaml — snapshot existing data then stream changes
input:
  aws_dynamodb_cdc:
    tables: [orders]
    start_from: trim_horizon
    snapshot_mode: snapshot_and_cdc
    snapshot_segments: 4
    snapshot_throttle: 100ms
    snapshot_deduplicate: true
    checkpoint_table: redpanda_dynamodb_checkpoints
    region: us-east-1

output:
  kafka_franz:
    seed_brokers: ["localhost:9092"]
    topic: '${! meta("dynamodb_table") }-cdc'
```

### 4. Run it

```bash
# With environment credentials (IAM role / ~/.aws/credentials):
rpk connect run pipeline.yaml

# With explicit static credentials:
rpk connect run pipeline.yaml \
  -s "input.aws_dynamodb_cdc.credentials.id=${AWS_ACCESS_KEY_ID}" \
  -s "input.aws_dynamodb_cdc.credentials.secret=${AWS_SECRET_ACCESS_KEY}"
```

### 5. Inspect messages

Each message body is a JSON object with this shape. For an INSERT event the `oldImage` key is absent (not null); for a REMOVE event the `newImage` key is absent. The keys `keys`, `newImage`, `oldImage`, and `sizeBytes` are only present when the corresponding field is non-nil in the stream record:

```json
{
  "tableName": "orders",
  "eventID": "abc123",
  "eventName": "INSERT",
  "eventVersion": "1.1",
  "eventSource": "aws:dynamodb",
  "awsRegion": "us-east-1",
  "dynamodb": {
    "sequenceNumber": "000000000000000000001",
    "streamViewType": "NEW_AND_OLD_IMAGES",
    "keys": { "orderId": "ORD-001" },
    "newImage": { "orderId": "ORD-001", "status": "pending", "total": 99.99 },
    "sizeBytes": 128
  }
}
```

Snapshot records use `"eventName": "READ"` and include only `newImage`. Metadata fields differ between CDC and snapshot records:

| Metadata key | CDC records | Snapshot records |
|---|---|---|
| `dynamodb_event_name` | `INSERT`, `MODIFY`, or `REMOVE` | `READ` |
| `dynamodb_table` | table name | table name |
| `dynamodb_shard_id` | shard ID string | _not present_ |
| `dynamodb_sequence_number` | stream sequence number | _not present_ |
| `dynamodb_snapshot_segment` | _not present_ | segment index (e.g. `"0"`) |

Note: `dynamodb_shard_id` and `dynamodb_sequence_number` are absent on snapshot records — not empty strings. Checking `meta("dynamodb_shard_id")` on a snapshot record returns a missing-key error in Bloblang.

## Snapshot Modes

| Mode | Behavior |
|---|---|
| `none` (default) | CDC streaming only, from existing stream position |
| `snapshot_only` | One-time full Scan, then stops |
| `snapshot_and_cdc` | Full Scan first, then streams ongoing changes |

`snapshot_and_cdc` starts CDC shard readers _before_ the Scan begins so no writes during the snapshot window are missed. Use `snapshot_deduplicate: true` (default) to suppress records that appear in both.

## Multi-Table Discovery

```yaml
# By explicit list
input:
  aws_dynamodb_cdc:
    table_discovery_mode: includelist
    tables: [orders, customers, products]
    region: us-east-1

---
# By tag — auto-discover all tables tagged stream-enabled:true
input:
  aws_dynamodb_cdc:
    table_discovery_mode: tag
    table_tag_filter: "stream-enabled:true"
    table_discovery_interval: 5m
    region: us-east-1

---
# Multi-criteria tag filter (AND across keys, OR within a key)
input:
  aws_dynamodb_cdc:
    table_discovery_mode: tag
    table_tag_filter: "environment:prod,staging;team:data,analytics"
    region: us-east-1
```

Snapshot modes are supported only when the effective configuration is single-table at config-validation time: `table_discovery_mode: single`, or `table_discovery_mode: includelist` with exactly one table. `tag` discovery mode always rejects `snapshot_mode` other than `none` at startup, even if the tag filter would match only one table — it is treated as multi-table regardless.

## Per-Table Routing

Use a Bloblang mapping or `switch` output to route each table's events to a dedicated topic:

```yaml
output:
  switch:
    cases:
      - check: 'meta("dynamodb_table") == "orders"'
        output:
          kafka_franz:
            seed_brokers: ["localhost:9092"]
            topic: orders-cdc
      - check: 'meta("dynamodb_table") == "customers"'
        output:
          kafka_franz:
            seed_brokers: ["localhost:9092"]
            topic: customers-cdc
```

## Operational Notes

- **Stream retention:** DynamoDB Streams retain records for 24 hours. If the connector is down longer than that, it re-runs a snapshot on next start (in `snapshot_and_cdc` mode).
- **Checkpoint table:** Created automatically with pay-per-request billing. Uses `(StreamArn, ShardID)` as the primary key.
- **Kinesis alternative:** For up to 1-year retention, enable Kinesis Data Streams for DynamoDB and use the `aws_kinesis` input instead.
- **License:** The component source is distributed under the Redpanda Community License. No runtime Enterprise license is required or enforced; the component is registered as Stable with no license gate.

## Enterprise Features on the Destination Topic

The `aws_dynamodb_cdc` input is Community-licensed, but the Redpanda topic and cluster the CDC events land in can use Redpanda Enterprise differentiators (each requires a valid Redpanda Enterprise license on the destination cluster):

- **Iceberg Topics** — land CDC events directly into an Apache Iceberg table for analytics. Per-topic: `redpanda.iceberg.mode` (`key_value` | `value_schema_id_prefix` | `value_schema_latest` | `disabled`), `redpanda.iceberg.delete`, `redpanda.iceberg.partition.spec`, `redpanda.iceberg.target.lag.ms`, `redpanda.iceberg.invalid.record.action` (`drop` | `dlq_table`); cluster: `iceberg_enabled`.
- **Tiered Storage** — `redpanda.remote.write` + `redpanda.remote.read` (cluster `cloud_storage_enabled`) extend CDC retention far beyond DynamoDB Streams' 24h window.
- **Remote Read Replicas** — `redpanda.remote.readreplica` for read-only, object-storage-served copies of the CDC topic in a remote cluster.
- **Shadow Linking / Shadowing** — offset-preserving cross-cluster DR for the CDC topic, managed with the `rpk shadow` family (`create`/`list`/`describe`/`status`/`update`/`failover`/`delete`/`config-generate`). Failover preserves consumer offsets on the DR cluster.
- **Server-side Schema ID Validation** — `redpanda.value.schema.id.validation` + `redpanda.value.subject.name.strategy` (cluster `enable_schema_id_validation` = `none`/`redpanda`/`compat`).
- **RBAC, Audit Logging, OIDC/Kerberos, FIPS** — secure the CDC topic and pipeline.
- **Redpanda Connect Enterprise** (separate Connect license) — secrets management, configuration service, allow/deny lists.

See [Enterprise Redpanda Features](references/enterprise-redpanda-features.md) for grounded nested config keys, defaults, license-expiration behavior, and `rpk` commands.

## Reference Directory

- [Config Reference](references/config-reference.md): Every `aws_dynamodb_cdc` config field with type, default, and description, grounded in source.
- [DynamoDB Setup](references/setup-dynamodb.md): Enabling DynamoDB Streams, stream view types, checkpoint table schema, IAM policy, and stream retention.
- [Pipeline and Output](references/pipeline-and-output.md): Full runnable pipelines, message/metadata shape, snapshot vs CDC modes, deduplication, and restart behavior.
- [Enterprise Redpanda Features](references/enterprise-redpanda-features.md): Iceberg Topics, Tiered Storage, Remote Read Replicas, Shadow Linking (cross-cluster DR), server-side Schema ID Validation, RBAC/Audit Logging/OIDC/Kerberos/FIPS, and Redpanda Connect Enterprise — nested config keys, defaults, and which license gates each.
