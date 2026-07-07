---
name: rpk-cluster
description: >-
  Operates a Redpanda cluster from the command line using the `rpk cluster`
  command group — the CLI front-end to the Admin API. Covers health checks,
  cluster metadata, broker management, cluster configuration, partition
  balancing and movement, maintenance mode, client quotas, log directories,
  transactions, self-test benchmarks, and license management.
  Use when: checking cluster health or metadata, listing brokers,
  decommissioning or recommissioning a broker (via `rpk redpanda admin
  brokers` — covered here because it pairs with maintenance mode), getting or
  setting cluster configuration properties, balancing or moving partitions,
  enabling or disabling maintenance mode on a node, monitoring Kafka client
  connections, managing client quotas, viewing log dirs, running cluster
  self-tests, or managing the Redpanda license from the CLI. Also use when
  asked about rpk cluster health, rpk cluster info, rpk cluster
  config get/set/edit/import/export/lint/status, rpk cluster partitions
  list/balance/move/move-cancel/move-status/balancer-status,
  rpk cluster maintenance enable/disable/status, rpk cluster connections,
  rpk cluster quotas alter/describe/import, rpk cluster logdirs describe,
  rpk cluster self-test start/stop/status, rpk cluster txn,
  rpk cluster license, or broker decommission
  (rpk redpanda admin brokers decommission/decommission-status/recommission). Also covers enabling Redpanda Enterprise
  differentiators through cluster config and license management: Continuous
  Data Balancing (partition_autobalancing_mode=continuous), Continuous
  Intra-Broker / core balancing (core_balancing_continuous), Tiered Storage
  (cloud_storage_enabled), Whole Cluster Restore and mountable topics
  (rpk cluster storage restore/mount/unmount), Iceberg Topics
  (iceberg_enabled), Shadow Linking cross-cluster DR (enable_shadow_linking),
  Remote Read Replicas (cloud_storage_enable_remote_read), Audit Logging
  (audit_enabled), Leadership Pinning (default_leaders_preference), Server-Side
  Schema ID Validation (enable_schema_id_validation), Schema Registry
  authorization, Topic Deletion Control (delete_topic_enable), and
  OIDC/OAUTHBEARER/Kerberos auth (sasl_mechanisms, http_authentication).
---

# rpk cluster: Brokers, Config, Partitions & Maintenance

`rpk cluster` is the CLI front-end to the Redpanda Admin API (default port
9644). It lets you inspect and operate a running Redpanda cluster without
writing raw HTTP calls. Every subcommand communicates with the Admin API unless
noted otherwise (`rpk cluster info`, `rpk cluster logdirs`, and
`rpk cluster quotas` use the Kafka protocol — they need the broker port
(default 9092) and Kafka/SASL credentials, not the Admin API port 9644).

The command group has these major subgroups: `health`, `info`, `logdirs`,
`config`, `connections`, `maintenance`, `partitions`, `self-test`, `quotas`,
`storage`, `txn`, and `license`. (There is no `brokers` subgroup —
broker decommission/recommission lives at `rpk redpanda admin brokers`,
covered below because it pairs with maintenance mode.)

## Quickstart

```bash
# 1. Check cluster health (exit code 10 if unhealthy)
rpk cluster health

# 2. Inspect brokers, topics, and cluster metadata
rpk cluster info

# 3. List brokers with Admin API detail (cores, membership, liveness, version)
rpk cluster info -b --detailed

# 4. Get a single cluster config property
rpk cluster config get log_retention_ms

# 5. Set a cluster config property
rpk cluster config set log_retention_ms=604800000

# 6. Set a property with a negative value (use -- to avoid POSIX flag parsing)
rpk cluster config set -- log_retention_ms -1

# 7. Check whether any node needs a restart after a config change
rpk cluster config status

# 8. List partitions for a topic, showing leader and replica placement
rpk cluster partitions list my-topic

# 9. List ALL partitions in the cluster
rpk cluster partitions list --all

# 10. Trigger on-demand partition rebalancing
rpk cluster partitions balance

# 11. Check balancer status
rpk cluster partitions balancer-status

# 12. Move a partition's replicas to specific brokers
rpk cluster partitions move my-topic -p 0:1,2,3

# 13. Cancel all ongoing partition movements
rpk cluster partitions move-cancel

# 14. Enable maintenance mode on broker 1, waiting for drain to complete
rpk cluster maintenance enable 1 --wait

# 15. Check maintenance status across all brokers
rpk cluster maintenance status

# 16. Decommission broker 4 (note: under rpk redpanda admin, not rpk cluster)
rpk redpanda admin brokers decommission 4
# Monitor progress:
rpk redpanda admin brokers decommission-status 4

# 17. Run a cluster self-test (disk + network + cloud)
rpk cluster self-test start --no-confirm
rpk cluster self-test status

# 18. Describe log directory sizes (human-readable, by topic)
rpk cluster logdirs describe -H --aggregate-into topic

# 19. Add a producer byte-rate quota for a client ID
rpk cluster quotas alter --add producer_byte_rate=180000 --name client-id=my-producer
```

