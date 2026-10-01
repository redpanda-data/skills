# Cloud Topics (Enterprise)

**Requires an Enterprise license.** Available starting in Redpanda v26.1. When the license expires/violates: new Cloud Topics cannot be created, existing Cloud Topics cannot be modified (including adding partitions), and major upgrades are blocked while in a violation state.

## What It Does

A Cloud Topic ("diskless" topic) is a Redpanda topic type that uses durable object storage (S3, ADLS, GCS, MinIO) as the **primary** mechanism to both replicate data and serve it to consumers, instead of replicating every byte across the network between brokers. Local disk is used only as a write buffer. This eliminates over 90% of the cross-AZ replication networking cost in multi-AZ clusters.

Trade-off: Cloud Topics optimize for **throughput and cost**, not latency. With Cloud Topics, a produce is not acknowledged until the data is uploaded to object storage, so expect end-to-end latency of roughly **500 ms to a few seconds** (typically 1-2 seconds with public cloud object stores). Good for observability streams, offline analytics, AI/ML training feeds, and dev environments with relaxed latency needs.

## Prerequisites

- rpk v26.1 or later.
- Object storage configured and Tiered Storage (cloud storage) enabled on the cluster.
- An Enterprise license. Check with `rpk cluster license info`.

## Enabling Cloud Topics

### Cluster prerequisite

Cloud Topics need no enablement property of their own. Once object storage is
configured for the cluster (`cloud_storage_enabled=true`), you can create Cloud
Topics directly:

```bash
rpk cluster config get cloud_storage_enabled   # must be true
```

`cloud_topics_enabled` is **deprecated since v26.2.1 and ignored** — remove it
from your configuration, because setting it has no effect. On clusters older
than v26.2 it was a required prerequisite and needed a restart.

### Create a Cloud Topic

A topic can be made a Cloud Topic **only at creation time** — use `redpanda.storage.mode=cloud`:

```bash
rpk topic create -c redpanda.storage.mode=cloud my-cloud-topic
```

### Make all new topics Cloud Topics by default

```bash
rpk cluster config set default_redpanda_storage_mode=cloud
```

## Relevant Config Keys

| Key | Scope | Purpose |
|---|---|---|
| `cloud_storage_enabled` | Cluster | Object storage must be enabled; this is the only cluster-level prerequisite from v26.2 on. |
| `cloud_topics_enabled` | Cluster | **Deprecated in v26.2.1 and ignored.** Was the master switch before v26.2 (default `false`, restart required). Remove it from configuration. |
| `redpanda.storage.mode=cloud` | Topic (create only) | Makes a topic a Cloud Topic. Cannot be changed after creation. |
| `redpanda.cloud_topic.enabled` | Topic | Underlying topic property that marks Cloud Topic storage mode (object storage primary, local disk as write buffer only). Type `string`, default `null`. Redpanda recommends using `redpanda.storage.mode` instead for flexibility. **Note:** this property is never replicated by Shadow Links. |
| `default_redpanda_storage_mode=cloud` | Cluster | Default storage mode for newly created topics. |

## Reducing Cross-AZ Networking Cost Further

Beyond replication, cross-AZ producer (ingress) and consumer (egress) traffic also drives cloud networking cost. Combine Cloud Topics with:
- **Follower Fetching** (`client.rack` on consumers) so consumers read from a same-AZ replica.
- **Leader Pinning** (`redpanda.leaders.preference`) so a partition leader sits close to producers.

See `references/consume-data.md` (follower fetching) and `references/continuous-balancing.md` / `references/topic-management.md` (leader pinning).

## Limitations

- A Cloud Topic cannot be converted back to a standard local/Tiered Storage topic, and existing local/Tiered topics cannot be converted to Cloud Topics.
- Higher produce latency than standard topics (expect 1-2 seconds with public cloud object stores).
- Shadow Links do not currently support Cloud Topics.
