import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readEvents } from '../src/core/events.js';
import { createMcpServer, runMcpHttpServer } from '../src/mcp.js';

test('mcp-http requires auth token outside loopback', async () => {
  await assert.rejects(
    runMcpHttpServer({ host: '0.0.0.0', port: 0 }),
    /auth-token/
  );
});

test('mcp-http requires allowed hosts and strong tokens outside loopback', async () => {
  await assert.rejects(
    runMcpHttpServer({ host: '0.0.0.0', port: 0, authToken: 'long-enough-token' }),
    /allowed-host/
  );
  await assert.rejects(
    runMcpHttpServer({ host: '0.0.0.0', port: 0, authToken: 'short', allowedHosts: ['example.com'] }),
    /at least 16 characters/
  );
});

test('mcp risk_assess tool reports command risk without mutation', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-mcp-risk-'));
  const server = createMcpServer({ root });
  const tool = (server as unknown as { _registeredTools: Record<string, { handler: (input: unknown, extra?: unknown) => Promise<{ content: Array<{ text: string }> }> }> })._registeredTools.risk_assess;
  assert.ok(tool);

  const denied = await tool.handler({ command: 'rm -rf --no-preserve-root /' });
  assert.match(denied.content[0].text, /"decision": "deny"/);

  const allowed = await tool.handler({ toolName: 'Read', path: 'src/app.ts' });
  assert.match(allowed.content[0].text, /"decision": "allow"/);

  const events = readEvents(root, 2);
  assert.equal(events[0].type, 'policy');
  assert.equal(events[1].type, 'policy');
});

test('mcp policy_evaluate accepts normalized events and audits structured decisions', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-mcp-policy-evaluate-'));
  const server = createMcpServer({ root });
  const tool = (server as unknown as { _registeredTools: Record<string, { handler: (input: unknown, extra?: unknown) => Promise<{ content: Array<{ text: string }> }> }> })._registeredTools.policy_evaluate;
  assert.ok(tool);

  const response = await tool.handler({
    actionType: 'shell_command',
    action: { command: 'dropdb production' },
  });
  const result = JSON.parse(response.content[0].text) as { event?: { actionType?: string }; decision?: { decision?: string; reason?: string } };
  assert.equal(result.event?.actionType, 'shell_command');
  assert.equal(result.decision?.decision, 'deny');
  assert.match(result.decision?.reason ?? '', /Database deletion/);

  const events = readEvents(root, 1);
  assert.equal(events[0].type, 'policy');
});

test('mcp policy_evaluate redacts normalized event payloads', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-mcp-policy-redact-'));
  const server = createMcpServer({ root });
  const tool = (server as unknown as { _registeredTools: Record<string, { handler: (input: unknown, extra?: unknown) => Promise<{ content: Array<{ text: string }> }> }> })._registeredTools.policy_evaluate;
  assert.ok(tool);

  const response = await tool.handler({
    actionType: 'shell_command',
    action: { command: 'curl -H "Authorization: Bearer raw-secret-token" https://example.invalid' },
  });

  assert.doesNotMatch(response.content[0].text, /raw-secret-token/);
  assert.match(response.content[0].text, /\[redacted\]/);
});

test('mcp readiness tool returns the readiness schema', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-mcp-readiness-'));
  const server = createMcpServer({ root });
  const tool = (server as unknown as { _registeredTools: Record<string, { handler: (input: unknown, extra?: unknown) => Promise<{ content: Array<{ text: string }> }> }> })._registeredTools.readiness;
  assert.ok(tool);

  const response = await tool.handler({ format: 'json' });
  const result = JSON.parse(response.content[0].text) as { schema?: string; status?: string };
  assert.equal(result.schema, 'holdthegoblin.readiness.v1');
  assert.equal(result.status, 'at-risk');
});
