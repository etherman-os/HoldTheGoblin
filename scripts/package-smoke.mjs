#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(path.join(tmpdir(), 'htg-package-smoke-'));

try {
  const pack = run('npm', ['pack', '--json', '--pack-destination', temp], { cwd: root });
  const [packed] = JSON.parse(pack.stdout);
  assert.ok(packed?.filename, 'npm pack did not report a tarball filename.');
  const files = packed.files.map((file) => file.path);
  const fileSet = new Set(files);

  for (const required of [
    'dist/src/cli.js',
    'dist/src/index.js',
    'dist/src/index.d.ts',
    'README.md',
    'LICENSE',
    'SECURITY.md',
    'PRIVACY.md',
    'docs/CONFIG.md',
    'docs/SCANNERS.md',
    'examples/github-action/holdthegoblin-verify.yml',
    'examples/deploy/holdthegoblin.deploy.json',
  ]) {
    assert.ok(fileSet.has(required), `Packed tarball missing ${required}.`);
  }

  for (const file of files) {
    assert.equal(file.includes('/dist/test/'), false, `Packed tarball includes tests: ${file}`);
    assert.equal(isRuntimeEvidenceFile(file), false, `Packed tarball includes local run evidence: ${file}`);
    assert.equal(file.endsWith('.js.map'), false, `Packed tarball includes sourcemap without sources: ${file}`);
    assert.equal(isSensitiveFileName(file), false, `Packed tarball includes credential-like file path: ${file}`);
  }

  const tarball = path.join(temp, packed.filename);
  const project = path.join(temp, 'install');
  mkdirSync(project);
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ private: true, type: 'module' }) + '\n');
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--fund=false', '--prefix', project, tarball], { cwd: temp });

  const installedPkg = JSON.parse(readFileSync(path.join(project, 'node_modules', 'holdthegoblin', 'package.json'), 'utf8'));
  const version = run(process.execPath, [path.join(project, 'node_modules', '.bin', process.platform === 'win32' ? 'holdthegoblin.cmd' : 'holdthegoblin'), '--version'], { cwd: project }).stdout.trim();
  assert.equal(version, installedPkg.version);

  const imported = run(process.execPath, ['--input-type=module', '-e', 'import("holdthegoblin").then((m) => { if (!m.verify || !m.createMcpServer) process.exit(1); })'], { cwd: project });
  assert.equal(imported.status, 0);
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
  return result;
}

function isSensitiveFileName(file) {
  return /(^|\/)(?:\.env(?:$|[\w.-]*)|\.npmrc|\.pypirc|\.netrc|id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?|[^/]+\.(?:pem|key|p12|pfx|jks|keystore))$/.test(file);
}

function isRuntimeEvidenceFile(file) {
  return file === '.holdthegoblin' || file.startsWith('.holdthegoblin/') || file.includes('/.holdthegoblin/');
}
