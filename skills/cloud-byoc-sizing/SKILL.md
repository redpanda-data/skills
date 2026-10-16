---
name: cloud-byoc-sizing
description: >-
  Estimates the Redpanda Compute Units (RPUs) and the supported broker deployment that a
  Kafka workload needs on AWS, GCP or Azure, for a single point in time or as a projection
  over months or quarters, by running a bundled zero-dependency sizing script. Use when
  sizing or capacity-planning a BYOC cluster from ingress and egress throughput and
  partition counts; working out how many RPUs or brokers a workload needs and which
  resource limit drives that number; projecting cluster size and RPU-hours as a workload
  grows or as new workloads come online; finding the month a growing workload must scale
  up or outgrows a single cluster; or comparing the sizing of one workload across clouds.
  For provisioning the cluster once it is sized, see `/redpanda:cloud-byoc`; for fully
  Redpanda-managed clusters, see `/redpanda:cloud-dedicated`.
---

Source: the sizing model in [`scripts/sizing.js`](scripts/sizing.js) (this skill is not grounded in product source). File-by-file mapping in [references/SOURCES.md](references/SOURCES.md).

# Redpanda Cloud BYOC: Workload Sizing

This skill turns a workload description (throughput, partitions, latency target, optional Iceberg and Tiered Storage) into a cluster size: the **required RPUs** (fractional, the theoretical minimum), the **supported RPUs** (rounded up to a real broker layout), and the **deployment** (broker count × instance type). It can also run a **projection**: the same calculation per month or quarter as the workload grows, with the points where the cluster has to scale and the total RPU-hours.

An RPU is 2 vCPUs and 8 GB of memory. Every constraint except partition count is sized at a target utilization (80% by default; see `--model`), so the result already carries headroom.

**Always run the script; never estimate RPUs by hand.** The model has eight interacting constraints and a broker-layout optimizer, and small input changes move the answer.

The script is `scripts/sizing.js` in this skill's directory (Node.js 18+, no dependencies). Run it from the skill's base directory, or use its absolute path. Output is JSON on stdout.

## Quickstart

```bash
# One workload, point in time. --cloud and --az are required.
node scripts/sizing.js --cloud AWS --az multi --partitions 1000 --ingress 50 --egress 150

# Same workload on all three clouds, single-AZ, 50 ms latency target
node scripts/sizing.js --cloud all --az single --partitions 1000 --ingress 50 --egress 150 --latency 50

# 12-month projection at 8% monthly growth, as CSV
node scripts/sizing.js --cloud GCP --az multi --partitions 1000 --ingress 50 --egress 150 \
  --months 12 --monthly-growth 8 --start 2027-01 --format csv

# Several workloads, or a phased plan, from a JSON file (must set "cloud" and "multi_az")
node scripts/sizing.js --input resources/sizing-phased-plan.json

# Print the model's capacities, instance catalog, and defaults
node scripts/sizing.js --model
```

## Gathering Inputs

**Do not run the script until you have all five required inputs.** None of them has a default, and the script rejects a run that omits any of them. Never assume a cloud provider or an AZ mode; both can change the answer substantially.

| Required input | Flag | Ask as |
|---|---|---|
| Cloud provider | `--cloud AWS\|GCP\|AZURE\|all` | "AWS, GCP or Azure? (Or compare all three.)" |
| Single-AZ or multi-AZ | `--az single\|multi` | "Single availability zone, or spread across three AZs?" |
| Partition count | `--partitions` | "How many partitions in total (not counting replicas)?" |
| Ingress, MB/s | `--ingress` | "Peak producer throughput into the cluster, before replication?" |
| Egress, MB/s | `--egress` | "Peak consumer throughput out, across all consumer groups?" |

| Optional input | Flag | Default |
|---|---|---|
| Latency target, ms | `--latency` | `100`. Offer it alongside the required questions. |
| Producers / consumers | `--producers` / `--consumers` | throughput ÷ 10 MB/s, rounded up |
| Average message size, bytes | `--message-size` | `1000` |
| Replication factor (odd) | `--rf` | `3` |
| Tiered Storage | `--tiered-storage true\|false` | `true` |
| Iceberg topics | `--iceberg-fields <n>` | off; `n` = schema field count |

