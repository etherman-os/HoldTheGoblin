import assert from 'node:assert/strict';
import test from 'node:test';
import { runMcpHttpServer } from '../src/mcp.js';

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
