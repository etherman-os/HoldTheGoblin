import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_CONFIG, appPath, configPath } from '../src/core/config.js';
import { initProject } from '../src/core/init.js';
import { assessReadiness, renderReadinessText } from '../src/core/readiness.js';
import type { VerifyResult } from '../src/core/types.js';

test('readiness reports release-ready when verification, CI, agents, scanners, and policy are covered', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-readiness-ready-'));
  initProject({ root, agent: 'all', executablePath: '/tmp/holdthegoblin', mode: 'balanced' });
  mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'name: ci\njobs:\n  verify:\n    steps:\n      - run: npm run release:check\n');
  writeFileSync(configPath(root), JSON.stringify({
    ...DEFAULT_CONFIG,
    githubActions: { ...DEFAULT_CONFIG.githubActions, requirePinnedActions: true },
  }, null, 2) + '\n');

  const result = await assessReadiness({
    root,
    now: new Date('2026-05-05T08:00:00.000Z'),
    latestVerify: verifyResult(root, true, '2026-05-05T07:30:00.000Z'),
    toolExists: async () => true,
  });

  assert.equal(result.status, 'release-ready');
  assert.equal(result.score, 100);
  assert.equal(result.summary.failures, 0);
  assert.equal(result.checks.find((check) => check.id === 'ci:verification-gate')?.status, 'pass');
  assert.equal(result.checks.find((check) => check.id === 'agents:coverage')?.status, 'pass');
  assert.equal(result.checks.find((check) => check.id === 'scanners:coverage')?.status, 'pass');
});

test('readiness is at-risk when evidence, CI, agents, and external scanners are missing', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-readiness-risk-'));

  const result = await assessReadiness({
    root,
    now: new Date('2026-05-05T08:00:00.000Z'),
    latestVerify: null,
    toolExists: async () => false,
  });

  assert.equal(result.status, 'at-risk');
  assert.ok(result.score < 50);
  assert.equal(result.checks.find((check) => check.id === 'evidence:latest-verify')?.status, 'fail');
  assert.equal(result.checks.find((check) => check.id === 'agents:coverage')?.status, 'fail');
  assert.match(result.checks.find((check) => check.id === 'scanners:coverage')?.message ?? '', /skipped, not passed/);
  assert.match(result.checks.find((check) => check.id === 'agents:coverage')?.remediation ?? '', /wrap --agent all/);
  assert.match(renderReadinessText(result), /Fix: Run holdthegoblin verify/);
});

test('readiness warns on stale passing verification evidence', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-readiness-stale-'));
  initProject({ root, agent: 'claude-code', executablePath: '/tmp/holdthegoblin', mode: 'balanced' });

  const result = await assessReadiness({
    root,
    now: new Date('2026-05-05T08:00:00.000Z'),
    latestVerify: verifyResult(root, true, '2026-05-03T06:00:00.000Z'),
    toolExists: async () => true,
  });

  const evidence = result.checks.find((check) => check.id === 'evidence:latest-verify');
  assert.equal(evidence?.status, 'warn');
  assert.match(evidence?.message ?? '', /stale/);
  assert.match(evidence?.remediation ?? '', /readiness --verify/);
});

test('readiness distinguishes hook engine tests from installed Claude wiring', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-readiness-agent-message-'));
  writeFileSync(path.join(root, 'AGENTS.md'), '## HoldTheGoblin Project Rules\n\nRun npm run release:check.\n');

  const result = await assessReadiness({
    root,
    now: new Date('2026-05-05T08:00:00.000Z'),
    latestVerify: verifyResult(root, true, '2026-05-05T07:30:00.000Z'),
    toolExists: async () => true,
  });

  const agentCoverage = result.checks.find((check) => check.id === 'agents:coverage');
  assert.equal(agentCoverage?.status, 'warn');
  assert.match(agentCoverage?.message ?? '', /Demo tests exercise the hook engine/);
  assert.match(agentCoverage?.remediation ?? '', /wrap --agent claude-code/);
});

test('readiness reads the newest immutable verification report when no injection is provided', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-readiness-latest-'));
  mkdirSync(appPath(root, 'runs'), { recursive: true });
  writeFileSync(appPath(root, 'runs', '20260501000000-old111.json'), JSON.stringify(verifyResult(root, false, '2026-05-01T00:00:00.000Z'), null, 2));
  writeFileSync(appPath(root, 'runs', '20260505070000-new222.json'), JSON.stringify({
    ...verifyResult(root, true, '2026-05-05T07:00:00.000Z'),
    runId: '20260505070000-new222',
  }, null, 2));

  const result = await assessReadiness({
    root,
    now: new Date('2026-05-05T08:00:00.000Z'),
    toolExists: async () => false,
  });

  assert.equal(result.latestVerify?.runId, '20260505070000-new222');
  assert.equal(result.checks.find((check) => check.id === 'evidence:latest-verify')?.status, 'pass');
});

function verifyResult(root: string, ok: boolean, finishedAt: string): VerifyResult {
  return {
    ok,
    mode: 'balanced',
    root,
    runId: '20260505073000-abc123',
    startedAt: finishedAt,
    finishedAt,
    durationMs: 1200,
    changedFiles: [],
    detections: { root, kinds: ['unknown'], testCommands: [], securityCommands: [], warnings: [] },
    commandResults: [],
    checks: [],
    findings: [],
    edgeCases: [],
    reportPath: path.join(root, '.holdthegoblin', 'latest.md'),
    jsonReportPath: path.join(root, '.holdthegoblin', 'runs', '20260505073000-abc123.json'),
  };
}
