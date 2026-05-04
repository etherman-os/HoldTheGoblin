import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runDeployPlan } from '../src/core/deploy.js';

test('deploy guard runs phases and writes report', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-deploy-'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e ""' } }));
  const ok = writeNodeScript(root, 'ok.js', 'process.exit(0);\n');
  const planPath = path.join(root, 'deploy.json');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    name: 'test-deploy',
    verify: false,
    checkpoint: false,
    allowPolicyDowngrade: true,
    shadow: { argv: [process.execPath, ok] },
    canary: { argv: [process.execPath, ok] },
  }));

  const result = await runDeployPlan({ root, planPath, allowDangerous: true });
  assert.equal(result.ok, true);
  assert.equal(result.phases.map((phase) => phase.phase).join(','), 'policy,shadow,canary');
  assert.match(readFileSync(result.reportPath, 'utf8'), /test-deploy/);
  assert.equal(existsSync(result.runReportPath), true);
});

test('deploy guard blocks policy downgrades unless externally approved', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-deploy-policy-'));
  const ok = writeNodeScript(root, 'ok.js', 'process.exit(0);\n');
  const planPath = path.join(root, 'deploy.json');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    name: 'policy-downgrade',
    verify: false,
    checkpoint: false,
    shadow: { argv: [process.execPath, ok] },
  }));

  const result = await runDeployPlan({ root, planPath });
  assert.equal(result.ok, false);
  assert.equal(result.phases[0].phase, 'policy');
  assert.match(result.phases[0].message ?? '', /pre-deploy verification is disabled/);
});

test('deploy guard blocks promotion without a health gate', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-deploy-health-policy-'));
  const ok = writeNodeScript(root, 'ok.js', 'process.exit(0);\n');
  const planPath = path.join(root, 'deploy.json');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    name: 'missing-health',
    verify: true,
    checkpoint: true,
    promote: { argv: [process.execPath, ok] },
  }));

  const result = await runDeployPlan({ root, planPath });
  assert.equal(result.ok, false);
  assert.equal(result.phases[0].phase, 'policy');
  assert.match(result.phases[0].message ?? '', /without any health gate/);
});

test('deploy guard rolls back checkpoint on failed phase', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-deploy-rollback-'));
  const tracked = path.join(root, 'app.txt');
  writeFileSync(tracked, 'before\n');
  const fail = writeNodeScript(root, 'fail.js', 'require("fs").writeFileSync("app.txt", "after\\n"); process.exit(1);\n');
  const ok = writeNodeScript(root, 'ok.js', 'process.exit(0);\n');
  const planPath = path.join(root, 'deploy.json');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    name: 'rollback-deploy',
    verify: false,
    checkpoint: true,
    allowPolicyDowngrade: true,
    shadow: { argv: [process.execPath, fail] },
    rollback: { argv: [process.execPath, ok] },
    rollbackCheckpoint: true,
  }));

  const result = await runDeployPlan({ root, planPath, allowDangerous: true });
  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, true);
  assert.equal(readFileSync(tracked, 'utf8'), 'before\n');
});

test('deploy guard blocks denied destructive commands by default', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-deploy-risk-'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e ""' } }));
  const planPath = path.join(root, 'deploy.json');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    name: 'dangerous-deploy',
    verify: true,
    checkpoint: true,
    shadow: { command: 'rm -rf /' },
  }));

  const result = await runDeployPlan({ root, planPath });
  assert.equal(result.ok, false);
  assert.match(phase(result, 'shadow').commandResult?.stderr ?? '', /Blocked by HoldTheGoblin/);
});

