import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
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
  assert.equal(findings[0].suggestedPinnedUses, 'actions/checkout@<40-char-commit-sha>');
  assert.match(findings[0].remediation, /Review the upstream action commit/);
  const [check] = auditWorkflowActionRefs(root);
  assert.equal(check.status, 'warn');
  assert.match(check.message, /not pinned/);
  assert.match(check.remediation ?? '', /owner\/repo@<40-char-sha>/);
  assert.match(JSON.stringify(check.evidence), /suggestedPinnedUses/);
});

test('can fail unpinned GitHub Actions refs when policy is required', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-actions-required-'));
  const workflowDir = path.join(root, '.github', 'workflows');
  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(path.join(workflowDir, 'ci.yml'), `
jobs:
  test:
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
`);

  const [blocked] = auditWorkflowActionRefs(root, { requirePinnedActions: true });
  assert.equal(blocked.status, 'fail');
  assert.match(blocked.message, /not allowlisted/);

  const [allowed] = auditWorkflowActionRefs(root, {
    requirePinnedActions: true,
    allowedUnpinnedActions: ['actions/checkout@v6', 'actions/setup-node@v6'],
  });
  assert.equal(allowed.status, 'warn');
  assert.match(allowed.message, /2 allowlisted/);
});

test('can fail verification when unpinned GitHub Actions refs are required to be pinned', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-actions-verify-'));
  const workflowDir = path.join(root, '.github', 'workflows');
  mkdirSync(path.join(root, '.holdthegoblin'), { recursive: true });
  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(path.join(root, '.holdthegoblin', 'config.json'), JSON.stringify({
    githubActions: {
      requirePinnedActions: true,
    },
  }));
  writeFileSync(path.join(workflowDir, 'ci.yml'), `
jobs:
  test:
    steps:
      - uses: actions/checkout@v6
`);

  const { verify } = await import('../src/core/verify.js');
  const result = await verify({ root, writeReport: false, includeSecurity: false });
  assert.equal(result.ok, false);
  assert.ok(result.checks.some((check) => check.id === 'github-actions:pinning' && check.status === 'fail'));
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

test('publish workflow keeps release checks separate from publish credentials', () => {
  const workflow = readFileSync('.github/workflows/publish.yml', 'utf8');
  const verify = workflowJobBlock(workflow, 'verify');
  const publish = workflowJobBlock(workflow, 'publish');

  assert.match(verify, /permissions:\n\s+contents: read/);
  assert.match(verify, /npm run release:check/);
  assert.doesNotMatch(verify, /id-token: write/);
  assert.doesNotMatch(verify, /contents: write/);

  assert.match(publish, /needs: verify/);
  assert.match(publish, /permissions:\n\s+contents: write\n\s+id-token: write/);
  assert.match(publish, /persist-credentials: false/);
  assert.match(publish, /npm ci --ignore-scripts/);
  assert.match(publish, /npm pack --json --ignore-scripts/);
  assert.match(publish, /npm publish "\$PACKAGE_FILE" --provenance --access public --ignore-scripts/);
  assert.doesNotMatch(publish, /npm run release:check/);
});

function workflowJobBlock(workflow: string, job: string): string {
  const start = workflow.indexOf(`  ${job}:\n`);
  assert.notEqual(start, -1, `missing workflow job ${job}`);
  const rest = workflow.slice(start + 1);
  const next = rest.search(/\n  [A-Za-z0-9_-]+:\n/);
  return next >= 0 ? workflow.slice(start, start + 1 + next) : workflow.slice(start);
}
