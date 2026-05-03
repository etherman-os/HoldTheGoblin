import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseSemgrep, parseTrivy, scanSecrets } from '../src/core/security.js';

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
