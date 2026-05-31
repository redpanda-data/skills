# DynamoDB Setup for CDC

This page covers everything you need to do in AWS before running the `aws_dynamodb_cdc` connector.

---

## 1. Enable DynamoDB Streams

DynamoDB Streams must be enabled on each source table. The connector reads from the stream via `DescribeStream` / `GetShardIterator` / `GetRecords`.

### AWS CLI

```bash
# Enable with NEW_AND_OLD_IMAGES (recommended — provides both old and new item state)
aws dynamodb update-table \
  --table-name my-table \
  --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES

# Verify
aws dynamodb describe-table --table-name my-table \
  --query "Table.{StreamEnabled:StreamSpecification.StreamEnabled, ViewType:StreamSpecification.StreamViewType}"
```

### Terraform

```hcl
resource "aws_dynamodb_table" "orders" {
  name         = "orders"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "orderId"

  attribute {
    name = "orderId"
    type = "S"
  }

  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"
}
```

### Stream view types

| View type | Contents | When to use |
|---|---|---|
| `KEYS_ONLY` | Only the primary key attributes | Audit trail of which items changed |
| `NEW_IMAGE` | Full item after the change | Downstream replication (no old values) |
| `OLD_IMAGE` | Full item before the change | Capture deletes / old values only |
| `NEW_AND_OLD_IMAGES` | Both new and old full items | Full CDC — recommended for most use cases |

The connector works with any view type, but `NEW_AND_OLD_IMAGES` provides the most complete event data. With `KEYS_ONLY`, the `newImage` and `oldImage` fields in the message payload are absent.

---

## 2. Stream Retention (24-hour window)

DynamoDB Streams retain records for **exactly 24 hours**. If the connector is down for longer than this:

- In `snapshot_and_cdc` mode, the connector detects stale checkpoints on restart by attempting to get a shard iterator at the checkpointed sequence number. If this fails, it re-runs the full snapshot automatically.
- In `none` mode (CDC-only), stale shards are silently skipped; data written during the outage is permanently lost unless `start_from: trim_horizon` is set and the gap is under 24 hours.

For longer retention (up to 1 year), enable Kinesis Data Streams for DynamoDB and use the `aws_kinesis` Connect input instead.

---

## 3. Checkpoint Table

The connector stores shard progress in a separate DynamoDB table. By default this table is named `redpanda_dynamodb_checkpoints`; override with the `checkpoint_table` config field.

The connector creates this table automatically if it does not exist, using pay-per-request billing. The schema is:

| Attribute | Type | Role |
|---|---|---|
| `StreamArn` | String | Partition key |
| `ShardID` | String | Sort key |
| `SequenceNumber` | String | Last acknowledged sequence number |

Snapshot progress is stored as additional items with special `ShardID` values:
- `snapshot#segment#0`, `snapshot#segment#1`, … — per-segment progress
- `snapshot#complete` — marks the snapshot as fully done

The connector queries this table at startup to resume from the last checkpointed position for each shard.

### Creating it manually (optional)

You can create the table yourself before starting the connector, for example to apply specific tags or use provisioned capacity:

```bash
aws dynamodb create-table \
  --table-name redpanda_dynamodb_checkpoints \
  --attribute-definitions \
    AttributeName=StreamArn,AttributeType=S \
    AttributeName=ShardID,AttributeType=S \
  --key-schema \
    AttributeName=StreamArn,KeyType=HASH \
    AttributeName=ShardID,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --tags Key=ManagedBy,Value=redpanda-connect
```

---

## 4. IAM Permissions

The connector requires permissions across three areas: reading from DynamoDB Streams, optionally scanning the table (snapshots), and reading/writing the checkpoint table.

### Minimum IAM policy (CDC only, no snapshot)

