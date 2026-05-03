import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { appPath, ensureAppDirs } from './config.js';
import { relativePosix, toPosixPath } from './paths.js';
import { isSensitivePath } from './risk.js';
import { runShell } from './runner.js';
import type { PlannedCommand } from './types.js';

export interface CheckpointMeta {
  id: string;
  root: string;
  createdAt: string;
  files: string[];
  note?: string;
}

const EXCLUDE = new Set(['.git', '.holdthegoblin', 'node_modules', 'dist', 'build', 'coverage', '.next', 'target']);
const MAX_FILE_SIZE = 2 * 1024 * 1024;

export async function createCheckpoint(root: string, note?: string): Promise<CheckpointMeta> {
  ensureAppDirs(root);
  const id = checkpointId();
  const dir = appPath(root, 'checkpoints', id);
  const filesDir = path.join(dir, 'files');
  mkdirSync(filesDir, { recursive: true });

  const files = await listCandidateFiles(root);
  for (const file of files) {
    const source = path.join(root, file);
    const target = path.join(filesDir, file);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(source, target);
  }

  const meta: CheckpointMeta = { id, root, createdAt: new Date().toISOString(), files, note };
  writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  return meta;
}

function checkpointId(): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

export function listCheckpoints(root: string): CheckpointMeta[] {
  const dir = appPath(root, 'checkpoints');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((entry) => path.join(dir, entry, 'meta.json'))
    .filter((file) => existsSync(file))
    .map((file) => JSON.parse(readFileSync(file, 'utf8')) as CheckpointMeta)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function rollbackCheckpoint(root: string, id?: string, deleteNew = false): CheckpointMeta {
  const checkpoint = resolveCheckpoint(root, id);
  const dir = appPath(root, 'checkpoints', checkpoint.id, 'files');
  for (const file of checkpoint.files) {
    const source = path.join(dir, file);
    const target = path.join(root, file);
    if (!existsSync(source)) continue;
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(source, target);
  }

  if (deleteNew) {
    const checkpointFiles = new Set(checkpoint.files.map((file) => toPosixPath(file)));
    for (const file of walkFiles(root)) {
      const rel = relativePosix(root, file);
      if (!checkpointFiles.has(rel) && !isSensitivePath(rel)) rmSync(file, { force: true });
    }
  }

  return checkpoint;
}

function resolveCheckpoint(root: string, id?: string): CheckpointMeta {
  const checkpoints = listCheckpoints(root);
  if (checkpoints.length === 0) throw new Error('No checkpoints found.');
  if (!id || id === 'latest') return checkpoints[checkpoints.length - 1];
  const match = checkpoints.find((checkpoint) => checkpoint.id === id);
  if (!match) throw new Error(`Checkpoint not found: ${id}`);
  return match;
}

async function listCandidateFiles(root: string): Promise<string[]> {
  const gitFiles = await listGitFiles(root);
  if (gitFiles.length > 0) return gitFiles.map(toPosixPath).filter((file) => canSnapshot(path.join(root, file), file));
  return [...walkFiles(root)]
    .map((file) => relativePosix(root, file))
    .filter((file) => canSnapshot(path.join(root, file), file));
}

async function listGitFiles(root: string): Promise<string[]> {
  const command: PlannedCommand = {
    id: 'git:list-files',
    label: 'List git files',
    command: 'git ls-files --cached --others --exclude-standard',
    kind: 'doctor',
    required: false,
    reason: 'Checkpoint candidate files',
  };
  const result = await runShell(command, { cwd: root, timeoutMs: 10_000, retries: 0 });
  if (result.exitCode !== 0) return [];
  return result.stdout.split(/\r?\n/).map((line) => toPosixPath(line.trim())).filter(Boolean);
}

function* walkFiles(root: string): Generator<string> {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (EXCLUDE.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    if (entry.isFile()) yield full;
  }
}

function canSnapshot(file: string, relativeFile = toPosixPath(file)): boolean {
  if (!existsSync(file)) return false;
  if (isSensitivePath(relativeFile)) return false;
  const parts = toPosixPath(file).split('/');
  if (parts.some((part) => EXCLUDE.has(part))) return false;
  const stat = statSync(file);
  return stat.isFile() && stat.size <= MAX_FILE_SIZE;
}
