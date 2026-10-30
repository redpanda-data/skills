#!/usr/bin/env node
// Skill vs docs evals.
//
// Each case asks one user question in four arms:
//
//   baseline  no skill, no docs
//   skill     the skill in context
//   docs      the Redpanda Docs MCP server, no skill
//   both      the skill and the Docs MCP server
//
// and grades every answer the same way. Comparing pass rates across arms answers
// the question this exists for: does a skill add anything the published docs do
// not already give an agent?
//
//   node evals/run-evals.mjs                         # every suite, every arm
//   node evals/run-evals.mjs --suite rpk-topic       # one suite
//   node evals/run-evals.mjs --arms both --runs 1    # regression check only
//   node evals/run-evals.mjs --case some-case-id     # specific cases
//
// Every subject runs through `claude -p` from an empty temporary directory, with
// setting sources, skills, slash commands and session persistence off, and only
// the MCP server its arm declares. So no arm can see an installed plugin, a
// CLAUDE.md, auto-memory, or this repo's skill files on disk. Each run checks
// the tools the subject reports against what its arm should have, and treats a
// mismatch as a harness fault rather than a verdict.

import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { skillContext } from "./scripts/skill-context.mjs";

const EVAL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(EVAL_DIR, "..");
const SUITES_DIR = path.join(EVAL_DIR, "suites");
const RESULTS_DIR = path.join(EVAL_DIR, "results");

// `installed` is what a user with the plugin gets: the skill and the shared
// redpanda-docs skill, the docs server, and no instruction to look things up.
// The other docs arms are told to look up first, which measures what the docs
// contain rather than whether an agent would consult them.
const ARMS = ["baseline", "skill", "docs", "both", "installed"];
const DOCS_MCP_URL = process.env.EVAL_DOCS_MCP_URL ?? "https://docs.redpanda.com/mcp";
const DOCS_SERVER = "redpanda-docs";
// The read tools only. give_feedback writes to a real service, so it is denied
// as well as left off the allow-list.
const DOCS_TOOLS = [
  "ask_redpanda_question",
  "search_api_reference",
  "get_api_reference_content",
  "list_api_reference_pages",
  "get_config_property",
  "list_config_properties",
  "get_connect_component",
  "list_connect_components",
].map((t) => `mcp__${DOCS_SERVER}__${t}`);
const DOCS_DENIED = [`mcp__${DOCS_SERVER}__give_feedback`];
// Anonymous callers get a handful of tool calls a day per network address, which
// one suite exhausts. A trusted client key is not metered, and attributes the
// traffic to a named service rather than to a person.
const DOCS_CLIENT_KEY = process.env.EVAL_DOCS_CLIENT_KEY;
// With no tools at all, `claude -p` can stall after its first thinking block.
// CronList lists scheduled jobs and reads nothing, so it is safe to give every arm.
const INERT_BUILTIN = "CronList";
const MOCK_SERVER = "mock";
const MOCK_SCRIPT = path.join(EVAL_DIR, "scripts", "mock-tools.mjs");

// Told to the docs arms only. Without it, whether the docs arm consults the docs
// at all is the model's choice, and a run that never looked would be scored as
// "the docs were not enough". A softer "use them to ground your answer" was
// ignored on a question the model thought it knew: 0 lookups in 2 runs.
const DOCS_NUDGE =
  "The Redpanda documentation is available through the redpanda-docs tools. Before you answer, " +
  "look the question up with them, then answer from what the documentation says.";

const CASE_TIMEOUT_MS = Number(process.env.EVAL_CASE_TIMEOUT_MS ?? 600_000);
const JUDGE_TIMEOUT_MS = Number(process.env.EVAL_JUDGE_TIMEOUT_MS ?? 180_000);

// An answer that knows nothing. Every case must fail it, or the case cannot
// fail at all. Graded once per case, before any subject runs.
const NULL_ANSWER = "I'm not sure. Check the Redpanda documentation for details.";

