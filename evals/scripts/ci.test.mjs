// Tests for what the eval workflow selects and gates on. No model calls.
// Run with: node --test evals/scripts/ci.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gate, gatingCases, howToWorkCases, loadSuites, matrix, select } from "./ci.mjs";

const CI = path.join(path.dirname(fileURLToPath(import.meta.url)), "ci.mjs");

const SOURCES = `# SOURCES

## How to work: line, source, eval case

| How to work line | Source | Eval case |
|---|---|---|
| Check the slot first | \`a.go\` | \`check-slot\` |
| Read grants before revoke | \`b.go\` | \`read-grants\`, \`read-grants-2\` |

## Other claims in SKILL.md

| Claim | Source | Eval case |
|---|---|---|
| Not a line | \`c.go\` | \`fact-case\` |
`;

function fixture({ sources = SOURCES } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evals-ci-"));
  const suite = (skill, cases) => {
    fs.mkdirSync(path.join(root, "skills", skill, "references"), { recursive: true });
    fs.writeFileSync(path.join(root, "skills", skill, "SKILL.md"), "x");
    fs.mkdirSync(path.join(root, "evals", "suites"), { recursive: true });
    fs.writeFileSync(path.join(root, "evals", "suites", `${skill}.eval.json`), JSON.stringify({ name: `${skill} skill vs docs`, skill, test_cases: cases }));
  };
  suite("alpha", [
    { id: "fact-case", invariants: [{ name: "x", failure_condition: "y" }] },
    { id: "check-slot", tools: { mock: [] } },
    { id: "read-grants", tools: { mock: [] } },
    { id: "read-grants-2", tools: { mock: [] } },
  ]);
  fs.writeFileSync(path.join(root, "skills", "alpha", "references", "SOURCES.md"), sources);
  suite("beta", [{ id: "b1", invariants: [{ name: "x", failure_condition: "y" }] }, { id: "b2" }, { id: "b3" }]);
  fs.writeFileSync(path.join(root, "skills", "beta", "references", "SOURCES.md"), "# none\n");
  fs.mkdirSync(path.join(root, "skills", "nosuite"), { recursive: true });
  return root;
}

test("How to work case ids come from that table only", () => {
  assert.deepEqual(howToWorkCases(SOURCES), ["check-slot", "read-grants", "read-grants-2"]);
  assert.deepEqual(howToWorkCases("# Nothing here\n"), []);
});

test("a SOURCES.md naming a case its suite lacks is an error, not a silent skip", () => {
  const root = fixture({ sources: SOURCES.replace("`check-slot`", "`no-such-case`") });
  const { errors } = gatingCases(loadSuites(root), root);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /no-such-case/);
  assert.equal(select(["skills/alpha/SKILL.md"], { root }).run, false);
});

test("a skill change runs its whole suite; a suite edit runs that suite", () => {
  const root = fixture();
  const s = select(["skills/alpha/SKILL.md"], { root });
  assert.equal(s.run, true);
  assert.deepEqual(s.suites, ["alpha"]);
  assert.deepEqual(s.cases.sort(), ["check-slot", "fact-case", "read-grants", "read-grants-2"]);
  assert.deepEqual(select(["evals/suites/beta.eval.json"], { root }).suites, ["beta"]);
  // A deleted suite runs nothing rather than failing on a missing file.
  assert.equal(select(["evals/suites/gone.eval.json"], { root }).run, false);
});

test("harness and workflow changes run the smoke set, never every suite", () => {
  const root = fixture();
  for (const f of ["evals/run-evals.mjs", "evals/scripts/mock-tools.mjs", ".github/workflows/evals.yml", ".github/actions/adp-gateway-auth/action.yml"]) {
    const s = select([f], { root });
    assert.equal(s.run, true, f);
    // One behavioral case that gates, one judged case.
    assert.deepEqual(s.cases.sort(), ["check-slot", "fact-case"], f);
  }
});

test("the shared skill runs every suite's How to work cases only", () => {
  const root = fixture();
  const s = select(["skills/redpanda-docs/SKILL.md"], { root });
  assert.deepEqual(s.cases.sort(), ["check-slot", "read-grants", "read-grants-2"]);
});

test("unrelated paths run nothing; a skill without a suite is reported as uncovered", () => {
  const root = fixture();
  assert.equal(select(["README.md", "evals/README.md"], { root }).run, false);
  const s = select(["skills/nosuite/SKILL.md"], { root });
  assert.equal(s.run, false);
  assert.deepEqual(s.uncovered, ["nosuite"]);
});

