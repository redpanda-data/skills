'use strict';

// Run: node --test skills/cloud-byoc-sizing/scripts/sizing.test.js
// Zero dependencies (Node.js 18+ built-in test runner).
//
// The "golden" cases pin the model's current output. If you change a model
// constant on purpose, update the expected values here in the same change so
// reviewers see the sizing impact.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const S = require('./sizing.js');

const SCRIPT = path.join(__dirname, 'sizing.js');
const RESOURCES = path.join(__dirname, '..', 'resources');
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

const base = { ingress_mbps: 50, egress_mbps: 150, partitions: 1000 };

// --- golden cases ---------------------------------------------------------

test('golden: 50/150 MB/s, 1000 partitions, AWS multi-AZ', () => {
  const required = S.CALCULATE_RPU_SIMPLE('AWS', true, 1000, 50, 150, 100);
  assert.equal(required, 3.75);
  assert.equal(S.CALCULATE_RPU_SUPPORTED('AWS', required, true), 6);
  assert.equal(S.CALCULATE_RPU_OPTIMAL_DEPLOYMENT('AWS', required, true), '6x m7gd.large');
});

test('golden: binding constraint and per-constraint breakdown', () => {
  const r = S.sizeCluster('AWS', [base], true);
  assert.equal(r.binding_constraint, 'kafka_egress');
  assert.equal(r.rpu_by_constraint.kafka_egress, 3.75);
  assert.equal(r.utilization_pct, 62.5);
});

test('golden: Azure is read-IOPS bound for 500/1500 MB/s single-AZ', () => {
  const r = S.sizeCluster('AZURE', [{ ingress_mbps: 500, egress_mbps: 1500, partitions: 5000, latency_ms: 50 }], false);
  assert.equal(r.binding_constraint, 'read_iops');
});

// --- invariants -----------------------------------------------------------

test('required RPU equals the max of the per-constraint breakdown', () => {
  for (const cloud of ['AWS', 'GCP', 'AZURE']) {
    const r = S.sizeCluster(cloud, [{ ingress_mbps: 120, egress_mbps: 300, partitions: 4000 }], true);
    const max = Math.max(...Object.values(r.rpu_by_constraint));
    assert.ok(Math.abs(max - r.required_rpu) < 0.001, cloud);
  }
});

test('supported RPU >= required, and multi-AZ broker counts are multiples of 3', () => {
  for (const cloud of ['AWS', 'GCP', 'AZURE']) {
    for (const mbps of [1, 5, 20, 50, 100, 250, 500, 1000]) {
      const r = S.sizeCluster(cloud, [{ ingress_mbps: mbps, egress_mbps: mbps * 3, partitions: 100 }], true);
      if (r.supported_rpu == null) continue;
      assert.ok(r.supported_rpu >= r.required_rpu, `${cloud} ${mbps}`);
      assert.equal(r.broker_count % 3, 0, `${cloud} ${mbps}`);
      assert.ok(r.broker_count <= 24);
    }
  }
});

test('multiple workloads sum their throughput and partitions', () => {
  const r = S.sizeCluster('GCP', [base, { ingress_mbps: 20, egress_mbps: 20, partitions: 200 }], true);
  assert.equal(r.totals.ingress_mbps, 70);
  assert.equal(r.totals.egress_mbps, 170);
  assert.equal(r.totals.partitions, 1200);
});

// --- validation -----------------------------------------------------------

test('even replication factor is rejected', () => {
  assert.throws(() => S.sizeCluster('AWS', [{ ...base, replication_factor: 2 }], true), /odd/);
});

test('more than 112,500 partitions is rejected', () => {
  assert.throws(() => S.sizeCluster('AWS', [{ ...base, partitions: 112501 }], true), /112,500/);
});

test('unknown cloud is rejected', () => {
  assert.throws(() => S.sizeCluster('OCI', [base], true), /cloudProvider/);
});

test('workload too large for 24 brokers returns an error, not a deployment', () => {
  const r = S.sizeCluster('AWS', [{ ingress_mbps: 20000, egress_mbps: 60000, partitions: 1000 }], true);
  assert.equal(r.deployment, null);
  assert.match(r.error, /24 brokers/);
});

// --- timeline -------------------------------------------------------------

test('period hours: month, quarter, year, fallback', () => {
  assert.equal(S.hoursInPeriod('2026-02'), 28 * 24);
  assert.equal(S.hoursInPeriod('2028-02'), 29 * 24);
  assert.equal(S.hoursInPeriod('2026-Q4'), 92 * 24);
  assert.equal(S.hoursInPeriod('2028'), 366 * 24);
  assert.equal(S.hoursInPeriod('phase-1'), 730);
});

test('annual growth compounds monthly: 100%/yr doubles after 12 months', () => {
  const periods = S.expandGrowth([base], { months: 13, annual_pct: 100, start: '2026-11' });
  assert.equal(periods.length, 13);
  assert.equal(periods[0].label, '2026-11');
  assert.equal(periods[12].label, '2027-11');
  assert.ok(Math.abs(periods[12].workloads[0].ingress_mbps - 100) < 1e-9);
});

