import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCheckpoint } from '../src/core/checkpoint.js';

const cli = new URL('../src/cli.js', import.meta.url);

test('command-local help does not run verification', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-cli-help-'));
  const output = execFileSync(process.execPath, [cli.pathname, 'verify', '--help'], { cwd: root, encoding: 'utf8' });
  assert.match(output, /Usage:/);
  assert.equal(existsSync(path.join(root, '.holdthegoblin', 'latest.md')), false);
});

test('boolean flags do not consume checkpoint rollback ids', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-cli-bool-'));
  writeFileSync(path.join(root, 'app.txt'), 'before\n');
  const checkpoint = await createCheckpoint(root, 'before');
  writeFileSync(path.join(root, 'app.txt'), 'after\n');

  const output = execFileSync(process.execPath, [cli.pathname, 'checkpoint', 'rollback', '--delete-new', checkpoint.id], { cwd: root, encoding: 'utf8' });
  assert.match(output, new RegExp(checkpoint.id));
});

test('boolean false values disable boolean CLI flags', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-cli-dry-run-'));
  const planPath = path.join(root, 'deploy.json');
  const marker = path.join(root, 'deployed.txt');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    name: 'cli-dry-run',
    verify: false,
    checkpoint: false,
    shadow: { command: 'node -e "require(\\"fs\\").writeFileSync(\\"deployed.txt\\", \\"ok\\")"' },
  }));

  execFileSync(process.execPath, [cli.pathname, 'deploy', 'run', '--plan', planPath, '--dry-run', 'false'], { cwd: root, encoding: 'utf8' });
  assert.equal(existsSync(marker), true);
});
