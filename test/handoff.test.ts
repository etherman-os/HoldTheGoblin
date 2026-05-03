import assert from 'node:assert/strict';
import test from 'node:test';
import { validateHandoff } from '../src/core/handoff.js';

test('validates required fields and additional properties', () => {
  const schema = {
    type: 'object',
    required: ['taskId', 'status'],
    additionalProperties: false,
    properties: {
      taskId: { type: 'string' },
      status: { enum: ['ready', 'blocked'] },
    },
  };

  assert.equal(validateHandoff(schema, { taskId: 'T-1', status: 'ready' }).ok, true);
  const invalid = validateHandoff(schema, { taskId: 12, extra: true });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.issues.length, 3);
});
