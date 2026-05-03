import assert from 'node:assert/strict';
import test from 'node:test';
import { runMcpHttpServer } from '../src/mcp.js';

test('mcp-http requires auth token outside loopback', async () => {
  await assert.rejects(
    runMcpHttpServer({ host: '0.0.0.0', port: 0 }),
    /auth-token/
  );
});
