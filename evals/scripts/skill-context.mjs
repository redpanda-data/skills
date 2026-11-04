// Print the context a subject gets for one skill: SKILL.md plus every file
// under the skill's references/ that SKILL.md names. That is what an agent
// following the skill would load, and nothing it would not.
import fs from "node:fs";
import path from "node:path";

export function skillContext(root, skill) {
  const dir = path.join(root, "skills", skill);
  const skillMd = fs.readFileSync(path.join(dir, "SKILL.md"), "utf-8");
  const parts = [`## skills/${skill}/SKILL.md\n\n${skillMd}`];
  const named = new Set(skillMd.match(/references\/[A-Za-z0-9_./-]+\.(?:md|ya?ml|json)/g) ?? []);
  for (const rel of [...named].sort()) {
    const p = path.join(dir, rel);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      parts.push(`## skills/${skill}/${rel}\n\n${fs.readFileSync(p, "utf-8")}`);
    }
  }
  return parts.join("\n\n---\n\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(skillContext(process.argv[2], process.argv[3]));
}