test('partition growth can be held flat independently of throughput', () => {
  const periods = S.expandGrowth([base], { months: 6, monthly_pct: 10, partition_monthly_pct: 0 });
  assert.ok(periods.every(p => p.workloads[0].partitions === 1000));
});

test('timeline summary: scaling events, RPU-hours, first unsupported period', () => {
  const periods = S.expandGrowth([base], { months: 12, monthly_pct: 15, start: '2026-11' });
  const t = S.sizeTimeline('AWS', periods, true);
  assert.equal(t.periods.length, 12);
  assert.equal(t.summary.start_rpu, 6);
  assert.equal(t.summary.scaling_event_count, t.scaling_events.length);
  const hours = t.periods.reduce((a, p) => a + p.rpu_hours, 0);
  assert.equal(t.summary.total_rpu_hours, hours);
  assert.equal(t.summary.first_unsupported_period, null);

  const big = S.expandGrowth([{ ingress_mbps: 1500, egress_mbps: 4500, partitions: 1000 }],
    { months: 12, annual_pct: 300, start: '2026-11' });
  const t2 = S.sizeTimeline('AWS', big, true);
  assert.ok(t2.summary.first_unsupported_period, 'expected the projection to outgrow 24 brokers');
});

test('invalid period does not abort the whole timeline', () => {
  const t = S.sizeTimeline('AWS', [
    { label: 'ok', workloads: [base] },
    { label: 'bad', workloads: [{ ...base, replication_factor: 2 }] },
  ], true);
  assert.equal(t.periods[0].supported_rpu, 6);
  assert.match(t.periods[1].error, /odd/);
  assert.equal(t.summary.first_unsupported_period, 'bad');
  assert.match(t.summary.first_unsupported_reason, /odd/);
  assert.equal(t.scaling_events.length, 0, 'errored periods are not scaling events');
});

// --- CLI ------------------------------------------------------------------

test('CLI: --model prints the instance catalog', () => {
  const r = run('--model');
  assert.equal(r.status, 0);
  const m = JSON.parse(r.stdout);
  assert.ok(m.instance_catalog.length > 0);
  assert.deepEqual(m.compute_units.map(c => c.cloud), ['AWS', 'GCP', 'Azure']);
});

test('CLI: lists every missing required input in one error', () => {
  const r = run('--ingress', '50');
  assert.equal(r.status, 1);
  const err = JSON.parse(r.stdout).error;
  for (const want of [/cloud provider/, /availability zones/, /partition count/, /egress/]) {
    assert.match(err, want);
  }
  assert.doesNotMatch(err, /ingress MB\/s/);
});

test('CLI: cloud provider has no default', () => {
  const r = run('--az', 'multi', '--partitions', '1000', '--ingress', '50', '--egress', '150');
  assert.equal(r.status, 1);
  assert.match(JSON.parse(r.stdout).error, /cloud provider/);
});

test('CLI: AZ mode has no default, and --az / --multi-az agree', () => {
  const common = ['--cloud', 'AWS', '--partitions', '1000', '--ingress', '50', '--egress', '150'];
  const none = run(...common);
  assert.equal(none.status, 1);
  assert.match(JSON.parse(none.stdout).error, /availability zones/);

  const single = JSON.parse(run(...common, '--az', 'single').stdout);
  const singleFlag = JSON.parse(run(...common, '--multi-az', 'false').stdout);
  assert.equal(single.multi_az, false);
  assert.deepEqual(single, singleFlag);

  const multi = JSON.parse(run(...common, '--az', 'multi').stdout);
  assert.equal(multi.multi_az, true);
  assert.equal(multi.broker_count % 3, 0);
});

test('CLI: an unrecognised AZ value is rejected, not treated as multi-AZ', () => {
  const r = run('--cloud', 'AWS', '--az', 'mutli', '--partitions', '1000', '--ingress', '50', '--egress', '150');
  assert.equal(r.status, 1);
  assert.match(JSON.parse(r.stdout).error, /invalid availability zones/);
});

test('CLI: an input file must set cloud and multi_az', () => {
  const tmp = path.join(require('node:os').tmpdir(), `sizing-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ workloads: [base] }));
  try {
    const r = run('--input', tmp);
    assert.equal(r.status, 1);
    const err = JSON.parse(r.stdout).error;
    assert.match(err, /cloud provider/);
    assert.match(err, /availability zones/);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('CLI: --format csv emits one row per period', () => {
  const r = run('--cloud', 'AWS', '--az', 'multi',
    '--ingress', '50', '--egress', '150', '--partitions', '1000',
    '--months', '6', '--monthly-growth', '5', '--start', '2026-11', '--format', 'csv');
  assert.equal(r.status, 0);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 7);
  assert.match(lines[0], /^cloud,period,/);
});

test('CLI: every example in resources/ runs cleanly', () => {
  const files = fs.readdirSync(RESOURCES).filter(f => f.endsWith('.json'));
  assert.ok(files.length > 0);
  for (const f of files) {
    const r = run('--input', path.join(RESOURCES, f));
    assert.equal(r.status, 0, `${f}: ${r.stdout}`);
    assert.ok(!('error' in JSON.parse(r.stdout)), f);
  }
});