test('deploy plan validation rejects persisted literal credentials', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-deploy-secret-plan-'));
  const planPath = path.join(root, 'deploy.json');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    name: 'secret-plan',
    verify: false,
    checkpoint: false,
    allowPolicyDowngrade: true,
    shadow: { argv: ['deploy', '--api-key', 'raw-secret'] },
  }));

  await assert.rejects(
    runDeployPlan({ root, planPath, allowDangerous: true }),
    (error) => {
      assert.match(String((error as Error).message), /literal credential/);
      assert.doesNotMatch(String((error as Error).message), /raw-secret/);
      return true;
    }
  );

  writeFileSync(planPath, JSON.stringify({
    version: 1,
    name: 'env-ref-plan',
    verify: false,
    checkpoint: false,
    allowPolicyDowngrade: true,
    shadow: { argv: ['deploy', '--api-key', '$TOKEN'] },
  }));
  const result = await runDeployPlan({ root, planPath, dryRun: true, allowDangerous: true });
  assert.equal(result.ok, true);
});

test('deploy command env allowlist passes key names without persisting values', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-deploy-env-'));
  const key = 'HTG_DEPLOY_TEST_TOKEN';
  const value = 'sk-' + '1234567890abcdefghijklmnopqrstuvwxyzABCDE'; // holdthegoblin: allow-secret
  const previous = process.env[key];
  process.env[key] = value;
  const script = writeNodeScript(root, 'env.js', 'process.stdout.write(process.env.HTG_DEPLOY_TEST_TOKEN || "missing");\n');
  const planPath = path.join(root, 'deploy.json');
  try {
    writeFileSync(planPath, JSON.stringify({
      version: 1,
      name: 'env-allowlist',
      verify: false,
      checkpoint: false,
      allowPolicyDowngrade: true,
      shadow: { argv: [process.execPath, script] },
    }));
    const blocked = await runDeployPlan({ root, planPath, allowDangerous: true });
    assert.equal(phase(blocked, 'shadow').commandResult?.stdout, 'missing');

    writeFileSync(planPath, JSON.stringify({
      version: 1,
      name: 'env-allowlist',
      verify: false,
      checkpoint: false,
      allowPolicyDowngrade: true,
      shadow: { argv: [process.execPath, script], env: [key] },
    }));
    const allowed = await runDeployPlan({ root, planPath, allowDangerous: true });
    assert.match(phase(allowed, 'shadow').commandResult?.stdout ?? '', /sk-\[redacted\]/);
    assert.doesNotMatch(JSON.stringify(allowed), /abcdefghijklmnopqrstuvwxyz/);
    assert.deepEqual(phase(allowed, 'shadow').commandResult?.env?.explicitKeys, [key]);
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

test('deploy command env allowlist combines config and command keys', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-deploy-config-env-'));
  const configKey = 'HTG_DEPLOY_CONFIG_TOKEN';
  const commandKey = 'HTG_DEPLOY_COMMAND_TOKEN';
  const configPrevious = process.env[configKey];
  const commandPrevious = process.env[commandKey];
  process.env[configKey] = 'sk-' + '1234567890abcdefghijklmnopqrstuvwxyzABCDE'; // holdthegoblin: allow-secret
  process.env[commandKey] = 'sk-' + 'ABCDEabcdefghijklmnopqrstuvwxyz1234567890'; // holdthegoblin: allow-secret
  mkdirSync(path.join(root, '.holdthegoblin'), { recursive: true });
  writeFileSync(path.join(root, '.holdthegoblin', 'config.json'), JSON.stringify({
    version: 1,
    execution: { env: [configKey] },
  }));
  const script = writeNodeScript(root, 'combined-env.js', [
    'const keys = ["HTG_DEPLOY_CONFIG_TOKEN", "HTG_DEPLOY_COMMAND_TOKEN"];',
    'process.stdout.write(keys.map((key) => process.env[key] ? "set" : "missing").join(","));',
  ].join('\n'));
  const planPath = path.join(root, 'deploy.json');
  try {
    writeFileSync(planPath, JSON.stringify({
      version: 1,
      name: 'combined-env',
      verify: false,
      checkpoint: false,
      allowPolicyDowngrade: true,
      shadow: { argv: [process.execPath, script], env: [commandKey] },
    }));
    const result = await runDeployPlan({ root, planPath, allowDangerous: true });
    const commandResult = phase(result, 'shadow').commandResult;
    assert.equal(commandResult?.stdout, 'set,set');
    assert.deepEqual(commandResult?.env?.explicitKeys, [commandKey, configKey].sort());
  } finally {
    if (configPrevious === undefined) delete process.env[configKey];
    else process.env[configKey] = configPrevious;
    if (commandPrevious === undefined) delete process.env[commandKey];
    else process.env[commandKey] = commandPrevious;
  }
});

test('deploy guard does not let allowDangerous bypass hard deny rules', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-deploy-hard-deny-'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e ""' } }));
  const planPath = path.join(root, 'deploy.json');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    name: 'hard-deny-deploy',
    verify: true,
    checkpoint: true,
    shadow: { command: 'dropdb production', allowDangerous: true },
  }));

  const result = await runDeployPlan({ root, planPath });
  assert.equal(result.ok, false);
  assert.match(phase(result, 'shadow').commandResult?.stderr ?? '', /Database deletion is blocked/);
});