function parseArgs(argv) {
  const opts = {
    suites: [],
    cases: [],
    arms: ARMS,
    runs: 3,
    concurrency: 4,
    model: process.env.EVAL_MODEL ?? "claude-sonnet-5-5",
    judgeModel: process.env.EVAL_JUDGE_MODEL ?? "claude-opus-5-5",
    judge: true,
    out: undefined,
    report: [],
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) die(`${a} needs a value`);
      return v;
    };
    if (a === "--suite") opts.suites.push(...next().split(","));
    else if (a === "--case") opts.cases.push(...next().split(","));
    else if (a === "--arms") opts.arms = next().split(",");
    else if (a === "--runs") opts.runs = Number(next());
    else if (a === "--concurrency") opts.concurrency = Number(next());
    else if (a === "--model") opts.model = next();
    else if (a === "--judge-model") opts.judgeModel = next();
    else if (a === "--no-judge") opts.judge = false;
    else if (a === "--out") opts.out = next();
    else if (a === "--report") opts.report.push(...next().split(","));
    else die(`unknown argument: ${a}`);
  }
  const bad = opts.arms.filter((a) => !ARMS.includes(a));
  if (bad.length) die(`unknown arm(s): ${bad.join(", ")}. Arms: ${ARMS.join(", ")}`);
  if (!(opts.runs >= 1)) die("--runs must be at least 1");
  if (!(opts.concurrency >= 1)) die("--concurrency must be at least 1");
  return opts;
}

function die(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

const CASE_KEYS = new Set(
  Object.keys(JSON.parse(fs.readFileSync(path.join(EVAL_DIR, "schema.json"), "utf-8")).properties.test_cases.items.properties)
);

// Which runner and skill text produced a row, so results from different
// revisions are never pooled into one cell.
const RUNNER_REV = (() => {
  try {
    const rev = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: REPO_ROOT, encoding: "utf-8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--", "evals", "skills"], { cwd: REPO_ROOT, encoding: "utf-8" }).trim();
    return dirty ? `${rev}-dirty` : rev;
  } catch {
    return "unknown";
  }
})();
const hash = (text) => crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);

function loadSuites(names) {
  const files = fs
    .readdirSync(SUITES_DIR)
    .filter((f) => f.endsWith(".eval.json"))
    .sort();
  const picked = names.length
    ? names.map((n) => {
        const exact = files.find((f) => f === `${n}.eval.json` || path.join(SUITES_DIR, f) === path.resolve(n));
        if (!exact) die(`no suite matches --suite ${n}`);
        return exact;
      })
    : files;
  return picked.map((f) => {
    const suite = JSON.parse(fs.readFileSync(path.join(SUITES_DIR, f), "utf-8"));
    // A mistyped assertion key would be silently ignored and the case would
    // grade on less than its author meant, so unknown keys stop the run.
    for (const c of suite.test_cases ?? []) {
      const unknown = Object.keys(c).filter((k) => !CASE_KEYS.has(k));
      if (unknown.length) die(`${f}: case ${c.id} has unknown key(s): ${unknown.join(", ")}`);
    }
    if (!fs.existsSync(path.join(REPO_ROOT, "skills", suite.skill, "SKILL.md"))) {
      die(`${f}: skill "${suite.skill}" has no skills/${suite.skill}/SKILL.md`);
    }
    return suite;
  });
}

// ---------------------------------------------------------------------------
// Running claude

function runClaude(args, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`claude exited ${code}: ${err.trim().slice(0, 300)}`));
      else resolve(out);
    });
  });
}

function baseArgs(prompt, model) {
  return [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--disable-slash-commands",
    "--no-session-persistence",
    ...(model ? ["--model", model] : []),
  ];
}

