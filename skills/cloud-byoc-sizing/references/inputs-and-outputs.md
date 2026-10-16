Source: [`scripts/sizing.js`](../scripts/sizing.js) (`main`, `buildWorkload`, `expandGrowth`, `sizeCluster`, `sizeTimeline`). File-by-file mapping in [SOURCES.md](SOURCES.md).

# Inputs and Outputs

Everything the sizing script accepts and returns. Run `node scripts/sizing.js --help` for the short form.

## Modes

| Mode | Triggered by | Output |
|---|---|---|
| Point in time | `--ingress`, `--egress`, `--partitions` flags, or `--input` with `workloads` only | One result object |
| Cross-cloud | `--cloud all` (either mode) | An array of results, one per cloud: AWS, GCP, Azure |
| Projection (growth) | `--months`, `--monthly-growth` or `--annual-growth` flags, or `--input` with `workloads` + `growth` | One timeline object |
| Projection (explicit) | `--input` with `periods` | One timeline object |
| Model | `--model` | The model's constants |
| Help | `--help`, or no arguments | Usage text |

**Required in every mode:** cloud provider and AZ mode, plus ingress, egress and partitions for each workload. None of them has a default; if any is missing, the script exits 1 and its error lists everything missing at once.

When `--input` is used, `cloud` and `multi_az` come from the file. If the file omits one, the matching flag (`--cloud`, `--az`/`--multi-az`) is used as a fallback; if neither is set, it's an error. A value in the file wins over the flag, so `--cloud all` has no effect on a file that sets `cloud`. The workload and growth flags are ignored with `--input`; only `--format` still applies. If a file has both `periods` and `growth`, `periods` wins and `growth` is ignored. If both a monthly and an annual rate are given, the monthly rate wins.

## CLI Flags

| Flag | Meaning | Default |
|---|---|---|
| `--cloud <c>` | `AWS`, `GCP`, `AZURE` (case-insensitive) or `all` | **required** |
| `--az single\|multi` | Availability zones. `multi` rounds brokers up to a multiple of 3 | **required** (this or `--multi-az`) |
| `--multi-az true\|false` | Same as `--az`; `true` = multi-AZ | **required** (this or `--az`) |
| `--partitions <n>` | Partition count (not replicas), integer, ≤ 112,500 | **required** |
| `--ingress <MB/s>` | Producer throughput, before replication | **required** |
| `--egress <MB/s>` | Consumer throughput, all consumer groups combined | **required** |
| `--latency <ms>` | Latency target; sets the producer batch size | `100` |
| `--producers <n>` | Producer count; affects batch size | `ceil(ingress / 10)` |
| `--consumers <n>` | Consumer count (validated; does not change the result) | `ceil(egress / 10)` |
| `--message-size <bytes>` | Average message size, integer. Floor for the batch size (which is still capped at 1 MB); also an input to Iceberg CPU | `1000` |
| `--rf <n>` | Replication factor; must be odd | `3` |
| `--tiered-storage <bool>` | Adds Tiered Storage upload and read traffic | `true` |
| `--iceberg-fields <n>` | Enables Iceberg topics with `n` schema fields | off |
| `--months <n>` | Projection length in months | `12` |
| `--monthly-growth <pct>` | Throughput growth per month, compounding | — |
| `--annual-growth <pct>` | Throughput growth per year, applied monthly as `(1 + pct/100)^(1/12) − 1` | — |
| `--partition-monthly-growth <pct>` | Partition growth per month | same as throughput |
| `--partition-annual-growth <pct>` | Partition growth per year | same as throughput |
| `--start <YYYY-MM>` | First projected month | current month (UTC) |
| `--format csv` | CSV instead of JSON (projection mode only) | JSON |
| `--model` | Print the model's capacities, instance catalog and defaults | — |

The AZ value is strict: multi-AZ is `multi`, `multi-az`, `true`, `yes`, `y` or `1`; single-AZ is `single`, `single-az`, `false`, `no`, `n` or `0`. Anything else is an error, so a typo is never quietly treated as multi-AZ. Other booleans (`--tiered-storage`) treat `false`, `0`, `no`, `n` and `single` as false and anything else as true. Passing only `--months` without a growth rate projects a flat workload.