test('deploy guard blocks approval-required commands by default', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-deploy-ask-risk-'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e ""' } }));
  const planPath = path.join(root, 'deploy.json');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    name: 'ask-risk-deploy',
    verify: true,
    checkpoint: true,
    shadow: { command: 'terraform destroy' },
  }));

  const result = await runDeployPlan({ root, planPath });
  assert.equal(result.ok, false);
  assert.match(phase(result, 'shadow').commandResult?.stderr ?? '', /human review/);
});

test('deploy report redacts secrets embedded in plan commands', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-deploy-redact-'));
  const token = 'sk-' + '1234567890abcdefghijklmnopqrstuvwxyzABCDE'; // holdthegoblin: allow-secret
  const planPath = path.join(root, 'deploy.json');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    name: 'redact-deploy',
    verify: false,
    checkpoint: false,
    allowPolicyDowngrade: true,
    shadow: { command: `rm -rf / # ${token}` },
  }));

  const result = await runDeployPlan({ root, planPath, allowDangerous: true });
  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result), /abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(readFileSync(result.reportPath, 'utf8'), /abcdefghijklmnopqrstuvwxyz/);
});

test('deploy plan paths resolve relative to the supplied root', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-deploy-root-path-'));
  const ok = writeNodeScript(root, 'ok.js', 'process.exit(0);\n');
  writeFileSync(path.join(root, 'deploy.json'), JSON.stringify({
    version: 1,
    name: 'root-relative',
    verify: false,
    checkpoint: false,
    allowPolicyDowngrade: true,
    shadow: { argv: [process.execPath, ok] },
  }));

  const previous = process.cwd();
  process.chdir(tmpdir());
  try {
    const result = await runDeployPlan({ root, planPath: 'deploy.json', allowDangerous: true });
    assert.equal(result.ok, true);
  } finally {
    process.chdir(previous);
  }
});

test('deploy guard verifies before checkpoint and deploy phases', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-deploy-verify-'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e ""' } }));
  const ok = writeNodeScript(root, 'ok.js', 'process.exit(0);\n');
  const planPath = path.join(root, 'deploy.json');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    name: 'verify-first',
    verify: true,
    checkpoint: true,
    shadow: { argv: [process.execPath, ok] },
  }));

  const result = await runDeployPlan({ root, planPath });
  assert.equal(result.ok, true, JSON.stringify(result.phases.map((item) => ({
    phase: item.phase,
    ok: item.ok,
    message: item.message,
    verifyChecks: item.verifyResult?.checks.map((check) => ({ id: check.id, status: check.status, message: check.message })),
  })), null, 2));
  assert.equal(result.phases.map((phase) => phase.phase).join(','), 'verify,checkpoint,shadow');
});

