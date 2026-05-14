import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createCheckpoint } from '../src/core/checkpoint.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

test('command-local help does not run verification', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-cli-help-'));
  const output = execFileSync(process.execPath, [cli, 'verify', '--help'], { cwd: root, encoding: 'utf8' });
  assert.match(output, /Usage:/);
  assert.equal(existsSync(path.join(root, '.holdthegoblin', 'latest.md')), false);
});

test('boolean flags do not consume checkpoint rollback ids', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-cli-bool-'));
  writeFileSync(path.join(root, 'app.txt'), 'before\n');
  const checkpoint = await createCheckpoint(root, 'before');
  writeFileSync(path.join(root, 'app.txt'), 'after\n');

  const output = execFileSync(process.execPath, [cli, 'checkpoint', 'rollback', '--delete-new', checkpoint.id], { cwd: root, encoding: 'utf8' });
  assert.match(output, new RegExp(checkpoint.id));
});

test('boolean false values disable boolean CLI flags', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-cli-dry-run-'));
  const planPath = path.join(root, 'deploy.json');
  const marker = path.join(root, 'deployed.txt');
  const script = path.join(root, 'deploy.js');
  writeFileSync(script, 'require("fs").writeFileSync("deployed.txt", "ok");\n');
  writeFileSync(planPath, JSON.stringify({
    version: 1,
    name: 'cli-dry-run',
    verify: false,
    checkpoint: false,
    allowPolicyDowngrade: true,
    shadow: { argv: [process.execPath, script] },
  }));

  execFileSync(process.execPath, [cli, 'deploy', 'run', '--plan', planPath, '--dry-run', 'false', '--allow-dangerous'], { cwd: root, encoding: 'utf8' });
  assert.equal(existsSync(marker), true);
});

test('config validate reports invalid config through CLI', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-cli-config-'));
  mkdirSync(path.join(root, '.holdthegoblin'));
  writeFileSync(path.join(root, '.holdthegoblin', 'config.json'), JSON.stringify({
    version: 1,
    execution: { retries: -1 },
  }));

  assert.throws(
    () => execFileSync(process.execPath, [cli, 'config', 'validate'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    (error) => {
      const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? '';
      const stdout = (error as { stdout?: Buffer }).stdout?.toString() ?? '';
      assert.match(`${stdout}\n${stderr}`, /execution\.retries/);
      return true;
    }
  );
});

test('verify can append a GitHub Actions step summary', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-cli-gh-summary-'));
  const summaryPath = path.join(root, 'step-summary.md');
  const env = {
    ...process.env,
    GITHUB_ACTIONS: 'true',
    GITHUB_STEP_SUMMARY: summaryPath,
  };

  const output = execFileSync(process.execPath, [cli, 'verify', '--format', 'text', '--github-step-summary'], { cwd: root, env, encoding: 'utf8' });
  assert.match(output, /HoldTheGoblin PASS/);
  assert.equal(existsSync(summaryPath), true);
  const summary = readFileSync(summaryPath, 'utf8');
  assert.match(summary, /HoldTheGoblin Verification PASS/);
  assert.match(summary, /\.holdthegoblin\/latest\.md/);
  assert.doesNotMatch(summary, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('verify can emit GitHub Actions annotations', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-cli-gh-annotations-'));
  const env = {
    ...process.env,
    GITHUB_ACTIONS: 'true',
  };

  const output = execFileSync(process.execPath, [cli, 'verify', '--format', 'text', '--github-annotations'], { cwd: root, env, encoding: 'utf8' });
  assert.match(output, /::warning /);
  assert.match(output, /HoldTheGoblin PASS/);
});

test('GitHub Actions annotations are rejected for machine-readable verify stdout', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-cli-gh-annotations-json-'));

  assert.throws(
    () => execFileSync(process.execPath, [cli, 'verify', '--format', 'json', '--github-annotations'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    (error) => {
      const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? '';
      assert.match(stderr, /cannot be combined with json or html/);
      return true;
    }
  );
});

test('risk assess reports advisory tool-call decisions through CLI', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-cli-risk-'));
  assert.throws(
    () => execFileSync(process.execPath, [cli, 'risk', 'assess', '--command', 'rm -rf --no-preserve-root /', '--format', 'json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    (error) => {
      const stdout = (error as { stdout?: Buffer }).stdout?.toString() ?? '';
      assert.match(stdout, /"decision": "deny"/);
      assert.match(stdout, /Destructive rm target/);
      return true;
    }
  );

  const allowed = execFileSync(process.execPath, [cli, 'risk', 'assess', '--tool', 'Read', '--path', 'src/app.ts', '--format', 'json'], { cwd: root, encoding: 'utf8' });
  assert.match(allowed, /"decision": "allow"/);
});

test('readiness reports machine-readable project score through CLI', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-cli-readiness-'));
  assert.throws(
    () => execFileSync(process.execPath, [cli, 'readiness', '--format', 'json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    (error) => {
      const stdout = (error as { stdout?: Buffer }).stdout?.toString() ?? '';
      const result = JSON.parse(stdout) as { schema?: string; status?: string; checks?: unknown[] };
      assert.equal(result.schema, 'holdthegoblin.readiness.v1');
      assert.equal(result.status, 'at-risk');
      assert.ok(Array.isArray(result.checks));
      return true;
    }
  );
});

test('mcp-http rejects literal auth token flag outside loopback', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-cli-mcp-token-'));
  assert.throws(
    () => execFileSync(process.execPath, [cli, 'mcp-http', '--host', '0.0.0.0', '--port', '0', '--allowed-host', 'example.com', '--auth-token', 'long-enough-token'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    (error) => {
      const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? '';
      assert.match(stderr, /HOLDTHEGOBLIN_MCP_HTTP_TOKEN/);
      return true;
    }
  );
});