**How to ask.** Take whatever the user has already said, then ask for every missing required input **in one message**, offering the latency target as optional in the same message. If your environment has a structured question tool, use it: multiple choice for cloud provider (AWS / GCP / Azure / compare all) and AZ mode (single-AZ / multi-AZ); free text for partitions, ingress, egress and latency. Do not ask about the other optional inputs unless the user brings them up. Use their defaults and list them with the result.

If the user can't give a number ("we don't know the partition count yet"), ask for their best estimate or a range, and offer to run the low and high ends so they can see how much it moves the result. Do not pick a value silently.

For a projection, the required inputs describe the **starting** workload; ask for the growth rate or the per-period numbers as well (see below). Cloud provider and AZ mode apply to the whole projection.

Convert other units to MB/s first and say so: 1 GB/s = 1,000 MB/s; 1 Gbps = 125 MB/s; GB/day ÷ 86.4 = MB/s; TB/day ÷ 0.0864 = MB/s. If the user gives only a fan-out ("3 consumer groups reading everything"), egress = ingress × fan-out.

Multiple workloads that share one cluster, and per-workload options, go in a JSON file passed with `--input`. See [Inputs and Outputs](references/inputs-and-outputs.md) for the full schema.

## Projections Over Time

Use a projection whenever the user mentions growth, a ramp, a timeline, phases, or "how big in N months". There are two input styles:

- **Growth rate.** A starting workload plus `--monthly-growth P` or `--annual-growth P` (percent, compounded monthly), over `--months N` (default 12) from `--start YYYY-MM` (default: the current month). Partitions grow at the same rate unless you pass `--partition-monthly-growth` or `--partition-annual-growth`; use `0` for a fixed partition count.
- **Explicit periods.** A `periods` array in JSON, one entry per month or quarter, each with its own `workloads`. Use this when the user has specific numbers per period, or when new workloads start partway through ("add an Iceberg pipeline in Q2"). If they give only a few points ("50 MB/s now, 200 by June, flat after"), build monthly periods, interpolate linearly between the points, and say that you interpolated.

Period labels `YYYY-MM`, `YYYY-Qn` and `YYYY` get the correct RPU-hours for their length; any other label counts as 730 hours unless the period sets `"hours"`. `--cloud all` and `--format csv` both work in projection mode.

## Reading the Output

A point-in-time result carries `required_rpu`, `supported_rpu`, `deployment`, `utilization_pct`, `binding_constraint`, and `rpu_by_constraint`, which gives the RPUs each constraint would need on its own. The binding constraint is the largest of these:

| Constraint | What drives it |
|---|---|
| `kafka_ingress`, `kafka_egress` | Per-RPU Kafka produce and fetch throughput limits. Egress grows with consumer fan-out. |
| `network_in`, `network_out` | NIC bandwidth. In: ingress × replication factor. Out: consumer egress plus replication, Tiered Storage and Iceberg terms. |
| `write_iops` | Disk writes, plus Iceberg. Grows as batches shrink: lower latency targets and more producers. |
| `read_iops` | Disk reads: consumer egress, plus ingress when Tiered Storage is on, plus Iceberg. Differs most between clouds. |
| `cpu` | Grows with batches per second and egress/ingress ratio; Iceberg adds a per-field term. |
| `partitions` | Partition count per RPU, with no utilization factor. |

A projection result carries `periods[]`, a `summary` and `scaling_events[]`. Each period row has `period`, `ingress_mbps`, `egress_mbps`, `partitions`, `required_rpu`, `supported_rpu`, `deployment`, `utilization_pct`, `binding_constraint` and `rpu_hours` (no per-constraint breakdown; re-run that period point-in-time if you need it). The summary has start, end and peak RPUs, total RPU-hours, the scaling-event count, and the first period with an error and its reason. Scaling events list each change of deployment between two deployable periods.