test('deploy guard stops before deploy when verification fails', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-deploy-verify-fail-'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } }));
  const deploy = writeNodeScript(root, 'deploy.js', 'require("fs").writeFileSync("deployed", "yes");\n');
  const planPath = path.join(root, 'deploy.json');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    name: 'verify-fail',
    verify: true,
    checkpoint: true,
    shadow: { argv: [process.execPath, deploy] },
  }));

  const result = await runDeployPlan({ root, planPath });
  assert.equal(result.ok, false);
  assert.equal(result.phases.map((phase) => phase.phase).join(','), 'verify');
});

test('deploy dry-run marks rollback phases as on-failure only', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-deploy-dry-'));
  const ok = writeNodeScript(root, 'ok.js', 'process.exit(0);\n');
  const planPath = path.join(root, 'deploy.json');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    name: 'dry-run',
    verify: false,
    checkpoint: false,
    allowPolicyDowngrade: true,
    shadow: { argv: [process.execPath, ok] },
    rollback: { argv: [process.execPath, ok] },
    rollbackCheckpoint: true,
  }));

  const result = await runDeployPlan({ root, planPath, dryRun: true, allowDangerous: true });
  assert.deepEqual(result.phases.map((phase) => [phase.phase, phase.onFailure === true]), [
    ['policy', false],
    ['shadow', false],
    ['rollback', true],
  ]);
});

test('deploy dry-run evaluates command risk without executing', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-deploy-dry-risk-'));
  const marker = path.join(root, 'marker.txt');
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e ""' } }));
  const planPath = path.join(root, 'deploy.json');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    name: 'dry-run-risk',
    verify: true,
    checkpoint: true,
    shadow: { command: `rm -rf / && touch ${marker}` },
  }));

  const result = await runDeployPlan({ root, planPath, dryRun: true });
  assert.equal(result.ok, false);
  assert.match(phase(result, 'shadow').message ?? '', /Dry run blocked/);
  assert.equal(existsSync(marker), false);
});

test('deploy rejects plan paths outside the project root', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-deploy-root-'));
  const outside = path.join(tmpdir(), `htg-outside-${Date.now()}.json`);
  writeFileSync(outside, JSON.stringify({
    version: 1,
    name: 'outside',
    verify: false,
    checkpoint: false,
  }));

  await assert.rejects(
    runDeployPlan({ root, planPath: outside }),
    /escapes project root/
  );
});

test('deploy rejects plan symlinks that resolve outside the project root', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-deploy-symlink-'));
  const outside = path.join(tmpdir(), `htg-deploy-outside-${Date.now()}.json`);
  writeFileSync(outside, JSON.stringify({
    version: 1,
    name: 'outside-symlink',
    verify: false,
    checkpoint: false,
  }));
  symlinkSync(outside, path.join(root, 'deploy.json'));

  await assert.rejects(
    runDeployPlan({ root, planPath: 'deploy.json' }),
    /resolves outside project root/
  );
});

test('deploy allowDangerous requires an external run approval', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-deploy-ask-approval-'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e ""' } }));
  const planPath = path.join(root, 'deploy.json');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    name: 'ask-approval',
    verify: true,
    checkpoint: true,
    shadow: { command: 'terraform destroy', allowDangerous: true },
  }));

  const blocked = await runDeployPlan({ root, planPath });
  assert.equal(blocked.ok, false);
  assert.match(phase(blocked, 'shadow').commandResult?.stderr ?? '', /--allow-dangerous/);
});

function writeNodeScript(root: string, name: string, source: string): string {
  const file = path.join(root, name);
  writeFileSync(file, source);
  return file;
}

function phase(result: Awaited<ReturnType<typeof runDeployPlan>>, name: string) {
  const match = result.phases.find((item) => item.phase === name);
  assert.ok(match, `missing phase ${name}`);
  return match;
}
