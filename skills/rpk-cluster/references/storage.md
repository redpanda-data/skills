# rpk cluster storage: Whole Cluster Restore & Mountable Topics

`rpk cluster storage` operates on Tiered Storage at the cluster level. It covers
two Enterprise-licensed capabilities:

- **Whole Cluster Restore (WCR) / topic recovery** — restore topics (and cluster
  state) from the object-storage archival bucket, for disaster recovery or to
  recover an accidentally deleted topic.
- **Mountable topics** — move a topic out of a cluster into Tiered Storage
  (unmount) and back into the same or a different cluster (mount), using the
  log segments held in Tiered Storage.

Both require Tiered Storage to be enabled (`cloud_storage_enabled=true`) and a
valid Enterprise license. WCR is listed in the Redpanda licensing enterprise
table; the mountable-topics docs carry the enterprise-license requirement.

> In Redpanda Cloud, `rpk cluster storage mount`/`unmount` and related commands
> are supported only on BYOC and Dedicated clusters.

## Whole Cluster Restore / topic recovery

`restore` has the alias `recovery`. The `restore start` command kicks off the
process and exits immediately; use `--wait`/`-w` to block until it finishes.
Check progress with `restore status`.

```bash
# Start restoring topics from the archival bucket (returns once started)
rpk cluster storage restore start

# Start and wait for completion
rpk cluster storage restore start --wait

# Fetch the status of an in-progress / completed restore
rpk cluster storage restore status
```

On license expiration you cannot perform WCR; add a valid license to the target
cluster to proceed. If the source cluster has an expired license, the target
inherits the restriction until a valid license is applied.

## Mountable topics

A topic stored in Tiered Storage can be mounted into a cluster, and a topic in a
cluster can be unmounted (flushed to Tiered Storage and removed). After
unmounting, the topic can be remounted to the same cluster or a different one if
its log segments are available in that cluster's Tiered Storage.

```bash
# List topics in object storage that can be mounted into this cluster
rpk cluster storage list-mountable

# Mount a topic from Tiered Storage into the cluster
rpk cluster storage mount my-namespace/my-topic
# Mount and rename via --to (optional)
rpk cluster storage mount my-namespace/my-topic --to my-namespace/my-new-topic

# Unmount: rejects writes, flushes to Tiered Storage, removes topic from cluster
rpk cluster storage unmount my-namespace/my-topic
```

Mount requirements:
- Tiered Storage must be enabled.
- Log segments for the topic must be available in Tiered Storage.
- A topic with the same name must not already exist in the cluster.

During an unmount, attempted reads/writes return `UNKNOWN_TOPIC_OR_PARTITION`.
Unmount works independently of other topic settings such as `remote.delete=false`.

### Migration tracking

Mount and unmount run as migrations identified by a migration ID emitted when
the operation executes. Manage them with:

```bash
# List mount/unmount migrations (alias: list-unmount)
rpk cluster storage list-mount
# Filter by state: planned | prepared | executed | finished
rpk cluster storage list-mount --filter executed

# Status of a migration by ID (alias: status-unmount)
rpk cluster storage status-mount 123

# Cancel an in-progress migration by ID (alias: cancel-unmount)
rpk cluster storage cancel-mount 123
```