## Cluster Health and Metadata

### rpk cluster health

Queries the Admin API for a health overview. A cluster is healthy when:
- All nodes are responding
- All partitions have leaders
- The cluster controller is present

```bash
rpk cluster health            # one-shot check; exits 10 if unhealthy
rpk cluster health --watch    # stream health changes
rpk cluster health --exit-when-healthy  # block until healthy
```

The output includes: `is_healthy`, `unhealthy_reasons`, `controller_id`,
`all_nodes`, `nodes_down`, `nodes_in_recovery_mode`,
`leaderless_partitions` (count), `under_replicated_partitions` (count), and
`high_disk_usage_nodes`.

Flags: `-w/--watch`, `-e/--exit-when-healthy`, `--format json|yaml|text|wide`.
Note: `--watch` and `--exit-when-healthy` are only available with `--format text`
(the default). Combining them with `--format json`, `yaml`, or `wide` returns
an error.

### rpk cluster info

Fetches Kafka-protocol metadata (cluster name, brokers, topics). Aliases:
`rpk cluster status`, `rpk cluster metadata`.

```bash
rpk cluster info                   # all sections (cluster, brokers, topics)
rpk cluster info -b --detailed     # brokers + Admin API extras (cores, liveness, disk)
rpk cluster info -b --include-decommissioned  # include decommissioned node UUIDs
rpk cluster info -t my-topic -d    # per-partition detail for one topic
```

Key flags: `-b/--print-brokers`, `-t/--print-topics`, `-d/--print-detailed-topics`,
`-i/--print-internal-topics`, `--detailed`, `--include-decommissioned`.

The BROKERS section marks the controller with `*`. With `--detailed`, adds
CORES, MEMBERSHIP, IS-ALIVE, VERSION, and UUID columns, plus a DISK SPACE
section showing free/total/used% per path per node.

### rpk cluster logdirs describe

Describes log directory sizes using the Kafka protocol.

```bash
rpk cluster logdirs describe                         # all brokers, all topics
rpk cluster logdirs describe --topics my-topic -H    # human-readable sizes
rpk cluster logdirs describe --aggregate-into broker # total per broker
rpk cluster logdirs describe --aggregate-into topic  # total per topic
rpk cluster logdirs describe -b 1                    # single broker
rpk cluster logdirs describe --sort-by-size          # largest first
```

Aggregate options: `partition` (default), `broker`, `dir`, `topic`.

### rpk cluster connections list

Displays statistics about active and recently closed Kafka connections in the
cluster — useful for finding which client applications are producing load.
Notably available on Redpanda Cloud too (it maps to the Data Plane monitoring
API there).

```bash
# All connections (default: subset of columns; --format=json for everything)
rpk cluster connections list

# Order by recent produce/fetch throughput or idle time
rpk cluster connections list --order-by="recent_request_statistics.produce_bytes desc"
rpk cluster connections list --order-by="recent_request_statistics.fetch_bytes desc"
rpk cluster connections list --order-by="idle_duration desc"
```

Shorthand filters (e.g. `--client-id`, `--state`) plus raw expressions
(`--filter-raw`, `--order-by`) are available — see `--help` for the full list;
the expression syntax follows the Admin API's ListKafkaConnections endpoint.

## Brokers

Broker decommission/recommission commands live under `rpk redpanda admin
brokers`, not `rpk cluster`. They are covered here because decommission is a
cluster-shrink operation that pairs with maintenance mode.

