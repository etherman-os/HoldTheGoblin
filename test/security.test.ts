import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_CONFIG } from '../src/core/config.js';
import { parseSemgrep, parseTrivy, runSecurityScans, scanSecrets } from '../src/core/security.js';

test('built-in secret scanner catches common tokens', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'htg-secret-'));
  const token = 'ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789ABCD'; // holdthegoblin: allow-secret
  writeFileSync(path.join(dir, 'index.js'), `const token = "${token}";\n`);
  const findings = scanSecrets(dir);
  assert.ok(findings.length >= 1);
  assert.ok(findings.some((finding) => finding.scanner === 'secret' && finding.ruleId === 'github-token'));
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
