---
name: connect-cdc-mongodb
description: "Behavioral guidance for MongoDB CDC with Redpanda Connect. Use when: setting up mongodb_cdc, troubleshooting change streams, or diagnosing resume token issues. This skill provides agent choreography - the actual config fields come from docs."
metadata:
  version: "2.0.0"
---

# MongoDB CDC: Agent Behavior Guide

This skill provides behavioral guidance for setting up and troubleshooting MongoDB CDC with Redpanda Connect. For config field reference and detailed procedures, see the [mongodb_cdc documentation](https://docs.redpanda.com/redpanda-connect/components/inputs/mongodb_cdc/).

> **Enterprise Feature**: `mongodb_cdc` requires a Redpanda Enterprise license.

## Before you start

Always verify these prerequisites in order:

1. **MongoDB is a replica set or sharded cluster** — change streams require oplog. Standalone MongoDB doesn't support CDC.
2. **User has read privilege on target database** — `db.grantRolesToUser("cdc_user", [{role: "read", db: "mydb"}])`
3. **User has read privilege on `local` database** — needed to read oplog for resume tokens
4. **Network connectivity to all replica set members** — connector needs to reach secondaries for failover

## Common gotchas

| Gotcha | How to Avoid |
|--------|--------------|
| Standalone MongoDB doesn't work | CDC requires replica set or sharded cluster for oplog/change streams |
| Resume token expired | If connector is stopped too long, oplog entry may be gone. Monitor oplog window. |
| Can't connect to replica set | Ensure DNS/hostnames in replica set config are resolvable from connector |
| Missing `local` database access | User needs read on `local` to track resume tokens |
| Full document not included | For updates, set `full_document: "updateLookup"` to get complete document |
| Sharded cluster complexity | Each shard has its own change stream. Connector handles this, but latency varies. |

## Decision tree

| Symptom | First Move |
|---------|-----------|
| Connector won't start | Verify it's a replica set, not standalone MongoDB |
| Can't resume after restart | Resume token expired — oplog window too small. Increase oplog size. |
| Missing update details | Configure `full_document: "updateLookup"` to get complete documents |
| Connection errors | Check replica set member hostnames are resolvable |
| License error | `mongodb_cdc` is enterprise — verify license is loaded |

## Oplog window

The oplog is a capped collection. If the connector is stopped longer than the oplog retains data, it can't resume. Monitor and size appropriately:

```javascript
// Check oplog size and window
db.getReplicationInfo()
```

## Full document lookups

By default, update events only contain changed fields. To get the complete document after update, configure `full_document: "updateLookup"`. Note: this adds latency and load.

## When to escalate

- Resume token errors despite adequate oplog
- Data inconsistencies between source and sink
- Change stream errors on sharded clusters
- Performance issues with high-volume collections

**Docs**: [mongodb_cdc Input](https://docs.redpanda.com/redpanda-connect/components/inputs/mongodb_cdc/)
