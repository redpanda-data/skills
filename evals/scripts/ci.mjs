#!/usr/bin/env node
// What the eval workflow runs, and whether the result gates.
//
//   node evals/scripts/ci.mjs select --changed <file> [--max-cases N]
//       Pull request: map the changed paths (one per line in <file>) to the
//       cases worth running. Prints JSON.
//   node evals/scripts/ci.mjs select --all --arms a,b,c
//       Sweep: every case in every suite, one job per suite and arm.
//   node evals/scripts/ci.mjs gate --suites a,b [--cases x,y] --arms a,b,c <results dir>...
//       Apply the gating rule to runs.jsonl files. Prints Markdown and exits 1
//       when a rule fails.
//
// --root <dir> points either command at another checkout (the tests use it).
//
// The gating rule is the one CLAUDE.md sets for a thin skill's "How to work"
// line: its behavioral case must fail without the skill and pass with it.
// Which cases those are comes from each skill's SOURCES.md, whose "How to work"
// table names the case id of every line, so nothing here lists cases by hand.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { incomplete, tally } from "../run-evals.mjs";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Changes to these reach every case through the harness rather than through
// one skill, so they run the smoke set instead of every suite.
const HARNESS = [
  /^evals\/run-evals\.mjs$/,
  /^evals\/schema\.json$/,
  /^evals\/scripts\//,
  /^\.github\/workflows\/evals\.yml$/,
  /^\.github\/actions\/adp-gateway-auth\//,
];

// The installed arm loads this skill beside every other one.
const SHARED_SKILL = "redpanda-docs";

// The thresholds the runner's own verdicts use: a baseline that passes more
// than a third of its runs already knows the answer; an arm passes a case when
// it passes at least two thirds of its runs.
const BASELINE_MAX = 1 / 3;
const SKILL_MIN = 2 / 3;
const GATED_SKILL_ARMS = ["skill", "installed"];

export function loadSuites(root = REPO_ROOT) {
  const dir = path.join(root, "evals", "suites");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".eval.json"))
    .sort()
    .map((f) => {
      const suite = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
      // runs.jsonl records a run's suite by the suite's own name field, not its
      // file name, so both are kept.
      return { file: f, name: f.replace(/\.eval\.json$/, ""), title: suite.name, skill: suite.skill, cases: suite.test_cases.map((c) => c.id), raw: suite };
    });
}

// The case ids in the "How to work" table of a skill's SOURCES.md: the last
// column of every row under a heading that starts "How to work".
export function howToWorkCases(markdown) {
  const ids = [];
  let inSection = false;
  for (const line of markdown.split("\n")) {
    const heading = line.match(/^#+\s+(.*)$/);
    if (heading) {
      inSection = /^how to work\b/i.test(heading[1].trim());
      continue;
    }
    if (!inSection || !line.trim().startsWith("|")) continue;
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
    const last = cells[cells.length - 1].trim();
    if (/^-+$/.test(last.replace(/:/g, "")) || /^eval case$/i.test(last)) continue;
    for (const m of last.matchAll(/`([a-z0-9-]+)`/g)) ids.push(m[1]);
  }
  return ids;
}

export function sourcesFor(skill, root = REPO_ROOT) {
  for (const p of [path.join(root, "skills", skill, "references", "SOURCES.md"), path.join(root, "skills", skill, "SOURCES.md")]) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
  }
  return "";
}

// suite name -> its gating case ids. A SOURCES.md that names a case its suite
// does not have is an error: the line it backs would otherwise go ungated.
export function gatingCases(suites, root = REPO_ROOT) {
  const gating = {};
  const errors = [];
  for (const s of suites) {
    const ids = howToWorkCases(sourcesFor(s.skill, root));
    const missing = ids.filter((id) => !s.cases.includes(id));
    if (missing.length) errors.push(`skills/${s.skill} SOURCES.md names case(s) not in evals/suites/${s.file}: ${missing.join(", ")}`);
    gating[s.name] = ids.filter((id) => s.cases.includes(id));
  }
  return { gating, errors };
}

// One behavioral case (the mocked-tool path) and one judged case (the
// invariant path), chosen by rule so the set follows the suites as they
// change. Both are gating cases when any exist, so the smoke run exercises the
// gate too.
export function smokeCases(suites, gating) {
  const all = suites.flatMap((s) => s.raw.test_cases.map((c) => ({ suite: s.name, c, gates: gating[s.name]?.includes(c.id) })));
  const pick = (pred) => all.find((x) => pred(x) && x.gates) ?? all.find(pred);
  const picked = [pick((x) => x.c.tools), pick((x) => !x.c.tools && x.c.invariants?.length)].filter(Boolean);
  return [...new Map(picked.map((x) => [`${x.suite}/${x.c.id}`, { suite: x.suite, id: x.c.id }])).values()];
}

