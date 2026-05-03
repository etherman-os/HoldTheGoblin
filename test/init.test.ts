import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { initProject } from '../src/core/init.js';
import { readEvents } from '../src/core/events.js';
import { modeFromArg } from '../src/core/config.js';

test('installs cursor rules and writes init event', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-init-'));
  const changes = initProject({ root, agent: 'cursor', executablePath: '/tmp/holdthegoblin', mode: 'balanced' });
  assert.ok(changes.some((change) => change.includes('Cursor rules ready')));
  const rule = readFileSync(path.join(root, '.cursor', 'rules', 'holdthegoblin.mdc'), 'utf8');
  assert.match(rule, /holdthegoblin verify/);
  const events = readEvents(root);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'init');
});

test('all profile installs claude and cursor assets', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-all-'));
  initProject({ root, agent: 'all', executablePath: '/tmp/holdthegoblin', mode: 'strict' });
  const claudeSettings = readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8');
  const cursorRule = readFileSync(path.join(root, '.cursor', 'rules', 'holdthegoblin.mdc'), 'utf8');
  const agentsRule = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  const warpRule = readFileSync(path.join(root, 'WARP.md'), 'utf8');
  const skill = readFileSync(path.join(root, '.agents', 'skills', 'holdthegoblin', 'SKILL.md'), 'utf8');
  const codexSkill = readFileSync(path.join(root, '.codex', 'skills', 'holdthegoblin', 'SKILL.md'), 'utf8');
  const warpSkill = readFileSync(path.join(root, '.warp', 'skills', 'holdthegoblin', 'SKILL.md'), 'utf8');
  assert.match(claudeSettings, /hook claude/);
  assert.match(cursorRule, /latest\.md/);
  assert.match(agentsRule, /holdthegoblin verify/);
  assert.match(warpRule, /Warp supports `AGENTS\.md`/);
  assert.match(skill, /HoldTheGoblin Workflow/);
  assert.match(codexSkill, /HoldTheGoblin Workflow/);
  assert.match(warpSkill, /HoldTheGoblin Workflow/);
});

test('codex profile preserves existing AGENTS.md content', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'htg-codex-'));
  const file = path.join(root, 'AGENTS.md');
  const existing = '# Existing Rules\n\nKeep this section.\n';
  writeFileSync(file, existing);
  initProject({ root, agent: 'codex', executablePath: '/tmp/holdthegoblin', mode: 'balanced' });
  const agentsRule = readFileSync(file, 'utf8');
  assert.match(agentsRule, /Keep this section/);
  assert.match(agentsRule, /holdthegoblin:start/);
  assert.match(agentsRule, /Codex/);
});

test('invalid mode is rejected', () => {
  assert.throws(() => modeFromArg('strcit'), /Invalid mode/);
});
