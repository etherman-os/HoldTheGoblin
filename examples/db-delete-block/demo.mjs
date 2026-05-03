#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const cli = path.join(root, 'dist', 'src', 'cli.js');
const payloadPath = path.join(here, 'pretooluse-dropdb.json');
const payload = JSON.parse(readFileSync(payloadPath, 'utf8'));
payload.cwd = root;

console.log('$ holdthegoblin hook claude < examples/db-delete-block/pretooluse-dropdb.json');
const result = spawnSync(process.execPath, [cli, 'hook', 'claude'], {
  cwd: root,
  input: JSON.stringify(payload),
  encoding: 'utf8',
});

if (result.stderr) process.stderr.write(result.stderr);
if (result.stdout) process.stdout.write(`${result.stdout}\n`);

if (result.status !== 0 || !result.stdout.includes('"permissionDecision":"deny"')) {
  console.error('Demo failed: expected HoldTheGoblin to deny the database deletion command.');
  process.exit(1);
}

console.log('Demo passed: destructive database command was blocked.');

