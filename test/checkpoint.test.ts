import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCheckpoint, listCheckpoints } from '../src/core/checkpoint.js';

test('creates unique checkpoint ids for rapid consecutive checkpoints', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-checkpoint-'));
  writeFileSync(path.join(root, 'app.txt'), 'content\n');
  const first = await createCheckpoint(root, 'first');
  const second = await createCheckpoint(root, 'second');
  assert.notEqual(first.id, second.id);
  assert.equal(listCheckpoints(root).length, 2);
});