For the per-RPU capacities, target utilizations and the instance catalog, run `node scripts/sizing.js --model`. Do not quote capacities from memory; they change when the model changes.

## Presenting Results

**Point in time.** Lead with one line: required → supported → deployment. For example: "You need **3.75 RPU**, which deploys as **6× m7gd.large (6 RPU, 62.5% utilized)** across three AZs on AWS." Then show a short `rpu_by_constraint` table with the binding constraint highlighted and explained in plain words, then the defaults you assumed.

**Cross-cloud.** One table: cloud, required RPU, supported RPU, deployment, utilization, binding constraint. Point out where the clouds differ and why (usually IOPS or network per RPU).

**Projection.** Lead with the arc: "Grows from **6 RPU** to **18 RPU** over 12 months, with **4 scale-ups** and **~92k RPU-hours** in total." Then:

1. A per-period table: period, ingress, egress, required RPU, supported RPU, deployment, utilization.
2. A chart of supported RPUs over time as a step line, with required RPUs as a second line, if a charting tool is available. The gap between the lines is headroom.
3. The scaling events as a short list ("2027-03: 6 → 9 brokers").
4. Any period above ~95% utilization in a growing projection, flagged as near capacity: the next growth step is likely to need a scale-up.
5. If `summary.first_unsupported_period` is set, read `summary.first_unsupported_reason`. If it is the 24-broker or 112,500-partition message, call it out prominently: that is when the workload outgrows a single cluster. Otherwise it is an input error in that period; fix the input and re-run.
6. An offer of the CSV for a spreadsheet.

## Errors and Limits

- **Known model issue:** with Iceberg on and large messages, the Iceberg CPU term can go negative, which understates CPU. This happens when the message size exceeds roughly 1,700 + 60 × (schema fields) bytes. In that case, say the CPU figure may be understated.

- `"error": "No supported deployment within 24 brokers."` (exit 0, `deployment: null`) means the workload needs more brokers than the model allows in one cluster. Suggest splitting it across clusters (re-run with the share each cluster would carry), and say a larger layout needs a sizing conversation with Redpanda.
- `max 112,500 partitions per cluster` (exit 1) is the model's partition cap; the same advice applies.
- `missing required input: ...` lists everything that's missing. Ask the user for all of it in one message, as described in Gathering Inputs. Do not fill the gaps with guesses and re-run.
- Any other `error` is an input problem; explain it plainly and ask for a corrected value. Common ones: an even replication factor (must be odd), an unrecognised AZ value, or zero throughput.
- In a projection, a bad period gets its own `error` and the other periods still run.

## From Sizing to Provisioning

BYOC clusters are created with a **throughput tier**, not a broker count, so this estimate does not map one-to-one to a `ClusterCreate` field. Use the sizing result (and, for a projection, the peak period) to choose a tier whose published limits cover the workload, using the live tier list and the provisioning flow in `/redpanda:cloud-byoc`. The sizing is an estimate for planning; confirm production sizing with Redpanda before committing to a tier.

## Reference Directory

- [Inputs and Outputs](references/inputs-and-outputs.md): Every CLI flag and JSON key (workloads, `growth`, `periods`), defaults, unit conversions, and every field in the point-in-time, cross-cloud, projection and CSV outputs.
- [Sizing Model](references/sizing-model.md): How the model works — the eight constraints and their formulas, the CPU adjustment, batch sizing from the latency target, Iceberg and Tiered Storage effects, the broker-layout optimizer, and how to change the model safely.
- [scripts/sizing.js](scripts/sizing.js): The calculator. `--help` for usage, `--model` for the current constants.
- [scripts/sizing.test.js](scripts/sizing.test.js): Golden-value and invariant tests. Run with `node --test scripts/sizing.test.js`.
- [resources/](resources/): Example inputs — `sizing-single-workload.json`, `sizing-multi-workload.json`, `sizing-growth-plan.json`, `sizing-phased-plan.json`.
- [README.md](README.md): Human-facing guide with worked examples.