The connector resolves the stream ARN by calling `DescribeTable` on the source table (not `ListStreams`), so `dynamodb:DescribeTable` on the source table is always required. Stream API actions go against the stream sub-resource; `dynamodb:ListStreams` is never called and should not be granted.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "StreamRead",
      "Effect": "Allow",
      "Action": [
        "dynamodb:DescribeStream",
        "dynamodb:GetRecords",
        "dynamodb:GetShardIterator"
      ],
      "Resource": "arn:aws:dynamodb:REGION:ACCOUNT_ID:table/TABLE_NAME/stream/*"
    },
    {
      "Sid": "DescribeTable",
      "Effect": "Allow",
      "Action": ["dynamodb:DescribeTable"],
      "Resource": "arn:aws:dynamodb:REGION:ACCOUNT_ID:table/TABLE_NAME"
    },
    {
      "Sid": "Checkpoints",
      "Effect": "Allow",
      "Action": [
        "dynamodb:CreateTable",
        "dynamodb:DescribeTable",
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:Query"
      ],
      "Resource": "arn:aws:dynamodb:REGION:ACCOUNT_ID:table/redpanda_dynamodb_checkpoints"
    }
  ]
}
```

### Additional permissions for snapshots (`snapshot_mode: snapshot_only` or `snapshot_and_cdc`)

Add `dynamodb:Scan` on the source table:

```json
{
  "Sid": "Snapshot",
  "Effect": "Allow",
  "Action": ["dynamodb:Scan"],
  "Resource": "arn:aws:dynamodb:REGION:ACCOUNT_ID:table/TABLE_NAME"
}
```

### Additional permissions for tag-based discovery (`table_discovery_mode: tag`)

Add `ListTables` and `ListTagsOfResource` (table-level ARN or wildcard):

```json
{
  "Sid": "TagDiscovery",
  "Effect": "Allow",
  "Action": [
    "dynamodb:ListTables",
    "dynamodb:ListTagsOfResource"
  ],
  "Resource": "*"
}
```

### Full policy template (all features)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "StreamRead",
      "Effect": "Allow",
      "Action": [
        "dynamodb:DescribeStream",
        "dynamodb:GetRecords",
        "dynamodb:GetShardIterator"
      ],
      "Resource": "arn:aws:dynamodb:REGION:ACCOUNT_ID:table/*/stream/*"
    },
    {
      "Sid": "TableAccess",
      "Effect": "Allow",
      "Action": [
        "dynamodb:DescribeTable",
        "dynamodb:Scan"
      ],
      "Resource": "arn:aws:dynamodb:REGION:ACCOUNT_ID:table/*"
    },
    {
      "Sid": "Checkpoints",
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
      "Action": [
        "dynamodb:ListTables",
        "dynamodb:ListTagsOfResource"
      ],
      "Resource": "*"
    }
  ]
}
```

---

## 5. Shard Lifecycle

DynamoDB Streams organise records into **shards**. Each shard is a sequence of records with a beginning and an end; when a table is split or merged, old shards close and new child shards open.

The connector handles this automatically:
- Shards are discovered at startup and refreshed every 30 seconds.
- When a shard's `NextShardIterator` is `null`, the shard is marked exhausted and its goroutine exits.
- Exhausted shards are cleaned up every 5 minutes to prevent unbounded memory growth.
- If a `TrimmedDataAccessException` is received (data expired mid-shard), the connector attempts to restart the shard at `TRIM_HORIZON` and signals the coordinator to refresh immediately.

---

## 6. Testing with DynamoDB Local

For local development, use Amazon's DynamoDB Local Docker image. The default entrypoint already runs in-memory mode, so no extra flags are required:

```bash
docker run -p 8000:8000 amazon/dynamodb-local
```

DynamoDB Local supports Streams (required for the connector). Note that stream support in DynamoDB Local uses a single shard per table, so shard-split behaviour differs from production.

Then point the connector at the local endpoint:

```yaml
input:
  aws_dynamodb_cdc:
    tables: [test-table]
    endpoint: "http://localhost:8000"
    region: us-east-1
    credentials:
      id: dummy
      secret: dummy
```

Create a table and enable streams with the local endpoint:

```bash
aws dynamodb create-table \
  --endpoint-url http://localhost:8000 \
  --table-name test-table \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES
```

DynamoDB Local uses a single shard per table. Benchmark results from the source repo show approximately 95,000–102,000 messages/second throughput with 3 tables (one shard each) and `batch_size: 1000`.