function parseStream(raw) {
  const toolNames = new Map();
  const run = { text: "", toolCalls: [], toolResults: [], tools: undefined, cost: 0, sawResult: false, isError: false };
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type === "system" && e.subtype === "init") {
      run.tools = e.tools ?? [];
      run.skills = e.skills ?? [];
      run.slashCommands = e.slash_commands ?? [];
      run.plugins = e.plugins ?? [];
    }
    if (e.type === "user") {
      for (const c of e.message?.content ?? []) {
        if (c.type !== "tool_result") continue;
        const body = typeof c.content === "string" ? c.content : JSON.stringify(c.content ?? "");
        run.toolResults.push({ name: toolNames.get(c.tool_use_id), isError: Boolean(c.is_error), body });
      }
    }
    if (e.type === "assistant") {
      for (const c of e.message?.content ?? []) {
        if (c.type === "tool_use") {
          run.toolCalls.push({ name: c.name, input: c.input });
          toolNames.set(c.id, c.name);
        }
      }
    }
    if (e.type === "result") {
      run.sawResult = true;
      run.isError = Boolean(e.is_error);
      run.text = e.result ?? "";
      run.cost = e.total_cost_usd ?? 0;
      // Tokens, not just dollars: what a user pays depends on their plan, and
      // cache reads are billed far below fresh input.
      const u = e.usage ?? {};
      run.usage = {
        input: u.input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        output: u.output_tokens ?? 0,
      };
    }
  }
  return run;
}

