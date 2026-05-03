import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { redactSensitiveText } from '../src/core/redact.js';
import { appendEvent, readEvents } from '../src/core/events.js';
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

test('redacts command output before evidence is returned', async () => {
  const token = 'sk-' + '1234567890abcdefghijklmnopqrstuvwxyzABCDE'; // holdthegoblin: allow-secret
  const result = await runShell({
    id: 'redact:test',
    label: 'Redaction test',
    command: `node -e "console.log('${token}')"`,
    kind: 'doctor',
    required: false,
    reason: 'test',
  }, { cwd: process.cwd(), timeoutMs: 5000, retries: 0 });

  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(result.command, /abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(result.stdout, /abcdefghijklmnopqrstuvwxyz/);
  assert.match(result.stdout, /sk-\[redacted\]/);
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
  const result: VerifyResult = {
    ok: false,
    mode: 'balanced',
    root,
    runId: 'redact-run',
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
      stdout: token,
      stderr: '',
      durationMs: 1,
      timedOut: false,
      attempts: 1,
    }],
    checks: [{ id: 'x', label: 'X', status: 'fail', severity: 'high', message: `failed ${token}` }],
    findings: [],
    edgeCases: [],
  };

  const written = writeReports(root, result);
  assert.doesNotMatch(JSON.stringify(written), /abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(readFileSync(written.reportPath!, 'utf8'), /abcdefghijklmnopqrstuvwxyz/);
});
