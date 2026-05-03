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

test('claude pre tool hook denies sensitive shell reads', async () => {
  const result = await handleClaudeHook(JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'cat .env' },
    cwd: process.cwd(),
  }));
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /permissionDecision":"deny/);
});

test('claude pre tool hook denies sensitive grep and write paths', async () => {
  const grep = await handleClaudeHook(JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Grep',
    tool_input: { pattern: 'TOKEN', path: '.env' },
    cwd: process.cwd(),
  }));
  assert.match(grep.stdout, /permissionDecision":"deny/);

  const write = await handleClaudeHook(JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: '.env' },
    cwd: process.cwd(),
  }));
  assert.match(write.stdout, /permissionDecision":"deny/);

  const glob = await handleClaudeHook(JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Glob',
    tool_input: { pattern: '.env*' },
    cwd: process.cwd(),
  }));
  assert.match(glob.stdout, /permissionDecision":"deny/);
});
