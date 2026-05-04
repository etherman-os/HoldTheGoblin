import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createCheckpoint } from '../src/core/checkpoint.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

test('command-local help does not run verification', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-cli-help-'));
  const output = execFileSync(process.execPath, [cli, 'verify', '--help'], { cwd: root, encoding: 'utf8' });
  assert.match(output, /Usage:/);
  assert.equal(existsSync(path.join(root, '.holdthegoblin', 'latest.md')), false);
});

test('boolean flags do not consume checkpoint rollback ids', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-cli-bool-'));
  writeFileSync(path.join(root, 'app.txt'), 'before\n');
  const checkpoint = await createCheckpoint(root, 'before');
  writeFileSync(path.join(root, 'app.txt'), 'after\n');

  const output = execFileSync(process.execPath, [cli, 'checkpoint', 'rollback', '--delete-new', checkpoint.id], { cwd: root, encoding: 'utf8' });
  assert.match(output, new RegExp(checkpoint.id));
});

test('boolean false values disable boolean CLI flags', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-cli-dry-run-'));
  const planPath = path.join(root, 'deploy.json');
  const marker = path.join(root, 'deployed.txt');
  const script = path.join(root, 'deploy.js');
  writeFileSync(script, 'require("fs").writeFileSync("deployed.txt", "ok");\n');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    name: 'cli-dry-run',
    verify: false,
    checkpoint: false,
    allowPolicyDowngrade: true,
    shadow: { argv: [process.execPath, script] },
  }));

  execFileSync(process.execPath, [cli, 'deploy', 'run', '--plan', planPath, '--dry-run', 'false', '--allow-dangerous'], { cwd: root, encoding: 'utf8' });
  assert.equal(existsSync(marker), true);
});

test('config validate reports invalid config through CLI', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-cli-config-'));
  mkdirSync(path.join(root, '.holdthegoblin'));
  writeFileSync(path.join(root, '.holdthegoblin', 'config.json'), JSON.stringify({
    version: 1,
    execution: { retries: -1 },
  }));

  assert.throws(
    () => execFileSync(process.execPath, [cli, 'config', 'validate'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    (error) => {
      const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? '';
      const stdout = (error as { stdout?: Buffer }).stdout?.toString() ?? '';
      assert.match(`${stdout}\n${stderr}`, /execution\.retries/);
      return true;
    }
  );
});

test('verify can append a GitHub Actions step summary', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-cli-gh-summary-'));
  const summaryPath = path.join(root, 'step-summary.md');
  const env = {
    ...process.env,
    GITHUB_ACTIONS: 'true',
    GITHUB_STEP_SUMMARY: summaryPath,
  };

  const output = execFileSync(process.execPath, [cli, 'verify', '--format', 'text', '--github-step-summary'], { cwd: root, env, encoding: 'utf8' });
  assert.match(output, /HoldTheGoblin PASS/);
  assert.equal(existsSync(summaryPath), true);
  const summary = readFileSync(summaryPath, 'utf8');
  assert.match(summary, /HoldTheGoblin Verification PASS/);
  assert.match(summary, /\.holdthegoblin\/latest\.md/);
  assert.doesNotMatch(summary, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
