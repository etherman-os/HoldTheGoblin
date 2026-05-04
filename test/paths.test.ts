import assert from 'node:assert/strict';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertSafeRelativePath, resolveExistingInsideProject, resolveInsideProject, toPosixPath } from '../src/core/paths.js';

test('normalizes windows and posix separators to posix paths', () => {
  assert.equal(toPosixPath('src\\core/file.ts'), 'src/core/file.ts');
  assert.equal(toPosixPath('src//core///file.ts'), 'src/core/file.ts');
});

test('rejects project path escapes', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-paths-'));
  assert.equal(resolveInsideProject(root, 'inside.txt'), path.join(root, 'inside.txt'));
  assert.throws(() => resolveInsideProject(root, '../outside.txt'), /escapes project root/);
  assert.throws(() => resolveInsideProject(root, path.join(tmpdir(), 'outside.txt')), /escapes project root/);
});

test('rejects existing project paths that resolve through symlinks outside the root', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-paths-real-'));
  const outside = path.join(tmpdir(), `htg-paths-outside-${Date.now()}.json`);
  writeFileSync(outside, '{}\n');
  symlinkSync(outside, path.join(root, 'linked.json'));

  assert.throws(() => resolveExistingInsideProject(root, 'linked.json'), /resolves outside project root/);
});

test('rejects unsafe checkpoint-relative paths', () => {
  assert.equal(assertSafeRelativePath('src/app.ts'), 'src/app.ts');
  assert.throws(() => assertSafeRelativePath('../outside.txt'), /Unsafe relative path/);
  assert.throws(() => assertSafeRelativePath('/outside.txt'), /Unsafe relative path/);
  assert.throws(() => assertSafeRelativePath('C:\\outside.txt'), /Unsafe relative path/);
});
