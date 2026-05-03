import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { modeFromArg, writeDefaultConfig } from './config.js';
import { appendEvent } from './events.js';
import type { AgentKind, GuardMode } from './types.js';

interface ClaudeSettings {
  hooks?: Record<string, Array<Record<string, unknown>>>;
  [key: string]: unknown;
}

export interface InitOptions {
  root: string;
  agent: string;
  mode?: string;
  executablePath: string;
}

export function initProject(options: InitOptions): string[] {
  const changes: string[] = [];
  const mode = modeFromArg(options.mode);
  const agent = normalizeAgent(options.agent);
  const config = writeDefaultConfig(options.root, mode);
  changes.push(`Config ready: ${config}`);
  ensureGitignore(options.root);
  changes.push('Ignored local run/checkpoint artifacts.');

  if (agent === 'claude' || agent === 'all') {
    const settings = installClaudeHooks(options.root, options.executablePath, mode);
    changes.push(`Claude Code hooks ready: ${settings}`);
  }
  if (agent === 'cursor' || agent === 'all') {
    const rule = installCursorRules(options.root);
    changes.push(`Cursor rules ready: ${rule}`);
  }
  if (agent === 'codex' || agent === 'all') {
    const rule = installAgentRules(options.root, 'codex');
    changes.push(`Codex project rules ready: ${rule}`);
    const skill = installAgentSkill(options.root, '.agents');
    changes.push(`Agent skill ready: ${skill}`);
    const codexSkill = installAgentSkill(options.root, '.codex');
    changes.push(`Codex skill ready: ${codexSkill}`);
  }
  if (agent === 'warp' || agent === 'all') {
    const rule = installAgentRules(options.root, 'warp');
    changes.push(`Warp project rules ready: ${rule}`);
    const compatRule = installWarpCompatibilityRules(options.root);
    changes.push(`Warp compatibility rules ready: ${compatRule}`);
    const skill = installAgentSkill(options.root, '.agents');
    if (!changes.includes(`Agent skill ready: ${skill}`)) changes.push(`Agent skill ready: ${skill}`);
    const warpSkill = installAgentSkill(options.root, '.warp');
    changes.push(`Warp skill ready: ${warpSkill}`);
  }

  appendEvent(options.root, {
    type: 'init',
    ok: true,
    summary: `Installed ${agent} guard profile in ${mode} mode.`,
    data: { agent, mode, changes },
  });

  return changes;
}

export function normalizeAgent(agent: string): AgentKind {
  if (agent === 'claude' || agent === 'claude-code') return 'claude';
  if (agent === 'cursor') return 'cursor';
  if (agent === 'codex' || agent === 'openai-codex') return 'codex';
  if (agent === 'warp' || agent === 'warp-terminal') return 'warp';
  if (agent === 'all' || agent === '*') return 'all';
  throw new Error(`Unsupported agent "${agent}". Supported: claude-code, cursor, codex, warp, all.`);
}

function installClaudeHooks(root: string, executablePath: string, _mode: GuardMode): string {
  const dir = path.join(root, '.claude');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'settings.json');
  const settings = readJson<ClaudeSettings>(file, {});
  settings.hooks = settings.hooks ?? {};
  const command = hookCommand(executablePath);

  addHook(settings, 'PreToolUse', {
    matcher: 'Bash|Read|Grep|Glob|Edit|Write|MultiEdit|NotebookEdit',
    hooks: [{ type: 'command', command }],
  });
  addHook(settings, 'PostToolBatch', {
    hooks: [{ type: 'command', command, timeout: 180 }],
  });
  addHook(settings, 'Stop', {
    hooks: [{ type: 'command', command, timeout: 300 }],
  });

  writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  return file;
}

function installCursorRules(root: string): string {
  const dir = path.join(root, '.cursor', 'rules');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'holdthegoblin.mdc');
  writeFileSync(file, `---
description: HoldTheGoblin safety guard for AI coding work
alwaysApply: true
---

Before finishing any coding task:

1. Run \`holdthegoblin verify\` from the repository root.
2. Treat a non-zero exit code as blocking. Fix the reported failures and rerun verification.
3. Do not read or print credential files such as \`.env\`, private keys, or cloud credential stores.
4. Before risky refactors or deploy-related edits, run \`holdthegoblin checkpoint create --note "<task>"\`.
5. For multi-agent handoffs, validate payloads with \`holdthegoblin handoff validate --schema <schema> --input <payload>\`.
6. For deploy work, use \`holdthegoblin deploy run --plan <plan>\` instead of running production deploy commands directly.
7. When risky code paths changed, use \`holdthegoblin tests generate\` to create a focused test plan before final verification.

Use \`.holdthegoblin/latest.md\` as the evidence report when explaining what passed or failed.
`);
  return file;
}

