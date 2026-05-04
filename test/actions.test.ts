import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { auditWorkflowActionRefs, findUnpinnedWorkflowActionRefs } from '../src/core/actions.js';

test('finds unpinned external GitHub Actions refs', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-actions-audit-'));
  const workflowDir = path.join(root, '.github', 'workflows');
  mkdirSync(workflowDir, { recursive: true });
  const file = path.join(workflowDir, 'ci.yml');
  writeFileSync(file, `
name: CI
jobs:
  test:
    steps:
      - uses: actions/checkout@v6
      - uses: owner/repo/path@0123456789abcdef0123456789abcdef01234567
      - uses: ./.github/actions/local
      - uses: docker://alpine:3.20
`);

  const findings = findUnpinnedWorkflowActionRefs(root, file);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].uses, 'actions/checkout@v6');
  assert.equal(findings[0].ref, 'v6');
  const [check] = auditWorkflowActionRefs(root);
  assert.equal(check.status, 'warn');
  assert.match(check.message, /not pinned/);
});

test('passes when external GitHub Actions refs are pinned to full SHAs', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-actions-pinned-'));
  const workflowDir = path.join(root, '.github', 'workflows');
  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(path.join(workflowDir, 'ci.yaml'), `
jobs:
  test:
    steps:
      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567
`);

  const [check] = auditWorkflowActionRefs(root);
  assert.equal(check.status, 'pass');
});

test('does not follow symlinked workflow directories', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-actions-symlink-root-'));
  const outside = mkdtempSync(path.join(tmpdir(), 'htg-actions-symlink-outside-'));
  mkdirSync(path.join(root, '.github'), { recursive: true });
  writeFileSync(path.join(outside, 'ci.yml'), 'steps:\n  - uses: actions/checkout@v6\n');
  try {
    symlinkSync(outside, path.join(root, '.github', 'workflows'), 'dir');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM' || (error as NodeJS.ErrnoException).code === 'EINVAL') {
      t.skip('directory symlinks are not available in this environment');
      return;
    }
    throw error;
  }

  assert.deepEqual(auditWorkflowActionRefs(root), []);
});
