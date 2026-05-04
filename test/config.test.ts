import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_CONFIG, appPath, configPath, ensureAppDirs, loadConfig, validateConfigFile, validateConfigObject, validateProjectConfig } from '../src/core/config.js';
import { detectProject } from '../src/core/detect.js';
import { evaluateResults, isOk } from '../src/core/policy.js';
import type { HoldTheGoblinConfig } from '../src/core/types.js';

test('config validation accepts partial documented config', () => {
  const parsed = validateConfigObject({
    version: 1,
    mode: 'strict',
    failPolicy: {
      failOnMissingTests: true,
      semgrepSeverities: ['WARNING', 'ERROR'],
    },
    githubActions: {
      requirePinnedActions: true,
      allowedUnpinnedActions: ['actions/checkout@v6'],
    },
    commands: {
      javascript: ['npm run test:unit'],
    },
  });

  assert.equal(parsed.mode, 'strict');
  assert.equal(parsed.githubActions?.requirePinnedActions, true);
});

test('config validation normalizes severities and trims command/action lists', () => {
  const parsed = validateConfigObject({
    failPolicy: {
      semgrepSeverities: ['error'],
      trivySeverities: ['high', 'critical'],
    },
    execution: {
      env: [' API_TOKEN ', 'DEPLOY_TOKEN'],
    },
    githubActions: {
      allowedUnpinnedActions: [' actions/checkout@v6 '],
    },
    commands: {
      javascript: [' npm run test:unit '],
    },
  });

  assert.deepEqual(parsed.failPolicy?.semgrepSeverities, ['ERROR']);
  assert.deepEqual(parsed.failPolicy?.trivySeverities, ['HIGH', 'CRITICAL']);
  assert.deepEqual(parsed.execution?.env, ['API_TOKEN', 'DEPLOY_TOKEN']);
  assert.deepEqual(parsed.githubActions?.allowedUnpinnedActions, ['actions/checkout@v6']);
  assert.deepEqual(parsed.commands?.javascript, ['npm run test:unit']);
});

test('config validation reports precise paths for invalid values', () => {
  assert.throws(
    () => validateConfigObject({
      version: 2,
      execution: { timeoutMs: 10, env: ['bad-key'] },
      unknown: true,
    }),
    (error) => {
      const issues = (error as { issues?: Array<{ path: string }> }).issues ?? [];
      assert.ok(issues.some((issue) => issue.path === '$.version'));
      assert.ok(issues.some((issue) => issue.path === '$.execution.timeoutMs'));
      assert.ok(issues.some((issue) => issue.path === '$.execution.env[0]'));
      assert.ok(issues.some((issue) => issue.path === '$'));
      return true;
    }
  );
});

test('config validation rejects blank commands and sanitizes untrusted keys', () => {
  assert.throws(
    () => validateConfigObject({ commands: { javascript: ['   '] } }),
    (error) => {
      const issues = (error as { issues?: Array<{ path: string }> }).issues ?? [];
      assert.ok(issues.some((issue) => issue.path === '$.commands.javascript[0]'));
      return true;
    }
  );

  const tokenLikeKey = 'sk-' + '1234567890abcdefghijklmnopqrstuvwxyzABCDE'; // holdthegoblin: allow-secret
  assert.throws(
    () => validateConfigObject({ commands: { [tokenLikeKey]: ['npm test'] } }),
    (error) => {
      const text = JSON.stringify((error as { issues?: unknown }).issues ?? []);
      assert.doesNotMatch(text, /1234567890abcdefghijklmnopqrstuvwxyzABCDE/);
      assert.doesNotMatch(text, /[\r\n]/);
      assert.match(text, /\$\.commands\.<key>/);
      return true;
    }
  );
});

test('config validation rejects persisted literal credentials in commands', () => {
  assert.throws(
    () => validateConfigObject({ commands: { javascript: ['deploy --token raw-secret'] } }),
    (error) => {
      const text = JSON.stringify((error as { issues?: unknown }).issues ?? []);
      assert.match(text, /literal credential/);
      assert.doesNotMatch(text, /raw-secret/);
      return true;
    }
  );

  const parsed = validateConfigObject({ commands: { javascript: ['deploy --token $TOKEN'] } });
  assert.deepEqual(parsed.commands?.javascript, ['deploy --token $TOKEN']);
});

test('loadConfig rejects invalid repo config instead of merging unsafe types', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-config-invalid-'));
  mkdirSync(path.dirname(configPath(root)), { recursive: true });
  writeFileSync(configPath(root), JSON.stringify({
    version: 1,
    failPolicy: {
      failOnSecrets: 'false',
    },
  }));

  assert.equal(validateProjectConfig(root).ok, false);
  assert.throws(() => loadConfig(root), /Invalid HoldTheGoblin config/);
});

test('config validation rejects sensitive paths and symlink escapes before reading', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-config-path-'));
  mkdirSync(path.dirname(configPath(root)), { recursive: true });
  writeFileSync(path.join(root, '.env'), '{"version":1}\n');

  const sensitive = validateConfigFile(path.join(root, '.env'), { root });
  assert.equal(sensitive.ok, false);
  assert.match(sensitive.issues.map((issue) => issue.message).join('\n'), /sensitive file/i);

  const outside = path.join(mkdtempSync(path.join(tmpdir(), 'htg-config-outside-')), 'config.json');
  writeFileSync(outside, '{"version":1}\n');
  try {
    symlinkSync(outside, configPath(root));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM' || (error as NodeJS.ErrnoException).code === 'EINVAL') {
      t.skip('file symlinks are not available in this environment');
      return;
    }
    throw error;
  }

  const escaped = validateProjectConfig(root);
  assert.equal(escaped.ok, false);
  assert.match(escaped.issues.map((issue) => issue.message).join('\n'), /outside project root/i);
});

test('runtime directories use private unix permissions', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-runtime-mode-'));
  ensureAppDirs(root);
  for (const dir of [appPath(root), appPath(root, 'runs'), appPath(root, 'checkpoints'), appPath(root, 'tmp')]) {
    assert.equal(statSync(dir).mode & 0o777, 0o700, dir);
  }
});

test('blank programmatic commands cannot satisfy missing-test policy', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-config-blank-command-'));
  const config: HoldTheGoblinConfig = {
    ...DEFAULT_CONFIG,
    mode: 'strict',
    commands: { unknown: ['   '] },
  };
  const detection = detectProject(root, config);
  const checks = evaluateResults(config, [], [], detection.warnings);

  assert.equal(detection.testCommands.length, 0);
  assert.equal(checks.find((check) => check.id === 'tests:missing')?.status, 'fail');
  assert.equal(isOk(checks), false);
});