async function runSubject(suite, testCase, arm, model) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "skill-eval-"));
  try {
    const args = baseArgs(testCase.query, model);
    const withSkill = arm === "skill" || arm === "both" || arm === "installed";
    const withDocs = arm === "docs" || arm === "both" || arm === "installed";
    const prompt = [];
    let skillText = "";
    if (withSkill) {
      skillText = skillContext(REPO_ROOT, suite.skill);
      const shared = path.join(REPO_ROOT, "skills", "redpanda-docs");
      if (arm === "installed" && suite.skill !== "redpanda-docs" && fs.existsSync(path.join(shared, "SKILL.md"))) {
        skillText += "\n\n---\n\n" + skillContext(REPO_ROOT, "redpanda-docs");
      }
      prompt.push(skillText);
    }
    if (withDocs && arm !== "installed") prompt.push(DOCS_NUDGE);
    if (prompt.length) {
      // A file, not an argument: Linux caps one argv element at 128 KiB and
      // some skills with their references are close to that.
      const f = path.join(work, "system-prompt.md");
      fs.writeFileSync(f, prompt.join("\n\n---\n\n"));
      args.push("--append-system-prompt-file", f);
    }
    const expected = [INERT_BUILTIN];
    const servers = {};
    const allowed = [];
    if (withDocs) {
      const server = { type: "http", url: DOCS_MCP_URL };
      if (DOCS_CLIENT_KEY) server.headers = { "x-client-key": DOCS_CLIENT_KEY };
      servers[DOCS_SERVER] = server;
      allowed.push(...DOCS_TOOLS);
    }
    // A behavioral case's mocked tools are part of the scenario, not knowledge,
    // so every arm gets them, baseline included. The whole mock surface is
    // allowed, forbidden calls too: a forbidden call the harness blocked would
    // prove only that the harness works.
    const mockLog = path.join(work, "mock-calls.jsonl");
    if (testCase.tools) {
      const fixture = path.join(work, "mock-tools.json");
      fs.writeFileSync(fixture, JSON.stringify(testCase.tools.mock));
      servers[MOCK_SERVER] = {
        type: "stdio",
        command: process.execPath,
        args: [MOCK_SCRIPT],
        env: { MOCK_TOOLS: fixture, MOCK_LOG: mockLog },
      };
      const mockTools = testCase.tools.mock.map((t) => `mcp__${MOCK_SERVER}__${t.name}`);
      allowed.push(...mockTools);
      expected.push(...mockTools);
    }
    if (Object.keys(servers).length) {
      const cfg = path.join(work, "mcp.json");
      fs.writeFileSync(cfg, JSON.stringify({ mcpServers: servers }));
      args.push("--mcp-config", cfg, "--allowed-tools", allowed.join(","));
    }
    if (withDocs) {
      args.push("--disallowed-tools", DOCS_DENIED.join(","));
      expected.push(...DOCS_TOOLS);
    }
    args.push("--tools", INERT_BUILTIN);

    const run = parseStream(await runClaude(args, work, CASE_TIMEOUT_MS));
    if (!run.sawResult) throw new Error("no result event in transcript");
    if (run.isError) throw new Error("claude reported is_error on the result event");
    // Proof, not intent. A built-in the arm was not given means a no-skill arm
    // might read SKILL.md off disk; an MCP tool in a no-docs arm means the docs
    // leaked in. Missing docs tools means the server did not connect, and the
    // docs arm would be scored on an answer that never had the docs.
    const available = new Set(run.tools ?? []);
    const extra = [...available].filter((t) => !expected.includes(t) && !DOCS_DENIED.includes(t));
    const missing = expected.filter((t) => !available.has(t));
    if (extra.length) throw new Error(`subject had tools its arm should not: ${extra.join(", ")}`);
    if (missing.length) throw new Error(`subject lacked tools its arm needs: ${missing.join(", ")}`);
    // The quota refusal comes back as an ordinary tool result, so the subject
    // answers from memory and says it could not check. Scored, that run would
    // count general knowledge as "the docs".
    if (run.toolResults.some((r) => r.body.includes("anonymous_quota_exhausted"))) {
      throw new Error("docs server refused: anonymous quota exhausted (set EVAL_DOCS_CLIENT_KEY)");
    }
    // An upstream failure or timeout on the docs server also comes back as an
    // ordinary result. A docs arm that looked things up and got nothing usable
    // back never had the docs, so it is a harness error, not "docs not enough".
    const docsResults = run.toolResults.filter((r) => r.name?.startsWith(`mcp__${DOCS_SERVER}__`));
    run.docsStatus = docsResults.map((r) => (r.isError || /"error"\s*:/.test(r.body.slice(0, 400)) ? "error" : "ok"));
    if (docsResults.length && !run.docsStatus.includes("ok")) {
      throw new Error(`every docs lookup failed: ${docsResults[0].body.slice(0, 160)}`);
    }
    // The same proof for knowledge the subject could load without a tool: a
    // skill, a slash command, or a plugin that is not Claude Code's own.
    // Built-in plugins ship inside the CLI and carry no Redpanda content.
    const leaked = [
      ...run.skills.map((x) => `skill ${typeof x === "string" ? x : x.name}`),
      ...run.slashCommands.map((x) => `command ${typeof x === "string" ? x : x.name}`),
      ...run.plugins.filter((x) => x.path !== "builtin").map((x) => `plugin ${x.name}`),
    ];
    if (leaked.length) throw new Error(`subject loaded what its arm should not: ${leaked.join(", ")}`);
    run.docsCalls = run.toolCalls.filter((c) => c.name.startsWith(`mcp__${DOCS_SERVER}__`)).length;
    // Grade from the mock's own log, not the transcript: the log is what the
    // tools actually received.
    run.mockCalls = fs.existsSync(mockLog)
      ? fs.readFileSync(mockLog, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
      : [];
    run.skillHash = skillText ? hash(skillText) : null;
    return run;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Grading

function regex(p) {
  return new RegExp(p, "i");
}

const VERDICT_INSTRUCTIONS = `Reply with exactly this JSON object and nothing else, no prose, no code fence:
{"passed": true or false, "reason": "one sentence"}`;

async function judge(inv, testCase, response, judgeModel) {
  const prompt = `You are grading one answer against one rule. Judge only the rule, not overall quality.

User question:
<question>
${testCase.query}
</question>

Answer to grade:
<answer>
${response}
</answer>

Rule "${inv.name}". The answer FAILS when:
${inv.failure_condition}

${VERDICT_INSTRUCTIONS}`;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "skill-eval-judge-"));
  try {
    const args = [...baseArgs(prompt, judgeModel), "--tools", INERT_BUILTIN];
    const run = parseStream(await runClaude(args, work, JUDGE_TIMEOUT_MS));
    const m = run.text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`judge returned no JSON for ${inv.name}`);
    const v = JSON.parse(m[0]);
    if (typeof v.passed !== "boolean") throw new Error(`judge verdict for ${inv.name} has no boolean "passed"`);
    return { passed: v.passed, reason: String(v.reason ?? ""), cost: run.cost };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// Cheapest first; the first failure decides.
function callMatches(call, spec) {
  return call.name === spec.tool && (!spec.args || regex(spec.args).test(JSON.stringify(call.args ?? {})));
}

const describeCall = (spec) => (spec.args ? `${spec.tool} /${spec.args}/` : spec.tool);

// What the subject did, judged from the mock log.
function gradeCalls(spec, calls) {
  if (!spec) return undefined;
  if (spec.first_call && !(calls[0] && callMatches(calls[0], spec.first_call))) {
    const got = calls[0] ? `${calls[0].name} ${JSON.stringify(calls[0].args)}` : "no calls";
    return `first call was not ${describeCall(spec.first_call)} (got ${got})`;
  }
  for (const c of spec.expected_calls ?? []) {
    if (!calls.some((call) => callMatches(call, c))) return `never called ${describeCall(c)}`;
  }
  for (const c of spec.forbidden_calls ?? []) {
    if (calls.some((call) => callMatches(call, c))) return `called forbidden ${describeCall(c)}`;
  }
  let i = 0;
  for (const c of spec.ordered_calls ?? []) {
    while (i < calls.length && !callMatches(calls[i], c)) i++;
    if (i === calls.length) return `calls out of order: ${describeCall(c)} missing after earlier steps`;
    i++;
  }
  return undefined;
}

async function grade(testCase, response, opts, calls = []) {
  const callFailure = gradeCalls(testCase.tools, calls);
  if (callFailure) return { passed: false, reason: callFailure, cost: 0 };
  for (const p of testCase.failure_patterns ?? []) {
    if (regex(p).test(response)) return { passed: false, reason: `matched failure pattern /${p}/`, cost: 0 };
  }
  for (const p of testCase.required_patterns ?? []) {
    if (!regex(p).test(response)) return { passed: false, reason: `missing required pattern /${p}/`, cost: 0 };
  }
  // Without the judge, invariants are not checked, so the answer has not been
  // graded and must not count as a pass.
  if (!opts.judge && testCase.invariants?.length) return { passed: false, ungraded: true, reason: "invariants not judged (--no-judge)", cost: 0 };
  let cost = 0;
  if (opts.judge) {
    for (const inv of testCase.invariants ?? []) {
      const v = await judge(inv, testCase, response, opts.judgeModel);
      cost += v.cost;
      if (!v.passed) return { passed: false, reason: `invariant ${inv.name}: ${v.reason}`, cost };
    }
  }
  return { passed: true, reason: "", cost };
}

// ---------------------------------------------------------------------------
// Scheduling

async function pool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// Reporting

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");

function tally(rows) {
  const scored = rows.filter((r) => r.status === "passed" || r.status === "failed");
  const errored = rows.filter((r) => r.status === "errored").length;
  return { passed: scored.filter((r) => r.status === "passed").length, scored: scored.length, errored, ungraded: rows.length - scored.length - errored };
}

// Errors are not random: quota refusals and timeouts land on the docs arms'
// hardest runs. So a cell is scored only when at most one planned run is
// missing, and never from zero runs.
function incomplete(t) {
  const unscored = t.errored + t.ungraded;
  return unscored > 1 || (unscored > 0 && t.scored === 0);
}

// A case is informative only if the baseline mostly fails it. One a competent
// model already answers says nothing about the skill or the docs.
function caseVerdict(byArm) {
  if (Object.values(byArm).some(incomplete)) return "incomplete";
  const rate = (arm) => {
    const t = byArm[arm];
    return t && t.scored ? t.passed / t.scored : undefined;
  };
  const base = rate("baseline");
  if (base !== undefined && base > 1 / 3) return "uninformative: baseline already answers it";
  const both = rate("both");
  const docs = rate("docs");
  if (both === undefined || docs === undefined) return "";
  if (both - docs >= 0.34) return "skill adds value (docs gap)";
  if (docs >= 2 / 3 && docs >= both - 0.1) return "docs are enough";
  if (both < 2 / 3 && docs < 2 / 3) return "neither answers reliably";
  return "no clear difference";
}

function summarize(suites, results, opts, meta) {
  const lines = [];
  lines.push(`# Skill vs docs eval results`, "");
  lines.push(`- Started: ${meta.started}`);
  lines.push(`- Subject model: ${opts.model}; judge model: ${opts.judge ? opts.judgeModel : "off"}`);
  lines.push(`- Runs per arm: ${opts.runs}; docs server: ${DOCS_MCP_URL}`);
  lines.push(`- Errored runs: ${opts.arms.map((a) => { const t = tally(results.filter((r) => r.arm === a)); return `${a} ${t.errored}/${t.scored + t.errored + t.ungraded}`; }).join(", ")}`);
  lines.push(`- Total cost: $${meta.cost.toFixed(2)}`, "");
  const verdicts = {};
  const verdictOf = new Map();
  for (const suite of suites) {
    lines.push(`## ${suite.skill}`, "");
    lines.push(`| Case | ${opts.arms.join(" | ")} | Verdict |`);
    lines.push(`|---|${opts.arms.map(() => "---").join("|")}|---|`);
    const informative = { both: [0, 0], docs: [0, 0], skill: [0, 0], installed: [0, 0] };
    for (const testCase of suite.test_cases) {
      const rows = results.filter((r) => r.suite === suite.name && r.case === testCase.id);
      if (!rows.length) continue;
      const byArm = {};
      for (const arm of opts.arms) byArm[arm] = tally(rows.filter((r) => r.arm === arm));
      const cells = opts.arms.map((arm) => {
        const t = byArm[arm];
        let cell = `${t.passed}/${t.scored}`;
        if (t.errored) cell += ` (${t.errored} err)`;
        if (t.ungraded) cell += ` (${t.ungraded} ungraded)`;
        if (arm === "docs" || arm === "both") {
          const unused = rows.filter((r) => r.arm === arm && r.status !== "errored" && r.docsCalls === 0).length;
          if (unused) cell += ` (${unused} no lookup)`;
        }
        return cell;
      });
      const v = caseVerdict(byArm);
      verdictOf.set(`${suite.name}/${testCase.id}`, v);
      const origin = testCase.origin ?? "unspecified";
      verdicts[origin] ??= {};
      verdicts[origin][v] = (verdicts[origin][v] ?? 0) + 1;
      if (v !== "incomplete" && !v.startsWith("uninformative")) {
        for (const arm of Object.keys(informative)) {
          if (byArm[arm]) {
            informative[arm][0] += byArm[arm].passed;
            informative[arm][1] += byArm[arm].scored;
          }
        }
      }
      lines.push(`| \`${testCase.id}\` (${origin}) | ${cells.join(" | ")} | ${v} |`);
    }
    lines.push("");
    const [bp, bs] = informative.both;
    const [dp, ds] = informative.docs;
    const [sp, ss] = informative.skill;
    const [ip, is] = informative.installed;
    // "Informative" means the baseline failed; without baseline runs nothing
    // was filtered, so the line would claim more than it measured.
    if (opts.arms.includes("baseline")) {
      lines.push(
        `Informative cases only: skill ${pct(sp, ss)}, docs ${pct(dp, ds)}, both ${pct(bp, bs)}, installed ${pct(ip, is)}.`,
        ""
      );
    }
  }
  // The two lists worth acting on. A docs gap is something the skill tells an
  // agent that the published docs do not: either document it, or it is the
  // reason the skill exists. A skill gap is the reverse: the docs answer it and
  // the skill gets it wrong or leaves it out.
  const rateOf = (rows, arm) => {
    const t = tally(rows.filter((r) => r.arm === arm));
    return t.scored ? t.passed / t.scored : undefined;
  };
  const gaps = { docs: [], skill: [] };
  for (const suite of suites) {
    for (const testCase of suite.test_cases) {
      if (verdictOf.get(`${suite.name}/${testCase.id}`) === "incomplete") continue;
      const rows = results.filter((r) => r.suite === suite.name && r.case === testCase.id);
      const [base, skill, docs] = ["baseline", "skill", "docs"].map((a) => rateOf(rows, a));
      if (base !== undefined && base > 1 / 3) continue;
      const entry = `- \`${suite.skill}/${testCase.id}\`: ${testCase.why}`;
      if (skill >= 2 / 3 && docs <= 1 / 3) gaps.docs.push(entry);
      if (docs >= 2 / 3 && skill <= 1 / 3) gaps.skill.push(entry);
    }
  }
  if (gaps.docs.length) lines.push(`## Docs gaps: the skill answers it, the docs do not`, "", ...gaps.docs, "");
  if (gaps.skill.length) lines.push(`## Skill gaps: the docs answer it, the skill does not`, "", ...gaps.skill, "");
  // Per origin, never pooled: docs-cited cases can only show the docs finding
  // what they say, so mixing them in would overstate "docs are enough".
  lines.push(`## Case verdicts by origin`, "");
  for (const [origin, counts] of Object.entries(verdicts)) {
    lines.push(`**${origin}**`, "");
    for (const [v, n] of Object.entries(counts)) lines.push(`- ${v || "not all arms run"}: ${n}`);
    lines.push("");
  }
  const failures = results.filter((r) => r.status !== "passed");
  if (failures.length) {
    lines.push(`## Why runs did not pass`, "");
    for (const r of failures) lines.push(`- \`${r.suite}/${r.case}\` ${r.arm} #${r.run}: ${r.status}. ${r.reason}`);
    lines.push("");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------

// Summarize runs already on disk, from one or more result directories, without
// running anything. Arms measured in separate runs land in one table.
function report(opts) {
  const rows = [];
  for (const dir of opts.report) {
    const f = path.join(dir, "runs.jsonl");
    if (!fs.existsSync(f)) die(`no runs.jsonl in ${dir}`);
    for (const line of fs.readFileSync(f, "utf-8").split("\n")) if (line.trim()) rows.push(JSON.parse(line));
  }
  const cells = new Map();
  for (const r of rows) {
    const k = `${r.suite}/${r.case}/${r.arm}`;
    // judgeModel is null for --no-judge rows and absent from older rows; keep both distinct.
    const id = `${r.skillHash ?? "-"} ${r.model ?? "?"} ${r.judgeModel}`;
    if (!cells.has(k)) cells.set(k, new Set());
    cells.get(k).add(id);
  }
  const mixed = [...cells].filter(([, ids]) => ids.size > 1).map(([k]) => k);
  if (mixed.length) die(`refusing to pool runs of different skill text, models or judges in: ${mixed.slice(0, 5).join(", ")}${mixed.length > 5 ? ", ..." : ""}`);
  const models = [...new Set(rows.map((r) => r.model ?? "unrecorded"))].join(", ");
  const judges = [...new Set(rows.map((r) => r.judgeModel ?? "unrecorded"))].join(", ");
  opts = { ...opts, model: models, judgeModel: judges };
  const suites = loadSuites(opts.suites).filter((s) => rows.some((r) => r.suite === s.name));
  const arms = ARMS.filter((a) => rows.some((r) => r.arm === a));
  const cost = rows.reduce((n, r) => n + (r.cost ?? 0), 0);
  const started = `merged from ${opts.report.map((d) => path.basename(d)).join(", ")}`;
  console.log(summarize(suites, rows, { ...opts, arms, runs: "varies" }, { started, cost }));
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.report.length) return report(opts);
  const suites = loadSuites(opts.suites);
  const want = new Set(opts.cases);
  const selected = suites
    .map((s) => ({ ...s, test_cases: s.test_cases.filter((c) => !want.size || want.has(c.id)) }))
    .filter((s) => s.test_cases.length);
  if (want.size) {
    const found = new Set(selected.flatMap((s) => s.test_cases.map((c) => c.id)));
    const unknown = [...want].filter((id) => !found.has(id));
    if (unknown.length) die(`no case with id: ${unknown.join(", ")}`);
  }
  if (!selected.length) die("no cases selected");

  const started = new Date().toISOString();
  const outDir = opts.out ?? path.join(RESULTS_DIR, started.replace(/[:.]/g, "-"));
  fs.mkdirSync(outDir, { recursive: true });
  const log = fs.createWriteStream(path.join(outDir, "runs.jsonl"));
  let cost = 0;

  console.log(`🧪 Skill vs docs evals: ${selected.length} suite(s), arms ${opts.arms.join(",")}, ${opts.runs} run(s) each`);
  console.log(`   subject ${opts.model}, judge ${opts.judge ? opts.judgeModel : "off"}, results in ${path.relative(process.cwd(), outDir)}\n`);

  // Negative control first: a case the know-nothing answer passes cannot fail,
  // so its results would mean nothing. Stop before spending on subjects.
  const cannotFail = [];
  const skippedControl = [];
  await pool(
    selected.flatMap((suite) =>
      suite.test_cases.map((testCase) => async () => {
        // Without the judge, a case graded only by invariants passes anything,
        // so the control has nothing to test there. Say so instead of failing.
        const onlyInvariants = !testCase.required_patterns?.length && !testCase.failure_patterns?.length && !testCase.tools;
        if (!opts.judge && onlyInvariants) {
          skippedControl.push(`${suite.name}/${testCase.id}`);
          return;
        }
        const g = await grade(testCase, NULL_ANSWER, opts);
        cost += g.cost;
        if (g.passed) cannotFail.push(`${suite.name}/${testCase.id}`);
      })
    ),
    opts.concurrency
  );
  if (skippedControl.length) {
    console.log(`⚠️  --no-judge: ${skippedControl.length} invariant-only case(s) are ungraded and will not be scored: ${skippedControl.join(", ")}\n`);
  }
  if (cannotFail.length) {
    die(`these cases pass an answer that says nothing, so they cannot fail:\n   ${cannotFail.join("\n   ")}`);
  }

  const tasks = [];
  for (const suite of selected) {
    for (const testCase of suite.test_cases) {
      for (const arm of opts.arms) {
        for (let run = 1; run <= opts.runs; run++) {
          tasks.push(async () => {
            const row = {
              suite: suite.name,
              skill: suite.skill,
              case: testCase.id,
              arm,
              run,
              model: opts.model,
              judgeModel: opts.judge ? opts.judgeModel : null,
              runnerRev: RUNNER_REV,
            };
            try {
              const subject = await runSubject(suite, testCase, arm, opts.model);
              const g = await grade(testCase, subject.text, opts, subject.mockCalls);
              Object.assign(row, {
                status: g.passed ? "passed" : g.ungraded ? "ungraded" : "failed",
                reason: g.reason,
                docsCalls: subject.docsCalls,
                usage: subject.usage,
                skillHash: subject.skillHash,
                docsStatus: subject.docsStatus,
                mockCalls: subject.mockCalls,
                cost: subject.cost + g.cost,
                response: subject.text,
                toolCalls: subject.toolCalls,
              });
            } catch (e) {
              // A timeout, a server that did not connect, a tool leak: a fault in
              // the harness, never a verdict on the skill or the docs.
              Object.assign(row, { status: "errored", reason: e.message, cost: 0 });
            }
            cost += row.cost;
            log.write(JSON.stringify(row) + "\n");
            const mark = { passed: "✅", failed: "❌", errored: "⚠️ ", ungraded: "➖" }[row.status];
            console.log(`${mark} ${suite.skill}/${testCase.id} ${arm} #${run}${row.status === "passed" ? "" : `: ${row.reason}`}`);
            return row;
          });
        }
      }
    }
  }
  const results = await pool(tasks, opts.concurrency);
  log.end();

  const summary = summarize(selected, results, opts, { started, cost });
  fs.writeFileSync(path.join(outDir, "summary.md"), summary);
  console.log(`\n${summary}`);

  const errored = results.filter((r) => r.status === "errored").length;
  if (errored === results.length) die("every run errored; nothing was measured");
  if (errored) console.log(`⚠️  ${errored} run(s) errored and were not scored.`);
}

export { tally, caseVerdict, grade };

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => die(e.stack ?? String(e)));
}
