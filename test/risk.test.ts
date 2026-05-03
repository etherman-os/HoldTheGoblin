import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateCommandRisk, evaluatePathReadRisk } from '../src/core/risk.js';

test('denies broad destructive rm commands', () => {
  const result = evaluateCommandRisk('rm -rf /');
  assert.equal(result.decision, 'deny');
});

test('asks for production-like deploy commands', () => {
  const result = evaluateCommandRisk('kubectl apply -f deployment.yaml');
  assert.equal(result.decision, 'ask');
});

test('denies destructive database deletion commands', () => {
  assert.equal(evaluateCommandRisk('dropdb production').decision, 'deny');
  assert.equal(evaluateCommandRisk('psql "$DATABASE_URL" -c "DROP DATABASE production"').decision, 'deny');
});

test('denies sensitive file reads', () => {
  const result = evaluatePathReadRisk('/repo/.env');
  assert.equal(result.decision, 'deny');
});
