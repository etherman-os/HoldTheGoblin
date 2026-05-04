#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'dist', 'src', 'cli.js');

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: options.cwd ?? root,
    input: options.input,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.stderr.write(result.stdout);
    throw new Error(`Command failed: holdthegoblin ${args.join(' ')}`);
  }
  return result.stdout;
}

function runMcpSmoke() {
  const messages = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'holdthegoblin-smoke', version: '0.0.0' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'doctor', arguments: { root } },
    },
  ].map((message) => JSON.stringify(message)).join('\n') + '\n';

  const result = spawnSync(process.execPath, [cli, 'mcp'], {
    cwd: root,
    input: messages,
    encoding: 'utf8',
    timeout: 15_000,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.stderr.write(result.stdout);
    throw new Error('MCP smoke test failed.');
  }
  for (const expected of [
    '"name":"verify"',
    '"name":"doctor"',
    '"name":"config_validate"',
    '"name":"checkpoint_create"',
    '"name":"checkpoint_list"',
    '"name":"checkpoint_rollback"',
    '"name":"handoff_validate"',
    '"name":"events"',
    '"name":"deploy_run"',
    '"name":"observability_export"',
    '"name":"tests_generate"',
    '"name":"models_providers"',
    '"root"',
  ]) {
    if (!result.stdout.includes(expected)) {
      process.stderr.write(result.stdout);
      throw new Error(`MCP smoke test missing expected output: ${expected}`);
    }
  }
}

async function runMcpHttpSmoke() {
  const port = await freePort();
  const child = spawn(process.execPath, [cli, 'mcp-http', '--port', String(port)], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    const deadline = Date.now() + 5000;
    while (!stderr.includes('MCP HTTP listening') && Date.now() < deadline) {
      await sleep(50);
    }
    if (!stderr.includes('MCP HTTP listening')) throw new Error(`MCP HTTP server did not start: ${stderr}`);

    const client = new Client({ name: 'holdthegoblin-smoke', version: '0.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
    await client.connect(transport);
    const tools = await client.listTools();
    for (const expected of ['verify', 'doctor', 'config_validate', 'deploy_run', 'observability_export', 'tests_generate', 'models_providers']) {
      if (!tools.tools.some((tool) => tool.name === expected)) throw new Error(`MCP HTTP missing tool: ${expected}`);
    }
    const doctor = await client.callTool({ name: 'doctor', arguments: { root } });
    if (!JSON.stringify(doctor).includes(root)) throw new Error('MCP HTTP doctor call did not return project root.');
    await client.close();
  } finally {
    child.kill('SIGTERM');
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a port.'));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const version = run(['--version']).trim();
if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error(`Invalid version output: ${version}`);

const hookOutput = run(['hook', 'claude'], {
  input: JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'dropdb production' },
    cwd: root,
  }),
});
if (!hookOutput.includes('"permissionDecision":"deny"')) {
  throw new Error('Expected hook smoke test to deny dropdb command.');
}

const temp = mkdtempSync(path.join(tmpdir(), 'htg-smoke-'));
try {
  run(['wrap', '--agent', 'all', temp], { cwd: temp });
  for (const rel of [
    '.claude/settings.json',
    '.cursor/rules/holdthegoblin.mdc',
    'AGENTS.md',
    'WARP.md',
    '.agents/skills/holdthegoblin/SKILL.md',
    '.codex/skills/holdthegoblin/SKILL.md',
    '.warp/skills/holdthegoblin/SKILL.md',
  ]) {
    if (!existsSync(path.join(temp, rel))) throw new Error(`Missing wrapped asset: ${rel}`);
  }
  const gitignore = readFileSync(path.join(temp, '.gitignore'), 'utf8');
  if (!gitignore.includes('.holdthegoblin/latest.html')) throw new Error('Wrapped project .gitignore does not ignore latest.html.');
  run(['verify', '--format', 'json'], { cwd: temp });
  const latestHtml = path.join(temp, '.holdthegoblin', 'latest.html');
  if (!existsSync(latestHtml)) throw new Error('Verification did not write latest.html.');
  const htmlOutput = run(['verify', '--format', 'html'], { cwd: temp });
  if (!htmlOutput.startsWith('<!doctype html>')) throw new Error('verify --format html did not emit an HTML document.');
  if (!readFileSync(latestHtml, 'utf8').includes('<meta http-equiv="Content-Security-Policy"')) throw new Error('HTML report is missing CSP.');
  run(['events', '--format', 'json'], { cwd: temp });
  run(['tests', 'generate', '--output', path.join(temp, 'generated-tests.md')], { cwd: temp });
  run(['models', 'providers'], { cwd: temp });
  run(['observability', 'export', '--provider', 'all'], { cwd: temp });

  const plan = path.join(temp, 'holdthegoblin.deploy.json');
  run(['deploy', 'init', '--output', plan], { cwd: temp });
  run(['deploy', 'run', '--plan', plan, '--dry-run'], { cwd: temp });
} finally {
  rmSync(temp, { recursive: true, force: true });
}

run(['handoff', 'validate', '--schema', 'examples/handoff/schema.json', '--input', 'examples/handoff/payload.json']);
runMcpSmoke();
await runMcpHttpSmoke();

console.log('Smoke checks passed.');
