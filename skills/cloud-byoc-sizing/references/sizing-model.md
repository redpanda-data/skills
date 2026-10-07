Source: [`scripts/sizing.js`](../scripts/sizing.js) (`Workload`, `ClusterRequirement`, `SupportedMachineType`, `HardwareConstrantOptimizer`, model constants). File-by-file mapping in [SOURCES.md](SOURCES.md).

# Sizing Model

How the sizing script turns a workload into RPUs and a broker layout. This page describes the **formulas**; the **values** live only in the script. `node scripts/sizing.js --model` prints the per-RPU capacities, target utilizations, instance catalog and input defaults. The CPU and Iceberg coefficients, `fsync_ratio`, the Iceberg compression ratio and the 4096-byte IO size are constants in the script itself. Quote values from those places, not from memory.

## Pipeline

1. **Workload → resource demand.** Each workload is converted into CPU, read and write IOPS, network bytes in and out, Kafka bytes in and out, and partitions. Workloads in one cluster are summed.
2. **Demand → RPUs per constraint.** Each demand is divided by one RPU's capacity for that resource on the chosen cloud, and (except for partitions) by the target utilization.
3. **Required RPUs** = the maximum across the eight constraints. That constraint is the `binding_constraint`.
4. **Required → deployment.** The optimizer picks an instance type and broker count from the catalog for that cloud.

## Batch Size

The model sizes per-batch costs, so it first estimates the producer batch size:

```
batch_bytes   = min(max_batch_bytes, max(message_size, ingress_bytes × latency_ms / 1000 / producers))
batches_per_s = ingress_bytes / batch_bytes
```

A longer latency target or fewer producers gives bigger batches, which lowers CPU and write IOPS. If a workload sets `batch_size_bytes`, that fixed value is used instead.

## The Eight Constraints

`U_x` is the target utilization for a resource; `cap_x` is one RPU's capacity on the chosen cloud (both from `--model`). `TS` is 1 if Tiered Storage is on, else 0; `IB` is 1 if Iceberg is on, else 0; `C` is the Iceberg compression ratio.

| Constraint | RPUs needed |
|---|---|
| `kafka_ingress` | `ingress / U_kafka_in / cap_kafka_ingress` |
| `kafka_egress` | `egress / U_kafka_out / cap_kafka_egress` |
| `network_in` | `ingress × RF / U_network / cap_network` |
| `network_out` | `(egress + ingress × (RF + TS + IB / C − 1)) / U_network / cap_network` |
| `read_iops` | `((egress + ingress × TS) / 4096 + iceberg_iops) / U_iops / cap_read_iops` |
| `write_iops` | `((1 + (batch_bytes − 1) / 4096 + fsync_ratio) × RF × batches_per_s + iceberg_iops) / U_iops / cap_write_iops` |
| `cpu` | see below |
| `partitions` | `partitions / cap_partitions` (no utilization factor) |

`iceberg_iops = ingress_bytes / C / 4096` when Iceberg is on, else 0. Network capacity is converted from Gbps to bytes/s (`× 1e9 / 8`).

What the formulas imply:

- **Egress fan-out** raises `kafka_egress`, `network_out`, `read_iops` and CPU (through the egress/ingress ratio).
- **Replication factor** multiplies `network_in` and `write_iops`, and adds `ingress × (RF − 1)` to `network_out`.
- **Tiered Storage** adds one copy of ingress to `network_out` and to `read_iops`.
- **Iceberg** adds `ingress / C` to `network_out`, `iceberg_iops` to both IOPS constraints, and a CPU term.
- **Smaller batches** (lower latency target, more producers) raise `write_iops` and CPU.
- **Clouds differ** in per-RPU capacities, so the same workload can bind on Kafka throughput on one cloud and on IOPS on another.

## CPU

```
cpu_cores = produce + fetch + iceberg
produce   = batches_per_s × BATCH_PROD_MICROS
fetch     = produce / 3 × (egress / ingress)
iceberg   = ingress_bytes × ICEBERG_FF × (ICEBERG_B0 + fields × ICEBERG_B1 + message_size × ICEBERG_B2) / 1e9   (0 if Iceberg is off)

raw       = cpu_cores / U_cpu / performance_score / 2      (2 vCPU per RPU)
nominal   = 2 × raw
adj       = 2                          if nominal < 9
          = max(4/3, 18 / nominal)     if nominal < 93
          = max(96/93, 124 / nominal)  otherwise
cpu RPUs  = raw × adj
```

The adjustment factor scales small CPU requirements up the most: it is a flat 2× below 9 nominal vCPUs and tapers toward 96/93 for large ones. `performance_score` is a per-cloud divisor applied to CPU only. The coefficient names above are the constants in the script.

**Known issue.** `ICEBERG_B2` is negative, so the Iceberg term goes negative once `message_size > (ICEBERG_B0 + fields × ICEBERG_B1) / −ICEBERG_B2`, which is roughly 1,700 + 60 × fields bytes with the current constants. CPU is then understated (the total can be negative). This is left as-is pending the model owner; see TODOs in [SOURCES.md](SOURCES.md).

## Broker Layout Optimizer

For the required RPUs on the chosen cloud, every instance type in that cloud's catalog is a candidate:

```
brokers  = 3 × ceil(required / (rpu_per_broker × 3))   multi-AZ
         = ceil(required / rpu_per_broker)             single-AZ
supported = brokers × rpu_per_broker
utilization = required / supported
```

1. Drop candidates that need more than the maximum broker count (24).
2. Rank the rest by a fitness score that peaks at half the maximum broker count: `(−b² + 24b) / 144`.
3. Choose the candidate with the **highest utilization**. Ties go to the higher fitness score, which means a broker count closer to 12. If fitness also ties, the choice depends on sort order and is not defined, because the sort comparator never returns 0.

If nothing fits, the result has an `error` and no deployment.

## Parts of the Model That Don't Affect the Result

The model carries some values that no constraint uses: per-RPU disk size and connection count, the `append_chunk` tunable, local retention, the connections utilization target, and the consumer count (validated but not used). Changing them doesn't change any sizing. Disk capacity driven by retention is **not** modelled.

## Changing the Model

All model values live in `scripts/sizing.js`: the `*ComputeUnit` classes (per-RPU capacities), `SUPPORTED_BROKER_INSTANCES` (instance catalog), `MAX_BROKERS_SUPPORTED`, the `Tunables` defaults, and the CPU and Iceberg coefficients.

1. Change the value in the script only. Don't copy values into `SKILL.md` or these references; they point at `--model` instead.
2. Run `node --test scripts/sizing.test.js`. Golden-value tests will fail on purpose when the model changes. Update the expected values in the same change.
3. In the PR description, include before/after output for at least one representative workload so reviewers can see the sizing impact.
4. If the change adds a cloud or a constraint, update the constraint table above and [Inputs and Outputs](inputs-and-outputs.md).
