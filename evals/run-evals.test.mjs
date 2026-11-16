// Scoring tests. Run with: node --test evals/run-evals.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { caseVerdict, grade, tally } from "./run-evals.mjs";

const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), "run-evals.mjs");
const rows = (...statuses) => statuses.map((status) => ({ status }));

test("errored runs make a cell incomplete instead of shrinking its sample", () => {
  const byArm = {
    baseline: tally(rows("failed", "failed", "failed")),
    both: tally(rows("failed", "failed", "failed")),
    docs: tally(rows("passed", "errored", "errored")),
  };
  assert.equal(caseVerdict(byArm), "incomplete");
  // One missing run out of three is still scored.
  byArm.docs = tally(rows("passed", "passed", "errored"));
  assert.equal(caseVerdict(byArm), "docs are enough");
});

test("--no-judge rows are ungraded and never pooled with judged rows", async () => {
  const invariantOnly = { invariants: [{ name: "x", description: "says x" }] };
  const g = await grade(invariantOnly, "anything", { judge: false });
  assert.equal(g.passed, false);
  assert.equal(g.ungraded, true);
  assert.equal(tally([{ status: "ungraded" }]).scored, 0);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evals-test-"));
  const row = { suite: "s", case: "c", arm: "docs", run: 1, skillHash: "h", model: "m", status: "passed" };
  for (const [dir, judgeModel] of [["judged", "j"], ["unjudged", null]]) {
    fs.mkdirSync(path.join(tmp, dir));
    fs.writeFileSync(path.join(tmp, dir, "runs.jsonl"), JSON.stringify({ ...row, judgeModel }) + "\n");
  }
  assert.throws(
    () => execFileSync("node", [RUNNER, "--report", `${tmp}/judged,${tmp}/unjudged`], { stdio: "pipe" }),
    (e) => e.status === 1 && /refusing to pool/.test(e.stderr.toString())
  );
});

test("a credential in an errored run's reason is redacted before it is logged", async () => {
  const { redact } = await import("./run-evals.mjs");
  const env = { AWS_BEARER_TOKEN_BEDROCK: "bearer-value-123456", EVAL_DOCS_CLIENT_KEY: "docs-key-abcdefgh" };
  const out = redact("claude exited 1: auth bearer-value-123456 failed; key docs-key-abcdefgh", env);
  assert.ok(!out.includes("bearer-value-123456"));
  assert.ok(!out.includes("docs-key-abcdefgh"));
  assert.match(out, /<AWS_BEARER_TOKEN_BEDROCK>/);
  // Short or unset values are left alone, so a one-character value cannot
  // blank out every occurrence of that character.
  assert.equal(redact("abc", { EVAL_DOCS_CLIENT_KEY: "a" }), "abc");
  assert.equal(redact(undefined, {}), "");
});
