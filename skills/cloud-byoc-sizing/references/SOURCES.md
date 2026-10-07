# cloud-byoc-sizing Skill Source Map

Maps each file in `skills/cloud-byoc-sizing/` to what its claims derive from, so
maintainers know where to verify them.

**This skill is not grounded in product source.** Unlike the other `cloud-*` skills, its
claims come from the bundled sizing model in `scripts/sizing.js`, not from `cloudv2`
protos or the Cloud docs. The model is the source of truth for every number the skill
produces, and the docs describe the model's formulas and I/O, not product behavior.

**Maintenance scope.** No sync routine maintains this skill. The Cloud skills sync
routine covers `cloud-serverless`, `cloud-byoc` and `cloud-dedicated` only (see
`MAINTAINING.md`) and should treat this skill as out of scope despite the `cloud-` prefix: there is no
`cloudv2` or `cloud-docs` path to verify it against, and Cloud releases do not by
themselves require a change here. Changes are made by hand, following "Changing the
Model" in [sizing-model.md](sizing-model.md). The drift audit should check only that the
docs still match the script (run the tests and the examples), not re-derive the model.

## File-to-source table

| Skill file | Derives from |
|---|---|
| `SKILL.md` | `scripts/sizing.js` (`main` CLI flags and defaults, `sizeCluster` and `sizeTimeline` output fields, `describeModel`); the throughput-tier pointer defers to `/redpanda:cloud-byoc` |
| `references/inputs-and-outputs.md` | `scripts/sizing.js`: `USAGE`, `parseArgs`, `toBool`, `parseAz` (accepted AZ values), `main` (required inputs and the combined "missing required input" error, mode selection and precedence), `buildWorkload` (per-workload keys and defaults), `expandGrowth` (growth keys and compounding), `hoursInPeriod` (label formats), `sizeCluster` / `sizeTimeline` (output fields), `KafkaRequirement` / `TimeBasedLatencyRequirement` (validation messages) |
| `references/sizing-model.md` | `scripts/sizing.js`: `TimeBasedLatencyRequirement` / `SizeBasedLatencyRequirement` (batch size), `Workload` (`riops4`, `wiops4`, `cpuProduce`, `cpuFetch`, `cpuIceberg`, `egressBytes`), `ClusterRequirement.calculateRequiredComputeUnits*` (the eight constraints, CPU adjustment), `SupportedMachineType` and `HardwareConstrantOptimizer` (layout, fitness, utilization tie-break) |
| `scripts/sizing.js` | The sizing model itself: per-cloud compute-unit capacities, the supported instance catalog, and the CPU, IOPS and Iceberg coefficients |
| `scripts/sizing.test.js` | `scripts/sizing.js` (golden values pin the model's current output) |
| `resources/*.json` | Input schema in `references/inputs-and-outputs.md` |
| `README.md` | All of the above |

## Deferred to live introspection

Do not copy these into `SKILL.md`, `references/` or `README.md`. They change when the
model changes and are printed by `node scripts/sizing.js --model`:

- Per-RPU capacities per cloud (Kafka ingress/egress, network, read/write IOPS, partitions, CPU performance score)
- The supported instance catalog and RPUs per broker

The docs do state the input defaults (in flag tables), the 80% default target utilization,
and the 24-broker and 112,500-partition caps. These are part of the tool's interface. If
any of them changes in the script, update every doc that states it in the same change
(`grep -rn` for the old value).

Throughput tiers for provisioning are deferred to `/redpanda:cloud-byoc` and its live
tier list.

Example outputs in the docs (for example "6x m7gd.large") are illustrations of the output
shape, produced by the model at the time of writing; the golden tests keep the main one
honest.

## TODO / re-verify

- **Model ownership.** Record which team owns the sizing model's constants and how changes
  to them are approved, so that hand edits to `scripts/sizing.js` have a reviewer.
- **Tier mapping.** The skill says the estimate does not map one-to-one to a BYOC
  `throughput_tier` and points to `/redpanda:cloud-byoc` for choosing one. If a published
  mapping from RPUs to tiers exists, link it from `SKILL.md` instead of leaving the choice
  to the user.
- **Dedicated applicability.** The skill is scoped to BYOC. Confirm whether the same model
  applies to Dedicated clusters before widening the description.
- **Negative Iceberg CPU.** `ICEBERG_B2` is negative, so `Workload.cpuIceberg` goes
  negative for messages larger than about 1,700 + 60 × fields bytes and understates CPU.
  The docs disclose it. Confirm the intended coefficient (or a clamp at zero) with the
  model owner, then fix the script, update the golden tests, and remove the "Known issue"
  notes from `SKILL.md`, `README.md` and `references/sizing-model.md`.
- **Unused model inputs.** Per-RPU disk and connection counts, `append_chunk`, local
  retention and consumer count are carried but unused (see sizing-model.md). Confirm with
  the model owner whether that is intentional before documenting them as inputs.

## Usage

To verify the skill, run from the repo root:

```bash
node --test skills/cloud-byoc-sizing/scripts/sizing.test.js
for f in skills/cloud-byoc-sizing/resources/*.json; do
  node skills/cloud-byoc-sizing/scripts/sizing.js --input "$f" > /dev/null || echo "FAIL $f"
done
```

Then read each doc against the functions listed in the table above.
