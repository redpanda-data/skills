# rpk cluster health, info, logdirs, quotas, and self-test

## rpk cluster health

Queries the Admin API for a health overview built from periodic health reports
collected from all nodes.

```bash
rpk cluster health                     # one-shot; exits 10 if unhealthy
rpk cluster health --watch             # stream updates; blocks
rpk cluster health --exit-when-healthy # block until cluster becomes healthy
rpk cluster health --format json       # machine-readable output
```

A cluster is **healthy** when:
1. All cluster nodes are responding.
2. All partitions have leaders.
3. The cluster controller is present.

**Exit code 10** is returned when the cluster is unhealthy. Exit code 0 when
healthy. This is intentional — exit code 1 is reserved for error (API
unreachable, etc.), 2 for unhandled panics.

### Health response fields

| Field | Description |
|---|---|
| `is_healthy` | Boolean overall health status |
| `unhealthy_reasons` | List of human-readable reasons when unhealthy |
| `controller_id` | Node ID of the current raft controller leader |
| `all_nodes` | All node IDs in the cluster |
| `nodes_down` | Node IDs that are not responding |
| `nodes_in_recovery_mode` | Node IDs currently in recovery mode |
| `leaderless_partitions` | List of partitions (ns/topic/partition) without a leader (truncated after a threshold) |
| `leaderless_count` | Total leaderless partition count (available v23.3+) |
| `under_replicated_partitions` | Partitions with fewer in-sync replicas than required |
| `under_replicated_count` | Total URP count (available v23.3+) |
| `high_disk_usage_nodes` | Node IDs exceeding the configured disk usage threshold |

`--watch` polls every 2 s and prints only when the output changes.

**Format constraint:** `--watch` and `--exit-when-healthy` are only compatible
with `--format text` (the default). Combining either flag with `--format json`,
`yaml`, or `wide` returns an error.

---

## rpk cluster info

Fetches Kafka-protocol metadata: cluster name, broker list, and topic
summaries. Aliases: `rpk cluster status`, `rpk cluster metadata`.

```bash
rpk cluster info                          # all sections
rpk cluster info -b                       # brokers only
rpk cluster info -b --detailed            # brokers + Admin API extras
rpk cluster info -b --include-decommissioned  # include decom node UUIDs
rpk cluster info -t                       # topics only
rpk cluster info -t my-topic -d           # per-partition detail
rpk cluster info -i                       # include internal topics
rpk cluster info --format json            # full JSON output
```

### Sections

**CLUSTER** — Cluster name string (printed only if non-empty).

**BROKERS** — Table of ID, HOST, PORT, (optional) RACK.
- The controller broker is marked with `*` after its ID.
- `--detailed` adds: CORES, MEMBERSHIP (active/draining/removed), IS-ALIVE,
  VERSION, UUID columns from the Admin API.
- `--include-decommissioned` appends decommissioned node UUIDs at the end of
  the table.

**DISK SPACE** (only with `--detailed` when any broker reports disk info) —
NODE-ID, PATH, FREE, TOTAL, USED%.

**TOPICS** — NAME, PARTITIONS, REPLICAS summary. With `-d`, expands to show
per-partition leader, epoch, replicas, offline replicas, and load errors.

---

## rpk cluster logdirs describe

Describes the size of log (data) directories on brokers using the Kafka
DescribeLogDirs protocol. The size reported is bytes written to partition
files, which may differ from `du` output because Redpanda pre-allocates
files in chunks.

Partition data is stored at:
```
<log-dir>/kafka/<topic>/<partition>_<revision>/
```

```bash
# All brokers, all topics (partition granularity)
rpk cluster logdirs describe

# Human-readable sizes
rpk cluster logdirs describe -H

# Specific topics only
rpk cluster logdirs describe --topics orders,payments

# Single broker
rpk cluster logdirs describe -b 2

# Aggregate totals per broker
rpk cluster logdirs describe --aggregate-into broker

# Aggregate totals per directory
rpk cluster logdirs describe --aggregate-into dir

# Aggregate totals per topic (across partitions)
rpk cluster logdirs describe --aggregate-into topic -H

# Sort largest first
rpk cluster logdirs describe --aggregate-into broker --sort-by-size
```

### Flags

| Flag | Description |
|---|---|
| `-H/--human-readable` | Print sizes in human units (e.g. 1.2 GiB) |
| `-b/--broker <id>` | Describe a specific broker; default (-1) = all |
| `--topics <list>` | Comma-separated list of topics to describe |
| `--aggregate-into <level>` | `partition` (default), `broker`, `dir`, `topic` |
| `--sort-by-size` | Sort results by size descending |
| `--format json\|yaml` | Machine-readable output |

### Output columns

Default (partition): BROKER, DIR, TOPIC, PARTITION, SIZE, ERROR  
`--aggregate-into broker`: BROKER, SIZE, ERROR  
`--aggregate-into dir`: BROKER, DIR, SIZE, ERROR  
`--aggregate-into topic`: BROKER, DIR, TOPIC, SIZE, ERROR  

---

## rpk cluster quotas

Client quotas limit the produce and consume byte rates of Kafka clients.
Quotas are matched by client ID or client ID prefix. The `quotas` subcommands
use the Kafka protocol (broker port, default 9092) — not the Admin API — so
they need the Kafka/SASL credentials if authentication is enabled.

