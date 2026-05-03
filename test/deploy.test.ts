import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runDeployPlan } from '../src/core/deploy.js';

test('deploy guard runs phases and writes report', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-deploy-'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e ""' } }));
  const planPath = path.join(root, 'deploy.json');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    name: 'test-deploy',
    verify: false,
    checkpoint: false,
    shadow: { command: 'node -e "process.exit(0)"' },
    canary: { command: 'node -e "process.exit(0)"' },
  }));

  const result = await runDeployPlan({ root, planPath });
  assert.equal(result.ok, true);
  assert.equal(result.phases.map((phase) => phase.phase).join(','), 'shadow,canary');
  assert.match(readFileSync(result.reportPath, 'utf8'), /test-deploy/);
});

test('deploy guard rolls back checkpoint on failed phase', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-deploy-rollback-'));
  const tracked = path.join(root, 'app.txt');
  writeFileSync(tracked, 'before\n');
  const planPath = path.join(root, 'deploy.json');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    name: 'rollback-deploy',
    verify: false,
    checkpoint: true,
    shadow: { command: 'node -e "require(\\"fs\\").writeFileSync(\\"app.txt\\", \\"after\\\\n\\"); process.exit(1)"' },
    rollback: { command: 'node -e "process.exit(0)"' },
    rollbackCheckpoint: true,
  }));

  const result = await runDeployPlan({ root, planPath });
  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, true);
  assert.equal(readFileSync(tracked, 'utf8'), 'before\n');
});

test('deploy guard blocks denied destructive commands by default', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-deploy-risk-'));
  const planPath = path.join(root, 'deploy.json');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    name: 'dangerous-deploy',
    verify: false,
    checkpoint: false,
    shadow: { command: 'rm -rf /' },
  }));

  const result = await runDeployPlan({ root, planPath });
  assert.equal(result.ok, false);
  assert.match(result.phases[0].commandResult?.stderr ?? '', /Blocked by HoldTheGoblin/);
});

test('deploy guard verifies before deploy phases', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-deploy-verify-'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e ""' } }));
  const planPath = path.join(root, 'deploy.json');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    name: 'verify-first',
    verify: true,
    checkpoint: false,
    shadow: { command: 'node -e "process.exit(0)"' },
  }));

  const result = await runDeployPlan({ root, planPath });
  assert.equal(result.ok, true);
  assert.equal(result.phases.map((phase) => phase.phase).join(','), 'verify,shadow');
});

test('deploy guard stops before deploy when verification fails', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-deploy-verify-fail-'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } }));
  const planPath = path.join(root, 'deploy.json');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    name: 'verify-fail',
    verify: true,
    checkpoint: false,
    shadow: { command: 'node -e "require(\\"fs\\").writeFileSync(\\"deployed\\", \\"yes\\")"' },
  }));

  const result = await runDeployPlan({ root, planPath });
  assert.equal(result.ok, false);
  assert.equal(result.phases.map((phase) => phase.phase).join(','), 'verify');
});

test('deploy dry-run marks rollback phases as on-failure only', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-deploy-dry-'));
  const planPath = path.join(root, 'deploy.json');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    name: 'dry-run',
    verify: false,
    checkpoint: false,
    shadow: { command: 'node -e "process.exit(0)"' },
    rollback: { command: 'node -e "process.exit(0)"' },
    rollbackCheckpoint: true,
  }));

  const result = await runDeployPlan({ root, planPath, dryRun: true });
  assert.deepEqual(result.phases.map((phase) => [phase.phase, phase.onFailure === true]), [
    ['shadow', false],
    ['rollback', true],
    ['checkpointRollback', true],
  ]);
});