## Unit Conversions

| From | To MB/s |
|---|---|
| GB/s | × 1,000 |
| Gbps | × 125 |
| MB/min | ÷ 60 |
| GB/hour | ÷ 3.6 |
| GB/day | ÷ 86.4 |
| TB/day | ÷ 0.0864 (≈ × 11.57) |
| Messages/s × average bytes | ÷ 1,000,000 |

## JSON Input

```json
{
  "cloud": "AWS",
  "multi_az": true,
  "workloads": [ { "ingress_mbps": 50, "egress_mbps": 150, "partitions": 1000 } ],
  "growth": { "months": 12, "annual_pct": 100, "partition_annual_pct": 0, "start": "2027-01" },
  "periods": [ { "label": "2027-Q1", "hours": 2160, "workloads": [ ... ] } ]
}
```

### Top level

| Key | Type | Notes |
|---|---|---|
| `cloud` | string | **Required.** `AWS`, `GCP`, `AZURE` or `all` |
| `multi_az` | bool | **Required.** `true` for multi-AZ, `false` for single-AZ. The strings `"multi"`/`"single"` also work. |
| `workloads` | array | Required unless `periods` is given. All workloads share one cluster; their requirements are summed. |
| `growth` | object | Expands `workloads` into monthly periods |
| `periods` | array | Explicit projection; takes precedence over `growth` |

### Workload

| Key | Type | Default |
|---|---|---|
| `ingress_mbps` | number > 0 | required |
| `egress_mbps` | number > 0 | required |
| `partitions` | integer > 0 | required |
| `latency_ms` | number > 0 | `100` |
| `batch_size_bytes` | number | unset. If set, it replaces the latency target with a fixed batch size, bypassing the 1 MB cap and the message-size floor. Not validated, so pass a positive value. |
| `producers` | integer | `ceil(ingress_mbps / 10)` |
| `consumers` | integer | `ceil(egress_mbps / 10)` |
| `message_size_bytes` | integer | `1000` |
| `replication_factor` | odd integer | `3` |
| `tiered_storage` | JSON boolean | `true`. Only the boolean `false` turns it off; the string `"false"` does not. |
| `iceberg_fields` | integer | unset (Iceberg off) |

### `growth`

| Key | Notes |
|---|---|
| `months` | Default `12` |
| `monthly_pct` or `annual_pct` | One is required |
| `partition_monthly_pct` or `partition_annual_pct` | Default: same rate as throughput. Use `0` to hold partitions flat. |
| `start` | `YYYY-MM`; default current month. Labels become `YYYY-MM`; a non-`YYYY-MM` start gives labels `M0`, `M1`, … |

Growth scales ingress and egress by the same factor (the egress/ingress ratio stays constant). Partitions are rounded up each period. An explicit `producers`/`consumers` count is scaled by the throughput factor and rounded up; otherwise the default is recomputed from that period's throughput.

### `periods[]`

| Key | Notes |
|---|---|
| `label` | `YYYY-MM`, `YYYY-Qn` or `YYYY` give the exact RPU-hours for that period (leap years included). Any other label counts as 730 hours. |
| `hours` | Optional; overrides the hours used for `rpu_hours` |
| `workloads` | Same shape as the top-level `workloads` |

Ready-made examples are in [`resources/`](../resources/).

## Point-in-Time Output

```json
{
  "cloud": "AWS",
  "multi_az": true,
  "required_rpu": 3.75,
  "binding_constraint": "kafka_egress",
  "rpu_by_constraint": {
    "cpu": 0.046, "read_iops": 1.82, "write_iops": 2.752,
    "network_in": 1.667, "network_out": 3.333,
    "kafka_ingress": 3.749, "kafka_egress": 3.75, "partitions": 1.499
  },
  "totals": { "ingress_mbps": 50, "egress_mbps": 150, "partitions": 1000,
              "partition_replicas": 3000, "producers": 5, "consumers": 15 },
  "supported_rpu": 6,
  "deployment": "6x m7gd.large",
  "broker_count": 6,
  "instance_type": "m7gd.large",
  "rpu_per_broker": 1,
  "utilization_pct": 62.5
}
```

