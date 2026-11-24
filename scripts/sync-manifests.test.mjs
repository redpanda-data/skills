import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ADP_SKILLS, bumpSemver, parseSemver, syncManifests } from './sync-manifests.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('semver helpers', () => {
  test('parses valid semver and rejects invalid values', () => {
    assert.deepEqual(parseSemver('1.2.3'), { major: 1, minor: 2, patch: 3 });
    assert.throws(() => parseSemver('1.2'), /Invalid SemVer/);
    assert.throws(() => parseSemver('v1.2.3'), /Invalid SemVer/);
  });

  test('bumps patch, minor, and major versions', () => {
    assert.equal(bumpSemver('1.2.3', 'patch'), '1.2.4');
    assert.equal(bumpSemver('1.2.3', 'minor'), '1.3.0');
    assert.equal(bumpSemver('1.2.3', 'major'), '2.0.0');
    assert.throws(() => bumpSemver('1.2.3', 'beta'), /Unsupported bump level/);
  });
});

describe('manifest synchronization', () => {
  test('repository manifests are currently in sync', () => {
    const result = syncManifests({ rootDir: REPO_ROOT, check: true });
    assert.deepEqual(result.drifted, []);
    parseSemver(result.version);
  });

  test('generates compliant manifests across harnesses and detects version drift', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'redpanda-skills-manifests-'));
    try {
      cpSync(join(REPO_ROOT, '.claude-plugin'), join(scratch, '.claude-plugin'), { recursive: true });
      cpSync(join(REPO_ROOT, '.mcp.json'), join(scratch, '.mcp.json'));
      for (const skill of ADP_SKILLS) {
        cpSync(join(REPO_ROOT, skill), join(scratch, skill), { recursive: true });
      }

      const bumped = syncManifests({ rootDir: scratch, bump: 'patch' });
      const checkClean = syncManifests({ rootDir: scratch, check: true });
      assert.deepEqual(checkClean.drifted, []);

      const claudePlugin = JSON.parse(readFileSync(join(scratch, '.claude-plugin/plugin.json'), 'utf8'));
      const claudeMarketplace = JSON.parse(readFileSync(join(scratch, '.claude-plugin/marketplace.json'), 'utf8'));
      const codexPlugin = JSON.parse(readFileSync(join(scratch, '.codex-plugin/plugin.json'), 'utf8'));
      const codexMarketplace = JSON.parse(readFileSync(join(scratch, '.agents/plugins/marketplace.json'), 'utf8'));
      const cursorPlugin = JSON.parse(readFileSync(join(scratch, '.cursor-plugin/plugin.json'), 'utf8'));
      const cursorMarketplace = JSON.parse(readFileSync(join(scratch, '.cursor-plugin/marketplace.json'), 'utf8'));
      const geminiExtension = JSON.parse(readFileSync(join(scratch, 'gemini-extension.json'), 'utf8'));

      assert.equal(claudePlugin.version, bumped.version);
      assert.equal(claudeMarketplace.metadata.version, bumped.version);
      assert.deepEqual(
        claudeMarketplace.plugins.map((plugin) => [plugin.name, plugin.version]),
        [
          ['redpanda', bumped.version],
          ['redpanda-adp', bumped.version],
        ]
      );
      assert.equal(codexPlugin.version, bumped.version);
      assert.equal(codexMarketplace.metadata.version, bumped.version);
      assert.equal(codexMarketplace.plugins[0].version, bumped.version);
      assert.equal(cursorPlugin.version, bumped.version);
      assert.equal('keywords' in cursorMarketplace.plugins[0], false);
      assert.equal('category' in cursorMarketplace.plugins[0], false);
      assert.equal(geminiExtension.version, bumped.version);
      assert.equal(geminiExtension.mcpServers['redpanda-docs'].url, 'https://docs.redpanda.com/mcp');

      writeFileSync(
        join(scratch, '.cursor-plugin/plugin.json'),
        JSON.stringify({ ...cursorPlugin, version: '0.0.1' }, null, 2)
      );
      const drifted = syncManifests({ rootDir: scratch, check: true });
      assert.deepEqual(drifted.drifted, ['.cursor-plugin/plugin.json']);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
