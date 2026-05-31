# Consumer Groups and Shadow Linking (Disaster Recovery)

Shadowing is Redpanda's **Enterprise** disaster recovery feature: asynchronous, offset-preserving replication between two distinct clusters. A shadow (read-only) cluster continuously replicates a source cluster's data, **including consumer group offsets and membership**, so that consumer applications can resume from their last committed position after a failover.

**License:** Shadowing requires an Enterprise license. On license expiration, new shadow links cannot be created; existing shadow links continue operating and can be updated.

This reference covers only the consumer-group dimension of shadowing — how group offsets get replicated, how to configure which groups replicate, and how to verify/repair group offsets with `rpk group` after a failover. For the full `rpk shadow` command surface, see the shadowing docs.

## Why this matters for rpk group

After a failover to the shadow cluster, you operate consumer groups on the *new* primary using the same `rpk group` commands documented in this skill:

- `rpk group describe <group>` — verify that replicated offsets landed where you expect.
- `rpk group seek <group> --to ...` — manually repair offsets if a group resumed from the wrong position.

The shadowing failover runbook explicitly directs operators to use `rpk group describe <group-name>` to check offset positions and to manually reset offsets if consumers start from the beginning or wrong positions.

## The Consumer Group Shadowing task

The Consumer Group Shadowing task replicates consumer group offsets and membership information from the source cluster. It runs on brokers that host the `__consumer_offsets` topic and continuously tracks consumer group coordinators to optimize offset synchronization.

It is controlled by the `consumer_offset_sync_options` section in the shadow-link configuration file (generated with `rpk shadow config generate`, applied with `rpk shadow create`).

### `consumer_offset_sync_options` config keys

| Key | Type | Meaning |
|---|---|---|
| `interval` | duration (e.g. `30s`) | How frequently to synchronize consumer group offsets |
| `paused` | bool | When `true`, pauses the Consumer Group Shadowing task without affecting the rest of the shadow link. Default `false` (enabled). |
| `group_filters` | list | Filters that determine which consumer groups have their offsets replicated |

Each entry in `group_filters` is a filter object:

| Field | Valid values | Meaning |
|---|---|---|
| `pattern_type` | `LITERAL`, `PREFIX` | How `name` is matched against group names |
| `filter_type` | `INCLUDE`, `EXCLUDE` | Whether matched groups are included in or excluded from replication |
| `name` | string or `'*'` | Group name, prefix, or `'*'` to match all groups |

Example — replicate all groups (default):

```yaml
consumer_offset_sync_options:
  interval: 30s
  paused: false
  group_filters:
  - pattern_type: LITERAL
    filter_type: INCLUDE
    name: '*'
```

Example — replicate only production groups, exclude one test group:

```yaml
consumer_offset_sync_options:
  interval: 30s
  paused: false
  group_filters:
  - pattern_type: PREFIX
    filter_type: INCLUDE
    name: prod-consumer-
  - pattern_type: LITERAL
    filter_type: EXCLUDE
    name: test-consumer-group
```

## Selective offset replication

Offset replication operates selectively *within* each matched consumer group: **only committed offsets for active shadow topics are synchronized**, even if the group has offsets for additional topics that aren't being shadowed.

Example: if group `app-consumers` has committed offsets for `orders`, `payments`, and `inventory`, but only `orders` is an active shadow topic, then only the `orders` offsets are replicated to the shadow cluster. When you later run `rpk group describe app-consumers` on the shadow cluster, expect commits only for the shadowed topics.

## Offset clamping

When Redpanda replicates consumer group offsets, offsets are automatically **clamped** during the commit process on the shadow cluster. If a committed offset from the source cluster is above the high watermark (HWM) of the corresponding shadow partition, Redpanda clamps the offset down to the shadow partition's HWM before committing it.

This ensures replicated offsets stay valid and prevents consumers from seeking beyond available data on the shadow cluster. In practice, after failover a `rpk group describe` may show a `CURRENT-OFFSET` equal to the shadow partition's `LOG-END-OFFSET` (lag 0) even if the source group was further ahead, because the source was ahead of what replication had delivered.

## Avoid group-name conflicts

If you plan to consume data from the shadow cluster *before* failover (e.g. for read-only workloads), do not reuse the same consumer group names that the source cluster uses. While this won't break shadow linking, conflicting group names can interfere with offset replication and consumer resumption, hurting your RPO/RTO during disaster recovery.

## Failover behavior for consumer groups

- Consumer group offsets are preserved, allowing applications to resume from their last committed position on the new primary.
- Some data loss may occur due to replication lag at the time of failover; the effective RPO depends on lag when the disaster occurred. A group's `CURRENT-OFFSET` on the shadow reflects only what had been replicated.
- In-flight transactions at the source are not replicated and are lost.

## Post-failover verification and repair playbook

```bash
# 1. After promoting the shadow cluster, point rpk at it (profile or -X brokers=...).

# 2. Verify replicated offsets and lag for a critical group.
rpk group describe prod-consumer-orders --print-summary
rpk group describe prod-consumer-orders --print-commits

# 3. If a group resumed from the beginning or a wrong position, stop its
#    consumers, confirm the group is Empty, then manually repair offsets.
rpk group list --states empty | grep prod-consumer-orders
rpk group seek prod-consumer-orders --to <timestamp> --topics orders

# 4. Re-verify, then restart consumers.
rpk group describe prod-consumer-orders --print-commits
```

If `rpk group describe` shows consumers starting from the beginning or the wrong position after failover, first verify that the group matched your `group_filters` (so its offsets were actually replicated); if it did not, the group's offsets were never synced and must be reset manually with `rpk group seek`.

## Required ACLs for offset replication

The shadow link's replication client needs, on the source cluster, `describe` and `read` permission on the consumer groups whose offsets are replicated. Group ACLs themselves can also be replicated through the Security Migrator task by adding a `GROUP` `resource_type` entry to `security_sync_options.acl_filters`.
