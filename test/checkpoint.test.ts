import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCheckpoint, listCheckpoints, rollbackCheckpoint } from '../src/core/checkpoint.js';

test('creates unique checkpoint ids for rapid consecutive checkpoints', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-checkpoint-'));
  writeFileSync(path.join(root, 'app.txt'), 'content\n');
  const first = await createCheckpoint(root, 'first');
  const second = await createCheckpoint(root, 'second');
  assert.notEqual(first.id, second.id);
  assert.equal(listCheckpoints(root).length, 2);
});

test('checkpoints do not snapshot sensitive local files', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-checkpoint-sensitive-'));
  writeFileSync(path.join(root, 'app.txt'), 'content\n');
  writeFileSync(path.join(root, '.env'), 'TOKEN=secret-value-123456789\n');
  writeFileSync(path.join(root, '.npmrc'), '//registry.npmjs.org/:_authToken=secret-value-123456789\n');
  mkdirSync(path.join(root, '.kube'));
  writeFileSync(path.join(root, '.kube', 'config'), 'token: secret-value-123456789\n');

  const checkpoint = await createCheckpoint(root, 'sensitive');
  assert.deepEqual(checkpoint.files, ['app.txt']);
});

test('rollback delete-new preserves sensitive files and deletes other new files', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-checkpoint-delete-new-'));
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'src', 'app.txt'), 'before\n');
  const checkpoint = await createCheckpoint(root, 'before');

  writeFileSync(path.join(root, '.env'), 'TOKEN=secret-value-123456789\n');
  writeFileSync(path.join(root, 'new.txt'), 'new\n');
  rollbackCheckpoint(root, checkpoint.id, true);

  assert.equal(existsSync(path.join(root, '.env')), true);
  assert.equal(existsSync(path.join(root, 'new.txt')), false);
  assert.equal(existsSync(path.join(root, 'src', 'app.txt')), true);
});

test('rollback rejects tampered checkpoint paths outside the root', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-checkpoint-tamper-'));
  const outside = path.join(tmpdir(), `htg-outside-${Date.now()}.txt`);
  writeFileSync(path.join(root, 'app.txt'), 'before\n');
  writeFileSync(outside, 'outside\n');
  const checkpoint = await createCheckpoint(root, 'before');
  const metaPath = path.join(root, '.holdthegoblin', 'checkpoints', checkpoint.id, 'meta.json');
  const tampered = { ...checkpoint, files: ['../outside.txt'] };
  writeFileSync(metaPath, JSON.stringify(tampered, null, 2) + '\n');

  assert.throws(() => rollbackCheckpoint(root, checkpoint.id), /Unsafe relative path/);
  assert.equal(readFileSync(outside, 'utf8'), 'outside\n');
});

test('checkpoints skip symlinked files', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-checkpoint-symlink-'));
  const outside = path.join(tmpdir(), `htg-target-${Date.now()}.txt`);
  writeFileSync(outside, 'outside\n');
  symlinkSync(outside, path.join(root, 'linked.txt'));
  writeFileSync(path.join(root, 'app.txt'), 'content\n');

  const checkpoint = await createCheckpoint(root, 'symlink');
  assert.deepEqual(checkpoint.files, ['app.txt']);
});