| Field | Meaning |
|---|---|
| `required_rpu` | Theoretical minimum (max of `rpu_by_constraint`), 3 decimals |
| `binding_constraint` | The constraint that sets `required_rpu` |
| `rpu_by_constraint` | RPUs each constraint would need on its own |
| `totals` | Summed inputs across workloads, after defaults |
| `supported_rpu` | RPUs actually deployed: `broker_count × rpu_per_broker` |
| `deployment` | `<broker_count>x <instance_type>` |
| `broker_count`, `instance_type`, `rpu_per_broker` | The parts of `deployment` |
| `utilization_pct` | `required_rpu / supported_rpu`, on top of the built-in 80% target |
| `error` | Present (with `supported_rpu` and `deployment` null) when no layout fits within the broker limit |

## Projection Output

```json
{
  "cloud": "AWS",
  "multi_az": true,
  "periods": [
    { "period": "2026-11", "ingress_mbps": 50, "egress_mbps": 150, "partitions": 1000,
      "required_rpu": 3.75, "supported_rpu": 6, "deployment": "6x m7gd.large",
      "utilization_pct": 62.5, "binding_constraint": "kafka_egress", "rpu_hours": 4320 }
  ],
  "summary": {
    "start_rpu": 6, "end_rpu": 18, "peak_rpu": 18, "peak_period": "2027-09",
    "total_rpu_hours": 92232, "scaling_event_count": 4,
    "first_unsupported_period": null, "first_unsupported_reason": null
  },
  "scaling_events": [
    { "period": "2027-03", "from": "6x m7gd.large", "to": "9x m7gd.large", "from_rpu": 6, "to_rpu": 9 }
  ]
}
```

| Field | Meaning |
|---|---|
| `periods[].rpu_hours` | `supported_rpu × hours in the period`; null when no layout fits. A period with invalid input has only `period` and `error`. |
| `periods[].error` | Set for a period that is unsupported or has invalid input; other periods still run |
| `summary.total_rpu_hours` | Sum over supported periods only |
| `summary.first_unsupported_period` / `first_unsupported_reason` | First period with an `error`, and its message. This covers both "too large" and invalid input, so check the reason. |
| `scaling_events` | Every change of deployment between two consecutive deployable periods, including changes of instance type |

The broker count is not guaranteed to rise monotonically: when the optimizer switches to a larger instance type, the broker count can drop (for example 15x m7gd.large → 9x m7gd.xlarge) while supported RPUs jump by more than the requirement grew.

## CSV Output

Projection mode with `--format csv`. One header row, then one row per period per cloud:

```
cloud,period,ingress_mbps,egress_mbps,partitions,required_rpu,supported_rpu,deployment,utilization_pct,binding_constraint,rpu_hours,error
```

## Errors

Invalid input exits with status 1 and prints `{"error": "<message>"}`. Messages include:

| Message | Fix |
|---|---|
| `missing required input: <list>` | Supply everything listed: cloud provider, AZ mode and, on the command line, partitions/ingress/egress |
| `invalid availability zones value "<v>"` | Use `single` or `multi` |
| `... missing required field: <field>` | A workload in an input file lacks `ingress_mbps`, `egress_mbps` or `partitions` |
| `replication factor must be odd` | Use 1, 3 or 5 |
| `max 112,500 partitions per cluster` | The model's partition cap; split across clusters |
| `<x> is not an integer.` | Partitions, producers, consumers, message size and replication factor must be whole numbers |
| `ingress must be > 0` / `egress must be > 0` | Throughput must be positive |
| `Invalid cloudProvider ...` | Use `AWS`, `GCP`, `AZURE` or `all` |
| `growth needs monthly_pct or annual_pct` | Add a growth rate to the `growth` object |
