import { existsSync } from 'node:fs';
import path from 'node:path';
import { runShell } from './runner.js';
import type { PlannedCommand } from './types.js';

export async function findGitRoot(cwd: string): Promise<string> {
  const resolvedCwd = path.resolve(cwd);
  const command: PlannedCommand = {
    id: 'git:root',
    label: 'Find git root',
    command: 'git rev-parse --show-toplevel',
    kind: 'doctor',
    required: false,
    reason: 'Find repository root',
  };
  const result = await runShell(command, { cwd, timeoutMs: 5000, retries: 0 });
  if (result.exitCode !== 0) return resolvedCwd;

  const root = result.stdout.trim();
  if (root && path.resolve(root) !== resolvedCwd && hasLocalProjectMarker(resolvedCwd)) {
    return resolvedCwd;
  }
  return root || resolvedCwd;
}

export function isGitRepo(root: string): boolean {
  return existsSync(path.join(root, '.git'));
}

export async function getChangedFiles(root: string): Promise<string[]> {
  if (!isGitRepo(root)) return [];

  const commands: PlannedCommand[] = [
    {
      id: 'git:diff-name-only',
      label: 'Changed tracked files',
      command: 'git diff --name-only --diff-filter=ACMRTUXB HEAD',
      kind: 'doctor',
      required: false,
      reason: 'Find changed tracked files',
    },
    {
      id: 'git:untracked',
      label: 'Untracked files',
      command: 'git ls-files --others --exclude-standard',
      kind: 'doctor',
      required: false,
      reason: 'Find untracked files',
    },
  ];

  const files = new Set<string>();
  for (const command of commands) {
    const result = await runShell(command, { cwd: root, timeoutMs: 5000, retries: 0 });
    if (result.exitCode !== 0) continue;
    for (const line of result.stdout.split(/\r?\n/)) {
      const file = line.trim();
      if (file) files.add(file);
    }
  }
  return [...files].sort();
}

function hasLocalProjectMarker(cwd: string): boolean {
  return [
    '.holdthegoblin/config.json',
    'package.json',
    'pyproject.toml',
    'go.mod',
    'Cargo.toml',
    'pom.xml',
    'build.gradle',
    'build.gradle.kts',
  ].some((marker) => existsSync(path.join(cwd, marker)));
}
