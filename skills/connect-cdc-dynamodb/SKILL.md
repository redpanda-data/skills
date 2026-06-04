---
name: connect-cdc-dynamodb
description: "Behavioral guidance for AWS DynamoDB CDC with Redpanda Connect. Use when: setting up aws_dynamodb_cdc, troubleshooting streams, or diagnosing shard iterator issues. This skill provides agent choreography - the actual config fields come from docs."
metadata:
  version: "2.0.0"
---

# AWS DynamoDB CDC: Agent Behavior Guide

This skill provides behavioral guidance for setting up and troubleshooting AWS DynamoDB CDC with Redpanda Connect. For config field reference and detailed procedures, see the [aws_dynamodb_cdc documentation](https://docs.redpanda.com/redpanda-connect/components/inputs/aws_dynamodb_cdc/).

> **Enterprise Feature**: `aws_dynamodb_cdc` requires a Redpanda Enterprise license.

## Before you start

Always verify these prerequisites in order:

1. **DynamoDB Streams enabled on table** — enable in table settings with desired view type
2. **IAM permissions configured** — needs `dynamodb:DescribeStream`, `dynamodb:GetShardIterator`, `dynamodb:GetRecords`
3. **Stream view type appropriate** — choose based on what data you need (keys only, new image, old image, both)
4. **AWS credentials available** — via environment, IAM role, or explicit configuration

## Common gotchas

| Gotcha | How to Avoid |
|--------|--------------|
| Streams not enabled on table | Must explicitly enable DynamoDB Streams in table settings |
| Wrong stream view type | Choose view type upfront; can't change without recreating stream |
| 24-hour stream retention | DynamoDB streams retain data for only 24 hours — can't extend |
| Shard iterator expiration | Iterators expire after 5 minutes of inactivity |
| IAM permission errors | Need stream-specific permissions, not just table permissions |
| Cross-region considerations | Streams are regional; global tables have separate streams |

## Decision tree

| Symptom | First Move |
|---------|-----------|
| Connector won't start | Verify DynamoDB Streams is enabled on the table |
| Can't resume after gap | Stream data only retained 24 hours. If connector was down longer, data is lost. |
| Missing data in events | Check stream view type — may only be capturing keys, not full items |
| Permission denied | IAM policy needs DynamoDB Streams permissions, not just DynamoDB |
| License error | `aws_dynamodb_cdc` is enterprise — verify license is loaded |

## Stream view types

Choose when enabling streams (can't change later without disabling/re-enabling):

| View Type | What's Captured |
|-----------|-----------------|
| KEYS_ONLY | Only the key attributes |
| NEW_IMAGE | Complete item after modification |
| OLD_IMAGE | Complete item before modification |
| NEW_AND_OLD_IMAGES | Both before and after (most complete, highest cost) |

## 24-hour retention limit

DynamoDB Streams has a fixed 24-hour retention. This is not configurable. Plan for:
- High availability of the connector
- Quick recovery procedures
- Monitoring for stream lag

If connector downtime exceeds 24 hours, you will lose data.

## When to escalate

- Shard split handling issues
- Throughput throttling on stream reads
- Data inconsistencies between source and sink
- Global tables replication complexity

**Docs**: [aws_dynamodb_cdc Input](https://docs.redpanda.com/redpanda-connect/components/inputs/aws_dynamodb_cdc/)