**Entity type rules:**
- `--name` accepts `client-id=<value>` or `client-id-prefix=<value>`.
- `--default` accepts only `client-id` (not `client-id-prefix`). Passing
  `--default client-id-prefix` returns a `default type invalid` error.

### alter

```bash
# Add a consumer byte-rate quota for a specific client ID
rpk cluster quotas alter --add consumer_byte_rate=200000 --name client-id=my-consumer

# Add a producer byte-rate quota matched by client ID prefix
rpk cluster quotas alter --add producer_byte_rate=180000 --name client-id-prefix=batch-

# Add a default quota for all client IDs (no specific name)
rpk cluster quotas alter --add producer_byte_rate=180000 --default client-id

# Add multiple quotas in one call
rpk cluster quotas alter \
  --add consumer_byte_rate=200000 \
  --add producer_byte_rate=100000 \
  --name client-id=restricted-client

# Remove a quota
rpk cluster quotas alter --delete producer_byte_rate --name client-id=my-consumer

# Dry run (show changes without applying)
rpk cluster quotas alter --add consumer_byte_rate=200000 --name client-id=foo --dry
```

### Quota types

| Quota key | Unit | Effect |
|---|---|---|
| `consumer_byte_rate` | bytes/second | Max consume throughput per client |
| `producer_byte_rate` | bytes/second | Max produce throughput per client |
| `controller_mutation_rate` | mutations/second | Rate of controller mutations (topic operations, etc.) |

### describe

Lists currently configured quotas.

```bash
rpk cluster quotas describe
rpk cluster quotas describe --format json
```

### import

Imports quotas from a YAML or JSON quota definition. The required `--from`
flag accepts either a file path or an inline YAML/JSON string. There is no
`-f` shorthand for this flag. Use `--no-confirm` to skip the confirmation
prompt.

```bash
# Import from a file
rpk cluster quotas import --from /tmp/quotas.yml

# Import from an inline string (single-quota example)
rpk cluster quotas import --from '{"entity":[{"type":"client-id","name":"my-client"}],"ops":[{"key":"producer_byte_rate","value":180000}]}'

# Skip confirmation prompt
rpk cluster quotas import --from /tmp/quotas.yml --no-confirm
```

---

## rpk cluster self-test

Benchmarks the disk I/O and network throughput of cluster nodes using the
Admin API. **Do not run while the cluster is handling production workloads.**

### start

```bash
# Start all tests (disk + network + cloud storage)
rpk cluster self-test start

# Skip confirmation prompt
rpk cluster self-test start --no-confirm

# Run only disk benchmarks
rpk cluster self-test start --only-disk-test

# Run only network benchmarks
rpk cluster self-test start --only-network-test

# Run only cloud storage tests (requires cloud_storage_enabled=true)
rpk cluster self-test start --only-cloud-test

# Limit to specific node IDs
rpk cluster self-test start --participant-node-ids 1,3

# Adjust test duration (milliseconds)
rpk cluster self-test start --disk-duration-ms 60000 --network-duration-ms 60000

# Cloud storage timeout/backoff
rpk cluster self-test start --cloud-timeout-ms 15000 --cloud-backoff-ms 200
```

Returns a test identifier ID. Poll status with `rpk cluster self-test status`.

### Disk test suite (defaults)

| Test name | Request size | io depth | Notes |
|---|---|---|---|
| 512 KB sequential r/w | 512 KB | 4 | Weighted for throughput |
| 4 KB sequential r/w, low io depth | 4 KB | 1 | Baseline IOPS/latency |
| 4 KB sequential write, medium io depth | 4 KB | 8 | Write-only |
| 4 KB sequential write, high io depth | 4 KB | 64 | Write-only |
| 4 KB sequential write, very high io depth | 4 KB | 256 | Write-only |
| 4 KB sequential write, no dsync | 4 KB | 64 | No fdatasync — establishes dsync cost |
| 16 KB sequential r/w, high io depth | 16 KB | 64 | Redpanda's default chunk size |

### Network test suite (defaults)

| Test name | Message size | Notes |
|---|---|---|
| 8 KB Network Throughput Test | 8192 bytes | All unique node pairs act as client/server |

### Cloud storage tests (defaults)

Runs a sequence of S3/Azure/GCS operations against the configured bucket:
upload object → list objects → download object → download metadata → delete
object → multi-object upload+delete. Reports latency per operation.

### status

```bash
rpk cluster self-test status
rpk cluster self-test status --format json
```

Shows whether tests are running, and displays results once complete. Results
are cached at the Admin API until the next `start`.

### stop

```bash
rpk cluster self-test stop
```

Stops a running self-test run.

### Interpreting results

- **Disk throughput (512 KB test)**: Compare against expected NVMe/SSD
  sequential write speeds for your hardware.
- **Disk latency (4 KB low io depth)**: p50/p99 write latency. High p99
  (>10 ms) often indicates IO scheduler issues, slow disk, or interference
  from another workload.
- **Network throughput**: Should approach your NIC line rate (minus protocol
  overhead). Low numbers can indicate MTU misconfiguration, half-duplex links,
  or network congestion.
- **Cloud storage latency**: Baseline for S3/Azure/GCS round-trip. High latency
  (>500 ms) may indicate network path issues to object storage.