test("the case cap drops advisory cases and never a gating one", () => {
  const root = fixture();
  const s = select(["skills/alpha/SKILL.md", "skills/beta/SKILL.md"], { root, maxCases: 4 });
  assert.equal(s.cases.length, 4);
  for (const id of ["check-slot", "read-grants", "read-grants-2"]) assert.ok(s.cases.includes(id), id);
  assert.equal(s.dropped.length, 3);
  // Gating cases alone over the cap still all run.
  assert.equal(select(["skills/alpha/SKILL.md"], { root, maxCases: 1 }).gating.length, 3);
});

test("pull requests get one job per arm; the sweep one per suite and arm", () => {
  const sel = { suites: ["a", "b"], cases: ["x"] };
  assert.equal(matrix(sel, ["baseline", "skill"], false).include.length, 2);
  assert.equal(matrix(sel, ["baseline", "skill"], true).include.length, 4);
});

const rows = (suite, id, arm, ...statuses) => statuses.map((status, i) => ({ suite, case: id, arm, run: i + 1, status }));
const ARMS = ["baseline", "skill", "installed"];
const opts = { suites: ["alpha"], cases: ["check-slot"], gating: { alpha: ["check-slot"] }, arms: ARMS };

test("gate: baseline fails and skill arms pass is the only clean result", () => {
  const ok = [...rows("alpha", "check-slot", "baseline", "failed", "failed", "passed"), ...rows("alpha", "check-slot", "skill", "passed", "passed", "failed"), ...rows("alpha", "check-slot", "installed", "passed", "passed", "passed")];
  assert.deepEqual(gate(ok, opts)[0].problems, []);
});

test("gate: a baseline that passes two of three fails the case and flags it for removal", () => {
  const r = gate([...rows("alpha", "check-slot", "baseline", "passed", "passed", "failed"), ...rows("alpha", "check-slot", "skill", "passed", "passed", "passed"), ...rows("alpha", "check-slot", "installed", "passed", "passed", "passed")], opts)[0];
  assert.match(r.problems.join(), /baseline passes 2\/3/);
  assert.equal(r.baselinePasses, true);
});

test("gate: a skill arm under two thirds fails", () => {
  const r = gate([...rows("alpha", "check-slot", "baseline", "failed", "failed", "failed"), ...rows("alpha", "check-slot", "skill", "passed", "failed", "failed"), ...rows("alpha", "check-slot", "installed", "passed", "passed", "passed")], opts)[0];
  assert.match(r.problems.join(), /skill passes only 1\/3/);
});

test("gate: missing or mostly errored runs fail closed rather than pass", () => {
  assert.match(gate([], opts)[0].problems.join(), /incomplete/);
  const r = gate([...rows("alpha", "check-slot", "baseline", "failed", "failed", "failed"), ...rows("alpha", "check-slot", "skill", "passed", "errored", "errored"), ...rows("alpha", "check-slot", "installed", "passed", "passed", "passed")], opts)[0];
  assert.match(r.problems.join(), /skill incomplete/);
});

test("gate CLI exits 1 on a failing rule and 0 when nothing gates", () => {
  const root = fixture();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evals-ci-rows-"));
  fs.writeFileSync(path.join(dir, "runs.jsonl"), rows("beta", "b1", "baseline", "passed").map((r) => JSON.stringify(r)).join("\n"));
  // beta has no How to work cases, so nothing gates and the exit is 0.
  const out = execFileSync("node", [CI, "gate", "--root", root, "--suites", "beta", "--arms", "baseline", dir], { encoding: "utf-8" });
  assert.match(out, /nothing gates/);
  // Rows are recorded under the suite's name field, and the gate finds them.
  const good = fs.mkdtempSync(path.join(os.tmpdir(), "evals-ci-rows-"));
  const gr = [
    ...rows("alpha skill vs docs", "check-slot", "baseline", "failed", "failed", "failed"),
    ...rows("alpha skill vs docs", "check-slot", "skill", "passed", "passed", "passed"),
    ...rows("alpha skill vs docs", "check-slot", "installed", "passed", "passed", "passed"),
  ];
  fs.writeFileSync(path.join(good, "runs.jsonl"), gr.map((r) => JSON.stringify(r)).join("\n"));
  const ok = execFileSync("node", [CI, "gate", "--root", root, "--suites", "alpha", "--cases", "check-slot", "--arms", "baseline,skill,installed", good], { encoding: "utf-8" });
  assert.match(ok, /check-slot.*\| ok \|/);
  // A suite name that names no suite is an error, not an empty pass.
  assert.throws(() => execFileSync("node", [CI, "gate", "--root", root, "--suites", "nope", "--arms", "baseline", good], { stdio: "pipe" }), (e) => e.status === 1);
  // alpha's gating case has no rows in that directory, so it fails closed.
  assert.throws(() => execFileSync("node", [CI, "gate", "--root", root, "--suites", "alpha", "--arms", "baseline", dir], { stdio: "pipe" }), (e) => e.status === 1);
});