function installAgentRules(root: string, target: 'codex' | 'warp'): string {
  const file = path.join(root, 'AGENTS.md');
  const section = `## HoldTheGoblin Guard Rules

These rules apply to ${target === 'codex' ? 'Codex' : 'Warp'} and any other agent that reads \`AGENTS.md\`.

Before finishing coding work:

1. Run \`holdthegoblin verify\` from the repository root.
2. If \`holdthegoblin\` is not on PATH in a remote/cloud agent environment, try a project-local install with \`npm exec -- holdthegoblin verify\`. If that also fails, stop and report that HoldTheGoblin must be installed before completion can be verified.
3. Treat a non-zero exit code as blocking. Fix the reported failures and rerun verification.
4. Do not read, print, summarize, or exfiltrate credential files such as \`.env\`, private keys, SSH keys, cloud credential stores, or production secrets.
5. Before risky refactors, deploy edits, database migrations, or destructive filesystem work, run \`holdthegoblin checkpoint create --note "<task>"\`.
6. For multi-agent handoffs, validate JSON payloads with \`holdthegoblin handoff validate --schema <schema> --input <payload>\`.
7. For deploy work, prefer a versioned \`holdthegoblin deploy run --plan <plan>\` flow with shadow/canary health checks and rollback.
8. When risky code paths changed, run \`holdthegoblin tests generate\` and add real tests before final verification.
9. When reporting completion, cite \`.holdthegoblin/latest.md\` as the evidence report and mention any warnings that remain.

If \`.agents/skills/holdthegoblin/SKILL.md\` exists, use that skill for verification and release-safety workflows.
`;
  upsertMarkedSection(file, 'holdthegoblin', section);
  return file;
}

function installWarpCompatibilityRules(root: string): string {
  const file = path.join(root, 'WARP.md');
  const section = `## HoldTheGoblin Guard Rules

Warp supports \`AGENTS.md\` as the default project rules file and \`WARP.md\` for compatibility. Follow the same HoldTheGoblin workflow:

1. Run \`holdthegoblin verify\` before finishing.
2. If \`holdthegoblin\` is not on PATH in a remote/cloud agent environment, try a project-local install with \`npm exec -- holdthegoblin verify\`. If that also fails, stop and report that HoldTheGoblin must be installed.
3. Use \`holdthegoblin checkpoint create --note "<task>"\` before risky changes.
4. Never expose credential files to the agent context.
5. Use \`holdthegoblin deploy run --plan <plan>\` for deploy work.
6. Use \`.holdthegoblin/latest.md\` as completion evidence.
`;
  upsertMarkedSection(file, 'holdthegoblin', section);
  return file;
}

function installAgentSkill(root: string, baseDir: '.agents' | '.codex' | '.warp'): string {
  const dir = path.join(root, baseDir, 'skills', 'holdthegoblin');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'SKILL.md');
  writeFileSync(file, skillContent());
  return file;
}

function skillContent(): string {
  return `---
name: holdthegoblin
description: Use when an AI coding agent needs to verify changes, block unsafe operations, validate handoffs, or prepare release evidence with HoldTheGoblin.
---

# HoldTheGoblin Workflow

Use this skill before claiming a coding task is complete.

## Verification

1. Run \`holdthegoblin verify\` from the repository root.
2. If \`holdthegoblin\` is not on PATH in a remote/cloud agent environment, try a project-local install with \`npm exec -- holdthegoblin verify\`.
3. If neither command is available, stop and report that HoldTheGoblin must be installed before completion can be verified.
4. If verification fails, inspect \`.holdthegoblin/latest.md\`, fix the failing checks, and rerun verification.
5. If Semgrep or Trivy are missing, report them as skipped rather than passed.
6. Include remaining warnings in the final response.
7. For risky changed code paths, run \`holdthegoblin tests generate\`, implement the relevant tests, then rerun verification.

## Risky Changes

Before deploy edits, database migrations, large refactors, or destructive filesystem work:

1. Run \`holdthegoblin checkpoint create --note "<task>"\`.
2. Avoid reading credential files into context.
3. Use \`holdthegoblin events --limit 10\` when you need recent guard history.

## Multi-Agent Handoffs

Validate structured handoffs with:

\`\`\`bash
holdthegoblin handoff validate --schema <schema.json> --input <payload.json>
\`\`\`

## Deploy And Observability

For deploy work, use:

\`\`\`bash
holdthegoblin deploy run --plan <holdthegoblin.deploy.json>
\`\`\`

For release evidence export, use:

\`\`\`bash
holdthegoblin observability export --provider all
\`\`\`
`;
}

function hookCommand(executablePath: string): string {
  const normalized = executablePath.replace(/"/g, '\\"');
  return `node "${normalized}" hook claude`;
}

function addHook(settings: ClaudeSettings, event: string, hook: Record<string, unknown>): void {
  const hooks = settings.hooks!;
  hooks[event] = hooks[event] ?? [];
  const serialized = JSON.stringify(hook);
  const exists = hooks[event].some((item) => JSON.stringify(item) === serialized);
  if (!exists) hooks[event].push(hook);
}

function ensureGitignore(root: string): void {
  const file = path.join(root, '.gitignore');
  const entries = [
    '.holdthegoblin/runs/',
    '.holdthegoblin/checkpoints/',
    '.holdthegoblin/tmp/',
    '.holdthegoblin/latest.md',
    '.holdthegoblin/events.jsonl',
    '.holdthegoblin/exports/',
    '.holdthegoblin/deploy-latest.json',
    '.holdthegoblin/generated-tests.md',
  ];
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const lines = new Set(current.split(/\r?\n/).filter(Boolean));
  let changed = false;
  for (const entry of entries) {
    if (!lines.has(entry)) {
      lines.add(entry);
      changed = true;
    }
  }
  if (changed || !existsSync(file)) {
    writeFileSync(file, [...lines].join('\n') + '\n');
  }
}

function upsertMarkedSection(file: string, marker: string, section: string): void {
  const start = `<!-- ${marker}:start -->`;
  const end = `<!-- ${marker}:end -->`;
  const block = `${start}\n${section.trim()}\n${end}`;
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, 'm');
  const next = pattern.test(current)
    ? current.replace(pattern, block)
    : `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${block}\n`;
  writeFileSync(file, next.endsWith('\n') ? next : `${next}\n`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}
