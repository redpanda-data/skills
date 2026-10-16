# cloud-byoc-sizing

Workload sizing for Redpanda Cloud BYOC. Describe a Kafka workload (throughput, partitions,
latency target) and get back how many **Redpanda Compute Units (RPUs)** it needs, which
resource limit drives that number, and the broker layout that fits. You can do this for
today's workload, or as a **projection over time** that shows when the cluster has to scale
and how many RPU-hours it uses.

The skill wraps a zero-dependency Node.js calculator, so the numbers come from the model
every time, never from an estimate.

## Install

The skill ships with the `redpanda` plugin. Install the plugin as described in the
[repository README](../../README.md#installation), then invoke it with `/redpanda:cloud-byoc-sizing`
or just ask a sizing question; the agent loads it automatically.

To run the calculator on its own you only need [Node.js](https://nodejs.org/) 18 or later.

## Using It Through the Agent

Ask in plain language. Before sizing anything, the agent makes sure it has the five
required inputs: **cloud provider**, **single-AZ or multi-AZ**, **partition count**,
**ingress** and **egress**. It asks for whatever is missing in one message and offers the
**latency target** as optional. Everything else uses defaults, which it lists with the result.

> How many RPUs do I need for 50 MB/s in, 150 MB/s out and 1,000 partitions on AWS, multi-AZ?

> Size a cluster for 50 MB/s in and 150 out.
> *(The agent asks for the cloud provider, single- or multi-AZ, the partition count and,
> optionally, a latency target before it runs anything.)*

> Size 200 MB/s ingress with three consumer groups reading everything, 3,000 partitions. Compare AWS, GCP and Azure.

> We're at 50 MB/s in, 150 out today and expect to double in a year. Show me cluster size by month for 2027.

> Q1 we run the orders pipeline (50 in / 150 out, 1,000 partitions). In Q2 we add a 30 MB/s Iceberg pipeline with 20 fields. In Q3 orders grows to 120 in / 360 out. Size each quarter.

> When does a 1.5 GB/s workload growing 300% a year outgrow a single cluster?

## Running the Calculator Directly

From this directory:

```bash
# Point in time (--cloud and --az are required)
node scripts/sizing.js --cloud AWS --az multi --partitions 1000 --ingress 50 --egress 150

# All three clouds, with a 50 ms latency target
node scripts/sizing.js --cloud all --az multi --partitions 3000 --ingress 200 --egress 600 --latency 50

# 12-month projection at 100% annual growth, as CSV for a spreadsheet
node scripts/sizing.js --cloud AWS --az single --partitions 1000 --ingress 50 --egress 150 \
  --months 12 --annual-growth 100 --start 2027-01 --format csv

# From a plan file (multiple workloads, growth, or explicit periods; must set "cloud" and "multi_az")
node scripts/sizing.js --input resources/sizing-phased-plan.json

# Help and the current model constants
node scripts/sizing.js --help
node scripts/sizing.js --model
```

Output is JSON (or CSV in projection mode with `--format csv`). Invalid input exits with
status 1 and `{"error": "..."}`.

## Inputs at a Glance

| You provide | Default if omitted |
|---|---|
| Cloud provider (AWS, GCP, Azure, or all three) | **required** |
| Single-AZ or multi-AZ | **required** |
| Partition count | **required** |
| Ingress MB/s | **required** |
| Egress MB/s | **required** |
| Latency target (optional, but the agent asks) | 100 ms |
| Producers / consumers | one per 10 MB/s |
| Message size | 1,000 bytes |
| Replication factor | 3 |
| Tiered Storage | on |
| Iceberg topics | off |

For projections, add a growth rate (`--monthly-growth` or `--annual-growth`) or write a plan
file with one entry per month or quarter. Full details:
[references/inputs-and-outputs.md](references/inputs-and-outputs.md).

## Worked Examples

### One workload, three clouds

`--cloud all --az multi --partitions 3000 --ingress 200 --egress 600`:

| Cloud | Required RPU | Supported RPU | Deployment | Utilization | Binding constraint |
|---|---|---|---|---|---|
| AWS | 15 | 15 | 15x m7gd.large | 100% | kafka_egress |
| GCP | 15 | 15 | 15x n2d-standard-2 | 100% | kafka_egress |
| Azure | 27.1 | 30 | 15x Standard_D4d_v5 | 90.4% | read_iops |

On AWS and GCP the Kafka egress limit sets the size. On Azure, lower disk IOPS per RPU makes
read IOPS the limit, so it needs nearly twice the RPUs. 100% utilization here is fine:
every constraint except partition count is already sized at a target utilization (80% by
default), so headroom is built in.

### A growing workload

[`resources/sizing-growth-plan.json`](resources/sizing-growth-plan.json) (AWS, multi-AZ): 50 MB/s in,
150 MB/s out and 1,000 partitions in January 2027, with throughput growing at 100% a year
and partitions at 50% a year (compounded monthly, so December is at about 1.9× and 1.45×):

| Period | Ingress | Egress | Required RPU | Supported RPU | Deployment | Utilization |
|---|---|---|---|---|---|---|
| 2027-01 | 50.0 | 150.0 | 3.75 | 6 | 6x m7gd.large | 62.5% |
| 2027-04 | 59.5 | 178.4 | 4.46 | 6 | 6x m7gd.large | 74.3% |
| 2027-07 | 70.7 | 212.1 | 5.30 | 6 | 6x m7gd.large | 88.4% |
| 2027-09 | 79.4 | 238.1 | 5.95 | 6 | 6x m7gd.large | 99.2% |
| 2027-10 | 84.1 | 252.3 | 6.31 | 9 | 9x m7gd.large | 70.1% |
| 2027-12 | 94.4 | 283.2 | 7.08 | 9 | 9x m7gd.large | 78.7% |

One scale-up (6 → 9 brokers in October), about 59k RPU-hours for the year. September at
99% is the signal to plan the scale-up.

These figures come from the model at the time of writing; run the commands to get current
numbers.

## Reading the Results

- **Required RPU** is the theoretical minimum and can be fractional.
- **Supported RPU** is what actually gets deployed: broker count × RPUs per broker. Across
  multiple AZs, brokers come in multiples of three.
- **Binding constraint** is the resource that sets the size: Kafka throughput, network,
  disk IOPS, CPU or partitions. Knowing it tells you what would change the answer (for
  example, a longer latency target lowers write IOPS; turning Tiered Storage off lowers
  network out).
- **RPU-hours** (projections) is supported RPUs × hours in each period, using the real length
  of each month or quarter.

How each constraint is calculated: [references/sizing-model.md](references/sizing-model.md).

## Limits and Assumptions

- The model caps a cluster at 24 brokers and 112,500 partitions. A workload that needs more
  brokers gets a result with no deployment and an error. More partitions is rejected as
  invalid input. Either way, split it across clusters or talk to Redpanda.
- Replication factor must be odd.
- Disk capacity driven by retention is not modelled.
- With Iceberg on and large messages, the model's Iceberg CPU term goes negative and
  understates CPU (see [references/sizing-model.md](references/sizing-model.md)).
- BYOC clusters are provisioned by **throughput tier**, not broker count. Use the sizing
  result to pick a tier that covers the workload (see `/redpanda:cloud-byoc`), and confirm
  production sizing with Redpanda.
- This is a planning estimate, not a price. Feed `supported_rpu` or `rpu_hours` into your
  pricing process separately.

## Files

```
cloud-byoc-sizing/
├── SKILL.md                         # what the agent loads
├── README.md                        # this file
├── scripts/
│   ├── sizing.js                    # the calculator and the model
│   └── sizing.test.js               # tests
├── references/
│   ├── inputs-and-outputs.md        # every flag, JSON key and output field
│   ├── sizing-model.md              # how the model works; how to change it
│   └── SOURCES.md                   # source map for maintainers
└── resources/
    ├── sizing-single-workload.json
    ├── sizing-multi-workload.json
    ├── sizing-growth-plan.json
    └── sizing-phased-plan.json
```

## Testing and Changing the Model

```bash
node --test scripts/sizing.test.js
```

The tests pin known outputs ("golden values") and check invariants: supported ≥ required,
multi-AZ broker counts in multiples of three, correct period hours, and every example
file runs cleanly. If you change a model constant on purpose, the golden tests fail. Update
them in the same change and include before/after output in the PR. See "Changing the Model"
in [references/sizing-model.md](references/sizing-model.md).