```bash
# List brokers through the Admin API
rpk redpanda admin brokers list

# Decommission a broker (removes from cluster, moves partitions to remaining nodes)
rpk redpanda admin brokers decommission 4

# Monitor decommission progress
rpk redpanda admin brokers decommission-status 4      # progress table
rpk redpanda admin brokers decommission-status 4 -d   # includes bytes moved/remaining
rpk redpanda admin brokers decommission-status 4 -H   # human-readable sizes

# Abort a decommission that is still in progress (once complete, cannot recommission)
rpk redpanda admin brokers recommission 4

# Force decommission of a dead/unreachable broker (hidden flag; the docs'
# --skip-liveness-check spelling is rejected by current rpk releases)
rpk redpanda admin brokers decommission 4 --force
```

See [brokers-maintenance.md](references/brokers-maintenance.md) for full
decommission/recommission and maintenance-mode detail.

## Cluster Configuration

Cluster properties apply to all nodes and are separate from node (redpanda.yaml)
properties. Changes propagate immediately.

```bash
# Get a single property value
rpk cluster config get log_retention_ms

# Set one property
rpk cluster config set log_retention_ms=604800000

# Set multiple properties (key=value notation required)
rpk cluster config set iceberg_enabled=true iceberg_catalog_type=rest

# Interactive edit (opens $EDITOR)
rpk cluster config edit

# List all available properties (use --filter for regex filtering)
rpk cluster config list
rpk cluster config list --filter="kafka.*"

# Export current config to a file
rpk cluster config export -f /tmp/cluster-config.yml

# Import config from a file
# (properties present in the schema but absent from the file are reset to
#  default within the exported visibility scope; use --all on both export and
#  import for full coverage — safest to import from a complete export)
rpk cluster config import -f /tmp/cluster-config.yml

# Validate a config file without applying it
rpk cluster config lint -f /tmp/cluster-config.yml

# Check config version and restart requirements per node
rpk cluster config status

# Force-reset: clears a property from the local node's config_cache.yaml so
# redpanda treats it as default on next startup. Use ONLY when redpanda will
# not start due to a bad config value, and ONLY while redpanda is STOPPED.
# For a normal reset-to-default, use: rpk cluster config set log_retention_ms ""
rpk cluster config force-reset log_retention_ms
```

See [config.md](references/config.md) for property categories, common keys,
and the cluster-vs-node config distinction.

## Partitions

```bash
# List partitions for specific topics
rpk cluster partitions list my-topic other-topic

# List ALL partitions in the cluster
rpk cluster partitions list --all

# Filter by partition ID
rpk cluster partitions list my-topic --partition 0,1,2

# Filter by broker ID (show only partitions with a replica on broker 2)
rpk cluster partitions list my-topic --node-ids 2

# Show only disabled partitions
rpk cluster partitions list --all --disabled-only

# Trigger on-demand balance
rpk cluster partitions balance

# Check balancer status (off/ready/starting/in_progress/stalled)
rpk cluster partitions balancer-status

# Move partition 0 of "my-topic" to brokers 1, 2, 3
rpk cluster partitions move my-topic -p 0:1,2,3

# Move partition 0 with explicit core assignment
rpk cluster partitions move my-topic -p 0:1-0,2-0,3-0

# Move using namespace-qualified topic name
rpk cluster partitions move -p foo/0:1,2,3

# Cancel all ongoing movements
rpk cluster partitions move-cancel

# Cancel movements only on broker 1
rpk cluster partitions move-cancel --node 1

# Check movement status
rpk cluster partitions move-status

# Transfer leadership for a partition (topic as positional arg, partition:target)
rpk cluster partitions transfer-leadership my-topic --partition 0:2
# Or using the fully-qualified form (no positional topic arg):
rpk cluster partitions transfer-leadership --partition my-topic/0:2

# Enable/disable a partition (emergency isolation of a corrupted partition)
# Flag is --partitions (plural); accepts {namespace}/{topic}/[partitions...] or --all
rpk cluster partitions enable  my-topic --partitions 0
rpk cluster partitions disable my-topic --partitions 0
# Disable all partitions of a topic at once:
rpk cluster partitions disable my-topic --all

# Unsafe recovery: requires --from-nodes listing permanently-lost broker IDs
# Use ONLY as a last resort when instructed by Redpanda support
rpk cluster partitions unsafe-recover --from-nodes 2,3
# Dry run (prints plan without executing):
rpk cluster partitions unsafe-recover --from-nodes 2,3 --dry
```

