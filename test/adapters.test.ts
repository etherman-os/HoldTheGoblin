import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHoldTheGoblinCrewAIGuard, createHoldTheGoblinLangGraphConditionalEdge, createHoldTheGoblinLangGraphNode } from '../src/index.js';

test('langgraph adapter returns a state node function', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-langgraph-'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e ""' } }));
  const node = createHoldTheGoblinLangGraphNode({ root, failClosed: false });
  const state = await node({ task: 'x' });
  assert.equal(state.task, 'x');
  assert.equal(state.holdTheGoblin.root, root);
});

test('crewai adapter exposes afterKickoff guard', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-crewai-'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e ""' } }));
  const guard = createHoldTheGoblinCrewAIGuard({ root, failClosed: false });
  const result = await guard.afterKickoff();
  assert.equal(result.root, root);
});

test('adapters fail closed by default on failed verification', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-adapter-fail-'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } }));
  const node = createHoldTheGoblinLangGraphNode({ root });
  await assert.rejects(() => node({}), /verification failed/i);

  const guard = createHoldTheGoblinCrewAIGuard({ root });
  await assert.rejects(() => guard.afterKickoff(), /verification failed/i);
});

test('langgraph conditional edge routes on guard result', () => {
  const route = createHoldTheGoblinLangGraphConditionalEdge();
  assert.equal(route({ holdTheGoblin: { ok: true } }), 'pass');
  assert.equal(route({ holdTheGoblin: { ok: false } }), 'fail');
  assert.equal(route({}), 'fail');
});
