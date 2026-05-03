import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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
