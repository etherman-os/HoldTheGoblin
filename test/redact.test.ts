import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { redactSensitiveText } from '../src/core/redact.js';
import { appendEvent, eventLogPath, readEvents } from '../src/core/events.js';
import { writeReports } from '../src/core/report.js';
import { runShell } from '../src/core/runner.js';
import type { VerifyResult } from '../src/core/types.js';

test('redacts common credential-like values from text', () => {
  const openAi = 'sk-' + '1234567890abcdefghijklmnopqrstuvwxyzABCDE'; // holdthegoblin: allow-secret
  const github = 'ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789ABCD'; // holdthegoblin: allow-secret
  const slack = 'xoxb-' + '1234567890abcdefghijklmnop'; // holdthegoblin: allow-secret
  const redacted = redactSensitiveText(`token="${openAi}" github="${github}" slack="${slack}" password="super-secret-value-12345"`); // holdthegoblin: allow-secret

  assert.doesNotMatch(redacted, /abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(redacted, /super-secret-value/);
  assert.match(redacted, /gh_\[redacted\]/);
  assert.match(redacted, /xox-\[redacted\]/);
  assert.match(redacted, /token="\[redacted\]"/);
});

test('redacts common header, jwt, npm, gitlab, and url credential forms', () => {
  const text = [
    'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturevalue123',
    'npm_abCDefgh1234567890TOKEN',
    'glpat-abcdefghijklmnopqrst',
    'https://user:super-secret-value-12345@example.invalid/path',
  ].join('\n'); // holdthegoblin: allow-secret
  const redacted = redactSensitiveText(text);
  assert.doesNotMatch(redacted, /eyJhbGci/);
  assert.doesNotMatch(redacted, /npm_abCD/);
  assert.doesNotMatch(redacted, /glpat-abcdef/);
  assert.doesNotMatch(redacted, /super-secret-value/);
});

test('redacts split flags and encoded credential fragments', () => {
  const text = [
    'guard --token raw-secret',
    'guard --client-secret=raw-secret',
    'curl -u user:super-secret-value https://example.invalid',
    'https://example.invalid/callback?api_key%3Draw-secret',
    'Authorization%3A%20Bearer%20raw-secret',
  ].join('\n'); // holdthegoblin: allow-secret
  const redacted = redactSensitiveText(text);
  assert.doesNotMatch(redacted, /raw-secret/);
  assert.doesNotMatch(redacted, /super-secret-value/);
  assert.match(redacted, /--token \[redacted\]/);
  assert.match(redacted, /--client-secret=\[redacted\]/);
  assert.match(redacted, /\[redacted encoded credential\]/);
});

test('redacts event payloads before writing event logs', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-redact-events-'));
  const token = 'npm_abCDefgh1234567890TOKEN'; // holdthegoblin: allow-secret
  appendEvent(root, {
    type: 'verify',
    ok: false,
    summary: `failed ${token}`,
    data: { authorization: `Bearer ${token}`, nested: { apiKey: token } },
  });

  const events = readEvents(root, 1);
  assert.doesNotMatch(JSON.stringify(events), /abCDefgh/);
});

test('event log rejects symlinks before append or read', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-event-symlink-root-'));
  const outside = path.join(tmpdir(), `htg-event-outside-${Date.now()}.jsonl`);
  mkdirSync(path.join(root, '.holdthegoblin'), { recursive: true });
  symlinkSync(outside, eventLogPath(root));

  assert.throws(
    () => appendEvent(root, { type: 'policy', ok: false, summary: 'blocked' }),
    /event log must not be a symlink/
  );
  assert.throws(
    () => readEvents(root, 1),
    /event log must not be a symlink/
  );
});

