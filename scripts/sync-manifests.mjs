#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

const MARKETPLACE_NAME = 'redpanda-skills';
const MARKETPLACE_DISPLAY_NAME = 'Redpanda Agent Skills';
const MARKETPLACE_DESCRIPTION =
  "Agent Skills for Redpanda products: Streaming, SQL, Connect, Cloud, the Agentic Data Plane, and the rpk CLI.";
const REPO_URL = 'https://github.com/redpanda-data/skills';
const ORG_URL = 'https://github.com/redpanda-data';

export const ADP_SKILLS = [
  './skills/adp',
  './skills/adp-governance',
  './skills/adp-observability',
  './skills/redpanda-docs',
];

const ADP_PLUGIN_DESCRIPTION =
  "Skills for Redpanda's Agentic Data Plane (ADP): hosted AI agents, MCP servers, AI Gateway, governance, observability, and Redpanda Docs.";

const FULL_PLUGIN_MARKETPLACE_DESCRIPTION =
  "Skills for Redpanda's five products (Streaming, SQL, Connect, Cloud, Agentic Data Plane) plus the rpk CLI, grounded in Redpanda source, docs, and APIs.";

export function parseSemver(version) {
  if (typeof version !== 'string') {
    throw new Error(`Invalid SemVer version: ${String(version)}`);
  }
  const match = SEMVER_PATTERN.exec(version.trim());
  if (!match) {
    throw new Error(`Invalid SemVer version "${version}": expected MAJOR.MINOR.PATCH`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function bumpSemver(version, level) {
  const { major, minor, patch } = parseSemver(version);
  switch (level) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Unsupported bump level "${level}": expected patch, minor, or major`);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function buildManifests(rootDir, versionOverride) {
  const claudePluginPath = resolve(rootDir, '.claude-plugin/plugin.json');
  const mcpPath = resolve(rootDir, '.mcp.json');
  const basePlugin = readJson(claudePluginPath);
  const mcpConfig = readJson(mcpPath);

  const version = versionOverride ?? basePlugin.version ?? '1.0.0';
  parseSemver(version);

  for (const skillPath of ADP_SKILLS) {
    const skillFile = resolve(rootDir, skillPath, 'SKILL.md');
    if (!existsSync(skillFile)) {
      throw new Error(`Missing required ADP skill file: ${skillPath}/SKILL.md`);
    }
  }

  const docsMcpUrl = mcpConfig?.mcpServers?.['redpanda-docs']?.url;
  if (typeof docsMcpUrl !== 'string' || docsMcpUrl.length === 0) {
    throw new Error('.mcp.json must define mcpServers["redpanda-docs"].url');
  }

  const claudePlugin = {
    name: basePlugin.name,
    version,
    description: basePlugin.description,
    author: basePlugin.author,
    homepage: basePlugin.homepage,
    repository: basePlugin.repository,
    license: basePlugin.license,
    keywords: basePlugin.keywords,
    privacyPolicyUrl: basePlugin.privacyPolicyUrl,
  };

  const claudeMarketplace = {
    $schema: 'https://anthropic.com/claude-code/marketplace.schema.json',
    name: MARKETPLACE_NAME,
    description: MARKETPLACE_DESCRIPTION,
    owner: {
      name: 'Redpanda Data',
      url: ORG_URL,
    },
    metadata: {
      description: MARKETPLACE_DESCRIPTION,
      version,
    },
    plugins: [
      {
        name: 'redpanda',
        version,
        description: FULL_PLUGIN_MARKETPLACE_DESCRIPTION,
        author: {
          name: 'Redpanda Data',
        },
        source: './',
        category: 'devops',
        homepage: REPO_URL,
      },
      {
        name: 'redpanda-adp',
        version,
        description: ADP_PLUGIN_DESCRIPTION,
        author: {
          name: 'Redpanda Data',
        },
        source: './',
        strict: false,
        skills: ADP_SKILLS,
        mcpServers: './.mcp.json',
        category: 'devops',
        homepage: REPO_URL,
      },
    ],
  };

  const codexPlugin = {
    name: 'redpanda',
    version,
    description: basePlugin.description,
    skills: './skills/',
    mcpServers: './.mcp.json',
  };

  const codexMarketplace = {
    name: MARKETPLACE_NAME,
    interface: {
      displayName: MARKETPLACE_DISPLAY_NAME,
    },
    metadata: {
      description: MARKETPLACE_DESCRIPTION,
      version,
    },
    plugins: [
      {
        name: 'redpanda',
        version,
        description: FULL_PLUGIN_MARKETPLACE_DESCRIPTION,
        source: {
          source: 'local',
          path: './',
        },
        policy: {
          installation: 'AVAILABLE',
          authentication: 'ON_USE',
        },
        author: {
          name: 'Redpanda Data',
        },
        category: 'Developer Tools',
      },
    ],
  };

  const cursorPlugin = {
    name: 'redpanda',
    displayName: MARKETPLACE_DISPLAY_NAME,
    version,
    description: basePlugin.description,
    author: basePlugin.author,
    publisher: 'Redpanda Data',
    homepage: REPO_URL,
    repository: REPO_URL,
    license: basePlugin.license,
    category: 'devops',
    keywords: basePlugin.keywords,
  };

  const cursorMarketplace = {
    name: MARKETPLACE_NAME,
    owner: {
      name: 'Redpanda Data',
      url: ORG_URL,
    },
    plugins: [
      {
        name: 'redpanda',
        source: './',
        description: FULL_PLUGIN_MARKETPLACE_DESCRIPTION,
      },
    ],
  };

  const geminiExtension = {
    name: 'redpanda',
    version,
    description: basePlugin.description,
    mcpServers: {
      'redpanda-docs': {
        url: docsMcpUrl,
      },
    },
  };

  return {
    version,
    files: {
      '.claude-plugin/plugin.json': formatJson(claudePlugin),
      '.claude-plugin/marketplace.json': formatJson(claudeMarketplace),
      '.codex-plugin/plugin.json': formatJson(codexPlugin),
      '.agents/plugins/marketplace.json': formatJson(codexMarketplace),
      '.cursor-plugin/plugin.json': formatJson(cursorPlugin),
      '.cursor-plugin/marketplace.json': formatJson(cursorMarketplace),
      'gemini-extension.json': formatJson(geminiExtension),
    },
  };
}

export function syncManifests({ rootDir = DEFAULT_ROOT, check = false, bump, setVersion } = {}) {
  const basePlugin = readJson(resolve(rootDir, '.claude-plugin/plugin.json'));
  const currentVersion = basePlugin.version ?? '1.0.0';

  let targetVersion = currentVersion;
  if (setVersion) {
    parseSemver(setVersion);
    targetVersion = setVersion;
  } else if (bump) {
    targetVersion = bumpSemver(currentVersion, bump);
  }

  const { version, files } = buildManifests(rootDir, targetVersion);
  const drifted = [];

  for (const [relPath, expected] of Object.entries(files)) {
    const absPath = resolve(rootDir, relPath);
    const actual = existsSync(absPath) ? readFileSync(absPath, 'utf8') : null;
    if (actual !== expected) {
      drifted.push(relPath);
      if (!check) {
        mkdirSync(dirname(absPath), { recursive: true });
        writeFileSync(absPath, expected, 'utf8');
      }
    }
  }

  return { version, drifted, files };
}

function parseArgs(argv) {
  const options = { check: false, bump: undefined, setVersion: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') {
      options.check = true;
    } else if (arg === '--bump') {
      options.bump = argv[++i];
    } else if (arg === '--set') {
      options.setVersion = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.check && (options.bump || options.setVersion)) {
    throw new Error('--check cannot be combined with --bump or --set');
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const { version, drifted } = syncManifests(options);
  if (options.check) {
    if (drifted.length > 0) {
      console.error(
        `Plugin manifests are out of sync (${drifted.join(', ')}). Run \`node scripts/sync-manifests.mjs\`.`
      );
      process.exit(1);
    }
    console.log(`All plugin manifests are in sync at v${version}.`);
  } else {
    console.log(version);
  }
}
