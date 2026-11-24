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

// The context for a Claude Code plugin's skills, loaded the way skillContext
// loads one of ours: each skills/<name>/SKILL.md, plus every .md, .yaml or
// .json file it names that exists in the skill's directory or under its
// resources/, plus the files those resource files name beside themselves.
// Scripts are left out: the subject cannot run them.
const NAMED = /[A-Za-z0-9_./-]+\.(?:md|ya?ml|json)\b/g;

export function pluginContext(pluginDir) {
  const skillsDir = path.join(pluginDir, "skills");
  const parts = [];
  for (const skill of fs.readdirSync(skillsDir).sort()) {
    const dir = path.join(skillsDir, skill);
    const skillMd = path.join(dir, "SKILL.md");
    if (!fs.existsSync(skillMd)) continue;
    const text = fs.readFileSync(skillMd, "utf-8");
    parts.push(`## ${skill}/SKILL.md\n\n${text}`);
    const resources = path.join(dir, "resources");
    const searchDirs = [dir, ...(fs.existsSync(resources) ? fs.readdirSync(resources, { recursive: true }).map((d) => path.join(resources, d)) : [])].filter(
      (d) => fs.statSync(d).isDirectory()
    );
    const isFile = (p) => fs.existsSync(p) && fs.statSync(p).isFile();
    const found = new Set();
    for (const name of new Set(text.match(NAMED) ?? [])) {
      if (name.startsWith("/")) continue;
      const hit = searchDirs.map((d) => path.join(d, name)).find(isFile);
      if (hit) found.add(hit);
    }
    for (const f of [...found]) {
      if (!f.startsWith(resources + path.sep)) continue;
      for (const name of fs.readFileSync(f, "utf-8").match(NAMED) ?? []) {
        const p = path.join(path.dirname(f), name);
        if (!name.startsWith("/") && isFile(p)) found.add(p);
      }
    }
    for (const f of [...found].sort()) {
      parts.push(`## ${skill}/${path.relative(dir, f)}\n\n${fs.readFileSync(f, "utf-8")}`);
    }
  }
  if (!parts.length) throw new Error(`no skills/*/SKILL.md under ${pluginDir}`);
  return parts.join("\n\n---\n\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(skillContext(process.argv[2], process.argv[3]));
}