test('redacts command output before evidence is returned', async () => {
  const token = 'sk-' + '1234567890abcdefghijklmnopqrstuvwxyzABCDE'; // holdthegoblin: allow-secret
  const encryptedKey = [
    '-----BEGIN ENCRYPTED PRIVATE KEY-----',
    'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC',
    '-----END ENCRYPTED PRIVATE KEY-----',
  ].join('\n'); // holdthegoblin: allow-secret
  const payload = `${token}\n${encryptedKey}`;
  const result = await runShell({
    id: 'redact:test',
    label: 'Redaction test',
    command: `node -e ${JSON.stringify(`console.log(${JSON.stringify(payload)})`)}`,
    kind: 'doctor',
    required: false,
    reason: 'test',
  }, { cwd: process.cwd(), timeoutMs: 5000, retries: 0 });

  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(result.command, /abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(result.stdout, /abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(result.stdout, /ENCRYPTED PRIVATE KEY/);
  assert.match(result.stdout, /sk-\[redacted\]/);
  assert.match(result.stdout, /\[redacted private key\]/);
});

test('runner strips ambient sensitive environment variables unless explicitly allowed', async () => {
  const key = 'HTG_RUNNER_TEST_TOKEN';
  const value = 'sk-' + '1234567890abcdefghijklmnopqrstuvwxyzABCDE'; // holdthegoblin: allow-secret
  const previous = process.env[key];
  process.env[key] = value;
  try {
    const script = 'process.stdout.write(process.env.HTG_RUNNER_TEST_TOKEN || "missing");';
    const blocked = await runShell({
      id: 'env:blocked',
      label: 'Blocked env',
      command: process.execPath,
      argv: [process.execPath, '-e', script],
      shell: false,
      kind: 'doctor',
      required: false,
      reason: 'test',
    }, { cwd: process.cwd(), timeoutMs: 5000, retries: 0 });

    assert.equal(blocked.exitCode, 0);
    assert.equal(blocked.stdout, 'missing');
    assert.ok(blocked.env?.blockedSensitiveKeys.includes(key));

    const allowed = await runShell({
      id: 'env:allowed',
      label: 'Allowed env',
      command: process.execPath,
      argv: [process.execPath, '-e', script],
      env: [key],
      shell: false,
      kind: 'doctor',
      required: false,
      reason: 'test',
    }, { cwd: process.cwd(), timeoutMs: 5000, retries: 0 });

    assert.equal(allowed.exitCode, 0);
    assert.match(allowed.stdout, /sk-\[redacted\]/);
    assert.doesNotMatch(allowed.stdout, /abcdefghijklmnopqrstuvwxyz/);
    assert.deepEqual(allowed.env?.explicitKeys, [key]);
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

test('runner supports run-level environment allowlists', async () => {
  const key = 'HTG_RUNNER_OPTIONS_TOKEN';
  const value = 'sk-' + '1234567890abcdefghijklmnopqrstuvwxyzABCDE'; // holdthegoblin: allow-secret
  const previous = process.env[key];
  process.env[key] = value;
  try {
    const result = await runShell({
      id: 'env:options',
      label: 'Options env',
      command: process.execPath,
      argv: [process.execPath, '-e', 'process.stdout.write(process.env.HTG_RUNNER_OPTIONS_TOKEN || "missing");'],
      shell: false,
      kind: 'doctor',
      required: false,
      reason: 'test',
    }, { cwd: process.cwd(), timeoutMs: 5000, retries: 0, env: [key] });

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /sk-\[redacted\]/);
    assert.doesNotMatch(result.stdout, /abcdefghijklmnopqrstuvwxyz/);
    assert.deepEqual(result.env?.explicitKeys, [key]);
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

test('timed out commands terminate child processes', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-runner-timeout-'));
  const marker = path.join(root, 'marker.txt');
  const childCode = 'setTimeout(()=>require("fs").writeFileSync(process.argv[1],"alive"),500); setInterval(()=>{},1000);';
  const result = await runShell({
    id: 'timeout:child',
    label: 'Timeout child',
    command: `node -e ${JSON.stringify(childCode)} ${JSON.stringify(marker)}`,
    kind: 'doctor',
    required: false,
    reason: 'test',
  }, { cwd: root, timeoutMs: 50, retries: 0 });

  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal(result.timedOut, true);
  assert.equal(existsSync(marker), false);
});

test('redacts verification reports before writing evidence files', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-redact-report-'));
  const token = 'sk-' + '1234567890abcdefghijklmnopqrstuvwxyzABCDE'; // holdthegoblin: allow-secret
  const encryptedKey = [
    '-----BEGIN ENCRYPTED PRIVATE KEY-----',
    'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC',
    '-----END ENCRYPTED PRIVATE KEY-----',
  ].join('\n'); // holdthegoblin: allow-secret
  const result: VerifyResult = {
    ok: false,
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
      testCommands: [{ id: 'test', label: 'Test', command: `echo ${token}`, kind: 'javascript', required: true, reason: 'test' }],
      securityCommands: [],
      warnings: [],
    },
    commandResults: [{
      id: 'test',
      label: 'Test',
      command: `echo ${token}`,
      skipped: false,
      exitCode: 1,
      stdout: `${token}\n${encryptedKey}`,
      stderr: encryptedKey,
      durationMs: 1,
      timedOut: false,
      attempts: 1,
    }],
    checks: [{ id: 'x', label: '<script>alert(1)</script>', status: 'fail', severity: 'high', message: `failed ${token}\n${encryptedKey}` }],
    findings: [{ scanner: 'secret', severity: 'HIGH', message: `secret ${token}\n${encryptedKey}`, file: 'src/<bad>.ts', line: 7, ruleId: '<rule>' }],
    edgeCases: [{ file: 'src/app.ts', line: 3, category: 'auth', message: 'auth branch', suggestedTest: '<img src=x onerror=alert(1)>' }],
  };

  const written = writeReports(root, result);
  assert.doesNotMatch(JSON.stringify(written), /abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(JSON.stringify(written), /ENCRYPTED PRIVATE KEY/);
  assert.doesNotMatch(readFileSync(written.reportPath!, 'utf8'), /abcdefghijklmnopqrstuvwxyz/);
  assert.ok(written.htmlReportPath);
  assert.equal(existsSync(written.htmlReportPath), true);
  assert.equal(existsSync(path.join(root, '.holdthegoblin', 'latest.html')), true);
  const html = readFileSync(written.htmlReportPath, 'utf8');
  assert.doesNotMatch(html, /abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(html, /ENCRYPTED PRIVATE KEY/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('report writer rejects unsafe run ids', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-report-runid-'));
  const result: VerifyResult = {
    ok: true,
    mode: 'balanced',
    root,
    runId: '../escape',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1000,
    changedFiles: [],
    detections: { root, kinds: ['javascript'], testCommands: [], securityCommands: [], warnings: [] },
    commandResults: [],
    checks: [],
    findings: [],
    edgeCases: [],
  };

  assert.throws(() => writeReports(root, result), /Invalid verification run id/);
});

test('report writer rejects symlinked runtime directories before creating reports outside root', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-report-symlink-root-'));
  const outside = mkdtempSync(path.join(tmpdir(), 'htg-report-symlink-outside-'));
  try {
    symlinkSync(outside, path.join(root, '.holdthegoblin'), 'dir');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM' || (error as NodeJS.ErrnoException).code === 'EINVAL') {
      t.skip('directory symlinks are not available in this environment');
      return;
    }
    throw error;
  }

  const result: VerifyResult = {
    ok: true,
    mode: 'balanced',
    root,
    runId: '20260101000000-abc123',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1000,
    changedFiles: [],
    detections: { root, kinds: ['javascript'], testCommands: [], securityCommands: [], warnings: [] },
    commandResults: [],
    checks: [],
    findings: [],
    edgeCases: [],
  };

  assert.throws(() => writeReports(root, result), /runtime directory must not be a symlink/);
  assert.equal(existsSync(path.join(outside, 'runs')), false);
});

test('report writer rejects symlinked runs directory before creating reports outside root', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-report-runs-symlink-root-'));
  const outside = mkdtempSync(path.join(tmpdir(), 'htg-report-runs-symlink-outside-'));
  mkdirSync(path.join(root, '.holdthegoblin'));
  try {
    symlinkSync(outside, path.join(root, '.holdthegoblin', 'runs'), 'dir');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM' || (error as NodeJS.ErrnoException).code === 'EINVAL') {
      t.skip('directory symlinks are not available in this environment');
      return;
    }
    throw error;
  }

  const result: VerifyResult = {
    ok: true,
    mode: 'balanced',
    root,
    runId: '20260101000000-abc123',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1000,
    changedFiles: [],
    detections: { root, kinds: ['javascript'], testCommands: [], securityCommands: [], warnings: [] },
    commandResults: [],
    checks: [],
    findings: [],
    edgeCases: [],
  };

  assert.throws(() => writeReports(root, result), /runtime directory must not be a symlink/);
  assert.equal(existsSync(path.join(outside, `${result.runId}.json`)), false);
});
