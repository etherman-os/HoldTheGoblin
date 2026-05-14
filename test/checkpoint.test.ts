import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

test('rollback replaces target symlinks instead of writing through them', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-checkpoint-target-symlink-'));
  const outside = path.join(tmpdir(), `htg-checkpoint-outside-${Date.now()}.txt`);
  const target = path.join(root, 'app.txt');
  writeFileSync(target, 'before\n');
  writeFileSync(outside, 'outside\n');
  const checkpoint = await createCheckpoint(root, 'before');
  rmSync(target);
  symlinkSync(outside, target);

  rollbackCheckpoint(root, checkpoint.id);

  assert.equal(readFileSync(outside, 'utf8'), 'outside\n');
  assert.equal(readFileSync(target, 'utf8'), 'before\n');
  assert.equal(lstatSync(target).isSymbolicLink(), false);
});

test('rollback rejects symlinked target parent directories', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-checkpoint-parent-symlink-'));
  const outside = mkdtempSync(path.join(tmpdir(), 'htg-checkpoint-parent-outside-'));
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'src', 'app.txt'), 'before\n');
  const checkpoint = await createCheckpoint(root, 'before');
  rmSync(path.join(root, 'src'), { recursive: true, force: true });
  symlinkSync(outside, path.join(root, 'src'));

  assert.throws(
    () => rollbackCheckpoint(root, checkpoint.id),
    /target directory must not contain symlinks/
  );
  assert.equal(existsSync(path.join(outside, 'app.txt')), false);
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

test('checkpoint listing rejects symlinked checkpoint directories', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-checkpoint-list-symlink-'));
  const outside = mkdtempSync(path.join(tmpdir(), 'htg-checkpoint-outside-'));
  mkdirSync(path.join(root, '.holdthegoblin', 'checkpoints'), { recursive: true });
  writeFileSync(path.join(outside, 'meta.json'), JSON.stringify({
    id: 'outside',
    root,
    createdAt: new Date().toISOString(),
    files: ['app.txt'],
  }));
  symlinkSync(outside, path.join(root, '.holdthegoblin', 'checkpoints', 'outside'));

  assert.throws(() => listCheckpoints(root), /checkpoint directory must not be a symlink/);
});

test('checkpoints prune old snapshots to the retention limit', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-checkpoint-retention-'));
  writeFileSync(path.join(root, 'app.txt'), 'content\n');

  for (let i = 0; i < 21; i += 1) {
    writeFileSync(path.join(root, 'app.txt'), `content ${i}\n`);
    await createCheckpoint(root, `checkpoint ${i}`);
  }

  const checkpoints = listCheckpoints(root);
  assert.equal(checkpoints.length, 20);
  assert.equal(checkpoints.some((checkpoint) => checkpoint.note === 'checkpoint 0'), false);
});