See [partitions.md](references/partitions.md) for balancer states, move
syntax, and safe move workflows.

## Maintenance Mode

Maintenance mode drains raft leadership off a node so it can be safely
restarted or upgraded with minimal disruption. Only one node may be in
maintenance mode at a time.

```bash
rpk cluster maintenance enable  1           # put node 1 in maintenance
rpk cluster maintenance enable  1 --wait    # wait until all leadership drained
rpk cluster maintenance disable 1           # remove node 1 from maintenance
rpk cluster maintenance status              # show status table for all nodes
```

Status table columns: NODE-ID, ENABLED, FINISHED, ERRORS, PARTITIONS,
ELIGIBLE, TRANSFERRING, FAILED.

See [brokers-maintenance.md](references/brokers-maintenance.md) for the
rolling-upgrade playbook.

## Self-Test

Benchmarks disk I/O and network throughput on cluster nodes using the Admin
API. **Do not run on a production cluster under heavy load.**

```bash
# Start all tests (disk + network + cloud) — prompts for confirmation
rpk cluster self-test start

# Start without confirmation prompt
rpk cluster self-test start --no-confirm

# Run only disk tests
rpk cluster self-test start --only-disk-test

# Run only network tests
rpk cluster self-test start --only-network-test

# Run only cloud storage tests (requires cloud_storage_enabled=true)
rpk cluster self-test start --only-cloud-test

# Limit to specific nodes
rpk cluster self-test start --participant-node-ids 1,2

# Poll status (returns test ID + results once complete)
rpk cluster self-test status

# Stop a running test
rpk cluster self-test stop
```

Default durations: disk 30 s, network 30 s. Disk test suite includes 512 KB
sequential r/w throughput, 4 KB latency at varying io depths, and 16 KB tests.
Network test is an 8 KB throughput test between all node pairs.

See [health-and-selftest.md](references/health-and-selftest.md) for test
descriptions and interpreting results.

## Quotas

Client quotas throttle produce and consume byte rates for Kafka clients,
matched by client ID or client ID prefix.

```bash
# Add a consumer byte-rate quota for client ID "my-consumer"
rpk cluster quotas alter --add consumer_byte_rate=200000 --name client-id=my-consumer

# Add a producer quota matching a client ID prefix
rpk cluster quotas alter --add producer_byte_rate=180000 --name client-id-prefix=batch-

# Add a default quota for all client IDs (no --name)
rpk cluster quotas alter --add producer_byte_rate=180000 --default client-id

# Remove a quota
rpk cluster quotas alter --delete producer_byte_rate --name client-id=my-consumer

# Dry run (validate without applying)
rpk cluster quotas alter --add consumer_byte_rate=200000 --name client-id=foo --dry

# Describe existing quotas
rpk cluster quotas describe

# Import quotas from a YAML file (flag is --from, not -f)
# --from also accepts an inline YAML/JSON string; use --no-confirm to skip prompt
rpk cluster quotas import --from /tmp/quotas.yml
```

## Storage (Whole Cluster Restore & Mountable Topics)

`rpk cluster storage` interacts with Tiered Storage at the cluster level: it
recovers topics/cluster state from the object-storage (archival) bucket and
mounts/unmounts topics between the cluster and Tiered Storage. Both Whole
Cluster Restore and mountable topics are **Enterprise-licensed** capabilities
and require Tiered Storage (`cloud_storage_enabled=true`).

```bash
# --- Whole Cluster Restore / topic recovery (alias: recovery) ---
# Start restoring topics from the archival bucket (exits after starting)
rpk cluster storage restore start
# Wait for the restore to finish instead of returning immediately
rpk cluster storage restore start --wait
# Check restore progress after it has started
rpk cluster storage restore status

# --- Mountable topics (move topics in/out of the cluster via Tiered Storage) ---
# List topics in object storage that can be mounted into this cluster
rpk cluster storage list-mountable
# Mount a topic from Tiered Storage into the cluster (optionally rename with --to)
rpk cluster storage mount my-namespace/my-topic
rpk cluster storage mount my-namespace/my-topic --to my-namespace/my-new-topic
# Unmount: reject writes, flush to Tiered Storage, remove topic from the cluster
rpk cluster storage unmount my-namespace/my-topic
# List mount/unmount migrations (filter by planned|prepared|executed|finished)
rpk cluster storage list-mount
# Status of a mount/unmount migration by its migration ID
rpk cluster storage status-mount 123
# Cancel an in-progress mount/unmount migration by its migration ID
rpk cluster storage cancel-mount 123
```

