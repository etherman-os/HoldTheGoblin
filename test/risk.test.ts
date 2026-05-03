import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateCommandRisk, evaluatePathReadRisk } from '../src/core/risk.js';

test('denies broad destructive rm commands', () => {
  for (const command of ['rm -rf /', 'rm -rf /*', 'rm -fr -- /', 'sudo rm -rf $HOME']) {
    assert.equal(evaluateCommandRisk(command).decision, 'deny', command);
  }
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

test('denies shell commands that read sensitive paths', () => {
  for (const command of ['cat .env', 'grep TOKEN /repo/.env', 'sed -n 1p ~/.ssh/id_ed25519']) {
    assert.equal(evaluateCommandRisk(command).decision, 'deny', command);
  }
});
