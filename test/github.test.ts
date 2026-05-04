import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { renderGithubStepSummary, writeGithubStepSummary } from '../src/core/github.js';
import type { VerifyResult } from '../src/core/types.js';

test('GitHub step summary is redacted, escaped, and concise', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-gh-summary-'));
  const token = 'sk-' + '1234567890abcdefghijklmnopqrstuvwxyzABCDE'; // holdthegoblin: allow-secret
  const encryptedKey = [
    '-----BEGIN ENCRYPTED PRIVATE KEY-----',
    'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC',
    '-----END ENCRYPTED PRIVATE KEY-----',
  ].join('\n'); // holdthegoblin: allow-secret
  const result = sampleResult(root, {
    ok: false,
    checks: [
      { id: 'x', label: '<script>alert(1)</script>', status: 'fail', severity: 'high', message: `failed ${token}\n${encryptedKey}` },
      { id: 'skip', label: 'Semgrep SAST', status: 'skip', severity: 'info', message: 'semgrep not installed; scanner skipped.' },
    ],
    commandResults: [{
      id: 'test',
      label: 'Unit | tests',
      command: `echo ${token}`,
      skipped: false,
      exitCode: 1,
      stdout: `raw stdout ${token}`,
      stderr: encryptedKey,
      durationMs: 1234,
      timedOut: false,
      attempts: 1,
    }],
    findings: [{ scanner: 'secret', severity: 'CRITICAL', message: `secret ${token}`, file: 'src/<bad>.ts', line: 7, ruleId: '<rule>' }],
    reportPath: path.join(root, '.holdthegoblin', 'latest.md'),
    htmlReportPath: path.join(root, '.holdthegoblin', 'latest.html'),
    jsonReportPath: path.join(root, '.holdthegoblin', 'runs', '20260101000000-abc123.json'),
  });

  const summary = renderGithubStepSummary(result);
  assert.doesNotMatch(summary, /abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(summary, /ENCRYPTED PRIVATE KEY/);
  assert.doesNotMatch(summary, /<script>/);
  assert.doesNotMatch(summary, /<bad>/);
  assert.doesNotMatch(summary, /raw stdout/);
  assert.match(summary, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(summary, /src\/&lt;bad&gt;\.ts/);
  assert.match(summary, /\.holdthegoblin\/latest\.md/);
  assert.match(summary, /\.holdthegoblin\/latest\.html/);
  assert.doesNotMatch(summary, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('GitHub step summary writes only when GitHub Actions env is present', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-gh-summary-write-'));
  const summaryPath = path.join(root, 'step-summary.md');
  const result = sampleResult(root);

  assert.throws(() => writeGithubStepSummary(result, { env: { GITHUB_STEP_SUMMARY: summaryPath } }), /GitHub Actions/);
  assert.equal(writeGithubStepSummary(result, { env: { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summaryPath } }), summaryPath);
  assert.equal(existsSync(summaryPath), true);
  assert.match(readFileSync(summaryPath, 'utf8'), /HoldTheGoblin Verification PASS/);
});

test('GitHub step summary rejects symlink target paths', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-gh-summary-symlink-'));
  const outside = path.join(root, 'outside.md');
  const summaryPath = path.join(root, 'summary.md');
  writeFileSync(outside, '');
  try {
    symlinkSync(outside, summaryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM' || (error as NodeJS.ErrnoException).code === 'EINVAL') {
      t.skip('file symlinks are not available in this environment');
      return;
    }
    throw error;
  }

  assert.throws(
    () => writeGithubStepSummary(sampleResult(root), { env: { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summaryPath } }),
    /must not be a symlink/
  );
});

function sampleResult(root: string, overrides: Partial<VerifyResult> = {}): VerifyResult {
  return {
    ok: true,
    mode: 'balanced',
    root,
    runId: '20260101000000-abc123',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1000,
    changedFiles: [],
    detections: {
      root,
      kinds: ['javascript'],
      testCommands: [],
      securityCommands: [],
      warnings: [],
    },
    commandResults: [],
    checks: [{ id: 'ok', label: 'Policy', status: 'pass', severity: 'info', message: 'Policy passed.' }],
    findings: [],
    edgeCases: [],
    reportPath: path.join(root, '.holdthegoblin', 'latest.md'),
    ...overrides,
  };
}