export function select(changed, { root = REPO_ROOT, maxCases = 30 } = {}) {
  const suites = loadSuites(root);
  const { gating, errors } = gatingCases(suites, root);
  const bySkill = new Map(suites.map((s) => [s.skill, s]));
  const reasons = [];
  const uncovered = new Set();
  const whole = new Set(); // suites to run in full
  const only = new Map(); // suite -> Set of case ids, when not in full
  let smoke = false;
  const add = (suite, id) => {
    if (!only.has(suite)) only.set(suite, new Set());
    only.get(suite).add(id);
  };

  for (const f of changed.map((l) => l.trim()).filter(Boolean)) {
    let m;
    if (HARNESS.some((re) => re.test(f))) {
      if (!smoke) reasons.push(`${f}: harness change, smoke set`);
      smoke = true;
    } else if ((m = f.match(/^evals\/suites\/([^/]+)\.eval\.json$/))) {
      if (suites.some((s) => s.name === m[1])) {
        whole.add(m[1]);
        reasons.push(`${f}: suite ${m[1]}`);
      } else reasons.push(`${f}: suite deleted, nothing to run`);
    } else if ((m = f.match(/^skills\/([^/]+)\//))) {
      const skill = m[1];
      if (skill === SHARED_SKILL) {
        // Every installed arm loads it, but running every suite for it would
        // cost what a sweep costs. The lines that gate are the ones a change
        // to it could break.
        for (const s of suites) for (const id of gating[s.name]) add(s.name, id);
        reasons.push(`${f}: shared skill, every suite's How to work cases`);
      } else if (bySkill.has(skill)) {
        whole.add(bySkill.get(skill).name);
        reasons.push(`${f}: skill ${skill}`);
      } else {
        uncovered.add(skill);
        if (howToWorkCases(sourcesFor(skill, root)).length) {
          errors.push(`skills/${skill} SOURCES.md names How to work cases but there is no suite for it`);
        }
      }
    }
  }
  if (smoke) for (const x of smokeCases(suites, gating)) add(x.suite, x.id);

  // Gating cases first, then the rest in suite order, so the cap drops only
  // advisory cases.
  const picked = [];
  for (const s of suites) {
    const ids = whole.has(s.name) ? s.cases : [...(only.get(s.name) ?? [])];
    for (const id of ids) picked.push({ suite: s.name, id, gates: gating[s.name].includes(id) });
  }
  const gated = picked.filter((x) => x.gates);
  const advisory = picked.filter((x) => !x.gates);
  const room = Math.max(0, maxCases - gated.length);
  const kept = [...gated, ...advisory.slice(0, room)];
  const dropped = advisory.slice(room).map((x) => `${x.suite}/${x.id}`);
  const keptSuites = suites.map((s) => s.name).filter((n) => kept.some((x) => x.suite === n));
  return {
    run: kept.length > 0 && errors.length === 0,
    errors,
    reasons,
    uncovered: [...uncovered],
    suites: keptSuites,
    cases: kept.map((x) => x.id),
    gating: gated.map((x) => `${x.suite}/${x.id}`),
    dropped,
  };
}

// One matrix entry per arm (pull requests) or per suite and arm (the sweep),
// so that no single job outlives the hour-long gateway bearer.
export function matrix(sel, arms, perSuite) {
  const include = [];
  const groups = perSuite ? sel.suites.map((s) => [s]) : [sel.suites];
  for (const g of groups) {
    for (const arm of arms) {
      include.push({ name: `${g.join("+")}-${arm}`, arm, suites: g.join(","), cases: sel.cases ? sel.cases.join(",") : "" });
    }
  }
  return { include };
}

export function readRows(dirs) {
  const rows = [];
  for (const d of dirs) {
    const f = path.join(d, "runs.jsonl");
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, "utf-8").split("\n")) if (line.trim()) rows.push(JSON.parse(line));
  }
  return rows;
}

