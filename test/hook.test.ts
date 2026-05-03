import assert from 'node:assert/strict';
import test from 'node:test';
import { handleClaudeHook } from '../src/core/hooks.js';

test('claude pre tool hook denies dangerous bash', async () => {
  const result = await handleClaudeHook(JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf /' },
    cwd: process.cwd(),
  }));
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /permissionDecision":"deny/);
});