See [storage.md](references/storage.md) for the restore workflow, mount/unmount
lifecycle, and migration states.

## Enterprise Features

Most Redpanda differentiators are gated behind an **Enterprise license** and
turned on through cluster config (`rpk cluster config set`). New clusters
(24.3+) ship with a 30-day trial; on expiration, enabling/modifying these
features is restricted (the cluster keeps running without data loss).

```bash
# Check license + detect violations (enterprise features without a valid license)
rpk cluster license info            # fields: Type, Expires, License Status, Violation
rpk cluster license set --path /etc/redpanda/redpanda.license   # no restart needed

# Enterprise feature gates (cluster config)
rpk cluster config set partition_autobalancing_mode continuous  # Continuous Data Balancing
rpk cluster config set core_balancing_continuous true           # Continuous core balancing
rpk cluster config set cloud_storage_enabled true               # Tiered Storage (restart)
rpk cluster config set iceberg_enabled true                     # Iceberg Topics (restart)
rpk cluster config set enable_shadow_linking true               # Shadow Linking DR
rpk cluster config set audit_enabled true                       # Audit Logging
rpk cluster config set enable_schema_id_validation redpanda     # Schema ID Validation
rpk cluster config set default_leaders_preference racks:rack1,rack2  # Leadership Pinning
rpk cluster config set delete_topic_enable false                # Topic Deletion Control
rpk cluster config set sasl_mechanisms "[SCRAM,GSSAPI,OAUTHBEARER]"  # Kerberos/OIDC
rpk cluster config set http_authentication "[BASIC,OIDC]"       # OIDC on HTTP/Admin API
```

The 14 enterprise-flagged cluster properties, their nested sub-settings
(`partition_autobalancing_*`, `iceberg_*`, `audit_*`, `cloud_storage_*`), the
license-free fallback values, and disablement-for-compliance steps are
documented in [enterprise-features.md](references/enterprise-features.md).
RBAC/GBAC is managed via `rpk security role`, and FIPS via
`rpk redpanda config set redpanda.fips_mode` (both noted in that reference).

## Reference Directory

- [enterprise-features.md](references/enterprise-features.md): Enterprise differentiators via cluster config + `rpk cluster license` — the 14 enterprise-flagged cluster properties with defaults/enterprise values, plus nested settings for Continuous Data Balancing, core balancing, Tiered Storage, Iceberg Topics, Shadow Linking, Remote Read Replicas, Audit Logging, Leadership Pinning, Schema ID Validation, Schema Registry authorization, Topic Deletion Control, and OIDC/OAUTHBEARER/Kerberos auth. Also notes Cloud Topics (cluster prerequisite `cloud_topics_enabled`, a non-enterprise deprecated property; per-topic `redpanda.storage.mode=cloud`). License lifecycle and compliance-disable steps.
- [config.md](references/config.md): `rpk cluster config` subcommands in depth — get/set/edit/list/import/export/lint/force-reset/status, common property keys, and the cluster-vs-node config distinction.
- [storage.md](references/storage.md): `rpk cluster storage` subcommands — Whole Cluster Restore / topic recovery (`restore start`/`restore status`) and mountable topics (`mount`/`unmount`/`list-mountable`/`list-mount`/`status-mount`/`cancel-mount`), both Enterprise-licensed and Tiered-Storage-backed.
- [partitions.md](references/partitions.md): `rpk cluster partitions` subcommands — list, balance, balancer-status, move (format syntax), move-cancel, move-status, enable/disable, and unsafe-recover.
- [brokers-maintenance.md](references/brokers-maintenance.md): broker decommission/recommission/decommission-status (via `rpk redpanda admin brokers`) and `rpk cluster maintenance` (enable/disable/status) — lifecycle, rolling upgrade playbook, and interaction with replication.
- [health-and-selftest.md](references/health-and-selftest.md): `rpk cluster health`, `rpk cluster info`, `rpk cluster logdirs describe`, `rpk cluster quotas`, and `rpk cluster self-test` — health fields, metadata sections, log-dir aggregation, quota types, and self-test benchmarks.