// Every How to work case that was selected, judged on its own arms.
// `titles` maps a suite's file name to the name runs.jsonl records it under.
export function gate(rows, { suites, cases, gating, arms, titles = {} }) {
  const want = cases?.length ? new Set(cases) : undefined;
  const results = [];
  for (const suite of suites) {
    for (const id of gating[suite] ?? []) {
      if (want && !want.has(id)) continue;
      const recorded = titles[suite] ?? suite;
      const mine = rows.filter((r) => r.suite === recorded && r.case === id);
      const problems = [];
      const rate = {};
      for (const arm of arms) {
        const t = tally(mine.filter((r) => r.arm === arm));
        rate[arm] = t;
        if (t.scored + t.errored + t.ungraded === 0 || incomplete(t)) problems.push(`${arm} incomplete (${t.passed}/${t.scored}, ${t.errored} errored): rerun`);
      }
      const r = (arm) => (rate[arm]?.scored ? rate[arm].passed / rate[arm].scored : undefined);
      if (!problems.length) {
        if (arms.includes("baseline") && r("baseline") > BASELINE_MAX) {
          problems.push(`baseline passes ${rate.baseline.passed}/${rate.baseline.scored}: the line is general knowledge, so it comes out`);
        }
        for (const arm of GATED_SKILL_ARMS.filter((a) => arms.includes(a))) {
          if (r(arm) < SKILL_MIN) problems.push(`${arm} passes only ${rate[arm].passed}/${rate[arm].scored}`);
        }
      }
      const cells = Object.fromEntries(arms.map((a) => [a, `${rate[a].passed}/${rate[a].scored}${rate[a].errored ? ` (${rate[a].errored} err)` : ""}`]));
      results.push({ suite, id, cells, problems, baselinePasses: r("baseline") > BASELINE_MAX });
    }
  }
  return results;
}

export function gateMarkdown(results, arms) {
  const lines = ["## How to work cases", ""];
  if (!results.length) {
    lines.push("No How to work case was selected, so nothing gates this run.", "");
    return lines.join("\n");
  }
  lines.push(`| Case | ${arms.join(" | ")} | Result |`, `|---|${arms.map(() => "---").join("|")}|---|`);
  for (const x of results) lines.push(`| \`${x.suite}/${x.id}\` | ${arms.map((a) => x.cells[a]).join(" | ")} | ${x.problems.length ? x.problems.join("; ") : "ok"} |`);
  lines.push("");
  const removal = results.filter((x) => x.baselinePasses);
  if (removal.length) {
    lines.push("### Baseline now passes: candidates for removal", "");
    for (const x of removal) lines.push(`- \`${x.suite}/${x.id}\``);
    lines.push("");
  }
  return lines.join("\n");
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const list = (v) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);

function main(argv) {
  const [cmd] = argv;
  const root = arg(argv, "--root") ?? REPO_ROOT;
  if (cmd === "select") {
    const arms = list(arg(argv, "--arms") ?? "baseline,skill,installed");
    if (argv.includes("--all")) {
      const suites = loadSuites(root);
      const { gating, errors } = gatingCases(suites, root);
      const sel = { run: errors.length === 0, errors, reasons: ["sweep: every suite"], uncovered: [], suites: suites.map((s) => s.name), cases: null, gating: Object.entries(gating).flatMap(([s, ids]) => ids.map((id) => `${s}/${id}`)), dropped: [] };
      console.log(JSON.stringify({ ...sel, cases: [], matrix: matrix(sel, arms, true) }));
      return errors.length ? 1 : 0;
    }
    const file = arg(argv, "--changed");
    if (!file) throw new Error("select needs --changed <file> or --all");
    const sel = select(fs.readFileSync(file, "utf-8").split("\n"), { root, maxCases: Number(arg(argv, "--max-cases") ?? 30) });
    console.log(JSON.stringify({ ...sel, matrix: matrix(sel, arms, false) }));
    return sel.errors.length ? 1 : 0;
  }
  if (cmd === "gate") {
    const arms = list(arg(argv, "--arms") ?? "baseline,skill,installed");
    const suites = list(arg(argv, "--suites"));
    const cases = list(arg(argv, "--cases"));
    const dirs = argv.slice(1).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
    const picked = loadSuites(root).filter((s) => suites.includes(s.name));
    const unknown = suites.filter((n) => !picked.some((s) => s.name === n));
    const { gating, errors } = gatingCases(picked, root);
    for (const n of unknown) errors.push(`no suite evals/suites/${n}.eval.json`);
    const titles = Object.fromEntries(picked.map((s) => [s.name, s.title]));
    const results = gate(readRows(dirs), { suites, cases, gating, arms, titles });
    console.log(gateMarkdown(results, arms));
    for (const e of errors) console.log(`- ${e}`);
    return errors.length || results.some((x) => x.problems.length) ? 1 : 0;
  }
  throw new Error(`unknown command: ${cmd ?? "(none)"}. Commands: select, gate`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exitCode = 2;
  }
}
