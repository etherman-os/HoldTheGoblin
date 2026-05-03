import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { appPath } from '../src/core/config.js';
import { buildAgentOpsPayload, buildLangfusePayload, exportObservability } from '../src/core/observability.js';
import type { VerifyResult } from '../src/core/types.js';

test('observability payloads summarize verification without command output', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-observe-'));
  const result: VerifyResult = {
    ok: false,
    mode: 'balanced',
    root,
    runId: 'run-1',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1000,
    changedFiles: ['src/app.ts'],
    detections: { root, kinds: ['javascript'], testCommands: [], securityCommands: [], warnings: [] },
    commandResults: [{
      id: 'test',
      label: 'Test',
      command: 'npm test',
      skipped: false,
      exitCode: 1,
      stdout: 'secret sk-1234567890abcdefghijklmnopqrstuvwxyz', // holdthegoblin: allow-secret
      stderr: 'failure',
      durationMs: 10,
      timedOut: false,
      attempts: 1,
    }],
    checks: [{ id: 'x', label: 'X', status: 'fail', severity: 'high', message: 'failed sk-1234567890abcdefghijklmnopqrstuvwxyz' }], // holdthegoblin: allow-secret
    findings: [],
    edgeCases: [],
  };
  const langfuse = JSON.stringify(buildLangfusePayload(result));
  const agentops = JSON.stringify(buildAgentOpsPayload(result));
  assert.match(langfuse, /holdthegoblin.verify/);
  assert.match(agentops, /holdthegoblin.verify/);
  assert.doesNotMatch(langfuse, /abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(agentops, /abcdefghijklmnopqrstuvwxyz/);
});

test('observability send handles success, server errors, missing env, and timeout', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-observe-send-'));
  const result = sampleVerifyResult(root);
  const runs = appPath(root, 'runs');
  mkdirSync(runs, { recursive: true });
  writeFileSync(path.join(runs, `${result.runId}.json`), JSON.stringify(result));

  const okServer = await startServer((_req, res) => {
    res.writeHead(200).end('ok');
  });
  const errorServer = await startServer((_req, res) => {
    res.writeHead(500).end('bad');
  });
  const slowServer = await startServer(() => undefined);

  const previous = snapshotEnv(['LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY', 'LANGFUSE_BASE_URL']);
  try {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
    process.env.LANGFUSE_SECRET_KEY = 'sk-test';
    process.env.LANGFUSE_BASE_URL = okServer.url;
    const success = await exportObservability({ root, provider: 'langfuse', send: true, sendTimeoutMs: 500 });
    assert.equal(success[0].ok, true);
    assert.equal(success[0].status, 200);

    process.env.LANGFUSE_BASE_URL = errorServer.url;
    const failure = await exportObservability({ root, provider: 'langfuse', send: true, sendTimeoutMs: 500 });
    assert.equal(failure[0].ok, false);
    assert.equal(failure[0].status, 500);

    delete process.env.LANGFUSE_PUBLIC_KEY;
    const missing = await exportObservability({ root, provider: 'langfuse', send: true, sendTimeoutMs: 500 });
    assert.equal(missing[0].ok, false);
    assert.match(missing[0].error ?? '', /LANGFUSE_PUBLIC_KEY/);

    process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
    process.env.LANGFUSE_BASE_URL = slowServer.url;
    const timedOut = await exportObservability({ root, provider: 'langfuse', send: true, sendTimeoutMs: 20 });
    assert.equal(timedOut[0].ok, false);
    assert.match(timedOut[0].error ?? '', /abort|aborted|Abort/i);
  } finally {
    restoreEnv(previous);
    await okServer.close();
    await errorServer.close();
    await slowServer.close();
  }
});

function sampleVerifyResult(root: string): VerifyResult {
  return {
    ok: true,
    mode: 'balanced',
    root,
    runId: 'run-1',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1000,
    changedFiles: [],
    detections: { root, kinds: ['javascript'], testCommands: [], securityCommands: [], warnings: [] },
    commandResults: [],
    checks: [{ id: 'x', label: 'X', status: 'pass', severity: 'info', message: 'ok' }],
    findings: [],
    edgeCases: [],
  };
}

async function startServer(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server address.');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function snapshotEnv(keys: string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
