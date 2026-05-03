import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { findEdgeCases } from '../src/core/edgecases.js';

test('finds deterministic edge-case suggestions', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-edge-'));
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'src', 'app.ts'), `
    const token = process.env.API_TOKEN;
    await fetch("https://example.com");
    await prisma.user.deleteMany({});
  `);

  const suggestions = findEdgeCases(root, []);
  assert.ok(suggestions.some((item) => item.category === 'env'));
  assert.ok(suggestions.some((item) => item.category === 'network'));
  assert.ok(suggestions.some((item) => item.category === 'database'));
});
