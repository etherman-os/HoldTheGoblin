import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_CONFIG } from '../src/core/config.js';
import { evaluateResults, isOk } from '../src/core/policy.js';
import { parseSemgrep, parseTrivy, runSecurityScans, scanSecrets } from '../src/core/security.js';

test('built-in secret scanner catches common tokens', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'htg-secret-'));
  const token = 'ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789ABCD'; // holdthegoblin: allow-secret
  writeFileSync(path.join(dir, 'index.js'), `const token = "${token}";\n`);
  const findings = scanSecrets(dir);
  assert.ok(findings.length >= 1);
  assert.ok(findings.some((finding) => finding.scanner === 'secret' && finding.ruleId === 'github-token'));
});

test('built-in secret scanner ignores high-entropy absolute paths', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'htg-secret-path-'));
  const pathSegment = 'htg-deploy-verify-' + 'AbCdEf1234567890';
  writeFileSync(path.join(dir, 'deploy.json'), JSON.stringify({
    argv: [process.execPath, path.join(tmpdir(), pathSegment, 'ok.js')],
  }));

  assert.deepEqual(scanSecrets(dir), []);
});

test('parses semgrep json findings', () => {
  const findings = parseSemgrep(JSON.stringify({
    results: [{ check_id: 'x.y', path: 'a.js', start: { line: 2 }, extra: { severity: 'ERROR', message: 'bad' } }],
  }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'ERROR');
});

test('parses trivy json findings', () => {
  const findings = parseTrivy(JSON.stringify({
    Results: [{ Target: 'package-lock.json', Vulnerabilities: [{ VulnerabilityID: 'CVE-1', Severity: 'CRITICAL', Title: 'bad dep' }] }],
  }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'CRITICAL');
});

test('security scanner invalid json is reported as skipped warning input', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-security-command-'));
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  const semgrep = path.join(bin, 'semgrep');
  writeFileSync(semgrep, '#!/bin/sh\necho not-json\n');
  chmodSync(semgrep, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ''}`;
  try {
    const result = await runSecurityScans(root, DEFAULT_CONFIG, [{
      id: 'semgrep',
      label: 'Semgrep SAST',
      command: 'semgrep scan --json',
      kind: 'security',
      required: false,
      reason: 'test',
    }]);
    assert.match(result.skipped.join('\n'), /invalid JSON/);
    assert.equal(result.commandResults[0].stdout, '[scanner output omitted after parsing]');
  } finally {
    process.env.PATH = previousPath;
  }
});

test('security scanner raw json output is omitted from command evidence', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-security-redact-command-'));
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  const semgrep = path.join(bin, 'semgrep');
  writeFileSync(semgrep, '#!/bin/sh\necho \'{"results":[{"check_id":"x","path":"a.js","start":{"line":1},"extra":{"severity":"INFO","message":"bad sk-1234567890abcdefghijklmnopqrstuvwxyzABCDE"}}]}\'\n'); // holdthegoblin: allow-secret
  chmodSync(semgrep, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ''}`;
  try {
    const result = await runSecurityScans(root, DEFAULT_CONFIG, [{
      id: 'semgrep',
      label: 'Semgrep SAST',
      command: 'semgrep scan --json',
      kind: 'security',
      required: false,
      reason: 'test',
    }]);
    assert.ok(result.findings.some((finding) => finding.scanner === 'semgrep'));
    assert.equal(result.commandResults[0].stdout, '[scanner output omitted after parsing]');
    assert.doesNotMatch(JSON.stringify(result.commandResults), /abcdefghijklmnopqrstuvwxyz/);
  } finally {
    process.env.PATH = previousPath;
  }
});

test('security scanner truncated json is reported as skipped warning input', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-security-truncated-command-'));
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  const semgrep = path.join(bin, 'semgrep');
  const payloadFile = path.join(root, 'payload.json');
  const payload = JSON.stringify({
    results: [{
      check_id: 'x',
      path: 'a.js',
      start: { line: 1 },
      extra: { severity: 'ERROR', message: 'bad' },
    }],
    padding: 'x'.repeat(130_000),
  });
  writeFileSync(payloadFile, payload);
  writeFileSync(semgrep, `#!/bin/sh\ncat ${JSON.stringify(payloadFile)}\n`);
  chmodSync(semgrep, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ''}`;
  try {
    const result = await runSecurityScans(root, DEFAULT_CONFIG, [{
      id: 'semgrep',
      label: 'Semgrep SAST',
      command: 'semgrep scan --json',
      kind: 'security',
      required: false,
      reason: 'test',
    }]);
    assert.match(result.skipped.join('\n'), /truncated/);
    assert.equal(result.commandResults[0].stdout, '[scanner output omitted after parsing]');
    assert.equal(result.commandResults[0].stdoutTruncated, true);
    const checks = evaluateResults(DEFAULT_CONFIG, [], result.findings, result.skipped.map((item) => `${item}; scanner skipped.`));
    assert.equal(isOk(checks), false);
  } finally {
    process.env.PATH = previousPath;
  }
});

test('configuration policy downgrades are explicit warnings or blocking release findings', () => {
  const downgraded = {
    ...DEFAULT_CONFIG,
    failPolicy: {
      ...DEFAULT_CONFIG.failPolicy,
      failOnSecrets: false,
      semgrepSeverities: [],
    },
    security: {
      ...DEFAULT_CONFIG.security,
      secretScan: false,
    },
  };

  const advisory = evaluateResults(downgraded, [], [], []);
  const advisoryCheck = advisory.find((check) => check.id === 'config:policy-floor');
  assert.equal(advisoryCheck?.status, 'warn');
  assert.match(advisoryCheck?.message ?? '', /policy downgrade/);

  const blocking = evaluateResults(downgraded, [], [], [], [], { enforcePolicyFloor: true });
  assert.equal(blocking.find((check) => check.id === 'config:policy-floor')?.status, 'fail');
  assert.equal(isOk(blocking), false);
});
